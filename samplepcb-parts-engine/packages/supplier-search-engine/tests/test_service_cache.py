from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from unittest.mock import patch

from supplier_search_engine.contract import VALUE_FIELDS
from supplier_search_engine.contract import SearchBatchInput, SearchComponentInput, SearchField
from supplier_search_engine.matcher import CandidateMatcher, finalize_candidate_decisions

from supplier_search_engine.models import (
    MatchStatus,
    PlannedQuery,
    RawSupplierResponse,
    SearchMode,
    Supplier,
    SupplierOffer,
    SupplierProduct,
    SupplierSearchResult,
)
from supplier_search_engine.procurement import ProcurementReevaluationError
from supplier_search_engine.service import SearchService
from supplier_search_engine.settings import Settings
from supplier_search_engine.suppliers.base import SupplierClient


class FakeDigiKeyClient(SupplierClient):
    supplier = Supplier.DIGIKEY
    api_version = "fake-v1"

    def __init__(self, *, delay: float = 0.0, products: list[SupplierProduct] | None = None) -> None:
        self.delay = delay
        self.calls = 0
        self.products = products or []

    @property
    def configured(self) -> bool:
        return True

    async def fetch(
        self,
        query: PlannedQuery,
        reserve_call: Callable[[], Awaitable[None]] | None = None,
    ) -> RawSupplierResponse:
        if reserve_call:
            await reserve_call()
        self.calls += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        return RawSupplierResponse(supplier=self.supplier, ok=True, status_code=200, payload={"hit": True})

    def normalize(self, raw: RawSupplierResponse, query: PlannedQuery) -> list[SupplierProduct]:
        return list(self.products)

    async def close(self) -> None:
        return None


class FakeSupplierClient(FakeDigiKeyClient):
    def __init__(self, supplier: Supplier, *, products=None) -> None:
        super().__init__(products=products)
        self.supplier = supplier


class ErrorSupplierClient(FakeSupplierClient):
    async def fetch(
        self,
        query: PlannedQuery,
        reserve_call: Callable[[], Awaitable[None]] | None = None,
    ) -> RawSupplierResponse:
        if reserve_call:
            await reserve_call()
        self.calls += 1
        return RawSupplierResponse(
            supplier=self.supplier,
            ok=False,
            error_type="timeout",
            error_message="supplier timed out",
        )


def make_component(component_id: str, *, resistance: str | None = None) -> SearchComponentInput:
    values = {"part_number": "ABC-123", "manufacturer": "Acme", "resistance": resistance}
    fields = {
        name: SearchField(
            value=values.get(name),
            status="extracted" if values.get(name) is not None else "not_found",
        )
        for name in VALUE_FIELDS
    }
    return SearchComponentInput(
        component_id=component_id,
        source_file="bom.xlsx",
        sheet_name="BOM",
        sheet_index_0based=0,
        source_rows_1based=[2],
        review_status="accepted",
        fields=fields,
    )


def make_batch() -> SearchBatchInput:
    return SearchBatchInput(
        parser_schema_version="1",
        parser_version="test",
        training_fingerprint="test",
        source_file="bom.xlsx",
        components=[make_component("a"), make_component("b")],
    )


def make_product() -> SupplierProduct:
    return SupplierProduct(
        supplier=Supplier.DIGIKEY,
        manufacturer_part_number="ABC-123",
        manufacturer="Acme",
    )


async def test_batch_deduplicates_and_second_run_uses_durable_cache(tmp_path):
    fake = FakeDigiKeyClient(products=[make_product()])
    settings = Settings(cache_path=tmp_path / "cache.sqlite3")
    service = SearchService(settings, clients=[fake])

    first = await service.search_batch(make_batch())
    second = await service.search_batch(make_batch())

    assert first.unique_query_count == 1
    assert first.api_calls == 1
    assert first.components[0].api_calls == 1
    assert first.components[1].api_calls == 0
    assert fake.calls == 1
    assert second.api_calls == 0
    assert second.cache_hits == 1


