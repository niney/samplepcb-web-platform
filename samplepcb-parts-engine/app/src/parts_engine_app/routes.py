from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Body, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field, model_validator

from .jobs import Job, JobError, JobService, SupplierSearchOptions

router = APIRouter()


class SupplierSearchOptionsBody(BaseModel):
    """공급사 API 호출 전에 관리자에게 노출하는 안전 옵션."""

    max_calls: int = Field(default=700, ge=1, le=1_000)
    cache_only: bool = False
    reset_cache: bool = False

    @model_validator(mode="after")
    def validate_cache_mode(self) -> "SupplierSearchOptionsBody":
        if self.cache_only and self.reset_cache:
            raise ValueError("cache_only and reset_cache cannot be enabled together")
        return self

    def to_options(self) -> SupplierSearchOptions:
        return SupplierSearchOptions(
            max_calls=self.max_calls,
            cache_only=self.cache_only,
            reset_cache=self.reset_cache,
        )


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
