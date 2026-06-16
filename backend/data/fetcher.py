from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, timedelta
import warnings

import numpy as np
import pandas as pd

try:
    import yfinance as yf
except ImportError:  # pragma: no cover
    yf = None

from backend.data.nifty50 import NIFTY50_SYMBOLS
from backend.models.garch import fit_garch_11


@dataclass
class StockAnalytics:
    symbol: str
    average_turnover: float
    average_volume: float
    latest_close: float
    latest_realized_vol_20d: float | None
    average_amihud_illiquidity: float | None
    average_turnover_ratio: float | None
    garch_annualized_volatility: float
    garch_forecast_volatility: float
    garch_method: str


def _generate_mock_history(symbol: str, start: date, end: date) -> pd.DataFrame:
    dates = pd.bdate_range(start=start, end=end)
    seed = abs(hash(symbol)) % (2**32)
    rng = np.random.default_rng(seed)
    base_price = rng.uniform(150, 3200)
    daily_returns = rng.normal(0.0004, 0.018, len(dates))
    closes = base_price * np.exp(np.cumsum(daily_returns))
    volumes = rng.integers(800_000, 12_000_000, len(dates))
    opens = closes * (1 + rng.normal(0.0, 0.004, len(dates)))
    highs = np.maximum(opens, closes) * (1 + rng.uniform(0.001, 0.02, len(dates)))
    lows = np.minimum(opens, closes) * (1 - rng.uniform(0.001, 0.02, len(dates)))
    df = pd.DataFrame(
        {
            "Open": opens,
            "High": highs,
            "Low": lows,
            "Close": closes,
            "Volume": volumes,
        },
        index=dates,
    )
    df.attrs["source"] = "fallback"
    return df


def fetch_price_history(
    symbols: list[str] | None = None,
    months: int = 6,
    end_date: date | None = None,
) -> dict[str, pd.DataFrame]:
    symbols = symbols or NIFTY50_SYMBOLS
    end_date = end_date or date.today()
    start_date = end_date - timedelta(days=months * 31)

    if yf is None:
        return {symbol: _generate_mock_history(symbol, start_date, end_date) for symbol in symbols}

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", FutureWarning)
            data = yf.download(
                tickers=symbols,
                start=start_date.isoformat(),
                end=(end_date + timedelta(days=1)).isoformat(),
                interval="1d",
                group_by="ticker",
                auto_adjust=False,
                progress=False,
                threads=True,
            )
    except Exception:
        return {symbol: _generate_mock_history(symbol, start_date, end_date) for symbol in symbols}

    histories: dict[str, pd.DataFrame] = {}
    for symbol in symbols:
        if symbol in data.columns.get_level_values(0):
            history = data[symbol].dropna(how="all").copy()
        else:
            history = pd.DataFrame()
        if history.empty:
            history = _generate_mock_history(symbol, start_date, end_date)
        cleaned = history[["Open", "High", "Low", "Close", "Volume"]].dropna().copy()
        cleaned.attrs["source"] = history.attrs.get("source", "live")
        histories[symbol] = cleaned
    return histories


def _estimate_turnover_ratio(volume: pd.Series) -> pd.Series:
    estimated_free_float = max(float(volume.median()) * 250.0, 1.0)
    return volume / estimated_free_float


def compute_stock_analytics(history: pd.DataFrame, symbol: str) -> StockAnalytics:
    df = pd.DataFrame(history).copy(deep=True)
    df["log_return"] = np.log(df["Close"] / df["Close"].shift(1))
    df["turnover"] = df["Close"] * df["Volume"]
    df["rolling_vol_20d"] = df["log_return"].rolling(20).std() * np.sqrt(252)
    df["turnover_ratio"] = _estimate_turnover_ratio(df["Volume"])
    df["amihud_illiquidity"] = (df["log_return"].abs() / df["turnover"].replace(0, np.nan)) * 1_000_000

    garch_result = fit_garch_11(df["log_return"].dropna())
    latest_realized_vol = df["rolling_vol_20d"].dropna()

    return StockAnalytics(
        symbol=symbol,
        average_turnover=float(df["turnover"].mean()),
        average_volume=float(df["Volume"].mean()),
        latest_close=float(df["Close"].iloc[-1]),
        latest_realized_vol_20d=float(latest_realized_vol.iloc[-1]) if not latest_realized_vol.empty else None,
        average_amihud_illiquidity=float(df["amihud_illiquidity"].dropna().mean()) if df["amihud_illiquidity"].notna().any() else None,
        average_turnover_ratio=float(df["turnover_ratio"].mean()),
        garch_annualized_volatility=garch_result.annualized_volatility,
        garch_forecast_volatility=garch_result.forecast_volatility,
        garch_method=garch_result.method,
    )


def build_market_snapshot(symbols: list[str] | None = None, months: int = 6) -> dict:
    histories = fetch_price_history(symbols=symbols, months=months)
    analytics = [compute_stock_analytics(history, symbol) for symbol, history in histories.items()]
    analytics.sort(key=lambda row: row.average_turnover, reverse=True)

    quartile_count = max(len(analytics) // 4, 1)
    liquid = analytics[:quartile_count]
    illiquid = analytics[-quartile_count:]

    return {
        "universe_size": len(analytics),
        "analysis_window_months": months,
        "liquid_bucket": [asdict(item) for item in liquid],
        "illiquid_bucket": [asdict(item) for item in illiquid],
        "all_stocks": [asdict(item) for item in analytics],
    }
