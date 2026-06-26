"""Local data fetcher for FRAM Risk Analytics.

Fetches Indian market data blocked from US datacenters and pushes to the VM.
Run this on your local Windows/Mac machine during market hours.

Usage:
    pip install requests yfinance httpx
    FETCHER_TOKEN=secret python tools/fetcher.py

Optional (Angel One):
    pip install SmartApi pyotp
    export ANGEL_API_KEY=... ANGEL_CLIENT_ID=... ANGEL_PASSWORD=... ANGEL_TOTP_SECRET=...
"""

import json
import os
import time

SYMBOLS = [
    "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS",
    "HINDUNILVR.NS", "ITC.NS", "SBIN.NS", "BHARTIARTL.NS", "KOTAKBANK.NS",
    "BAJFINANCE.NS", "LT.NS", "WIPRO.NS", "AXISBANK.NS", "TITAN.NS",
    "ASIANPAINT.NS", "MARUTI.NS", "HCLTECH.NS", "SUNPHARMA.NS", "ONGC.NS",
    "NTPC.NS", "POWERGRID.NS", "M&M.NS", "TATAMOTORS.NS", "ULTRACEMCO.NS",
    "NESTLEIND.NS", "BAJAJFINSV.NS", "JSWSTEEL.NS", "TATASTEEL.NS", "ADANIPORTS.NS",
    "COALINDIA.NS", "GRASIM.NS", "INDUSINDBK.NS", "DRREDDY.NS", "BRITANNIA.NS",
    "CIPLA.NS", "APOLLOHOSP.NS", "TECHM.NS", "HEROMOTOCO.NS", "HDFCLIFE.NS",
    "SBILIFE.NS", "DIVISLAB.NS", "BAJAJ-AUTO.NS", "EICHERMOT.NS", "HINDALCO.NS",
    "TATACONSUM.NS", "PIDILITIND.NS", "BEL.NS", "TRENT.NS", "HAL.NS",
]
TRACKED_SYMBOLS = ["RELIANCE.NS", "HDFCBANK.NS", "TCS.NS", "INFY.NS"]
NSE_BASE_URL = "https://www.nseindia.com"
NSE_OPTION_CHAIN_URL = f"{NSE_BASE_URL}/api/option-chain-equities"
NSE_HEADERS = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "en-US,en;q=0.9",
    "referer": f"{NSE_BASE_URL}/option-chain",
    "user-agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/126.0.0.0 Safari/537.36"
    ),
}
VM_URL = os.getenv("VM_URL", "https://volaris.hrgp.in")
FETCHER_TOKEN = os.getenv("FETCHER_TOKEN", "")


def fetch_stock_quotes() -> dict[str, dict]:
    import yfinance as yf
    quotes: dict[str, dict] = {}
    for symbol in SYMBOLS:
        try:
            ticker = yf.Ticker(symbol)
            hist = ticker.history(period="1d", interval="1d", auto_adjust=False)
            if hist.empty:
                info = ticker.fast_info
                quotes[symbol] = {
                    "close": info.last_price if hasattr(info, "last_price") else 0,
                    "open": info.day_open if hasattr(info, "day_open") else 0,
                    "high": info.day_high if hasattr(info, "day_high") else 0,
                    "low": info.day_low if hasattr(info, "day_low") else 0,
                    "volume": 0,
                    "previous_close": info.previous_close if hasattr(info, "previous_close") else 0,
                }
            else:
                row = hist.iloc[-1]
                quotes[symbol] = {
                    "open": float(row.get("Open", 0) or 0),
                    "high": float(row.get("High", 0) or 0),
                    "low": float(row.get("Low", 0) or 0),
                    "close": float(row.get("Close", 0) or 0),
                    "volume": int(row.get("Volume", 0) or 0),
                    "previous_close": float(hist["Close"].iloc[-2]) if len(hist) > 1 else float(row.get("Close", 0) or 0),
                }
        except Exception as exc:
            print(f"  [{symbol}] yfinance failed: {exc}")
    return quotes


def fetch_option_chain(symbol: str) -> dict | None:
    import httpx
    bare = symbol.replace(".NS", "")
    try:
        with httpx.Client(headers=NSE_HEADERS, timeout=15.0, follow_redirects=True) as client:
            client.get(f"{NSE_BASE_URL}/option-chain", headers=NSE_HEADERS)
            resp = client.get(NSE_OPTION_CHAIN_URL, params={"symbol": bare})
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        print(f"  [{symbol}] option chain failed: {exc}")
        return None


