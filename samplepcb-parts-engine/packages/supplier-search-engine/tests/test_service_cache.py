from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from unittest.mock import patch

import httpx

from supplier_search_engine.contract import (
    VALUE_FIELDS,
    SearchBatchInput,
    SearchComponentInput,
    SearchField,
    SearchFieldAlternative,
)
from supplier_search_engine.matcher import CandidateMatcher, finalize_candidate_decisions

from supplier_search_engine.models import (
    MatchStatus,
    PlannedQuery,
    ProcurementDisposition,
    QuantityResolution,
    RawSupplierResponse,
    ReplacementSource,
    Requirement,
    SearchMode,
    SearchScope,
    SearchDisposition,
    Supplier,
    SupplierOffer,
    SupplierProduct,
    SupplierSearchResult,
)
from supplier_search_engine.procurement import ProcurementReevaluationError
from supplier_search_engine.request_cache import supplier_cache_coordinates
from supplier_search_engine.service import SearchService
from supplier_search_engine.settings import Settings
from supplier_search_engine.suppliers.base import SupplierClient
from supplier_search_engine.suppliers.digikey import DigiKeyClient


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


class ModeAwareStockClient(FakeSupplierClient):
    def __init__(
        self,
        supplier: Supplier,
        *,
        exact_stock: int | None,
        replacement_stock: int = 100,
        exact_has_price: bool = True,
        exact_moq: int = 1,
    ) -> None:
        super().__init__(supplier)
        self.exact_stock = exact_stock
        self.replacement_stock = replacement_stock
        self.exact_has_price = exact_has_price
        self.exact_moq = exact_moq

    def normalize(
        self,
        raw: RawSupplierResponse,
        query: PlannedQuery,
    ) -> list[SupplierProduct]:
        is_parametric = query.mode == SearchMode.PARAMETRIC
        mpn = "ABC-ALT" if is_parametric else "ABC-123"
        stock = self.replacement_stock if is_parametric else self.exact_stock
        price_breaks = (
            [{"quantity": 1, "unit_price": 100, "currency": "KRW"}]
            if is_parametric or self.exact_has_price
            else []
        )
        return [
            SupplierProduct(
                supplier=self.supplier,
                supplier_product_id=f"{self.supplier.value}-{mpn}",
                manufacturer_part_number=mpn,
                manufacturer="Acme",
                description="10k Ohm 1% resistor 0603",
                category="Chip Resistor",
                package="0603",
                normalized_specs={
                    "resistance_ohm": 10_000.0,
                    "tolerance_percent": 1.0,
                    "package": "0603",
                },
                offers=[
                    SupplierOffer(
                        supplier=self.supplier,
                        supplier_sku=f"{mpn}-{self.supplier.value}",
                        packaging="Cut Tape",
                        stock=stock,
                        moq=1 if is_parametric else self.exact_moq,
                        order_multiple=1,
                        price_breaks=price_breaks,
                    )
                ],
            )
        ]


class MpnFamilyStockClient(FakeSupplierClient):
    @staticmethod
    def _product(
        supplier: Supplier,
        mpn: str,
        manufacturer: str,
        stock: int,
    ) -> SupplierProduct:
        return SupplierProduct(
            supplier=supplier,
            supplier_product_id=f"{supplier.value}-{mpn}",
            manufacturer_part_number=mpn,
            manufacturer=manufacturer,
            description="Power inductor SMD",
            category="Power Inductors - SMD",
            normalized_specs={"mount_style": "smd"},
            offers=[
                SupplierOffer(
                    supplier=supplier,
                    supplier_sku=f"{mpn}-{manufacturer}-{supplier.value}",
                    packaging="Cut Tape",
                    stock=stock,
                    moq=1,
                    order_multiple=1,
                    price_breaks=[
                        {"quantity": 1, "unit_price": 100, "currency": "KRW"}
                    ],
                )
            ],
        )

    def normalize(
        self,
        raw: RawSupplierResponse,
        query: PlannedQuery,
    ) -> list[SupplierProduct]:
        if query.mode == SearchMode.IDENTITY:
            return [
                self._product(
                    self.supplier,
                    "XAL6060-223MEC",
                    "Coilcraft",
                    0,
                )
            ]
        return [
            self._product(
                self.supplier,
                "XAL6060-223MEB",
                "Coilcraft",
                100,
            ),
            self._product(
                self.supplier,
                "XAL7070-223MEB",
                "Coilcraft",
                100,
            ),
            self._product(
                self.supplier,
                "XAL6060-223MEB",
                "Other Manufacturer",
                100,
            ),
        ]


