from __future__ import annotations

from dataclasses import asdict
from datetime import date
from typing import Any

import numpy as np
import pandas as pd

from backend.data.fetcher import compute_stock_analytics, fetch_price_history
from backend.data.nifty50 import NIFTY50_SYMBOLS
from backend.services.cache import TTLCache

SCREENER_CACHE = TTLCache()
SCREENER_TTL_SECONDS = 24 * 60 * 60

SECTOR_MAP: dict[str, str] = {
    "ADANIENT": "Conglomerate",
    "ADANIPORTS": "Logistics",
    "APOLLOHOSP": "Healthcare",
    "ASIANPAINT": "Chemicals",
    "AXISBANK": "Banking",
    "BAJAJ-AUTO": "Auto",
    "BAJFINANCE": "NBFC",
    "BAJAJFINSV": "Financials",
    "BEL": "Defense",
    "BHARTIARTL": "Telecom",
    "CIPLA": "Pharma",
    "COALINDIA": "Mining",
    "DRREDDY": "Pharma",
    "EICHERMOT": "Auto",
    "ETERNAL": "Consumer",
    "GRASIM": "Materials",
    "HCLTECH": "IT",
    "HDFCBANK": "Banking",
    "HDFCLIFE": "Insurance",
    "HEROMOTOCO": "Auto",
    "HINDALCO": "Metals",
    "HINDUNILVR": "FMCG",
    "ICICIBANK": "Banking",
    "INDUSINDBK": "Banking",
    "INFY": "IT",
    "ITC": "FMCG",
    "JIOFIN": "Financials",
    "JSWSTEEL": "Metals",
    "KOTAKBANK": "Banking",
    "LT": "Industrials",
    "M&M": "Auto",
    "MARUTI": "Auto",
    "NESTLEIND": "FMCG",
    "NTPC": "Utilities",
    "ONGC": "Energy",
    "POWERGRID": "Utilities",
    "RELIANCE": "Energy",
    "SBILIFE": "Insurance",
    "SBIN": "Banking",
    "SHRIRAMFIN": "NBFC",
    "SUNPHARMA": "Pharma",
    "TATACONSUM": "FMCG",
    "TATAMOTORS": "Auto",
    "TATASTEEL": "Metals",
    "TCS": "IT",
    "TECHM": "IT",
    "TITAN": "Consumer",
    "TRENT": "Retail",
    "ULTRACEMCO": "Cement",
    "WIPRO": "IT",
}


def compute_amihud(ticker: str, prices_df: pd.DataFrame) -> float:
    _ = ticker
    returns = np.log(prices_df["Close"] / prices_df["Close"].shift(1))
    turnover = prices_df["Close"] * prices_df["Volume"]
    amihud = (returns.abs() / turnover.replace(0, np.nan)) * 1_000_000
    return float(amihud.dropna().mean()) if amihud.notna().any() else 0.0


def compute_turnover(prices_df: pd.DataFrame) -> float:
    turnover = prices_df["Close"] * prices_df["Volume"]
    return float(turnover.mean()) if not turnover.empty else 0.0


def compute_realized_vol(prices_df: pd.DataFrame) -> float:
    returns = np.log(prices_df["Close"] / prices_df["Close"].shift(1))
    return float(returns.std() * np.sqrt(252)) if returns.dropna().size > 1 else 0.0


def classify_liquidity_tier(turnover: float) -> str:
    turnover_cr = turnover / 10_000_000
    if turnover_cr >= 75:
        return "HIGH"
    if turnover_cr >= 30:
        return "MEDIUM"
    return "LOW"


def _symbol_label(symbol: str) -> str:
    return symbol.replace(".NS", "")


