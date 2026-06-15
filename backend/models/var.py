from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from backend.models.normal import inverse_normal_cdf


@dataclass
class VarResult:
    confidence_level: float
    parametric_var: float
    garch_var: float
    monte_carlo_var: float


def compute_parametric_var(portfolio_value: float, daily_volatility: float, confidence_level: float) -> float:
    z_score = inverse_normal_cdf(confidence_level)
    return float(abs(portfolio_value * daily_volatility * z_score))


def compute_garch_var(portfolio_value: float, annualized_garch_volatility: float, confidence_level: float) -> float:
    daily_volatility = annualized_garch_volatility / np.sqrt(252.0)
    return compute_parametric_var(portfolio_value, daily_volatility, confidence_level)


def compute_monte_carlo_var(
    portfolio_value: float,
    daily_volatility: float,
    confidence_level: float,
    n_paths: int = 10_000,
    seed: int = 42,
) -> float:
    rng = np.random.default_rng(seed)
    simulated_returns = rng.normal(0.0, daily_volatility, n_paths)
    simulated_pnl = portfolio_value * simulated_returns
    percentile = np.percentile(simulated_pnl, (1.0 - confidence_level) * 100.0)
    return float(abs(percentile))


def classify_volatility_regime(returns: pd.Series, window: int = 20) -> str:
    rolling_vol = returns.rolling(window).std().dropna() * np.sqrt(252.0)
    if rolling_vol.empty:
        return "normal"
    threshold = rolling_vol.quantile(0.75)
    latest = rolling_vol.iloc[-1]
    return "high_vol" if latest >= threshold else "normal"


def build_var_profile(
    portfolio_value: float,
    returns: pd.Series,
    annualized_garch_volatility: float,
    confidence_levels: tuple[float, ...] = (0.95, 0.99),
) -> list[VarResult]:
    clean_returns = returns.dropna().astype(float)
    daily_volatility = float(clean_returns.std(ddof=1)) if not clean_returns.empty else 0.0
    return [
        VarResult(
            confidence_level=level,
            parametric_var=compute_parametric_var(portfolio_value, daily_volatility, level),
            garch_var=compute_garch_var(portfolio_value, annualized_garch_volatility, level),
            monte_carlo_var=compute_monte_carlo_var(portfolio_value, daily_volatility, level),
        )
        for level in confidence_levels
    ]
