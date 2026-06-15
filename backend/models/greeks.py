from __future__ import annotations

from dataclasses import dataclass
from math import sqrt

from backend.models.bsm import compute_d1_d2
from backend.models.normal import normal_cdf, normal_pdf


@dataclass
class GreeksResult:
    delta: float
    gamma: float
    vega: float


def black_scholes_greeks(
    option_type: str,
    spot: float,
    strike: float,
    time_to_expiry: float,
    risk_free_rate: float,
    volatility: float,
) -> GreeksResult:
    d1, _ = compute_d1_d2(spot, strike, time_to_expiry, risk_free_rate, volatility)
    pdf_d1 = normal_pdf(d1)

    if option_type == "call":
        delta = normal_cdf(d1)
    elif option_type == "put":
        delta = normal_cdf(d1) - 1.0
    else:
        raise ValueError("option_type must be 'call' or 'put'.")

    gamma = pdf_d1 / (spot * volatility * sqrt(time_to_expiry))
    vega = spot * pdf_d1 * sqrt(time_to_expiry)
    return GreeksResult(delta=float(delta), gamma=float(gamma), vega=float(vega / 100.0))
