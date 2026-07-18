from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any

from .contract import SearchBatchInput

from .budget import ApiBudgetManager, QuotaExceeded
from .cache import SQLiteCache, stable_cache_key
from .matcher import CandidateMatcher, infer_supplier_part_type, manufacturers_compatible
from .models import (
    BatchSearchResult,
    BatchPreflight,
    CandidateMatch,
    ComponentSearchResult,
    InputCorrection,
    MatchStatus,
    PlannedQuery,
    RawSupplierResponse,
    SearchMode,
    Supplier,
    SupplierSearchResult,
)
from .normalization import compact_mpn
from .planner import QueryPlanner
from .preflight import PreflightAnalyzer
from .request_cache import supplier_cache_coordinates
from .routing import suppliers_for_query
from .settings import Settings
from .singleflight import AsyncSingleFlight
from .suppliers import DigiKeyClient, MouserClient, SupplierClient, UniKeyICClient


class JobBudgetExceeded(RuntimeError):
    pass


@dataclass(slots=True)
class _JobCallBudget:
    maximum: int
    persistent_budget: ApiBudgetManager
    used: int = 0
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def reserve(self, supplier: Supplier) -> None:
        async with self._lock:
            if self.used >= self.maximum:
                raise JobBudgetExceeded(f"job API call limit ({self.maximum}) exhausted")
            # This transaction is deliberately inside the same lock: a rejected
            # supplier quota must not consume the per-job allowance.
            self.persistent_budget.reserve(supplier)
            self.used += 1