def stock_replacement_query(*, quantity: int = 10) -> PlannedQuery:
    return PlannedQuery(
        component_id="stock-fallback",
        mode=SearchMode.IDENTITY,
        part_number="ABC-123",
        manufacturer="Acme",
        part_type="resistor",
        category_policy="resistor",
        package="0603",
        quantity=quantity,
        keywords="10k 1% 0603",
        requirements={
            "resistance_ohm": Requirement(
                name="resistance_ohm",
                raw_value="10k",
                normalized_value=10_000.0,
                status="extracted",
                hard=True,
            ),
            "tolerance_percent": Requirement(
                name="tolerance_percent",
                raw_value="1%",
                normalized_value=1.0,
                status="extracted",
                hard=True,
                comparison="lte",
            ),
            "package": Requirement(
                name="package",
                raw_value="0603",
                normalized_value="0603",
                status="extracted",
                hard=True,
            ),
        },
    )


def mpn_family_stock_query() -> PlannedQuery:
    return PlannedQuery(
        component_id="mpn-family-stock-fallback",
        mode=SearchMode.IDENTITY,
        part_number="XAL6060-223MEC",
        part_type="inductor",
        category_policy="inductor",
        quantity=1,
        keywords="XAL6060-223MEC",
        requirements={
            "part_type": Requirement(
                name="part_type",
                raw_value="inductor",
                normalized_value="inductor",
                status="extracted",
                hard=True,
                comparison="category",
            ),
            "mount_style": Requirement(
                name="mount_style",
                raw_value="SMD",
                normalized_value="smd",
                status="extracted",
                hard=True,
            ),
        },
    )


async def test_explicit_allowed_suppliers_limits_search_without_changing_default(
    tmp_path,
):
    digikey = FakeSupplierClient(Supplier.DIGIKEY)
    mouser = FakeSupplierClient(Supplier.MOUSER)
    unikeyic = FakeSupplierClient(Supplier.UNIKEYIC)
    service = SearchService(
        Settings(cache_path=tmp_path / "cache.sqlite3"),
        clients=[digikey, mouser, unikeyic],
        allowed_suppliers={Supplier.MOUSER, Supplier.UNIKEYIC},
    )

    await service.search_component(service.planner.plan(make_component("selected")))

    assert digikey.calls == 0
    assert mouser.calls == 1
    assert unikeyic.calls == 1


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
    assert first.components[0].requirement_guidance is not None
    assert first.components[0].requirement_guidance.readiness == "searchable"
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


async def test_excluded_component_is_retained_without_supplier_call(tmp_path):
    fake = FakeDigiKeyClient(products=[make_product()])
    service = SearchService(Settings(cache_path=tmp_path / "cache.sqlite3"), clients=[fake])
    excluded = make_component("excluded").model_copy(
        update={
            "search_disposition": SearchDisposition.EXCLUDED,
            "procurement_disposition": ProcurementDisposition.EXCLUDED,
            "disposition_reason_codes": ["customer_supplied"],
            "quantity_resolution": QuantityResolution.MISSING,
            "required_quantity": None,
        },
        deep=True,
    )
    batch = SearchBatchInput(
        parser_schema_version="1",
        parser_version="test",
        training_fingerprint="test",
        source_file="bom.xlsx",
        components=[excluded],
    )

    preflight = service.preflight_batch(batch)
    result = await service.search_batch(batch)

    assert preflight.estimated_api_calls == 0
    assert preflight.components[0].mode == SearchMode.EXCLUDED
    assert result.components[0].status == MatchStatus.EXCLUDED
    assert result.components[0].api_calls == 0
    assert result.components[0].procurement_decision.status == "input_incomplete"
    assert fake.calls == 0


