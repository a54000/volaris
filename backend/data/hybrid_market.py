from __future__ import annotations

from datetime import datetime

try:
    import yfinance as yf
except ImportError:  # pragma: no cover - handled at runtime
    yf = None  # type: ignore[assignment]

from backend.data.angel_market import fetch_live_option_quotes_angel
from backend.data.options import fetch_live_option_quotes
from backend.data.strike_scheme import build_target_strikes, get_symbol_strike_step


def _require_yfinance() -> None:
    if yf is None:
        raise RuntimeError("yfinance_not_installed")

def fetch_stock_history(ticker: str, start_date: str, end_date: str) -> dict:
    _require_yfinance()
    symbol = ticker if ticker.endswith(".NS") else f"{ticker}.NS"
    history = yf.Ticker(symbol).history(start=start_date, end=end_date, interval="1d", auto_adjust=False)
    if history.empty:
        raise RuntimeError("empty_history")

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
    if not rows:
        raise RuntimeError("no_valid_prices")

    last = rows[-1]
    previous_close = rows[-2]["close"] if len(rows) > 1 else last["close"]
    return {
        "ticker": symbol,
        "provider": "yfinance",
        "source": "backend_live",
        "last_price": last["close"],
        "live_quote": {
            "open": last["open"],
            "high": last["high"],
            "low": last["low"],
            "close": last["close"],
            "previous_close": previous_close,
            "volume": last["volume"],
        },
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
            for row in rows
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
