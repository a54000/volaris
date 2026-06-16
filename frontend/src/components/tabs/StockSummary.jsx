import LineChart from "../charts/LineChart";

export default function StockSummary({ summary, selectedRow }) {
  const rows = summary?.all_stocks || [];
  const chartData = rows.slice(0, 12).map((row) => ({
    symbol: row.symbol.replace(".NS", ""),
    turnover: Number(row.average_turnover.toFixed(2)),
  }));

  if (!selectedRow) {
    return (
      <section className="panel workspace-panel">
        <h3>Stock Summary</h3>
        <p>No stock summary is available for the selected symbol.</p>
      </section>
    );
  }

  return (
    <div className="tab-content">
      <section className="panel workspace-panel summary-panel">
        <div className="summary-top-grid">
          <div className="price-card">
            <span className="summary-label">Latest Close</span>
            <strong>{`₹${selectedRow.latest_close.toFixed(2)}`}</strong>
            <p>{`Avg volume ${selectedRow.average_volume.toFixed(0)} | Turnover ratio ${(selectedRow.average_turnover_ratio || 0).toFixed(4)}`}</p>
            <div className="price-facts">
              <div>
                <span>Amihud</span>
                <strong>{(selectedRow.average_amihud_illiquidity || 0).toExponential(2)}</strong>
              </div>
              <div>
                <span>Forecast Vol</span>
                <strong>{selectedRow.garch_forecast_volatility.toFixed(4)}</strong>
              </div>
            </div>
          </div>

          <div className="key-stats-card">
            <h3>Key Statistics</h3>
            <div className="key-stats-grid">
              <article>
                <span>Annualized Volatility</span>
                <strong>{(selectedRow.latest_realized_vol_20d || 0).toFixed(4)}</strong>
              </article>
              <article>
                <span>GARCH Method</span>
                <strong>{selectedRow.garch_method}</strong>
              </article>
              <article>
                <span>Average Turnover</span>
                <strong>{selectedRow.average_turnover.toFixed(2)}</strong>
              </article>
              <article>
                <span>Universe Size</span>
                <strong>{summary?.universe_size || 0}</strong>
              </article>
            </div>
          </div>
        </div>

        <LineChart data={chartData} xKey="symbol" yKey="turnover" color="#2fd3f5" title="Historical Price (Liquidity Rank Proxy)" />
      </section>
    </div>
  );
}
