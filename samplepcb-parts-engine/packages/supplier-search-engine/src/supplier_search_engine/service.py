from __future__ import annotations

import asyncio
import math
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any

from .contract import SearchBatchInput

from .budget import ApiBudgetManager, QuotaExceeded
from .cache import SQLiteCache, stable_cache_key
from .matcher import (
    CandidateMatcher,
    canonical_manufacturer,
    finalize_candidate_decisions,
    infer_supplier_part_type,
)
from .models import (
    BatchSearchResult,
    BatchPreflight,
    CandidateMatch,
    ComponentSearchTrace,
    ComponentSearchTraceAttempt,
    ComponentSearchResult,
    InputCorrection,
    LifecycleState,
    MatchRelation,
    MatchStatus,
    PlannedQuery,
    ProcurementPolicyInput,
    RawSupplierResponse,
    SearchMode,
    SearchTraceSource,
    SelectionEligibility,
    SelectionRecommendation,
    Supplier,
    SupplierSearchTraceAttempt,
    SupplierSearchResult,
)
from .normalization import compact_mpn
from .planner import QueryPlanner
from .preflight import PreflightAnalyzer
from .procurement import apply_procurement_decisions
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
                    procurement_policy=batch.procurement_policy,
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
                    procurement_policy=batch.procurement_policy,
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
                    procurement_policy=batch.procurement_policy,
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
                final_query = (
                    result.query.model_copy(
                        update={"component_id": plan.component_id},
                        deep=True,
                    )
                    if result.query is not None
                    else plan
                )
                initial_query = (
                    result.initial_query.model_copy(
                        update={"component_id": plan.component_id},
                        deep=True,
                    )
                    if result.initial_query is not None
                    else None
                )
                if offset:
                    warnings.append("동일 검색 조건을 배치 내에서 병합해 공급사 호출을 재사용했습니다.")
                    api_calls = 0
                search_trace = result.search_trace
                if offset and search_trace is not None:
                    search_trace = search_trace.model_copy(
                        update={
                            "attempts": [
                                attempt.model_copy(
                                    update={"source": "batch_reuse", "api_calls": 0},
                                    deep=True,
                                )
                                for attempt in search_trace.attempts
                            ]
                        },
                        deep=True,
                    )
                component_results[index] = result.model_copy(
                    update={
                        "component_id": plan.component_id,
                        "reference_designators": source_component.reference_designators,
                        "source_rows_1based": source_component.source_rows_1based,
                        "query": final_query,
                        "initial_query": initial_query,
                        "search_trace": search_trace,
                        "api_calls": api_calls,
                        "warnings": warnings,
                    },
                    deep=True,
                )

        completed = [item for item in component_results if item is not None]
        cache_hits = sum(
            1
            for result in unique_results.values()
            for supplier_result in (
                *result.initial_supplier_results,
                *result.supplier_results,
            )
            if supplier_result.cache_state in {"fresh", "stale", "coalesced"}
        )
        return BatchSearchResult(
            procurement_policy=batch.procurement_policy,
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
        """Drop duplicate raw product arrays while preserving every decided candidate."""
        supplier_results = [
            supplier_result.model_copy(update={"products": []}, deep=False)
            for supplier_result in result.supplier_results
        ]
        initial_supplier_results = [
            supplier_result.model_copy(update={"products": []}, deep=False)
            for supplier_result in result.initial_supplier_results
        ]
        return result.model_copy(
            update={
                "supplier_results": supplier_results,
                "initial_supplier_results": initial_supplier_results,
            },
            deep=False,
        )

    @staticmethod
    def _batch_failure_result(
        query: PlannedQuery,
        *,
        procurement_policy: ProcurementPolicyInput | None = None,
        error_type: str,
        message: str,
    ) -> ComponentSearchResult:
        _, procurement_decision = apply_procurement_decisions(
            query,
            [],
            procurement_policy or ProcurementPolicyInput(),
        )
        supplier_results = [
            SupplierSearchResult(
                supplier=supplier,
                error_type=error_type,
                error_message=message,
            )
            for supplier in suppliers_for_query(query)
        ]
        return ComponentSearchResult(
            component_id=query.component_id,
            mode=query.mode,
            status=MatchStatus.SUPPLIER_ERROR,
            query=query,
            supplier_results=supplier_results,
            procurement_decision=procurement_decision,
            search_trace=SearchService._component_search_trace(
                query, supplier_results
            ),
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
        procurement_policy: ProcurementPolicyInput | None = None,
        job_budget: _JobCallBudget | None = None,
        supplier_barriers: dict[Supplier, asyncio.Task[int]] | None = None,
    ) -> ComponentSearchResult:
        started = time.perf_counter()
        result = await self._search_component_impl(
            query,
            procurement_policy=procurement_policy or ProcurementPolicyInput(),
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
        procurement_policy: ProcurementPolicyInput,
        job_budget: _JobCallBudget | None = None,
        supplier_barriers: dict[Supplier, asyncio.Task[int]] | None = None,
    ) -> ComponentSearchResult:
        if query.mode == SearchMode.INSUFFICIENT:
            _, procurement_decision = apply_procurement_decisions(
                query, [], procurement_policy
            )
            return ComponentSearchResult(
                component_id=query.component_id,
                mode=query.mode,
                status=MatchStatus.INSUFFICIENT_INPUT,
                query=query,
                search_trace=self._component_search_trace(query, []),
                procurement_decision=procurement_decision,
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
        candidates = finalize_candidate_decisions(query, candidates)
        candidates = self._add_corroboration(candidates)
        candidates = self._assign_technical_review_ranks(query, candidates)
        candidates = self._assign_selection_recommendations(candidates, query)
        candidates, procurement_decision = apply_procurement_decisions(
            query, candidates, procurement_policy
        )
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
        primary = ComponentSearchResult(
            component_id=query.component_id,
            mode=query.mode,
            status=status,
            query=query,
            search_trace=self._component_search_trace(query, supplier_results),
            candidates=candidates,
            input_corrections=input_corrections,
            supplier_results=supplier_results,
            procurement_decision=procurement_decision,
            api_calls=sum(result.api_calls for result in supplier_results),
            warnings=warnings,
        )
        fallback_query = self.planner.parametric_fallback(query)
        identity_resolved = any(
            candidate.identity_confidence >= 0.9 for candidate in primary.candidates
        )
        if (
            fallback_query is None
            or primary.status == MatchStatus.SUPPLIER_ERROR
            or identity_resolved
        ):
            return primary

        fallback = await self._search_component_impl(
            fallback_query,
            procurement_policy=procurement_policy,
            job_budget=budget,
        )
        return fallback.model_copy(
            update={
                "component_id": query.component_id,
                "initial_query": query,
                "identity_fallback": True,
                "search_trace": self._component_search_trace(
                    query,
                    primary.supplier_results,
                    fallback_query=fallback.query or fallback_query,
                    fallback_results=fallback.supplier_results,
                ),
                "initial_supplier_results": primary.supplier_results,
                "api_calls": primary.api_calls + fallback.api_calls,
                "warnings": list(
                    dict.fromkeys(
                        [
                            *primary.warnings,
                            f"품번 '{query.part_number}'과 일치하는 후보가 없어 "
                            "확정 스펙으로 다시 검색했습니다.",
                            *fallback.warnings,
                        ]
                    )
                ),
            },
            deep=True,
        )

    @staticmethod
    def _query_text(query: PlannedQuery) -> str:
        return (query.part_number or query.keywords or "").strip()

    @staticmethod
    def _planned_strategy(query: PlannedQuery) -> str:
        if query.mode == SearchMode.IDENTITY:
            return "identity"
        if query.mode == SearchMode.HYBRID:
            return "hybrid"
        if query.mode == SearchMode.PARAMETRIC:
            return "parametric"
        return "insufficient"

    @staticmethod
    def _trace_source(result: SupplierSearchResult) -> SearchTraceSource:
        if result.cache_state == "fresh":
            if any(
                attempt.strategy == "identity_batch_exact"
                for attempt in result.search_attempts
            ):
                return "prefetch_cache"
            return "fresh_cache"
        if result.cache_state == "stale":
            return "stale_cache"
        if result.cache_state == "coalesced":
            return "coalesced"
        return "live_api" if result.api_calls > 0 else "not_executed"

    @classmethod
    def _component_search_trace(
        cls,
        primary_query: PlannedQuery,
        primary_results: list[SupplierSearchResult],
        *,
        fallback_query: PlannedQuery | None = None,
        fallback_results: list[SupplierSearchResult] | None = None,
    ) -> ComponentSearchTrace:
        staged = (
            ("primary", primary_query, primary_results),
            (
                "identity_fallback",
                fallback_query,
                fallback_results or [],
            ),
        )
        attempts: list[ComponentSearchTraceAttempt] = []
        for stage, query, results in staged:
            if query is None:
                continue
            for result in results:
                supplier_attempts = result.search_attempts
                if not supplier_attempts:
                    error_type = result.error_type
                    outcome = (
                        "budget_exhausted"
                        if error_type == "quota_exhausted"
                        else "skipped"
                        if error_type in {
                            "cache_miss",
                            "client_unavailable",
                            "not_configured",
                            "unsupported_search_mode",
                        }
                        else "error"
                        if error_type is not None
                        else "results"
                        if result.products
                        else "empty"
                    )
                    supplier_attempts = [
                        SupplierSearchTraceAttempt(
                            supplier=result.supplier,
                            strategy=cls._planned_strategy(query),
                            query=cls._query_text(query),
                            source=cls._trace_source(result),
                            outcome=outcome,
                            result_count=len(result.products),
                            api_calls=result.api_calls,
                            http_attempt_count=result.api_calls,
                            elapsed_ms=result.operation_elapsed_ms,
                            error_type=error_type,
                        )
                    ]
                for attempt in supplier_attempts:
                    attempts.append(
                        ComponentSearchTraceAttempt(
                            **attempt.model_dump(),
                            sequence=len(attempts) + 1,
                            stage=stage,
                        )
                    )
        return ComponentSearchTrace(
            primary_query=cls._query_text(primary_query),
            fallback_query=(
                cls._query_text(fallback_query) if fallback_query is not None else None
            ),
            fallback_used=fallback_query is not None,
            attempts=attempts,
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

        async def fallback(
            query: PlannedQuery,
            exact: RawSupplierResponse,
        ) -> int:
            try:
                async with self._semaphores[Supplier.MOUSER]:
                    raw = await client.fetch_keyword(
                        query,
                        reserve_call=reserve_call,
                        strategy="identity_keyword",
                        fallback_reason="batch_exact_no_result",
                    )
            except (QuotaExceeded, JobBudgetExceeded):
                return 0
            raw = raw.model_copy(
                update={
                    "latency_ms": exact.latency_ms + raw.latency_ms,
                    "http_attempt_count": (
                        exact.http_attempt_count + raw.http_attempt_count
                    ),
                    "request_trace": [*exact.request_trace, *raw.request_trace],
                },
                deep=True,
            )
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
            missing: list[tuple[PlannedQuery, RawSupplierResponse]] = []
            for query in chunk:
                filtered = client.exact_batch_result(raw, query)
                if client.normalize(filtered, query):
                    stored += int(await store(query, filtered))
                else:
                    missing.append((query, filtered))
            if missing:
                stored += sum(
                    await asyncio.gather(
                        *(fallback(query, exact) for query, exact in missing)
                    )
                )
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
                budget_attempt = SupplierSearchTraceAttempt(
                    supplier=supplier,
                    strategy=self._planned_strategy(query),
                    query=self._query_text(query),
                    source="live_api" if call_count > 0 else "not_executed",
                    outcome="budget_exhausted",
                    api_calls=call_count,
                    http_attempt_count=call_count,
                    fallback_reason="request_budget_exhausted",
                    error_type="quota_exhausted",
                )
                if stale is not None:
                    return stale.model_copy(
                        update={
                            "api_call_performed": call_count > 0,
                            "api_calls": call_count,
                            "error_type": "quota_exhausted",
                            "error_message": str(exc),
                            "search_attempts": [
                                budget_attempt,
                                *stale.search_attempts,
                            ],
                        }
                    )
                return SupplierSearchResult(
                    supplier=supplier,
                    error_type="quota_exhausted",
                    error_message=str(exc),
                    api_call_performed=call_count > 0,
                    api_calls=call_count,
                    search_attempts=[budget_attempt],
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
                failed = self._result_from_raw(
                    client,
                    raw,
                    query,
                    cache_state="miss",
                    cache_age_seconds=0.0,
                    api_calls=call_count,
                )
                return stale.model_copy(
                    update={
                        "api_call_performed": call_count > 0,
                        "api_calls": call_count,
                        "error_type": raw.error_type,
                        "error_message": raw.error_message,
                        "search_attempts": [
                            *failed.search_attempts,
                            *stale.search_attempts,
                        ],
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
            search_attempts = result.search_attempts
            if state == "coalesced":
                search_attempts = [
                    attempt.model_copy(
                        update={"source": "coalesced", "api_calls": 0},
                        deep=True,
                    )
                    for attempt in search_attempts
                ]
            return result.model_copy(
                update={
                    "cache_state": state,
                    "api_call_performed": False,
                    "api_calls": 0,
                    "search_attempts": search_attempts,
                },
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
        if cache_state == "fresh":
            source = (
                "prefetch_cache"
                if any(
                    attempt.strategy == "identity_batch_exact"
                    for attempt in raw.request_trace
                )
                else "fresh_cache"
            )
        elif cache_state == "stale":
            source = "stale_cache"
        elif cache_state == "coalesced":
            source = "coalesced"
        else:
            source = "live_api" if api_calls > 0 else "not_executed"
        search_attempts = [
            SupplierSearchTraceAttempt(
                supplier=client.supplier,
                strategy=attempt.strategy,
                query=attempt.query,
                source=source,
                outcome=attempt.outcome,
                result_count=attempt.result_count,
                api_calls=(attempt.http_attempt_count if source == "live_api" else 0),
                http_attempt_count=attempt.http_attempt_count,
                elapsed_ms=attempt.elapsed_ms,
                fallback_reason=attempt.fallback_reason,
                error_type=attempt.error_type,
            )
            for attempt in raw.request_trace
        ]
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
                search_attempts=search_attempts,
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
            search_attempts=search_attempts,
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
    def _candidate_sort_key(
        cls,
        candidate: CandidateMatch,
        query: PlannedQuery | None = None,
    ) -> tuple[Any, ...]:
        decision = candidate.decision
        eligibility_order = {
            SelectionEligibility.AUTOMATIC: 0,
            SelectionEligibility.MANUAL_REVIEW: 1,
            SelectionEligibility.BLOCKED: 2,
        }
        relation_order = {
            MatchRelation.EXACT: 0,
            MatchRelation.VARIANT: 1,
            MatchRelation.SPEC_COMPATIBLE: 2,
            MatchRelation.UNRESOLVED: 3,
        }
        lifecycle_order = {
            LifecycleState.ACTIVE: 0,
            LifecycleState.UNKNOWN: 1,
            LifecycleState.CAUTION: 2,
        }
        recommendation_order = {
            SelectionRecommendation.PRESELECT: 0,
            SelectionRecommendation.CANDIDATE_ONLY: 1,
            SelectionRecommendation.EXCLUDE: 2,
        }
        source_conflicts = sum(value.endswith("_source_conflict") for value in candidate.conflicts)
        actual_conflicts = sum(
            not value.endswith("_source_conflict") and value != "manufacturer_mismatch"
            for value in candidate.conflicts
        )
        required = decision.required_requirement_count
        verification_ratio = (
            decision.verified_requirement_count / required if required else 0.0
        )
        if decision.selection_eligibility == SelectionEligibility.MANUAL_REVIEW:
            review_rank = decision.technical_review_rank or 1_000_000
        else:
            review_rank = 0
        supplier_skus = ",".join(
            sorted(
                {
                    offer.supplier_sku
                    for offer in candidate.product.offers
                    if offer.supplier_sku
                }
            )
        )
        return (
            eligibility_order[decision.selection_eligibility],
            recommendation_order[decision.selection_recommendation],
            review_rank,
            relation_order[decision.match_relation],
            actual_conflicts,
            source_conflicts,
            len(candidate.missing_requirements),
            -verification_ratio,
            -decision.verified_requirement_count,
            -cls._exact_requirement_match_count(query, candidate),
            -candidate.identity_confidence,
            -candidate.specification_confidence,
            lifecycle_order[decision.lifecycle_state],
            canonical_manufacturer(candidate.product.manufacturer),
            compact_mpn(candidate.product.manufacturer_part_number),
            candidate.product.supplier.value,
            supplier_skus,
            decision.identity_key,
            decision.technical_evidence_key,
        )

    @staticmethod
    def _normalized_values_equal(expected: Any, actual: Any) -> bool:
        if isinstance(expected, bool) or isinstance(actual, bool):
            return expected is actual
        if isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
            scale = max(abs(float(expected)), abs(float(actual)))
            return math.isclose(
                float(expected),
                float(actual),
                rel_tol=1e-9,
                abs_tol=max(scale * 1e-12, 1e-18),
            )
        if isinstance(expected, list) and isinstance(actual, list):
            return len(expected) == len(actual) and all(
                SearchService._normalized_values_equal(left, right)
                for left, right in zip(expected, actual, strict=True)
            )
        if isinstance(expected, str) and isinstance(actual, str):
            return expected.strip().casefold() == actual.strip().casefold()
        return expected == actual

    @classmethod
    def _exact_requirement_match_count(
        cls,
        query: PlannedQuery | None,
        candidate: CandidateMatch,
    ) -> int:
        if query is None:
            return 0
        exact = 0
        for name, requirement in query.requirements.items():
            if not requirement.hard or requirement.normalized_value is None:
                continue
            if f"{name}_match" not in candidate.reasons:
                continue
            if name == "package":
                if candidate.package_comparison and candidate.package_comparison.relation in {
                    "exact",
                    "alias",
                }:
                    exact += 1
                continue
            comparison = candidate.spec_comparisons.get(name)
            if comparison is not None:
                if comparison.relation in {"exact", "alias"}:
                    exact += 1
                continue
            actual = candidate.product.normalized_specs.get(name)
            if name == "part_type" and actual is None:
                actual = infer_supplier_part_type(candidate.product)
            if cls._normalized_values_equal(requirement.normalized_value, actual):
                exact += 1
        return exact

    @staticmethod
    def _add_corroboration(candidates: list[CandidateMatch]) -> list[CandidateMatch]:
        result: list[CandidateMatch] = []
        for candidate in candidates:
            suppliers = {
                other.product.supplier
                for other in candidates
                if other.decision.identity_key == candidate.decision.identity_key
                and other.decision.technical_evidence_key
                == candidate.decision.technical_evidence_key
            }
            result.append(
                candidate.model_copy(
                    update={"corroborating_suppliers": sorted(suppliers, key=lambda item: item.value)},
                    deep=True,
                )
            )
        return result

    @classmethod
    def _assign_technical_review_ranks(
        cls,
        query: PlannedQuery,
        candidates: list[CandidateMatch],
    ) -> list[CandidateMatch]:
        """Dense-rank manual-review evidence groups by engine-owned technical order."""

        groups: dict[tuple[str, str], list[CandidateMatch]] = {}
        for candidate in candidates:
            decision = candidate.decision
            if not cls._technical_review_rank_eligible(query, candidate):
                continue
            key = (decision.identity_key, decision.technical_evidence_key)
            groups.setdefault(key, []).append(candidate)

        ordered_keys = sorted(
            groups,
            key=lambda key: min(
                cls._candidate_sort_key(candidate, query) for candidate in groups[key]
            ),
        )
        rank_by_key = {key: rank for rank, key in enumerate(ordered_keys, start=1)}

        ranked: list[CandidateMatch] = []
        for candidate in candidates:
            decision = candidate.decision
            key = (decision.identity_key, decision.technical_evidence_key)
            rank = (
                rank_by_key.get(key)
                if decision.selection_eligibility == SelectionEligibility.MANUAL_REVIEW
                else None
            )
            ranked.append(
                candidate.model_copy(
                    update={
                        "decision": decision.model_copy(
                            update={"technical_review_rank": rank},
                            deep=True,
                        )
                    },
                    deep=True,
                )
            )
        return ranked

    @staticmethod
    def _technical_review_rank_eligible(
        query: PlannedQuery,
        candidate: CandidateMatch,
    ) -> bool:
        decision = candidate.decision
        if decision.selection_eligibility != SelectionEligibility.MANUAL_REVIEW:
            return False
        if any(value.endswith("_source_conflict") for value in candidate.conflicts):
            return False
        if decision.match_relation in {MatchRelation.EXACT, MatchRelation.VARIANT}:
            return True

        required = {
            name
            for name, requirement in query.requirements.items()
            if requirement.hard and requirement.normalized_value is not None
        }
        verified = {
            reason.removesuffix("_match")
            for reason in candidate.reasons
            if reason.endswith("_match")
            and reason != "manufacturer_match"
            and not reason.startswith("manufacturer_part_number_")
        }
        if "tolerance_not_applicable_for_zero_ohm" in candidate.reasons:
            verified.add("tolerance_percent")
        technical_required = required - {"manufacturer", "part_number", "part_type"}
        return (
            required <= verified
            and technical_required <= verified
            and len(technical_required) >= 2
        )

    @classmethod
    def _assign_selection_recommendations(
        cls,
        candidates: list[CandidateMatch],
        query: PlannedQuery | None = None,
    ) -> list[CandidateMatch]:
        selectable_groups: dict[tuple[str, str], list[CandidateMatch]] = {}
        for candidate in candidates:
            if candidate.decision.selection_eligibility != SelectionEligibility.AUTOMATIC:
                continue
            key = (
                candidate.decision.identity_key,
                candidate.decision.technical_evidence_key,
            )
            selectable_groups.setdefault(key, []).append(candidate)

        if selectable_groups:
            preselected_key = min(
                selectable_groups,
                key=lambda key: min(
                    cls._candidate_sort_key(candidate, query)
                    for candidate in selectable_groups[key]
                ),
            )
        else:
            first_review = min(
                (
                    candidate
                    for candidate in candidates
                    if candidate.decision.technical_review_rank == 1
                ),
                key=lambda candidate: cls._candidate_sort_key(candidate, query),
                default=None,
            )
            preselected_key = (
                (
                    first_review.decision.identity_key,
                    first_review.decision.technical_evidence_key,
                )
                if first_review is not None
                else None
            )

        recommended: list[CandidateMatch] = []
        for candidate in candidates:
            decision = candidate.decision
            key = (decision.identity_key, decision.technical_evidence_key)
            if decision.selection_eligibility == SelectionEligibility.BLOCKED:
                recommendation = SelectionRecommendation.EXCLUDE
            elif key == preselected_key:
                recommendation = SelectionRecommendation.PRESELECT
            else:
                recommendation = SelectionRecommendation.CANDIDATE_ONLY
            review_recommended = (
                recommendation == SelectionRecommendation.PRESELECT
                and decision.selection_eligibility == SelectionEligibility.MANUAL_REVIEW
            )
            recommended.append(
                candidate.model_copy(
                    update={
                        "decision": decision.model_copy(
                            update={
                                "selection_recommendation": recommendation,
                                "review_recommended": review_recommended,
                            },
                            deep=True,
                        )
                    },
                    deep=True,
                )
            )
        return recommended

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
