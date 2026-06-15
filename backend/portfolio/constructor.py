from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Position:
    symbol: str
    option_type: str
    quantity: int
    strike: float
    maturity_days: int
    valuation_price: float
    delta: float
    gamma: float
    vega: float


def default_strategy(symbol: str, spot: float, option_type: str, strike: float, maturity_days: int, price: float, delta: float, gamma: float, vega: float) -> Position:
    quantity = 1 if option_type == "call" else -1
    return Position(
        symbol=symbol,
        option_type=option_type,
        quantity=quantity,
        strike=strike,
        maturity_days=maturity_days,
        valuation_price=price,
        delta=delta,
        gamma=gamma,
        vega=vega,
    )
