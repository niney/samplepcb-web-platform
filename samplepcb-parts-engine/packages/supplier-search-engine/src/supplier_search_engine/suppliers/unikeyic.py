from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from ..models import (
    PlannedQuery,
    PriceBreak,
    RawSupplierResponse,
    Supplier,
    SupplierOffer,
    SupplierProduct,
)
from ..normalization import normalized_specs_from_text
from .base import SupplierClient


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
        return await self._request_json(
            "POST",
            f"{self.base_url}/search-v1/products/get-single-goods-usd",
            headers={"Authorization": self.api_key or "", "Content-Type": "application/json"},
            json_body={"pro_sno": query.part_number},
            reserve_call=reserve_call,
        )

    def cache_payload(self, query: PlannedQuery) -> dict[str, Any]:
        return {"part_number": query.part_number}

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
            packaging = product.get("package")
            price_values = product.get("calc_sale_usd_price") or []
            quantities = product.get("nums") or []
            breaks: list[PriceBreak] = []
            for quantity, price_value in zip(quantities, price_values, strict=False):
                price = self._price(price_value)
                if price is not None:
                    breaks.append(PriceBreak(quantity=int(quantity or 0), unit_price=price, currency="USD"))
            offer = SupplierOffer(
                supplier=self.supplier,
                supplier_sku=product.get("sku"),
                packaging=packaging,
                stock=int(product["stock"]) if isinstance(product.get("stock"), (int, float)) else None,
                moq=int(product["moq"]) if isinstance(product.get("moq"), (int, float)) else None,
                price_breaks=breaks,
                fetched_at=raw.fetched_at,
            )
            result.append(
                SupplierProduct(
                    supplier=self.supplier,
                    manufacturer_part_number=mpn,
                    manufacturer=product.get("std_mfr_name"),
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

    @staticmethod
    def _price(value: Any) -> float | None:
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, dict):
            for nested in value.values():
                if isinstance(nested, (int, float)):
                    return float(nested)
        return None
