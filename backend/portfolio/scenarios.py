from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ScenarioResult:
    price_shock: float
    volatility_shock: float
    estimated_pnl: float


def estimate_option_pnl(delta: float, gamma: float, vega: float, spot: float, price_shock: float, volatility_shock: float) -> float:
    delta_spot = spot * price_shock
    vol_points = volatility_shock
    return float(delta * delta_spot + 0.5 * gamma * delta_spot**2 + vega * (vol_points * 100.0))


def build_scenarios(delta: float, gamma: float, vega: float, spot: float) -> list[ScenarioResult]:
    scenarios: list[ScenarioResult] = []
    for price_shock in (-0.02, -0.01, 0.01, 0.02):
        for volatility_shock in (-0.20, 0.20):
            scenarios.append(
                ScenarioResult(
                    price_shock=price_shock,
                    volatility_shock=volatility_shock,
                    estimated_pnl=estimate_option_pnl(delta, gamma, vega, spot, price_shock, volatility_shock),
                )
            )
    return scenarios
