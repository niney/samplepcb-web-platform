from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from .models import Supplier


def _optional_int(name: str, default: int | None = None) -> int | None:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    parsed = int(value)
    return parsed if parsed > 0 else None


def _bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().casefold() in {"1", "true", "yes", "on"}


def _float(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    parsed = float(value)
    return parsed if parsed > 0 else default


@dataclass(slots=True)
class QuotaLimit:
    daily: int | None = None
    per_minute: int | None = None


@dataclass(slots=True)
class Settings:
    cache_path: Path
    mouser_api_key: str | None = None
    digikey_client_id: str | None = None
    digikey_client_secret: str | None = None
    digikey_account_id: str | None = None
    unikeyic_api_key: str | None = None
    mouser_base_url: str = "https://api.mouser.com"
    digikey_base_url: str = "https://api.digikey.com"
    digikey_token_url: str = "https://api.digikey.com/v1/oauth2/token"
    unikeyic_base_url: str = "https://openapi.unikeyic.com"
    request_timeout_seconds: float = 8.0
    job_timeout_seconds: float = 60.0
    raw_cache_ttl_seconds: int = 3_600
    keyword_cache_ttl_seconds: int = 21_600
    negative_exact_ttl_seconds: int = 3_600
    negative_keyword_ttl_seconds: int = 3_600
    stale_ttl_seconds: int = 86_400
    max_api_calls_per_job: int = 700
    cache_only: bool = False
    stale_if_error: bool = True
    supplier_concurrency: int = 4
    digikey_concurrency: int | None = None
    digikey_identity_concurrency: int | None = None
    digikey_parametric_concurrency: int | None = None
    mouser_concurrency: int | None = None
    unikeyic_concurrency: int | None = None
    quotas: dict[Supplier, QuotaLimit] = field(default_factory=dict)

    @classmethod
    def from_env(cls) -> "Settings":
        # 이식 재홈: 연구 폴더 대신 웹 데이터 디렉터리 기본값.
        # 웹 계층(_search_settings)이 항상 cache_path를 덮어쓰므로
        # 이 기본값은 패키지 단독 사용 시에만 의미가 있다.
        engine_root = Path(__file__).resolve().parents[4]
        cache_value = os.getenv(
            "SEARCH_CACHE_PATH",
            str(engine_root / "data" / "supplier-search-cache.sqlite3"))
        legacy_concurrency_configured = bool(os.getenv("SEARCH_SUPPLIER_CONCURRENCY", "").strip())
        supplier_concurrency = _optional_int("SEARCH_SUPPLIER_CONCURRENCY", 4) or 4
        digikey_concurrency = _optional_int(
            "SEARCH_DIGIKEY_CONCURRENCY",
            supplier_concurrency if legacy_concurrency_configured else 10,
        ) or supplier_concurrency
        digikey_identity_concurrency = _optional_int(
            "SEARCH_DIGIKEY_IDENTITY_CONCURRENCY",
            max(1, min(4, digikey_concurrency // 2)),
        )
        digikey_parametric_concurrency = _optional_int(
            "SEARCH_DIGIKEY_PARAMETRIC_CONCURRENCY",
            max(1, digikey_concurrency - (digikey_identity_concurrency or 1)),
        )
        return cls(
            cache_path=Path(cache_value).expanduser().resolve(),
            mouser_api_key=os.getenv("MOUSER_API_KEY") or None,
            digikey_client_id=os.getenv("DIGIKEY_CLIENT_ID") or None,
            digikey_client_secret=os.getenv("DIGIKEY_CLIENT_SECRET") or None,
            digikey_account_id=os.getenv("DIGIKEY_ACCOUNT_ID") or None,
            unikeyic_api_key=os.getenv("UNIKEYIC_API_KEY") or None,
            mouser_base_url=os.getenv("MOUSER_BASE_URL", "https://api.mouser.com"),
            digikey_base_url=os.getenv("DIGIKEY_BASE_URL", "https://api.digikey.com"),
            digikey_token_url=os.getenv("DIGIKEY_TOKEN_URL", "https://api.digikey.com/v1/oauth2/token"),
            unikeyic_base_url=os.getenv("UNIKEYIC_BASE_URL", "https://openapi.unikeyic.com"),
            request_timeout_seconds=_float("SEARCH_REQUEST_TIMEOUT_SECONDS", 8.0),
            job_timeout_seconds=_float("SEARCH_JOB_TIMEOUT_SECONDS", 60.0),
            raw_cache_ttl_seconds=_optional_int("SEARCH_RAW_CACHE_TTL_SECONDS", 3_600) or 3_600,
            keyword_cache_ttl_seconds=_optional_int("SEARCH_KEYWORD_CACHE_TTL_SECONDS", 21_600) or 21_600,
            negative_exact_ttl_seconds=_optional_int("SEARCH_NEGATIVE_EXACT_TTL_SECONDS", 3_600) or 3_600,
            negative_keyword_ttl_seconds=(
                _optional_int("SEARCH_NEGATIVE_KEYWORD_TTL_SECONDS", 3_600) or 3_600
            ),
            stale_ttl_seconds=_optional_int("SEARCH_STALE_TTL_SECONDS", 86_400) or 86_400,
            max_api_calls_per_job=_optional_int("SEARCH_MAX_API_CALLS_PER_JOB", 700) or 700,
            cache_only=_bool("SEARCH_CACHE_ONLY"),
            stale_if_error=_bool("SEARCH_STALE_IF_ERROR", True),
            supplier_concurrency=supplier_concurrency,
            digikey_concurrency=digikey_concurrency,
            digikey_identity_concurrency=digikey_identity_concurrency,
            digikey_parametric_concurrency=digikey_parametric_concurrency,
            mouser_concurrency=_optional_int(
                "SEARCH_MOUSER_CONCURRENCY",
                supplier_concurrency if legacy_concurrency_configured else 10,
            ),
            unikeyic_concurrency=_optional_int(
                "SEARCH_UNIKEYIC_CONCURRENCY",
                supplier_concurrency if legacy_concurrency_configured else 6,
            ),
            quotas={
                Supplier.DIGIKEY: QuotaLimit(
                    _optional_int("DIGIKEY_DAILY_LIMIT", 10_000),
                    _optional_int("DIGIKEY_PER_MINUTE_LIMIT", 360),
                ),
                Supplier.MOUSER: QuotaLimit(
                    _optional_int("MOUSER_DAILY_LIMIT"),
                    _optional_int("MOUSER_PER_MINUTE_LIMIT"),
                ),
                Supplier.UNIKEYIC: QuotaLimit(
                    _optional_int("UNIKEYIC_DAILY_LIMIT"),
                    _optional_int("UNIKEYIC_PER_MINUTE_LIMIT"),
                ),
            },
        )
