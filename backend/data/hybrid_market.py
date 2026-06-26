from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
import importlib

try:
    import numpy as np
except ImportError:
    np = None  # type: ignore[assignment]

try:
    import yfinance as yf
except ImportError:  # pragma: no cover - handled at runtime
    yf = None  # type: ignore[assignment]

try:
    from nsefin import NSEClient
except ImportError:  # pragma: no cover - optional dependency
    NSEClient = None  # type: ignore[assignment]

from backend.data.angel_market import fetch_live_option_quotes_angel
from backend.data.options import fetch_live_option_quotes
from backend.data.strike_scheme import build_target_strikes, get_symbol_strike_step


def _require_yfinance() -> None:
    if yf is None:
        raise RuntimeError("yfinance_not_installed")


def _normalize_stock_quote_payload(payload: dict, fallback_symbol: str) -> dict | None:
    if not isinstance(payload, dict):
        return None

    def pick_number(*keys: str) -> float | int | None:
        for key in keys:
            value = payload.get(key)
            if isinstance(value, (int, float)):
                return value
            if isinstance(value, str):
                try:
                    cleaned = value.replace(",", "").strip()
                    if cleaned:
                        return float(cleaned)
                except ValueError:
                    continue
        return None

    open_value = pick_number("open", "dayOpen", "openPrice")
    high_value = pick_number("high", "dayHigh", "intraDayHighLow.max", "highPrice")
    low_value = pick_number("low", "dayLow", "intraDayHighLow.min", "lowPrice")
    close_value = pick_number("close", "lastPrice", "ltp", "price", "last")
    previous_close = pick_number("previousClose", "previous_close", "prevClose", "closePrice")
    volume = pick_number("volume", "totalTradedVolume", "tradedVolume")

    if close_value is None:
        return None

    return {
        "symbol": payload.get("symbol") or payload.get("ticker") or fallback_symbol,
        "open": float(open_value) if open_value is not None else None,
        "high": float(high_value) if high_value is not None else None,
        "low": float(low_value) if low_value is not None else None,
        "close": float(close_value),
        "previous_close": float(previous_close) if previous_close is not None else None,
        "volume": int(volume) if volume is not None else None,
    }


def _call_quote_provider(target: object, symbol: str) -> dict | None:
    candidate_methods = (
        "get_quote",
        "stock_quote",
        "quote",
        "equity_quote",
        "equity_info",
        "price_info",
    )
    bare_symbol = symbol.replace(".NS", "")
    for method_name in candidate_methods:
        method = getattr(target, method_name, None)
        if not callable(method):
            continue
        for candidate_symbol in (bare_symbol, symbol):
            try:
                payload = method(candidate_symbol)
            except TypeError:
                continue
            except Exception:
                break
            normalized = _normalize_stock_quote_payload(payload, bare_symbol)
            if normalized:
                return normalized
    return None


def _fetch_nse_stock_quote(symbol: str) -> tuple[dict | None, str | None]:
    bare_symbol = symbol.replace(".NS", "")

    if NSEClient is not None:
        try:
            client = NSEClient()
            payload = client._get_json(  # type: ignore[attr-defined]
                client.endpoints.QUOTE_EQUITY,  # type: ignore[attr-defined]
                params={"symbol": bare_symbol},
                ref_path=client.endpoints.REF_LIVE_EQ_MARKET,  # type: ignore[attr-defined]
            )
            normalized = _normalize_stock_quote_payload(payload if isinstance(payload, dict) else {}, bare_symbol)
            if normalized:
                return normalized, "nsefin"
        except Exception:
            pass

    candidates = ("nsepython",)
    class_candidates = ("NSE", "NSEfin", "Nse")
    for module_name in candidates:
        try:
            module = importlib.import_module(module_name)
        except Exception:
            continue

        direct_result = _call_quote_provider(module, bare_symbol)
        if direct_result:
            return direct_result, module_name

        for class_name in class_candidates:
            cls = getattr(module, class_name, None)
            if cls is None:
                continue
            try:
                instance = cls()
            except Exception:
                continue
            instance_result = _call_quote_provider(instance, bare_symbol)
            if instance_result:
                return instance_result, module_name

    return None, None

