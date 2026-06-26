from __future__ import annotations

from dataclasses import asdict
from functools import partial

import numpy as np
import pandas as pd

from backend.data.fno import FNO_EQUITY_SYMBOLS
from backend.data.options import fetch_live_option_quotes
from backend.data.fetcher import build_market_snapshot, fetch_price_history
from backend.models.bsm import black_scholes_price
from backend.models.greeks import black_scholes_greeks
from backend.models.var import build_var_profile, classify_volatility_regime
from backend.portfolio.constructor import default_strategy
from backend.portfolio.hedger import delta_hedge_shares, liquidity_adjusted_hedge_shares
from backend.portfolio.scenarios import build_scenarios
from backend.services.cache import TTLCache


ANALYTICS_CACHE = TTLCache()
SNAPSHOT_TTL_SECONDS = 300.0
OPTIONS_TTL_SECONDS = 180.0
PORTFOLIO_TTL_SECONDS = 180.0
RISK_TTL_SECONDS = 180.0


def _snapshot_by_symbol(months: int) -> tuple[dict, dict[str, dict], dict[str, pd.DataFrame]]:
    snapshot = build_market_snapshot(months=months)
    histories = fetch_price_history(months=months)
    by_symbol = {row["symbol"]: row for row in snapshot["all_stocks"]}
    return snapshot, by_symbol, histories


def get_snapshot_bundle(months: int = 6) -> tuple[dict, dict[str, dict], dict[str, pd.DataFrame]]:
    return ANALYTICS_CACHE.get_or_set(
        ("snapshot_bundle", months),
        SNAPSHOT_TTL_SECONDS,
        partial(_snapshot_by_symbol, months),
    )


def clear_analytics_cache(months: int | None = None) -> dict[str, str]:
    if months is None:
        ANALYTICS_CACHE.clear()
        return {"status": "cleared", "scope": "all"}

    prefixes = [
        ("snapshot_bundle", months),
        ("options", months),
        ("portfolio", months),
        ("risk", months),
    ]
    for prefix in prefixes:
        ANALYTICS_CACHE.clear_prefix(prefix)
    return {"status": "cleared", "scope": f"months={months}"}


def _option_definitions(spot: float) -> list[dict]:
    return [
        {"label": "ATM Call 30D", "option_type": "call", "strike": spot, "maturity_days": 30},
        {"label": "OTM Call 30D", "option_type": "call", "strike": spot * 1.075, "maturity_days": 30},
        {"label": "OTM Put 30D", "option_type": "put", "strike": spot * 0.925, "maturity_days": 30},
        {"label": "ATM Call 60D", "option_type": "call", "strike": spot, "maturity_days": 60},
        {"label": "OTM Call 60D", "option_type": "call", "strike": spot * 1.075, "maturity_days": 60},
        {"label": "OTM Put 60D", "option_type": "put", "strike": spot * 0.925, "maturity_days": 60},
    ]


def _select_option_symbols(snapshot: dict) -> list[tuple[str, str]]:
    selected: list[tuple[str, str]] = []
    seen: set[str] = set()

    for bucket_name, rows in (("liquid", snapshot["liquid_bucket"]), ("illiquid", snapshot["illiquid_bucket"])):
        for row in rows:
            symbol = row["symbol"]
            if symbol not in FNO_EQUITY_SYMBOLS or symbol in seen:
                continue
            selected.append((symbol, bucket_name))
            seen.add(symbol)
            if len(selected) >= 4:
                return selected

    for row in snapshot["all_stocks"]:
        symbol = row["symbol"]
        if symbol not in FNO_EQUITY_SYMBOLS or symbol in seen:
            continue
        bucket_name = "liquid" if any(item["symbol"] == symbol for item in snapshot["liquid_bucket"]) else "illiquid"
        selected.append((symbol, bucket_name))
        seen.add(symbol)
        if len(selected) >= 4:
            break

    return selected


