from __future__ import annotations

import asyncio
from copy import deepcopy
import logging
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Any
from uuid import uuid4

from bom_extraction_engine import SmartbomConfig, build_smartbom_result
from supplier_search_engine.contract import build_batch_from_result
from supplier_search_engine.cache import CacheLookup, SQLiteCache, stable_cache_key
from supplier_search_engine.service import SearchService
from supplier_search_engine.settings import Settings as SearchSettings

from .config import Config

logger = logging.getLogger(__name__)

_ALLOWED_EXTS = {".xlsx", ".xlsm", ".xls", ".csv", ".tsv"}


class JobError(RuntimeError):
    """호출부에서 4xx로 매핑하기 위한 도메인 예외."""


@dataclass(frozen=True)
class SupplierSearchOptions:
    """공급사 검색 실행 전에 확정하는 안전 옵션.

    브라우저가 보내는 값이지만 실제 상한은 JobService가 Config 값으로 한 번 더
    강제한다. cache_only와 reset_cache는 동시에 성립하지 않는다.
    """

    max_calls: int
    cache_only: bool = False
    reset_cache: bool = False
    sheet_indexes: tuple[int, ...] = ()


class _EmptyPreflightCache:
    """캐시를 지우지 않고 '초기화 후 실행'의 호출 수를 계산하는 읽기 전용 뷰."""

    def get(
        self,
        namespace: str,
        key: str,
        *,
        allow_stale: bool = False,
        now: float | None = None,
    ) -> CacheLookup:
        del namespace, key, allow_stale, now
        return CacheLookup("miss", None, None)


@dataclass
class Job:
    id: str
    engine: str
    filename: str
    upload_path: Path
    # 파싱(추출) 잡
    status: str = "running"  # running|completed|failed
    progress: int = 15
    message: str = ""
    result: dict[str, Any] | None = None
    error: str | None = None
    # 공급사 검색 서브잡
    supplier_status: str | None = None  # None|running|completed|failed
    supplier_progress: int = 0
    supplier_message: str = ""
    supplier_result: dict[str, Any] | None = None
    supplier_error: str | None = None
    supplier_options: SupplierSearchOptions | None = None
    supplier_preflight: dict[str, Any] | None = None


