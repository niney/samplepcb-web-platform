from __future__ import annotations

import json
import time
from collections.abc import Awaitable, Callable

import httpx

from supplier_search_engine.models import (
    PlannedQuery,
    RawSupplierResponse,
    Requirement,
    SearchMode,
    Supplier,
    SupplierProduct,
)
from supplier_search_engine.service import SearchService
from supplier_search_engine.settings import Settings
from supplier_search_engine.suppliers.base import SupplierClient
from supplier_search_engine.suppliers.digikey import DigiKeyClient
from supplier_search_engine.suppliers.mouser import MouserClient


def requirement(name: str, value: float | str) -> Requirement:
    return Requirement(
        name=name,
        raw_value=value,
        normalized_value=value,
        status="extracted",
        hard=True,
    )


def test_supplier_trace_bounds_query_without_changing_request_input() -> None:
    query = "Q" * 600

    traced = SupplierClient.traced_response(
        RawSupplierResponse(
            supplier=Supplier.DIGIKEY,
            ok=True,
            status_code=200,
        ),
        strategy="identity_exact",
        query=query,
        result_count=0,
    )

    assert query == "Q" * 600
    assert traced.request_trace[0].query == "Q" * 500


async def test_mouser_preserves_exact_then_keyword_attempts() -> None:
    requests: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(json.loads(request.content))
        if len(requests) == 1:
            return httpx.Response(200, json={"SearchResults": {"Parts": []}})
        return httpx.Response(
            200,
            json={
                "SearchResults": {
                    "Parts": [
                        {
                            "ManufacturerPartNumber": "ABC-123",
                            "Manufacturer": "Acme",
                        }
                    ]
                }
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        client = MouserClient(api_key="secret-key-not-for-trace", client=http_client)
        raw = await client.fetch(
            PlannedQuery(
                component_id="c1",
                mode=SearchMode.IDENTITY,
                part_number="ABC-123",
                manufacturer="Acme",
                keywords="ABC-123 Acme",
            )
        )

    assert [attempt.strategy for attempt in raw.request_trace] == [
        "identity_exact",
        "identity_keyword",
    ]
    assert [attempt.query for attempt in raw.request_trace] == ["ABC-123", "ABC-123"]
    assert [attempt.outcome for attempt in raw.request_trace] == ["empty", "results"]
    assert raw.request_trace[1].fallback_reason == "exact_no_result"
    assert "secret-key-not-for-trace" not in raw.model_dump_json()


async def test_digikey_preserves_full_then_core_parametric_attempts() -> None:
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        bodies.append(body)
        if len(bodies) == 1:
            return httpx.Response(200, json={"Products": []})
        return httpx.Response(
            200,
            json={
                "Products": [
                    {
                        "ManufacturerProductNumber": "CAP-1",
                        "Manufacturer": {"Name": "Acme"},
                    }
                ]
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        client = DigiKeyClient(
            client_id="client-id-not-for-trace",
            client_secret="client-secret-not-for-trace",
            account_id=None,
            client=http_client,
        )
        client._access_token = "test-token"
        client._token_expiry = time.time() + 600
        raw = await client.fetch(
            PlannedQuery(
                component_id="c1",
                mode=SearchMode.PARAMETRIC,
                part_type="capacitor",
                package="0603",
                keywords="1uF 0603",
                requirements={
                    "capacitance_f": requirement("capacitance_f", 1e-6),
                    "voltage_v": requirement("voltage_v", 16.0),
                    "package": requirement("package", "0603"),
                },
            )
        )

    assert [attempt.strategy for attempt in raw.request_trace] == [
        "parametric_full",
        "parametric_core",
    ]
    assert raw.request_trace[0].query == "1uF 16V 0603"
    assert raw.request_trace[1].query == "1uF 0603"
    assert raw.request_trace[1].fallback_reason == "no_verified_candidate"
    serialized = raw.model_dump_json()
    assert "client-id-not-for-trace" not in serialized
    assert "client-secret-not-for-trace" not in serialized
    assert "test-token" not in serialized


class TracedSupplierClient(SupplierClient):
    supplier = Supplier.DIGIKEY
    api_version = "trace-test-v1"

    def __init__(self) -> None:
        self.calls = 0

    @property
    def configured(self) -> bool:
        return True

    async def fetch(
        self,
        query: PlannedQuery,
        reserve_call: Callable[[], Awaitable[None]] | None = None,
    ) -> RawSupplierResponse:
        if reserve_call is not None:
            await reserve_call()
        self.calls += 1
        has_result = query.mode == SearchMode.PARAMETRIC
        raw = RawSupplierResponse(
            supplier=self.supplier,
            ok=True,
            status_code=200,
            payload={"has_result": has_result},
            latency_ms=5.0,
            http_attempt_count=1,
        )
        return self.traced_response(
            raw,
            strategy=("identity_exact" if query.mode == SearchMode.IDENTITY else "parametric_full"),
            query=query.part_number or query.keywords,
            result_count=int(has_result),
        )

    def normalize(
        self,
        raw: RawSupplierResponse,
        query: PlannedQuery,
    ) -> list[SupplierProduct]:
        if not (raw.payload or {}).get("has_result"):
            return []
        return [
            SupplierProduct(
                supplier=self.supplier,
                manufacturer_part_number="REPLACEMENT-1",
                manufacturer="Acme",
                package="0603",
                normalized_specs={"resistance_ohm": 1_000.0},
            )
        ]

    async def close(self) -> None:
        return None


async def test_component_trace_connects_identity_and_spec_fallback(tmp_path) -> None:
    client = TracedSupplierClient()
    service = SearchService(
        Settings(cache_path=tmp_path / "cache.sqlite3"),
        clients=[client],
    )
    query = PlannedQuery(
        component_id="c1",
        mode=SearchMode.IDENTITY,
        part_number="UNKNOWN-1",
        part_type="resistor",
        package="0603",
        keywords="UNKNOWN-1",
        requirements={
            "resistance_ohm": requirement("resistance_ohm", 1_000.0),
            "package": requirement("package", "0603"),
        },
    )

    result = await service.search_component(query)

    assert result.identity_fallback is True
    assert result.search_trace is not None
    assert result.search_trace.primary_query == "UNKNOWN-1"
    assert result.search_trace.fallback_query == "1k 0603"
    assert result.search_trace.fallback_used is True
    traced_attempts = [
        attempt
        for attempt in result.search_trace.attempts
        if attempt.supplier == Supplier.DIGIKEY
    ]
    assert [attempt.stage for attempt in traced_attempts] == [
        "primary",
        "identity_fallback",
    ]
    assert [attempt.strategy for attempt in traced_attempts] == [
        "identity_exact",
        "parametric_full",
    ]
    assert traced_attempts[0].sequence < traced_attempts[1].sequence


async def test_cached_trace_reports_cache_source_without_new_api_calls(tmp_path) -> None:
    client = TracedSupplierClient()
    service = SearchService(
        Settings(cache_path=tmp_path / "cache.sqlite3"),
        clients=[client],
    )
    query = PlannedQuery(
        component_id="c1",
        mode=SearchMode.PARAMETRIC,
        part_type="resistor",
        package="0603",
        keywords="1k 0603",
        requirements={
            "resistance_ohm": requirement("resistance_ohm", 1_000.0),
            "package": requirement("package", "0603"),
        },
    )

    first = await service.search_component(query)
    second = await service.search_component(query)

    assert first.search_trace is not None
    assert second.search_trace is not None
    first_attempt = next(
        attempt
        for attempt in first.search_trace.attempts
        if attempt.supplier == Supplier.DIGIKEY
    )
    second_attempt = next(
        attempt
        for attempt in second.search_trace.attempts
        if attempt.supplier == Supplier.DIGIKEY
    )
    assert first_attempt.source == "live_api"
    assert first_attempt.api_calls == 1
    assert second_attempt.source == "fresh_cache"
    assert second_attempt.api_calls == 0
    assert client.calls == 1
