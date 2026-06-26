from __future__ import annotations

import logging
import os

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from backend.data.hybrid_market import fetch_option_chain, fetch_stock_history
from backend.data.strike_scheme import bootstrap_strike_scheme_cache
from backend.exports.excel import build_workbook_bytes
from backend.exports.report import build_report_bytes
from backend.services.analytics import (
    build_options_analytics,
    build_portfolio_analytics,
    build_risk_analytics,
    clear_analytics_cache,
    get_snapshot_bundle,
)
from backend.services.screener import build_screener_payload

logger = logging.getLogger(__name__)

app = FastAPI(
    title="FRAM Risk Analytics API",
    version="0.1.0",
    description="Backend foundation for liquidity analytics, option pricing, portfolio scenarios, and risk modeling.",
)

default_cors_origins = [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "https://volaris.hrgp.in",
]
extra_cors_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]
allowed_cors_origins = list(dict.fromkeys([*default_cors_origins, *extra_cors_origins]))

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def preload_strike_scheme_cache() -> None:
    bootstrap_strike_scheme_cache()
    _check_angel_connectivity_on_startup()
    _check_yfinance_on_startup()


def _check_angel_connectivity_on_startup() -> None:
    try:
        from backend.data.angel_market import _check_angel_connectivity
        if _check_angel_connectivity():
            logger.info("angel_connectivity: ok")
        else:
            logger.warning("angel_connectivity: unreachable — Angel option quotes will fall back to NSE/yfinance")
    except Exception as exc:
        logger.warning("angel_connectivity: check failed (%s) — Angel option quotes will fall back to NSE/yfinance", exc)


def _check_yfinance_on_startup() -> None:
    try:
        import yfinance as yf
        ticker = yf.Ticker("RELIANCE.NS")
        hist = ticker.history(period="5d", interval="1d")
        if hist.empty:
            logger.warning("yfinance_connectivity: empty response — stock history will fall back to synthetic data")
        else:
            logger.info("yfinance_connectivity: ok")
    except Exception as exc:
        logger.warning("yfinance_connectivity: check failed (%s) — stock history will fall back to synthetic data", exc)


@app.get("/health")
def healthcheck() -> dict[str, str]:
    angel_ok = False
    try:
        from backend.data.angel_market import _check_angel_connectivity
        angel_ok = _check_angel_connectivity()
    except Exception:
        pass
    return {"status": "ok", "angel_connectivity": "ok" if angel_ok else "unreachable"}


@app.get("/api/market/stock", response_model=None)
def market_stock(
    ticker: str = Query(..., min_length=1),
    start_date: str = Query(...),
    end_date: str = Query(...),
):
    try:
        return fetch_stock_history(ticker=ticker, start_date=start_date, end_date=end_date)
    except Exception as exc:  # pragma: no cover - network/provider dependent
        return JSONResponse(
            status_code=502,
            content={
                "error": "market_stock_fetch_failed",
                "detail": str(exc),
                "ticker": ticker,
            },
        )


@app.get("/api/market/options", response_model=None)
def market_options(
    ticker: str = Query(..., min_length=1),
    current_price: float = Query(..., gt=0.0),
    hist_volatility: float = Query(..., gt=0.0, le=5.0),
    risk_free_rate: float = Query(default=7.0, ge=0.0, le=25.0),
):
    try:
        return fetch_option_chain(
            ticker=ticker,
            current_price=current_price,
            hist_volatility=hist_volatility,
            risk_free_rate=risk_free_rate,
        )
    except Exception as exc:  # pragma: no cover - network/provider dependent
        return JSONResponse(
            status_code=502,
            content={
                "error": "market_option_fetch_failed",
                "detail": str(exc),
                "ticker": ticker,
            },
        )


@app.get("/api/run")
def run_pipeline(months: int = Query(default=6, ge=1, le=24)) -> dict:
    snapshot, _, _ = get_snapshot_bundle(months=months)
    return snapshot


@app.get("/api/summary")
def summary(months: int = Query(default=6, ge=1, le=24)) -> dict:
    snapshot, _, _ = get_snapshot_bundle(months=months)
    return snapshot


@app.get("/api/screener")
def screener(months: int = Query(default=6, ge=1, le=12)) -> dict:
    return build_screener_payload(months=months)


@app.get("/api/options")
def options(months: int = Query(default=6, ge=1, le=24), risk_free_rate: float = Query(default=0.07, ge=0.0, le=0.25)) -> dict:
    return build_options_analytics(months=months, risk_free_rate=risk_free_rate)


@app.get("/api/portfolio")
def portfolio(months: int = Query(default=6, ge=1, le=24), risk_free_rate: float = Query(default=0.07, ge=0.0, le=0.25)) -> dict:
    return build_portfolio_analytics(months=months, risk_free_rate=risk_free_rate)


@app.get("/api/risk")
def risk(months: int = Query(default=6, ge=1, le=24)) -> dict:
    return build_risk_analytics(months=months)


@app.get("/api/download/xlsx")
def download_xlsx(months: int = Query(default=6, ge=1, le=24), risk_free_rate: float = Query(default=0.07, ge=0.0, le=0.25)) -> StreamingResponse:
    payload = build_workbook_bytes(months=months, risk_free_rate=risk_free_rate)
    return StreamingResponse(
        iter([payload]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="fram-risk-analytics-{months}m.xlsx"'},
    )


@app.get("/api/download/docx")
def download_docx(months: int = Query(default=6, ge=1, le=24), risk_free_rate: float = Query(default=0.07, ge=0.0, le=0.25)) -> StreamingResponse:
    payload = build_report_bytes(months=months, risk_free_rate=risk_free_rate)
    return StreamingResponse(
        iter([payload]),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="fram-risk-report-{months}m.docx"'},
    )


@app.post("/api/cache/refresh")
def refresh_cache(months: int | None = Query(default=None, ge=1, le=24)) -> dict[str, str]:
    return clear_analytics_cache(months=months)
