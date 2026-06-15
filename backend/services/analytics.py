from __future__ import annotations

from dataclasses import asdict

import numpy as np
import pandas as pd

from backend.data.fetcher import build_market_snapshot, fetch_price_history
from backend.models.bsm import black_scholes_price
from backend.models.greeks import black_scholes_greeks
from backend.models.var import build_var_profile, classify_volatility_regime
from backend.portfolio.constructor import default_strategy
from backend.portfolio.hedger import delta_hedge_shares, liquidity_adjusted_hedge_shares
from backend.portfolio.scenarios import build_scenarios


def _snapshot_by_symbol(months: int) -> tuple[dict, dict[str, dict], dict[str, pd.DataFrame]]:
    snapshot = build_market_snapshot(months=months)
    histories = fetch_price_history(months=months)
    by_symbol = {row["symbol"]: row for row in snapshot["all_stocks"]}
    return snapshot, by_symbol, histories


def _option_definitions(spot: float) -> list[dict]:
    return [
        {"label": "ATM Call 30D", "option_type": "call", "strike": spot, "maturity_days": 30},
        {"label": "OTM Call 30D", "option_type": "call", "strike": spot * 1.075, "maturity_days": 30},
        {"label": "OTM Put 30D", "option_type": "put", "strike": spot * 0.925, "maturity_days": 30},
        {"label": "ATM Call 60D", "option_type": "call", "strike": spot, "maturity_days": 60},
        {"label": "OTM Call 60D", "option_type": "call", "strike": spot * 1.075, "maturity_days": 60},
        {"label": "OTM Put 60D", "option_type": "put", "strike": spot * 0.925, "maturity_days": 60},
    ]


def build_options_analytics(months: int = 6, risk_free_rate: float = 0.07) -> dict:
    snapshot, by_symbol, _ = _snapshot_by_symbol(months)
    selected_symbols = [row["symbol"] for row in snapshot["liquid_bucket"][:2] + snapshot["illiquid_bucket"][:2]]
    options_output: list[dict] = []

    for symbol in selected_symbols:
        stock = by_symbol[symbol]
        spot = stock["latest_close"]
        historical_vol = stock["latest_realized_vol_20d"] or stock["garch_annualized_volatility"]
        garch_vol = stock["garch_forecast_volatility"] or stock["garch_annualized_volatility"]

        contracts = []
        for definition in _option_definitions(spot):
            time_to_expiry = definition["maturity_days"] / 365.0
            hist_quote = black_scholes_price(
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
            contracts.append(
                {
                    "label": definition["label"],
                    "option_type": definition["option_type"],
                    "strike": round(definition["strike"], 2),
                    "maturity_days": definition["maturity_days"],
                    "market_price_proxy": round(garch_quote.price * 1.02, 4),
                    "bsm_historical_vol_price": round(hist_quote.price, 4),
                    "bsm_garch_vol_price": round(garch_quote.price, 4),
                }
            )

        options_output.append(
            {
                "symbol": symbol,
                "spot": round(spot, 4),
                "historical_volatility": round(historical_vol, 6),
                "garch_volatility": round(garch_vol, 6),
                "contracts": contracts,
            }
        )

    return {"months": months, "risk_free_rate": risk_free_rate, "symbols": options_output}


def build_portfolio_analytics(months: int = 6, risk_free_rate: float = 0.07) -> dict:
    snapshot, _, _ = _snapshot_by_symbol(months)
    chosen = snapshot["liquid_bucket"][:1] + snapshot["illiquid_bucket"][:1]
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
        adjusted_hedge = liquidity_adjusted_hedge_shares(hedge_shares, stock["average_amihud_illiquidity"])

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


def build_risk_analytics(months: int = 6) -> dict:
    snapshot, by_symbol, histories = _snapshot_by_symbol(months)
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