async def test_conflicting_parametric_values_run_two_isolated_manual_branches(tmp_path):
    fake = FakeDigiKeyClient(
        products=[
            SupplierProduct(
                supplier=Supplier.DIGIKEY,
                manufacturer_part_number="R-ALT",
                category="Resistors",
                package="0201",
                normalized_specs={"resistance_ohm": 1_000.0, "package": "0201"},
            )
        ]
    )
    service = SearchService(Settings(cache_path=tmp_path / "cache.sqlite3"), clients=[fake])
    item = make_component("conflict", resistance="100k")
    item.fields["part_number"] = SearchField(status="not_found")
    item.fields["manufacturer"] = SearchField(status="not_found")
    item.fields["part_type"] = SearchField(value="resistor", status="extracted")
    item.fields["package"] = SearchField(value="0201", status="extracted")
    item.quality_flags = ["resistance_input_source_conflict"]
    item.input_alternatives = {
        "resistance": [
            SearchFieldAlternative(
                raw_value="100K", normalized_value=100_000.0,
                source_cell="D2", source_role="value",
            ),
            SearchFieldAlternative(
                raw_value="1K", normalized_value=1_000.0,
                source_cell="E2", source_role="value",
            ),
        ]
    }
    batch = SearchBatchInput(
        parser_schema_version="1",
        parser_version="test",
        training_fingerprint="test",
        source_file="bom.xlsx",
        components=[item],
    )

    preflight = service.preflight_batch(batch)
    result = await service.search_batch(batch)
    component_result = result.components[0]

    assert preflight.unique_query_count == 2
    assert len(preflight.components[0].conflict_branch_queries) == 2
    assert fake.calls == 2
    assert component_result.status == MatchStatus.INPUT_CONFLICT
    assert [query.input_branch_id for query in component_result.conflict_branch_queries] == [
        "resistance:1",
        "resistance:2",
    ]
    assert all(
        candidate.decision.selection_eligibility.value != "automatic"
        for candidate in component_result.candidates
    )
    assert component_result.procurement_decision.automatic_offer_key is None
    assert all(
        attempt.stage == "input_conflict_branch"
        for attempt in component_result.search_trace.attempts
    )


async def test_raw_query_reuse_preserves_distinct_exact_mpn_evidence(tmp_path):
    fake = FakeDigiKeyClient(products=[make_product()])
    service = SearchService(
        Settings(cache_path=tmp_path / "cache.sqlite3"), clients=[fake]
    )
    safe = make_component("safe")
    conflicted = make_component("conflicted").model_copy(
        update={"quality_flags": ["package_input_source_conflict"]},
        deep=True,
    )
    batch = SearchBatchInput(
        parser_schema_version="1",
        parser_version="test",
        training_fingerprint="test",
        source_file="bom.xlsx",
        components=[safe, conflicted],
    )

    result = await service.search_batch(batch)
    safe_candidate = result.components[0].candidates[0]
    conflicted_candidate = result.components[1].candidates[0]

    assert fake.calls == 1
    assert safe_candidate.decision.selection_eligibility.value == "automatic"
    assert conflicted_candidate.decision.selection_eligibility.value == "manual_review"
    assert (
        safe_candidate.decision.technical_evidence_key
        != conflicted_candidate.decision.technical_evidence_key
    )
    assert "package_input_source_conflict" in conflicted_candidate.conflicts


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
    assert result.search_scope == SearchScope.ANY_VENDOR_SPEC
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
    assert batched.search_scope == SearchScope.ANY_VENDOR_SPEC
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
    assert restored_component.search_scope == SearchScope.ANY_VENDOR_SPEC
    assert restored_component.initial_query is not None
    assert restored_component.initial_query.part_number == "0603X03L_C"
    assert restored_component.query is not None
    assert restored_component.query.mode == SearchMode.PARAMETRIC


