from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from math import inf

try:
    import httpx
except ImportError:  # pragma: no cover
    httpx = None


NSE_BASE_URL = "https://www.nseindia.com"
NSE_OPTION_CHAIN_EQUITIES_URL = f"{NSE_BASE_URL}/api/option-chain-equities"

DEFAULT_HEADERS = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "no-cache",
    "pragma": "no-cache",
    "referer": f"{NSE_BASE_URL}/option-chain",
    "user-agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/126.0.0.0 Safari/537.36"
    ),
}


@dataclass
class LiveOptionQuote:
    strike: float
    option_type: str
    maturity_days: int
    expiry_date: str | None
    last_price: float | None
    implied_volatility: float | None
    volume: int | None
    open_interest: int | None
    source: str
    source_status: str


@dataclass
class OptionFetchResult:
    quotes: dict[tuple[str, int, float], LiveOptionQuote]
    status: str
    detail: str | None = None


def _normalize_symbol(symbol: str) -> str:
    return symbol.replace(".NS", "").upper()


def _parse_expiry_date(raw_value: str | None) -> datetime | None:
    if not raw_value:
        return None
    for fmt in ("%d-%b-%Y", "%d-%b-%y"):
        try:
            return datetime.strptime(raw_value, fmt)
        except ValueError:
            continue
    return None


def _group_rows_by_expiry(payload_rows: list[dict]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {}
    for row in payload_rows:
        expiry_raw = row.get("expiryDate")
        if not expiry_raw:
            continue
        grouped.setdefault(expiry_raw, []).append(row)
    return grouped


def _closest_expiry(expiry_rows: dict[str, list[dict]], maturity_days: int) -> tuple[str, list[dict]] | None:
    best_expiry: tuple[str, list[dict]] | None = None
    best_distance = inf
    for expiry_raw, rows in expiry_rows.items():
        expiry_dt = _parse_expiry_date(expiry_raw)
        if expiry_dt is None:
            continue
        actual_maturity = max((expiry_dt.date() - datetime.utcnow().date()).days, 0)
        distance = abs(actual_maturity - maturity_days)
        if distance < best_distance:
            best_distance = distance
            best_expiry = (expiry_raw, rows)
    return best_expiry


def _closest_strike_row(rows: list[dict], strike: float) -> dict | None:
    best_row: dict | None = None
    best_distance = inf
    for row in rows:
        strike_price = float(row.get("strikePrice", 0.0))
        distance = abs(strike_price - strike)
        if distance < best_distance:
            best_distance = distance
            best_row = row
    return best_row


def _closest_quote(payload_rows: list[dict], strike: float, option_type: str, maturity_days: int) -> LiveOptionQuote | None:
    option_key = "CE" if option_type == "call" else "PE"
    expiry_groups = _group_rows_by_expiry(payload_rows)
    expiry_match = _closest_expiry(expiry_groups, maturity_days)
    if expiry_match is None:
        return None

    expiry_raw, expiry_rows = expiry_match
    row = _closest_strike_row(expiry_rows, strike)
    if row is None:
        return None

    contract = row.get(option_key)
    if contract is None:
        return None

    expiry_dt = _parse_expiry_date(expiry_raw)
    actual_maturity = max((expiry_dt.date() - datetime.utcnow().date()).days, 0) if expiry_dt else maturity_days
    strike_price = float(row.get("strikePrice", 0.0))
    return LiveOptionQuote(
        strike=strike_price,
        option_type=option_type,
        maturity_days=actual_maturity,
        expiry_date=expiry_raw,
        last_price=float(contract["lastPrice"]) if contract.get("lastPrice") is not None else None,
        implied_volatility=float(contract["impliedVolatility"]) if contract.get("impliedVolatility") is not None else None,
        volume=int(contract["totalTradedVolume"]) if contract.get("totalTradedVolume") is not None else None,
        open_interest=int(contract["openInterest"]) if contract.get("openInterest") is not None else None,
        source="nse",
        source_status="live",
    )


def fetch_live_option_quotes(symbol: str, definitions: list[dict], timeout: float = 12.0) -> OptionFetchResult:
    if httpx is None:
        return OptionFetchResult(quotes={}, status="unavailable", detail="httpx_not_installed")

    from backend.data.fetcher_cache import get_option_chain
    cached_payload = get_option_chain(symbol)
    if cached_payload is not None:
        rows = cached_payload.get("records", {}).get("data", [])
        if rows:
            results: dict[tuple[str, int, float], LiveOptionQuote] = {}
            for definition in definitions:
                requested_strike = float(definition["strike"])
                key = (definition["option_type"], definition["maturity_days"], requested_strike)
                quote = _closest_quote(rows, requested_strike, definition["option_type"], int(definition["maturity_days"]))
                if quote is not None:
                    results[key] = quote
            status = "live" if results else "fallback"
            detail = "matched_contracts" if results else "no_contract_match"
            return OptionFetchResult(quotes=results, status=status, detail=detail)

    normalized_symbol = _normalize_symbol(symbol)
    try:
        with httpx.Client(headers=DEFAULT_HEADERS, timeout=timeout, follow_redirects=True) as client:
            client.get(f"{NSE_BASE_URL}/option-chain", headers=DEFAULT_HEADERS)
            response = client.get(NSE_OPTION_CHAIN_EQUITIES_URL, params={"symbol": normalized_symbol})
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:
        return OptionFetchResult(quotes={}, status="fallback", detail=type(exc).__name__)

    rows = payload.get("records", {}).get("data", [])
    results: dict[tuple[str, int, float], LiveOptionQuote] = {}
    for definition in definitions:
        requested_strike = float(definition["strike"])
        key = (definition["option_type"], definition["maturity_days"], requested_strike)
        quote = _closest_quote(rows, requested_strike, definition["option_type"], int(definition["maturity_days"]))
        if quote is not None:
            results[key] = quote
    status = "live" if results else "fallback"
    detail = "matched_contracts" if results else ("empty_records" if not rows else "no_contract_match")
    return OptionFetchResult(quotes=results, status=status, detail=detail)
