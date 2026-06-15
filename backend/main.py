from __future__ import annotations

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from backend.data.fetcher import build_market_snapshot
from backend.exports.excel import build_workbook_bytes
from backend.exports.report import build_report_bytes
from backend.services.analytics import build_options_analytics, build_portfolio_analytics, build_risk_analytics

app = FastAPI(
    title="FRAM Risk Analytics API",
    version="0.1.0",
    description="Backend foundation for liquidity analytics, option pricing, portfolio scenarios, and risk modeling.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/run")
def run_pipeline(months: int = Query(default=6, ge=1, le=24)) -> dict:
    return build_market_snapshot(months=months)


@app.get("/api/summary")
def summary(months: int = Query(default=6, ge=1, le=24)) -> dict:
    return build_market_snapshot(months=months)


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
