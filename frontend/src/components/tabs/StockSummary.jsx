import LineChart from "../charts/LineChart";

export default function StockSummary({ summary }) {
  const rows = summary?.all_stocks || [];
  const chartData = rows.slice(0, 10).map((row) => ({
    symbol: row.symbol.replace(".NS", ""),
    turnover: Number(row.average_turnover.toFixed(2)),
    volatility: Number((row.latest_realized_vol_20d || 0).toFixed(4)),
  }));

  return (
    <div className="tab-content">
      <section className="panel stats-grid">
        <article>
          <span>Universe Size</span>
          <strong>{summary?.universe_size || 0}</strong>
        </article>
        <article>
          <span>Liquid Bucket</span>
          <strong>{summary?.liquid_bucket?.length || 0}</strong>
        </article>
        <article>
          <span>Illiquid Bucket</span>
          <strong>{summary?.illiquid_bucket?.length || 0}</strong>
        </article>
      </section>

      <LineChart data={chartData} xKey="symbol" yKey="turnover" color="#ffb703" title="Top Turnover Snapshot" />

      <section className="panel">
        <div className="panel-header">
          <h3>Liquidity and Volatility Table</h3>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Avg Turnover</th>
                <th>20D Vol</th>
                <th>Amihud</th>
                <th>GARCH Forecast</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 12).map((row) => (
                <tr key={row.symbol}>
                  <td>{row.symbol}</td>
                  <td>{row.average_turnover.toFixed(2)}</td>
                  <td>{(row.latest_realized_vol_20d || 0).toFixed(4)}</td>
                  <td>{(row.average_amihud_illiquidity || 0).toExponential(2)}</td>
                  <td>{row.garch_forecast_volatility.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