def _generate_stock_fallback(ticker: str, start_date: str, end_date: str) -> dict:
    import numpy as np
    symbol = ticker if ticker.endswith(".NS") else f"{ticker}.NS"
    start = datetime.strptime(start_date, "%Y-%m-%d")
    end = datetime.strptime(end_date, "%Y-%m-%d")
    rng = np.random.default_rng(seed=hash(ticker) % (2 ** 31))
    base_price = rng.uniform(150, 3200)
    rows: list[dict] = []
    current = start
    while current <= end:
        if current.weekday() < 5:
            change = rng.normal(0, base_price * 0.018)
            price = base_price + change
            rows.append({
                "date": current.strftime("%Y-%m-%d"),
                "open": round(base_price, 2),
                "high": round(max(base_price, price) * 1.005, 2),
                "low": round(min(base_price, price) * 0.995, 2),
                "close": round(price, 2),
                "volume": int(rng.integers(100000, 5000000)),
            })
            base_price = price
        current += timedelta(days=1)
    if not rows:
        rows = [{"date": start.strftime("%Y-%m-%d"), "open": base_price, "high": base_price, "low": base_price, "close": base_price, "volume": 0}]
    last = rows[-1]
    return {
        "ticker": symbol,
        "provider": "fallback",
        "source": "backend_live",
        "last_price": last["close"],
        "live_quote": {
            "open": last["open"], "high": last["high"], "low": last["low"],
            "close": last["close"], "previous_close": rows[-2]["close"] if len(rows) > 1 else last["close"],
            "volume": last["volume"],
        },
        "historical_data": rows,
    }


def fetch_stock_history(ticker: str, start_date: str, end_date: str) -> dict:
    _require_yfinance()
    symbol = ticker if ticker.endswith(".NS") else f"{ticker}.NS"

    def _fetch_yfinance_history() -> tuple[list[dict], bool]:
        try:
            history = yf.Ticker(symbol).history(start=start_date, end=end_date, interval="1d", auto_adjust=False)
        except Exception:
            return [], True
        if hasattr(history, "empty") and history.empty:
            return [], True
        history = history.dropna(subset=["Close"])
        rows = [
            {
                "date": index.strftime("%Y-%m-%d"),
                "open": float(row["Open"]),
                "high": float(row["High"]),
                "low": float(row["Low"]),
                "close": float(row["Close"]),
                "volume": int(row["Volume"]) if row["Volume"] == row["Volume"] else 0,
            }
            for index, row in history.iterrows()
            if row["Close"] == row["Close"]
        ]
        return rows, False

    with ThreadPoolExecutor(max_workers=2) as pool:
        yf_future = pool.submit(_fetch_yfinance_history)
        nse_future = pool.submit(_fetch_nse_stock_quote, symbol)

        history_rows, history_failed = yf_future.result()
        nse_quote, nse_provider = nse_future.result()

    if history_failed or not history_rows:
        return _generate_stock_fallback(ticker, start_date, end_date)

    last = history_rows[-1]
    previous_close = history_rows[-2]["close"] if len(history_rows) > 1 else last["close"]
    live_quote = {
        "open": nse_quote["open"] if nse_quote and nse_quote.get("open") is not None else last["open"],
        "high": nse_quote["high"] if nse_quote and nse_quote.get("high") is not None else last["high"],
        "low": nse_quote["low"] if nse_quote and nse_quote.get("low") is not None else last["low"],
        "close": nse_quote["close"] if nse_quote and nse_quote.get("close") is not None else last["close"],
        "previous_close": nse_quote["previous_close"] if nse_quote and nse_quote.get("previous_close") is not None else previous_close,
        "volume": nse_quote["volume"] if nse_quote and nse_quote.get("volume") is not None else last["volume"],
    }
    return {
        "ticker": symbol,
        "provider": nse_provider or "yfinance",
        "source": "backend_live",
        "last_price": live_quote["close"],
        "live_quote": live_quote,
        "historical_data": [
            {
                "date": row["date"],
                "price": row["close"],
                "open": row["open"],
                "high": row["high"],
                "low": row["low"],
                "close": row["close"],
                "volume": row["volume"],
            }
            for row in history_rows
        ],
    }


