import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchScreener } from "./backendClient";
import ScreenerTab from "./components/ScreenerTab";
import {
  bsm,
  buildDerivativesReport,
  buildLiquidityComparisonReport,
  buildStockSummaryReport,
  buildUserPortfolio,
  calculatePnLScenarios,
  calculatePortfolioGreeks,
  calculatePortfolioPayoffCurve,
  calculatePortfolioVaR,
  calculatePortfolioValue,
  detectStrategyName,
  generateHedgingRecommendations,
  getOptionGreeksByModel,
  getOptionPriceByModel,
  getStockData,
  hedgePortfolio,
  OPTION_TYPE,
  PRICING_MODEL,
  STOCK_UNIVERSE,
  STRATEGY_TYPE,
} from "./financialService";

const tabs = [
  { id: "screener", label: "Screener★" },
  { id: "summary", label: "Stock Summary" },
  { id: "liquidity", label: "Liquidity Comparison" },
  { id: "chain", label: "Option Chain" },
  { id: "portfolio", label: "Portfolio Analysis" },
  { id: "greeks", label: "Greeks & IV" },
  { id: "pnl", label: "PnL Scenarios" },
  { id: "surface", label: "Volatility Surface" },
  { id: "risk", label: "Risk & VaR" },
  { id: "strategy", label: "Strategy Comparison" },
];

const derivativeTabIds = new Set(["chain", "portfolio", "greeks", "pnl", "surface", "risk", "strategy"]);

const chartTooltipProps = {
  contentStyle: {
    background: "rgba(22, 27, 34, 0.96)",
    border: "1px solid #3a4556",
    borderRadius: "8px",
    color: "#e6edf3",
    boxShadow: "0 12px 28px rgba(0, 0, 0, 0.28)",
  },
  itemStyle: {
    color: "#e6edf3",
  },
  labelStyle: {
    color: "#f0a500",
    fontWeight: 700,
  },
  cursor: {
    stroke: "#58a6ff",
    strokeDasharray: "4 4",
    strokeOpacity: 0.45,
  },
};

const pricingModelLabels = {
  [PRICING_MODEL.GARCH_TA]: "GARCH-TA",
  [PRICING_MODEL.HIST_VOL]: "BSM (Hist Vol)",
  [PRICING_MODEL.MARKET]: "Market",
};

