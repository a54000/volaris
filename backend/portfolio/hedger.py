from __future__ import annotations


def delta_hedge_shares(portfolio_delta: float, underlying_delta: float = 1.0) -> float:
    if underlying_delta == 0:
        raise ValueError("underlying_delta must be non-zero.")
    return float(-portfolio_delta / underlying_delta)


def liquidity_adjusted_hedge_shares(hedge_shares: float, amihud_illiquidity: float | None) -> float:
    if amihud_illiquidity is None:
        return hedge_shares
    adjustment = max(0.0, 1.0 - min(amihud_illiquidity, 1.0))
    return float(hedge_shares * adjustment)
