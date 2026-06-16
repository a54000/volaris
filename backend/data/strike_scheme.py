from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pandas as pd

try:
    import httpx
except ImportError:  # pragma: no cover
    httpx = None


BASE_DIR = Path(__file__).resolve().parents[1]
CACHE_DIR = BASE_DIR / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
PARSED_CACHE_PATH = CACHE_DIR / "nse_stock_option_strike_scheme.json"
SOURCE_CACHE_PATH = CACHE_DIR / "nse_stock_option_strike_scheme.xls"


def infer_strike_step(current_price: float) -> float:
    if current_price < 100:
        return 2.5
    if current_price < 250:
        return 5.0
    if current_price < 1000:
        return 10.0
    if current_price < 2500:
        return 20.0
    if current_price < 10000:
        return 50.0
    return 100.0


def snap_to_strike(price: float, step: float) -> float:
    return round(price / step) * step


def build_target_strikes(current_price: float, step: float, otm_count: int = 5) -> list[float]:
    atm_strike = snap_to_strike(current_price, step)
    strikes = [atm_strike + step * offset for offset in range(-otm_count, otm_count + 1)]
    return sorted({float(strike) for strike in strikes if strike > 0})


def _normalize_symbol(value: Any) -> str:
    return str(value).replace(".NS", "").strip().upper()


def _resolve_source_path() -> Path | None:
    maybe_download_source()
    env_path = os.getenv("NSE_STRIKE_SCHEME_FILE")
    if env_path:
        candidate = Path(env_path).expanduser()
        if candidate.exists():
            return candidate
    if SOURCE_CACHE_PATH.exists():
        return SOURCE_CACHE_PATH
    return None


def maybe_download_source(timeout: float = 20.0) -> Path | None:
    url = os.getenv("NSE_STRIKE_SCHEME_URL")
    if not url or SOURCE_CACHE_PATH.exists() or httpx is None:
        return SOURCE_CACHE_PATH if SOURCE_CACHE_PATH.exists() else None
    try:
        response = httpx.get(url, timeout=timeout, follow_redirects=True)
        response.raise_for_status()
        SOURCE_CACHE_PATH.write_bytes(response.content)
        return SOURCE_CACHE_PATH
    except Exception:
        return None


def bootstrap_strike_scheme_cache() -> dict[str, float]:
    maybe_download_source()
    return load_strike_scheme_cache()


def _extract_mapping_from_frame(frame: pd.DataFrame) -> dict[str, float]:
    lowered = {str(column).strip().lower(): column for column in frame.columns}
    symbol_column = next((column for key, column in lowered.items() if "symbol" in key or "security" in key or "underlying" in key), None)
    step_column = next((column for key, column in lowered.items() if "strike" in key and ("scheme" in key or "step" in key or "interval" in key)), None)
    if symbol_column is None or step_column is None:
        return {}

    mapping: dict[str, float] = {}
    for _, row in frame.iterrows():
        symbol = _normalize_symbol(row.get(symbol_column))
        step_raw = row.get(step_column)
        if not symbol or symbol == "NAN" or step_raw is None or step_raw != step_raw:
            continue
        try:
            mapping[symbol] = float(step_raw)
        except (TypeError, ValueError):
            continue
    return mapping


def refresh_strike_scheme_cache() -> dict[str, float]:
    source_path = _resolve_source_path()
    if source_path is None:
        return {}

    workbook = pd.read_excel(source_path, sheet_name=None)
    mapping: dict[str, float] = {}
    for frame in workbook.values():
        extracted = _extract_mapping_from_frame(frame)
        if extracted:
            mapping.update(extracted)

    if mapping:
        PARSED_CACHE_PATH.write_text(json.dumps(mapping, indent=2, sort_keys=True))
    return mapping


def load_strike_scheme_cache() -> dict[str, float]:
    if PARSED_CACHE_PATH.exists():
        try:
            return json.loads(PARSED_CACHE_PATH.read_text())
        except json.JSONDecodeError:
            pass
    return refresh_strike_scheme_cache()


def get_symbol_strike_step(symbol: str, current_price: float) -> float:
    mapping = load_strike_scheme_cache()
    normalized_symbol = _normalize_symbol(symbol)
    step = mapping.get(normalized_symbol)
    if step is not None:
        return float(step)
    return infer_strike_step(current_price)
