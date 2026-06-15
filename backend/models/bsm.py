from __future__ import annotations

from dataclasses import dataclass
from math import exp, log, sqrt

from backend.models.normal import normal_cdf


@dataclass
class OptionQuote:
    option_type: str
    spot: float
    strike: float
    time_to_expiry: float
    risk_free_rate: float
    volatility: float
    price: float
    d1: float
    d2: float


def _validate_inputs(spot: float, strike: float, time_to_expiry: float, volatility: float) -> None:
    if spot <= 0 or strike <= 0:
        raise ValueError("Spot and strike must be positive.")
    if time_to_expiry <= 0:
        raise ValueError("Time to expiry must be positive.")
    if volatility <= 0:
        raise ValueError("Volatility must be positive.")


def compute_d1_d2(
    spot: float,
    strike: float,
    time_to_expiry: float,
    risk_free_rate: float,
    volatility: float,
) -> tuple[float, float]:
    _validate_inputs(spot, strike, time_to_expiry, volatility)
    vol_term = volatility * sqrt(time_to_expiry)
    d1 = (log(spot / strike) + (risk_free_rate + 0.5 * volatility**2) * time_to_expiry) / vol_term
    d2 = d1 - vol_term
    return d1, d2


def black_scholes_price(
    option_type: str,
    spot: float,
    strike: float,
    time_to_expiry: float,
    risk_free_rate: float,
    volatility: float,
) -> OptionQuote:
    d1, d2 = compute_d1_d2(spot, strike, time_to_expiry, risk_free_rate, volatility)
    discount = exp(-risk_free_rate * time_to_expiry)

    if option_type == "call":
        price = spot * normal_cdf(d1) - strike * discount * normal_cdf(d2)
    elif option_type == "put":
        price = strike * discount * normal_cdf(-d2) - spot * normal_cdf(-d1)
    else:
        raise ValueError("option_type must be 'call' or 'put'.")

    return OptionQuote(
        option_type=option_type,
        spot=spot,
        strike=strike,
        time_to_expiry=time_to_expiry,
        risk_free_rate=risk_free_rate,
        volatility=volatility,
        price=float(price),
        d1=float(d1),
        d2=float(d2),
    )
