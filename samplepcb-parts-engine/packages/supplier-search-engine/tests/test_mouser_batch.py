from __future__ import annotations

import json

import httpx

from supplier_search_engine.contract import SearchBatchInput

from supplier_search_engine.models import Supplier
from supplier_search_engine.service import SearchService
from supplier_search_engine.settings import Settings
from supplier_search_engine.suppliers.mouser import MouserClient

from test_service_cache import make_component


def component(component_id: str, part_number: str):
    item = make_component(component_id)
    item.fields["part_number"].value = part_number
    return item


def batch() -> SearchBatchInput:
    return SearchBatchInput(
        parser_schema_version="1",
        parser_version="test",
        training_fingerprint="test",
        source_file="bom.xlsx",
        components=[component("a", "ABC-1"), component("b", "ABC-2")],
    )


def part(mpn: str) -> dict:
    return {
        "ManufacturerPartNumber": mpn,
        "Manufacturer": "Acme",
        "Description": f"{mpn} component",
    }


async def test_mouser_batch_prefetch_reduces_two_exact_parts_to_one_call(tmp_path):
    requests: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={"SearchResults": {"Parts": [part("ABC-1"), part("ABC-2")]}},
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        mouser = MouserClient(api_key="not-a-real-key", client=http_client)
        service = SearchService(
            Settings(cache_path=tmp_path / "cache.sqlite3"),
            clients=[mouser],
        )
        result = await service.search_batch(batch())

    assert len(requests) == 1
    assert requests[0]["SearchByPartRequest"]["mouserPartNumber"] == "ABC-1|ABC-2"
    assert result.api_calls == 1
    assert result.prefetched_requests == 2
    assert result.cache_hits == 2
    assert [component.status.value for component in result.components] == [
        "verified_exact",
        "verified_exact",
    ]
    assert all(
        next(item for item in component.supplier_results if item.supplier == Supplier.MOUSER).cache_state
        == "fresh"
        for component in result.components
    )


async def test_mouser_batch_uses_keyword_only_for_part_missing_from_batch(tmp_path):
    paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        if len(paths) == 1:
            return httpx.Response(200, json={"SearchResults": {"Parts": [part("ABC-1")]}})
        return httpx.Response(200, json={"SearchResults": {"Parts": [part("ABC-2")]}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        mouser = MouserClient(api_key="not-a-real-key", client=http_client)
        service = SearchService(
            Settings(cache_path=tmp_path / "cache.sqlite3"),
            clients=[mouser],
        )
        result = await service.search_batch(batch())

    assert paths == ["/api/v1/search/partnumber", "/api/v2/search/keywordandmanufacturer"]
    assert result.api_calls == 2
    assert result.prefetched_requests == 2


def test_preflight_projects_one_batch_plus_conditional_keyword_per_part(tmp_path):
    mouser = MouserClient(api_key="not-a-real-key")
    service = SearchService(
        Settings(cache_path=tmp_path / "cache.sqlite3"),
        clients=[mouser],
    )

    result = service.preflight_batch(batch())

    budget = next(item for item in result.supplier_budgets if item.supplier == Supplier.MOUSER)
    assert budget.estimated_calls == 3
    assert budget.retry_worst_case_calls == 15
    mouser_plans = [
        next(item for item in component.suppliers if item.supplier == Supplier.MOUSER)
        for component in result.components
    ]
    assert [item.estimated_api_calls for item in mouser_plans] == [2, 1]
    assert [item.retry_worst_case_api_calls for item in mouser_plans] == [9, 6]
    assert all(item.batch_size == 2 for item in mouser_plans)


def test_preflight_single_mouser_part_projects_exact_keyword_without_batch(tmp_path):
    mouser = MouserClient(api_key="not-a-real-key")
    service = SearchService(
        Settings(cache_path=tmp_path / "cache.sqlite3"),
        clients=[mouser],
    )
    source = batch().model_copy(update={"components": [component("a", "ABC-1")]})

    result = service.preflight_batch(source)

    plan = next(
        item for item in result.components[0].suppliers if item.supplier == Supplier.MOUSER
    )
    assert plan.batch_size == 1
    assert plan.estimated_api_calls == 2
    assert plan.retry_worst_case_api_calls == 6
    assert plan.reason == "cache_miss"