async def test_singleflight_collapses_concurrent_identical_requests(tmp_path):
    fake = FakeDigiKeyClient(delay=0.05, products=[make_product()])
    service = SearchService(Settings(cache_path=tmp_path / "cache.sqlite3"), clients=[fake])
    query = service.planner.plan(make_component("a"))

    results = await asyncio.gather(service.search_component(query), service.search_component(query))

    assert fake.calls == 1
    assert sum(result.api_calls for result in results) == 1
    states = [
        supplier_result.cache_state
        for result in results
        for supplier_result in result.supplier_results
        if supplier_result.supplier == Supplier.DIGIKEY
    ]
    assert "coalesced" in states
    trace_sources = [
        attempt.source
        for result in results
        if result.search_trace is not None
        for attempt in result.search_trace.attempts
        if attempt.supplier == Supplier.DIGIKEY
    ]
    assert "coalesced" in trace_sources


async def test_negative_results_are_cached(tmp_path):
    fake = FakeDigiKeyClient(products=[])
    service = SearchService(Settings(cache_path=tmp_path / "cache.sqlite3"), clients=[fake])
    query = service.planner.plan(make_component("a"))

    first = await service.search_component(query)
    second = await service.search_component(query)

    assert first.status.value == "not_found"
    assert second.status.value == "not_found"
    assert fake.calls == 1
    assert second.api_calls == 0


async def test_search_collapses_identical_offers_but_preserves_raw_results(
    tmp_path,
):
    supplier_product = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        supplier_product_id="digikey-ss34",
        manufacturer_part_number="SS34",
        manufacturer="Diodes Inc.",
        package="SMB",
        offers=[
            SupplierOffer(
                supplier=Supplier.DIGIKEY,
                supplier_sku="SS34DICT-ND",
                packaging="Cut Tape",
                stock=1_000,
                moq=1,
                order_multiple=1,
                price_breaks=[
                    {"quantity": 1, "unit_price": 100, "currency": "KRW"}
                ],
            )
        ],
    )
    fake = FakeDigiKeyClient(
        products=[supplier_product, supplier_product.model_copy(deep=True)]
    )
    service = SearchService(
        Settings(cache_path=tmp_path / "cache.sqlite3"),
        clients=[fake],
    )

    result = await service.search_component(
        PlannedQuery(
            component_id="ss34",
            mode=SearchMode.IDENTITY,
            part_number="SS34",
            manufacturer="Diodes Inc.",
            part_type="diode",
            package="SMB",
            quantity=10,
        )
    )

    assert result.status == MatchStatus.VERIFIED_EXACT
    assert len(result.supplier_results[0].products) == 2
    assert len(result.candidates) == 1
    assert len(result.candidates[0].product.offers) == 1
    decision = result.candidates[0].product.offers[0].procurement_decision
    assert decision is not None
    assert result.procurement_decision.automatic_offer_key == decision.offer_key


