from __future__ import annotations

from supplier_search_engine.cache import SQLiteCache
from supplier_search_engine.settings import Settings as SearchSettings

from .config import Config


def supplier_search_capabilities(config: Config) -> dict[str, object]:
    """Return non-secret runtime limits and supplier readiness for operators."""
    settings = SearchSettings.from_env()
    settings.cache_path = config.supplier_cache_path
    cache_entries = sum(SQLiteCache(settings.cache_path).stats().values())
    suppliers = [
        {
            "supplier": "digikey",
            "configured": bool(
                settings.digikey_client_id and settings.digikey_client_secret
            ),
        },
        {"supplier": "mouser", "configured": bool(settings.mouser_api_key)},
        {"supplier": "unikeyic", "configured": bool(settings.unikeyic_api_key)},
    ]
    return {
        "schema_version": "1.0",
        "supplier_search": {
            "max_calls_per_job": config.supplier_max_calls,
            "suppliers": suppliers,
            "cache": {
                "mode": "only" if settings.cache_only else "normal",
                "entry_count": cache_entries,
                "raw_ttl_seconds": settings.raw_cache_ttl_seconds,
                "keyword_ttl_seconds": settings.keyword_cache_ttl_seconds,
                "stale_ttl_seconds": settings.stale_ttl_seconds,
                "stale_if_error": settings.stale_if_error,
            },
        },
    }
