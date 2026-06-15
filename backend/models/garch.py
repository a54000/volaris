from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

try:
    from arch import arch_model
except ImportError:  # pragma: no cover
    arch_model = None


@dataclass
class GarchResult:
    annualized_volatility: float
    conditional_volatility: list[float]
    forecast_volatility: float
    method: str
    metadata: dict


def fit_garch_11(returns: pd.Series, trading_days: int = 252) -> GarchResult:
    clean_returns = returns.dropna().astype(float)
    if clean_returns.empty:
        raise ValueError("Cannot fit GARCH model on empty returns series.")

    if arch_model is None or len(clean_returns) < 30:
        realized_daily_vol = float(clean_returns.std(ddof=1))
        annualized_vol = realized_daily_vol * np.sqrt(trading_days)
        conditional_path = [realized_daily_vol] * len(clean_returns)
        return GarchResult(
            annualized_volatility=annualized_vol,
            conditional_volatility=conditional_path,
            forecast_volatility=annualized_vol,
            method="realized_vol_fallback",
            metadata={"reason": "arch_unavailable_or_insufficient_data"},
        )

    scaled_returns = clean_returns * 100.0
    model = arch_model(scaled_returns, vol="Garch", p=1, q=1, mean="Constant", dist="normal")
    fitted = model.fit(disp="off")
    conditional_daily = fitted.conditional_volatility / 100.0
    forecast = fitted.forecast(horizon=1, reindex=False)
    forecast_daily_vol = float(np.sqrt(forecast.variance.values[-1, 0]) / 100.0)

    return GarchResult(
        annualized_volatility=float(conditional_daily.iloc[-1] * np.sqrt(trading_days)),
        conditional_volatility=conditional_daily.tolist(),
        forecast_volatility=float(forecast_daily_vol * np.sqrt(trading_days)),
        method="garch_11",
        metadata={
            "omega": float(fitted.params.get("omega", np.nan)),
            "alpha_1": float(fitted.params.get("alpha[1]", np.nan)),
            "beta_1": float(fitted.params.get("beta[1]", np.nan)),
        },
    )