async def test_identity_fallback_without_part_type_keeps_candidates_but_not_quote_recommendation(
    tmp_path,
):
    regulator = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        manufacturer_part_number="MC7805CTG",
        manufacturer="onsemi",
        category="Linear Voltage Regulators",
        package="TO-220",
        normalized_specs={
            "package": "TO-220",
            "mount_style": "through-hole",
            "part_type": "ic",
        },
        offers=[
            SupplierOffer(
                supplier=Supplier.DIGIKEY,
                supplier_sku="MC7805CTGOS-ND",
                stock=100,
                moq=1,
                order_multiple=1,
                price_breaks=[
                    {"quantity": 1, "unit_price": 859, "currency": "KRW"}
                ],
            )
        ],
    )
    unrelated = regulator.model_copy(
        update={"manufacturer_part_number": "UNRELATED-PART"},
        deep=True,
    )

    class HeatSinkFallbackClient(FakeDigiKeyClient):
        def normalize(self, raw, query):
            return [regulator] if query.mode == SearchMode.PARAMETRIC else [unrelated]

    item = make_component("heat-sink")
    item.fields["part_number"].value = "1511B-L25/T18/P1"
    item.fields["manufacturer"].value = None
    item.fields["manufacturer"].status = "not_found"
    item.fields["package"].value = "TO-220"
    item.fields["package"].status = "extracted"
    item.fields["quantity"].value = 1
    item.fields["quantity"].status = "extracted"
    item.footprint = "DIP"
    fake = HeatSinkFallbackClient()
    service = SearchService(
        Settings(cache_path=tmp_path / "cache.sqlite3"),
        clients=[fake],
    )

    result = await service.search_component(service.planner.plan(item))

    assert result.identity_fallback is True
    assert result.candidates
    assert result.procurement_decision.status == "no_recommendation"
    assert result.procurement_decision.selection_application_state.value == "not_selected"
    assert result.procurement_decision.confirmation_required is False
    assert result.procurement_decision.review_offer_key is None
    assert (
        "identity_fallback_without_part_type"
        in result.procurement_decision.recommendation_reason_codes
    )
    assert all(
        offer.procurement_decision is not None
        and offer.procurement_decision.recommendation.value == "none"
        for candidate in result.candidates
        for offer in candidate.product.offers
    )


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


async def test_out_of_stock_exact_match_triggers_manual_stock_replacement_search(
    tmp_path,
):
    mouser = ModeAwareStockClient(Supplier.MOUSER, exact_stock=0)
    service = SearchService(
        Settings(cache_path=tmp_path / "cache.sqlite3"),
        clients=[mouser],
        allowed_suppliers={Supplier.MOUSER},
    )

    result = await service.search_component(stock_replacement_query())
    cached = await service.search_component(stock_replacement_query())

    assert mouser.calls == 2
    replacement = next(
        candidate
        for candidate in result.candidates
        if candidate.product.replacement_source
        == ReplacementSource.ENGINE_STOCK_FALLBACK
    )
    assert replacement.product.manufacturer_part_number == "ABC-ALT"
    assert replacement.product.replacement_for_mpn == "ABC-123"
    assert replacement.decision.selection_eligibility.value == "manual_review"
    assert any(
        candidate.product.manufacturer_part_number == "ABC-123"
        and candidate.product.replacement_source is None
        for candidate in result.candidates
    )
    assert result.procurement_decision is not None
    assert result.procurement_decision.status == "review_recommended"
    assert result.procurement_decision.confirmation_required is True
    assert result.identity_fallback is False
    assert result.search_scope == SearchScope.PART_NUMBER
    assert result.search_trace is not None
    assert result.search_trace.fallback_used is True
    assert cached.api_calls == 0
    assert cached.search_scope == SearchScope.PART_NUMBER
    assert any(
        candidate.product.replacement_source
        == ReplacementSource.ENGINE_STOCK_FALLBACK
        for candidate in cached.candidates
    )


