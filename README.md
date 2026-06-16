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
- `POST /api/cache/refresh`

## Notes

- The fetcher falls back to deterministic mock data if `yfinance` is unavailable or a live download fails.
- Turnover ratio currently uses an estimated float-share proxy. We can replace this with a true shares-outstanding data source in the next pass.
- Live NSE option-chain prices now prefer a curated F&O-eligible symbol set, snap requests to the nearest listed expiry/strike, and fall back automatically when NSE returns empty records or no usable market data.
- Summary, options, portfolio, and risk builders now use a short in-process TTL cache to avoid recomputing the full analytics pipeline on every request.
- The dashboard refresh action now clears the relevant backend cache for the selected month window before reloading analytics.

## Deployment

- Backend: [render.yaml](/Users/surindersingh/Documents/volaris/render.yaml:1) is included for a basic Render web service deploy from `backend/`.
- Frontend: [frontend/vercel.json](/Users/surindersingh/Documents/volaris/frontend/vercel.json:1) and [frontend/.env.example](/Users/surindersingh/Documents/volaris/frontend/.env.example:1) are included for a Vercel-hosted Vite app.
- Set `VITE_API_BASE_URL` in the frontend environment to your deployed backend URL.

### Render backend checklist

1. Push the repository to GitHub.
2. In Render, create a new `Web Service` from the repo.
3. Confirm Render picks up [render.yaml](/Users/surindersingh/Documents/volaris/render.yaml:1).
4. Verify the service root is `backend/`.
5. Verify the build command is `pip install -r requirements.txt`.
6. Verify the start command is `uvicorn main:app --host 0.0.0.0 --port $PORT`.
7. Deploy and wait for the health route to come up.
8. Confirm the backend URL returns `{"status":"ok"}` from `/health`.

### Vercel frontend checklist

1. In Vercel, import the same repository.
2. Set the project root to `frontend/` if Vercel does not infer it automatically.
3. Confirm [frontend/vercel.json](/Users/surindersingh/Documents/volaris/frontend/vercel.json:1) is being used.
4. Add `VITE_API_BASE_URL` in the Vercel environment settings and point it to the deployed Render backend URL.
5. Redeploy after saving the environment variable.
6. Open the deployed frontend and verify the dashboard loads without CORS or network errors.

### Post-deploy smoke test

1. Open `<backend-url>/health` and confirm a `200` response with `{"status":"ok"}`.
2. Open `<backend-url>/api/summary?months=2` and confirm JSON data is returned.
3. Open `<backend-url>/api/options?months=2&risk_free_rate=0.07` and confirm option rows are returned.
4. Call `POST <backend-url>/api/cache/refresh?months=2` and confirm the response says the cache was cleared.
5. Open `<backend-url>/api/download/xlsx?months=2&risk_free_rate=0.07` and confirm an Excel file downloads.
6. Open `<backend-url>/api/download/docx?months=2&risk_free_rate=0.07` and confirm a Word report downloads.
7. Open the deployed frontend and use the refresh button once to confirm the cache refresh flow works from the UI.

## Frontend structure

- `frontend/src/App.jsx` provides the dashboard shell, tabs, config controls, and download actions.
- `frontend/src/api.js` centralizes calls to the FastAPI backend.
- `frontend/src/components/tabs/*` maps each major analytics area to a dedicated tab view.
