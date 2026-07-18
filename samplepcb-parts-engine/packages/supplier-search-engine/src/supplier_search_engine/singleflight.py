from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import TypeVar


T = TypeVar("T")


class AsyncSingleFlight:
    """Collapses concurrent identical requests into one supplier call."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._tasks: dict[str, asyncio.Task] = {}

    async def run(self, key: str, factory: Callable[[], Awaitable[T]]) -> tuple[T, bool]:
        async with self._lock:
            task = self._tasks.get(key)
            joined = task is not None
            if task is None:
                task = asyncio.create_task(factory())
                self._tasks[key] = task
        try:
            return await asyncio.shield(task), joined
        finally:
            if task.done():
                async with self._lock:
                    if self._tasks.get(key) is task:
                        self._tasks.pop(key, None)
