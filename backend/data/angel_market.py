from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime
from math import inf
from pathlib import Path
from typing import Any

try:
    import httpx
except ImportError:  # pragma: no cover
    httpx = None

try:
    import pyotp
except ImportError:  # pragma: no cover
    pyotp = None

try:
    from SmartApi.smartConnect import SmartConnect
except ImportError:  # pragma: no cover
    SmartConnect = None  # type: ignore[assignment]


DEFAULT_MASTER_URL = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json"
BASE_DIR = Path(__file__).resolve().parents[1]
CACHE_DIR = BASE_DIR / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
MASTER_CACHE_PATH = CACHE_DIR / "angel_openapi_scrip_master.json"
ENV_PATH = BASE_DIR.parent / ".env"


def _load_local_env() -> None:
    if not ENV_PATH.exists():
        return
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


@dataclass(frozen=True)
class AngelInstrument:
    token: str
    symbol: str
    name: str
    exch_seg: str
    instrumenttype: str
    expiry: datetime | None
    strike: float | None
    option_type: str | None


@dataclass(frozen=True)
class AngelQuote:
    strike: float
    option_type: str
    maturity_days: int
    expiry_date: str | None
    last_price: float | None
    volume: int | None
    open_interest: int | None
    source: str
    source_status: str


@dataclass(frozen=True)
class AngelFetchResult:
    quotes: dict[tuple[str, int, float], AngelQuote]
    status: str
    detail: str | None = None


def _parse_expiry(value: str | None) -> datetime | None:
    if not value:
        return None
    cleaned = value.strip()
    for fmt in ("%d%b%Y", "%d%b%y", "%Y-%m-%d", "%d-%b-%Y", "%d-%b-%y"):
        try:
            return datetime.strptime(cleaned, fmt)
        except ValueError:
            continue
    return None


def _parse_strike(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        strike = float(value)
    except (TypeError, ValueError):
        return None
    if strike >= 10000:
        strike = strike / 100.0
    return strike


def _normalize_record(raw: dict[str, Any]) -> AngelInstrument:
    symbol = str(raw.get("symbol") or "").strip()
    option_type = "call" if symbol.endswith("CE") else "put" if symbol.endswith("PE") else None
    return AngelInstrument(
        token=str(raw.get("token") or "").strip(),
        symbol=symbol,
        name=str(raw.get("name") or "").strip().upper(),
        exch_seg=str(raw.get("exch_seg") or "").strip().upper(),
        instrumenttype=str(raw.get("instrumenttype") or "").strip().upper(),
        expiry=_parse_expiry(raw.get("expiry")),
        strike=_parse_strike(raw.get("strike")),
        option_type=option_type,
    )


def _download_master() -> list[dict[str, Any]]:
    if httpx is None:
        raise RuntimeError("httpx_not_installed")
    response = httpx.get(DEFAULT_MASTER_URL, timeout=20.0, follow_redirects=True)
    response.raise_for_status()
    payload = response.json()
    MASTER_CACHE_PATH.write_text(json.dumps(payload), encoding="utf-8")
    return payload


def _load_master() -> list[AngelInstrument]:
    if MASTER_CACHE_PATH.exists():
        payload = json.loads(MASTER_CACHE_PATH.read_text(encoding="utf-8"))
    else:
        payload = _download_master()
    return [_normalize_record(row) for row in payload]


def _check_angel_connectivity(timeout: float = 3.0) -> bool:
    import socket
    try:
        sock = socket.create_connection(("apiconnect.angelone.in", 443), timeout=timeout)
        sock.close()
        return True
    except Exception:
        return False


def _login_client() -> Any:
    _load_local_env()
    if SmartConnect is None or pyotp is None:
        raise RuntimeError("angel_dependencies_missing")
    if not _check_angel_connectivity():
        raise RuntimeError("angel_host_unreachable")
    credentials = {
        "api_key": os.getenv("ANGEL_API_KEY", "").strip(),
        "client_id": os.getenv("ANGEL_CLIENT_ID", "").strip(),
        "password": os.getenv("ANGEL_PASSWORD", "").strip(),
        "totp_secret": os.getenv("ANGEL_TOTP_SECRET", "").strip(),
    }
    missing = [name for name, value in credentials.items() if not value]
    if missing:
        raise RuntimeError(f"angel_credentials_missing:{','.join(missing)}")
    client = SmartConnect(api_key=credentials["api_key"])
    totp = pyotp.TOTP(credentials["totp_secret"]).now()
    session = client.generateSession(credentials["client_id"], credentials["password"], totp)
    if not session.get("status"):
        raise RuntimeError(f"angel_login_failed:{session.get('message')}")
    return client


def _filter_equity_options(records: list[AngelInstrument], symbol: str) -> list[AngelInstrument]:
    normalized = symbol.replace(".NS", "").upper()
    return [
        record
        for record in records
        if record.name == normalized
        and record.exch_seg == "NFO"
        and record.instrumenttype == "OPTSTK"
        and record.option_type in {"call", "put"}
        and record.expiry is not None
        and record.strike is not None
    ]


def _closest_contract(records: list[AngelInstrument], strike: float, maturity_days: int, option_type: str) -> AngelInstrument | None:
    best: AngelInstrument | None = None
    best_distance = inf
    today = datetime.utcnow().date()
    for record in records:
        if record.option_type != option_type or record.expiry is None or record.strike is None:
            continue
        actual_maturity = max((record.expiry.date() - today).days, 0)
        distance = abs(actual_maturity - maturity_days) * 10_000 + abs(record.strike - strike)
        if distance < best_distance:
            best_distance = distance
            best = record
    return best


def fetch_live_option_quotes_angel(symbol: str, definitions: list[dict]) -> AngelFetchResult:
    try:
        records = _load_master()
        client = _login_client()
    except Exception as exc:
        return AngelFetchResult(quotes={}, status="fallback", detail=str(exc))

    option_records = _filter_equity_options(records, symbol)
    if not option_records:
        return AngelFetchResult(quotes={}, status="fallback", detail="angel_no_option_contracts")

    quotes: dict[tuple[str, int, float], AngelQuote] = {}
    for definition in definitions:
        requested_strike = float(definition["strike"])
        contract = _closest_contract(
            option_records,
            requested_strike,
            int(definition["maturity_days"]),
            str(definition["option_type"]),
        )
        if contract is None:
            continue
        try:
            response = client.ltpData("NFO", contract.symbol, contract.token)
            data = response.get("data") or {}
        except Exception:
            continue
        ltp = data.get("ltp") or data.get("lastPrice") or data.get("close")
        if ltp is None:
            continue
        maturity_days = max((contract.expiry.date() - datetime.utcnow().date()).days, 0) if contract.expiry else int(definition["maturity_days"])
        quotes[(definition["option_type"], definition["maturity_days"], requested_strike)] = AngelQuote(
            strike=float(contract.strike or definition["strike"]),
            option_type=str(definition["option_type"]),
            maturity_days=maturity_days,
            expiry_date=contract.expiry.strftime("%Y-%m-%d") if contract.expiry else None,
            last_price=float(ltp),
            volume=int(data["tradeVolume"]) if data.get("tradeVolume") is not None else None,
            open_interest=int(data["openInterest"]) if data.get("openInterest") is not None else None,
            source="angel",
            source_status="live",
        )

    return AngelFetchResult(
        quotes=quotes,
        status="live" if quotes else "fallback",
        detail="matched_contracts" if quotes else "angel_no_ltp_matches",
    )