async def test_identity_miss_retries_with_specs_and_preserves_both_attempts(tmp_path):
    product = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        manufacturer_part_number="SPEC-CAP-10UF",
        category="Ceramic Capacitors",
        package="0402",
        normalized_specs={
            "capacitance_f": 10e-6,
            "voltage_v": 10.0,
            "package": "0402",
            "part_type": "capacitor",
        },
    )
    unrelated = product.model_copy(
        update={"manufacturer_part_number": "UNRELATED-PART"},
        deep=True,
    )

    class IdentityMissSpecHitClient(FakeDigiKeyClient):
        def normalize(self, raw, query):
            return [product] if query.mode == SearchMode.PARAMETRIC else [unrelated]

    item = make_component("fallback")
    item.fields["part_number"].value = "0603X03L_C"
    item.fields["manufacturer"].value = "Murata"
    for name, value in {
        "part_type": "capacitor",
        "capacitance": "10uF",
        "voltage": "6.3V",
        "package": "0402",
    }.items():
        item.fields[name].value = value
        item.fields[name].status = "extracted"
    fake = IdentityMissSpecHitClient()
    service = SearchService(Settings(cache_path=tmp_path / "cache.sqlite3"), clients=[fake])

    result = await service.search_component(service.planner.plan(item))

    assert fake.calls == 2
    assert result.mode == SearchMode.PARAMETRIC
    assert result.identity_fallback is True
    assert result.status == MatchStatus.SPEC_COMPATIBLE
    assert result.initial_query is not None
    assert result.initial_query.mode == SearchMode.IDENTITY
    assert result.initial_query.part_number == "0603X03L_C"
    assert result.initial_supplier_results[0].products == [unrelated]
    assert result.query is not None
    assert result.query.part_number is None
    assert result.query.keywords == "10uF 0402"
    assert [item.supplier for item in result.initial_supplier_results] == [
        Supplier.DIGIKEY,
        Supplier.MOUSER,
        Supplier.UNIKEYIC,
    ]
    assert [item.supplier for item in result.supplier_results] == [
        Supplier.DIGIKEY,
        Supplier.MOUSER,
        Supplier.UNIKEYIC,
    ]
    assert result.api_calls == 2
    assert "일치하는 후보가 없어 확정 스펙으로 다시 검색" in " ".join(result.warnings)

    batch_result = await service.search_batch(
        SearchBatchInput(
            parser_schema_version="1",
            parser_version="test",
            training_fingerprint="test",
            source_file="bom.xlsx",
            components=[item],
        )
    )
    batched = batch_result.components[0]
    assert fake.calls == 2
    assert batch_result.cache_hits == 2
    assert batched.mode == SearchMode.PARAMETRIC
    assert batched.identity_fallback is True
    assert batched.initial_query is not None
    assert batched.initial_query.mode == SearchMode.IDENTITY
    assert batched.initial_query.part_number == "0603X03L_C"
    assert batched.query is not None
    assert batched.query.mode == SearchMode.PARAMETRIC
    assert batched.query.part_number is None
    assert [item.supplier for item in batched.initial_supplier_results] == [
        Supplier.DIGIKEY,
        Supplier.MOUSER,
        Supplier.UNIKEYIC,
    ]
    assert all(not item.products for item in batched.initial_supplier_results)

    restored = type(batch_result).model_validate_json(batch_result.model_dump_json())
    restored_component = restored.components[0]
    assert restored_component.identity_fallback is True
    assert restored_component.initial_query is not None
    assert restored_component.initial_query.part_number == "0603X03L_C"
    assert restored_component.query is not None
    assert restored_component.query.mode == SearchMode.PARAMETRIC


async def test_normal_zero_results_trigger_parametric_fallback(tmp_path):
    clients = [FakeSupplierClient(supplier) for supplier in Supplier]
    service = SearchService(
        Settings(cache_path=tmp_path / "cache.sqlite3"), clients=clients
    )
    item = make_component("zero", resistance="10kΩ")
    item.fields["part_number"].value = "0603X03L_C"
    item.fields["part_type"].value = "resistor"
    item.fields["part_type"].status = "extracted"

    result = await service.search_component(service.planner.plan(item))

    assert [client.calls for client in clients] == [2, 2, 2]
    assert result.status == MatchStatus.NOT_FOUND
    assert result.mode == SearchMode.PARAMETRIC
    assert result.identity_fallback is True
    assert result.initial_query is not None
    assert result.initial_query.part_number == "0603X03L_C"


async def test_supplier_errors_only_do_not_trigger_parametric_fallback(tmp_path):
    clients = [ErrorSupplierClient(supplier) for supplier in Supplier]
    service = SearchService(
        Settings(cache_path=tmp_path / "cache.sqlite3"), clients=clients
    )
    item = make_component("errors", resistance="10kΩ")
    item.fields["part_number"].value = "0603X03L_C"
    item.fields["part_type"].value = "resistor"
    item.fields["part_type"].status = "extracted"

    result = await service.search_component(service.planner.plan(item))

    assert [client.calls for client in clients] == [1, 1, 1]
    assert result.status == MatchStatus.SUPPLIER_ERROR
    assert result.mode == SearchMode.IDENTITY
    assert result.identity_fallback is False
    assert result.initial_query is None
    assert {item.error_type for item in result.supplier_results} == {"timeout"}


