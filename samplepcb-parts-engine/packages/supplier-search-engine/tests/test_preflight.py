from __future__ import annotations

import time

from supplier_search_engine.contract import SearchBatchInput

from supplier_search_engine.models import RawSupplierResponse, Supplier
from supplier_search_engine.request_cache import supplier_cache_coordinates
from supplier_search_engine.service import SearchService
from supplier_search_engine.settings import QuotaLimit, Settings

from test_service_cache import FakeDigiKeyClient, make_component, make_product


def batch(*components) -> SearchBatchInput:
    return SearchBatchInput(
        parser_schema_version="1",
        parser_version="test",
        training_fingerprint="test",
        source_file="bom.xlsx",
        components=list(components),
    )


def test_preflight_deduplicates_supplier_request_but_preserves_distinct_local_checks(tmp_path):
    fake = FakeDigiKeyClient(products=[make_product()])
    settings = Settings(
        cache_path=tmp_path / "cache.sqlite3",
        quotas={Supplier.DIGIKEY: QuotaLimit(daily=10, per_minute=5)},
    )
    service = SearchService(settings, clients=[fake])
    source = batch(
        make_component("matches", resistance="10kΩ"),
        make_component("conflicts", resistance="1kΩ"),
    )

    result = service.preflight_batch(source)

    assert fake.calls == 0
    assert result.unique_query_count == 2
    assert result.unique_supplier_request_count == 3
    assert result.estimated_api_calls == 1
    assert result.retry_worst_case_api_calls == 3
    digikey = result.components[0].suppliers[0]
    assert digikey.shared_component_count == 2
    assert digikey.reason == "cache_miss"
    budget = next(item for item in result.supplier_budgets if item.supplier == Supplier.DIGIKEY)
    assert budget.estimated_calls == 1
    assert budget.daily_remaining == 10


def test_preflight_preserves_each_components_source_identity(tmp_path):
    first = make_component("first")
    first.reference_designators = ["R1"]
    first.source_rows_1based = [2]
    second = make_component("second", resistance="1kΩ")
    second.reference_designators = ["R2"]
    second.source_rows_1based = [3]
    service = SearchService(Settings(cache_path=tmp_path / "cache.sqlite3"), clients=[])

    result = service.preflight_batch(batch(first, second))

    assert [component.reference_designators for component in result.components] == [["R1"], ["R2"]]
    assert [component.source_rows_1based for component in result.components] == [[2], [3]]


def test_preflight_recognizes_fresh_negative_or_positive_raw_cache(tmp_path):
    fake = FakeDigiKeyClient(products=[make_product()])
    service = SearchService(Settings(cache_path=tmp_path / "cache.sqlite3"), clients=[fake])
    source = batch(make_component("a"))
    query = service.planner.plan(source.components[0])
    namespace, key = supplier_cache_coordinates(fake, query)
    raw = RawSupplierResponse(supplier=Supplier.DIGIKEY, ok=True, status_code=200, payload={"hit": True})
    service.cache.put(namespace, key, raw.model_dump(mode="json"), ttl_seconds=60)

    result = service.preflight_batch(source)

    digikey = result.components[0].suppliers[0]
    assert result.fresh_cache_requests == 1
    assert result.estimated_api_calls == 0
    assert digikey.cache_state == "fresh"
    assert digikey.usable_without_api is True


def test_preflight_cache_only_never_projects_supplier_calls(tmp_path):
    fake = FakeDigiKeyClient(products=[make_product()])
    settings = Settings(cache_path=tmp_path / "cache.sqlite3", cache_only=True)
    service = SearchService(settings, clients=[fake])

    result = service.preflight_batch(batch(make_component("a")))

    assert result.estimated_api_calls == 0
    assert result.retry_worst_case_api_calls == 0
    assert result.uncallable_requests == 3
    assert all(not item.will_call_api for item in result.components[0].suppliers)


def test_preflight_cache_only_uses_stale_entry_without_refresh(tmp_path):
    fake = FakeDigiKeyClient(products=[make_product()])
    settings = Settings(cache_path=tmp_path / "cache.sqlite3", cache_only=True)
    service = SearchService(settings, clients=[fake])
    source = batch(make_component("a"))
    query = service.planner.plan(source.components[0])
    namespace, key = supplier_cache_coordinates(fake, query)
    raw = RawSupplierResponse(supplier=Supplier.DIGIKEY, ok=True, payload={"hit": True})
    service.cache.put(
        namespace,
        key,
        raw.model_dump(mode="json"),
        ttl_seconds=1,
        stale_ttl_seconds=60,
        now=time.time() - 5,
    )

    result = service.preflight_batch(source)

    digikey = result.components[0].suppliers[0]
    assert digikey.cache_state == "stale"
    assert digikey.reason == "stale_cache_fallback"
    assert digikey.usable_without_api is True
    assert digikey.estimated_api_calls == 0


def test_preflight_treats_schema_corrupt_cache_as_miss(tmp_path):
    fake = FakeDigiKeyClient(products=[make_product()])
    service = SearchService(Settings(cache_path=tmp_path / "cache.sqlite3"), clients=[fake])
    source = batch(make_component("a"))
    query = service.planner.plan(source.components[0])
    namespace, key = supplier_cache_coordinates(fake, query)
    service.cache.put(namespace, key, {"not": "a raw response"}, ttl_seconds=60)

    result = service.preflight_batch(source)

    digikey = result.components[0].suppliers[0]
    assert digikey.cache_state == "miss"
    assert digikey.will_call_api is True
    assert result.estimated_api_calls == 1
