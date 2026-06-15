from __future__ import annotations

from dataclasses import dataclass
from threading import Lock
from time import monotonic
from typing import Any, Callable


@dataclass
class CacheEntry:
    value: Any
    expires_at: float


class TTLCache:
    def __init__(self) -> None:
        self._entries: dict[tuple, CacheEntry] = {}
        self._lock = Lock()

    def get_or_set(self, key: tuple, ttl_seconds: float, factory: Callable[[], Any]) -> Any:
        now = monotonic()
        with self._lock:
            entry = self._entries.get(key)
            if entry is not None and entry.expires_at > now:
                return entry.value

        value = factory()
        with self._lock:
            self._entries[key] = CacheEntry(value=value, expires_at=monotonic() + ttl_seconds)
        return value

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()