def _build_options_analytics_uncached(months: int = 6, risk_free_rate: float = 0.07) -> dict:
    snapshot, by_symbol, _ = get_snapshot_bundle(months)
    selected_symbols = _select_option_symbols(snapshot)
    options_output: list[dict] = []

    for symbol, bucket_name in selected_symbols:
        stock = by_symbol[symbol]
        spot = stock["latest_close"]
        historical_vol = stock["latest_realized_vol_20d"] or stock["garch_annualized_volatility"]
        garch_vol = stock["garch_forecast_volatility"] or stock["garch_annualized_volatility"]
        definitions = _option_definitions(spot)
        live_fetch = fetch_live_option_quotes(symbol, definitions)
        live_quotes = live_fetch.quotes

        contracts = []
        for definition in definitions:
            time_to_expiry = definition["maturity_days"] / 365.0
            hist_quote = black_scholes_price(
                definition["option_type"],
                spot,
                definition["strike"],
                time_to_expiry,
                risk_free_rate,
                max(historical_vol, 1e-6),
            )
            hist_greeks = black_scholes_greeks(
                definition["option_type"],
                spot,
                definition["strike"],
                time_to_expiry,
                risk_free_rate,
                max(historical_vol, 1e-6),
            )
            garch_quote = black_scholes_price(
                definition["option_type"],
                spot,
                definition["strike"],
                time_to_expiry,
                risk_free_rate,
                max(garch_vol, 1e-6),
            )
            garch_greeks = black_scholes_greeks(
                definition["option_type"],
                spot,
                definition["strike"],
                time_to_expiry,
                risk_free_rate,
                max(garch_vol, 1e-6),
            )
            live_quote = live_quotes.get((definition["option_type"], definition["maturity_days"]))
            market_iv = (live_quote.implied_volatility / 100.0) if live_quote and live_quote.implied_volatility is not None else None
            if market_iv is not None:
                market_quote = black_scholes_price(
                    definition["option_type"], spot, definition["strike"],
                    time_to_expiry, risk_free_rate, market_iv,
                )
                market_greeks = black_scholes_greeks(
                    definition["option_type"], spot, definition["strike"],
                    time_to_expiry, risk_free_rate, market_iv,
                )
            else:
                market_quote = None
                market_greeks = None
            contracts.append(
                {
                    "label": definition["label"],
                    "option_type": definition["option_type"],
                    "strike": round(live_quote.strike if live_quote is not None else definition["strike"], 2),
                    "maturity_days": definition["maturity_days"],
                    "expiry_date": live_quote.expiry_date if live_quote is not None else None,
                    "market_price": round(live_quote.last_price, 4) if live_quote and live_quote.last_price is not None else round(garch_quote.price * 1.02, 4),
                    "market_price_source": live_quote.source if live_quote is not None else "proxy",
                    "market_price_status": live_quote.source_status if live_quote is not None else "fallback",
                    "market_implied_volatility": round(market_iv, 6) if market_iv is not None else None,
                    "market_volume": live_quote.volume if live_quote is not None else None,
                    "market_open_interest": live_quote.open_interest if live_quote is not None else None,
                    "historical_volatility": round(historical_vol, 6),
                    "garch_volatility": round(garch_vol, 6),
                    "bsm_historical_vol_price": round(hist_quote.price, 4),
                    "bsm_garch_vol_price": round(garch_quote.price, 4),
                    "bsm_market_vol_price": round(market_quote.price, 4) if market_quote is not None else None,
                    "greeks_historical_vol": {
                        "delta": round(hist_greeks.delta, 6),
                        "gamma": round(hist_greeks.gamma, 6),
                        "vega": round(hist_greeks.vega, 6),
                        "theta": round(hist_greeks.theta, 6),
                        "rho": round(hist_greeks.rho, 6),
                    },
                    "greeks_garch_vol": {
                        "delta": round(garch_greeks.delta, 6),
                        "gamma": round(garch_greeks.gamma, 6),
                        "vega": round(garch_greeks.vega, 6),
                        "theta": round(garch_greeks.theta, 6),
                        "rho": round(garch_greeks.rho, 6),
                    },
                    "greeks_market_vol": {
                        "delta": round(market_greeks.delta, 6),
                        "gamma": round(market_greeks.gamma, 6),
                        "vega": round(market_greeks.vega, 6),
                        "theta": round(market_greeks.theta, 6),
                        "rho": round(market_greeks.rho, 6),
                    } if market_greeks is not None else None,
                }
            )

        options_output.append(
            {
                "symbol": symbol,
                "bucket": bucket_name,
                "spot": round(spot, 4),
                "historical_volatility": round(historical_vol, 6),
                "garch_volatility": round(garch_vol, 6),
                "market_data_source": "nse_with_proxy_fallback",
                "market_data_status": live_fetch.status,
                "market_data_detail": live_fetch.detail,
                "contracts": contracts,
            }
        )

    return {
        "months": months,
        "risk_free_rate": risk_free_rate,
        "selection_policy": "fno_filtered_liquidity_rank",
        "symbols": options_output,
    }


def build_options_analytics(months: int = 6, risk_free_rate: float = 0.07) -> dict:
    return ANALYTICS_CACHE.get_or_set(
        ("options", months, round(risk_free_rate, 6)),
        OPTIONS_TTL_SECONDS,
        partial(_build_options_analytics_uncached, months, risk_free_rate),
    )


