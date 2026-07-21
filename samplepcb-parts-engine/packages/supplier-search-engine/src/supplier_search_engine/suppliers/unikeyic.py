from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from ..matcher import CandidateMatcher
from ..models import (
    ManufacturerEvidence,
    MatchStatus,
    PlannedQuery,
    PriceBreak,
    RawSupplierResponse,
    SearchMode,
    Supplier,
    SupplierOffer,
    SupplierProduct,
)
from ..normalization import normalized_specs_from_text
from ..pricing import valid_price_break
from ..supplier_query import supplier_core_keywords, supplier_spec_keywords
from .base import SupplierClient

_PACKAGING_TRANSLATIONS = {
    "卷带装": "Tape & Reel",
    "托盘装": "Tray",
    "管装": "Tube",
    "散装": "Bulk",
    "盒装": "Box",
    "袋装": "Bag",
}


def normalize_unikeyic_packaging(value: Any) -> str | None:
    """Translate UniKeyIC supply packaging without touching physical package data."""
    if not isinstance(value, str):
        return None
    tokens = [token.strip() for token in value.replace("，", ",").split(",") if token.strip()]
    normalized: list[str] = []
    seen: set[str] = set()
    for token in tokens:
        translated = _PACKAGING_TRANSLATIONS.get(token, token)
        key = translated.casefold()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(translated)
    return ", ".join(normalized) or None


