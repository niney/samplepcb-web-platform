from pathlib import Path

from supplier_search_engine.settings import Settings


def test_default_cache_path_stays_outside_uv_workspace_packages(monkeypatch):
    monkeypatch.delenv("SEARCH_CACHE_PATH", raising=False)
    engine_root = Path(__file__).resolve().parents[3]

    settings = Settings.from_env()

    assert settings.cache_path == engine_root / "data" / "supplier-search-cache.sqlite3"
