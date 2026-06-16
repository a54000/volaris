import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const CATEGORY_CONFIG = [
  { key: "price", label: "💰 Price", dataKey: "priceScenarios" },
  { key: "volatility", label: "📊 Volatility", dataKey: "volScenarios" },
  { key: "stress", label: "💥 Stress", dataKey: "stressScenarios" },
  { key: "time", label: "⏱ Time", dataKey: "timeScenarios" },
];

function formatCurrency(value) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}₹${Math.abs(value).toFixed(2)}`;
}

function formatSigned(value, digits = 3) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(digits)}`;
}

function getPnlClass(value) {
  if (value > 0) return "pnl-pos";
  if (value < 0) return "pnl-neg";
  return "pnl-neu";
}

function getSignalIcon(signal) {
  if (signal === "improved") return "🟢";
  if (signal === "worsened") return "🔴";
  return "⚪";
}

function getHedgeAppliedLabel(hedgeConfig) {
  if (!hedgeConfig || hedgeConfig.type === "none") {
    return "No hedge applied";
  }
  if (hedgeConfig.type === "shares") {
    const action = hedgeConfig.sharesToHedge < 0 ? "Short" : "Buy";
    return `${action} ${Math.abs(hedgeConfig.sharesToHedge).toFixed(2)} shares`;
  }
  if (hedgeConfig.type === "option") {
    const action = hedgeConfig.lots < 0 ? "Sell" : "Buy";
    return `${action} ${Math.abs(hedgeConfig.lots).toFixed(2)} option lots`;
  }
  return "Custom hedge";
}

export default function BeforeAfterTable({ data }) {
  const [activeCategory, setActiveCategory] = useState("price");

  const activeRows = useMemo(() => {
    const config = CATEGORY_CONFIG.find((item) => item.key === activeCategory);
    return config ? data?.[config.dataKey] || [] : [];
  }, [activeCategory, data]);

  if (!data) return null;

  const { hedgeConfig, hedgeCost, greekComparison, pnlCurve, baseGreeks } = data;

  return (
    <section className="card before-after-shell">
      <div className="card-title">Before vs After Hedge</div>
      <div className="before-after-meta">
        <span>Hedge applied: {getHedgeAppliedLabel(hedgeConfig)}</span>
        <span>Hedge cost: ₹{hedgeCost.toFixed(2)}</span>
        <span>Delta reduction: {greekComparison.reductionPct.delta}%</span>
      </div>

      <div className="before-after-tabs">
        {CATEGORY_CONFIG.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`before-after-pill ${activeCategory === item.key ? "active" : ""}`}
            onClick={() => setActiveCategory(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <table className="before-after-table">
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Before Hedge</th>
            <th>After Hedge</th>
            <th className="scenario-signal" />
          </tr>
        </thead>
        <tbody>
          {activeRows.map((scenario) => (
            <tr key={scenario.id}>
              <td>{scenario.label}</td>
              <td className={getPnlClass(scenario.before.totalPnL)}>{formatCurrency(scenario.before.totalPnL)}</td>
              <td className={getPnlClass(scenario.after.totalPnL)}>{formatCurrency(scenario.after.totalPnL)}</td>
              <td className="scenario-signal">{getSignalIcon(scenario.signal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="card-title">Greek Comparison</div>
      <table className="greek-compare-table">
        <thead>
          <tr>
            <th />
            <th>Before</th>
            <th>After</th>
            <th>Change</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Δ</td>
            <td>{formatSigned(greekComparison.before.delta, 3)}</td>
            <td>{formatSigned(greekComparison.after.delta, 3)}</td>
            <td className={getPnlClass(-Math.abs(greekComparison.after.delta) + Math.abs(greekComparison.before.delta))}>
              {formatSigned(greekComparison.changes.delta, 3)} ({greekComparison.reductionPct.delta}%)
            </td>
          </tr>
          <tr>
            <td>Γ</td>
            <td>{formatSigned(greekComparison.before.gamma, 4)}</td>
            <td>{formatSigned(greekComparison.after.gamma, 4)}</td>
            <td className={getPnlClass(-Math.abs(greekComparison.after.gamma) + Math.abs(greekComparison.before.gamma))}>
              {formatSigned(greekComparison.changes.gamma, 4)}
            </td>
          </tr>
          <tr>
            <td>ν</td>
            <td>{formatSigned(greekComparison.before.vega, 3)}</td>
            <td>{formatSigned(greekComparison.after.vega, 3)}</td>
            <td className={getPnlClass(-Math.abs(greekComparison.after.vega) + Math.abs(greekComparison.before.vega))}>
              {formatSigned(greekComparison.changes.vega, 3)}
            </td>
          </tr>
          <tr>
            <td>θ</td>
            <td>{formatSigned(greekComparison.before.theta, 3)}</td>
            <td>{formatSigned(greekComparison.after.theta, 3)}</td>
            <td className={getPnlClass(-Math.abs(greekComparison.after.theta) + Math.abs(greekComparison.before.theta))}>
              {formatSigned(greekComparison.changes.theta, 3)}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="card-title">PnL Curve</div>
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={pnlCurve.curveData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2535" />
            <XAxis dataKey="spotPrice" tickFormatter={(value) => `₹${value}`} stroke="#8892a4" />
            <YAxis tickFormatter={(value) => `₹${value}`} stroke="#8892a4" />
            <Tooltip
              formatter={(value, name) => [`₹${Number(value).toFixed(2)}`, name]}
              contentStyle={{ background: "#161b27", border: "1px solid #1e2535" }}
            />
            <ReferenceLine x={pnlCurve.currentSpot} stroke="#00d4ff" strokeDasharray="4 4" label="Spot" />
            <ReferenceLine y={0} stroke="#ffffff" strokeDasharray="4 4" />
            {baseGreeks?.breakevenLow != null ? (
              <ReferenceLine x={baseGreeks.breakevenLow} stroke="#ffd700" strokeDasharray="4 4" label="BE(L)" />
            ) : null}
            {baseGreeks?.breakevenHigh != null ? (
              <ReferenceLine x={baseGreeks.breakevenHigh} stroke="#ffd700" strokeDasharray="4 4" label="BE(H)" />
            ) : null}
            <Line type="monotone" dataKey="beforePnL" stroke="#ff4444" strokeDasharray="5 5" dot={false} name="Before Hedge" strokeWidth={2} />
            <Line type="monotone" dataKey="afterPnL" stroke="#00ff88" dot={false} name="After Hedge" strokeWidth={2} />
            <Legend />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-note">
        Curve computed using Δ-Γ approximation. Actual PnL may differ due to IV changes and higher-order effects such as vanna and volga.
      </div>
    </section>
  );
}
