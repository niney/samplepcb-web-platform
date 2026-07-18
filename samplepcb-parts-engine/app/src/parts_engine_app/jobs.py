from __future__ import annotations

import asyncio
import logging
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

from bom_extraction_engine import SmartbomConfig, build_smartbom_result
from supplier_search_engine.contract import build_batch_from_result
from supplier_search_engine.service import SearchService
from supplier_search_engine.settings import Settings as SearchSettings

from .config import Config

logger = logging.getLogger(__name__)

_ALLOWED_EXTS = {".xlsx", ".xlsm", ".xls", ".csv", ".tsv"}


class JobError(RuntimeError):
    """호출부에서 4xx로 매핑하기 위한 도메인 예외."""


@dataclass
class Job:
    id: str
    engine: str
    filename: str
    upload_path: Path
    # 파싱(추출) 잡
    status: str = "running"           # running|completed|failed
    progress: int = 15
    message: str = ""
    result: dict[str, Any] | None = None
    error: str | None = None
    # 공급사 검색 서브잡
    supplier_status: str | None = None   # None|running|completed|failed
    supplier_progress: int = 0
    supplier_message: str = ""
    supplier_result: dict[str, Any] | None = None
    supplier_error: str | None = None


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
    def submit_supplier(self, job_id: str) -> Job:
        job = self.get(job_id)
        if job.status != "completed" or job.result is None:
            raise JobError(f"analysis_not_ready: {job.status}")
        if job.supplier_status == "running":
            raise JobError("supplier_search_already_running")
        job.supplier_status = "running"
        job.supplier_progress = 5
        job.supplier_message = "공급사 검색 계획 중"
        job.supplier_error = None
        self._executor.submit(self._run_supplier, job)
        return job

    def _run_supplier(self, job: Job) -> None:
        try:
            assert job.result is not None
            batch = build_batch_from_result(job.result)
            settings = SearchSettings.from_env()
            settings.cache_path = self.config.supplier_cache_path
            settings.max_api_calls_per_job = self.config.supplier_max_calls
            job.supplier_progress = 20
            job.supplier_message = "Mouser·DigiKey·UniKeyIC 병렬 검색 중"
            result = asyncio.run(self._search(settings, batch))
            job.supplier_result = self._supplier_envelope(job, result)
            job.supplier_status = "completed"
            job.supplier_progress = 100
            job.supplier_message = "공급사 검색 완료"
        except Exception as error:
            logger.exception("공급사 검색 실패: %s", job.id)
            job.supplier_status = "failed"
            job.supplier_error = f"{type(error).__name__}: {str(error)[:500]}"

    @staticmethod
    async def _search(settings: SearchSettings, batch: Any) -> Any:
        async with SearchService(settings) as service:
            return await service.search_batch(batch)

    @staticmethod
    def _supplier_envelope(job: Job, result: Any) -> dict[str, Any]:
        status_counts: Counter[str] = Counter(
            component.status.value for component in result.components
        )
        return {
            "supplier_search_schema_version": "1.1",
            "analysis_job_id": job.id,
            "summary": {
                "component_count": len(result.components),
                "status_counts": dict(sorted(status_counts.items())),
                "api_calls": result.api_calls,
                "cache_hits": result.cache_hits,
                "elapsed_ms": result.elapsed_ms,
            },
            "search": result.model_dump(mode="json"),
        }

    def shutdown(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)