async def test_insufficient_exact_stock_also_triggers_stock_replacement_search(
    tmp_path,
):
    mouser = ModeAwareStockClient(Supplier.MOUSER, exact_stock=5)
    service = SearchService(
        Settings(cache_path=tmp_path / "cache.sqlite3"),
        clients=[mouser],
        allowed_suppliers={Supplier.MOUSER},
    )

    result = await service.search_component(stock_replacement_query(quantity=10))

    assert mouser.calls == 2
    assert any(
        candidate.product.replacement_source
        == ReplacementSource.ENGINE_STOCK_FALLBACK
        for candidate in result.candidates
    )


async def test_mixed_price_and_stock_failure_triggers_procurement_replacement_search(
    tmp_path,
):
    no_price = ModeAwareStockClient(
        Supplier.UNIKEYIC,
        exact_stock=100,
        exact_has_price=False,
    )
    no_stock = ModeAwareStockClient(Supplier.MOUSER, exact_stock=0)
    service = SearchService(
        Settings(cache_path=tmp_path / "cache.sqlite3"),
        clients=[no_price, no_stock],
        allowed_suppliers={Supplier.UNIKEYIC, Supplier.MOUSER},
    )

    result = await service.search_component(stock_replacement_query(quantity=10))

    assert no_price.calls == 2
    assert no_stock.calls == 2
    replacements = [
        candidate
        for candidate in result.candidates
        if candidate.product.replacement_source
        == ReplacementSource.ENGINE_PROCUREMENT_FALLBACK
    ]
    assert replacements
    assert all(
        candidate.decision.selection_eligibility.value == "manual_review"
        for candidate in replacements
    )
    assert result.procurement_decision is not None
    assert result.procurement_decision.status == "review_recommended"
    assert result.procurement_decision.confirmation_required is True
    assert result.search_trace is not None
    assert result.search_trace.fallback_used is True
    assert any(
        "가격·재고·주문수량 조건" in warning for warning in result.warnings
    )


async def test_price_unavailable_exact_offer_triggers_procurement_replacement_search(
    tmp_path,
):
    client = ModeAwareStockClient(
        Supplier.MOUSER,
        exact_stock=100,
        exact_has_price=False,
    )
    service = SearchService(
        Settings(cache_path=tmp_path / "cache.sqlite3"),
        clients=[client],
        allowed_suppliers={Supplier.MOUSER},
    )

    result = await service.search_component(stock_replacement_query())

    assert client.calls == 2
    assert any(
        candidate.product.replacement_source
        == ReplacementSource.ENGINE_PROCUREMENT_FALLBACK
        for candidate in result.candidates
    )


async def test_excessive_exact_moq_triggers_procurement_replacement_search(tmp_path):
    client = ModeAwareStockClient(
        Supplier.MOUSER,
        exact_stock=20_000,
        exact_moq=10_000,
    )
    service = SearchService(
        Settings(cache_path=tmp_path / "cache.sqlite3"),
        clients=[client],
        allowed_suppliers={Supplier.MOUSER},
    )

    result = await service.search_component(stock_replacement_query(quantity=2))

    assert client.calls == 2
    assert any(
        candidate.product.replacement_source
        == ReplacementSource.ENGINE_PROCUREMENT_FALLBACK
        for candidate in result.candidates
    )