class JobService:
    """인메모리 잡 레지스트리 + 스레드풀 러너.

    잡은 요청 이벤트 루프와 무관한 ThreadPoolExecutor에서 돈다(요청 종료 후에도
    지속) — 추출은 동기·CPU 바운드라 스레드에 자연스럽고, 공급사 검색(async)은
    스레드 안에서 asyncio.run 으로 구동한다(원본 supplier_search 와 동일 패턴).
    """

    def __init__(self, config: Config, workers: int = 4) -> None:
        self.config = config
        self._jobs: dict[str, Job] = {}
        self._executor = ThreadPoolExecutor(
            max_workers=workers, thread_name_prefix="parts-engine"
        )
        # reset_cache는 모든 공급사 응답 캐시를 지우므로 다른 검색과 동시에
        # 실행되면 안 된다. 일반 검색끼리는 기존처럼 병렬 실행한다.
        self._supplier_state_lock = Lock()
        self._active_supplier_searches = 0
        self._cache_reset_running = False

    # ── 조회 ──────────────────────────────────────────────
    def get(self, job_id: str) -> Job:
        job = self._jobs.get(job_id)
        if job is None:
            raise JobError(f"job_not_found: {job_id}")
        return job

    # ── 파싱(추출) ────────────────────────────────────────
    def submit_parse(self, data: bytes, filename: str, engine: str = "smartbom") -> Job:
        ext = Path(filename).suffix.lower()
        if ext not in _ALLOWED_EXTS:
            raise JobError(f"unsupported_extension: {ext or '(none)'}")
        if len(data) > self.config.max_upload_bytes:
            raise JobError("file_too_large")
        job_id = uuid4().hex
        upload_path = self.config.uploads_dir / f"{job_id}{ext}"
        upload_path.write_bytes(data)
        job = Job(id=job_id, engine=engine, filename=filename, upload_path=upload_path)
        self._jobs[job_id] = job
        self._executor.submit(self._run_parse, job)
        return job

    def submit_analysis_snapshot(self, result: dict[str, Any]) -> Job:
        """sp-node가 영속한 분석 스냅샷으로 독립 공급사 검색 잡을 만든다.

        추출 잡의 인메모리 수명과 공급사 검색을 분리하는 경계다. 원본 JSON은 새
        필드를 버리지 않도록 그대로 복제하고, supplier 계약 변환이 가능한지만
        등록 전에 검증한다.
        """
        if not isinstance(result.get("components"), list):
            raise JobError("analysis_snapshot_components_invalid")
        if not isinstance(result.get("sheets"), list):
            raise JobError("analysis_snapshot_sheets_invalid")
        try:
            build_batch_from_result(result)
        except (KeyError, TypeError, ValueError) as error:
            raise JobError(f"analysis_snapshot_invalid: {str(error)[:300]}") from error

        job_id = uuid4().hex
        filename = str(result.get("source_file") or "persisted-analysis")
        engine = str(result.get("engine") or "smartbom")
        job = Job(
            id=job_id,
            engine=engine,
            filename=filename,
            upload_path=Path(),
            status="completed",
            progress=100,
            message="영속 분석 스냅샷 준비 완료",
            result=deepcopy(result),
        )
        self._jobs[job_id] = job
        return job

    def _run_parse(self, job: Job) -> None:
        def progress(_stage: str, percent: int, message: str) -> None:
            job.progress = percent
            job.message = message

        try:
            config = SmartbomConfig(
                m2v_path=self.config.m2v_path,
                component_limit=self.config.component_limit,
            )
            job.result = build_smartbom_result(
                input_path=job.upload_path,
                original_filename=job.filename,
                progress=progress,
                config=config,
            )
            job.status = "completed"
            job.progress = 100
            job.message = "추출 완료"
        except Exception as error:  # 백그라운드 잡은 안전한 실패 상태를 남긴다
            logger.exception("BOM 추출 실패: %s", job.id)
            job.status = "failed"
            job.error = f"{type(error).__name__}: {str(error)[:500]}"

    # ── 공급사 검색 ───────────────────────────────────────
    def preflight_supplier(
        self,
        job_id: str,
        options: SupplierSearchOptions,
    ) -> dict[str, Any]:
        """실제 API 호출 없이 캐시·쿼터·예상 호출 수를 계산한다."""
        job = self.get(job_id)
        if job.status != "completed" or job.result is None:
            raise JobError(f"analysis_not_ready: {job.status}")
        self._validate_supplier_options(options)

        started = time.perf_counter()
        batch = build_batch_from_result(
            job.result,
            sheet_indexes=set(options.sheet_indexes) if options.sheet_indexes else None,
        )
        settings = self._supplier_settings(options)
        cache = _EmptyPreflightCache() if options.reset_cache else None

        async def build_plan() -> dict[str, Any]:
            async with SearchService(settings, cache=cache) as service:
                return service.preflight_batch(batch).model_dump(mode="json")

        plan = asyncio.run(build_plan())
        return {
            "analysis_job_id": job.id,
            "analysis_elapsed_ms": self._analysis_elapsed_ms(job),
            "preflight_elapsed_ms": (time.perf_counter() - started) * 1_000,
            "reset_cache": options.reset_cache,
            "plan": plan,
        }

    def submit_supplier(self, job_id: str, options: SupplierSearchOptions) -> Job:
        job = self.get(job_id)
        if job.status != "completed" or job.result is None:
            raise JobError(f"analysis_not_ready: {job.status}")
        self._validate_supplier_options(options)
        preflight = self.preflight_supplier(job_id, options)

        with self._supplier_state_lock:
            if job.supplier_status == "running":
                raise JobError("supplier_search_already_running")
            if self._cache_reset_running or (
                options.reset_cache and self._active_supplier_searches > 0
            ):
                raise JobError("supplier_search_cache_reset_busy")
            self._active_supplier_searches += 1
            if options.reset_cache:
                self._cache_reset_running = True

        job.supplier_status = "running"
        job.supplier_progress = 5
        job.supplier_message = "확정된 공급사 검색 계획을 준비 중"
        job.supplier_error = None
        job.supplier_options = options
        job.supplier_preflight = preflight
        self._executor.submit(self._run_supplier, job)
        return job

    def _run_supplier(self, job: Job) -> None:
        try:
            assert job.result is not None
            assert job.supplier_options is not None
            assert job.supplier_preflight is not None
            batch = build_batch_from_result(
                job.result,
                sheet_indexes=set(job.supplier_options.sheet_indexes)
                if job.supplier_options.sheet_indexes
                else None,
            )
            options = job.supplier_options
            settings = self._supplier_settings(options)
            job.supplier_progress = 20
            if options.reset_cache:
                job.supplier_message = "공급사 응답 캐시를 초기화하는 중"
                cache_reset_started = time.perf_counter()
                cache_entries_cleared = SQLiteCache(settings.cache_path).clear()
                cache_reset_elapsed_ms = (
                    time.perf_counter() - cache_reset_started
                ) * 1_000
            else:
                cache_entries_cleared = 0
                cache_reset_elapsed_ms = 0.0
            job.supplier_progress = 28
            job.supplier_message = (
                "캐시된 공급사 응답만 검증 중"
                if options.cache_only
                else "Mouser·DigiKey·UniKeyIC 병렬 검색 중"
            )
            search_started = time.perf_counter()
            result = asyncio.run(self._search(settings, batch))
            search_elapsed_ms = (time.perf_counter() - search_started) * 1_000
            job.supplier_result = self._supplier_envelope(
                job,
                result,
                cache_entries_cleared=cache_entries_cleared,
                cache_reset_elapsed_ms=cache_reset_elapsed_ms,
                search_elapsed_ms=search_elapsed_ms,
            )
            job.supplier_status = "completed"
            job.supplier_progress = 100
            job.supplier_message = "공급사 검색 완료"
        except Exception as error:
            logger.exception("공급사 검색 실패: %s", job.id)
            job.supplier_status = "failed"
            job.supplier_error = f"{type(error).__name__}: {str(error)[:500]}"
        finally:
            with self._supplier_state_lock:
                self._active_supplier_searches = max(
                    0, self._active_supplier_searches - 1
                )
                if (
                    job.supplier_options is not None
                    and job.supplier_options.reset_cache
                ):
                    self._cache_reset_running = False

    @staticmethod
    async def _search(settings: SearchSettings, batch: Any) -> Any:
        async with SearchService(settings) as service:
            return await service.search_batch(batch)

    def _supplier_settings(self, options: SupplierSearchOptions) -> SearchSettings:
        settings = SearchSettings.from_env()
        settings.cache_path = self.config.supplier_cache_path
        settings.max_api_calls_per_job = options.max_calls
        settings.cache_only = options.cache_only
        return settings

    def _validate_supplier_options(self, options: SupplierSearchOptions) -> None:
        if options.max_calls < 1:
            raise JobError("supplier_max_calls_invalid")
        if options.max_calls > self.config.supplier_max_calls:
            raise JobError(
                f"supplier_max_calls_exceeded: maximum {self.config.supplier_max_calls}"
            )
        if options.cache_only and options.reset_cache:
            raise JobError("supplier_cache_modes_conflict")
        if any(index < 0 for index in options.sheet_indexes):
            raise JobError("supplier_sheet_index_invalid")
        if len(set(options.sheet_indexes)) != len(options.sheet_indexes):
            raise JobError("supplier_sheet_index_duplicate")

    @staticmethod
    def _analysis_elapsed_ms(job: Job) -> float | None:
        if job.result is None:
            return None
        value = job.result.get("summary", {}).get("processing_ms")
        return float(value) if isinstance(value, (int, float)) else None

    def _supplier_envelope(
        self,
        job: Job,
        result: Any,
        *,
        cache_entries_cleared: int,
        cache_reset_elapsed_ms: float,
        search_elapsed_ms: float,
    ) -> dict[str, Any]:
        status_counts: Counter[str] = Counter(
            component.status.value for component in result.components
        )
        supplier_timing: dict[str, dict[str, float | int]] = {}
        seen_requests: set[tuple[str, str]] = set()
        for component in result.components:
            attempts = (
                (component.initial_query, component.initial_supplier_results),
                (component.query, component.supplier_results),
            )
            for query, supplier_results in attempts:
                query_key = stable_cache_key(query.cache_payload()) if query else ""
                for supplier_result in supplier_results:
                    supplier = supplier_result.supplier.value
                    request_identity = (supplier, query_key)
                    if request_identity in seen_requests:
                        continue
                    seen_requests.add(request_identity)
                    timing = supplier_timing.setdefault(
                        supplier,
                        {
                            "request_count": 0,
                            "api_calls": 0,
                            "cache_hits": 0,
                            "operation_elapsed_ms": 0.0,
                            "max_operation_elapsed_ms": 0.0,
                        },
                    )
                    timing["request_count"] += 1
                    timing["api_calls"] += supplier_result.api_calls
                    timing["cache_hits"] += int(
                        supplier_result.cache_state in {"fresh", "stale", "coalesced"}
                    )
                    timing["operation_elapsed_ms"] += (
                        supplier_result.operation_elapsed_ms
                    )
                    timing["max_operation_elapsed_ms"] = max(
                        float(timing["max_operation_elapsed_ms"]),
                        supplier_result.operation_elapsed_ms,
                    )
        preflight = job.supplier_preflight or {}
        preflight_elapsed_ms = float(preflight.get("preflight_elapsed_ms", 0.0))
        return {
            "supplier_search_schema_version": "1.2",
            "analysis_job_id": job.id,
            "timing": {
                "analysis_elapsed_ms": self._analysis_elapsed_ms(job),
                "preflight_elapsed_ms": preflight_elapsed_ms,
                "cache_reset_elapsed_ms": cache_reset_elapsed_ms,
                "search_elapsed_ms": search_elapsed_ms,
                "known_pipeline_elapsed_ms": (
                    preflight_elapsed_ms + cache_reset_elapsed_ms + search_elapsed_ms
                ),
                "suppliers": supplier_timing,
            },
            "summary": {
                "component_count": len(result.components),
                "status_counts": dict(sorted(status_counts.items())),
                "api_calls": result.api_calls,
                "cache_hits": result.cache_hits,
                "elapsed_ms": result.elapsed_ms,
                "cache_entries_cleared": cache_entries_cleared,
            },
            "preflight": preflight.get("plan", {}),
            "search": result.model_dump(mode="json"),
        }

    def shutdown(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)