async def test_partial_supplier_success_without_identity_match_triggers_fallback(
    tmp_path,
):
    clients = [
        FakeSupplierClient(Supplier.DIGIKEY),
        ErrorSupplierClient(Supplier.MOUSER),
        ErrorSupplierClient(Supplier.UNIKEYIC),
    ]
    service = SearchService(
        Settings(cache_path=tmp_path / "cache.sqlite3"), clients=clients
    )
    item = make_component("partial", resistance="10kΩ")
    item.fields["part_number"].value = "0603X03L_C"
    item.fields["part_type"].value = "resistor"
    item.fields["part_type"].status = "extracted"

    result = await service.search_component(service.planner.plan(item))

    assert [client.calls for client in clients] == [2, 2, 2]
    assert result.mode == SearchMode.PARAMETRIC
    assert result.identity_fallback is True
    assert result.initial_query is not None
    assert any(item.error_type is None for item in result.initial_supplier_results)
    assert any(item.error_type == "timeout" for item in result.initial_supplier_results)


async def test_identity_miss_without_sufficient_specs_does_not_retry(tmp_path):
    fake = FakeDigiKeyClient(products=[])
    service = SearchService(Settings(cache_path=tmp_path / "cache.sqlite3"), clients=[fake])

    result = await service.search_component(service.planner.plan(make_component("no-fallback")))

    assert fake.calls == 1
    assert result.mode == SearchMode.IDENTITY
    assert result.identity_fallback is False
    assert result.status == MatchStatus.NOT_FOUND
    assert result.initial_query is None


async def test_resolved_identity_with_specs_does_not_retry(tmp_path):
    product = make_product().model_copy(
        update={
            "package": "0603",
            "normalized_specs": {"resistance_ohm": 10_000.0, "package": "0603"},
        },
        deep=True,
    )
    fake = FakeDigiKeyClient(products=[product])
    service = SearchService(Settings(cache_path=tmp_path / "cache.sqlite3"), clients=[fake])
    item = make_component("resolved", resistance="10kΩ")
    item.fields["package"].value = "0603"
    item.fields["package"].status = "extracted"

    result = await service.search_component(service.planner.plan(item))

    assert fake.calls == 1
    assert result.mode == SearchMode.IDENTITY
    assert result.identity_fallback is False
    assert result.status == MatchStatus.VERIFIED_EXACT
    assert result.initial_query is None


async def test_resolved_identity_variant_with_specs_does_not_retry(tmp_path):
    product = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        manufacturer_part_number="RC0603-10KR",
        manufacturer="Acme",
        category="Chip Resistors - Surface Mount",
        package="0603",
        normalized_specs={"resistance_ohm": 10_000.0, "package": "0603"},
    )
    fake = FakeDigiKeyClient(products=[product])
    service = SearchService(
        Settings(cache_path=tmp_path / "cache.sqlite3"), clients=[fake]
    )
    item = make_component("variant", resistance="10kΩ")
    item.fields["part_number"].value = "RC0603-10K"
    item.fields["part_type"].value = "resistor"
    item.fields["part_type"].status = "extracted"
    item.fields["package"].value = "0603"
    item.fields["package"].status = "extracted"

    result = await service.search_component(service.planner.plan(item))

    assert fake.calls == 1
    assert result.status == MatchStatus.VERIFIED_VARIANT
    assert result.mode == SearchMode.IDENTITY
    assert result.identity_fallback is False
    assert result.initial_query is None


async def test_same_supplier_query_reuses_raw_response_but_rechecks_each_bom_spec(tmp_path):
    product = make_product().model_copy(update={"normalized_specs": {"resistance_ohm": 10_000.0}})
    fake = FakeDigiKeyClient(products=[product])
    service = SearchService(Settings(cache_path=tmp_path / "cache.sqlite3"), clients=[fake])
    batch = SearchBatchInput(
        parser_schema_version="1",
        parser_version="test",
        training_fingerprint="test",
        source_file="bom.xlsx",
        components=[
            make_component("matches", resistance="10kΩ"),
            make_component("conflicts", resistance="1kΩ"),
        ],
    )

    result = await service.search_batch(batch)

    assert result.unique_query_count == 2
    assert result.api_calls == 1
    assert fake.calls == 1
    assert result.components[0].status.value == "verified_exact"
    assert result.components[1].status.value == "input_conflict"


