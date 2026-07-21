from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from ..matcher import CandidateMatcher
from ..models import (
    ManufacturerEvidence,
    MatchStatus,
    PlannedQuery,
    RawSupplierResponse,
    SearchMode,
    Supplier,
    SupplierOffer,
    SupplierProduct,
)
from ..normalization import (
    compact_mpn,
    normalized_specs_from_parameters,
    normalized_specs_from_text,
)
from ..pricing import valid_price_break
from ..supplier_query import supplier_core_keywords, supplier_spec_keywords
from .base import SupplierClient


_LEADING_INTEGER = re.compile(r"\d+")


class MouserClient(SupplierClient):
    supplier = Supplier.MOUSER
    api_version = "search-v1-v2"
    normalizer_version = "2"

    def __init__(
        self,
        *,
        api_key: str | None,
        base_url: str = "https://api.mouser.com",
        client: httpx.AsyncClient | None = None,
        timeout_seconds: float = 8.0,
    ) -> None:
        super().__init__(client=client, timeout_seconds=timeout_seconds)
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self._matcher = CandidateMatcher()

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    @property
    def cache_scope(self) -> str:
        return self.opaque_cache_scope(self.base_url, self.api_key)

    def cache_payload(self, query: PlannedQuery) -> dict[str, Any]:
        payload = super().cache_payload(query)
        if query.mode == SearchMode.IDENTITY and query.part_number:
            payload["strategy"] = "exact-keyword-fallback-v2"
        elif query.mode == SearchMode.PARAMETRIC:
            payload.update(
                {
                    "strategy": "parametric-full-core-v3",
                    "preferred_keywords": supplier_spec_keywords(
                        query,
                        Supplier.MOUSER,
                    ),
                    "core_keywords": supplier_core_keywords(
                        query,
                        Supplier.MOUSER,
                    ),
                }
            )
        return payload

    def planned_api_calls(self, query: PlannedQuery) -> int:
        return 2 if query.mode in {SearchMode.IDENTITY, SearchMode.PARAMETRIC} else 1

    def retry_worst_case_api_calls(self, query: PlannedQuery) -> int:
        return 6 if query.mode in {SearchMode.IDENTITY, SearchMode.PARAMETRIC} else 3

    async def fetch(
        self,
        query: PlannedQuery,
        reserve_call: Callable[[], Awaitable[None]] | None = None,
    ) -> RawSupplierResponse:
        if not self.configured:
            return RawSupplierResponse(
                supplier=self.supplier,
                ok=False,
                error_type="not_configured",
                error_message="Mouser API key is not configured",
            )
        is_identity = query.mode == SearchMode.IDENTITY and bool(query.part_number)
        is_parametric = query.mode == SearchMode.PARAMETRIC
        preferred_keywords = (
            supplier_spec_keywords(query, Supplier.MOUSER)
            if is_parametric
            else query.keywords
        )
        if is_identity:
            if query.manufacturer:
                path = "/api/v2/search/partnumberandmanufacturer"
                root = "SearchByPartMfrNameRequest"
                request = {
                    "mouserPartNumber": query.part_number,
                    "manufacturerName": query.manufacturer,
                    "partSearchOptions": "Exact",
                }
            else:
                path = "/api/v1/search/partnumber"
                root = "SearchByPartRequest"
                request = {"mouserPartNumber": query.part_number, "partSearchOptions": "Exact"}
        elif query.manufacturer:
            path = "/api/v2/search/keywordandmanufacturer"
            root = "SearchByKeywordMfrNameRequest"
            request = {
                "manufacturerName": query.manufacturer,
                "keyword": preferred_keywords,
                "records": min(max(query.limit, 1), 50),
                "pageNumber": 1,
                "searchOptions": "",
                "searchWithYourSignUpLanguage": "true",
            }
        else:
            path = "/api/v1/search/keyword"
            root = "SearchByKeywordRequest"
            request = {
                "keyword": preferred_keywords,
                "records": min(max(query.limit, 1), 50),
                "startingRecord": 0,
                "searchOptions": "",
                "searchWithYourSignUpLanguage": "true",
            }
        raw = await self._request_json(
            "POST",
            f"{self.base_url}{path}",
            params={"apiKey": self.api_key},
            json_body={root: request},
            reserve_call=reserve_call,
        )
        strategy = (
            "identity_exact"
            if is_identity
            else "parametric_full"
            if is_parametric
            else "keyword"
        )
        trace_query = query.part_number if is_identity else preferred_keywords
        raw = self.traced_response(
            raw,
            strategy=strategy,
            query=trace_query or "",
            result_count=self._part_count(raw),
        )
        if is_parametric and raw.ok and not self._has_verified_candidate(query, raw):
            core_keywords = supplier_core_keywords(query, Supplier.MOUSER)
            if core_keywords != preferred_keywords:
                fallback = await self.fetch_keyword(
                    query,
                    reserve_call,
                    keywords=core_keywords,
                    strategy="parametric_core",
                    fallback_reason="no_verified_candidate",
                )
                if fallback.ok and self._has_parts(fallback):
                    return self._merge_keyword_responses(raw, fallback)
                return self._with_additional_attempts(raw, fallback)
        if not is_identity or not raw.ok or self._has_parts(raw):
            return raw
        fallback = await self.fetch_keyword(
            query,
            reserve_call,
            strategy="identity_keyword",
            fallback_reason="exact_no_result",
        )
        return self._with_previous_attempts(raw, fallback)

    async def fetch_keyword(
        self,
        query: PlannedQuery,
        reserve_call: Callable[[], Awaitable[None]] | None,
        *,
        keywords: str | None = None,
        strategy: str = "keyword",
        fallback_reason: str | None = None,
    ) -> RawSupplierResponse:
        search_keywords = keywords or query.part_number or query.keywords
        if query.manufacturer:
            path = "/api/v2/search/keywordandmanufacturer"
            root = "SearchByKeywordMfrNameRequest"
            request = {
                "manufacturerName": query.manufacturer,
                "keyword": search_keywords,
                "records": min(max(query.limit, 1), 50),
                "pageNumber": 1,
                "searchOptions": "",
                "searchWithYourSignUpLanguage": "true",
            }
        else:
            path = "/api/v1/search/keyword"
            root = "SearchByKeywordRequest"
            request = {
                "keyword": search_keywords,
                "records": min(max(query.limit, 1), 50),
                "startingRecord": 0,
                "searchOptions": "",
                "searchWithYourSignUpLanguage": "true",
            }
        raw = await self._request_json(
            "POST",
            f"{self.base_url}{path}",
            params={"apiKey": self.api_key},
            json_body={root: request},
            reserve_call=reserve_call,
        )
        return self.traced_response(
            raw,
            strategy=strategy,
            query=search_keywords,
            result_count=self._part_count(raw),
            fallback_reason=fallback_reason,
        )

    def _has_verified_candidate(self, query: PlannedQuery, raw: RawSupplierResponse) -> bool:
        for product in self.normalize(raw, query):
            try:
                if self._matcher.evaluate(query, product).status == MatchStatus.SPEC_COMPATIBLE:
                    return True
            except (TypeError, ValueError):
                continue
        return False

    @staticmethod
    def _merge_keyword_responses(
        preferred: RawSupplierResponse,
        fallback: RawSupplierResponse,
    ) -> RawSupplierResponse:
        preferred_results = (preferred.payload or {}).get("SearchResults") or {}
        fallback_results = (fallback.payload or {}).get("SearchResults") or {}
        parts: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        for source in (preferred_results, fallback_results):
            for part in source.get("Parts") or []:
                if not isinstance(part, dict):
                    continue
                identity = (
                    str(part.get("ManufacturerPartNumber") or "").casefold(),
                    str(part.get("ActualMfrName") or part.get("Manufacturer") or "").casefold(),
                )
                if identity in seen:
                    continue
                seen.add(identity)
                parts.append(part)
        payload = dict(fallback.payload or {})
        search_results = dict(fallback_results)
        search_results["Parts"] = parts
        search_results["NumberOfResult"] = len(parts)
        payload["SearchResults"] = search_results
        return fallback.model_copy(
            update={
                "payload": payload,
                "latency_ms": (preferred.latency_ms or 0.0) + (fallback.latency_ms or 0.0),
                "http_attempt_count": (
                    preferred.http_attempt_count + fallback.http_attempt_count
                ),
                "request_trace": [*preferred.request_trace, *fallback.request_trace],
            }
        )

    @staticmethod
    def _with_previous_attempts(
        previous: RawSupplierResponse,
        current: RawSupplierResponse,
    ) -> RawSupplierResponse:
        return current.model_copy(
            update={
                "latency_ms": previous.latency_ms + current.latency_ms,
                "http_attempt_count": (
                    previous.http_attempt_count + current.http_attempt_count
                ),
                "request_trace": [*previous.request_trace, *current.request_trace],
            },
            deep=True,
        )

    @staticmethod
    def _with_additional_attempts(
        result: RawSupplierResponse,
        attempted: RawSupplierResponse,
    ) -> RawSupplierResponse:
        return result.model_copy(
            update={
                "latency_ms": result.latency_ms + attempted.latency_ms,
                "http_attempt_count": (
                    result.http_attempt_count + attempted.http_attempt_count
                ),
                "request_trace": [*result.request_trace, *attempted.request_trace],
            },
            deep=True,
        )

    async def fetch_exact_batch(
        self,
        queries: list[PlannedQuery],
        reserve_call: Callable[[], Awaitable[None]] | None = None,
    ) -> RawSupplierResponse:
        part_numbers = list(
            dict.fromkeys(query.part_number for query in queries if query.part_number)
        )
        if not part_numbers or len(part_numbers) > 10:
            return RawSupplierResponse(
                supplier=self.supplier,
                ok=False,
                error_type="invalid_batch",
                error_message="Mouser exact batch requires 1 to 10 part numbers",
            )
        return await self._request_json(
            "POST",
            f"{self.base_url}/api/v1/search/partnumber",
            params={"apiKey": self.api_key},
            json_body={
                "SearchByPartRequest": {
                    "mouserPartNumber": "|".join(part_numbers),
                    "partSearchOptions": "Exact",
                }
            },
            reserve_call=reserve_call,
        )

    @staticmethod
    def exact_batch_result(raw: RawSupplierResponse, query: PlannedQuery) -> RawSupplierResponse:
        payload = dict(raw.payload or {})
        search_results = dict(payload.get("SearchResults") or {})
        expected = compact_mpn(query.part_number)
        search_results["Parts"] = [
            part
            for part in search_results.get("Parts") or []
            if isinstance(part, dict)
            and compact_mpn(part.get("ManufacturerPartNumber")) == expected
        ]
        payload["SearchResults"] = search_results
        filtered = raw.model_copy(
            update={"payload": payload, "request_trace": []},
            deep=True,
        )
        return MouserClient.traced_response(
            filtered,
            strategy="identity_batch_exact",
            query=query.part_number or "",
            result_count=MouserClient._part_count(filtered),
        )

    @staticmethod
    def _has_parts(raw: RawSupplierResponse) -> bool:
        search_results = (raw.payload or {}).get("SearchResults")
        return bool(search_results.get("Parts")) if isinstance(search_results, dict) else False

    @staticmethod
    def _part_count(raw: RawSupplierResponse) -> int:
        search_results = (raw.payload or {}).get("SearchResults")
        parts = search_results.get("Parts") if isinstance(search_results, dict) else None
        return sum(1 for part in parts or [] if isinstance(part, dict))

    def normalize(self, raw: RawSupplierResponse, query: PlannedQuery) -> list[SupplierProduct]:
        if not raw.ok or not raw.payload:
            return []
        search_results = raw.payload.get("SearchResults") or {}
        parts = search_results.get("Parts") if isinstance(search_results, dict) else None
        result: list[SupplierProduct] = []
        for part in parts or []:
            if not isinstance(part, dict):
                continue
            mpn = str(part.get("ManufacturerPartNumber") or "").strip()
            if not mpn:
                continue
            attributes = []
            attribute_map: dict[str, Any] = {}
            packagings: list[str] = []
            for attribute in part.get("ProductAttributes") or []:
                if not isinstance(attribute, dict):
                    continue
                name = str(attribute.get("AttributeName") or "")
                value = attribute.get("AttributeValue")
                attributes.append((name, value))
                if name:
                    attribute_map.setdefault(name, value)
                if name.casefold() in {"packaging", "포장"} and value:
                    packagings.append(str(value))
            specs, parsed_attributes = normalized_specs_from_parameters(
                attributes,
                query.part_type,
            )
            description = part.get("Description")
            for key, value in normalized_specs_from_text(description, query.part_type).items():
                specs.setdefault(key, value)
            attribute_map.update(parsed_attributes)
            price_breaks = []
            invalid_price_break_count = 0
            for item in part.get("PriceBreaks") or []:
                if not isinstance(item, dict):
                    invalid_price_break_count += 1
                    continue
                price_break = valid_price_break(
                    item.get("Quantity"),
                    item.get("Price"),
                    item.get("Currency") or query.currency,
                )
                if price_break is None:
                    invalid_price_break_count += 1
                else:
                    price_breaks.append(price_break)
            offer = SupplierOffer(
                supplier=self.supplier,
                supplier_sku=part.get("MouserPartNumber"),
                packaging=", ".join(dict.fromkeys(packagings)) or None,
                stock=self._integer(part.get("AvailabilityInStock") or part.get("Availability")),
                moq=self._integer(part.get("Min")),
                order_multiple=self._integer(part.get("Mult")),
                price_breaks=price_breaks,
                invalid_price_break_count=invalid_price_break_count,
                lead_time=part.get("LeadTime"),
                product_url=part.get("ProductDetailUrl"),
                fetched_at=raw.fetched_at,
            )
            manufacturer = part.get("ActualMfrName") or part.get("Manufacturer")
            result.append(
                SupplierProduct(
                    supplier=self.supplier,
                    supplier_product_id=self.structured_product_identifier(
                        part.get("ProductId"),
                        part.get("ProductID"),
                        part.get("MouserPartNumber"),
                    ),
                    manufacturer_part_number=mpn,
                    manufacturer=manufacturer,
                    manufacturer_evidence=(
                        ManufacturerEvidence.STRUCTURED
                        if manufacturer
                        else ManufacturerEvidence.MISSING
                    ),
                    description=description,
                    category=part.get("MouserProductCategory") or part.get("Category"),
                    lifecycle_status=part.get("LifecycleStatus"),
                    discontinued=self._boolean(part.get("IsDiscontinued")),
                    datasheet_url=part.get("DataSheetUrl") or None,
                    image_url=part.get("ImagePath") or None,
                    normalized_specs=specs,
                    attributes=attribute_map,
                    offers=[offer],
                )
            )
        return result

    @staticmethod
    def _integer(value: Any) -> int | None:
        if value is None:
            return None
        match = _LEADING_INTEGER.search(str(value).replace(",", ""))
        return int(match.group()) if match else None

    @staticmethod
    def _boolean(value: Any) -> bool | None:
        if value is None or value == "":
            return None
        return str(value).strip().casefold() in {"true", "yes", "1"}
