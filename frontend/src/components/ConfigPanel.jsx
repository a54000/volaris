export default function ConfigPanel({ months, setMonths, riskFreeRate, setRiskFreeRate, onRefresh, loading }) {
  return (
    <section className="panel config-panel">
      <div className="config-copy">
        <p className="eyebrow">Scenario Controls</p>
        <h2>Adjust the analytics window and pricing assumptions.</h2>
        <p>
          Refreshing clears the backend cache for the selected month window, then reloads summary, options, portfolio,
          and risk views.
        </p>
      </div>
      <div className="config-controls">
        <div className="config-field">
          <label htmlFor="months">Window (months)</label>
          <input
            id="months"
            type="number"
            min="1"
            max="24"
            value={months}
            onChange={(event) => setMonths(Number(event.target.value))}
          />
        </div>
        <div className="config-field">
          <label htmlFor="riskFreeRate">Risk-free rate</label>
          <input
            id="riskFreeRate"
            type="number"
            min="0"
            max="0.25"
            step="0.005"
            value={riskFreeRate}
            onChange={(event) => setRiskFreeRate(Number(event.target.value))}
          />
        </div>
        <button className="primary-button" type="button" onClick={onRefresh} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh Analytics"}
        </button>
      </div>
    </section>
  );
}