async def test_stock_replacement_search_is_skipped_when_any_supplier_can_fulfill(
    tmp_path,
):
    digikey = ModeAwareStockClient(Supplier.DIGIKEY, exact_stock=0)
    mouser = ModeAwareStockClient(Supplier.MOUSER, exact_stock=100)
    service = SearchService(
        Settings(cache_path=tmp_path / "cache.sqlite3"),
        clients=[digikey, mouser],
        allowed_suppliers={Supplier.DIGIKEY, Supplier.MOUSER},
    )

    result = await service.search_component(stock_replacement_query())

    assert digikey.calls == 1
    assert mouser.calls == 1
    assert all(
        candidate.product.replacement_source
        != ReplacementSource.ENGINE_STOCK_FALLBACK
        for candidate in result.candidates
    )
    assert result.search_trace is not None
    assert result.search_trace.fallback_used is False


async def test_unverified_stock_does_not_trigger_stock_replacement_search(tmp_path):
    mouser = ModeAwareStockClient(Supplier.MOUSER, exact_stock=None)
    service = SearchService(
        Settings(cache_path=tmp_path / "cache.sqlite3"),
        clients=[mouser],
        allowed_suppliers={Supplier.MOUSER},
    )

    result = await service.search_component(stock_replacement_query())

    assert mouser.calls == 1
    assert result.procurement_decision is not None
    assert (
        result.procurement_decision.primary_unavailability_reason.value
        == "stock_unverified"
    )
    assert result.search_trace is not None
    assert result.search_trace.fallback_used is False


async def test_out_of_stock_with_insufficient_specs_adds_mpn_family_review_candidates(
    tmp_path,
):
    mouser = MpnFamilyStockClient(Supplier.MOUSER)
    service = SearchService(
        Settings(cache_path=tmp_path / "cache.sqlite3"),
        clients=[mouser],
        allowed_suppliers={Supplier.MOUSER},
    )

    result = await service.search_component(mpn_family_stock_query())
    cached = await service.search_component(mpn_family_stock_query())

    assert mouser.calls == 2
    replacements = [
        candidate
        for candidate in result.candidates
        if candidate.product.replacement_source
        == ReplacementSource.ENGINE_MPN_FALLBACK
    ]
    assert len(replacements) == 1
    assert replacements[0].product.manufacturer_part_number == "XAL6060-223MEB"
    assert replacements[0].product.manufacturer == "Coilcraft"
    assert replacements[0].decision.selection_eligibility.value == "manual_review"
    assert result.procurement_decision is not None
    assert result.procurement_decision.status == "review_recommended"
    assert result.procurement_decision.confirmation_required is True
    assert result.search_trace is not None
    assert result.search_trace.fallback_query == "XAL6060"
    assert result.search_trace.fallback_used is True
    assert any(
        attempt.stage == "stock_alternative"
        for attempt in result.search_trace.attempts
    )
    assert any("관리자 검토용" in warning for warning in result.warnings)
    assert cached.api_calls == 0
    assert any(
        candidate.product.replacement_source
        == ReplacementSource.ENGINE_MPN_FALLBACK
        for candidate in cached.candidates
    )