def _build_portfolio_analytics_uncached(months: int = 6, risk_free_rate: float = 0.07) -> dict:
    snapshot, _, _ = get_snapshot_bundle(months)
    chosen = snapshot["liquid_bucket"][:1] + snapshot["illiquid_bucket"][:1]

    all_stocks = snapshot.get("all_stocks", [])
    amihud_vals = sorted([s["average_amihud_illiquidity"] for s in all_stocks if s.get("average_amihud_illiquidity") is not None])
    turnover_vals = sorted([s["average_turnover"] for s in all_stocks if s.get("average_turnover") is not None])

    n_amihud = len(amihud_vals)
    n_turnover = len(turnover_vals)
    amihud_ref = amihud_vals[min(int(0.75 * n_amihud), n_amihud - 1)] if n_amihud > 0 else 1.0
    turnover_ref_cr = (turnover_vals[min(int(0.50 * n_turnover), n_turnover - 1)] / 10_000_000) if n_turnover > 0 else 1.0

    portfolios: list[dict] = []

    for stock in chosen:
        symbol = stock["symbol"]
        spot = stock["latest_close"]
        garch_vol = stock["garch_forecast_volatility"] or stock["garch_annualized_volatility"]
        strike = spot if stock in snapshot["liquid_bucket"] else spot * 0.925
        option_type = "call" if stock in snapshot["liquid_bucket"] else "put"
        maturity_days = 30
        time_to_expiry = maturity_days / 365.0

        quote = black_scholes_price(option_type, spot, strike, time_to_expiry, risk_free_rate, max(garch_vol, 1e-6))
        greeks = black_scholes_greeks(option_type, spot, strike, time_to_expiry, risk_free_rate, max(garch_vol, 1e-6))
        position = default_strategy(symbol, spot, option_type, strike, maturity_days, quote.price, greeks.delta, greeks.gamma, greeks.vega)

        portfolio_delta = position.quantity * position.delta
        portfolio_gamma = position.quantity * position.gamma
        portfolio_vega = position.quantity * position.vega
        hedge_shares = delta_hedge_shares(portfolio_delta)
        turnover_cr = (stock.get("average_turnover") or 0) / 10_000_000
        adjusted_hedge = liquidity_adjusted_hedge_shares(
            hedge_shares,
            stock["average_amihud_illiquidity"],
            amihud_ref=amihud_ref,
            turnover_cr=turnover_cr,
            turnover_ref=turnover_ref_cr,
        )

        portfolios.append(
            {
                "symbol": symbol,
                "bucket": "liquid" if stock in snapshot["liquid_bucket"] else "illiquid",
                "position": asdict(position),
                "portfolio_greeks": {
                    "delta": round(portfolio_delta, 6),
                    "gamma": round(portfolio_gamma, 6),
                    "vega": round(portfolio_vega, 6),
                },
                "hedge": {
                    "raw_shares": round(hedge_shares, 6),
                    "liquidity_adjusted_shares": round(adjusted_hedge, 6),
                },
                "scenarios": [asdict(item) for item in build_scenarios(portfolio_delta, portfolio_gamma, portfolio_vega, spot)],
            }
        )

    return {"months": months, "risk_free_rate": risk_free_rate, "portfolios": portfolios}


def build_portfolio_analytics(months: int = 6, risk_free_rate: float = 0.07) -> dict:
    return ANALYTICS_CACHE.get_or_set(
        ("portfolio", months, round(risk_free_rate, 6)),
        PORTFOLIO_TTL_SECONDS,
        partial(_build_portfolio_analytics_uncached, months, risk_free_rate),
    )


def _build_risk_analytics_uncached(months: int = 6) -> dict:
    snapshot, by_symbol, histories = get_snapshot_bundle(months)
    selected = snapshot["liquid_bucket"][:1] + snapshot["illiquid_bucket"][:1]
    risk_rows: list[dict] = []

    for stock in selected:
        symbol = stock["symbol"]
        history = histories[symbol].copy()
        returns = np.log(history["Close"] / history["Close"].shift(1)).dropna()
        regime = classify_volatility_regime(returns)
        portfolio_value = float(stock["latest_close"] * 100.0)
        var_profile = build_var_profile(portfolio_value, returns, stock["garch_forecast_volatility"])

        risk_rows.append(
            {
                "symbol": symbol,
                "bucket": "liquid" if stock in snapshot["liquid_bucket"] else "illiquid",
                "regime": regime,
                "portfolio_value": round(portfolio_value, 2),
                "var": [asdict(item) for item in var_profile],
            }
        )

    comparison_table = [
        {
            "symbol": row["symbol"],
            "bucket": row["bucket"],
            "regime": row["regime"],
            "var_95_parametric": row["var"][0]["parametric_var"],
            "var_99_parametric": row["var"][1]["parametric_var"],
            "var_95_garch": row["var"][0]["garch_var"],
            "var_99_garch": row["var"][1]["garch_var"],
        }
        for row in risk_rows
    ]
    return {"months": months, "comparison_table": comparison_table, "details": risk_rows}


def build_risk_analytics(months: int = 6) -> dict:
    return ANALYTICS_CACHE.get_or_set(
        ("risk", months),
        RISK_TTL_SECONDS,
        partial(_build_risk_analytics_uncached, months),
    )