async def test_cache_only_can_use_expired_entry_inside_stale_window(tmp_path):
    fake = FakeDigiKeyClient(products=[make_product()])
    settings = Settings(
        cache_path=tmp_path / "cache.sqlite3",
        raw_cache_ttl_seconds=0,
        stale_ttl_seconds=60,
    )
    service = SearchService(settings, clients=[fake])
    query = service.planner.plan(make_component("a"))
    await service.search_component(query)
    await asyncio.sleep(0.01)
    settings.cache_only = True

    cached = await service.search_component(query)

    digikey = next(item for item in cached.supplier_results if item.supplier == Supplier.DIGIKEY)
    assert fake.calls == 1
    assert digikey.cache_state == "stale"
    assert cached.api_calls == 0
    assert cached.search_trace is not None
    assert next(
        attempt.source
        for attempt in cached.search_trace.attempts
        if attempt.supplier == Supplier.DIGIKEY
    ) == "stale_cache"


async def test_batch_timeout_returns_every_component_without_waiting_for_slow_supplier(tmp_path):
    fake = FakeDigiKeyClient(delay=0.2, products=[make_product()])
    service = SearchService(
        Settings(
            cache_path=tmp_path / "cache.sqlite3",
            job_timeout_seconds=0.02,
        ),
        clients=[fake],
    )

    result = await service.search_batch(make_batch())

    assert len(result.components) == 2
    assert all(component.status.value == "supplier_error" for component in result.components)
    assert all(
        supplier.error_type == "job_timeout"
        for component in result.components
        for supplier in component.supplier_results
    )
    assert result.elapsed_ms < 150


async def test_long_part_number_trace_does_not_abort_batch(tmp_path):
    fake = FakeDigiKeyClient(products=[])
    service = SearchService(
        Settings(cache_path=tmp_path / "cache.sqlite3"), clients=[fake]
    )
    contaminated = make_component("contaminated")
    contaminated.fields["part_number"].value = "X" * 600
    batch = SearchBatchInput(
        parser_schema_version="1",
        parser_version="test",
        training_fingerprint="test",
        source_file="bom.xlsx",
        components=[make_component("normal"), contaminated],
    )

    result = await service.search_batch(batch)

    assert [component.component_id for component in result.components] == [
        "normal",
        "contaminated",
    ]
    assert result.components[0].search_trace is not None
    assert result.components[1].search_trace is not None
    assert result.components[1].search_trace.primary_query == "X" * 500
    assert all(
        len(attempt.query) <= 500
        for component in result.components
        if component.search_trace is not None
        for attempt in component.search_trace.attempts
    )


def test_batch_failure_result_survives_trace_builder_failure() -> None:
    query = PlannedQuery(
        component_id="broken-trace",
        mode=SearchMode.IDENTITY,
        part_number="ABC-123",
    )

    with patch.object(
        SearchService,
        "_component_search_trace",
        side_effect=ValueError("trace assembly failed"),
    ):
        result = SearchService._batch_failure_result(
            query,
            error_type="upstream_failure",
            message="supplier search failed",
        )

    assert result.status == MatchStatus.SUPPLIER_ERROR
    assert result.search_trace is None
    assert result.warnings == ["supplier search failed"]


def test_batch_error_type_preserves_procurement_error_code() -> None:
    error = ProcurementReevaluationError(
        "duplicate_offer_key",
        "stable offer keys must identify exactly one stored offer",
    )

    assert SearchService._batch_error_type(error) == (
        "ProcurementReevaluationError:duplicate_offer_key"
    )


async def test_parametric_search_does_not_wait_for_identity_mouser_prefetch(tmp_path):
    class BarrierProbeService(SearchService):
        def __init__(self, settings):
            super().__init__(settings, clients=[])
            self.parametric_mouser_started = asyncio.Event()

        async def _prefetch_mouser_exact(self, plans, job_budget):
            await asyncio.wait_for(self.parametric_mouser_started.wait(), timeout=0.2)
            return 0

        async def _search_supplier(self, supplier, query, job_budget):
            if supplier == Supplier.MOUSER and query.mode.value == "parametric":
                self.parametric_mouser_started.set()
            return SupplierSearchResult(supplier=supplier)

    parametric = make_component("spec", resistance="10kΩ")
    parametric.fields["part_number"].value = None
    parametric.fields["part_number"].status = "not_found"
    parametric.fields["package"].value = "0603"
    parametric.fields["package"].status = "extracted"
    batch = SearchBatchInput(
        parser_schema_version="1",
        parser_version="test",
        training_fingerprint="test",
        source_file="bom.xlsx",
        components=[parametric],
    )
    service = BarrierProbeService(Settings(cache_path=tmp_path / "cache.sqlite3"))

    result = await service.search_batch(batch)

    assert service.parametric_mouser_started.is_set()
    assert result.components[0].status == MatchStatus.NOT_FOUND


