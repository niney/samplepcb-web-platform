from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class CacheLookup:
    state: str
    payload: dict[str, Any] | None
    age_seconds: float | None


def stable_cache_key(payload: Any) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


class SQLiteCache:
    """Small durable cache shared by CLI runs without requiring Redis or Elasticsearch."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path).resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_lock = threading.Lock()
        self._initialized = False
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=10.0)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA busy_timeout=10000")
        return connection

    def _initialize(self) -> None:
        with self._init_lock:
            if self._initialized:
                return
            with self._connect() as connection:
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS cache_entries (
                        namespace TEXT NOT NULL,
                        cache_key TEXT NOT NULL,
                        payload_json TEXT NOT NULL,
                        created_at REAL NOT NULL,
                        expires_at REAL NOT NULL,
                        stale_until REAL NOT NULL,
                        PRIMARY KEY (namespace, cache_key)
                    )
                    """
                )
                connection.execute(
                    "CREATE INDEX IF NOT EXISTS idx_cache_expiry ON cache_entries(expires_at, stale_until)"
                )
            self._initialized = True

    def get(
        self,
        namespace: str,
        key: str,
        *,
        allow_stale: bool = False,
        now: float | None = None,
    ) -> CacheLookup:
        current = time.time() if now is None else now
        with self._connect() as connection:
            row = connection.execute(
                "SELECT payload_json, created_at, expires_at, stale_until FROM cache_entries "
                "WHERE namespace = ? AND cache_key = ?",
                (namespace, key),
            ).fetchone()
            if row is None:
                return CacheLookup("miss", None, None)
            payload_json, created_at, expires_at, stale_until = row
            if current <= expires_at:
                return CacheLookup("fresh", json.loads(payload_json), max(0.0, current - created_at))
            if allow_stale and current <= stale_until:
                return CacheLookup("stale", json.loads(payload_json), max(0.0, current - created_at))
            if current > stale_until:
                connection.execute(
                    "DELETE FROM cache_entries WHERE namespace = ? AND cache_key = ?", (namespace, key)
                )
            return CacheLookup("miss", None, None)

    def put(
        self,
        namespace: str,
        key: str,
        payload: dict[str, Any],
        *,
        ttl_seconds: int,
        stale_ttl_seconds: int = 0,
        now: float | None = None,
    ) -> None:
        current = time.time() if now is None else now
        expires_at = current + max(0, ttl_seconds)
        stale_until = expires_at + max(0, stale_ttl_seconds)
        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO cache_entries(namespace, cache_key, payload_json, created_at, expires_at, stale_until)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(namespace, cache_key) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    created_at = excluded.created_at,
                    expires_at = excluded.expires_at,
                    stale_until = excluded.stale_until
                """,
                (namespace, key, encoded, current, expires_at, stale_until),
            )

    def delete(self, namespace: str, key: str) -> None:
        with self._connect() as connection:
            connection.execute(
                "DELETE FROM cache_entries WHERE namespace = ? AND cache_key = ?", (namespace, key)
            )

    def clear(self) -> int:
        """Delete supplier response entries without touching persistent API usage ledgers."""
        with self._connect() as connection:
            cursor = connection.execute("DELETE FROM cache_entries")
            return cursor.rowcount

    def prune(self, *, now: float | None = None) -> int:
        current = time.time() if now is None else now
        with self._connect() as connection:
            cursor = connection.execute("DELETE FROM cache_entries WHERE stale_until < ?", (current,))
            return cursor.rowcount

    def stats(self) -> dict[str, int]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT namespace, COUNT(*) FROM cache_entries GROUP BY namespace ORDER BY namespace"
            ).fetchall()
        return {str(namespace): int(count) for namespace, count in rows}
