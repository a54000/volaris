# FRAM Risk Analytics Platform

Initial backend scaffold for the FRAM risk analytics platform.

## Current scope

- Fetch 6-month daily OHLCV data for the NIFTY 50 universe
- Compute liquidity and volatility diagnostics
- Fit GARCH(1,1) volatility where the `arch` library is available
- Price options with Black-Scholes using historical and GARCH volatility inputs
- Compute Delta, Gamma, Vega, hedge shares, scenario PnL, and VaR outputs
- Expose analytics through a FastAPI service
- Provide a React/Vite frontend scaffold for dashboard tabs and downloads
- Export `xlsx` and `docx` artifacts from the backend

## Local run

```bash
cd /Users/surindersingh/Documents/volaris
python -m uvicorn backend.main:app --reload
```

```bash
cd /Users/surindersingh/Documents/volaris/frontend
npm install
npm run dev
```

## Endpoints

- `GET /health`
- `GET /api/run`
- `GET /api/summary`
- `GET /api/options`
- `GET /api/portfolio`
- `GET /api/risk`
- `GET /api/download/xlsx`
- `GET /api/download/docx`

## Notes

- The fetcher falls back to deterministic mock data if `yfinance` is unavailable or a live download fails.
- Turnover ratio currently uses an estimated float-share proxy. We can replace this with a true shares-outstanding data source in the next pass.
- Live NSE option-chain prices are not wired yet; `market_price_proxy` currently uses a small spread over the GARCH-based theoretical price so the response shape is stable for frontend work.

## Frontend structure

- `frontend/src/App.jsx` provides the dashboard shell, tabs, config controls, and download actions.
- `frontend/src/api.js` centralizes calls to the FastAPI backend.
- `frontend/src/components/tabs/*` maps each major analytics area to a dedicated tab view.