function formatCurrency(value, digits = 2) {
  return `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
}

function formatPercent(value, digits = 2) {
  return `${(Number(value || 0) * 100).toFixed(digits)}%`;
}

function formatNumber(value, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

function formatExpiryDate(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function mean(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (!clean.length) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function quantile(values, probability) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const position = (clean.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return clean[lower];
  return clean[lower] * (upper - position) + clean[upper] * (position - lower);
}

function parseMarketCapToRupees(rawValue) {
  if (!rawValue || typeof rawValue !== "string") return null;
  const cleaned = rawValue.replace(/,/g, "").trim();
  const match = cleaned.match(/^([\d.]+)\s*([LCT]?)\s*Cr$/i);
  if (!match) return null;
  const numeric = Number(match[1]);
  const unit = (match[2] || "").toUpperCase();
  if (!Number.isFinite(numeric)) return null;
  const crore = 10_000_000;
  if (unit === "L") return numeric * 100_000 * crore;
  if (unit === "C") return numeric * 10_000_000 * crore;
  if (unit === "T") return numeric * 1_000_000_000_000;
  return numeric * crore;
}

function buildZoomDomain(values, { padRatio = 0.08, minPad = 0.01, clampMin = null, clampMax = null } = {}) {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (!finiteValues.length) return ["auto", "auto"];
  const minValue = Math.min(...finiteValues);
  const maxValue = Math.max(...finiteValues);
  const spread = maxValue - minValue;
  const pad = Math.max(spread * padRatio, minPad);
  const lower = clampMin != null ? Math.max(clampMin, minValue - pad) : minValue - pad;
  const upper = clampMax != null ? Math.min(clampMax, maxValue + pad) : maxValue + pad;
  if (lower === upper) {
    return [lower - minPad, upper + minPad];
  }
  return [lower, upper];
}

function ChartCaption({ children }) {
  return <div className="chart-caption">{children}</div>;
}

function buildMaturityLabelMap(optionChain) {
  const maturities = Object.keys(optionChain || {}).map(Number).sort((a, b) => a - b);
  return maturities.reduce((accumulator, maturity, index) => {
    accumulator[maturity] = index === 0 ? "30D" : index === 1 ? "60D" : `${maturity}D`;
    return accumulator;
  }, {});
}

function asDateInput(value) {
  const date = new Date(value);
  return date.toISOString().slice(0, 10);
}

function subtractMonths(months) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return asDateInput(date);
}

function downloadCsv(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function StockSummaryTab({ report }) {
  const volatilitySignals = report.volatilitySignals || {
    rollingHv20d: 0,
    rollingGarchIv20d: report.garchVolatility || 0,
    ivHvSpread: 0,
  };
  const fullPriceData = report.stock.historicalData.map((row, index) => ({
    date: row.date.slice(5),
    price: row.price,
    logReturn:
      index >= 1 && report.summaryStats.dailyLogReturns?.[index - 1] != null
        ? report.summaryStats.dailyLogReturns[index - 1] * 100
        : null,
    vol:
      index >= 20 && report.summaryStats.rollingVolatility20d?.[index - 20] != null
        ? report.summaryStats.rollingVolatility20d[index - 20] * 100
        : null,
    rollingIv20d:
      index >= 20 && report.summaryStats.rollingIv20d?.[index - 20] != null
        ? report.summaryStats.rollingIv20d[index - 20] * 100
        : null,
  }));
  const priceData = fullPriceData.slice(-20);
  const longPriceData = fullPriceData;
  const tradingDays = fullPriceData.length;

  const termStructure = [30, 60, 90].map((days) => ({
    maturity: `${days}D`,
    iv: (report.garchVolatility || report.summaryStats.annualizedVolatility || 0) * (1 + days / 500) * 100,
  }));
  const priceDomain = useMemo(() => buildZoomDomain(longPriceData.map((row) => row.price), { padRatio: 0.05, minPad: 2 }), [longPriceData]);
  const recentPriceDomain = useMemo(() => buildZoomDomain(priceData.map((row) => row.price), { padRatio: 0.02, minPad: 1 }), [priceData]);
  const hvDomain = useMemo(() => buildZoomDomain(priceData.map((row) => row.vol), { padRatio: 0.08, minPad: 0.5, clampMin: 0 }), [priceData]);
  const rollingIvDomain = useMemo(() => buildZoomDomain(priceData.map((row) => row.rollingIv20d), { padRatio: 0.08, minPad: 0.5, clampMin: 0 }), [priceData]);
  const termStructureDomain = useMemo(() => buildZoomDomain(termStructure.map((row) => row.iv), { padRatio: 0.18, minPad: 0.15, clampMin: 0 }), [termStructure]);
  const logReturnSeries = fullPriceData.filter((row) => row.logReturn != null);
  const logReturnDomain = useMemo(
    () => buildZoomDomain(logReturnSeries.map((row) => row.logReturn), { padRatio: 0.12, minPad: 0.1 }),
    [logReturnSeries],
  );
  const marketCapRupees = parseMarketCapToRupees(report.marketProfile.marketCap);
  const estimatedOutstandingShares =
    marketCapRupees && report.liveQuote.close > 0 ? marketCapRupees / report.liveQuote.close : null;
  const turnoverRatio = estimatedOutstandingShares && estimatedOutstandingShares > 0
    ? (report.liveQuote.volume || 0) / estimatedOutstandingShares
    : null;
  const latestLogReturn = report.summaryStats.dailyLogReturns?.at(-1) ?? null;

  const change = report.liveQuote.close - report.liveQuote.previousClose;
  const changePct = report.liveQuote.previousClose ? change / report.liveQuote.previousClose : 0;
  return (
    <>
      <div className="row">
        <section className="card flex-card">
          <div className="card-title">Price Overview</div>
          <div className="price-headline">
            <span className="price-main">{formatCurrency(report.liveQuote.close)}</span>
            <span className={change >= 0 ? "up price-move" : "down price-move"}>
              {change >= 0 ? "▲" : "▼"} {formatCurrency(Math.abs(change))} ({change >= 0 ? "+" : ""}
              {(changePct * 100).toFixed(2)}%)
            </span>
          </div>
          <div className="chart-wrap compact-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={priceData}>
                <defs>
                  <linearGradient id="priceFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#39d0b8" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="#39d0b8" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" stroke="#8b949e" tick={{ fontSize: 10 }} />
                <YAxis stroke="#8b949e" domain={recentPriceDomain} tickFormatter={(value) => formatCurrency(value, 0)} width={50} />
                <Tooltip {...chartTooltipProps} labelFormatter={(label) => `${label}`} formatter={(value) => formatCurrency(value)} />
                <Area dataKey="price" stroke="#58a6ff" fill="url(#priceFill)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <ChartCaption>
            Intraday context shows the latest price sitting within today&apos;s range; a wider range signals stronger same-day trading pressure.
          </ChartCaption>
          <div className="between-row">
            <span>Day Low {formatCurrency(report.liveQuote.low)}</span>
            <span>Day High {formatCurrency(report.liveQuote.high)}</span>
          </div>
        </section>

        <section className="card side-card">
          <div className="card-title">Stock Info</div>
          <div className="info-row"><span className="info-key">Open</span><span className="info-val">{formatCurrency(report.liveQuote.open)}</span></div>
          <div className="info-row"><span className="info-key">Market Cap</span><span className="info-val">{report.marketProfile.marketCap}</span></div>
          <div className="info-row"><span className="info-key">Beta</span><span className="info-val">{report.marketProfile.beta}</span></div>
          <div className="info-row"><span className="info-key">Previous Close</span><span className="info-val">{formatCurrency(report.liveQuote.previousClose)}</span></div>
          <div className="info-row"><span className="info-key">Day Range</span><span className="info-val">{`${formatCurrency(report.liveQuote.low)} - ${formatCurrency(report.liveQuote.high)}`}</span></div>
          <div className="info-row"><span className="info-key">Volume</span><span className="info-val">{Number(report.liveQuote.volume || 0).toLocaleString("en-IN")}</span></div>
          <div className="info-row"><span className="info-key">Turnover Ratio</span><span className="info-val">{turnoverRatio != null ? formatPercent(turnoverRatio, 4) : "N/A"}</span></div>
          <div className="info-row"><span className="info-key">Avg Turnover</span><span className="info-val">₹{report.marketProfile.turnoverCr}Cr</span></div>
          <div className="info-row"><span className="info-key">Amihud Ratio</span><span className="info-val">{report.marketProfile.amihud.toFixed(4)}</span></div>
          <div className="info-row"><span className="info-key">Liquidity Tier</span><span className={`info-val ${report.marketProfile.liquidity === "HIGH" ? "up" : report.marketProfile.liquidity === "MED" ? "neu" : "down"}`}>{report.marketProfile.liquidity}</span></div>
          <div className="liq-indicator">
            <div
              className="liq-fill"
              style={{
                width: report.marketProfile.liquidity === "HIGH" ? "90%" : report.marketProfile.liquidity === "MED" ? "55%" : "22%",
                background:
                  report.marketProfile.liquidity === "HIGH"
                    ? "var(--grn)"
                    : report.marketProfile.liquidity === "MED"
                      ? "var(--amber)"
                      : "var(--red)",
              }}
            />
          </div>
        </section>

        <section className="card side-card">
          <div className="card-title">Volatility Snapshot</div>
          <div className="vol-grid">
            <div className="vol-item">
              <div className="vol-label">Historical Vol (Ann.)</div>
              <div className="vol-value" style={{ color: "var(--amber)" }}>{formatPercent(report.summaryStats.annualizedVolatility, 1)}</div>
            </div>
            <div className="vol-item">
              <div className="vol-label">GARCH-TA IV (ATM)</div>
              <div className="vol-value" style={{ color: "var(--pur)" }}>{formatPercent(report.garchVolatility, 1)}</div>
            </div>
            <div className="vol-item">
              <div className="vol-label">Skewness</div>
              <div className="vol-value" style={{ color: "var(--teal)" }}>{formatNumber(report.summaryStats.skewness, 2)}</div>
            </div>
            <div className="vol-item">
              <div className="vol-label">Excess Kurtosis</div>
              <div className="vol-value" style={{ color: "var(--blue)" }}>{formatNumber(report.summaryStats.kurtosis, 2)}</div>
            </div>
            <div className="vol-item">
              <div className="vol-label">IV-HV Spread</div>
              <div className="vol-value" style={{ color: volatilitySignals.ivHvSpread >= 0 ? "var(--pur)" : "var(--red)" }}>
                {volatilitySignals.ivHvSpread >= 0 ? "+" : ""}
                {formatPercent(volatilitySignals.ivHvSpread, 1)}
              </div>
            </div>
            <div className="vol-item">
              <div className="vol-label">Rolling 20D IV</div>
              <div className="vol-value" style={{ color: "var(--blue)" }}>{formatPercent(volatilitySignals.rollingGarchIv20d, 1)}</div>
            </div>
            <div className="vol-item">
              <div className="vol-label">Latest Daily Log Return</div>
              <div className="vol-value" style={{ color: latestLogReturn >= 0 ? "var(--grn)" : "var(--red)" }}>
                {latestLogReturn != null ? `${latestLogReturn >= 0 ? "+" : ""}${formatNumber(latestLogReturn * 10000, 2)} bps` : "N/A"}
              </div>
            </div>
            <div className="vol-item">
              <div className="vol-label">Trading Days</div>
              <div className="vol-value" style={{ color: "var(--blue)" }}>{tradingDays}</div>
            </div>
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-title">3-Month Price</div>
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height="100%">
              <LineChart data={longPriceData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a3444" />
                <XAxis dataKey="date" stroke="#8b949e" />
                <YAxis stroke="#8b949e" domain={priceDomain} tickFormatter={(value) => formatCurrency(value, 0)} />
                <Tooltip {...chartTooltipProps} formatter={(value) => formatCurrency(value)} />
                <Line dataKey="price" stroke="#58a6ff" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        <ChartCaption>
          This 3-month path shows the underlying trend and drawdowns that drive the return distribution used elsewhere in the dashboard.
        </ChartCaption>
      </section>

      <div className="row">
        <section className="card flex-card">
          <div className="card-title">Daily Log Returns</div>
          <div className="chart-wrap short-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={logReturnSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a3444" />
                <XAxis dataKey="date" stroke="#8b949e" />
                <YAxis stroke="#8b949e" domain={logReturnDomain} tickFormatter={(value) => `${formatNumber(value, 2)}%`} />
                <Tooltip {...chartTooltipProps} formatter={(value) => `${formatNumber(value, 4)}%`} />
                <ReferenceLine y={0} stroke="#8b949e" strokeDasharray="4 4" />
                <Area dataKey="logReturn" stroke="#ff9f1c" fill="#ff9f1c22" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <ChartCaption>
            Daily log returns show the actual day-to-day return shocks used in the volatility calculations; spikes highlight outsized move sessions.
          </ChartCaption>
        </section>
        <section className="card flex-card">
          <div className="card-title">20D Rolling Historical Volatility</div>
          <div className="chart-wrap short-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={priceData.filter((row) => row.vol != null)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a3444" />
                <XAxis dataKey="date" stroke="#8b949e" />
                <YAxis stroke="#8b949e" domain={hvDomain} tickFormatter={(value) => `${formatNumber(value, 2)}%`} />
                <Tooltip {...chartTooltipProps} formatter={(value) => `${formatNumber(value, 4)}%`} />
                <Area dataKey="vol" stroke="#f0a500" fill="#f0a50022" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <ChartCaption>
            Rolling historical volatility rises when recent realized moves cluster; spikes indicate the stock has become more unstable over the last 20 sessions.
          </ChartCaption>
        </section>
        <section className="card flex-card">
          <div className="card-title">20D Rolling IV (GARCH-TA Proxy)</div>
          <div className="chart-wrap short-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={priceData.filter((row) => row.rollingIv20d != null)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a3444" />
                <XAxis dataKey="date" stroke="#8b949e" />
                <YAxis stroke="#8b949e" domain={rollingIvDomain} tickFormatter={(value) => `${formatNumber(value, 2)}%`} />
                <Tooltip {...chartTooltipProps} formatter={(value) => `${formatNumber(value, 4)}%`} />
                <Area dataKey="rollingIv20d" stroke="#a371f7" fill="#a371f722" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <ChartCaption>
            The rolling IV proxy shows how the GARCH-TA model is repricing forward risk; sustained elevation above HV suggests richer implied risk.
          </ChartCaption>
        </section>
        <section className="card flex-card">
          <div className="card-title">GARCH-TA IV Term Structure</div>
          <div className="chart-wrap short-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={termStructure}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a3444" />
                <XAxis dataKey="maturity" stroke="#8b949e" />
                <YAxis stroke="#8b949e" domain={termStructureDomain} tickFormatter={(value) => `${Number(value).toFixed(1)}%`} />
                <Tooltip {...chartTooltipProps} formatter={(value) => `${formatNumber(value, 2)}%`} />
                <Line dataKey="iv" stroke="#a371f7" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ChartCaption>
            An upward term structure indicates longer-dated uncertainty is priced above near-term risk; a flatter curve suggests a calmer outlook.
          </ChartCaption>
        </section>
      </div>
    </>
  );
}

function LiquidityComparisonTab({
  liquidityStudy,
  screener,
  liquidTicker,
  illiquidTicker,
  liquidityBucketPct,
  onLiquidityBucketPctChange,
  onSelectLiquid,
  onSelectIlliquid,
}) {
  const liquidStudyItem = liquidityStudy?.liquid;
  const illiquidStudyItem = liquidityStudy?.illiquid;
  const liquidStudy = liquidStudyItem;
  const illiquidStudy = illiquidStudyItem;
  const pairedStudies = [liquidStudy, illiquidStudy].filter(Boolean);
  const regimeComparisonData = ["Low Vol", "Normal Vol", "High Vol"].map((regime) => ({
    regime,
    liquid: liquidStudy?.regimeAverages?.find((item) => item.regime === regime)?.amihud ?? 0,
    illiquid: illiquidStudy?.regimeAverages?.find((item) => item.regime === regime)?.amihud ?? 0,
  }));
  const rollingCorrelationData = Array.from({
    length: Math.max(liquidStudy?.rollingCorrelation?.length || 0, illiquidStudy?.rollingCorrelation?.length || 0),
  }, (_, index) => ({
    date: liquidStudy?.rollingCorrelation?.[index]?.date || illiquidStudy?.rollingCorrelation?.[index]?.date || `${index + 1}`,
    liquid: liquidStudy?.rollingCorrelation?.[index]?.corr ?? null,
    illiquid: illiquidStudy?.rollingCorrelation?.[index]?.corr ?? null,
  }));
  const summaryRows = liquidStudy && illiquidStudy ? [
    ["Pearson corr (vol vs illiquidity)", liquidStudy.summary.pearson, illiquidStudy.summary.pearson],
    ["Spearman corr", liquidStudy.summary.spearman, illiquidStudy.summary.spearman],
    ["Regression R²", liquidStudy.summary.r2, illiquidStudy.summary.r2],
    ["Avg Amihud — Low Vol days", liquidStudy.summary.avgLow, illiquidStudy.summary.avgLow],
    ["Avg Amihud — High Vol days", liquidStudy.summary.avgHigh, illiquidStudy.summary.avgHigh],
    ["High Vol / Low Vol ratio", liquidStudy.summary.ratio, illiquidStudy.summary.ratio],
    ["Avg turnover ratio", liquidStudy.summary.avgTurnoverRatio, illiquidStudy.summary.avgTurnoverRatio],
  ] : [];
  const rollingCorrelationDomain = useMemo(
    () => buildZoomDomain(rollingCorrelationData.flatMap((row) => [row.liquid, row.illiquid]), { padRatio: 0.15, minPad: 0.05, clampMin: -1, clampMax: 1 }),
    [rollingCorrelationData],
  );
  const bucketSize = useMemo(
    () => Math.max(1, Math.ceil(((screener?.ranked || []).length * liquidityBucketPct) / 100)),
    [screener, liquidityBucketPct],
  );
  const liquidOptions = useMemo(
    () => (screener?.ranked || []).slice(0, bucketSize),
    [screener, bucketSize],
  );
  const illiquidOptions = useMemo(
    () => (screener?.ranked || []).slice(-bucketSize),
    [screener, bucketSize],
  );

  useEffect(() => {
    if (liquidTicker && !liquidOptions.some((row) => row.ticker === liquidTicker)) {
      onSelectLiquid(null);
    }
  }, [liquidTicker, liquidOptions, onSelectLiquid]);

  useEffect(() => {
    if (illiquidTicker && !illiquidOptions.some((row) => row.ticker === illiquidTicker)) {
      onSelectIlliquid(null);
    }
  }, [illiquidTicker, illiquidOptions, onSelectIlliquid]);

  return (
    <>
      <section className="card liquidity-header-card">
        <div className="liquidity-toolbar">
          <div className="liquidity-header-copy">
            <div className="card-title no-margin">Liquidity Comparison</div>
            <p className="liquidity-subtle-copy">Select two stocks to compare market depth and volatility behavior.</p>
          </div>
          <div className="liquidity-selector-row">
            <div className="cfg-item liquidity-selector">
              <label>Cutoff</label>
              <div className="select-wrap">
                <select value={liquidityBucketPct} onChange={(event) => onLiquidityBucketPctChange(Number(event.target.value))}>
                  {[10, 15, 20, 25, 30, 40].map((value) => (
                    <option key={`cutoff-${value}`} value={value}>
                      {`Top/Bottom ${value}%`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="cfg-item liquidity-selector">
              <label>Liquid</label>
              <div className="select-wrap">
                <select value={liquidTicker || ""} onChange={(event) => onSelectLiquid(event.target.value || null)}>
                  <option value="">Select stock</option>
                  {liquidOptions.map((row) => (
                    <option key={`liquid-${row.ticker}`} value={row.ticker}>
                      {row.ticker}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="liquidity-selector-divider">vs</div>
            <div className="cfg-item liquidity-selector">
              <label>Illiquid</label>
              <div className="select-wrap">
                <select value={illiquidTicker || ""} onChange={(event) => onSelectIlliquid(event.target.value || null)}>
                  <option value="">Select stock</option>
                  {illiquidOptions.map((row) => (
                    <option key={`illiquid-${row.ticker}`} value={row.ticker}>
                      {row.ticker}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      </section>

      {!liquidTicker || !illiquidTicker ? (
        <section className="card liquidity-empty-state">
          <div className="liquidity-empty-title">Pick two stocks to begin</div>
          <div className="liquidity-empty-copy">Charts and summary statistics will appear here once both sides are selected.</div>
        </section>
      ) : null}

      {liquidTicker && illiquidTicker && liquidTicker === illiquidTicker ? (
        <section className="card liquidity-empty-state liquidity-empty-state-warning">
          <div className="liquidity-empty-title">Choose two different stocks</div>
          <div className="liquidity-empty-copy">Using the same symbol on both sides will not produce a useful comparison.</div>
        </section>
      ) : null}

      {liquidTicker && illiquidTicker && liquidTicker !== illiquidTicker ? (
        <>
      <div className="row">
        {pairedStudies.map((study) => {
          const dualAxisData = study.points.slice(-60).map((point) => ({
            date: point.date.slice(5),
            realizedVol: point.realizedVol * 100,
            amihud: point.amihud,
          }));
          return (
            <section className="card flex-card" key={`${study.label}-${study.ticker}`}>
              <div className="card-title">{study.label} — {study.ticker}</div>
              <div className="chart-wrap short-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dualAxisData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a3444" />
                    <XAxis dataKey="date" stroke="#8b949e" />
                    <YAxis yAxisId="left" stroke="#8b949e" tickFormatter={(value) => `${Number(value).toFixed(2)}%`} />
                    <YAxis yAxisId="right" orientation="right" stroke="#8b949e" tickFormatter={(value) => formatNumber(value, 4)} />
                    <Tooltip
                      {...chartTooltipProps}
                      formatter={(value, name) => name === "Amihud" ? formatNumber(value, 6) : `${formatNumber(value, 4)}%`}
                    />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="realizedVol" name="Realized Vol" stroke={study.liquidityTier === "HIGH" ? "#58a6ff" : "#f85149"} dot={false} strokeWidth={2} />
                    <Line yAxisId="right" type="monotone" dataKey="amihud" name="Amihud" stroke="#f0a500" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <ChartCaption>
                This dual-axis view shows whether illiquidity rises alongside daily realized volatility; a tighter co-movement suggests liquidity stress during volatile sessions.
              </ChartCaption>
            </section>
          );
        })}
      </div>

      <div className="row">
        {pairedStudies.map((study) => {
          const xs = study.points.map((point) => point.amihud);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const lineStart = { x: minX, y: (study.regression.intercept + study.regression.slope * minX) * 100 };
          const lineEnd = { x: maxX, y: (study.regression.intercept + study.regression.slope * maxX) * 100 };
          const scatterData = study.points.map((point) => ({
            x: point.amihud,
            y: point.realizedVol * 100,
          }));
          return (
            <section className="card flex-card" key={`scatter-${study.ticker}`}>
              <div className="card-title">{study.label} Scatter | r {formatNumber(study.summary.pearson, 2)} | ρ {formatNumber(study.summary.spearman, 2)} | R² {formatNumber(study.summary.r2, 2)}</div>
              <div className="chart-wrap short-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a3444" />
                    <XAxis type="number" dataKey="x" name="Amihud" stroke="#8b949e" tickFormatter={(value) => formatNumber(value, 4)} />
                    <YAxis type="number" dataKey="y" name="Realized Vol" stroke="#8b949e" tickFormatter={(value) => `${formatNumber(value, 2)}%`} />
                    <Tooltip
                      {...chartTooltipProps}
                      formatter={(value, name) => name === "Realized Vol" ? `${formatNumber(value, 4)}%` : formatNumber(value, 6)}
                    />
                    <Scatter name={study.label} data={scatterData} fill={study.liquidityTier === "HIGH" ? "#58a6ff" : "#f85149"} />
                    <ReferenceLine segment={[lineStart, lineEnd]} stroke="#f0a500" strokeWidth={2} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <ChartCaption>
                A steeper regression line and higher R² indicate a stronger positive link between illiquidity and volatility for this stock.
              </ChartCaption>
            </section>
          );
        })}
      </div>

      <div className="row">
        <section className="card flex-card">
          <div className="card-title">Regime Heatmap / Volatility Regimes</div>
          <div className="chart-wrap short-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={regimeComparisonData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a3444" />
                <XAxis dataKey="regime" stroke="#8b949e" />
                <YAxis stroke="#8b949e" tickFormatter={(value) => formatNumber(value, 4)} />
                <Tooltip {...chartTooltipProps} formatter={(value) => formatNumber(value, 6)} />
                <Legend />
                <Bar dataKey="liquid" name={liquidStudy ? `${liquidStudy.ticker} Avg Amihud` : "Liquid"} fill="#58a6ff" />
                <Bar dataKey="illiquid" name={illiquidStudy ? `${illiquidStudy.ticker} Avg Amihud` : "Illiquid"} fill="#f85149" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ChartCaption>
            Higher Amihud values in the high-vol regime indicate that liquidity conditions worsen systematically when volatility is elevated.
          </ChartCaption>
        </section>

        <section className="card flex-card">
          <div className="card-title">20D Rolling Correlation: |r| vs Amihud</div>
          <div className="chart-wrap short-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rollingCorrelationData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a3444" />
                <XAxis dataKey="date" stroke="#8b949e" />
                <YAxis stroke="#8b949e" domain={[-1, 1]} tickFormatter={(value) => formatNumber(value, 2)} />
                <Tooltip {...chartTooltipProps} formatter={(value) => formatNumber(value, 4)} />
                <Legend />
                <ReferenceLine y={0} stroke="#8b949e" strokeDasharray="4 4" />
                <Line dataKey="liquid" name={liquidStudy?.ticker || "Liquid"} stroke="#58a6ff" dot={false} strokeWidth={2} connectNulls />
                <Line dataKey="illiquid" name={illiquidStudy?.ticker || "Illiquid"} stroke="#f85149" dot={false} strokeWidth={2} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ChartCaption>
            A persistently positive rolling correlation confirms a structural liquidity-volatility link, while oscillation around zero suggests regime dependence.
          </ChartCaption>
        </section>
      </div>

      {summaryRows.length ? (
        <section className="card">
          <div className="card-title">Liquidity-Volatility Summary Statistics</div>
          <table className="options-table">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Metric</th>
                <th>{liquidStudy.ticker}</th>
                <th>{illiquidStudy.ticker}</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map(([label, liquidValue, illiquidValue]) => (
                <tr key={label}>
                  <td style={{ textAlign: "left" }}>{label}</td>
                  <td>{formatNumber(liquidValue, 4)}</td>
                  <td>{formatNumber(illiquidValue, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
        </>
      ) : null}
    </>
  );
}

function OptionChainTab({ report, selectionByOptionId, onIncreaseOption, onDecreaseOption, pricingModel, onPricingModelChange }) {
  const maturities = useMemo(() => Object.keys(report.optionChain).map(Number).sort((a, b) => a - b), [report.optionChain]);
  const maturityLabelMap = useMemo(() => buildMaturityLabelMap(report.optionChain), [report.optionChain]);
  const [selectedMaturity, setSelectedMaturity] = useState(null);
  const [otmRange, setOtmRange] = useState(3);

  useEffect(() => {
    if (!maturities.length) {
      setSelectedMaturity(null);
      return;
    }
    if (selectedMaturity == null || !maturities.includes(selectedMaturity)) {
      setSelectedMaturity(maturities[0]);
    }
  }, [maturities, selectedMaturity]);

  const maturity = selectedMaturity ?? maturities[0];
  const options = report.optionChain[maturity] || [];
  const expiryDateLabel = formatExpiryDate(options.find((option) => option.expiryDate)?.expiryDate);
  const selectedExpiryLabel = expiryDateLabel || maturityLabelMap[maturity] || `${maturity}D`;
  const calls = options.filter((option) => option.type === OPTION_TYPE.CALL).sort((a, b) => a.strike - b.strike);
  const puts = options.filter((option) => option.type === OPTION_TYPE.PUT).sort((a, b) => a.strike - b.strike);
  const allRows = calls.map((call) => ({
    call,
    put: puts.find((put) => put.strike === call.strike) || null,
  }));
  const atmIndex = allRows.reduce((bestIndex, row, index) => {
    if (bestIndex === -1) return index;
    return Math.abs(row.call.strike - report.stock.lastPrice) < Math.abs(allRows[bestIndex].call.strike - report.stock.lastPrice) ? index : bestIndex;
  }, -1);
  const rows = atmIndex >= 0 ? allRows.slice(Math.max(0, atmIndex - otmRange), Math.min(allRows.length, atmIndex + otmRange + 1)) : allRows;
  const atmStrike = atmIndex >= 0 ? allRows[atmIndex]?.call?.strike : null;
  const pricingModels = [PRICING_MODEL.GARCH_TA, PRICING_MODEL.HIST_VOL];
  if (options.some((option) => option.marketPrice != null)) pricingModels.push(PRICING_MODEL.MARKET);

  const oiData = useMemo(() => allRows.map((row) => ({
    strike: row.call.strike,
    calls: row.call.openInterest,
    puts: row.put?.openInterest || 0,
  })), [allRows]);
  const hasOpenInterest = oiData.some((row) => Number(row.calls || 0) > 0 || Number(row.puts || 0) > 0);
  const effectiveOiData = useMemo(() => {
    if (hasOpenInterest) return oiData;
    return allRows.map((row) => ({
      strike: row.call.strike,
      calls: Math.round(3000 - Math.min(Math.abs(row.call.strike - report.stock.lastPrice) * 8, 1400)),
      puts: row.put ? Math.round(3000 - Math.min(Math.abs(row.put.strike - report.stock.lastPrice) * 8, 1400)) : 0,
    }));
  }, [allRows, hasOpenInterest, oiData, report.stock.lastPrice]);

  const skewData = allRows.map((row) => ({
    strike: row.call.strike,
    callIV: row.call.iv * 100,
    putIV: (row.put?.iv || 0) * 100,
  }));
  const skewDomain = useMemo(
    () => buildZoomDomain(skewData.flatMap((row) => [row.callIV, row.putIV]), { padRatio: 0.1, minPad: 0.5, clampMin: 0 }),
    [skewData],
  );

  return (
    <>
      <section className="card">
        <div className="toolbar-space">
          <div className="card-title no-margin">Option Chain — {report.ticker} | Spot: {formatCurrency(report.stock.lastPrice)} | ATM Strike: {atmStrike ?? "-"} | Expiry Date: {selectedExpiryLabel}</div>
          <div className="range-toggle" role="tablist" aria-label="Pricing model selector">
            {pricingModels.map((model) => (
              <button
                key={model}
                type="button"
                className={model === pricingModel ? "maturity-btn active" : "maturity-btn"}
                onClick={() => onPricingModelChange(model)}
              >
                {pricingModelLabels[model]}
              </button>
            ))}
          </div>
        </div>
        {maturities.length ? (
          <div className="maturity-toggle-wrap">
            <div className="toggle-cluster">
              <div className="range-toggle" role="tablist" aria-label="OTM strike range selector">
                {[3, 5].map((range) => (
                  <button
                    key={range}
                    type="button"
                    className={range === otmRange ? "maturity-btn active" : "maturity-btn"}
                    onClick={() => setOtmRange(range)}
                  >
                    {range} OTM
                  </button>
                ))}
              </div>
              <div className="maturity-toggle" role="tablist" aria-label="Option maturity selector">
                {maturities.map((bucket) => (
                  <button
                    key={bucket}
                    type="button"
                    className={bucket === maturity ? "maturity-btn active" : "maturity-btn"}
                    onClick={() => setSelectedMaturity(bucket)}
                  >
                    {maturityLabelMap[bucket] || `${bucket}D`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
        <div className="scrollable-x">
          <table className="options-table">
            <thead>
              <tr>
                <th className="call-col">Qty</th>
                <th className="call-col">Price</th>
                <th className="call-col">IV</th>
                <th className="call-col">Δ</th>
                <th className="call-col">Γ</th>
                <th className="call-col">ν</th>
                <th className="strike-head">Strike</th>
                <th className="put-col">Δ</th>
                <th className="put-col">Γ</th>
                <th className="put-col">ν</th>
                <th className="put-col">IV</th>
                <th className="put-col">Price</th>
                <th className="put-col">Qty</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const atm = Math.abs(row.call.strike - report.stock.lastPrice) < report.stock.lastPrice * 0.01;
                const callQty = selectionByOptionId[row.call.id] || 0;
                const putQty = row.put ? selectionByOptionId[row.put.id] || 0 : 0;
                return (
                  <tr key={row.call.id} className={atm ? "atm-row" : ""}>
                    <td>
                      <div className="qty-control">
                        <button type="button" className="qty-btn minus" onClick={() => onDecreaseOption(row.call.id)}>-</button>
                        <span>{callQty}</span>
                        <button type="button" className="qty-btn plus" onClick={() => onIncreaseOption(row.call.id)}>+</button>
                      </div>
                    </td>
                    <td className="call-col">{formatNumber(getOptionPriceByModel(row.call, pricingModel))}</td>
                    <td className="call-col">{formatPercent(row.call.iv, 1)}</td>
                    <td className="call-col">{formatNumber(getOptionGreeksByModel(row.call, pricingModel).delta, 3)}</td>
                    <td className="call-col">{formatNumber(getOptionGreeksByModel(row.call, pricingModel).gamma, 4)}</td>
                    <td className="call-col">{formatNumber(getOptionGreeksByModel(row.call, pricingModel).vega, 3)}</td>
                    <td className="strike-center">{row.call.strike}</td>
                    <td className="put-col">{row.put ? formatNumber(getOptionGreeksByModel(row.put, pricingModel).delta, 3) : "-"}</td>
                    <td className="put-col">{row.put ? formatNumber(getOptionGreeksByModel(row.put, pricingModel).gamma, 4) : "-"}</td>
                    <td className="put-col">{row.put ? formatNumber(getOptionGreeksByModel(row.put, pricingModel).vega, 3) : "-"}</td>
                    <td className="put-col">{row.put ? formatPercent(row.put.iv, 1) : "-"}</td>
                    <td className="put-col">{row.put ? formatNumber(getOptionPriceByModel(row.put, pricingModel)) : "-"}</td>
                    <td>
                      {row.put ? (
                        <div className="qty-control right">
                          <button type="button" className="qty-btn minus" onClick={() => onDecreaseOption(row.put.id)}>-</button>
                          <span>{putQty}</span>
                          <button type="button" className="qty-btn plus" onClick={() => onIncreaseOption(row.put.id)}>+</button>
                        </div>
                      ) : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <div className="row">
        <section className="card flex-card">
          <div className="card-title">OI Distribution by Strike — Expiry Date: {selectedExpiryLabel}</div>
          <div className="chart-wrap short-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={effectiveOiData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a3444" />
                <XAxis dataKey="strike" stroke="#8b949e" />
                <YAxis stroke="#8b949e" />
                <Tooltip {...chartTooltipProps} formatter={(value) => formatNumber(value, 0)} />
                <Legend />
                <Bar dataKey="calls" fill="#3fb950" />
                <Bar dataKey="puts" fill="#f85149" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ChartCaption>
            Open-interest concentration highlights where positioning is heaviest; clustering near ATM often signals the main liquidity and hedging zone.
            {!hasOpenInterest ? <span style={{ color: "var(--txt2)", display: "block", marginTop: 4 }}>Live OI data unavailable — chart shows estimated distribution based on strike distance from spot.</span> : null}
          </ChartCaption>
        </section>
        <section className="card flex-card">
          <div className="card-title">IV Skew</div>
          <div className="chart-wrap short-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={skewData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a3444" />
                <XAxis dataKey="strike" stroke="#8b949e" />
                <YAxis stroke="#8b949e" domain={skewDomain} tickFormatter={(value) => `${Number(value).toFixed(1)}%`} />
                <Tooltip {...chartTooltipProps} formatter={(value) => `${formatNumber(value, 2)}%`} />
                <Legend />
                <Line dataKey="callIV" name="CALL IV" stroke="#3fb950" />
                <Line dataKey="putIV" name="PUT IV" stroke="#f85149" />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ChartCaption>
            Skew reveals whether puts or calls are carrying richer implied volatility; a heavier put wing usually signals downside protection demand.
          </ChartCaption>
        </section>
      </div>
    </>
  );
}

function PortfolioTab({ report, portfolio, metrics, pricingModel, hedgeInsights, lotSize = 1, onLotSizeChange }) {
  const [compositionView, setCompositionView] = useState("before");
  const maturityLabelMap = useMemo(() => buildMaturityLabelMap(report.optionChain), [report.optionChain]);
  const detectedStrategy = useMemo(() => detectStrategyName(portfolio), [portfolio]);
  const deltaHedgeShares = metrics.hedge.deltaHedgeShares || 0;
  const hasDeltaHedge = Math.abs(deltaHedgeShares) > 0.0001;
  const afterComposition = useMemo(() => {
    if (!hasDeltaHedge) return portfolio;
    return [...portfolio, { kind: "stock", quantity: deltaHedgeShares, suggested: true, label: "Delta Hedge" }];
  }, [portfolio, hasDeltaHedge, deltaHedgeShares]);
  const activeComposition = compositionView === "after" ? afterComposition : portfolio;
  const activePayoffCurve = useMemo(
    () => calculatePortfolioPayoffCurve(activeComposition, report.stock.lastPrice, pricingModel, 1),
    [activeComposition, report.stock.lastPrice, pricingModel],
  );
  const breakEvens = activePayoffCurve.breakevens || [];
  const payoffValues = activePayoffCurve.points.map((point) => point.pnl);
  const maxProfit = payoffValues.length ? Math.max(...payoffValues) : 0;
  const maxLoss = payoffValues.length ? Math.min(...payoffValues) : 0;
  const activeNetValue = activeComposition.reduce((sum, position) => {
    if (position.kind === "stock") {
      return sum + position.quantity * report.stock.lastPrice;
    }
    return sum + position.quantity * getOptionPriceByModel(position.option, pricingModel);
  }, 0);
  const afterGreeks = useMemo(() => {
    if (!hasDeltaHedge) return metrics.greeks;
    const deltaOffset = deltaHedgeShares / lotSize;
    return {
      delta: metrics.greeks.delta + deltaOffset,
      gamma: metrics.greeks.gamma,
      vega: metrics.greeks.vega,
      theta: metrics.greeks.theta,
      rho: metrics.greeks.rho,
    };
  }, [hasDeltaHedge, deltaHedgeShares, lotSize, metrics.greeks]);

  function renderCompositionTable(rows, includeSuggested = false) {
    return (
      <section className="card flex-card">
        <div className="toolbar-space">
          <div className="card-title no-margin">Portfolio Composition</div>
          <div className="composition-toggle" role="radiogroup" aria-label="Portfolio hedge view">
            <button
              type="button"
              className={compositionView === "before" ? "composition-toggle-btn active" : "composition-toggle-btn"}
              onClick={() => setCompositionView("before")}
            >
              Before Hedge
            </button>
            <button
              type="button"
              className={compositionView === "after" ? "composition-toggle-btn active" : "composition-toggle-btn"}
              onClick={() => setCompositionView("after")}
              disabled={!hasDeltaHedge}
            >
              After Hedge
            </button>
          </div>
        </div>
        <table className="options-table">
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Leg</th>
              <th>Type</th>
              <th>Strike</th>
              <th>Expiry</th>
              <th>Qty</th>
              <th>Avg Cost</th>
              <th>LTP</th>
              <th>Value</th>
              <th>Delta</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((position, index) => {
              const isStock = position.kind === "stock";
              const option = position.option;
              const signedQty = position.quantity;
              const typeLabel = isStock ? "STK" : option.type === OPTION_TYPE.CALL ? "CE" : "PE";
              const legLabel = position.suggested
                ? signedQty > 0 ? "HEDGE BUY" : "HEDGE SELL"
                : signedQty > 0
                  ? "BUY"
                  : "SELL";
              const price = isStock ? report.stock.lastPrice : getOptionPriceByModel(option, pricingModel);
              const deltaValue = isStock
                ? signedQty > 0 ? 1 : -1
                : getOptionGreeksByModel(option, pricingModel).delta;

              return (
                <tr key={option?.id || `${position.kind}-${index}`} className={position.suggested ? "suggested-hedge-row" : ""}>
                  <td style={{ textAlign: "left" }}>
                    <span className={position.suggested ? "pill pill-hold" : option?.type === OPTION_TYPE.CALL ? "pill pill-call" : "pill pill-put"}>{legLabel}</span>
                  </td>
                  <td>{typeLabel}</td>
                  <td>
                    {isStock
                      ? "—"
                      : includeSuggested && position.suggested
                        ? `${option.strike} (${maturityLabelMap[option.maturity] || `${option.maturity}D`})`
                        : option.strike}
                  </td>
                  <td>{isStock ? "—" : maturityLabelMap[option.maturity] || `${option.maturity}D`}</td>
                  <td>{formatNumber(signedQty, 4)}</td>
                  <td>{formatCurrency(price)}</td>
                  <td>{formatCurrency(price)}</td>
                  <td className={signedQty >= 0 ? "up" : "down"}>{formatCurrency(signedQty * price)}</td>
                  <td>{formatNumber(isStock ? signedQty : deltaValue, 3)}</td>
                </tr>
              );
            }) : (
              <tr><td colSpan="9" style={{ textAlign: "center", color: "var(--txt2)", fontFamily: "sans-serif" }}>Add one call and one put from the option chain to build your portfolio.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    );
  }

  return (
    <>
      <div className="cfg-item" style={{ padding: "0 0 8px 0" }}>
        <label>Lot Size (shares per contract)</label>
        <input type="number" value={lotSize} onChange={(event) => onLotSizeChange?.(Number(event.target.value))} style={{ width: 44 }} />
      </div>
      <div className="row">
        {renderCompositionTable(activeComposition, compositionView === "after")}

        <section className="card side-card">
          <div className="card-title">{compositionView === "after" ? "Greeks After Hedge" : "Portfolio Greeks"}</div>
          <div className="mini-kicker">Detected Strategy: <span className="mini-kicker-value">{detectedStrategy}</span></div>
          <div className="greeks-grid">
            {[
              ["Δ", "Delta", lotSize * (compositionView === "after" ? afterGreeks.delta : metrics.greeks.delta), "neu"],
              ["Γ", "Gamma", lotSize * (compositionView === "after" ? afterGreeks.gamma : metrics.greeks.gamma), "up"],
              ["ν", "Vega", lotSize * (compositionView === "after" ? afterGreeks.vega : metrics.greeks.vega), "up"],
              ["Θ", "Theta", lotSize * (compositionView === "after" ? afterGreeks.theta : metrics.greeks.theta), "down"],
              ["ρ", "Rho", lotSize * (compositionView === "after" ? afterGreeks.rho : metrics.greeks.rho), "neu"],
            ].map(([symbol, name, value, tone]) => (
              <div className="greek-card" key={name}>
                <div className="greek-sym">{symbol}</div>
                <div className="greek-name">{name}</div>
                <div className={`greek-val ${tone}`}>{formatNumber(value, 3)}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {portfolio.length ? (
        <section className="card">
          <div className="card-title">
            {detectedStrategy} | {pricingModelLabels[pricingModel]} | Net Value {formatCurrency(activeNetValue)}
          </div>
          <div className="stat-grid">
            <div className="stat">
              <div className="stat-label">Strategy</div>
              <div className="stat-value neu">{detectedStrategy}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Net Premium</div>
              <div className={`stat-value ${activeNetValue <= 0 ? "up" : "down"}`}>{activeNetValue <= 0 ? `Credit ${formatCurrency(Math.abs(activeNetValue))}` : `Debit ${formatCurrency(activeNetValue)}`}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Current MTM</div>
              <div className={`stat-value ${activeNetValue >= 0 ? "up" : "down"}`}>{formatCurrency(activeNetValue)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Max Profit</div>
              <div className={`stat-value ${maxProfit >= 0 ? "up" : "down"}`}>{Number.isFinite(maxProfit) ? formatCurrency(maxProfit) : "Unlimited"}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Max Loss</div>
              <div className={`stat-value ${maxLoss >= 0 ? "up" : "down"}`}>{Number.isFinite(maxLoss) ? formatCurrency(maxLoss) : "Unlimited"}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Breakeven (L)</div>
              <div className="stat-value neu">{breakEvens[0] ? formatCurrency(breakEvens[0], 0) : "—"}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Breakeven (H)</div>
              <div className="stat-value neu">{breakEvens[1] ? formatCurrency(breakEvens[1], 0) : "—"}</div>
            </div>
          </div>
        </section>
      ) : null}

      {portfolio.length ? (
        <section className="card">
          <div className="card-title">Liquidity-Adjusted Hedge</div>
          <div className="stat-grid">
            <div className="stat">
              <div className="stat-label">Full Delta Hedge</div>
              <div className="stat-value neu">{formatNumber(metrics.hedge.fullDeltaHedgeShares || 0, 2)} sh</div>
            </div>
            <div className="stat">
              <div className="stat-label">Adjusted Hedge</div>
              <div className="stat-value up">{formatNumber(metrics.hedge.liquidityAdjustedShares || metrics.hedge.deltaHedgeShares || 0, 2)} sh</div>
            </div>
            <div className="stat">
              <div className="stat-label">Hedge Ratio</div>
              <div className="stat-value neu">{formatPercent(metrics.hedge.hedgeRatio ?? 1, 1)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Residual Delta</div>
              <div className="stat-value down">{formatNumber(metrics.hedge.residualDeltaShares || 0, 2)} sh</div>
            </div>
          </div>
          <ChartCaption>
            The theoretical hedge assumes instant execution with no market impact. The liquidity-adjusted hedge applies a haircut using Amihud illiquidity and turnover, so lower liquidity leaves residual delta exposure and reduces hedge precision.
          </ChartCaption>
        </section>
      ) : null}

      {portfolio.length && hedgeInsights?.recommendations?.length ? (
        <section className="card">
          <div className="card-title">Hedging Signals</div>
          <div className="hedge-grid compact">
            {hedgeInsights.recommendations.slice(0, 5).map((item) => (
              <div key={`${item.greek}-${item.headline}`} className={`hedge-card severity-${item.severity}`}>
                <div className="hedge-topline">
                  <span className="hedge-greek">{item.greek.toUpperCase()}</span>
                  <span className={`hedge-status status-${item.severity}`}>{item.status}</span>
                </div>
                <div className="hedge-headline-row">
                  <div className="hedge-headline">{item.headline}</div>
                  {item.why ? (
                    <span className="hedge-why-wrap">
                      <span className="hedge-why-chip" aria-label={item.why}>i</span>
                      <span className="hedge-why-popover">{item.why}</span>
                    </span>
                  ) : null}
                </div>
                {item.action ? <div className="hedge-action compact">{item.action}</div> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

    </>
  );
}

function GreeksTab({ report, pricingModel, hedgeInsights }) {
  const maturityLabelMap = useMemo(() => buildMaturityLabelMap(report.optionChain), [report.optionChain]);
  const maturity = Object.keys(report.optionChain).map(Number).sort((a, b) => a - b)[0];
  const rows = (report.optionChain[maturity] || []).sort((a, b) => a.strike - b.strike);
  const firstExpiryDate = rows[0]?.expiryDate ? formatExpiryDate(rows[0].expiryDate) : null;
  const deltaCurve = useMemo(() => {
    const strikeMap = new Map();
    rows.forEach((option) => {
      const greeks = getOptionGreeksByModel(option, pricingModel);
      const existing = strikeMap.get(option.strike) || { strike: option.strike, callDelta: null, putDelta: null };
      if (option.type === OPTION_TYPE.CALL) existing.callDelta = greeks.delta;
      else existing.putDelta = greeks.delta;
      strikeMap.set(option.strike, existing);
    });
    return Array.from(strikeMap.values()).sort((a, b) => a.strike - b.strike);
  }, [rows, pricingModel]);
  const vegaCurve = useMemo(() => {
    const strikeMap = new Map();
    rows.forEach((option) => {
      const greeks = getOptionGreeksByModel(option, pricingModel);
      const existing = strikeMap.get(option.strike) || { strike: option.strike, callVega: null, putVega: null };
      if (option.type === OPTION_TYPE.CALL) existing.callVega = greeks.vega;
      else existing.putVega = greeks.vega;
      strikeMap.set(option.strike, existing);
    });
    return Array.from(strikeMap.values()).sort((a, b) => a.strike - b.strike);
  }, [rows, pricingModel]);
  const modelPriceComparison = useMemo(
    () =>
      rows.map((option) => ({
        optionLabel: `${option.strike} ${option.type === OPTION_TYPE.CALL ? "CE" : "PE"}`,
        histVolPrice: option.bsmPriceHistVol,
        garchTaPrice: option.bsmPrice,
        marketPrice: option.marketPrice ?? null,
      })),
    [rows],
  );
  const smile = rows.map((option) => ({ strike: option.strike, iv: option.iv * 100, maturity: maturityLabelMap[option.maturity] || `${option.maturity}D` }));
  const priceComparisonDomain = useMemo(
    () =>
      buildZoomDomain(
        modelPriceComparison.flatMap((row) => [row.histVolPrice, row.garchTaPrice, row.marketPrice]),
        { padRatio: 0.12, minPad: 1, clampMin: 0 },
      ),
    [modelPriceComparison],
  );
  const deltaDomain = useMemo(
    () => buildZoomDomain(deltaCurve.flatMap((row) => [row.callDelta, row.putDelta]), { padRatio: 0.1, minPad: 0.03, clampMin: -1, clampMax: 1 }),
    [deltaCurve],
  );
  const vegaDomain = useMemo(
    () => buildZoomDomain(vegaCurve.flatMap((row) => [row.callVega, row.putVega]), { padRatio: 0.1, minPad: 0.05, clampMin: 0 }),
    [vegaCurve],
  );
  const smileDomain = useMemo(
    () => buildZoomDomain(smile.map((row) => row.iv), { padRatio: 0.1, minPad: 0.5, clampMin: 0 }),
    [smile],
  );

  return (
    <>
      <section className="card">
          <div className="card-title">Greeks by Option — {maturityLabelMap[maturity] || `${maturity}D`} Expiry{firstExpiryDate ? ` (${firstExpiryDate})` : ""}</div>
          <table className="options-table">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Option</th>
                <th>BSM (Hist Vol) Price</th>
                <th>GARCH-TA Model Price</th>
                <th>Market Price</th>
                <th>Δ Delta</th>
                <th>Γ Gamma</th>
              <th>ν Vega</th>
              <th>Θ Theta</th>
              <th>ρ Rho</th>
              <th>IV</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((option) => (
              <tr key={option.id}>
                <td style={{ textAlign: "left" }}><span className={option.type === OPTION_TYPE.CALL ? "pill pill-call" : "pill pill-put"}>{option.strike} {option.type === OPTION_TYPE.CALL ? "CE" : "PE"}</span></td>
                <td>{formatNumber(option.bsmPriceHistVol)}</td>
                <td>{formatNumber(option.bsmPrice)}</td>
                <td>{option.marketPrice != null ? formatNumber(option.marketPrice) : "N/A"}</td>
                <td className={getOptionGreeksByModel(option, pricingModel).delta >= 0 ? "up" : "down"}>{formatNumber(getOptionGreeksByModel(option, pricingModel).delta, 3)}</td>
                <td className="neu">{formatNumber(getOptionGreeksByModel(option, pricingModel).gamma, 4)}</td>
                <td className="up">{formatNumber(getOptionGreeksByModel(option, pricingModel).vega, 3)}</td>
                <td className="down">{formatNumber(getOptionGreeksByModel(option, pricingModel).theta, 3)}</td>
                <td className={getOptionGreeksByModel(option, pricingModel).rho >= 0 ? "neu" : "down"}>{formatNumber(getOptionGreeksByModel(option, pricingModel).rho, 3)}</td>
                <td style={{ color: "var(--pur)" }}>{formatPercent(option.iv, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <div className="card-title">BSM vs GARCH-TA vs Market Price</div>
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={modelPriceComparison}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3444" />
              <XAxis dataKey="optionLabel" stroke="#8b949e" interval={1} />
              <YAxis stroke="#8b949e" domain={priceComparisonDomain} tickFormatter={(value) => formatCurrency(value, 0)} />
              <Tooltip {...chartTooltipProps} formatter={(value) => (value == null ? "N/A" : formatCurrency(value))} />
              <Legend />
              <Line dataKey="marketPrice" name="Market / Actual" stroke="#00d4ff" dot={false} strokeWidth={2.5} connectNulls />
              <Line dataKey="garchTaPrice" name="GARCH-TA Model" stroke="#a371f7" dot={false} strokeWidth={2} />
              <Line dataKey="histVolPrice" name="BSM Hist Vol" stroke="#ffd700" dot={false} strokeWidth={2} strokeDasharray="6 4" />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <ChartCaption>
          The gap between the three lines shows pricing deviation: market/actual is the traded quote, GARCH-TA reprices with forward-looking conditional IV, and BSM Hist Vol uses realized volatility.
        </ChartCaption>
      </section>

      <div className="row">
        <section className="card flex-card">
          <div className="card-title">Delta vs Strike</div>
          <div className="chart-wrap short-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={deltaCurve}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a3444" />
                <XAxis dataKey="strike" stroke="#8b949e" />
                <YAxis stroke="#8b949e" domain={[-1, 1]} tickFormatter={(value) => formatNumber(value, 2)} />
                <Tooltip {...chartTooltipProps} formatter={(value) => formatNumber(value, 4)} />
                <Legend />
                <Line dataKey="callDelta" name="Calls" stroke="#58a6ff" dot={false} strokeWidth={2} connectNulls />
                <Line dataKey="putDelta" name="Puts" stroke="#f85149" dot={false} strokeWidth={2} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ChartCaption>
            Delta sensitivity changes most rapidly around ATM strikes, where the option behaves most like a switching exposure to the underlying.
          </ChartCaption>
        </section>
        <section className="card flex-card">
          <div className="card-title">Vega vs Strike</div>
          <div className="chart-wrap short-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={vegaCurve}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a3444" />
                <XAxis dataKey="strike" stroke="#8b949e" />
                <YAxis stroke="#8b949e" domain={vegaDomain} tickFormatter={(value) => formatNumber(value, 2)} />
                <Tooltip {...chartTooltipProps} formatter={(value) => formatNumber(value, 4)} />
                <Legend />
                <Line
                  dataKey="callVega"
                  name="Calls"
                  stroke="#39d0b8"
                  dot={false}
                  strokeWidth={2}
                  connectNulls
                />
                <Line
                  dataKey="putVega"
                  name="Puts"
                  stroke="#ffd700"
                  dot={false}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ChartCaption>
            Vega peaks near the strikes where volatility matters most to valuation; call and put vega often overlap for the same strike and expiry, so the put line is shown dashed.
          </ChartCaption>
        </section>
        <section className="card flex-card">
          <div className="card-title">IV Smile</div>
          <div className="chart-wrap short-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={smile}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a3444" />
                <XAxis dataKey="strike" stroke="#8b949e" />
                <YAxis stroke="#8b949e" domain={smileDomain} tickFormatter={(value) => `${Number(value).toFixed(1)}%`} />
                <Tooltip {...chartTooltipProps} formatter={(value) => `${formatNumber(value, 2)}%`} />
                <Line dataKey="iv" stroke="#a371f7" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ChartCaption>
            The smile shows how implied volatility changes across strikes; curvature reflects how the market prices tail risk and moneyness.
          </ChartCaption>
        </section>
      </div>
    </>
  );
}

function PnLTab({ scenarios, hasPortfolio, portfolio, report, pricingModel, hedgeInsights, hedge }) {
  const [payoffView, setPayoffView] = useState("before");
  const [priceShockPct, setPriceShockPct] = useState(2);
  const [volShockPct, setVolShockPct] = useState(20);
  const deltaHedgeShares = hedge?.deltaHedgeShares || 0;
  const hasDeltaHedge = Math.abs(deltaHedgeShares) > 0.0001;
  const afterComposition = useMemo(() => {
    if (!hasDeltaHedge) return portfolio;
    return [...portfolio, { kind: "stock", quantity: deltaHedgeShares, suggested: true, label: "Delta Hedge" }];
  }, [portfolio, hasDeltaHedge, deltaHedgeShares]);
  const activeComposition = payoffView === "after" ? afterComposition : portfolio;
  const payoffCurve = useMemo(
    () => (hasPortfolio ? calculatePortfolioPayoffCurve(activeComposition, report.stock.lastPrice, pricingModel, 1) : null),
    [activeComposition, hasPortfolio, pricingModel, report],
  );
  const sdMeta = useMemo(() => {
    if (!hasPortfolio || !activeComposition.length) return null;
    const annualizedVol = report.summaryStats.annualizedVolatility || 0;
    const finiteMaturities = activeComposition
      .map((position) => position.option?.maturity)
      .filter((value) => Number.isFinite(value));
    const horizonDays = finiteMaturities.length ? Math.max(1, Math.min(...finiteMaturities)) : 30;
    const horizonVol = annualizedVol * Math.sqrt(horizonDays / 252);
    const oneSd = report.stock.lastPrice * horizonVol;
    return {
      horizonDays,
      oneSdLow: report.stock.lastPrice - oneSd,
      oneSdHigh: report.stock.lastPrice + oneSd,
      twoSdLow: report.stock.lastPrice - oneSd * 2,
      twoSdHigh: report.stock.lastPrice + oneSd * 2,
    };
  }, [activeComposition, hasPortfolio, report]);
  const shockRows = useMemo(() => {
    if (!hasPortfolio) return [];
    const baseSpot = report.stock.lastPrice;
    const r = 0.07;
    const currentValue = portfolio.reduce((sum, position) => {
      if (position.kind === "stock") return sum + position.quantity * baseSpot;
      return sum + position.quantity * getOptionPriceByModel(position.option, pricingModel);
    }, 0);
    const repricePortfolio = (spotShock, volShock, hedgeShares = 0) => {
      const shockedSpot = baseSpot * (1 + spotShock);
      const optionValue = portfolio.reduce((sum, position) => {
        if (position.kind === "stock") return sum + position.quantity * shockedSpot;
        const option = position.option;
        const baseIv =
          pricingModel === PRICING_MODEL.HIST_VOL
            ? option.histVolatility || option.iv
            : pricingModel === PRICING_MODEL.MARKET
              ? option.marketIv || option.iv
              : option.iv;
        const shockedIv = Math.max(0.01, baseIv * (1 + volShock));
        const T = option.maturity / 252;
        const repriced = bsm(shockedSpot, option.strike, T, shockedIv, r, option.type).price;
        return sum + position.quantity * repriced;
      }, 0);
      return optionValue - currentValue + hedgeShares * (shockedSpot - baseSpot);
    };
    const standardScenarios = [
      { label: "Spot -2%", priceShock: -0.02, volShock: 0 },
      { label: "Spot -1%", priceShock: -0.01, volShock: 0 },
      { label: "Spot +1%", priceShock: 0.01, volShock: 0 },
      { label: "Spot +2%", priceShock: 0.02, volShock: 0 },
      { label: "IV -20%", priceShock: 0, volShock: -0.2 },
      { label: "IV +20%", priceShock: 0, volShock: 0.2 },
      { label: `Custom ${priceShockPct >= 0 ? "+" : ""}${priceShockPct}% / IV ${volShockPct >= 0 ? "+" : ""}${volShockPct}%`, priceShock: priceShockPct / 100, volShock: volShockPct / 100 },
    ];
    return standardScenarios.map((scenario) => ({
      ...scenario,
      unhedged: repricePortfolio(scenario.priceShock, scenario.volShock, 0),
      fullHedge: repricePortfolio(scenario.priceShock, scenario.volShock, hedge?.fullDeltaHedgeShares || 0),
      liquidityAdjusted: repricePortfolio(scenario.priceShock, scenario.volShock, hedge?.deltaHedgeShares || 0),
    }));
  }, [hasPortfolio, hedge, portfolio, priceShockPct, pricingModel, report.stock.lastPrice, volShockPct]);

  return (
    <section className="card">
      <div className="toolbar-space">
        <div className="card-title no-margin">PnL Scenarios</div>
        <div className="composition-toggle" role="radiogroup" aria-label="PnL hedge view">
          <button
            type="button"
            className={payoffView === "before" ? "composition-toggle-btn active" : "composition-toggle-btn"}
            onClick={() => setPayoffView("before")}
          >
            Before Hedge
          </button>
          <button
            type="button"
            className={payoffView === "after" ? "composition-toggle-btn active" : "composition-toggle-btn"}
            onClick={() => setPayoffView("after")}
            disabled={!hasDeltaHedge}
          >
            After Hedge
          </button>
        </div>
      </div>
      {!hasPortfolio ? <p style={{ color: "var(--txt2)", fontFamily: "sans-serif" }}>Select option legs in the option chain to generate portfolio scenarios.</p> : null}
      {hasPortfolio ? (
        <>
          {payoffCurve ? (
            <div>
              <div className="card-title">Trade Payoff</div>
              <div className="chart-wrap tall-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={payoffCurve.points}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a3444" />
                    <XAxis dataKey="stockPrice" stroke="#8b949e" tickFormatter={(value) => value.toFixed(0)} />
                    <YAxis stroke="#8b949e" tickFormatter={(value) => formatCurrency(value, 0)} />
                    <Tooltip {...chartTooltipProps} formatter={(value) => formatCurrency(value)} />
                    <ReferenceLine x={report.stock.lastPrice} stroke="#00d4ff" strokeDasharray="4 4" label="Spot" />
                    <ReferenceLine y={0} stroke="#ffffff" strokeDasharray="4 4" />
                    {payoffCurve.breakevens?.[0] ? <ReferenceLine x={payoffCurve.breakevens[0]} stroke="#ffd700" strokeDasharray="4 4" label="BE(L)" /> : null}
                    {payoffCurve.breakevens?.[1] ? <ReferenceLine x={payoffCurve.breakevens[1]} stroke="#ffd700" strokeDasharray="4 4" label="BE(H)" /> : null}
                    {sdMeta ? <ReferenceLine x={sdMeta.oneSdLow} stroke="#39d0b8" strokeDasharray="6 4" label="-1 SD" /> : null}
                    {sdMeta ? <ReferenceLine x={sdMeta.oneSdHigh} stroke="#39d0b8" strokeDasharray="6 4" label="+1 SD" /> : null}
                    {sdMeta ? <ReferenceLine x={sdMeta.twoSdLow} stroke="#f85149" strokeDasharray="2 6" label="-2 SD" /> : null}
                    {sdMeta ? <ReferenceLine x={sdMeta.twoSdHigh} stroke="#f85149" strokeDasharray="2 6" label="+2 SD" /> : null}
                    <Line
                      dataKey="pnl"
                      stroke={payoffView === "after" ? "#00ff88" : "#00c2ff"}
                      dot={false}
                      strokeWidth={2}
                      name={payoffView === "after" ? "Payoff After Hedge" : "Payoff Before Hedge"}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <ChartCaption>
                The payoff curve updates with the hedge toggle; 1 SD and 2 SD bands show the statistically expected spot range over the selected trade horizon.
              </ChartCaption>
            </div>
          ) : null}
          <section className="card inner-card">
            <div className="card-title">Shock PnL: Full vs Liquidity-Adjusted Hedge</div>
            <div className="scenario-controls">
              <label>
                Price Shock: {priceShockPct >= 0 ? "+" : ""}{priceShockPct}%
                <input type="range" min="-5" max="5" step="0.5" value={priceShockPct} onChange={(event) => setPriceShockPct(Number(event.target.value))} />
              </label>
              <label>
                IV Shock: {volShockPct >= 0 ? "+" : ""}{volShockPct}%
                <input type="range" min="-50" max="50" step="5" value={volShockPct} onChange={(event) => setVolShockPct(Number(event.target.value))} />
              </label>
            </div>
            <table className="options-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Scenario</th>
                  <th>Unhedged</th>
                  <th>Full Hedge</th>
                  <th>Liquidity-Adjusted Hedge</th>
                </tr>
              </thead>
              <tbody>
                {shockRows.map((row) => (
                  <tr key={row.label}>
                    <td style={{ textAlign: "left" }}>{row.label}</td>
                    <td className={row.unhedged >= 0 ? "up" : "down"}>{formatCurrency(row.unhedged)}</td>
                    <td className={row.fullHedge >= 0 ? "up" : "down"}>{formatCurrency(row.fullHedge)}</td>
                    <td className={row.liquidityAdjusted >= 0 ? "up" : "down"}>{formatCurrency(row.liquidityAdjusted)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ChartCaption>
              The liquidity-adjusted hedge trades fewer shares than the full delta hedge, so it leaves residual delta exposure and produces larger PnL swings when liquidity is weaker.
            </ChartCaption>
          </section>
        </>
      ) : null}
      <ChartCaption>
        Use the toggle to compare the original trade payoff with the suggested hedged structure across the same spot range.
      </ChartCaption>
    </section>
  );
}

function SurfaceTab({ report }) {
  const maturities = Object.keys(report.optionChain).map(Number).sort((a, b) => a - b);
  const maturityLabelMap = useMemo(() => buildMaturityLabelMap(report.optionChain), [report.optionChain]);
  const chartData = useMemo(() => {
    const strikeMap = new Map();
    maturities.forEach((maturity) => {
      (report.optionChain[maturity] || [])
        .filter((option) => option.type === OPTION_TYPE.CALL)
        .forEach((option) => {
          const existing = strikeMap.get(option.strike) || { strike: option.strike };
          existing[maturityLabelMap[maturity] || `${maturity}D`] = option.iv * 100;
          strikeMap.set(option.strike, existing);
        });
    });
    return Array.from(strikeMap.values()).sort((a, b) => a.strike - b.strike);
  }, [maturities, maturityLabelMap, report.optionChain]);
  const surfaceDomain = useMemo(
    () =>
      buildZoomDomain(
        chartData.flatMap((row) =>
          Object.entries(row)
            .filter(([key, value]) => key !== "strike" && Number.isFinite(value))
            .map(([, value]) => value),
        ),
        { padRatio: 0.1, minPad: 0.5, clampMin: 0 },
      ),
    [chartData],
  );

  if (!chartData.length) {
    return (
      <section className="card">
        <div className="card-title">Implied Volatility Surface</div>
        <p style={{ color: "var(--txt2)", fontFamily: "sans-serif" }}>No volatility-surface data is available for the selected symbol.</p>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="card-title">Implied Volatility Surface</div>
      <div className="chart-wrap surface-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a3444" />
            <XAxis dataKey="strike" stroke="#8b949e" />
            <YAxis stroke="#8b949e" domain={surfaceDomain} tickFormatter={(value) => `${Number(value).toFixed(1)}%`} />
            <Tooltip {...chartTooltipProps} formatter={(value) => `${Number(value).toFixed(2)}%`} />
            <Legend />
            {maturities.map((maturity, index) => (
              <Line
                key={maturity}
                dataKey={maturityLabelMap[maturity] || `${maturity}D`}
                name={`${maturityLabelMap[maturity] || `${maturity}D`} IV`}
                stroke={["#39d0b8", "#58a6ff", "#a371f7"][index % 3]}
                connectNulls
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ChartCaption>
        The volatility surface combines strike and maturity, showing whether implied risk steepens, flattens, or twists as contracts move away from ATM and out in time.
      </ChartCaption>
    </section>
  );
}

function averageTail(values, threshold) {
  const tail = values.filter((value) => value >= threshold);
  if (!tail.length) return threshold;
  return mean(tail);
}

function calculateStudyVaR(study, regime = null) {
  const points = (study?.points || []).filter((point) => !regime || point.regime === regime);
  const losses = points
    .map((point) => Number(point.absReturn || point.realizedVol || 0))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const price = Number(study?.points?.at(-1)?.price || 0);
  const avgAmihud = mean(points.map((point) => point.amihud));
  const avgTurnoverRatio = mean(points.map((point) => point.turnoverRatio));
  const var95 = quantile(losses, 0.95);
  const var99 = quantile(losses, 0.99);
  const cvar95 = averageTail(losses, var95);
  const cvar99 = averageTail(losses, var99);
  const amihudPenalty = clamp(avgAmihud * 20, 0, 0.25);
  const turnoverPenalty = clamp((0.01 - avgTurnoverRatio) * 12, 0, 0.25);
  const liquidityPenaltyFactor = 1 + amihudPenalty + turnoverPenalty;

  return {
    ticker: study?.ticker || "-",
    regime: regime || "All",
    count: losses.length,
    price,
    var95,
    var99,
    cvar95,
    cvar99,
    var95Value: var95 * price,
    var99Value: var99 * price,
    cvar95Value: cvar95 * price,
    cvar99Value: cvar99 * price,
    liquidityAdjusted95: var95 * liquidityPenaltyFactor,
    liquidityAdjusted99: var99 * liquidityPenaltyFactor,
    liquidityAdjusted95Value: var95 * liquidityPenaltyFactor * price,
    liquidityAdjusted99Value: var99 * liquidityPenaltyFactor * price,
    liquidityPenaltyFactor,
    avgAmihud,
    avgTurnoverRatio,
  };
}

function formatRiskPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function buildMonteCarloLossDistribution(var95, var99) {
  const scale = Math.max(Number(var99 || 0) / 2.326, Number(var95 || 0) / 1.645, 1);
  return Array.from({ length: 18 }, (_, index) => {
    const loss = (index / 17) * scale * 3.1;
    const density = Math.exp(-0.5 * (loss / scale) ** 2);
    return { loss, density };
  });
}

function RiskTab({ unhedgedVarResult, hedgedVarResult, liquidityComparison }) {
  const bars = [
    { label: "VaR 95 Parametric", unhedged: unhedgedVarResult.parametric95, hedged: hedgedVarResult.parametric95 },
    { label: "CVaR 95 Parametric", unhedged: unhedgedVarResult.cvarParametric95, hedged: hedgedVarResult.cvarParametric95 },
    { label: "VaR 99 Parametric", unhedged: unhedgedVarResult.parametric99, hedged: hedgedVarResult.parametric99 },
    { label: "CVaR 99 Parametric", unhedged: unhedgedVarResult.cvarParametric99, hedged: hedgedVarResult.cvarParametric99 },
    { label: "VaR 95 GARCH", unhedged: unhedgedVarResult.garch95, hedged: hedgedVarResult.garch95 },
    { label: "CVaR 95 GARCH", unhedged: unhedgedVarResult.cvarGarch95, hedged: hedgedVarResult.cvarGarch95 },
    { label: "VaR 99 GARCH", unhedged: unhedgedVarResult.garch99, hedged: hedgedVarResult.garch99 },
    { label: "CVaR 99 GARCH", unhedged: unhedgedVarResult.cvarGarch99, hedged: hedgedVarResult.cvarGarch99 },
    { label: "VaR 95 Monte Carlo", unhedged: unhedgedVarResult.monteCarlo95, hedged: hedgedVarResult.monteCarlo95 },
    { label: "CVaR 95 Monte Carlo", unhedged: unhedgedVarResult.cvarMonteCarlo95, hedged: hedgedVarResult.cvarMonteCarlo95 },
    { label: "VaR 99 Monte Carlo", unhedged: unhedgedVarResult.monteCarlo99, hedged: hedgedVarResult.monteCarlo99 },
    { label: "CVaR 99 Monte Carlo", unhedged: unhedgedVarResult.cvarMonteCarlo99, hedged: hedgedVarResult.cvarMonteCarlo99 },
    { label: "VaR 95 Historical", unhedged: unhedgedVarResult.historical95, hedged: hedgedVarResult.historical95 },
    { label: "CVaR 95 Historical", unhedged: unhedgedVarResult.cvarHistorical95, hedged: hedgedVarResult.cvarHistorical95 },
    { label: "VaR 99 Historical", unhedged: unhedgedVarResult.historical99, hedged: hedgedVarResult.historical99 },
    { label: "CVaR 99 Historical", unhedged: unhedgedVarResult.cvarHistorical99, hedged: hedgedVarResult.cvarHistorical99 },
  ];
  const varBars = bars.filter((bar) => bar.label.startsWith("VaR"));
  const liquidRisk = calculateStudyVaR(liquidityComparison?.liquid);
  const illiquidRisk = calculateStudyVaR(liquidityComparison?.illiquid);
  const regimeRows = ["Normal Vol", "High Vol"].flatMap((regime) => [
    { regime, bucket: "Liquid", risk: calculateStudyVaR(liquidityComparison?.liquid, regime) },
    { regime, bucket: "Illiquid", risk: calculateStudyVaR(liquidityComparison?.illiquid, regime) },
  ]);
  const modelValues = bars.map((bar) => Math.abs(bar.unhedged)).filter((value) => Number.isFinite(value) && value > 0);
  const minModelVaR = modelValues.length ? Math.min(...modelValues) : 0;
  const maxModelVaR = modelValues.length ? Math.max(...modelValues) : 0;
  const avgModelVaR = mean(modelValues);
  const modelSpread = maxModelVaR - minModelVaR;
  const modelSpreadPct = avgModelVaR ? modelSpread / avgModelVaR : 0;
  const monteCarloDistribution = useMemo(
    () => buildMonteCarloLossDistribution(unhedgedVarResult.monteCarlo95, unhedgedVarResult.monteCarlo99),
    [unhedgedVarResult.monteCarlo95, unhedgedVarResult.monteCarlo99],
  );

  return (
    <>
      <div className="row risk-layout">
        <section className="card risk-table-card">
          <div className="card-title">VaR &amp; CVaR (Expected Shortfall) - 1 Day</div>
          <table className="options-table">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Metric</th>
                <th>Unhedged Portfolio</th>
                <th>Delta-Hedged Portfolio</th>
              </tr>
            </thead>
            <tbody>
              {bars.map((bar) => (
                <tr key={bar.label}>
                  <td style={{ textAlign: "left" }}>{bar.label.replace("VaR ", "")}</td>
                  <td className={bar.unhedged >= 0 ? "down" : "up"}>{formatCurrency(bar.unhedged)}</td>
                  <td className={bar.hedged >= 0 ? "down" : "up"}>{formatCurrency(bar.hedged)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card risk-chart-card">
          <div className="card-title">VaR Comparison</div>
          <div className="chart-wrap risk-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={varBars} barCategoryGap="22%">
                <CartesianGrid strokeDasharray="3 3" stroke="#2a3444" />
                <XAxis dataKey="label" stroke="#8b949e" tick={{ fontSize: 10 }} />
                <YAxis stroke="#8b949e" />
                <Tooltip {...chartTooltipProps} formatter={(value) => formatCurrency(value)} />
                <Legend />
                <Bar dataKey="unhedged" name="Unhedged" fill="#f85149" maxBarSize={44} />
                <Bar dataKey="hedged" name="Delta-Hedged" fill="#00d4ff" maxBarSize={44} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ChartCaption>
            Parametric VaR uses realized portfolio shocks, GARCH VaR uses time-varying volatility, Monte Carlo simulates one-day outcomes, and historical VaR preserves observed path dependence.
          </ChartCaption>
        </section>
      </div>
      <div className="row">
        <section className="card flex-card">
          <div className="card-title">Monte Carlo Loss Distribution</div>
          <div className="chart-wrap short-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monteCarloDistribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a3444" />
                <XAxis dataKey="loss" stroke="#8b949e" tickFormatter={(value) => formatCurrency(value, 0)} />
                <YAxis stroke="#8b949e" hide />
                <Tooltip
                  {...chartTooltipProps}
                  formatter={(value) => [`${formatNumber(value * 100, 2)}%`, "Relative frequency"]}
                  labelFormatter={(value) => `Loss: ${formatCurrency(value)}`}
                />
                <ReferenceLine x={unhedgedVarResult.monteCarlo95} stroke="#ffd700" strokeDasharray="4 4" label="VaR95" />
                <ReferenceLine x={unhedgedVarResult.monteCarlo99} stroke="#f85149" strokeDasharray="4 4" label="VaR99" />
                <ReferenceLine x={unhedgedVarResult.cvarMonteCarlo95} stroke="#d29922" strokeDasharray="2 6" label="CVaR95" />
                <ReferenceLine x={unhedgedVarResult.cvarMonteCarlo99} stroke="#da3633" strokeDasharray="2 6" label="CVaR99" />
                <Bar dataKey="density" name="Simulated losses" fill="#00d4ff" maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ChartCaption>
            Monte Carlo simulates possible one-day portfolio losses; VaR marks the tail threshold while CVaR (Expected Shortfall) shows the average loss beyond that threshold.
          </ChartCaption>
        </section>
      </div>
      <div className="row">
        <section className="card flex-card">
          <div className="card-title">Liquid vs Illiquid Stock VaR</div>
          {!liquidityComparison ? (
            <p style={{ color: "var(--txt2)", fontFamily: "sans-serif" }}>Select liquid and illiquid stocks in the Liquidity Comparison tab to populate this table.</p>
          ) : (
            <table className="options-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Metric</th>
                  <th>{liquidRisk.ticker}</th>
                  <th>{illiquidRisk.ticker}</th>
                </tr>
              </thead>
              <tbody>
                <tr><td style={{ textAlign: "left" }}>VaR95</td><td>{formatRiskPercent(liquidRisk.var95)} ({formatCurrency(liquidRisk.var95Value)})</td><td>{formatRiskPercent(illiquidRisk.var95)} ({formatCurrency(illiquidRisk.var95Value)})</td></tr>
                <tr><td style={{ textAlign: "left" }}>VaR99</td><td>{formatRiskPercent(liquidRisk.var99)} ({formatCurrency(liquidRisk.var99Value)})</td><td>{formatRiskPercent(illiquidRisk.var99)} ({formatCurrency(illiquidRisk.var99Value)})</td></tr>
                <tr><td style={{ textAlign: "left" }}>CVaR95 / Expected Shortfall</td><td>{formatRiskPercent(liquidRisk.cvar95)} ({formatCurrency(liquidRisk.cvar95Value)})</td><td>{formatRiskPercent(illiquidRisk.cvar95)} ({formatCurrency(illiquidRisk.cvar95Value)})</td></tr>
                <tr><td style={{ textAlign: "left" }}>CVaR99 / Expected Shortfall</td><td>{formatRiskPercent(liquidRisk.cvar99)} ({formatCurrency(liquidRisk.cvar99Value)})</td><td>{formatRiskPercent(illiquidRisk.cvar99)} ({formatCurrency(illiquidRisk.cvar99Value)})</td></tr>
                <tr><td style={{ textAlign: "left" }}>Liquidity-Adjusted VaR95</td><td>{formatRiskPercent(liquidRisk.liquidityAdjusted95)} ({formatCurrency(liquidRisk.liquidityAdjusted95Value)})</td><td>{formatRiskPercent(illiquidRisk.liquidityAdjusted95)} ({formatCurrency(illiquidRisk.liquidityAdjusted95Value)})</td></tr>
                <tr><td style={{ textAlign: "left" }}>Liquidity-Adjusted VaR99</td><td>{formatRiskPercent(liquidRisk.liquidityAdjusted99)} ({formatCurrency(liquidRisk.liquidityAdjusted99Value)})</td><td>{formatRiskPercent(illiquidRisk.liquidityAdjusted99)} ({formatCurrency(illiquidRisk.liquidityAdjusted99Value)})</td></tr>
                <tr><td style={{ textAlign: "left" }}>Liquidity penalty factor</td><td>{formatNumber(liquidRisk.liquidityPenaltyFactor, 3)}x</td><td>{formatNumber(illiquidRisk.liquidityPenaltyFactor, 3)}x</td></tr>
              </tbody>
            </table>
          )}
          <ChartCaption>
            Liquidity-adjusted VaR applies a simple penalty from Amihud illiquidity and low turnover ratio, so less liquid stocks carry a larger loss estimate.
          </ChartCaption>
        </section>
      </div>

      {liquidityComparison ? (
        <div className="row">
          <section className="card flex-card">
            <div className="card-title">Regime-Specific VaR: Normal vs High Volatility</div>
            <table className="options-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Regime</th>
                  <th>Stock Type</th>
                  <th>Stock</th>
                  <th>VaR95</th>
                  <th>VaR99</th>
                  <th>Obs.</th>
                </tr>
              </thead>
              <tbody>
                {regimeRows.map((row) => (
                  <tr key={`${row.regime}-${row.bucket}`}>
                    <td style={{ textAlign: "left" }}>{row.regime}</td>
                    <td>{row.bucket}</td>
                    <td>{row.risk.ticker}</td>
                    <td>{formatRiskPercent(row.risk.var95)} ({formatCurrency(row.risk.var95Value)})</td>
                    <td>{formatRiskPercent(row.risk.var99)} ({formatCurrency(row.risk.var99Value)})</td>
                    <td>{row.risk.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ChartCaption>
              High-volatility regime rows use the top quartile of rolling-volatility days; VaR should normally rise versus normal regimes if stress is regime-dependent.
            </ChartCaption>
          </section>
        </div>
      ) : null}

      <div className="row">
        <section className="card flex-card">
          <div className="card-title">VaR Stability Analysis</div>
          <table className="options-table">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Model</th>
                <th>Unhedged VaR</th>
                <th>Delta-Hedged VaR</th>
              </tr>
            </thead>
            <tbody>
              {bars.map((bar) => (
                <tr key={`stability-${bar.label}`}>
                  <td style={{ textAlign: "left" }}>{bar.label.replace("VaR ", "")}</td>
                  <td>{formatCurrency(bar.unhedged)}</td>
                  <td>{formatCurrency(bar.hedged)}</td>
                </tr>
              ))}
              <tr>
                <td style={{ textAlign: "left" }}>Model spread (max - min)</td>
                <td>{formatCurrency(modelSpread)}</td>
                <td>-</td>
              </tr>
              <tr>
                <td style={{ textAlign: "left" }}>Spread / average VaR</td>
                <td>{formatRiskPercent(modelSpreadPct)}</td>
                <td>-</td>
              </tr>
            </tbody>
          </table>
          <ChartCaption>
            A wide spread across Parametric, Historical, Monte Carlo, and GARCH estimates indicates unstable VaR and should be discussed as model risk.
          </ChartCaption>
        </section>
      </div>
    </>
  );
}

function StrategyTab({ report }) {
  const [selectedStrategy, setSelectedStrategy] = useState(STRATEGY_TYPE.STRADDLE);
  const [comparisonStrategy, setComparisonStrategy] = useState(STRATEGY_TYPE.STRANGLE);
  const [elapsedDays, setElapsedDays] = useState(0);
  const [ivChange, setIvChange] = useState(0);
  const [showComparison, setShowComparison] = useState(false);

  const strategy = report.strategies.find((item) => item.type === selectedStrategy) || report.strategies[0];
  const secondaryStrategy = report.strategies.find((item) => item.type === comparisonStrategy) || report.strategies[1] || report.strategies[0];
  const scenarioSnapshot = useMemo(() => {
    if (!strategy) return null;
    const r = 0.07;
    const spot = report.stock.lastPrice;
    const initialValue = strategy.legs.reduce((sum, leg) => sum + leg.quantity * leg.option.bsmPrice, 0);
    const nextGreeks = { delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 };
    const legs = strategy.legs.map((leg) => {
      const nextT = Math.max((leg.option.maturity - elapsedDays) / 365, 0);
      const nextIv = Math.max(0.01, leg.option.iv + ivChange / 100);
      const result =
        nextT === 0
          ? {
              price: leg.option.type === OPTION_TYPE.CALL
                ? Math.max(0, spot - leg.option.strike)
                : Math.max(0, leg.option.strike - spot),
              greeks: { delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 },
            }
          : bsm(spot, leg.option.strike, nextT, nextIv, r, leg.option.type);
      Object.entries(result.greeks).forEach(([key, value]) => {
        nextGreeks[key] += leg.quantity * value;
      });
      return {
        ...leg,
        scenarioPrice: result.price,
      };
    });
    const scenarioValue = legs.reduce((sum, leg) => sum + leg.quantity * leg.scenarioPrice, 0);
    return {
      initialValue,
      scenarioValue,
      scenarioPnl: scenarioValue - initialValue,
      netGreeks: nextGreeks,
      legs,
    };
  }, [elapsedDays, ivChange, report.stock.lastPrice, strategy]);
  const priceGrid = useMemo(() => {
    if (!strategy) return [];
    const start = report.stock.lastPrice * 0.8;
    const end = report.stock.lastPrice * 1.2;
    return Array.from({ length: 25 }, (_, index) => {
      const targetPrice = start + ((end - start) / 24) * index;
      const row = {
        stockPrice: targetPrice,
        primaryPnl: report.calculateStrategyPnL(strategy, targetPrice, elapsedDays, ivChange / 100),
      };
      if (showComparison && secondaryStrategy && secondaryStrategy.type !== strategy.type) {
        row.secondaryPnl = report.calculateStrategyPnL(secondaryStrategy, targetPrice, elapsedDays, ivChange / 100);
      }
      return row;
    });
  }, [elapsedDays, ivChange, report, secondaryStrategy, showComparison, strategy]);

  useEffect(() => {
    if (comparisonStrategy !== selectedStrategy) return;
    const fallback = Object.values(STRATEGY_TYPE).find((type) => type !== selectedStrategy);
    if (fallback) setComparisonStrategy(fallback);
  }, [comparisonStrategy, selectedStrategy]);

  if (!strategy) {
    return <section className="card"><div className="card-title">Strategy Comparison</div><p>No strategy data available.</p></section>;
  }

  return (
    <section className="card">
      <div className="toolbar-space">
        <div className="card-title no-margin">Strategy Comparison</div>
        <button className="run-btn" type="button" onClick={() => setShowComparison((value) => !value)}>
          {showComparison ? "Hide Comparison" : "Compare Strategies"}
        </button>
      </div>
      <div className="section-label">Select Strategy 1</div>
      <div className="strat-tabs">
        {Object.values(STRATEGY_TYPE).map((type) => {
          const disabled = showComparison && type === comparisonStrategy;
          return (
            <button
              key={type}
              type="button"
              className={`${type === selectedStrategy ? "strat-tab active" : "strat-tab"} ${disabled ? "disabled" : ""}`}
              onClick={() => setSelectedStrategy(type)}
              disabled={disabled}
              title={disabled ? "Already selected as Strategy 2" : undefined}
            >
              {type}
            </button>
          );
        })}
      </div>
      {showComparison ? (
        <>
          <div className="section-label">Select Strategy 2</div>
          <div className="strat-tabs">
            {Object.values(STRATEGY_TYPE).map((type) => {
              const disabled = type === selectedStrategy;
              return (
                <button
                  key={`secondary-${type}`}
                  type="button"
                  className={`${type === comparisonStrategy ? "strat-tab active" : "strat-tab"} ${disabled ? "disabled" : ""}`}
                  onClick={() => setComparisonStrategy(type)}
                  disabled={disabled}
                  title={disabled ? "Already selected as Strategy 1" : undefined}
                >
                  {type}
                </button>
              );
            })}
          </div>
        </>
      ) : null}

      <div className="strategy-layout">
        <div className="strategy-card">
          <h3>{strategy.name}</h3>
          <p>{strategy.description}</p>
          <div className="stat-grid two-col">
            <div className="stat"><div className="stat-label">Initial Cost/Credit</div><div className="stat-value down">{strategy.cost >= 0 ? `Debit ${formatCurrency(strategy.cost)}` : `Credit ${formatCurrency(Math.abs(strategy.cost))}`}</div></div>
            <div className="stat"><div className="stat-label">Scenario MTM</div><div className={`stat-value ${scenarioSnapshot?.scenarioValue >= 0 ? "down" : "up"}`}>{scenarioSnapshot ? formatCurrency(Math.abs(scenarioSnapshot.scenarioValue)) : "N/A"}</div></div>
            <div className="stat"><div className="stat-label">Scenario P&L</div><div className={`stat-value ${scenarioSnapshot?.scenarioPnl >= 0 ? "up" : "down"}`}>{scenarioSnapshot ? formatCurrency(scenarioSnapshot.scenarioPnl) : "N/A"}</div></div>
            <div className="stat"><div className="stat-label">Max Profit</div><div className="stat-value up">{typeof strategy.maxProfit === "string" ? strategy.maxProfit : formatCurrency(strategy.maxProfit)}</div></div>
            <div className="stat"><div className="stat-label">Max Loss</div><div className="stat-value down">{typeof strategy.maxLoss === "string" ? strategy.maxLoss : formatCurrency(strategy.maxLoss)}</div></div>
            <div className="stat"><div className="stat-label">Breakeven</div><div className="stat-value neu">{strategy.breakeven.map((value) => formatCurrency(value, 0)).join(", ")}</div></div>
          </div>

          <div className="section-label top-gap">Net Greeks</div>
          <div className="greeks-grid">
            {[
              ["Delta", scenarioSnapshot?.netGreeks.delta ?? strategy.netGreeks.delta],
              ["Gamma", scenarioSnapshot?.netGreeks.gamma ?? strategy.netGreeks.gamma],
              ["Vega", scenarioSnapshot?.netGreeks.vega ?? strategy.netGreeks.vega],
              ["Theta", scenarioSnapshot?.netGreeks.theta ?? strategy.netGreeks.theta],
              ["Rho", scenarioSnapshot?.netGreeks.rho ?? strategy.netGreeks.rho],
            ].map(([label, value]) => (
              <div className="greek-card" key={label}>
                <div className="greek-name">{label}</div>
                <div className={`greek-val ${Number(value) >= 0 ? "up" : "down"}`}>{formatNumber(value, 3)}</div>
              </div>
            ))}
          </div>

          <div className="section-label top-gap">Legs</div>
          {(scenarioSnapshot?.legs || strategy.legs).map((leg) => (
            <div className="leg-row" key={leg.option.id}>
              <strong className={leg.quantity > 0 ? "up" : "down"}>{leg.quantity > 0 ? `Buy ${Math.abs(leg.quantity)}` : `Sell ${Math.abs(leg.quantity)}`}</strong>
              <span>{`${leg.option.strike} ${leg.option.type === OPTION_TYPE.CALL ? "Call" : "Put"}`}</span>
              <span>@ {formatNumber(leg.scenarioPrice ?? leg.option.bsmPrice)}</span>
            </div>
          ))}
        </div>

        <div className="strategy-chart-card">
          <h3>{showComparison && secondaryStrategy ? `Scenario Analysis: ${strategy.name} vs ${secondaryStrategy.name}` : "Scenario Analysis: Payoff Diagram"}</h3>
          <div className="slider-grid">
            <label>
              <span>Simulated Days Passed: {elapsedDays} days</span>
              <input type="range" min="0" max="30" value={elapsedDays} onChange={(event) => setElapsedDays(Number(event.target.value))} />
            </label>
            <label>
              <span>Simulated IV Change: {ivChange}%</span>
              <input type="range" min="-20" max="20" value={ivChange} onChange={(event) => setIvChange(Number(event.target.value))} />
            </label>
          </div>
          <div className="chart-wrap tall-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={priceGrid}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a3444" />
                <XAxis dataKey="stockPrice" stroke="#8b949e" tickFormatter={(value) => value.toFixed(0)} />
                <YAxis stroke="#8b949e" />
                <Tooltip {...chartTooltipProps} formatter={(value) => formatCurrency(value)} />
                <Legend />
                <Line dataKey="primaryPnl" stroke="#00c2ff" dot={false} strokeWidth={2} name={strategy.name} />
                {showComparison && secondaryStrategy && secondaryStrategy.type !== strategy.type ? (
                  <Line
                    dataKey="secondaryPnl"
                    stroke="#ff9f1c"
                    dot={false}
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    name={secondaryStrategy.name}
                  />
                ) : null}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ChartCaption>
            The payoff curve shows where each strategy earns or loses across stock-price outcomes; when comparison is enabled, both strategies are overlaid with distinct colors and labels.
          </ChartCaption>
        </div>
      </div>
      {showComparison ? (
        <div className="strategy-compare-grid">
          {report.strategies.map((item) => (
            <div className="strategy-mini-card" key={item.type}>
              <h4>{item.name}</h4>
              <p>{item.description}</p>
              <div className="info-row"><span className="info-key">Cost</span><span className="info-val">{formatCurrency(Math.abs(item.cost))}</span></div>
              <div className="info-row"><span className="info-key">Delta</span><span className="info-val">{formatNumber(item.netGreeks.delta, 3)}</span></div>
              <div className="info-row"><span className="info-key">Vega</span><span className="info-val">{formatNumber(item.netGreeks.vega, 3)}</span></div>
              <div className="info-row"><span className="info-key">Breakeven</span><span className="info-val">{item.breakeven.map((value) => formatCurrency(value, 0)).join(", ")}</span></div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default function App() {
  const [ticker, setTicker] = useState("BAJFINANCE");
  const [liquidTicker, setLiquidTicker] = useState(null);
  const [illiquidTicker, setIlliquidTicker] = useState(null);
  const [liquidityBucketPct, setLiquidityBucketPct] = useState(25);
  const [riskFreeRate, setRiskFreeRate] = useState(7);
  const [lotSize, setLotSize] = useState(1);
  const [pricingModel, setPricingModel] = useState(PRICING_MODEL.GARCH_TA);
  const [startDate, setStartDate] = useState(subtractMonths(3));
  const [endDate, setEndDate] = useState(asDateInput(new Date()));
  const [activeTab, setActiveTab] = useState("summary");
  const [report, setReport] = useState(null);
  const [liquidityComparison, setLiquidityComparison] = useState(null);
  const [screener, setScreener] = useState(null);
  const [loading, setLoading] = useState(true);
  const [derivativesLoading, setDerivativesLoading] = useState(false);
  const [error, setError] = useState("");
  const [derivativesError, setDerivativesError] = useState("");
  const [selectionByOptionId, setSelectionByOptionId] = useState({});
  const analysisRequestIdRef = useRef(0);
  const pollingRef = useRef(null);

  async function runAnalysis() {
    const requestId = analysisRequestIdRef.current + 1;
    analysisRequestIdRef.current = requestId;
    const requestedTicker = ticker;
    setLoading(true);
    setDerivativesLoading(false);
    setError("");
    setDerivativesError("");
    setReport(null);
    setSelectionByOptionId({});
    try {
      const stockReport = await buildStockSummaryReport({
        ticker: requestedTicker,
        startDate,
        endDate,
      });
      if (analysisRequestIdRef.current !== requestId) return;
      setReport(stockReport);
      setPricingModel((current) => current || PRICING_MODEL.GARCH_TA);
      setLoading(false);

      setDerivativesLoading(true);
      try {
        const enrichedReport = await buildDerivativesReport(stockReport, {
          riskFreeRate,
          lotSize,
        });
        if (analysisRequestIdRef.current !== requestId) return;
        setReport(enrichedReport);
      } catch (derivativeLoadError) {
        if (analysisRequestIdRef.current !== requestId) return;
        setDerivativesError(derivativeLoadError.message || "Unable to load option-chain analytics.");
      }
    } catch (loadError) {
      if (analysisRequestIdRef.current !== requestId) return;
      setError(loadError.message || "Unable to build analytics report.");
      setLoading(false);
    } finally {
      if (analysisRequestIdRef.current === requestId) {
        setDerivativesLoading(false);
      }
    }
  }

  async function refreshLiveQuote() {
    if (!ticker || !report || !report.stock) return;
    try {
      const fresh = await getStockData(ticker, startDate, endDate);
      if (!fresh?.liveQuote) return;
      setReport((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          stock: { ...prev.stock, lastPrice: fresh.lastPrice, liveQuote: fresh.liveQuote },
          liveQuote: fresh.liveQuote,
        };
      });
    } catch (err) {
      // ignore — keep showing last known price
    }
  }

  useEffect(() => {
    if (activeTab === "summary" && ticker) {
      refreshLiveQuote();
      pollingRef.current = setInterval(refreshLiveQuote, 30_000);
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [activeTab, ticker, startDate, endDate]);

  async function loadScreener() {
    try {
      const data = await fetchScreener(6);
      setScreener(data);
    } catch (loadError) {
      console.warn("Unable to load screener", loadError);
    }
  }

  function handleIncreaseOption(optionId) {
    setSelectionByOptionId((current) => ({ ...current, [optionId]: (current[optionId] || 0) + 1 }));
  }

  function handleDecreaseOption(optionId) {
    setSelectionByOptionId((current) => {
      const next = { ...current };
      const updated = (next[optionId] || 0) - 1;
      if (updated !== 0) next[optionId] = updated;
      else delete next[optionId];
      return next;
    });
  }

  useEffect(() => {
    loadScreener();
  }, []);

  useEffect(() => {
    runAnalysis();
  }, [ticker]);

  useEffect(() => {
    let ignore = false;

    async function loadLiquidityComparison() {
      if (!liquidTicker || !illiquidTicker || liquidTicker === illiquidTicker) {
        setLiquidityComparison(null);
        return;
      }

      try {
        const nextComparison = await buildLiquidityComparisonReport({
          liquidTicker,
          illiquidTicker,
          startDate,
          endDate,
        });
        if (!ignore) setLiquidityComparison(nextComparison);
      } catch (loadError) {
        console.warn("Unable to load liquidity comparison", loadError);
        if (!ignore) setLiquidityComparison(null);
      }
    }

    loadLiquidityComparison();
    return () => {
      ignore = true;
    };
  }, [liquidTicker, illiquidTicker, startDate, endDate]);

  useEffect(() => {
    if (!report) return;
    const hasMarketPrices = Object.values(report.optionChain || {}).flat().some((option) => option.marketPrice != null);
    if (pricingModel === PRICING_MODEL.MARKET && !hasMarketPrices) {
      setPricingModel(PRICING_MODEL.GARCH_TA);
    }
  }, [report, pricingModel]);

  const headerTitle = ticker;
  const liquidity = report?.marketProfile?.liquidity || "MED";
  const hasDerivatives = Boolean(report?.derivativesReady && Object.keys(report.optionChain || {}).length);
  const activeTabNeedsDerivatives = derivativeTabIds.has(activeTab);
  const userPortfolio = useMemo(() => (report ? buildUserPortfolio(selectionByOptionId, report.optionChain) : []), [report, selectionByOptionId]);
  const portfolioMetrics = useMemo(() => {
    if (!report) {
      return {
        greeks: { delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 },
        value: 0,
        hedge: { deltaHedgeShares: 0, fullDeltaHedgeShares: 0, hedgeRatio: 1, residualDeltaShares: 0 },
        varResult: { parametric95: 0, parametric99: 0, garch95: 0, garch99: 0, monteCarlo95: 0, monteCarlo99: 0, historical95: 0, historical99: 0, cvarParametric95: 0, cvarParametric99: 0, cvarGarch95: 0, cvarGarch99: 0, cvarMonteCarlo95: 0, cvarMonteCarlo99: 0, cvarHistorical95: 0, cvarHistorical99: 0 },
        hedgedVarResult: { parametric95: 0, parametric99: 0, garch95: 0, garch99: 0, monteCarlo95: 0, monteCarlo99: 0, historical95: 0, historical99: 0, cvarParametric95: 0, cvarParametric99: 0, cvarGarch95: 0, cvarGarch99: 0, cvarMonteCarlo95: 0, cvarMonteCarlo99: 0, cvarHistorical95: 0, cvarHistorical99: 0 },
        pnlScenarios: [],
      };
    }
      const hedge = hedgePortfolio(userPortfolio, lotSize, pricingModel, report.marketProfile);
      const hedgedPortfolio = Math.abs(hedge.deltaHedgeShares) > 0.0001
        ? [
            ...userPortfolio,
            {
              kind: "stock",
              quantity: hedge.deltaHedgeShares,
            },
          ]
        : userPortfolio;
      return {
        greeks: calculatePortfolioGreeks(userPortfolio, pricingModel),
        value: calculatePortfolioValue(userPortfolio, lotSize, pricingModel),
        hedge,
        varResult: calculatePortfolioVaR(userPortfolio, report.stock.historicalData.map((row) => row.price), { riskFreeRate, lotSize, pricingModel }),
        hedgedVarResult: calculatePortfolioVaR(hedgedPortfolio, report.stock.historicalData.map((row) => row.price), { riskFreeRate, lotSize, pricingModel }),
        pnlScenarios: calculatePnLScenarios(userPortfolio, report.stock.lastPrice, { riskFreeRate, lotSize, pricingModel, liquidityProfile: report.marketProfile }),
      };
  }, [report, userPortfolio, riskFreeRate, lotSize, pricingModel]);
  const hedgeInsights = useMemo(() => {
    if (!report) return null;
    return {
      recommendations: generateHedgingRecommendations({
        ...portfolioMetrics.greeks,
        spot: report.stock.lastPrice,
        lotSize,
        netValue: portfolioMetrics.value,
        deltaHedgeShares: portfolioMetrics.hedge.deltaHedgeShares,
        strategyName: detectStrategyName(userPortfolio),
        stockTicker: report.ticker.replace(".NS", ""),
        optionChain: report.optionChain,
        pricingModel,
      }),
    };
  }, [report, portfolioMetrics, lotSize, userPortfolio, pricingModel]);

  return (
    <main className="app">
      <header className="topbar">
        <div className="logo">FRAMRISK <span>// FIN F414</span></div>
        <div className="stock-picker">
          <label htmlFor="stockSelect">Stock</label>
          <div className="select-wrap">
            <select id="stockSelect" value={ticker} onChange={(event) => setTicker(event.target.value)}>
              {STOCK_UNIVERSE.map((symbol) => (
                <option key={symbol} value={symbol}>
                  {symbol}
                </option>
              ))}
            </select>
          </div>
          <span className={`badge ${liquidity === "HIGH" ? "badge-liq" : liquidity === "MED" ? "badge-med" : "badge-low"}`}>{liquidity} LIQUIDITY</span>
        </div>
        <div className="topbar-right">
          <div className="cfg-item">
            <label>Risk-Free Rate (Options)</label>
            <input type="number" value={riskFreeRate} onChange={(event) => setRiskFreeRate(Number(event.target.value))} />
            %
          </div>
          <div className="cfg-item">
            <label>From Date</label>
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="date-input" />
          </div>
          <div className="cfg-item">
            <label>To Date</label>
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="date-input" />
          </div>
          <button className="run-btn" type="button" onClick={runAnalysis}>
            ▶ RUN
          </button>
          <button
            className="run-btn secondary"
            type="button"
            onClick={() => report && downloadCsv(`${ticker.toLowerCase()}-fram-report.csv`, report.exportCsv())}
            disabled={!report}
          >
            Download
          </button>
        </div>
      </header>

      <section className="hero-strip">
        <div>
          <h1>
            Analysis for <span>{headerTitle}</span>
          </h1>
        </div>
      </section>

      <nav className="tabs">
        {tabs.map((tab) => (
          <button key={tab.id} type="button" className={tab.id === activeTab ? "tab active" : "tab"} onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </nav>

      <section className="main">
        {loading ? <section className="card"><div className="card-title">Loading</div><p>Pulling market data and rebuilding the dashboard...</p></section> : null}
        {error ? <section className="card"><div className="card-title">Error</div><p>{error}</p></section> : null}

        {!loading && !error && report ? (
          <>
            {activeTabNeedsDerivatives && !hasDerivatives ? (
              <section className="card">
                <div className="card-title">{derivativesLoading ? "Loading Derivatives" : "Derivatives Unavailable"}</div>
                <p>
                  {derivativesLoading
                    ? "Stock summary is ready. Option chain, Greeks, Portfolio, PnL, VaR, and Strategy analytics are loading in the background..."
                    : derivativesError || "Option-chain analytics are not available yet."}
                </p>
              </section>
            ) : null}
            {activeTab === "screener" ? (
              <ScreenerTab
                screener={screener}
                liquidTicker={liquidTicker}
                illiquidTicker={illiquidTicker}
                onSelectLiquid={setLiquidTicker}
                onSelectIlliquid={setIlliquidTicker}
              />
            ) : null}
            {activeTab === "summary" ? <StockSummaryTab report={report} /> : null}
            {activeTab === "liquidity" ? (
              <LiquidityComparisonTab
                liquidityStudy={liquidityComparison}
                screener={screener}
                liquidTicker={liquidTicker}
                illiquidTicker={illiquidTicker}
                liquidityBucketPct={liquidityBucketPct}
                onLiquidityBucketPctChange={setLiquidityBucketPct}
                onSelectLiquid={setLiquidTicker}
                onSelectIlliquid={setIlliquidTicker}
              />
            ) : null}
            {activeTab === "chain" && hasDerivatives ? <OptionChainTab report={report} selectionByOptionId={selectionByOptionId} onIncreaseOption={handleIncreaseOption} onDecreaseOption={handleDecreaseOption} pricingModel={pricingModel} onPricingModelChange={setPricingModel} /> : null}
            {activeTab === "portfolio" && hasDerivatives ? <PortfolioTab report={report} portfolio={userPortfolio} metrics={portfolioMetrics} pricingModel={pricingModel} hedgeInsights={hedgeInsights} lotSize={lotSize} onLotSizeChange={setLotSize} /> : null}
            {activeTab === "greeks" && hasDerivatives ? <GreeksTab report={report} pricingModel={pricingModel} hedgeInsights={hedgeInsights} /> : null}
            {activeTab === "pnl" && hasDerivatives ? (
              <PnLTab
                scenarios={portfolioMetrics.pnlScenarios}
                hasPortfolio={userPortfolio.length > 0}
                portfolio={userPortfolio}
                report={report}
                pricingModel={pricingModel}
                hedgeInsights={hedgeInsights}
                hedge={portfolioMetrics.hedge}
              />
            ) : null}
            {activeTab === "surface" && hasDerivatives ? <SurfaceTab report={report} /> : null}
            {activeTab === "risk" && hasDerivatives ? (
              <RiskTab
                unhedgedVarResult={portfolioMetrics.varResult}
                hedgedVarResult={portfolioMetrics.hedgedVarResult}
                liquidityComparison={liquidityComparison}
              />
            ) : null}
            {activeTab === "strategy" && hasDerivatives ? <StrategyTab report={report} /> : null}
          </>
        ) : null}
      </section>
    </main>
  );
}