def _build_ranked_rows(months: int = 6) -> list[dict[str, Any]]:
    histories = fetch_price_history(symbols=NIFTY50_SYMBOLS, months=months, end_date=date.today())
    rows: list[dict[str, Any]] = []
    for symbol, history in histories.items():
        if history.empty:
            continue
        analytics = compute_stock_analytics(history, symbol)
        label = _symbol_label(symbol)
        turnover = compute_turnover(history)
        row = {
            "ticker": label,
            "symbol": symbol,
            "sector": SECTOR_MAP.get(label, "Other"),
            "avg_daily_turnover": turnover,
            "avg_daily_turnover_cr": turnover / 10_000_000,
            "amihud": compute_amihud(label, history),
            "realized_vol": compute_realized_vol(history),
            "garch_iv": analytics.garch_annualized_volatility,
            "turnover_ratio": analytics.average_turnover_ratio or 0.0,
            "liquidity_tier": classify_liquidity_tier(turnover),
            "latest_close": analytics.latest_close,
            "data_source": history.attrs.get("source", "live"),
        }
        rows.append(row)

    rows.sort(key=lambda item: item["avg_daily_turnover"], reverse=True)
    bucket_size = 12
    for index, row in enumerate(rows, start=1):
        row["rank"] = index
        if index <= bucket_size:
            row["quartile_bucket"] = "TOP 25%"
        elif index > len(rows) - bucket_size:
            row["quartile_bucket"] = "BOTTOM 25%"
        else:
            row["quartile_bucket"] = "MIDDLE 50%"
    return rows


def _serialize_selection(row: dict[str, Any], kind: str) -> dict[str, Any]:
    return {
        "ticker": row["ticker"],
        "rank": row["rank"],
        "turnover_cr": row["avg_daily_turnover_cr"],
        "amihud": row["amihud"],
        "realized_vol": row["realized_vol"],
        "garch_iv": row["garch_iv"],
        "liquidity_tier": row["liquidity_tier"],
        "data_source": row["data_source"],
        "selection_kind": kind,
    }


def _build_justification(liquid: dict[str, Any], illiquid: dict[str, Any], total_count: int) -> str:
    turnover_gap = liquid["avg_daily_turnover_cr"] / illiquid["avg_daily_turnover_cr"] if illiquid["avg_daily_turnover_cr"] else 0.0
    amihud_gap = liquid["amihud"] and illiquid["amihud"] / liquid["amihud"] if liquid["amihud"] else 0.0
    return (
        f"{liquid['ticker']} (Rank {liquid['rank']}/{total_count}) selected as liquid stock with "
        f"₹{liquid['avg_daily_turnover_cr']:.1f}Cr avg daily turnover and Amihud ratio of {liquid['amihud']:.4f}, "
        f"placing it in the top 25% of NIFTY 50 by liquidity. {illiquid['ticker']} "
        f"(Rank {illiquid['rank']}/{total_count}) selected as illiquid with ₹{illiquid['avg_daily_turnover_cr']:.1f}Cr "
        f"turnover and Amihud {illiquid['amihud']:.4f} (bottom 25%). The {turnover_gap:.1f}× turnover gap "
        f"and {amihud_gap:.1f}× Amihud gap confirm strong liquidity contrast for comparative analysis."
    )


def build_screener_payload(months: int = 6) -> dict[str, Any]:
    def factory() -> dict[str, Any]:
        ranked = _build_ranked_rows(months=months)
        top_bucket = [row for row in ranked if row["quartile_bucket"] == "TOP 25%"]
        bottom_bucket = [row for row in ranked if row["quartile_bucket"] == "BOTTOM 25%"]
        liquid = top_bucket[0]
        illiquid = bottom_bucket[-1]
        turnover_gap = liquid["avg_daily_turnover_cr"] / illiquid["avg_daily_turnover_cr"] if illiquid["avg_daily_turnover_cr"] else 0.0
        amihud_gap = illiquid["amihud"] / liquid["amihud"] if liquid["amihud"] else 0.0
        vol_gap = (liquid["realized_vol"] - illiquid["realized_vol"]) * 100
        return {
            "generated_at": date.today().isoformat(),
            "window_months": months,
            "universe_size": len(ranked),
            "liquid_selection": _serialize_selection(liquid, "liquid"),
            "illiquid_selection": _serialize_selection(illiquid, "illiquid"),
            "headline_metrics": {
                "turnover_gap": turnover_gap,
                "amihud_gap": amihud_gap,
                "vol_gap_pct_points": vol_gap,
            },
            "justification": _build_justification(liquid, illiquid, len(ranked)),
            "ranked": ranked,
        }

    return SCREENER_CACHE.get_or_set(("screener", months), SCREENER_TTL_SECONDS, factory)
