import parts_engine_app.refresh as refresh_module
from parts_engine_app.config import Config
from parts_engine_app.refresh import (
    _catalog_mpn_fallback_term,
    _catalog_search_batch,
    _combine_catalog_search_results,
    _single_part_batch,
    search_catalog,
)
from supplier_search_engine.matcher import (
    CandidateMatcher,
    finalize_candidate_decisions,
)
from supplier_search_engine.models import (
    BatchSearchResult,
    ComponentSearchResult,
    MatchStatus,
    ProcurementPolicyInput,
    Supplier,
    SupplierProduct,
)
from supplier_search_engine.planner import QueryPlanner
from supplier_search_engine.procurement import apply_procurement_decisions
from supplier_search_engine.service import SearchService


def test_catalog_search_batch_preserves_exact_capacitance_and_voltage_specs():
    batch = _catalog_search_batch("560nF 16V", 150)

    assert len(batch.components) == 1
    component = batch.components[0]
    assert component.fields["part_type"].value == "capacitor"
    assert component.fields["capacitance"].normalized_value == 560e-9
    assert component.fields["voltage"].normalized_value == 16.0
    assert component.fields["part_number"].value is None
    assert component.fields["quantity"].value == 150
    assert component.required_quantity == 150


def test_catalog_search_batch_keeps_plain_text_as_identity_search():
    batch = _catalog_search_batch("GRM155R71C104KA88D")

    component = batch.components[0]
    assert component.fields["part_number"].value == "GRM155R71C104KA88D"
    assert component.fields["part_number"].status == "extracted"


def test_catalog_mpn_fallback_accepts_embedded_spec_like_mpn_tokens():
    assert _catalog_mpn_fallback_term("ECH350V-03P") == "ECH350V-03P"
    assert _catalog_mpn_fallback_term("AP2114H-3.3") == "AP2114H-3.3"
    assert _catalog_mpn_fallback_term("RC0603FR-0710KL") == "RC0603FR-0710KL"
    assert _catalog_mpn_fallback_term("1N4007") == "1N4007"


def test_catalog_mpn_fallback_rejects_plain_specs_and_packages():
    rejected = [
        "100nF",
        "100n-16V-0603",
        "10K",
        "10K-0603",
        "4R7",
        "25V",
        "0.1W",
        "1%",
        "0603",
        "0603/1608",
        "SOT-23-6",
        "RJ45",
    ]

    assert all(_catalog_mpn_fallback_term(query) is None for query in rejected)


def _batch_result(
    batch,
    *,
    product_mpn: str | None,
    status: MatchStatus,
    api_calls: int,
) -> BatchSearchResult:
    query = QueryPlanner().plan(batch.components[0])
    candidates = []
    if product_mpn is not None:
        candidate = CandidateMatcher().evaluate(
            query,
            SupplierProduct(
                supplier=Supplier.DIGIKEY,
                manufacturer_part_number=product_mpn,
                manufacturer="Dinkle",
            ),
        )
        candidates = finalize_candidate_decisions(query, [candidate])
        candidates = SearchService._add_corroboration(candidates)
        candidates = SearchService._assign_technical_review_ranks(query, candidates)
        candidates = SearchService._assign_selection_recommendations(candidates, query)
    candidates, procurement_decision = apply_procurement_decisions(
        query,
        candidates,
        batch.procurement_policy,
    )
    return BatchSearchResult(
        procurement_policy=batch.procurement_policy,
        source_file=batch.source_file,
        components=[
            ComponentSearchResult(
                component_id=query.component_id,
                mode=query.mode,
                status=candidates[0].status if candidates else status,
                query=query,
                candidates=candidates,
                procurement_decision=procurement_decision,
                api_calls=api_calls,
            )
        ],
        unique_query_count=1,
        api_calls=api_calls,
        cache_hits=0,
    )


async def test_catalog_search_retries_no_result_as_exact_mpn_with_remaining_budget(
    monkeypatch,
    tmp_path,
):
    primary_batch = _catalog_search_batch("ECH350V-03P")
    primary = _batch_result(
        primary_batch,
        product_mpn=None,
        status=MatchStatus.INSUFFICIENT_INPUT,
        api_calls=5,
    )
    fallback_batch = _single_part_batch(
        "ECH350V-03P",
        None,
        needed=3,
        source_file="catalog-search",
    )
    fallback = _batch_result(
        fallback_batch,
        product_mpn="ECH350V-03P",
        status=MatchStatus.NOT_FOUND,
        api_calls=1,
    )

    class FakeSearchService:
        results = [primary, fallback]
        batches = []
        call_limits = []

        def __init__(self, settings, *, cache):
            del cache
            self.settings = settings

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def search_batch(self, batch):
            self.batches.append(batch)
            self.call_limits.append(self.settings.max_api_calls_per_job)
            return self.results.pop(0)

    monkeypatch.setattr(refresh_module, "SearchService", FakeSearchService)
    config = Config(
        data_dir=tmp_path,
        m2v_path="off",
        component_limit=5000,
        max_upload_bytes=30 * 1024 * 1024,
        supplier_max_calls=700,
    )

    response = await search_catalog(
        config,
        "ECH350V-03P",
        needed=3,
        max_calls=12,
        procurement_policy=ProcurementPolicyInput(),
    )

    assert FakeSearchService.call_limits == [12, 7]
    assert len(FakeSearchService.batches) == 2
    fallback_component = FakeSearchService.batches[1].components[0]
    assert fallback_component.fields["part_number"].value == "ECH350V-03P"
    assert fallback_component.required_quantity == 3
    result = response["search"]
    assert result["api_calls"] == 6
    assert result["components"][0]["query"]["mode"] == "identity"
    assert (
        result["components"][0]["candidates"][0]["product"][
            "manufacturer_part_number"
        ]
        == "ECH350V-03P"
    )


def test_catalog_exact_mpn_fallback_rejects_neighbor_part_numbers():
    primary_batch = _catalog_search_batch("ECH350V-03P")
    primary = _batch_result(
        primary_batch,
        product_mpn=None,
        status=MatchStatus.INSUFFICIENT_INPUT,
        api_calls=0,
    )
    fallback_batch = _single_part_batch(
        "ECH350V-03P",
        None,
        needed=1,
        source_file="catalog-search",
    )
    fallback = _batch_result(
        fallback_batch,
        product_mpn="ECH350V-04P",
        status=MatchStatus.NOT_FOUND,
        api_calls=2,
    )

    result = _combine_catalog_search_results(
        primary,
        fallback,
        "ECH350V-03P",
    )

    assert result.api_calls == 2
    assert result.components[0].candidates == []
    assert result.components[0].status == MatchStatus.INSUFFICIENT_INPUT
