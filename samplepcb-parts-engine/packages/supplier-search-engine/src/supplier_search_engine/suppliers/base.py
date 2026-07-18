from __future__ import annotations

import asyncio
import hashlib
import random
import time
from abc import ABC, abstractmethod
from email.utils import parsedate_to_datetime
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from ..models import PlannedQuery, RawSupplierResponse, SearchMode, Supplier, SupplierProduct


class SupplierClient(ABC):
    supplier: Supplier
    api_version: str
    normalizer_version: str = "1"

    def __init__(self, *, client: httpx.AsyncClient | None = None, timeout_seconds: float = 8.0) -> None:
        self._owns_client = client is None
        self.client = client or httpx.AsyncClient(timeout=timeout_seconds)

    @property
    @abstractmethod
    def configured(self) -> bool: ...

    @abstractmethod
    async def fetch(
        self,
        query: PlannedQuery,
        reserve_call: Callable[[], Awaitable[None]] | None = None,
    ) -> RawSupplierResponse: ...

    @abstractmethod
    def normalize(self, raw: RawSupplierResponse, query: PlannedQuery) -> list[SupplierProduct]: ...

    async def close(self) -> None:
        if self._owns_client:
            await self.client.aclose()

    @property
    def cache_scope(self) -> str:
        return "default"

    @staticmethod
    def opaque_cache_scope(*parts: str | None) -> str:
        """Separate accounts/endpoints without persisting credentials in clear text."""
        value = "\0".join(part or "" for part in parts).encode("utf-8")
        return hashlib.sha256(value).hexdigest()[:16]

    def cache_payload(self, query: PlannedQuery) -> dict[str, Any]:
        """Only fields that can change the supplier request belong in the raw-cache key."""
        if query.mode == SearchMode.IDENTITY and query.part_number:
            return {
                "mode": query.mode.value,
                "part_number": query.part_number,
                "manufacturer": query.manufacturer,
                "site": query.site,
                "language": query.language,
                "currency": query.currency,
            }
        return {
            "mode": query.mode.value,
            "part_number": query.part_number,
            "manufacturer": query.manufacturer,
            "keywords": query.keywords,
            "part_type": query.part_type,
            "site": query.site,
            "language": query.language,
            "currency": query.currency,
            "limit": query.limit,
        }

    def planned_api_calls(self, query: PlannedQuery) -> int:
        return 1

    def retry_worst_case_api_calls(self, query: PlannedQuery) -> int:
        return 3

    async def _request_json(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        form: dict[str, Any] | None = None,
        retries: int = 2,
        reserve_call: Callable[[], Awaitable[None]] | None = None,
    ) -> RawSupplierResponse:
        started = time.perf_counter()
        last_error: Exception | None = None
        for attempt in range(retries + 1):
            if reserve_call is not None:
                await reserve_call()
            try:
                response = await self.client.request(
                    method,
                    url,
                    headers=headers,
                    params=params,
                    json=json_body,
                    data=form,
                )
                if response.status_code not in {429, 500, 502, 503, 504}:
                    if response.is_success:
                        return RawSupplierResponse(
                            supplier=self.supplier,
                            ok=True,
                            status_code=response.status_code,
                            payload=response.json(),
                            latency_ms=(time.perf_counter() - started) * 1_000,
                        )
                    return RawSupplierResponse(
                        supplier=self.supplier,
                        ok=False,
                        status_code=response.status_code,
                        error_type=f"http_{response.status_code}",
                        error_message="supplier request rejected",
                        latency_ms=(time.perf_counter() - started) * 1_000,
                    )
                if attempt < retries:
                    await asyncio.sleep(self._retry_delay(response.headers.get("Retry-After"), attempt))
                    continue
                return RawSupplierResponse(
                    supplier=self.supplier,
                    ok=False,
                    status_code=response.status_code,
                    error_type=f"http_{response.status_code}",
                    error_message="supplier temporarily unavailable or rate limited",
                    latency_ms=(time.perf_counter() - started) * 1_000,
                )
            except (httpx.TimeoutException, httpx.TransportError, ValueError) as exc:
                last_error = exc
                if attempt < retries:
                    await asyncio.sleep((0.2 * (2**attempt)) + random.random() * 0.1)
        return RawSupplierResponse(
            supplier=self.supplier,
            ok=False,
            error_type=type(last_error).__name__ if last_error else "request_error",
            error_message="supplier request failed",
            latency_ms=(time.perf_counter() - started) * 1_000,
        )

    @staticmethod
    def _retry_delay(retry_after: str | None, attempt: int) -> float:
        if retry_after:
            try:
                return min(max(float(retry_after), 0.0), 30.0)
            except ValueError:
                try:
                    return min(max((parsedate_to_datetime(retry_after).timestamp() - time.time()), 0.0), 30.0)
                except (TypeError, ValueError, OverflowError):
                    pass
        return (0.25 * (2**attempt)) + random.random() * 0.1