def fetch_option_chain(ticker: str, current_price: float, hist_volatility: float, risk_free_rate: float) -> dict:
    strike_step = get_symbol_strike_step(ticker, current_price)
    target_strikes = build_target_strikes(current_price, strike_step, otm_count=5)
    definitions: list[dict] = []
    for maturity in (30, 60):
        for strike in target_strikes:
            definitions.append({"strike": strike, "maturity_days": maturity, "option_type": "call"})
            definitions.append({"strike": strike, "maturity_days": maturity, "option_type": "put"})

    live_fetch = fetch_live_option_quotes_angel(ticker, definitions)
    if not live_fetch.quotes:
        live_fetch = fetch_live_option_quotes(ticker, definitions)
    if live_fetch.quotes:
        chain: dict[str, list[dict]] = {}
        chain_seen: dict[str, set[str]] = {}
        provider_name = None
        for definition in definitions:
            quote = live_fetch.quotes.get((definition["option_type"], definition["maturity_days"], float(definition["strike"])))
            if quote is None:
                continue
            provider_name = provider_name or getattr(quote, "source", None)
            maturity_key = str(quote.maturity_days)
            row_id = f"{ticker}-{quote.strike}-{quote.maturity_days}-{quote.option_type}"
            seen_ids = chain_seen.setdefault(maturity_key, set())
            if row_id in seen_ids:
                continue
            seen_ids.add(row_id)
            chain.setdefault(maturity_key, []).append(
                {
                    "id": row_id,
                    "strike": float(quote.strike),
                    "maturity": quote.maturity_days,
                    "type": quote.option_type,
                    "market_price": float(quote.last_price or 0.0),
                    "bid": float(quote.last_price * 0.99) if quote.last_price is not None else 0.0,
                    "ask": float(quote.last_price * 1.01) if quote.last_price is not None else 0.0,
                    "open_interest": int(quote.open_interest or 0),
                    "volume": int(quote.volume or 0),
                    "iv": float((getattr(quote, "implied_volatility", None) or (hist_volatility * 100.0)) / 100.0),
                    "expiry_date": quote.expiry_date,
                    "source": "backend_live",
                    "provider": getattr(quote, "source", "nse"),
                }
            )

        if chain:
            for maturity_key, rows in chain.items():
                rows.sort(key=lambda row: (row["strike"], row["type"]))
            return {
                "ticker": ticker if ticker.endswith(".NS") else f"{ticker}.NS",
                "provider": provider_name or "hybrid",
                "source": "backend_live",
                "risk_free_rate": risk_free_rate,
                "hist_volatility": hist_volatility,
                "spot": current_price,
                "strike_step": strike_step,
                "target_strikes": target_strikes,
                "chain": chain,
                "detail": live_fetch.detail,
            }

    _require_yfinance()
    symbol = ticker if ticker.endswith(".NS") else f"{ticker}.NS"
    stock = yf.Ticker(symbol)
    expiries = list(stock.options[:3])
    if not expiries:
        raise RuntimeError("no_expiries")

    chain: dict[str, list[dict]] = {}
    now = datetime.utcnow()

    for expiry in expiries:
        option_chain = stock.option_chain(expiry)
        expiry_date = datetime.strptime(expiry, "%Y-%m-%d")
        maturity_days = max(1, (expiry_date - now).days)
        rows: list[dict] = []

        for frame, option_type in ((option_chain.calls, "call"), (option_chain.puts, "put")):
            if frame.empty:
                continue

            filtered = frame[(frame["strike"] >= current_price * 0.8) & (frame["strike"] <= current_price * 1.2)]
            for _, row in filtered.iterrows():
                implied_volatility = float(row.get("impliedVolatility") or hist_volatility)
                last_price = float(row.get("lastPrice") or 0.0)
                bid = float(row.get("bid") or 0.0)
                ask = float(row.get("ask") or 0.0)
                rows.append(
                    {
                        "id": str(row.get("contractSymbol") or f"{row['strike']}-{maturity_days}-{option_type}"),
                        "strike": float(row["strike"]),
                        "maturity": maturity_days,
                        "type": option_type,
                        "market_price": last_price,
                        "bid": bid,
                        "ask": ask,
                        "open_interest": int(row.get("openInterest") or 0),
                        "volume": int(row.get("volume") or 0),
                        "iv": implied_volatility if implied_volatility > 0 else hist_volatility,
                        "source": "backend_live",
                        "provider": "yfinance",
                    }
                )

        if rows:
            chain[str(maturity_days)] = rows

    if not chain:
        raise RuntimeError("empty_option_chain")

    return {
        "ticker": symbol,
        "provider": "yfinance",
        "source": "backend_live",
        "risk_free_rate": risk_free_rate,
        "hist_volatility": hist_volatility,
        "spot": current_price,
        "strike_step": strike_step,
        "target_strikes": target_strikes,
        "chain": chain,
    }
