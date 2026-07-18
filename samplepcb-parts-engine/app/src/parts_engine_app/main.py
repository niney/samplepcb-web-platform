from __future__ import annotations

import logging

from dotenv import load_dotenv
from fastapi import FastAPI

from .config import Config
from .jobs import JobService
from .routes import router

# .env(공급사 키·데이터 경로 등)를 프로세스 env 로 로드 — Config/Settings.from_env 이전.
# 이미 설정된 실제 env 는 덮어쓰지 않는다(override=False 기본).
load_dotenv()


def create_app(config: Config | None = None) -> FastAPI:
    logging.basicConfig(level=logging.INFO)
    app = FastAPI(
        title="samplepcb-parts-engine",
        description="PCB 부품 BOM 추출 + 공급사 검색 엔진 (sp-engine)",
        version="0.1.0",
    )
    app.state.jobs = JobService(config or Config.from_env())
    app.include_router(router)
    return app


app = create_app()
