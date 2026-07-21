from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from ..models import (
    ManufacturerEvidence,
    PlannedQuery,
    PriceBreak,
    RawSupplierResponse,
    Supplier,
    SupplierOffer,
    SupplierProduct,
)
from ..normalization import normalized_specs_from_text
from ..pricing import valid_price_break
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
    normalizer_version = "2"

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
        if not query.part_number:
            return RawSupplierResponse(
                supplier=self.supplier,
                ok=False,
                error_type="unsupported_search_mode",
                error_message="UniKeyIC is used only for exact part-number enrichment",
            )
        raw = await self._request_json(
            "POST",
            f"{self.base_url}/search-v1/products/get-single-goods-usd",
            headers={"Authorization": self.api_key or "", "Content-Type": "application/json"},
            json_body={"pro_sno": query.part_number},
            reserve_call=reserve_call,
        )
        return self.traced_response(
            raw,
            strategy="identity_exact",
            query=query.part_number,
            result_count=self._product_count(raw),
        )

    def cache_payload(self, query: PlannedQuery) -> dict[str, Any]:
        return {"part_number": query.part_number}

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
