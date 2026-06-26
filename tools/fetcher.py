"""Local data fetcher for FRAM Risk Analytics.

Fetches Indian market data blocked from US datacenters and pushes to the VM.
Run this on your local Windows/Mac machine during market hours.

Depends on:
    pip install requests yfinance  # for stock quotes (bonus)
    pip install SmartApi pyotp     # for Angel One option quotes (primary)

Usage:
    set ANGEL_API_KEY=xxx ANGEL_CLIENT_ID=xxx ANGEL_PASSWORD=xxx ANGEL_TOTP_SECRET=xxx
    set FETCHER_TOKEN=secret
    set VM_URL=https://volaris.hrgp.in
    python tools/fetcher.py
"""

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

# Auto-load .env from project root
HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent
ENV_PATH = PROJECT_ROOT / ".env"
if ENV_PATH.exists():
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SYMBOLS = [
    "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS",
    "HINDUNILVR.NS", "ITC.NS", "SBIN.NS", "BHARTIARTL.NS", "KOTAKBANK.NS",
    "BAJFINANCE.NS", "LT.NS", "WIPRO.NS", "AXISBANK.NS", "TITAN.NS",
    "ASIANPAINT.NS", "MARUTI.NS", "HCLTECH.NS", "SUNPHARMA.NS", "ONGC.NS",
    "M&M.NS", "TATAMOTORS.NS", "NTPC.NS", "POWERGRID.NS", "ULTRACEMCO.NS",
    "NESTLEIND.NS", "BAJAJFINSV.NS", "JSWSTEEL.NS", "TATASTEEL.NS", "ADANIPORTS.NS",
    "COALINDIA.NS", "GRASIM.NS", "INDUSINDBK.NS", "DRREDDY.NS", "BRITANNIA.NS",
    "CIPLA.NS", "APOLLOHOSP.NS", "HAL.NS", "HEROMOTOCO.NS", "HDFCLIFE.NS",
    "SBILIFE.NS", "DIVISLAB.NS", "BAJAJ-AUTO.NS", "EICHERMOT.NS", "HINDALCO.NS",
    "TATACONSUM.NS", "PIDILITIND.NS", "BEL.NS", "TRENT.NS", "TECHM.NS",
]
TRACKED_SYMBOLS = ["RELIANCE.NS", "HDFCBANK.NS", "TCS.NS", "INFY.NS"]

VM_URL = os.getenv("VM_URL", "https://volaris.hrgp.in")
FETCHER_TOKEN = os.getenv("FETCHER_TOKEN", "")

# ---------------------------------------------------------------------------
# Angel One helpers
# ---------------------------------------------------------------------------
DEFAULT_MASTER_URL = (
    "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json"
)


def _download_master() -> list[dict]:
    import httpx
    resp = httpx.get(DEFAULT_MASTER_URL, timeout=30.0, follow_redirects=True)
    resp.raise_for_status()
    return resp.json()


def _filter_option_contracts(master: list[dict], name: str) -> list[dict]:
    normalized = name.upper()
    out: list[dict] = []
    for row in master:
        if (
            row.get("name", "").upper() == normalized
            and row.get("exch_seg") == "NFO"
            and row.get("instrumenttype") == "OPTSTK"
        ):
            symbol = (row.get("symbol") or "").strip()
            if symbol.endswith("CE") or symbol.endswith("PE"):
                out.append(row)
    return out


def _parse_expiry(value: str | None) -> datetime | None:
    if not value:
        return None
    for fmt in ("%d%b%Y", "%d%b%y", "%Y-%m-%d", "%d-%b-%Y", "%d-%b-%y"):
        try:
            return datetime.strptime(value.strip(), fmt)
        except ValueError:
            continue
    return None


def _parse_strike(value) -> float | None:
    if value is None:
        return None
    try:
        strike = float(value)
        if strike >= 10000:
            strike /= 100.0
        return strike
    except (TypeError, ValueError):
        return None


def login_angel():
    from SmartApi.smartConnect import SmartConnect
    import pyotp

    api_key = os.getenv("ANGEL_API_KEY", "")
    client_id = os.getenv("ANGEL_CLIENT_ID", "")
    password = os.getenv("ANGEL_PASSWORD", "")
    totp_secret = os.getenv("ANGEL_TOTP_SECRET", "")
    missing = [k for k, v in [("ANGEL_API_KEY", api_key), ("ANGEL_CLIENT_ID", client_id),
                               ("ANGEL_PASSWORD", password), ("ANGEL_TOTP_SECRET", totp_secret)] if not v]
    if missing:
        raise RuntimeError(f"Missing Angel One env vars: {', '.join(missing)}")

    client = SmartConnect(api_key=api_key)
    totp = pyotp.TOTP(totp_secret).now()
    session = client.generateSession(client_id, password, totp)
    if not session.get("status"):
        raise RuntimeError(f"Angel login failed: {session.get('message')}")
    return client


