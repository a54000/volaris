from __future__ import annotations

import json
import time
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
CACHE_DIR = BASE_DIR / "backend" / "data" / "fetcher_cache"
STALE_SECONDS = 259200  # 72h — covers weekend gap (Fri 3:30 PM → Mon 9:30 AM), overwritten by next fetch

CACHE_DIR.mkdir(parents=True, exist_ok=True)

QUOTES_PATH = CACHE_DIR / "nse_quotes.json"
OPTION_PREFIX = "option_chain_"
ANGEL_PREFIX = "angel_quotes_"


def _is_fresh(path: Path) -> bool:
    if not path.exists():
        return False
    if time.time() - path.stat().st_mtime > STALE_SECONDS:
        return False
    return True


def _load_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _save_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, default=str), encoding="utf-8")


def get_stock_quote(symbol: str) -> dict | None:
    if not _is_fresh(QUOTES_PATH):
        return None
    raw = _load_json(QUOTES_PATH)
    if raw is None:
        return None
    bare = symbol.replace(".NS", "").upper()
    return raw.get("quotes", {}).get(bare)


def save_stock_quotes(quotes: dict[str, dict]) -> None:
    _save_json(QUOTES_PATH, {"fetched_at": time.time(), "quotes": quotes})


def get_option_chain(symbol: str) -> dict | None:
    bare = symbol.replace(".NS", "").upper()
    path = CACHE_DIR / f"{OPTION_PREFIX}{bare}.json"
    if not _is_fresh(path):
        return None
    raw = _load_json(path)
    if raw is None:
        return None
    return raw.get("payload")


def save_option_chain(symbol: str, payload: dict) -> None:
    bare = symbol.replace(".NS", "").upper()
    path = CACHE_DIR / f"{OPTION_PREFIX}{bare}.json"
    _save_json(path, {"fetched_at": time.time(), "payload": payload})


def get_angel_quotes(symbol: str) -> list[dict] | None:
    bare = symbol.replace(".NS", "").upper()
    path = CACHE_DIR / f"{ANGEL_PREFIX}{bare}.json"
    if not _is_fresh(path):
        return None
    raw = _load_json(path)
    if raw is None:
        return None
    return raw.get("quotes")


def save_angel_quotes(symbol: str, quotes: list[dict]) -> None:
    bare = symbol.replace(".NS", "").upper()
    path = CACHE_DIR / f"{ANGEL_PREFIX}{bare}.json"
    _save_json(path, {"fetched_at": time.time(), "quotes": quotes})


def save_ingested(payload: dict) -> dict[str, int]:
    counts: dict[str, int] = {}
    if "stock_quotes" in payload:
        save_stock_quotes(payload["stock_quotes"])
        counts["stock_quotes"] = len(payload["stock_quotes"])
    if "option_chains" in payload:
        for symbol, chain in payload["option_chains"].items():
            save_option_chain(symbol, chain)
        counts["option_chains"] = len(payload["option_chains"])
    if "angel_quotes" in payload:
        for symbol, quotes in payload["angel_quotes"].items():
            save_angel_quotes(symbol, quotes)
        counts["angel_quotes"] = len(payload["angel_quotes"])
    return counts
