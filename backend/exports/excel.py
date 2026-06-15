from __future__ import annotations

from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Font

from backend.services.analytics import build_options_analytics, build_portfolio_analytics, build_risk_analytics


def build_workbook_bytes(months: int = 6, risk_free_rate: float = 0.07) -> bytes:
    workbook = Workbook()
    summary_sheet = workbook.active
    summary_sheet.title = "Options"

    options_data = build_options_analytics(months=months, risk_free_rate=risk_free_rate)
    portfolio_data = build_portfolio_analytics(months=months, risk_free_rate=risk_free_rate)
    risk_data = build_risk_analytics(months=months)

    summary_sheet.append(["Symbol", "Contract", "Strike", "Expiry", "Market Price", "Market Source", "BSM Hist", "BSM GARCH"])
    for cell in summary_sheet[1]:
        cell.font = Font(bold=True)
    for symbol_block in options_data["symbols"]:
        for contract in symbol_block["contracts"]:
            summary_sheet.append(
                [
                    symbol_block["symbol"],
                    contract["label"],
                    contract["strike"],
                    contract["expiry_date"],
                    contract["market_price"],
                    contract["market_price_source"],
                    contract["bsm_historical_vol_price"],
                    contract["bsm_garch_vol_price"],
                ]
            )

    portfolio_sheet = workbook.create_sheet("Portfolio")
    portfolio_sheet.append(["Symbol", "Bucket", "Delta", "Gamma", "Vega", "Hedge Shares", "Adjusted Hedge"])
    for cell in portfolio_sheet[1]:
        cell.font = Font(bold=True)
    for row in portfolio_data["portfolios"]:
        portfolio_sheet.append(
            [
                row["symbol"],
                row["bucket"],
                row["portfolio_greeks"]["delta"],
                row["portfolio_greeks"]["gamma"],
                row["portfolio_greeks"]["vega"],
                row["hedge"]["raw_shares"],
                row["hedge"]["liquidity_adjusted_shares"],
            ]
        )

    risk_sheet = workbook.create_sheet("Risk")
    risk_sheet.append(["Symbol", "Bucket", "Regime", "VaR 95 Parametric", "VaR 99 Parametric", "VaR 95 GARCH", "VaR 99 GARCH"])
    for cell in risk_sheet[1]:
        cell.font = Font(bold=True)
    for row in risk_data["comparison_table"]:
        risk_sheet.append(
            [
                row["symbol"],
                row["bucket"],
                row["regime"],
                row["var_95_parametric"],
                row["var_99_parametric"],
                row["var_95_garch"],
                row["var_99_garch"],
            ]
        )

    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()