async def test_digikey_identity_and_parametric_searches_use_separate_lanes(tmp_path):
    class LaneProbeDigiKeyClient(FakeDigiKeyClient):
        def __init__(self) -> None:
            super().__init__(delay=0.03, products=[])
            self.active = {SearchMode.IDENTITY: 0, SearchMode.PARAMETRIC: 0}
            self.maximum = {SearchMode.IDENTITY: 0, SearchMode.PARAMETRIC: 0}
            self.maximum_total = 0

        async def fetch(self, query, reserve_call=None):
            if reserve_call:
                await reserve_call()
            lane = SearchMode.IDENTITY if query.mode == SearchMode.IDENTITY else SearchMode.PARAMETRIC
            self.active[lane] += 1
            self.maximum[lane] = max(self.maximum[lane], self.active[lane])
            self.maximum_total = max(self.maximum_total, sum(self.active.values()))
            try:
                await asyncio.sleep(self.delay)
            finally:
                self.active[lane] -= 1
            self.calls += 1
            return RawSupplierResponse(
                supplier=self.supplier,
                ok=True,
                status_code=200,
                payload={"hit": True},
            )

    fake = LaneProbeDigiKeyClient()
    service = SearchService(
        Settings(
            cache_path=tmp_path / "cache.sqlite3",
            digikey_concurrency=5,
            digikey_identity_concurrency=2,
            digikey_parametric_concurrency=3,
        ),
        clients=[fake],
    )
    queries = [
        PlannedQuery(
            component_id=f"identity-{index}",
            mode=SearchMode.IDENTITY,
            part_number=f"PART-{index}",
            keywords=f"PART-{index}",
        )
        for index in range(5)
    ] + [
        PlannedQuery(
            component_id=f"spec-{index}",
            mode=SearchMode.PARAMETRIC,
            part_type="resistor",
            keywords=f"{index + 1}k 0603",
        )
        for index in range(5)
    ]

    await asyncio.gather(*(service.search_component(query) for query in queries))

    assert fake.maximum[SearchMode.IDENTITY] == 2
    assert fake.maximum[SearchMode.PARAMETRIC] == 3
    assert fake.maximum_total == 5


async def test_batch_result_keeps_all_decided_candidates_without_duplicate_products(tmp_path):
    products = [
        make_product().model_copy(update={"manufacturer_part_number": f"ABC-123-{index}"})
        for index in range(6)
    ]
    fake = FakeDigiKeyClient(products=products)
    service = SearchService(Settings(cache_path=tmp_path / "cache.sqlite3"), clients=[fake])

    result = await service.search_batch(make_batch())

    assert len(result.components[0].candidates) == 6
    assert all(candidate.decision.identity_key for candidate in result.components[0].candidates)
    assert result.components[0].supplier_results[0].products == []


def test_manual_review_candidate_ranks_before_blocked_conflict():
    query = PlannedQuery(
        component_id="rank",
        mode=SearchMode.PARAMETRIC,
        part_type="resistor",
        requirements={
            "resistance_ohm": {
                "name": "resistance_ohm",
                "raw_value": "1k",
                "normalized_value": 1_000.0,
                "status": "extracted",
                "hard": True,
            }
        },
    )
    partial = CandidateMatcher().evaluate(
        query,
        make_product().model_copy(update={"manufacturer_part_number": "PARTIAL"}),
    )
    explained_conflict = CandidateMatcher().evaluate(
        query,
        make_product().model_copy(
            update={
                "manufacturer_part_number": "CONFLICT",
                "normalized_specs": {"resistance_ohm": 2_000.0},
            }
        ),
    )
    decided = finalize_candidate_decisions(query, [partial, explained_conflict])

    ranked = sorted(
        decided,
        key=SearchService._candidate_sort_key,
    )

    assert ranked[0].product.manufacturer_part_number == "PARTIAL"
    assert ranked[0].decision.selection_eligibility.value == "manual_review"
    assert ranked[1].decision.selection_eligibility.value == "blocked"