class UniKeyICClient(SupplierClient):
    supplier = Supplier.UNIKEYIC
    api_version = "search-v1"
    normalizer_version = "3"

    def __init__(
        self,
        *,
        api_key: str | None,
        base_url: str,
        client: httpx.AsyncClient | None = None,
        timeout_seconds: float = 8.0,
    ) -> None:
        super().__init__(client=client, timeout_seconds=timeout_seconds)
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self._matcher = CandidateMatcher()

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.base_url)

    @property
    def cache_scope(self) -> str:
        return self.opaque_cache_scope(self.base_url, self.api_key)

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
                error_message="UniKeyIC API key/base URL is not configured",
            )
        if query.mode in {SearchMode.IDENTITY, SearchMode.HYBRID} and query.part_number:
            search_text = query.part_number
            strategy = (
                "identity_exact"
                if query.mode == SearchMode.IDENTITY
                else "hybrid_keyword"
            )
        elif query.mode == SearchMode.PARAMETRIC:
            search_text = supplier_spec_keywords(query, Supplier.UNIKEYIC)
            strategy = "parametric_full"
        else:
            return RawSupplierResponse(
                supplier=self.supplier,
                ok=False,
                error_type="unsupported_search_mode",
                error_message="UniKeyIC requires an identity or parametric query",
            )
        raw = await self._fetch_keyword(
            search_text,
            strategy=strategy,
            reserve_call=reserve_call,
        )
        if query.mode != SearchMode.PARAMETRIC or not raw.ok:
            return raw
        if self._has_verified_candidate(query, raw):
            return raw
        core_keywords = supplier_core_keywords(query, Supplier.UNIKEYIC)
        if core_keywords == search_text:
            return raw
        fallback = await self._fetch_keyword(
            core_keywords,
            strategy="parametric_core",
            fallback_reason="no_verified_candidate",
            reserve_call=reserve_call,
        )
        if fallback.ok and self._product_count(fallback):
            return self._merge_keyword_responses(raw, fallback)
        return self._with_additional_attempts(raw, fallback)

    async def _fetch_keyword(
        self,
        search_text: str,
        *,
        strategy: str,
        reserve_call: Callable[[], Awaitable[None]] | None,
        fallback_reason: str | None = None,
    ) -> RawSupplierResponse:
        raw = await self._request_json(
            "POST",
            f"{self.base_url}/search-v1/products/get-single-goods-usd",
            headers={"Authorization": self.api_key or "", "Content-Type": "application/json"},
            json_body={"pro_sno": search_text},
            reserve_call=reserve_call,
        )
        return self.traced_response(
            raw,
            strategy=strategy,
            query=search_text,
            result_count=self._product_count(raw),
            fallback_reason=fallback_reason,
        )

    def cache_payload(self, query: PlannedQuery) -> dict[str, Any]:
        if query.mode in {SearchMode.IDENTITY, SearchMode.HYBRID} and query.part_number:
            return {
                "mode": query.mode.value,
                "part_number": query.part_number,
                "strategy": "identity-or-hybrid-v2",
            }
        return {
            "mode": query.mode.value,
            "preferred_keywords": supplier_spec_keywords(
                query,
                Supplier.UNIKEYIC,
            ),
            "core_keywords": supplier_core_keywords(
                query,
                Supplier.UNIKEYIC,
            ),
            "strategy": "parametric-full-core-v1",
        }

    def planned_api_calls(self, query: PlannedQuery) -> int:
        return 2 if query.mode == SearchMode.PARAMETRIC else 1

    def retry_worst_case_api_calls(self, query: PlannedQuery) -> int:
        return 6 if query.mode == SearchMode.PARAMETRIC else 3

    def _has_verified_candidate(
        self,
        query: PlannedQuery,
        raw: RawSupplierResponse,
    ) -> bool:
        for product in self.normalize(raw, query):
            try:
                if (
                    self._matcher.evaluate(query, product).status
                    == MatchStatus.SPEC_COMPATIBLE
                ):
                    return True
            except (TypeError, ValueError):
                continue
        return False

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

    @staticmethod
    def _merge_keyword_responses(
        preferred: RawSupplierResponse,
        fallback: RawSupplierResponse,
    ) -> RawSupplierResponse:
        products: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        for response in (preferred, fallback):
            data = (response.payload or {}).get("data") or {}
            for product in data.get("products") or []:
                if not isinstance(product, dict):
                    continue
                identity = (
                    str(product.get("pro_sno") or "").casefold(),
                    str(product.get("std_mfr_name") or "").casefold(),
                )
                if identity in seen:
                    continue
                seen.add(identity)
                products.append(product)
        payload = dict(fallback.payload or {})
        data = dict(payload.get("data") or {})
        data["products"] = products
        payload["data"] = data
        return fallback.model_copy(
            update={
                "payload": payload,
                "latency_ms": preferred.latency_ms + fallback.latency_ms,
                "http_attempt_count": (
                    preferred.http_attempt_count + fallback.http_attempt_count
                ),
                "request_trace": [
                    *preferred.request_trace,
                    *fallback.request_trace,
                ],
            },
            deep=True,
        )

    @staticmethod
    def _product_count(raw: RawSupplierResponse) -> int:
        data = (raw.payload or {}).get("data")
        products = data.get("products") if isinstance(data, dict) else None
        return sum(1 for product in products or [] if isinstance(product, dict))

    def normalize(self, raw: RawSupplierResponse, query: PlannedQuery) -> list[SupplierProduct]:
        if not raw.ok or not raw.payload or raw.payload.get("err_code") not in {None, "Com:Success"}:
            return []
        data = raw.payload.get("data") or {}
        result: list[SupplierProduct] = []
        for product in data.get("products") or []:
            if not isinstance(product, dict):
                continue
            mpn = str(product.get("pro_sno") or "").strip()
            if not mpn:
                continue
            description = product.get("short_desc")
            specs = normalized_specs_from_text(description, query.part_type)
            packaging = normalize_unikeyic_packaging(product.get("package"))
            price_values = product.get("calc_sale_usd_price") or []
            quantities = product.get("nums") or []
            breaks: list[PriceBreak] = []
            invalid_price_break_count = abs(len(quantities) - len(price_values))
            for quantity, price_value in zip(quantities, price_values, strict=False):
                price_break = valid_price_break(quantity, price_value, "USD")
                if price_break is None:
                    invalid_price_break_count += 1
                else:
                    breaks.append(price_break)
            offer = SupplierOffer(
                supplier=self.supplier,
                supplier_sku=product.get("sku"),
                packaging=packaging,
                stock=int(product["stock"]) if isinstance(product.get("stock"), (int, float)) else None,
                moq=int(product["moq"]) if isinstance(product.get("moq"), (int, float)) else None,
                price_breaks=breaks,
                invalid_price_break_count=invalid_price_break_count,
                fetched_at=raw.fetched_at,
            )
            manufacturer = product.get("std_mfr_name")
            result.append(
                SupplierProduct(
                    supplier=self.supplier,
                    supplier_product_id=self.structured_product_identifier(
                        product.get("goods_id"),
                        product.get("goods_sno"),
                        product.get("id"),
                        product.get("sku"),
                    ),
                    manufacturer_part_number=mpn,
                    manufacturer=manufacturer,
                    manufacturer_evidence=(
                        ManufacturerEvidence.STRUCTURED
                        if manufacturer
                        else ManufacturerEvidence.MISSING
                    ),
                    description=description,
                    category=product.get("cate_name"),
                    package=specs.get("package") if isinstance(specs.get("package"), str) else None,
                    datasheet_url=product.get("datasheet_url"),
                    image_url=product.get("image_url") or product.get("img") or None,
                    normalized_specs=specs,
                    attributes={"date_code": product.get("dc")},
                    offers=[offer],
                )
            )
        return result
