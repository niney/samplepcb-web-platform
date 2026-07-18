from __future__ import annotations

from datetime import datetime, timezone

import pytest

from supplier_search_engine.budget import ApiBudgetManager, QuotaExceeded
from supplier_search_engine.cache import SQLiteCache, stable_cache_key
from supplier_search_engine.models import Supplier
from supplier_search_engine.settings import QuotaLimit


def test_cache_distinguishes_fresh_stale_and_expired(tmp_path):
    cache = SQLiteCache(tmp_path / "cache.sqlite3")
    key = stable_cache_key({"part": "ABC-1"})
    cache.put("raw:test", key, {"ok": True}, ttl_seconds=10, stale_ttl_seconds=10, now=100)

    assert cache.get("raw:test", key, now=105).state == "fresh"
    assert cache.get("raw:test", key, allow_stale=True, now=115).state == "stale"
    assert cache.get("raw:test", key, allow_stale=False, now=115).state == "miss"
    assert cache.get("raw:test", key, allow_stale=True, now=121).state == "miss"


def test_clear_removes_only_supplier_responses_and_preserves_budget(tmp_path):
    database = tmp_path / "shared.sqlite3"
    cache = SQLiteCache(database)
    cache.put("raw:mouser", "one", {"ok": True}, ttl_seconds=60)
    cache.put("raw:digikey", "two", {"ok": True}, ttl_seconds=60)
    manager = ApiBudgetManager(database, {})
    now = datetime(2026, 7, 16, 1, 2, tzinfo=timezone.utc)
    manager.reserve(Supplier.MOUSER, now=now)

    assert cache.clear() == 2
    assert cache.stats() == {}
    assert manager.usage(Supplier.MOUSER, now=now).daily_used == 1


def test_budget_is_atomic_for_daily_and_minute_limits(tmp_path):
    manager = ApiBudgetManager(
        tmp_path / "budget.sqlite3",
        {Supplier.DIGIKEY: QuotaLimit(daily=2, per_minute=1)},
    )
    now = datetime(2026, 7, 16, 1, 2, tzinfo=timezone.utc)

    usage = manager.reserve(Supplier.DIGIKEY, now=now)
    assert usage.daily_used == 1
    assert usage.minute_used == 1
    with pytest.raises(QuotaExceeded, match="per-minute"):
        manager.reserve(Supplier.DIGIKEY, now=now)
    observed = manager.usage(Supplier.DIGIKEY, now=now)
    assert observed.daily_used == 1
    assert observed.minute_used == 1
