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
  if (Math.abs(numeric) < 0.0001) {
    const exponent = Math.floor(Math.log10(Math.abs(numeric)));
    const mantissa = numeric / (10 ** exponent);
    return `${mantissa.toFixed(2)} x 10^${exponent}`;
  }
  return numeric.toFixed(6);
}

function toSelection(row, fallback) {
  if (!row) return fallback;
  return {
    ticker: row.ticker,
    rank: row.rank,
    turnover_cr: row.avg_daily_turnover_cr,
    amihud: row.amihud,
    realized_vol: row.realized_vol,
    garch_iv: row.garch_iv,
    data_source: row.data_source,
  };
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

  const selectedLiquidRow = (screener.ranked || []).find((row) => row.ticker === liquidTicker);
  const selectedIlliquidRow = (screener.ranked || []).find((row) => row.ticker === illiquidTicker);
  const liquid = toSelection(selectedLiquidRow, screener.liquid_selection);
  const illiquid = toSelection(selectedIlliquidRow, screener.illiquid_selection);
  const justification = screener.justification
    ?.replace(/Amihud ratio of [\d.]+(?: x 10\^-?\d+)?/, `Amihud ratio of ${formatAmihud(liquid.amihud)}`)
    ?.replace(/Amihud [\d.]+(?: x 10\^-?\d+)? \(bottom 25%\)/, `Amihud ${formatAmihud(illiquid.amihud)} (bottom 25%)`);

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
            <div className="selection-pill">{liquidTicker ? "✓ Selected — Liquid" : "Auto pick — Liquid"}</div>
          </div>

          <div className="screener-selection-card illiquid">
            <div className="selection-head">ILLIQUID STOCK</div>
            <div className="selection-main">▼ {illiquid.ticker} <span>Rank #{illiquid.rank}</span></div>
            <div className="selection-line">{formatCurrencyCr(illiquid.turnover_cr)}/day</div>
            <div className="selection-line">Amihud: {formatAmihud(illiquid.amihud)}</div>
            <div className="selection-line">Hist Vol: {formatPercent(illiquid.realized_vol)}</div>
            <div className="selection-line">GARCH IV: {formatPercent(illiquid.garch_iv)}</div>
            <div className="selection-line">Source: {illiquid.data_source === "live" ? "Live" : "Fallback"}</div>
            <div className="selection-pill">{illiquidTicker ? "✓ Selected — Illiquid" : "Auto pick — Illiquid"}</div>
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
          <p>{justification}</p>
        </div>

        <div className="screener-help">
          Select comparison stocks here: choose a <strong>TOP 25%</strong> row as the liquid stock and a <strong>BOTTOM 25%</strong> row as the illiquid stock. The Liquidity Comparison tab will use those two selections.
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
                <th>Compare</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const isLiquid = row.ticker === liquidTicker;
                const isIlliquid = row.ticker === illiquidTicker;
                const canSelectLiquid = row.quartile_bucket === "TOP 25%";
                const canSelectIlliquid = row.quartile_bucket === "BOTTOM 25%";
                return (
                  <tr
                    key={row.ticker}
                    className={`screener-row ${isLiquid ? "selected-liquid" : ""} ${isIlliquid ? "selected-illiquid" : ""}`}
                    onClick={() => {
                      if (canSelectLiquid) onSelectLiquid(row.ticker);
                      if (canSelectIlliquid) onSelectIlliquid(row.ticker);
                    }}
                  >
                    <td>{row.rank}</td>
                    <td style={{ textAlign: "left" }}>
                      <button
                        type="button"
                        className="screener-stock-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (canSelectLiquid) onSelectLiquid(row.ticker);
                          if (canSelectIlliquid) onSelectIlliquid(row.ticker);
                        }}
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
                    <td>
                      {canSelectLiquid ? (
                        <button type="button" className="screener-action-btn liquid" onClick={(event) => { event.stopPropagation(); onSelectLiquid(row.ticker); }}>
                          Use as Liquid
                        </button>
                      ) : null}
                      {canSelectIlliquid ? (
                        <button type="button" className="screener-action-btn illiquid" onClick={(event) => { event.stopPropagation(); onSelectIlliquid(row.ticker); }}>
                          Use as Illiquid
                        </button>
                      ) : null}
                      {!canSelectLiquid && !canSelectIlliquid ? <span className="screener-muted">Middle 50%</span> : null}
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