def test_technical_sort_does_not_use_stock():
    query = PlannedQuery(
        component_id="stock",
        mode=SearchMode.IDENTITY,
        part_number="ABC-123",
    )
    digikey = make_product().model_copy(
        update={"offers": [SupplierOffer(supplier=Supplier.DIGIKEY, stock=0)]}
    )
    mouser = make_product().model_copy(
        update={
            "supplier": Supplier.MOUSER,
            "offers": [SupplierOffer(supplier=Supplier.MOUSER, stock=1_000_000)],
        }
    )
    candidates = finalize_candidate_decisions(
        query,
        [
            CandidateMatcher().evaluate(query, mouser),
            CandidateMatcher().evaluate(query, digikey),
        ],
    )
    candidates = SearchService._add_corroboration(candidates)

    ranked = sorted(
        candidates,
        key=SearchService._candidate_sort_key,
    )

    assert [candidate.product.supplier for candidate in ranked] == [
        Supplier.DIGIKEY,
        Supplier.MOUSER,
    ]


def test_two_exact_suppliers_suggest_non_destructive_part_type_correction():
    query = PlannedQuery(
        component_id="c22",
        mode=SearchMode.IDENTITY,
        part_number="CL31A226MQHNNNE",
        part_type="resistor",
        keywords="CL31A226MQHNNNE",
        requirements={
            "part_type": {
                "name": "part_type",
                "raw_value": "resistor",
                "normalized_value": "resistor",
                "status": "extracted",
                "hard": True,
                "comparison": "category",
            }
        },
    )
    candidates = [
        CandidateMatcher().evaluate(
            query,
            SupplierProduct(
                supplier=supplier,
                manufacturer_part_number="CL31A226MQHNNNE",
                category=category,
            ),
        )
        for supplier, category in (
            (Supplier.DIGIKEY, "커패시터"),
            (Supplier.MOUSER, "다층 세라믹 커패시터 MLCC - SMD/SMT"),
        )
    ]

    corrections = SearchService._input_corrections(query, candidates)

    assert len(corrections) == 1
    assert corrections[0].bom_value == "resistor"
    assert corrections[0].suggested_value == "capacitor"
    assert corrections[0].bom_error_probability == 0.99
    assert corrections[0].evidence_suppliers == [Supplier.DIGIKEY, Supplier.MOUSER]
    assert corrections[0].auto_applied is False


def test_single_supplier_does_not_suggest_input_correction():
    query = PlannedQuery(
        component_id="c22",
        mode=SearchMode.IDENTITY,
        part_number="CL31A226MQHNNNE",
        part_type="resistor",
        requirements={
            "part_type": {
                "name": "part_type",
                "raw_value": "resistor",
                "normalized_value": "resistor",
                "status": "extracted",
                "hard": True,
                "comparison": "category",
            }
        },
    )
    candidate = CandidateMatcher().evaluate(
        query,
        SupplierProduct(
            supplier=Supplier.DIGIKEY,
            manufacturer_part_number="CL31A226MQHNNNE",
            category="커패시터",
        ),
    )

    assert SearchService._input_corrections(query, [candidate]) == []


def test_conflicting_supplier_categories_block_input_correction():
    query = PlannedQuery(
        component_id="c22",
        mode=SearchMode.IDENTITY,
        part_number="CL31A226MQHNNNE",
        part_type="resistor",
        requirements={
            "part_type": {
                "name": "part_type",
                "raw_value": "resistor",
                "normalized_value": "resistor",
                "status": "extracted",
                "hard": True,
                "comparison": "category",
            }
        },
    )
    candidates = [
        CandidateMatcher().evaluate(
            query,
            SupplierProduct(
                supplier=supplier,
                manufacturer_part_number="CL31A226MQHNNNE",
                category=category,
            ),
        )
        for supplier, category in (
            (Supplier.DIGIKEY, "커패시터"),
            (Supplier.MOUSER, "다층 세라믹 커패시터"),
            (Supplier.UNIKEYIC, "인덕터"),
        )
    ]

    assert SearchService._input_corrections(query, candidates) == []
