from __future__ import annotations

import math


def delta_hedge_shares(portfolio_delta: float, underlying_delta: float = 1.0) -> float:
    if underlying_delta == 0:
        raise ValueError("underlying_delta must be non-zero.")
    return float(-portfolio_delta / underlying_delta)


def compute_liquidity_adjustment(
    amihud_illiquidity: float | None,
    amihud_ref: float,
    turnover_cr: float | None,
    turnover_ref: float,
    min_hedge_ratio: float = 0.65,
    base_turnover_ratio: float = 0.7,
) -> float:
    if amihud_illiquidity is None or amihud_ref <= 0:
        amihud_ratio = 1.0
    else:
        normalized = amihud_illiquidity / amihud_ref
        amihud_ratio = max(min_hedge_ratio, 1.0 - min(normalized, 1.0))

    if turnover_cr is None or turnover_ref <= 0:
        turnover_ratio = 0.85
    else:
        turnover_input = max(turnover_cr, 1.0)
        log_factor = math.log(turnover_input + 1) / math.log(turnover_ref + 1)
        turnover_ratio = max(
            base_turnover_ratio,
            min(1.0, base_turnover_ratio + 0.3 * min(1.0, log_factor)),
        )

    return math.sqrt(amihud_ratio * turnover_ratio)


def liquidity_adjusted_hedge_shares(
    hedge_shares: float,
    amihud_illiquidity: float | None,
    amihud_ref: float | None = None,
    turnover_cr: float | None = None,
    turnover_ref: float | None = None,
) -> float:
    if amihud_ref is None:
        return hedge_shares

    ratio = compute_liquidity_adjustment(
        amihud_illiquidity,
        amihud_ref,
        turnover_cr,
        turnover_ref or 1.0,
    )
    return float(hedge_shares * ratio)