async def test_aggregate_out_of_stock_enriches_digikey_substitutions_before_spec_fallback(
    tmp_path,
):
    requests: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request.url.path)
        if request.url.path.endswith("/productdetails"):
            return httpx.Response(
                200,
                json={
                    "Product": {
                        "ProductId": 101,
                        "ManufacturerProductNumber": "ABC-123",
                        "Manufacturer": {"Name": "Acme"},
                        "Description": {
                            "ProductDescription": "10k Ohm 1% resistor 0603"
                        },
                        "ProductStatus": {"Status": "Active"},
                        "Parameters": [
                            {"ParameterText": "Resistance", "ValueText": "10 kOhms"},
                            {"ParameterText": "Tolerance", "ValueText": "±1%"},
                            {"ParameterText": "Package / Case", "ValueText": "0603"},
                        ],
                        "ProductVariations": [
                            {
                                "DigiKeyProductNumber": "ZERO-ND",
                                "QuantityAvailableforPackageType": 0,
                                "MinimumOrderQuantity": 1,
                                "StandardPricing": [
                                    {"BreakQuantity": 1, "UnitPrice": 100}
                                ],
                            }
                        ],
                    }
                },
            )
        if request.url.path.endswith("/substitutions"):
            return httpx.Response(
                200,
                json={
                    "ProductSubstitutes": [
                        {
                            "SubstituteType": "Direct",
                            "ManufacturerProductNumber": "ABC-ALT",
                            "Manufacturer": {"Name": "Acme"},
                            "Description": "10k Ohm 1% resistor 0603",
                            "DigiKeyProductNumber": "STOCK-ND",
                            "QuantityAvailable": 100,
                            "UnitPrice": "100",
                        }
                    ]
                },
            )
        raise AssertionError(f"unexpected DigiKey request: {request.url.path}")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        digikey = DigiKeyClient(
            client_id="client",
            client_secret="secret",
            account_id=None,
            client=http_client,
        )
        digikey._access_token = "test-token"
        digikey._token_expiry = time.time() + 3_600
        service = SearchService(
            Settings(cache_path=tmp_path / "cache.sqlite3"),
            clients=[digikey],
            allowed_suppliers={Supplier.DIGIKEY},
        )

        result = await service.search_component(stock_replacement_query())
        cached = await service.search_component(stock_replacement_query())

    assert requests == [
        "/products/v4/search/ABC-123/productdetails",
        "/products/v4/search/ZERO-ND/substitutions",
    ]
    assert result.api_calls == 2
    replacement = next(
        candidate
        for candidate in result.candidates
        if candidate.product.replacement_source
        == ReplacementSource.DIGIKEY_SUBSTITUTION
    )
    assert replacement.product.manufacturer_part_number == "ABC-ALT"
    assert replacement.decision.selection_eligibility.value == "manual_review"
    assert result.procurement_decision is not None
    assert result.procurement_decision.status == "review_recommended"
    assert result.search_trace is not None
    assert result.search_trace.fallback_used is False
    assert any(
        attempt.fallback_reason == "stock_unavailable"
        for attempt in result.search_trace.attempts
    )
    assert cached.api_calls == 0
    assert any(
        candidate.product.replacement_source
        == ReplacementSource.DIGIKEY_SUBSTITUTION
        for candidate in cached.candidates
    )


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


async def test_job_call_limit_has_distinct_error_and_trace_code(tmp_path):
    service = SearchService(
        Settings(
            cache_path=tmp_path / "cache.sqlite3",
            max_api_calls_per_job=1,
        ),
        clients=[
            FakeSupplierClient(Supplier.DIGIKEY, products=[make_product()]),
            FakeSupplierClient(Supplier.MOUSER, products=[make_product()]),
        ],
    )

    result = await service.search_component(service.planner.plan(make_component("limited")))

    limited = next(
        supplier
        for supplier in result.supplier_results
        if supplier.error_type == "job_call_limit_exhausted"
    )
    assert limited.search_attempts[0].outcome == "budget_exhausted"
    assert limited.search_attempts[0].error_type == "job_call_limit_exhausted"
    assert any("job_call_limit_exhausted" in warning for warning in result.warnings)


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