def fetch_angel_option_quotes(client, symbol: str) -> list[dict]:
    """Fetch ALL option contract LTPs for a given equity via Angel One."""
    bare = symbol.replace(".NS", "")
    print(f"  Downloading scrip master ...")
    master = _download_master()
    contracts = _filter_option_contracts(master, bare)
    print(f"  Found {len(contracts)} option contracts for {bare}")

    if not contracts:
        return []

    today = datetime.now(timezone.utc).date()
    quotes: list[dict] = []
    batch_size = 20

    for i in range(0, len(contracts), batch_size):
        batch = contracts[i : i + batch_size]
        for contract in batch:
            token = (contract.get("token") or "").strip()
            sym = (contract.get("symbol") or "").strip()
            expiry = _parse_expiry(contract.get("expiry"))
            strike = _parse_strike(contract.get("strike"))
            if not token or not sym or not expiry or strike is None:
                continue

            maturity_days = max((expiry.date() - today).days, 0)
            opt_type = "call" if sym.endswith("CE") else "put"

            try:
                resp = client.ltpData("NFO", sym, token)
                data = resp.get("data") or {}
                ltp = data.get("ltp") or data.get("lastPrice") or data.get("close")
                if ltp is None:
                    continue
                quotes.append({
                    "strike": strike,
                    "option_type": opt_type,
                    "maturity_days": maturity_days,
                    "expiry_date": expiry.strftime("%Y-%m-%d"),
                    "last_price": float(ltp),
                    "volume": int(data["tradeVolume"]) if data.get("tradeVolume") is not None else None,
                    "open_interest": int(data["openInterest"]) if data.get("openInterest") is not None else None,
                    "source": "angel",
                    "source_status": "live",
                })
            except Exception as exc:
                print(f"    {sym}: {exc}")

        if i + batch_size < len(contracts):
            print(f"    ... {min(i + batch_size, len(contracts))}/{len(contracts)} contracts")
            time.sleep(0.5)

    return quotes


# ---------------------------------------------------------------------------
# Stock quotes (bonus — yfinance, works from anywhere)
# ---------------------------------------------------------------------------
def fetch_stock_quotes() -> dict[str, dict]:
    import yfinance as yf
    quotes: dict[str, dict] = {}
    for symbol in SYMBOLS:
    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period="1d", interval="1d", auto_adjust=False)
        bare = symbol.replace(".NS", "")
        if hist.empty:
            info = ticker.fast_info
            quotes[bare] = {
                "close": info.last_price if hasattr(info, "last_price") else 0,
                "open": info.day_open if hasattr(info, "day_open") else 0,
                "high": info.day_high if hasattr(info, "day_high") else 0,
                "low": info.day_low if hasattr(info, "day_low") else 0,
                "volume": 0,
                "previous_close": info.previous_close if hasattr(info, "previous_close") else 0,
            }
        else:
            row = hist.iloc[-1]
            quotes[bare] = {
                "open": float(row.get("Open", 0) or 0),
                "high": float(row.get("High", 0) or 0),
                "low": float(row.get("Low", 0) or 0),
                "close": float(row.get("Close", 0) or 0),
                "volume": int(row.get("Volume", 0) or 0),
                "previous_close": float(hist["Close"].iloc[-2]) if len(hist) > 1 else float(row.get("Close", 0) or 0),
            }
    except Exception as exc:
        print(f"    {symbol}: {exc}")
    return quotes


# ---------------------------------------------------------------------------
# Push to VM
# ---------------------------------------------------------------------------
def push_to_vm(payload: dict) -> bool:
    import requests
    total_size = sum(len(json.dumps(v)) if isinstance(v, dict) else 1 for v in payload.values())
    print(f"  Payload: ~{total_size // 1024} KB")
    try:
        resp = requests.post(f"{VM_URL}/api/fetcher/ingest", json=payload, timeout=60.0)
        if resp.status_code == 200:
            print(f"  Push OK: {resp.json()}")
            return True
        else:
            print(f"  Push failed ({resp.status_code}): {resp.text[:300]}")
            return False
    except Exception as exc:
        print(f"  Push error: {exc}")
        return False


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    print(f"=== FRAM Fetcher === {time.strftime('%Y-%m-%d %H:%M:%S.%Z')}")
    print(f"VM: {VM_URL}")
    print()

    # 1. Stock quotes (yfinance — bonus)
    print("1. Stock quotes (yfinance) ...")
    stock_quotes = fetch_stock_quotes()
    print(f"   Got {len(stock_quotes)} / {len(SYMBOLS)}")

    # 2. Angel One option quotes (primary blocked data)
    print()
    print("2. Angel One option quotes (SmartApi) ...")
    try:
        client = login_angel()
        print("   Login OK")
    except RuntimeError as exc:
        print(f"   SKIP: {exc}")
        client = None

    angel_quotes: dict[str, list[dict]] = {}
    if client:
        for symbol in TRACKED_SYMBOLS:
            print(f"   [{symbol}] ...")
            quotes = fetch_angel_option_quotes(client, symbol)
            if quotes:
                angel_quotes[symbol] = quotes
                print(f"     {len(quotes)} quotes")
            else:
                print(f"     0 quotes (skipped)")

    # 3. Assemble payload
    payload: dict = {}
    if stock_quotes:
        payload["stock_quotes"] = stock_quotes
    if angel_quotes:
        payload["angel_quotes"] = angel_quotes
    if FETCHER_TOKEN:
        payload["token"] = FETCHER_TOKEN

    if not any(k in payload for k in ("stock_quotes", "angel_quotes")):
        print("\nNothing to push.")
        return

    # 4. Push
    print(f"\n3. Pushing {len(payload)} payload keys to VM ...")
    push_to_vm(payload)
    print("\nDone.")


if __name__ == "__main__":
    main()
