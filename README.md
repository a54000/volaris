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
python -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
.venv/bin/python -m uvicorn backend.main:app --reload
```

```bash
cd /Users/surindersingh/Documents/volaris/frontend
npm install
cp .env.example .env
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
- Live NSE option-chain prices now prefer a curated F&O-eligible symbol set, snap requests to the nearest listed expiry/strike, and fall back automatically when NSE returns empty records or no usable market data.
- Summary, options, portfolio, and risk builders now use a short in-process TTL cache to avoid recomputing the full analytics pipeline on every request.

## Deployment

- Backend: [render.yaml](/Users/surindersingh/Documents/volaris/render.yaml:1) is included for a basic Render web service deploy from `backend/`.
- Frontend: [frontend/vercel.json](/Users/surindersingh/Documents/volaris/frontend/vercel.json:1) and [frontend/.env.example](/Users/surindersingh/Documents/volaris/frontend/.env.example:1) are included for a Vercel-hosted Vite app.
- Set `VITE_API_BASE_URL` in the frontend environment to your deployed backend URL.

## Frontend structure

- `frontend/src/App.jsx` provides the dashboard shell, tabs, config controls, and download actions.
- `frontend/src/api.js` centralizes calls to the FastAPI backend.
- `frontend/src/components/tabs/*` maps each major analytics area to a dedicated tab view.
