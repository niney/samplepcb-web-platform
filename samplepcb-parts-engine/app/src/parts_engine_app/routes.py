from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Body, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, ConfigDict, Field, model_validator
from supplier_search_engine.models import (
    ProcurementPolicyInput,
    ProcurementReevaluationRequest,
    ProcurementReevaluationResult,
)
from supplier_search_engine.procurement import (
    ProcurementReevaluationError,
    reevaluate_procurement,
)

from .capabilities import supplier_search_capabilities
from .jobs import Job, JobError, JobService, SupplierSearchOptions
from .refresh import refresh_part

router = APIRouter()


class SupplierSearchOptionsBody(BaseModel):
    """공급사 API 호출 전에 관리자에게 노출하는 안전 옵션."""

    max_calls: int = Field(default=700, ge=1, le=1_000)
    cache_only: bool = False
    reset_cache: bool = False
    sheet_indexes: list[int] = Field(default_factory=list, max_length=100)
    procurement: ProcurementPolicyInput = Field(
        default_factory=ProcurementPolicyInput
    )

    @model_validator(mode="after")
    def validate_cache_mode(self) -> "SupplierSearchOptionsBody":
        if self.cache_only and self.reset_cache:
            raise ValueError("cache_only and reset_cache cannot be enabled together")
        if any(index < 0 for index in self.sheet_indexes):
            raise ValueError("sheet_indexes must be zero-based non-negative integers")
        if len(set(self.sheet_indexes)) != len(self.sheet_indexes):
            raise ValueError("sheet_indexes cannot contain duplicates")
        return self

    def to_options(self) -> SupplierSearchOptions:
        return SupplierSearchOptions(
            max_calls=self.max_calls,
            cache_only=self.cache_only,
            reset_cache=self.reset_cache,
            sheet_indexes=tuple(self.sheet_indexes),
            procurement_policy=self.procurement,
        )


class PersistedAnalysisBody(BaseModel):
    """sp-node 영속 분석 결과를 공급사 검색 계산 입력으로 등록한다."""

    model_config = ConfigDict(extra="forbid")

    analysis: dict[str, Any]
    required_quantities: dict[str, int] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_required_quantities(self) -> "PersistedAnalysisBody":
        for component_id, quantity in self.required_quantities.items():
            if not component_id.strip():
                raise ValueError("required quantity component ids must not be blank")
            if isinstance(quantity, bool) or quantity < 1:
                raise ValueError("required quantities must be positive integers")
        return self


def _svc(request: Request) -> JobService:
    return request.app.state.jobs


def _job(request: Request, job_id: str) -> Job:
    try:
        return _svc(request).get(job_id)
    except JobError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


def _job_view(job: Job) -> dict[str, Any]:
    return {
        "job_id": job.id,
        "engine": job.engine,
        "filename": job.filename,
        "status": job.status,
        "progress": job.progress,
        "message": job.message,
        "error": job.error,
        "result_available": job.result is not None,
        "supplier_search": _supplier_view(job),
    }


def _supplier_view(job: Job) -> dict[str, Any]:
    return {
        "status": job.supplier_status,
        "progress": job.supplier_progress,
        "message": job.supplier_message,
        "error": job.supplier_error,
        "result_available": job.supplier_result is not None,
    }


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/capabilities")
async def capabilities(request: Request) -> dict[str, object]:
    """Read-only operational metadata. Credentials and filesystem paths are omitted."""
    return supplier_search_capabilities(_svc(request).config)


@router.post("/jobs", status_code=202)
async def create_job(
    request: Request,
    file: UploadFile = File(...),
    engine: str = Form("smartbom"),
) -> dict[str, Any]:
    data = await file.read()
    try:
        job = _svc(request).submit_parse(data, file.filename or "upload", engine=engine)
    except JobError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return _job_view(job)


@router.get("/jobs/{job_id}")
async def get_job(request: Request, job_id: str) -> dict[str, Any]:
    return _job_view(_job(request, job_id))


