from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from .contract import SearchBatchInput

from .budget import ApiBudgetManager
from .cache import CacheLookup, SQLiteCache, stable_cache_key
from .models import (
    BatchPreflight,
    ComponentPreflight,
    PlannedQuery,
    RawSupplierResponse,
    SearchMode,
    Supplier,
    SupplierBudgetProjection,
    SupplierPreflight,
)
from .planner import QueryPlanner
from .request_cache import supplier_cache_coordinates
from .routing import suppliers_for_query
from .settings import Settings
from .suppliers.base import SupplierClient
from .suppliers.mouser import MouserClient


@dataclass(frozen=True, slots=True)
class _RequestGroup:
    supplier: Supplier
    client: SupplierClient | None
    query: PlannedQuery
    namespace: str | None
    cache_key: str | None
    component_indexes: tuple[int, ...]


class PreflightAnalyzer:
    """Predict supplier calls without invoking a supplier or consuming quota."""

    def __init__(
        self,
        settings: Settings,
        cache: SQLiteCache,
        budget: ApiBudgetManager,
        clients: dict[Supplier, SupplierClient],
        planner: QueryPlanner,
    ) -> None:
        self.settings = settings
        self.cache = cache
        self.budget = budget
        self.clients = clients
        self.planner = planner

    def analyze(self, batch: SearchBatchInput) -> BatchPreflight:
        queries = [self.planner.plan(component) for component in batch.components]
        unique_queries = {stable_cache_key(query.cache_payload()) for query in queries}
        group_members: dict[str, list[int]] = defaultdict(list)
        group_data: dict[str, tuple[Supplier, SupplierClient | None, PlannedQuery, str | None, str | None]] = {}

        for index, query in enumerate(queries):
            for supplier in suppliers_for_query(query):
                client = self.clients.get(supplier)
                if client is None:
                    if query.mode == SearchMode.IDENTITY and query.part_number:
                        unavailable_payload = {
                            "mode": query.mode.value,
                            "part_number": query.part_number,
                            "manufacturer": query.manufacturer,
                            "site": query.site,
                            "language": query.language,
                            "currency": query.currency,
                        }
                    else:
                        unavailable_payload = query.cache_payload()
                    identity = f"unavailable:{supplier.value}:{stable_cache_key(unavailable_payload)}"
                    namespace = None
                    cache_key = None
                else:
                    namespace, cache_key = supplier_cache_coordinates(client, query)
                    identity = f"{namespace}:{cache_key}"
                group_members[identity].append(index)
                group_data.setdefault(identity, (supplier, client, query, namespace, cache_key))

        groups = [
            _RequestGroup(*group_data[identity], component_indexes=tuple(indexes))
            for identity, indexes in group_members.items()
        ]
        projections: dict[tuple[int, Supplier], SupplierPreflight] = {}
        supplier_estimated: dict[Supplier, int] = defaultdict(int)
        supplier_worst: dict[Supplier, int] = defaultdict(int)
        fresh_count = 0
        stale_count = 0
        uncallable_count = 0

        evaluated: list[tuple[_RequestGroup, CacheLookup, SupplierPreflight]] = []
        for group in groups:
            lookup = self._lookup(group)
            projection = self._project_group(group, lookup)
            evaluated.append((group, lookup, projection))

        mouser_indexes = [
            index
            for index, (group, _lookup, projection) in enumerate(evaluated)
            if group.supplier == Supplier.MOUSER
            and isinstance(group.client, MouserClient)
            and group.query.mode == SearchMode.IDENTITY
            and bool(group.query.part_number)
            and projection.will_call_api
        ]
        if len(mouser_indexes) >= 2:
            for start in range(0, len(mouser_indexes), 10):
                chunk_indexes = mouser_indexes[start : start + 10]
                for offset, index in enumerate(chunk_indexes):
                    group, lookup, projection = evaluated[index]
                    evaluated[index] = (
                        group,
                        lookup,
                        projection.model_copy(
                            update={
                                "batch_size": len(chunk_indexes),
                                "estimated_api_calls": 2 if offset == 0 else 1,
                                # A failed batch can consume three attempts before every
                                # component falls back to exact+keyword (six each).
                                "retry_worst_case_api_calls": 9 if offset == 0 else 6,
                                "reason": "mouser_batch_exact_with_conditional_keyword",
                            }
                        ),
                    )

        for group, lookup, projection in evaluated:
            supplier_estimated[group.supplier] += projection.estimated_api_calls
            supplier_worst[group.supplier] += projection.retry_worst_case_api_calls
            fresh_count += int(lookup.state == "fresh")
            stale_count += int(lookup.state == "stale")
            uncallable_count += int(not projection.will_call_api and not projection.usable_without_api)
            for index in group.component_indexes:
                projections[(index, group.supplier)] = projection.model_copy(deep=True)

        components: list[ComponentPreflight] = []
        for index, query in enumerate(queries):
            source_component = batch.components[index]
            warnings: list[str] = []
            supplier_items = [
                projections[(index, supplier)] for supplier in suppliers_for_query(query)
            ]
            if query.mode == SearchMode.INSUFFICIENT:
                warnings.append("부품 식별자 또는 검증 가능한 스펙이 부족해 공급사를 호출하지 않습니다.")
            for item in supplier_items:
                if not item.configured and not item.usable_without_api:
                    warnings.append(f"{item.supplier.value}: 자격증명과 사용 가능한 캐시가 없습니다.")
                elif item.cache_state == "stale" and item.will_call_api:
                    warnings.append(f"{item.supplier.value}: stale 캐시가 있어 갱신을 시도합니다.")
            components.append(
                ComponentPreflight(
                    component_id=query.component_id,
                    mode=query.mode,
                    reference_designators=source_component.reference_designators,
                    source_rows_1based=source_component.source_rows_1based,
                    part_number=query.part_number,
                    manufacturer=query.manufacturer,
                    keywords=query.keywords,
                    suppliers=supplier_items,
                    warnings=warnings,
                )
            )

        estimated_total = sum(supplier_estimated.values())
        worst_total = sum(supplier_worst.values())
        budgets = [
            self._budget_projection(
                supplier,
                supplier_estimated.get(supplier, 0),
                supplier_worst.get(supplier, 0),
            )
            for supplier in Supplier
        ]
        return BatchPreflight(
            source_file=batch.source_file,
            component_count=len(queries),
            unique_query_count=len(unique_queries),
            unique_supplier_request_count=len(groups),
            estimated_api_calls=estimated_total,
            retry_worst_case_api_calls=worst_total,
            job_call_limit=self.settings.max_api_calls_per_job,
            estimated_within_job_limit=estimated_total <= self.settings.max_api_calls_per_job,
            retry_worst_case_within_job_limit=worst_total <= self.settings.max_api_calls_per_job,
            cache_only=self.settings.cache_only,
            fresh_cache_requests=fresh_count,
            stale_cache_requests=stale_count,
            uncallable_requests=uncallable_count,
            supplier_budgets=budgets,
            components=components,
        )

    def _lookup(self, group: _RequestGroup) -> CacheLookup:
        if group.namespace is None or group.cache_key is None:
            return CacheLookup("miss", None, None)
        lookup = self.cache.get(group.namespace, group.cache_key, allow_stale=True)
        if lookup.payload is None or group.client is None:
            return lookup
        try:
            raw = RawSupplierResponse.model_validate(lookup.payload)
            group.client.normalize(raw, group.query)
        except Exception:
            return CacheLookup("miss", None, None)
        return lookup

    def _project_group(self, group: _RequestGroup, lookup: CacheLookup) -> SupplierPreflight:
        configured = bool(group.client and group.client.configured)
        usable_without_api = lookup.state == "fresh" or (
            lookup.state == "stale" and (self.settings.cache_only or not configured)
        )
        will_call = configured and not self.settings.cache_only and lookup.state != "fresh"
        if lookup.state == "fresh":
            reason = "fresh_cache"
        elif lookup.state == "stale" and will_call:
            reason = "stale_cache_refresh"
        elif lookup.state == "stale":
            reason = "stale_cache_fallback"
        elif self.settings.cache_only:
            reason = "cache_only_miss"
        elif not configured:
            reason = "credentials_missing"
        else:
            reason = "cache_miss"
        return SupplierPreflight(
            supplier=group.supplier,
            configured=configured,
            request_key=group.cache_key[:16] if group.cache_key else None,
            shared_component_count=len(group.component_indexes),
            cache_state=lookup.state,
            cache_age_seconds=lookup.age_seconds,
            will_call_api=will_call,
            estimated_api_calls=(group.client.planned_api_calls(group.query) if will_call and group.client else 0),
            retry_worst_case_api_calls=(
                group.client.retry_worst_case_api_calls(group.query)
                if will_call and group.client
                else 0
            ),
            usable_without_api=usable_without_api,
            reason=reason,
        )

    def _budget_projection(
        self,
        supplier: Supplier,
        estimated_calls: int,
        worst_calls: int,
    ) -> SupplierBudgetProjection:
        usage = self.budget.usage(supplier)
        daily_remaining = (
            None if usage.daily_limit is None else max(0, usage.daily_limit - usage.daily_used)
        )
        minute_remaining = (
            None if usage.minute_limit is None else max(0, usage.minute_limit - usage.minute_used)
        )

        def within(projected: int) -> bool:
            return (daily_remaining is None or projected <= daily_remaining) and (
                minute_remaining is None or projected <= minute_remaining
            )

        return SupplierBudgetProjection(
            supplier=supplier,
            daily_used=usage.daily_used,
            daily_limit=usage.daily_limit,
            daily_remaining=daily_remaining,
            minute_used=usage.minute_used,
            minute_limit=usage.minute_limit,
            minute_remaining=minute_remaining,
            estimated_calls=estimated_calls,
            retry_worst_case_calls=worst_calls,
            estimated_within_limits=within(estimated_calls),
            retry_worst_case_within_limits=within(worst_calls),
        )