class SearchService:
    """Cache-first supplier orchestration and deterministic local verification."""

    _STATUS_ORDER = {
        MatchStatus.VERIFIED_EXACT: 0,
        MatchStatus.VERIFIED_VARIANT: 1,
        MatchStatus.SPEC_COMPATIBLE: 2,
        MatchStatus.INPUT_CONFLICT: 3,
        # Neither state is accepted. Rank them in the same bucket so the
        # candidate with more verified BOM evidence is shown first instead of
        # an almost-empty partial result hiding a well-explained conflict.
        MatchStatus.SPEC_PARTIAL: 4,
        MatchStatus.AMBIGUOUS: 4,
    }
    _PUBLIC_CANDIDATES_PER_SUPPLIER = 4

    def __init__(
        self,
        settings: Settings,
        *,
        clients: list[SupplierClient] | None = None,
        cache: SQLiteCache | None = None,
        budget: ApiBudgetManager | None = None,
    ) -> None:
        self.settings = settings
        self.cache = cache or SQLiteCache(settings.cache_path)
        self.budget = budget or ApiBudgetManager(settings.cache_path, settings.quotas)
        self.planner = QueryPlanner()
        self.matcher = CandidateMatcher()
        self.singleflight = AsyncSingleFlight()
        supplied_clients = clients if clients is not None else self._default_clients(settings)
        self.clients = {client.supplier: client for client in supplied_clients}
        concurrency = {
            Supplier.DIGIKEY: settings.digikey_concurrency,
            Supplier.MOUSER: settings.mouser_concurrency,
            Supplier.UNIKEYIC: settings.unikeyic_concurrency,
        }
        self._semaphores = {
            supplier: asyncio.Semaphore(
                max(1, concurrency.get(supplier) or settings.supplier_concurrency)
            )
            for supplier in self.clients
        }
        digikey_concurrency = max(
            1,
            concurrency[Supplier.DIGIKEY] or settings.supplier_concurrency,
        )
        default_identity_concurrency = max(1, digikey_concurrency // 2)
        self._digikey_lane_semaphores = {
            SearchMode.IDENTITY: asyncio.Semaphore(
                settings.digikey_identity_concurrency or default_identity_concurrency
            ),
            SearchMode.PARAMETRIC: asyncio.Semaphore(
                settings.digikey_parametric_concurrency
                or max(1, digikey_concurrency - default_identity_concurrency)
            ),
        }

    @staticmethod
    def _default_clients(settings: Settings) -> list[SupplierClient]:
        return [
            DigiKeyClient(
                client_id=settings.digikey_client_id,
                client_secret=settings.digikey_client_secret,
                account_id=settings.digikey_account_id,
                base_url=settings.digikey_base_url,
                token_url=settings.digikey_token_url,
                timeout_seconds=settings.request_timeout_seconds,
            ),
            MouserClient(
                api_key=settings.mouser_api_key,
                base_url=settings.mouser_base_url,
                timeout_seconds=settings.request_timeout_seconds,
            ),
            UniKeyICClient(
                api_key=settings.unikeyic_api_key,
                base_url=settings.unikeyic_base_url,
                timeout_seconds=settings.request_timeout_seconds,
            ),
        ]

    async def close(self) -> None:
        await asyncio.gather(*(client.close() for client in self.clients.values()))

    async def __aenter__(self) -> "SearchService":
        return self

    async def __aexit__(self, *_args: object) -> None:
        await self.close()

    async def search_batch(self, batch: SearchBatchInput) -> BatchSearchResult:
        started = time.perf_counter()
        plans = [self.planner.plan(component) for component in batch.components]
        groups: dict[str, list[tuple[int, PlannedQuery]]] = {}
        for index, plan in enumerate(plans):
            key = stable_cache_key(plan.cache_payload())
            groups.setdefault(key, []).append((index, plan))

        job_budget = _JobCallBudget(self.settings.max_api_calls_per_job, self.budget)
        mouser_prefetch = asyncio.create_task(self._prefetch_mouser_exact(plans, job_budget))
        tasks = {
            key: asyncio.create_task(
                self.search_component(
                    items[0][1],
                    job_budget=job_budget,
                    supplier_barriers=(
                        {Supplier.MOUSER: mouser_prefetch}
                        if items[0][1].mode == SearchMode.IDENTITY
                        else None
                    ),
                )
            )
            for key, items in groups.items()
        }
        all_tasks = set(tasks.values()) | {mouser_prefetch}
        done, pending = await asyncio.wait(
            all_tasks,
            timeout=self.settings.job_timeout_seconds,
        )
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)

        unique_results: dict[str, ComponentSearchResult] = {}
        for key, task in tasks.items():
            query = groups[key][0][1]
            if task not in done or task.cancelled():
                unique_results[key] = self._batch_failure_result(
                    query,
                    error_type="job_timeout",
                    message=(
                        f"공급사 검색이 작업 시간 상한 "
                        f"{self.settings.job_timeout_seconds:g}초를 초과했습니다."
                    ),
                )
                continue
            try:
                unique_results[key] = self._compact_component_result(task.result())
            except Exception as exc:  # Batch isolation: preserve every component row.
                unique_results[key] = self._batch_failure_result(
                    query,
                    error_type=type(exc).__name__,
                    message="공급사 검색 작업을 완료하지 못했습니다.",
                )

        prefetched_requests = 0
        if mouser_prefetch in done and not mouser_prefetch.cancelled():
            try:
                prefetched_requests = mouser_prefetch.result()
            except Exception:
                prefetched_requests = 0

        component_results: list[ComponentSearchResult | None] = [None] * len(plans)
        for key, items in groups.items():
            result = unique_results[key]
            for offset, (index, plan) in enumerate(items):
                source_component = batch.components[index]
                warnings = list(result.warnings)
                api_calls = result.api_calls
                if offset:
                    warnings.append("동일 검색 조건을 배치 내에서 병합해 공급사 호출을 재사용했습니다.")
                    api_calls = 0
                component_results[index] = result.model_copy(
                    update={
                        "component_id": plan.component_id,
                        "reference_designators": source_component.reference_designators,
                        "source_rows_1based": source_component.source_rows_1based,
                        "query": plan,
                        "api_calls": api_calls,
                        "warnings": warnings,
                    },
                    deep=True,
                )

        completed = [item for item in component_results if item is not None]
        cache_hits = sum(
            1
            for result in unique_results.values()
            for supplier_result in result.supplier_results
            if supplier_result.cache_state in {"fresh", "stale", "coalesced"}
        )
        return BatchSearchResult(
            source_file=batch.source_file,
            components=completed,
            unique_query_count=len(groups),
            api_calls=job_budget.used,
            cache_hits=cache_hits,
            prefetched_requests=prefetched_requests,
            elapsed_ms=(time.perf_counter() - started) * 1_000,
        )

    @classmethod
    def _compact_component_result(cls, result: ComponentSearchResult) -> ComponentSearchResult:
        """Keep the data consumed by the web drawer without duplicating raw products.

        Matching and corroboration run against the complete supplier response first.
        The raw response remains in SQLite; the public batch result needs only the
        representative candidate plus three alternates for each supplier.
        """
        counts: dict[Supplier, int] = {}
        candidates: list[CandidateMatch] = []
        for candidate in result.candidates:
            supplier = candidate.product.supplier
            used = counts.get(supplier, 0)
            if used >= cls._PUBLIC_CANDIDATES_PER_SUPPLIER:
                continue
            counts[supplier] = used + 1
            candidates.append(candidate)
        supplier_results = [
            supplier_result.model_copy(update={"products": []}, deep=False)
            for supplier_result in result.supplier_results
        ]
        return result.model_copy(
            update={"candidates": candidates, "supplier_results": supplier_results},
            deep=False,
        )

    @staticmethod
    def _batch_failure_result(
        query: PlannedQuery,
        *,
        error_type: str,
        message: str,
    ) -> ComponentSearchResult:
        return ComponentSearchResult(
            component_id=query.component_id,
            mode=query.mode,
            status=MatchStatus.SUPPLIER_ERROR,
            query=query,
            supplier_results=[
                SupplierSearchResult(
                    supplier=supplier,
                    error_type=error_type,
                    error_message=message,
                )
                for supplier in suppliers_for_query(query)
            ],
            warnings=[message],
        )

    def preflight_batch(self, batch: SearchBatchInput) -> BatchPreflight:
        return PreflightAnalyzer(
            self.settings,
            self.cache,
            self.budget,
            self.clients,
            self.planner,
        ).analyze(batch)

    async def search_component(
        self,
        query: PlannedQuery,
        *,
        job_budget: _JobCallBudget | None = None,
        supplier_barriers: dict[Supplier, asyncio.Task[int]] | None = None,
    ) -> ComponentSearchResult:
        started = time.perf_counter()
        result = await self._search_component_impl(
            query,
            job_budget=job_budget,
            supplier_barriers=supplier_barriers,
        )
        return result.model_copy(
            update={"elapsed_ms": (time.perf_counter() - started) * 1_000},
            deep=True,
        )

    async def _search_component_impl(
        self,
        query: PlannedQuery,
        *,
        job_budget: _JobCallBudget | None = None,
        supplier_barriers: dict[Supplier, asyncio.Task[int]] | None = None,
    ) -> ComponentSearchResult:
        if query.mode == SearchMode.INSUFFICIENT:
            return ComponentSearchResult(
                component_id=query.component_id,
                mode=query.mode,
                status=MatchStatus.INSUFFICIENT_INPUT,
                query=query,
                warnings=["부품 식별자 또는 검증 가능한 스펙이 부족합니다."],
            )

        budget = job_budget or _JobCallBudget(self.settings.max_api_calls_per_job, self.budget)
        suppliers = suppliers_for_query(query)
        tasks = [
            self._search_supplier_after_barrier(
                supplier,
                query,
                budget,
                (supplier_barriers or {}).get(supplier),
            )
            for supplier in suppliers
        ]
        supplier_results = await asyncio.gather(*tasks)

        candidates = [
            self.matcher.evaluate(query, product)
            for result in supplier_results
            for product in result.products
        ]
        candidates = self._add_corroboration(candidates)
        candidates.sort(key=self._candidate_sort_key)
        input_corrections = self._input_corrections(query, candidates)

        if candidates:
            status = candidates[0].status
        elif any(result.error_type is None for result in supplier_results):
            status = MatchStatus.NOT_FOUND
        else:
            status = MatchStatus.SUPPLIER_ERROR

        warnings: list[str] = []
        for result in supplier_results:
            if result.cache_state == "stale":
                warnings.append(f"{result.supplier.value}: 만료 캐시를 대체 결과로 사용했습니다.")
            if result.error_type:
                warnings.append(f"{result.supplier.value}: {result.error_type}")
        return ComponentSearchResult(
            component_id=query.component_id,
            mode=query.mode,
            status=status,
            query=query,
            candidates=candidates,
            input_corrections=input_corrections,
            supplier_results=supplier_results,
            api_calls=sum(result.api_calls for result in supplier_results),
            warnings=warnings,
        )

    async def _search_supplier_after_barrier(
        self,
        supplier: Supplier,
        query: PlannedQuery,
        job_budget: _JobCallBudget,
        barrier: asyncio.Task[int] | None,
    ) -> SupplierSearchResult:
        if barrier is not None:
            await asyncio.shield(barrier)
        return await self._search_supplier(supplier, query, job_budget)

    async def _prefetch_mouser_exact(
        self,
        plans: list[PlannedQuery],
        job_budget: _JobCallBudget,
    ) -> int:
        client = self.clients.get(Supplier.MOUSER)
        if (
            not isinstance(client, MouserClient)
            or not client.configured
            or self.settings.cache_only
        ):
            return 0
        unique: dict[str, PlannedQuery] = {}
        for query in plans:
            if query.mode != SearchMode.IDENTITY or not query.part_number:
                continue
            namespace, cache_key = supplier_cache_coordinates(client, query)
            if self._cached_result(client, query, namespace, cache_key, allow_stale=False) is not None:
                continue
            unique.setdefault(cache_key, query)
        queries = list(unique.values())
        if len(queries) < 2:
            return 0

        async def reserve_call() -> None:
            await job_budget.reserve(Supplier.MOUSER)

        async def store(query: PlannedQuery, raw: RawSupplierResponse) -> bool:
            if not raw.ok:
                return False
            namespace, cache_key = supplier_cache_coordinates(client, query)
            result = self._result_from_raw(
                client,
                raw,
                query,
                cache_state="miss",
                cache_age_seconds=0.0,
                api_calls=0,
            )
            if result.error_type is not None:
                return False
            self.cache.put(
                namespace,
                cache_key,
                raw.model_dump(mode="json"),
                ttl_seconds=self._cache_ttl(query, negative=not result.products),
                stale_ttl_seconds=self.settings.stale_ttl_seconds,
            )
            return True

        async def fallback(query: PlannedQuery) -> int:
            try:
                async with self._semaphores[Supplier.MOUSER]:
                    raw = await client.fetch_keyword(query, reserve_call=reserve_call)
            except (QuotaExceeded, JobBudgetExceeded):
                return 0
            return int(await store(query, raw))

        async def fetch_chunk(chunk: list[PlannedQuery]) -> int:
            try:
                async with self._semaphores[Supplier.MOUSER]:
                    raw = await client.fetch_exact_batch(chunk, reserve_call=reserve_call)
            except (QuotaExceeded, JobBudgetExceeded):
                return 0
            if not raw.ok:
                return 0
            stored = 0
            missing: list[PlannedQuery] = []
            for query in chunk:
                filtered = client.exact_batch_result(raw, query)
                if client.normalize(filtered, query):
                    stored += int(await store(query, filtered))
                else:
                    missing.append(query)
            if missing:
                stored += sum(await asyncio.gather(*(fallback(query) for query in missing)))
            return stored

        chunks = [queries[index : index + 10] for index in range(0, len(queries), 10)]
        try:
            return sum(await asyncio.gather(*(fetch_chunk(chunk) for chunk in chunks)))
        except Exception:
            # Prefetch is an optimization boundary; normal per-component search remains available.
            return 0

    async def _search_supplier(
        self,
        supplier: Supplier,
        query: PlannedQuery,
        job_budget: _JobCallBudget,
    ) -> SupplierSearchResult:
        started = time.perf_counter()
        result = await self._search_supplier_impl(supplier, query, job_budget)
        return result.model_copy(
            update={"operation_elapsed_ms": (time.perf_counter() - started) * 1_000},
            deep=True,
        )

    @asynccontextmanager
    async def _supplier_slot(
        self,
        supplier: Supplier,
        query: PlannedQuery,
    ) -> AsyncIterator[None]:
        """Reserve a supplier slot without letting one DigiKey mode starve the other.

        The mode-specific semaphore is deliberately acquired before the global
        DigiKey semaphore. Otherwise queued identity work could occupy every
        global slot while merely waiting for its own lane, recreating the
        head-of-line blocking that the split is intended to remove.
        """

        global_semaphore = self._semaphores[supplier]
        if supplier != Supplier.DIGIKEY:
            async with global_semaphore:
                yield
            return

        lane = (
            SearchMode.IDENTITY
            if query.mode == SearchMode.IDENTITY
            else SearchMode.PARAMETRIC
        )
        async with self._digikey_lane_semaphores[lane]:
            async with global_semaphore:
                yield

    async def _search_supplier_impl(
        self,
        supplier: Supplier,
        query: PlannedQuery,
        job_budget: _JobCallBudget,
    ) -> SupplierSearchResult:
        client = self.clients.get(supplier)
        if client is None:
            return SupplierSearchResult(
                supplier=supplier,
                error_type="client_unavailable",
                error_message="supplier client is unavailable",
            )
        namespace, cache_key = supplier_cache_coordinates(client, query)

        cached = self._cached_result(client, query, namespace, cache_key, allow_stale=False)
        if cached is not None:
            return cached

        async def execute() -> SupplierSearchResult:
            # A second check closes the race between the first lookup and
            # single-flight registration.
            fresh = self._cached_result(client, query, namespace, cache_key, allow_stale=False)
            if fresh is not None:
                return fresh
            stale = self._cached_result(client, query, namespace, cache_key, allow_stale=True)
            if self.settings.cache_only:
                return stale or SupplierSearchResult(
                    supplier=supplier,
                    error_type="cache_miss",
                    error_message="cache-only mode has no usable entry",
                )
            if not client.configured:
                return stale or SupplierSearchResult(
                    supplier=supplier,
                    error_type="not_configured",
                    error_message="supplier credentials are not configured",
                )

            call_count = 0

            async def reserve_call() -> None:
                nonlocal call_count
                await job_budget.reserve(supplier)
                call_count += 1

            try:
                async with self._supplier_slot(supplier, query):
                    raw = await client.fetch(query, reserve_call=reserve_call)
            except (QuotaExceeded, JobBudgetExceeded) as exc:
                if stale is not None:
                    return stale.model_copy(
                        update={
                            "api_call_performed": call_count > 0,
                            "api_calls": call_count,
                            "error_type": "quota_exhausted",
                            "error_message": str(exc),
                        }
                    )
                return SupplierSearchResult(
                    supplier=supplier,
                    error_type="quota_exhausted",
                    error_message=str(exc),
                    api_call_performed=call_count > 0,
                    api_calls=call_count,
                )
            except Exception as exc:  # Supplier adapters are isolation boundaries.
                raw = RawSupplierResponse(
                    supplier=supplier,
                    ok=False,
                    error_type=type(exc).__name__,
                    error_message="supplier adapter failed",
                )

            if raw.ok:
                result = self._result_from_raw(
                    client,
                    raw,
                    query,
                    cache_state="miss",
                    cache_age_seconds=0.0,
                    api_calls=call_count,
                )
                if result.error_type is None:
                    ttl = self._cache_ttl(query, negative=not result.products)
                    self.cache.put(
                        namespace,
                        cache_key,
                        raw.model_dump(mode="json"),
                        ttl_seconds=ttl,
                        stale_ttl_seconds=self.settings.stale_ttl_seconds,
                    )
                return result
            if stale is not None and self.settings.stale_if_error:
                return stale.model_copy(
                    update={
                        "api_call_performed": call_count > 0,
                        "api_calls": call_count,
                        "error_type": raw.error_type,
                        "error_message": raw.error_message,
                    }
                )
            return SupplierSearchResult(
                supplier=supplier,
                error_type=raw.error_type or "supplier_error",
                error_message=raw.error_message,
                source_latency_ms=raw.latency_ms,
                source_fetched_at=raw.fetched_at,
                api_call_performed=call_count > 0,
                api_calls=call_count,
            )

        result, joined = await self.singleflight.run(f"{namespace}:{cache_key}", execute)
        if joined:
            state = "coalesced" if result.cache_state in {"miss", "fresh", "coalesced"} else result.cache_state
            return result.model_copy(
                update={"cache_state": state, "api_call_performed": False, "api_calls": 0},
                deep=True,
            )
        return result

    def _cached_result(
        self,
        client: SupplierClient,
        query: PlannedQuery,
        namespace: str,
        cache_key: str,
        *,
        allow_stale: bool,
    ) -> SupplierSearchResult | None:
        lookup = self.cache.get(namespace, cache_key, allow_stale=allow_stale)
        if lookup.payload is None:
            return None
        try:
            raw = RawSupplierResponse.model_validate(lookup.payload)
            return self._result_from_raw(
                client,
                raw,
                query,
                cache_state=lookup.state,
                cache_age_seconds=lookup.age_seconds,
                api_calls=0,
            )
        except Exception:
            # Schema-corrupt cache entries are discarded, never trusted.
            self.cache.delete(namespace, cache_key)
            return None

    @staticmethod
    def _result_from_raw(
        client: SupplierClient,
        raw: RawSupplierResponse,
        query: PlannedQuery,
        *,
        cache_state: str,
        cache_age_seconds: float | None,
        api_calls: int,
    ) -> SupplierSearchResult:
        try:
            products = client.normalize(raw, query)
        except Exception as exc:
            return SupplierSearchResult(
                supplier=client.supplier,
                error_type="normalization_error",
                error_message=type(exc).__name__,
                cache_state=cache_state,
                cache_age_seconds=cache_age_seconds,
                source_latency_ms=raw.latency_ms,
                source_fetched_at=raw.fetched_at,
                api_call_performed=api_calls > 0,
                api_calls=api_calls,
            )
        return SupplierSearchResult(
            supplier=client.supplier,
            products=products,
            cache_state=cache_state,
            cache_age_seconds=cache_age_seconds,
            source_latency_ms=raw.latency_ms,
            source_fetched_at=raw.fetched_at,
            api_call_performed=api_calls > 0,
            api_calls=api_calls,
        )

    def _cache_ttl(self, query: PlannedQuery, *, negative: bool) -> int:
        if negative:
            return (
                self.settings.negative_exact_ttl_seconds
                if query.mode == SearchMode.IDENTITY
                else self.settings.negative_keyword_ttl_seconds
            )
        return (
            self.settings.raw_cache_ttl_seconds
            if query.mode == SearchMode.IDENTITY
            else self.settings.keyword_cache_ttl_seconds
        )

    @classmethod
    def _candidate_sort_key(cls, candidate: CandidateMatch) -> tuple[Any, ...]:
        stock = max(
            (offer.stock for offer in candidate.product.offers if offer.stock is not None),
            default=-1,
        )
        primary_conflicts = sum(
            conflict
            in {
                "part_number_mismatch",
                "manufacturer_mismatch",
                "part_type_mismatch",
                "resistance_ohm_mismatch",
                "capacitance_f_mismatch",
                "inductance_h_mismatch",
                "frequency_hz_mismatch",
                "package_mismatch",
            }
            for conflict in candidate.conflicts
        )
        return (
            cls._STATUS_ORDER.get(candidate.status, 99),
            -candidate.identity_confidence,
            -candidate.specification_confidence,
            primary_conflicts,
            len(candidate.conflicts),
            len(candidate.missing_requirements),
            -len(candidate.corroborating_suppliers),
            -stock,
            candidate.product.supplier.value,
            candidate.product.manufacturer_part_number,
        )

    @staticmethod
    def _add_corroboration(candidates: list[CandidateMatch]) -> list[CandidateMatch]:
        result: list[CandidateMatch] = []
        for candidate in candidates:
            product = candidate.product
            suppliers = {
                other.product.supplier
                for other in candidates
                if compact_mpn(other.product.manufacturer_part_number)
                == compact_mpn(product.manufacturer_part_number)
                and manufacturers_compatible(product.manufacturer, other.product.manufacturer) is not False
            }
            result.append(
                candidate.model_copy(
                    update={"corroborating_suppliers": sorted(suppliers, key=lambda item: item.value)},
                    deep=True,
                )
            )
        return result

    @staticmethod
    def _input_corrections(
        query: PlannedQuery,
        candidates: list[CandidateMatch],
    ) -> list[InputCorrection]:
        """Suggest, but never mutate, a BOM value contradicted by supplier consensus."""

        requirement = query.requirements.get("part_type")
        bom_value = str((requirement.normalized_value if requirement else None) or "").casefold()
        if (
            query.mode != SearchMode.IDENTITY
            or not query.part_number
            or requirement is None
            or not requirement.hard
            or not bom_value
        ):
            return []

        by_suggestion: dict[str, dict[Supplier, CandidateMatch]] = {}
        for candidate in candidates:
            if (
                candidate.identity_confidence < 0.9
                or "part_type_mismatch" not in candidate.conflicts
            ):
                continue
            suggested = infer_supplier_part_type(candidate.product)
            if not suggested or suggested == bom_value:
                continue
            supplier_candidates = by_suggestion.setdefault(suggested, {})
            current = supplier_candidates.get(candidate.product.supplier)
            if current is None or candidate.identity_confidence > current.identity_confidence:
                supplier_candidates[candidate.product.supplier] = candidate

        # Any contradictory supplier taxonomy blocks the correction even when
        # another value has two votes. Unknown/generic categories simply abstain.
        if len(by_suggestion) != 1:
            return []
        suggested_value, supplier_candidates = next(iter(by_suggestion.items()))
        if len(supplier_candidates) < 2:
            return []
        probabilities = [
            0.90 if candidate.identity_confidence >= 1.0 else 0.80
            for candidate in supplier_candidates.values()
        ]
        remaining_probability = 1.0
        for probability in probabilities:
            remaining_probability *= 1.0 - probability
        error_probability = min(0.995, 1.0 - remaining_probability)
        suppliers = sorted(supplier_candidates, key=lambda item: item.value)
        return [
            InputCorrection(
                field="part_type",
                bom_value=bom_value,
                suggested_value=suggested_value,
                bom_error_probability=round(error_probability, 3),
                evidence_suppliers=suppliers,
                evidence_count=len(suppliers),
                reasons=[
                    "bom_value_preserved",
                    "exact_mpn_supplier_consensus",
                    "supplier_category_consensus",
                ],
            )
        ]
