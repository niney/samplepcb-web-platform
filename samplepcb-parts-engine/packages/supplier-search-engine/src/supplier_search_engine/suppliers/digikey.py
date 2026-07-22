from __future__ import annotations

import asyncio
import math
import time
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import quote

import httpx

from ..matcher import CandidateMatcher
from ..models import (
    ManufacturerEvidence,
    MatchStatus,
    PlannedQuery,
    RawSupplierResponse,
    Requirement,
    SearchMode,
    Supplier,
    SupplierOffer,
    SupplierProduct,
)
from ..normalization import normalize_package, normalized_specs_from_parameters, normalized_specs_from_text
from ..pricing import valid_price_break
from ..supplier_query import (
    is_ferrite_bead_query,
    supplier_core_keywords,
    supplier_spec_keywords,
)
from .base import SupplierClient


_CATEGORY_IDS = {"resistor": "2", "capacitor": "3", "inductor": "4"}
_PRIMARY_REQUIREMENTS = {
    "resistor": "resistance_ohm",
    "capacitor": "capacitance_f",
    "inductor": "inductance_h",
}


class DigiKeyClient(SupplierClient):
    supplier = Supplier.DIGIKEY
    api_version = "product-information-v4"
    normalizer_version = "2"

    def __init__(
        self,
        *,
        client_id: str | None,
        client_secret: str | None,
        account_id: str | None,
        base_url: str = "https://api.digikey.com",
        token_url: str = "https://api.digikey.com/v1/oauth2/token",
        client: httpx.AsyncClient | None = None,
        timeout_seconds: float = 8.0,
    ) -> None:
        super().__init__(client=client, timeout_seconds=timeout_seconds)
        self.client_id = client_id
        self.client_secret = client_secret
        self.account_id = account_id
        self.base_url = base_url.rstrip("/")
        self.token_url = token_url
        self._access_token: str | None = None
        self._token_expiry = 0.0
        self._token_lock = asyncio.Lock()
        self._matcher = CandidateMatcher()

    @property
    def configured(self) -> bool:
        return bool(self.client_id and self.client_secret)

    @property
    def cache_scope(self) -> str:
        return self.opaque_cache_scope(self.base_url, self.client_id, self.account_id)

    def cache_payload(self, query: PlannedQuery) -> dict[str, Any]:
        payload = super().cache_payload(query)
        if query.mode == SearchMode.IDENTITY and query.part_number:
            payload["strategy"] = "product-details-keyword-fallback-v1"
        elif query.mode == SearchMode.PARAMETRIC and self._primary_requirement(query):
            payload.update(
                {
                    "strategy": "parametric-full-filter-core-v8",
                    "preferred_keywords": supplier_spec_keywords(
                        query,
                        Supplier.DIGIKEY,
                    ),
                    "core_keywords": supplier_core_keywords(
                        query,
                        Supplier.DIGIKEY,
                    ),
                    "request_language": "en",
                }
            )
        return payload

    def planned_api_calls(self, query: PlannedQuery) -> int:
        if query.mode == SearchMode.IDENTITY and query.part_number:
            return 2
        if query.mode == SearchMode.PARAMETRIC and self._primary_requirement(query):
            return 2
        return 1

    def retry_worst_case_api_calls(self, query: PlannedQuery) -> int:
        if query.mode in {SearchMode.IDENTITY, SearchMode.PARAMETRIC}:
            return 6
        return 3

    async def _token(self) -> str:
        if self._access_token and time.time() < self._token_expiry - 60:
            return self._access_token
        async with self._token_lock:
            if self._access_token and time.time() < self._token_expiry - 60:
                return self._access_token
            response = await self.client.post(
                self.token_url,
                auth=(self.client_id or "", self.client_secret or ""),
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                data={"grant_type": "client_credentials"},
            )
            response.raise_for_status()
            payload = response.json()
            self._access_token = str(payload["access_token"])
            self._token_expiry = time.time() + int(payload.get("expires_in", 600))
            return self._access_token

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
                error_message="DigiKey credentials are not configured",
            )
        try:
            token = await self._token()
        except (httpx.HTTPError, KeyError, ValueError):
            return RawSupplierResponse(
                supplier=self.supplier,
                ok=False,
                error_type="oauth_error",
                error_message="DigiKey OAuth token acquisition failed",
            )
        headers = {
            "Authorization": f"Bearer {token}",
            "X-DIGIKEY-Client-Id": self.client_id or "",
            "X-DIGIKEY-Locale-Site": query.site,
            # Live probing showed that the Korean keyword parser can split
            # engineering units incorrectly (10uF -> 0.1uF results). Product
            # text remains locally normalized, so parametric discovery uses
            # DigiKey's English parser while preserving site and currency.
            "X-DIGIKEY-Locale-Language": (
                "en" if query.mode == SearchMode.PARAMETRIC else query.language
            ),
            "X-DIGIKEY-Locale-Currency": query.currency,
        }
        if self.account_id:
            headers["X-DIGIKEY-Account-Id"] = self.account_id

        if query.mode == SearchMode.IDENTITY and query.part_number:
            params: dict[str, str] = {}
            exact = await self._request_json(
                "GET",
                f"{self.base_url}/products/v4/search/{quote(query.part_number, safe='')}/productdetails",
                headers=headers,
                params=params,
                reserve_call=reserve_call,
            )
            exact = self.traced_response(
                exact,
                strategy="identity_exact",
                query=query.part_number,
                result_count=self._product_count(exact),
            )
            if exact.ok and exact.payload and exact.payload.get("Product"):
                return exact
            if not exact.ok and exact.status_code not in {400, 404}:
                return exact
            fallback = await self._keyword_fetch(
                query,
                headers,
                reserve_call,
                keywords=query.part_number,
                strategy="identity_keyword",
                fallback_reason="exact_no_result",
            )
            return self._with_previous_attempts(exact, fallback)

        if query.mode == SearchMode.PARAMETRIC and self._primary_requirement(query):
            preferred_keywords = supplier_spec_keywords(query, Supplier.DIGIKEY)
            discovery = await self._keyword_fetch(
                query,
                headers,
                reserve_call,
                keywords=preferred_keywords,
                strategy="parametric_full",
            )
            if not discovery.ok or not discovery.payload:
                return discovery
            if self._has_verified_discovery_candidate(query, discovery):
                return discovery
            parameter_filter = self._parameter_filter_request(query, discovery.payload)
            if parameter_filter:
                filtered = await self._keyword_fetch(
                    query,
                    headers,
                    reserve_call,
                    keywords=preferred_keywords,
                    parameter_filter=parameter_filter,
                    strategy="parametric_filter",
                    fallback_reason="parameter_filter_required",
                )
                if filtered.ok and filtered.payload and self._has_products(filtered.payload):
                    filtered_payload = dict(filtered.payload)
                    # Retain the first response's reusable filter metadata in the same
                    # durable raw-cache entry without exposing another credential or key.
                    filtered_payload["SearchProbeDiscovery"] = {
                        "Keywords": preferred_keywords,
                        "FilterOptions": discovery.payload.get("FilterOptions") or {},
                    }
                    filtered = filtered.model_copy(
                        update={
                            "payload": filtered_payload,
                            "latency_ms": (discovery.latency_ms or 0.0)
                            + (filtered.latency_ms or 0.0),
                            "http_attempt_count": (
                                discovery.http_attempt_count
                                + filtered.http_attempt_count
                            ),
                            "request_trace": [
                                *discovery.request_trace,
                                *filtered.request_trace,
                            ],
                        }
                    )
                    if self._has_verified_discovery_candidate(query, filtered):
                        return filtered
                    discovery = filtered
                elif not filtered.ok:
                    return self._with_additional_attempts(discovery, filtered)
                else:
                    discovery = self._with_additional_attempts(discovery, filtered)

            core_keywords = supplier_core_keywords(query, Supplier.DIGIKEY)
            if core_keywords != preferred_keywords:
                fallback = await self._keyword_fetch(
                    query,
                    headers,
                    reserve_call,
                    keywords=core_keywords,
                    strategy="parametric_core",
                    fallback_reason="no_verified_candidate",
                )
                if fallback.ok and fallback.payload and self._has_products(fallback.payload):
                    return self._merge_keyword_responses(
                        discovery,
                        fallback,
                        preferred_keywords=preferred_keywords,
                        fallback_keywords=core_keywords,
                    )
                return self._with_additional_attempts(discovery, fallback)
            return discovery

        return await self._keyword_fetch(
            query,
            headers,
            reserve_call,
            strategy="keyword",
        )

    @staticmethod
    def _merge_keyword_responses(
        preferred: RawSupplierResponse,
        fallback: RawSupplierResponse,
        *,
        preferred_keywords: str,
        fallback_keywords: str,
    ) -> RawSupplierResponse:
        payload = dict(fallback.payload or {})
        for key in ("ExactMatches", "Products"):
            combined: list[dict[str, Any]] = []
            seen: set[tuple[str, str]] = set()
            for source in (preferred.payload or {}, fallback.payload or {}):
                for product in source.get(key) or []:
                    if not isinstance(product, dict):
                        continue
                    manufacturer = product.get("Manufacturer") or {}
                    manufacturer_name = (
                        manufacturer.get("Name") if isinstance(manufacturer, dict) else manufacturer
                    )
                    identity = (
                        str(product.get("ManufacturerProductNumber") or "").casefold(),
                        str(manufacturer_name or "").casefold(),
                    )
                    if identity in seen:
                        continue
                    seen.add(identity)
                    combined.append(product)
            if combined:
                payload[key] = combined
        payload["SearchProbeDiscovery"] = {
            "Keywords": preferred_keywords,
            "FallbackKeywords": fallback_keywords,
            "FilterOptions": (preferred.payload or {}).get("FilterOptions") or {},
        }
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

    def _has_verified_discovery_candidate(
        self,
        query: PlannedQuery,
        discovery: RawSupplierResponse,
    ) -> bool:
        """Skip the filtered request only when local verification is complete.

        Reusing CandidateMatcher keeps this fast path aligned with the final
        public decision. Missing or conflicting hard requirements deliberately
        fall through to DigiKey's response-derived parametric filter.
        """

        for product in self.normalize(discovery, query):
            try:
                if self._matcher.evaluate(query, product).status == MatchStatus.SPEC_COMPATIBLE:
                    return True
            except (TypeError, ValueError):
                # Unusual supplier values must make the optimization fail safe:
                # the normal filtered search remains available.
                continue
        return False

    async def _keyword_fetch(
        self,
        query: PlannedQuery,
        headers: dict[str, str],
        reserve_call: Callable[[], Awaitable[None]] | None,
        *,
        keywords: str | None = None,
        parameter_filter: dict[str, Any] | None = None,
        strategy: str,
        fallback_reason: str | None = None,
    ) -> RawSupplierResponse:

        filter_options: dict[str, Any] = {"MarketPlaceFilter": "ExcludeMarketPlace"}
        category_id = (
            None
            if is_ferrite_bead_query(query)
            else _CATEGORY_IDS.get((query.part_type or "").casefold())
        )
        if category_id:
            filter_options["CategoryFilter"] = [{"Id": category_id}]
        if parameter_filter:
            filter_options["ParameterFilterRequest"] = parameter_filter
        body: dict[str, Any] = {
            "Keywords": keywords or query.keywords,
            "Limit": min(max(query.limit, 1), 50),
            "Offset": 0,
            "FilterOptionsRequest": filter_options,
        }
        raw = await self._request_json(
            "POST",
            f"{self.base_url}/products/v4/search/keyword",
            headers=headers,
            json_body=body,
            reserve_call=reserve_call,
        )
        return self.traced_response(
            raw,
            strategy=strategy,
            query=str(body["Keywords"]),
            result_count=self._product_count(raw),
            fallback_reason=fallback_reason,
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

    @staticmethod
    def _product_count(raw: RawSupplierResponse) -> int:
        payload = raw.payload or {}
        if isinstance(payload.get("Product"), dict):
            return 1
        products = payload.get("Products") or payload.get("ExactMatches") or []
        return sum(1 for product in products if isinstance(product, dict))

    @staticmethod
    def _has_products(payload: dict[str, Any]) -> bool:
        return bool(payload.get("Products") or payload.get("ExactMatches"))

    @staticmethod
    def _primary_requirement(query: PlannedQuery) -> Requirement | None:
        if is_ferrite_bead_query(query):
            return query.requirements.get("resistance_ohm")
        key = _PRIMARY_REQUIREMENTS.get((query.part_type or "").casefold())
        return query.requirements.get(key) if key else None

    @classmethod
    def _discovery_keywords(cls, query: PlannedQuery) -> str:
        return supplier_core_keywords(query, Supplier.DIGIKEY)

    @classmethod
    def _parameter_filter_request(
        cls,
        query: PlannedQuery,
        payload: dict[str, Any],
    ) -> dict[str, Any] | None:
        by_category: dict[str, dict[str, dict[str, Any]]] = {}
        for option in (payload.get("FilterOptions") or {}).get("ParametricFilters") or []:
            if not isinstance(option, dict):
                continue
            category = option.get("Category") or {}
            category_id = category.get("Id") if isinstance(category, dict) else None
            parameter_id = option.get("ParameterId")
            parameter_name = option.get("ParameterName")
            if category_id is None or parameter_id is None or not parameter_name:
                continue
            for requirement_name, requirement in query.requirements.items():
                if not requirement.hard or requirement_name == "part_type":
                    continue
                selected = cls._matching_filter_values(
                    requirement_name,
                    requirement,
                    option,
                    query.part_type,
                )
                if selected:
                    by_category.setdefault(str(category_id), {}).setdefault(
                        requirement_name,
                        {
                            "ParameterId": int(parameter_id),
                            "FilterValues": [{"Id": value_id} for value_id in selected],
                        },
                    )

        if not by_category:
            return None
        primary_name = _PRIMARY_REQUIREMENTS.get((query.part_type or "").casefold())
        category_id, filters = max(
            by_category.items(),
            key=lambda item: (int(primary_name in item[1]), len(item[1])),
        )
        if primary_name and primary_name in query.requirements and primary_name not in filters:
            return None
        return {
            "CategoryFilter": {"Id": category_id},
            "ParameterFilters": list(filters.values()),
        }

    @classmethod
    def _matching_filter_values(
        cls,
        requirement_name: str,
        requirement: Requirement,
        option: dict[str, Any],
        component_type: str | None = None,
    ) -> list[str]:
        matches: list[tuple[str, Any]] = []
        parameter_name = str(option.get("ParameterName") or "")
        for value in option.get("FilterValues") or []:
            if not isinstance(value, dict) or value.get("ValueId") is None:
                continue
            normalized, _raw = normalized_specs_from_parameters(
                [(parameter_name, value.get("ValueName"))],
                component_type,
            )
            actual = normalized.get(requirement_name)
            if actual is not None and cls._requirement_matches(
                requirement,
                actual,
                component_type,
            ):
                matches.append((str(value["ValueId"]), actual))
        if not matches:
            return []
        expected = requirement.normalized_value
        if requirement.comparison == "gte" and isinstance(expected, (int, float)):
            closest = min(float(actual) for _value_id, actual in matches)
            return [value_id for value_id, actual in matches if math.isclose(float(actual), closest)]
        if requirement.comparison == "lte" and isinstance(expected, (int, float)):
            closest = max(float(actual) for _value_id, actual in matches)
            return [value_id for value_id, actual in matches if math.isclose(float(actual), closest)]
        return [value_id for value_id, _actual in matches]

    @staticmethod
    def _requirement_matches(
        requirement: Requirement,
        actual: Any,
        component_type: str | None = None,
    ) -> bool:
        expected = requirement.normalized_value
        if expected is None:
            return False
        if requirement.comparison == "eq":
            if isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
                return math.isclose(
                    float(expected),
                    float(actual),
                    rel_tol=1e-6,
                    abs_tol=max(abs(float(expected)), abs(float(actual)), 1.0) * 1e-9,
                )
            if isinstance(expected, str):
                return normalize_package(expected, component_type) == normalize_package(
                    actual,
                    component_type,
                )
            return expected == actual
        if requirement.comparison == "gte":
            return isinstance(actual, (int, float)) and float(actual) >= float(expected)
        if requirement.comparison == "lte":
            return isinstance(actual, (int, float)) and float(actual) <= float(expected)
        return False

    def normalize(self, raw: RawSupplierResponse, query: PlannedQuery) -> list[SupplierProduct]:
        if not raw.ok or not raw.payload:
            return []
        payload = raw.payload
        raw_products: list[dict[str, Any]] = []
        if isinstance(payload.get("Product"), dict):
            raw_products.append(payload["Product"])
        else:
            for key in ("ExactMatches", "Products"):
                values = payload.get(key)
                if isinstance(values, list):
                    raw_products.extend(item for item in values if isinstance(item, dict))
        seen: set[tuple[str, str]] = set()
        result: list[SupplierProduct] = []
        for product in raw_products:
            mpn = str(product.get("ManufacturerProductNumber") or "").strip()
            manufacturer_obj = product.get("Manufacturer") or {}
            manufacturer = manufacturer_obj.get("Name") if isinstance(manufacturer_obj, dict) else None
            if not mpn:
                continue
            identity = (mpn.casefold(), str(manufacturer or "").casefold())
            if identity in seen:
                continue
            seen.add(identity)
            description_obj = product.get("Description") or {}
            description = None
            if isinstance(description_obj, dict):
                description = description_obj.get("DetailedDescription") or description_obj.get("ProductDescription")
            parameters = []
            for parameter in product.get("Parameters") or []:
                if isinstance(parameter, dict):
                    name = parameter.get("ParameterText") or parameter.get("Text") or parameter.get("ParameterId")
                    parameters.append((str(name), parameter.get("ValueText")))
            specs, raw_attributes = normalized_specs_from_parameters(
                parameters,
                query.part_type,
            )
            for key, value in normalized_specs_from_text(description, query.part_type).items():
                specs.setdefault(key, value)
            package = self._component_package(parameters, query.part_type)
            if package:
                normalized_package = normalize_package(package, query.part_type)
                if normalized_package:
                    specs["package"] = normalized_package
            category_obj = product.get("Category") or {}
            category = category_obj.get("Name") if isinstance(category_obj, dict) else None
            status_obj = product.get("ProductStatus") or {}
            lifecycle = status_obj.get("Status") if isinstance(status_obj, dict) else None
            offers = self._offers(product, query, raw.fetched_at)
            result.append(
                SupplierProduct(
                    supplier=self.supplier,
                    supplier_product_id=self.structured_product_identifier(
                        product.get("ProductId"),
                        product.get("ProductID"),
                    ),
                    manufacturer_part_number=mpn,
                    manufacturer=manufacturer,
                    manufacturer_evidence=(
                        ManufacturerEvidence.STRUCTURED
                        if manufacturer
                        else ManufacturerEvidence.MISSING
                    ),
                    description=description,
                    category=category,
                    package=package,
                    lifecycle_status=lifecycle,
                    discontinued=product.get("Discontinued"),
                    end_of_life=product.get("EndOfLife"),
                    datasheet_url=product.get("DatasheetUrl"),
                    image_url=product.get("PhotoUrl") or None,
                    normalized_specs=specs,
                    attributes=raw_attributes,
                    offers=offers,
                )
            )
        return result

    @staticmethod
    def _component_package(
        parameters: list[tuple[str, Any]],
        component_type: str | None = None,
    ) -> str | None:
        entries = [
            (
                "".join(
                    character for character in name.casefold() if character.isalnum()
                ),
                str(value),
            )
            for name, value in parameters
            if value
        ]

        def first(*aliases: str) -> str | None:
            for name, value in entries:
                if name in aliases:
                    return value
            return None

        supplier_package = first("supplierdevicepackage", "공급장치패키지")
        size = first("sizedimension", "크기치수")
        package_case = first("packagecase", "패키지케이스", "패키지")
        crystal_context = (component_type or "").casefold() in {
            "crystal",
            "oscillator",
            "resonator",
            "xtal",
        }
        if not crystal_context:
            return supplier_package or package_case or size

        if supplier_package and normalize_package(supplier_package, component_type):
            return supplier_package
        if size and normalize_package(size, component_type):
            return f"{supplier_package} ({size})" if supplier_package else size
        if package_case and normalize_package(package_case, component_type):
            return package_case
        return supplier_package or package_case

    def _offers(self, product: dict[str, Any], query: PlannedQuery, fetched_at) -> list[SupplierOffer]:
        offers: list[SupplierOffer] = []
        for variation in product.get("ProductVariations") or []:
            if not isinstance(variation, dict):
                continue
            package_obj = variation.get("PackageType") or {}
            packaging = package_obj.get("Name") if isinstance(package_obj, dict) else None
            price_breaks = []
            invalid_price_break_count = 0
            for item in variation.get("StandardPricing") or []:
                if not isinstance(item, dict):
                    invalid_price_break_count += 1
                    continue
                price_break = valid_price_break(
                    item.get("BreakQuantity"),
                    item.get("UnitPrice"),
                    query.currency,
                )
                if price_break is None:
                    invalid_price_break_count += 1
                else:
                    price_breaks.append(price_break)
            offers.append(
                SupplierOffer(
                    supplier=self.supplier,
                    supplier_sku=variation.get("DigiKeyProductNumber"),
                    packaging=packaging,
                    stock=variation.get("QuantityAvailableforPackageType"),
                    moq=variation.get("MinimumOrderQuantity"),
                    price_breaks=price_breaks,
                    invalid_price_break_count=invalid_price_break_count,
                    product_url=product.get("ProductUrl"),
                    fetched_at=fetched_at,
                )
            )
        return offers