def fetch_angel_quotes(symbol: str) -> list[dict] | None:
    try:
        import pyotp
        from SmartApi.smartConnect import SmartConnect
    except ImportError:
        print("  Angel One: SmartApi/pyotp not installed")
        return None

    api_key = os.getenv("ANGEL_API_KEY", "")
    client_id = os.getenv("ANGEL_CLIENT_ID", "")
    password = os.getenv("ANGEL_PASSWORD", "")
    totp_secret = os.getenv("ANGEL_TOTP_SECRET", "")
    if not all([api_key, client_id, password, totp_secret]):
        print("  Angel One: missing credentials")
        return None

    try:
        client = SmartConnect(api_key=api_key)
        totp = pyotp.TOTP(totp_secret).now()
        session = client.generateSession(client_id, password, totp)
        if not session.get("status"):
            print(f"  Angel One login failed: {session.get('message')}")
            return None

        quotes: list[dict] = []
        bare = symbol.replace(".NS", "")
        for strike in range(2000, 3500, 100):
            for opt_type in ("CE", "PE"):
                try:
                    resp = client.ltpData("NFO", f"{bare}{opt_type}", "")
                    data = resp.get("data") or {}
                    if data.get("ltp"):
                        quotes.append({
                            "strike": float(strike),
                            "option_type": "call" if opt_type == "CE" else "put",
                            "maturity_days": 30,
                            "last_price": float(data["ltp"]),
                            "volume": int(data.get("tradeVolume", 0) or 0),
                            "open_interest": int(data.get("openInterest", 0) or 0),
                            "source": "angel",
                            "source_status": "live",
                        })
                except Exception:
                    pass
        return quotes if quotes else None
    except Exception as exc:
        print(f"  Angel One fetch failed: {exc}")
        return None


def push_to_vm(payload: dict) -> bool:
    import requests
    total_size = sum(len(json.dumps(v)) if isinstance(v, dict) else 1 for v in payload.values())
    print(f"  Payload size: ~{total_size // 1024} KB")
    try:
        resp = requests.post(f"{VM_URL}/api/fetcher/ingest", json=payload, timeout=30.0)
        if resp.status_code == 200:
            print(f"  Push OK: {resp.json()}")
            return True
        else:
            print(f"  Push failed ({resp.status_code}): {resp.text[:200]}")
            return False
    except Exception as exc:
        print(f"  Push error: {exc}")
        return False


def main() -> None:
    print(f"FRAM Fetcher — {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"VM: {VM_URL}")
    print(f"Symbols: {len(SYMBOLS)} stock quotes, {len(TRACKED_SYMBOLS)} option chains")
    print()

    print("1. Fetching stock quotes ...")
    stock_quotes = fetch_stock_quotes()
    print(f"   Got {len(stock_quotes)} quotes")

    print("2. Fetching option chains ...")
    option_chains: dict[str, dict] = {}
    for symbol in TRACKED_SYMBOLS:
        print(f"   [{symbol}] ...")
        chain = fetch_option_chain(symbol)
        if chain:
            option_chains[symbol] = chain
            print(f"     OK")
        else:
            print(f"     FAILED")

    print("3. Fetching Angel One quotes ...")
    angel_quotes: dict[str, list[dict]] = {}
    for symbol in TRACKED_SYMBOLS[:1]:
        quotes = fetch_angel_quotes(symbol)
        if quotes:
            angel_quotes[symbol] = quotes
            print(f"   [{symbol}] got {len(quotes)} quotes")

    payload: dict = {}
    if stock_quotes:
        payload["stock_quotes"] = stock_quotes
    if option_chains:
        payload["option_chains"] = option_chains
    if angel_quotes:
        payload["angel_quotes"] = angel_quotes
    if FETCHER_TOKEN:
        payload["token"] = FETCHER_TOKEN

    if not any(k in payload for k in ("stock_quotes", "option_chains", "angel_quotes")):
        print("\nNothing to push.")
        return

    print(f"\n4. Pushing to VM ...")
    push_to_vm(payload)
    print("\nDone.")


if __name__ == "__main__":
    main()
