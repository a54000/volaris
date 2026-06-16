import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

function formatCurrencyCr(value) {
  return `₹${Number(value || 0).toFixed(1)} Cr`;
}

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function formatNumber(value, digits = 4) {
  return Number(value || 0).toFixed(digits);
}

function formatAmihud(value) {
  const numeric = Number(value || 0);
  if (numeric === 0) return "0";
  if (Math.abs(numeric) < 0.0001) return numeric.toExponential(2);
  return numeric.toFixed(6);
}

export default function ScreenerTab({
  screener,
  liquidTicker,
  illiquidTicker,
  onSelectLiquid,
  onSelectIlliquid,
}) {
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState("All");
  const [tier, setTier] = useState("All");

  const sectors = useMemo(
    () => ["All", ...Array.from(new Set((screener?.ranked || []).map((row) => row.sector))).sort()],
    [screener],
  );

  const filteredRows = useMemo(() => {
    return (screener?.ranked || []).filter((row) => {
      const matchesSearch =
        !search ||
        row.ticker.toLowerCase().includes(search.toLowerCase()) ||
        row.sector.toLowerCase().includes(search.toLowerCase());
      const matchesSector = sector === "All" || row.sector === sector;
      const matchesTier = tier === "All" || row.quartile_bucket === tier;
      return matchesSearch && matchesSector && matchesTier;
    });
  }, [screener, search, sector, tier]);

  const top20 = useMemo(
    () => (screener?.ranked || []).slice(0, 20).map((row) => ({ ticker: row.ticker, turnover: row.avg_daily_turnover_cr })),
    [screener],
  );

  if (!screener) {
    return (
      <section className="card">
        <div className="card-title">NIFTY 50 Liquidity Screener</div>
        <p style={{ color: "var(--txt2)", fontFamily: "sans-serif" }}>Loading screener...</p>
      </section>
    );
  }

  const liquid = screener.liquid_selection;
  const illiquid = screener.illiquid_selection;

  return (
    <>
      <section className="card">
        <div className="toolbar-space screener-head">
          <div>
            <div className="card-title no-margin">NIFTY 50 Liquidity Screener</div>
            <div className="screener-subtitle">Ranked by 6-month average daily turnover (₹ Crores)</div>
          </div>
          <div className="screener-last-run">Last run: {screener.generated_at}</div>
        </div>

        <div className="row">
          <div className="screener-selection-card liquid">
            <div className="selection-head">LIQUID STOCK</div>
            <div className="selection-main">▲ {liquid.ticker} <span>Rank #{liquid.rank}</span></div>
            <div className="selection-line">{formatCurrencyCr(liquid.turnover_cr)}/day</div>
            <div className="selection-line">Amihud: {formatAmihud(liquid.amihud)}</div>
            <div className="selection-line">Hist Vol: {formatPercent(liquid.realized_vol)}</div>
            <div className="selection-line">GARCH IV: {formatPercent(liquid.garch_iv)}</div>
            <div className="selection-line">Source: {liquid.data_source === "live" ? "Live" : "Fallback"}</div>
            <div className="selection-pill">✓ Selected — Liquid</div>
          </div>

          <div className="screener-selection-card illiquid">
            <div className="selection-head">ILLIQUID STOCK</div>
            <div className="selection-main">▼ {illiquid.ticker} <span>Rank #{illiquid.rank}</span></div>
            <div className="selection-line">{formatCurrencyCr(illiquid.turnover_cr)}/day</div>
            <div className="selection-line">Amihud: {formatAmihud(illiquid.amihud)}</div>
            <div className="selection-line">Hist Vol: {formatPercent(illiquid.realized_vol)}</div>
            <div className="selection-line">GARCH IV: {formatPercent(illiquid.garch_iv)}</div>
            <div className="selection-line">Source: {illiquid.data_source === "live" ? "Live" : "Fallback"}</div>
            <div className="selection-pill">✓ Selected — Illiquid</div>
          </div>
        </div>

        <div className="screener-gapline">
          Turnover gap: {formatNumber(screener.headline_metrics.turnover_gap, 1)}×
          <span>|</span>
          Amihud gap: {formatNumber(screener.headline_metrics.amihud_gap, 1)}×
          <span>|</span>
          Vol gap: {screener.headline_metrics.vol_gap_pct_points >= 0 ? "+" : ""}
          {formatNumber(screener.headline_metrics.vol_gap_pct_points, 1)}%
        </div>

        <div className="screener-justification">
          <div className="section-label">Justification</div>
          <p>{screener.justification}</p>
        </div>

        <div className="screener-filters">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search"
            className="screener-search"
          />
          <div className="select-wrap">
            <select value={sector} onChange={(event) => setSector(event.target.value)}>
              {sectors.map((item) => (
                <option key={item} value={item}>{item === "All" ? "Sector: All" : item}</option>
              ))}
            </select>
          </div>
          <div className="select-wrap">
            <select value={tier} onChange={(event) => setTier(event.target.value)}>
              <option value="All">Tier: All</option>
              <option value="TOP 25%">TOP 25%</option>
              <option value="BOTTOM 25%">BOTTOM 25%</option>
              <option value="MIDDLE 50%">MIDDLE 50%</option>
            </select>
          </div>
        </div>

        <div className="scrollable-x">
          <table className="options-table screener-table">
            <thead>
              <tr>
                <th>#</th>
                <th style={{ textAlign: "left" }}>Stock</th>
                <th>Sector</th>
                <th>Turnover</th>
                <th>Amihud</th>
                <th>Vol%</th>
                <th>Tier</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const isLiquid = row.ticker === liquidTicker;
                const isIlliquid = row.ticker === illiquidTicker;
                return (
                  <tr
                    key={row.ticker}
                    className={`screener-row ${isLiquid ? "selected-liquid" : ""} ${isIlliquid ? "selected-illiquid" : ""}`}
                  >
                    <td>{row.rank}</td>
                    <td style={{ textAlign: "left" }}>
                      <button
                        type="button"
                        className="screener-stock-button"
                        onClick={() => (row.quartile_bucket === "TOP 25%" ? onSelectLiquid(row.ticker) : row.quartile_bucket === "BOTTOM 25%" ? onSelectIlliquid(row.ticker) : null)}
                      >
                        {isLiquid || isIlliquid ? "★" : ""}
                        {row.ticker}
                      </button>
                    </td>
                    <td>{row.sector}</td>
                    <td>{formatCurrencyCr(row.avg_daily_turnover_cr)}</td>
                    <td>{formatAmihud(row.amihud)}</td>
                    <td>{formatPercent(row.realized_vol)}</td>
                    <td>
                      <span className={`badge ${row.liquidity_tier === "HIGH" ? "badge-liq" : row.liquidity_tier === "MEDIUM" ? "badge-med" : "badge-low"}`}>
                        {row.liquidity_tier}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${row.data_source === "live" ? "badge-provider" : "badge-low"}`}>
                        {row.data_source === "live" ? "LIVE" : "FALLBACK"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-title">Top 20 Stocks by Turnover</div>
        <div className="chart-wrap short-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={top20} layout="vertical" margin={{ left: 18 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3444" />
              <XAxis type="number" stroke="#8b949e" tickFormatter={(value) => `${Number(value).toFixed(0)}Cr`} />
              <YAxis type="category" dataKey="ticker" stroke="#8b949e" width={80} />
              <Tooltip
                contentStyle={{
                  background: "rgba(22, 27, 34, 0.96)",
                  border: "1px solid #3a4556",
                  borderRadius: "8px",
                  color: "#e6edf3",
                }}
                formatter={(value) => formatCurrencyCr(value)}
              />
              <Bar dataKey="turnover" fill="#00d4ff" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </>
  );
}