@router.get("/jobs/{job_id}/result")
async def get_result(request: Request, job_id: str) -> dict[str, Any]:
    job = _job(request, job_id)
    if job.status == "failed":
        raise HTTPException(status_code=422, detail=job.error or "analysis_failed")
    if job.status != "completed" or job.result is None:
        raise HTTPException(status_code=409, detail=f"analysis_{job.status}")
    return job.result


@router.post("/supplier-jobs", status_code=201)
async def create_supplier_job(
    request: Request,
    body: PersistedAnalysisBody,
) -> dict[str, Any]:
    try:
        job = await asyncio.to_thread(
            _svc(request).submit_analysis_snapshot,
            body.analysis,
            body.required_quantities,
        )
    except JobError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return _job_view(job)


@router.post("/jobs/{job_id}/supplier-search/preflight")
async def preflight_supplier_search(
    request: Request,
    job_id: str,
    options: SupplierSearchOptionsBody = Body(default_factory=SupplierSearchOptionsBody),
) -> dict[str, Any]:
    try:
        # SearchService는 async http client를 정리하므로 preflight 계산 자체를
        # 워커 스레드에서 실행한다. FastAPI 이벤트 루프 안에서 asyncio.run()을
        # 중첩 호출하지 않기 위한 경계다.
        return await asyncio.to_thread(_svc(request).preflight_supplier, job_id, options.to_options())
    except JobError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post("/jobs/{job_id}/supplier-search", status_code=202)
async def start_supplier_search(
    request: Request,
    job_id: str,
    options: SupplierSearchOptionsBody = Body(default_factory=SupplierSearchOptionsBody),
) -> dict[str, Any]:
    _job(request, job_id)
    try:
        job = await asyncio.to_thread(_svc(request).submit_supplier, job_id, options.to_options())
    except JobError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return _supplier_view(job)


@router.get("/jobs/{job_id}/supplier-search")
async def get_supplier_search(request: Request, job_id: str) -> dict[str, Any]:
    return _supplier_view(_job(request, job_id))


@router.get("/jobs/{job_id}/supplier-search/result")
async def get_supplier_result(request: Request, job_id: str) -> dict[str, Any]:
    job = _job(request, job_id)
    if job.supplier_status == "failed":
        raise HTTPException(status_code=422, detail=job.supplier_error or "supplier_search_failed")
    if job.supplier_status != "completed" or job.supplier_result is None:
        raise HTTPException(status_code=409, detail=f"supplier_search_{job.supplier_status}")
    return job.supplier_result


@router.post(
    "/supplier-search/procurement/reevaluate",
    response_model=ProcurementReevaluationResult,
)
async def reevaluate_supplier_procurement(
    body: ProcurementReevaluationRequest,
) -> ProcurementReevaluationResult:
    """저장된 기술 후보에 새 수량·환율 정책만 적용한다(공급사 호출 없음)."""

    try:
        return await asyncio.to_thread(reevaluate_procurement, body)
    except ProcurementReevaluationError as error:
        raise HTTPException(status_code=422, detail=error.api_detail()) from error


class PartRefreshBody(BaseModel):
    """단건 부품 수동 갱신 — 부품 검색 화면 [공급사 갱신] 버튼."""

    part_number: str = Field(min_length=1, max_length=191)
    manufacturer: str | None = None
    max_calls: int = Field(default=25, ge=1, le=100)


@router.post("/parts/refresh")
async def refresh_single_part(request: Request, body: PartRefreshBody) -> dict[str, Any]:
    """MPN 1건 강제 라이브 검색(캐시 읽기 무시·쓰기 기록). 응답 {search: BatchSearchResult}."""
    try:
        return await refresh_part(
            _svc(request).config,
            body.part_number,
            body.manufacturer,
            max_calls=body.max_calls,
        )
    except Exception as error:  # 공급사/네트워크 오류를 502 로 정규화
        raise HTTPException(status_code=502, detail=f"{type(error).__name__}: {str(error)[:300]}") from error