async def test_batch_timeout_uses_stale_cache_instead_of_discarding_candidates(
    tmp_path,
):
    fake = FakeDigiKeyClient(delay=0.2, products=[make_product()])
    service = SearchService(
        Settings(
            cache_path=tmp_path / "cache.sqlite3",
            job_timeout_seconds=0.02,
        ),
        clients=[fake],
    )
    query = service.planner.plan(make_component("a"))
    namespace, cache_key = supplier_cache_coordinates(fake, query)
    cached_raw = RawSupplierResponse(
        supplier=Supplier.DIGIKEY,
        ok=True,
        status_code=200,
        payload={"hit": True},
    )
    service.cache.put(
        namespace,
        cache_key,
        cached_raw.model_dump(mode="json"),
        ttl_seconds=1,
        stale_ttl_seconds=3_600,
        now=time.time() - 10,
    )
    source = make_batch().model_copy(
        update={"components": [make_component("a")]}
    )

    result = await service.search_batch(source)

    component = result.components[0]
    supplier = component.supplier_results[0]
    assert component.status == MatchStatus.VERIFIED_EXACT
    assert supplier.cache_state == "stale"
    assert supplier.error_type is None
    assert all(
        item.error_type != "job_timeout"
        for item in component.supplier_results
    )
    assert any("사용 가능한 캐시 결과" in warning for warning in component.warnings)


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

        async def _prefetch_mouser_exact(self, plans, job_budget, *, barriers):
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


async def test_batch_result_keeps_supplier_technical_top_three_without_raw_products(tmp_path):
    products = [
        make_product().model_copy(update={"manufacturer_part_number": f"ABC-123-{index}"})
        for index in range(6)
    ]
    fake = FakeDigiKeyClient(products=products)
    service = SearchService(Settings(cache_path=tmp_path / "cache.sqlite3"), clients=[fake])

    result = await service.search_batch(make_batch())

    assert len(result.components[0].candidates) == 3
    assert all(candidate.decision.identity_key for candidate in result.components[0].candidates)
    assert result.components[0].supplier_results[0].products == []
    assert any(
        "기술 상위 3개와 가격 상위 2개 그룹" in warning
        for warning in result.components[0].warnings
    )


def test_default_supplier_pool_limits_unikeyic_to_technical_top_ten():
    query = PlannedQuery(
        component_id="unikeyic-pool",
        mode=SearchMode.PARAMETRIC,
        part_type="resistor",
        keywords="ABC",
        limit=10,
    )
    products = [
        make_product().model_copy(
            update={
                "supplier": Supplier.UNIKEYIC,
                "manufacturer_part_number": f"ABC-{index:02d}",
            }
        )
        for index in range(12)
    ]
    candidates = finalize_candidate_decisions(
        query,
        [CandidateMatcher().evaluate(query, product) for product in products],
    )

    retained, omitted = SearchService._retain_supplier_technical_top_groups(
        query,
        candidates,
        limit=query.limit,
    )

    assert query.limit == 10
    assert len(retained) == 10
    assert omitted == 2
    assert {
        candidate.product.manufacturer_part_number for candidate in retained
    } == {f"ABC-{index:02d}" for index in range(10)}


def test_supplier_top_groups_preserve_all_offers_for_a_retained_identity():
    query = PlannedQuery(
        component_id="supplier-union",
        mode=SearchMode.IDENTITY,
        part_number="ABC",
        keywords="ABC",
    )
    digikey_products = [
        make_product().model_copy(update={"manufacturer_part_number": f"ABC-{index}"})
        for index in range(7)
    ]
    mouser_product = make_product().model_copy(
        update={
            "supplier": Supplier.MOUSER,
            "manufacturer_part_number": "ABC-5",
        }
    )
    candidates = finalize_candidate_decisions(
        query,
        [
            CandidateMatcher().evaluate(query, product)
            for product in [*digikey_products, mouser_product]
        ],
    )

    retained, omitted = SearchService._retain_supplier_technical_top_groups(
        query, candidates
    )

    assert omitted == 3
    assert {candidate.product.manufacturer_part_number for candidate in retained} == {
        "ABC-0",
        "ABC-1",
        "ABC-2",
        "ABC-5",
    }
    assert [
        candidate.product.supplier
        for candidate in retained
        if candidate.product.manufacturer_part_number == "ABC-5"
    ] == [Supplier.DIGIKEY, Supplier.MOUSER]


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
