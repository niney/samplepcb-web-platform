from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

_MB = 1024 * 1024


@dataclass(frozen=True)
class Config:
    """앱 설정 — 환경변수에서 주입. 공급사 API 키는 supplier_search_engine 이
    자체 Settings.from_env() 로 읽으므로 여기서는 다루지 않는다."""

    data_dir: Path
    m2v_path: str          # 헤더 탐지 임베딩: ""=HF캐시, 경로=오프라인, "off"=비활성
    component_limit: int
    max_upload_bytes: int
    supplier_max_calls: int

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def supplier_cache_path(self) -> Path:
        return self.data_dir / "supplier-search-cache.sqlite3"

    @classmethod
    def from_env(cls) -> "Config":
        data_dir = Path(os.getenv("PARTS_ENGINE_DATA_DIR", "data")).expanduser().resolve()
        cfg = cls(
            data_dir=data_dir,
            m2v_path=os.getenv("BOM_M2V_PATH", ""),
            component_limit=int(os.getenv("BOM_COMPONENT_LIMIT", "5000")),
            max_upload_bytes=int(os.getenv("MAX_UPLOAD_BYTES", str(30 * _MB))),
            supplier_max_calls=int(os.getenv("SUPPLIER_MAX_CALLS", "700")),
        )
        cfg.uploads_dir.mkdir(parents=True, exist_ok=True)
        return cfg
