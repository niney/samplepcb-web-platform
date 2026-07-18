from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from .models import Supplier
from .settings import QuotaLimit


class QuotaExceeded(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class BudgetUsage:
    supplier: Supplier
    daily_used: int
    minute_used: int
    daily_limit: int | None
    minute_limit: int | None


class ApiBudgetManager:
    """Atomically accounts for daily and minute calls across processes."""

    def __init__(self, path: str | Path, limits: dict[Supplier, QuotaLimit]) -> None:
        self.path = Path(path).resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.limits = limits
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS api_budget (
                    supplier TEXT NOT NULL,
                    window_kind TEXT NOT NULL,
                    window_key TEXT NOT NULL,
                    used INTEGER NOT NULL,
                    PRIMARY KEY (supplier, window_kind, window_key)
                )
                """
            )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=10.0, isolation_level=None)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA busy_timeout=10000")
        return connection

    @staticmethod
    def _window_keys(now: datetime) -> tuple[str, str]:
        utc = now.astimezone(timezone.utc)
        return utc.strftime("%Y-%m-%d"), utc.strftime("%Y-%m-%dT%H:%M")

    def reserve(self, supplier: Supplier, *, now: datetime | None = None) -> BudgetUsage:
        current = now or datetime.now(timezone.utc)
        daily_key, minute_key = self._window_keys(current)
        limit = self.limits.get(supplier, QuotaLimit())
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                daily_used = self._get_used(connection, supplier, "day", daily_key)
                minute_used = self._get_used(connection, supplier, "minute", minute_key)
                if limit.daily is not None and daily_used >= limit.daily:
                    raise QuotaExceeded(f"{supplier.value} daily API quota exhausted")
                if limit.per_minute is not None and minute_used >= limit.per_minute:
                    raise QuotaExceeded(f"{supplier.value} per-minute API quota exhausted")
                self._set_used(connection, supplier, "day", daily_key, daily_used + 1)
                self._set_used(connection, supplier, "minute", minute_key, minute_used + 1)
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        return BudgetUsage(supplier, daily_used + 1, minute_used + 1, limit.daily, limit.per_minute)

    def usage(self, supplier: Supplier, *, now: datetime | None = None) -> BudgetUsage:
        current = now or datetime.now(timezone.utc)
        daily_key, minute_key = self._window_keys(current)
        limit = self.limits.get(supplier, QuotaLimit())
        with self._connect() as connection:
            daily_used = self._get_used(connection, supplier, "day", daily_key)
            minute_used = self._get_used(connection, supplier, "minute", minute_key)
        return BudgetUsage(supplier, daily_used, minute_used, limit.daily, limit.per_minute)

    @staticmethod
    def _get_used(
        connection: sqlite3.Connection,
        supplier: Supplier,
        window_kind: str,
        window_key: str,
    ) -> int:
        row = connection.execute(
            "SELECT used FROM api_budget WHERE supplier=? AND window_kind=? AND window_key=?",
            (supplier.value, window_kind, window_key),
        ).fetchone()
        return int(row[0]) if row else 0

    @staticmethod
    def _set_used(
        connection: sqlite3.Connection,
        supplier: Supplier,
        window_kind: str,
        window_key: str,
        used: int,
    ) -> None:
        connection.execute(
            """
            INSERT INTO api_budget(supplier, window_kind, window_key, used) VALUES (?, ?, ?, ?)
            ON CONFLICT(supplier, window_kind, window_key) DO UPDATE SET used=excluded.used
            """,
            (supplier.value, window_kind, window_key, used),
        )

    def prune(self, *, keep_days: int = 7) -> int:
        # Day keys are lexicographically sortable ISO dates. Minute rows older than the same cutoff are also removed.
        cutoff = datetime.now(timezone.utc).timestamp() - keep_days * 86_400
        cutoff_key = datetime.fromtimestamp(cutoff, timezone.utc).strftime("%Y-%m-%d")
        with self._connect() as connection:
            cursor = connection.execute("DELETE FROM api_budget WHERE substr(window_key, 1, 10) < ?", (cutoff_key,))
            return cursor.rowcount
