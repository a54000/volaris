export default function RiskMeasures({ risk }) {
  return (
    <div className="tab-content">
      <section className="panel">
        <div className="panel-header">
          <h3>VaR Comparison</h3>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Bucket</th>
                <th>Regime</th>
                <th>VaR 95 Parametric</th>
                <th>VaR 99 Parametric</th>
                <th>VaR 95 GARCH</th>
                <th>VaR 99 GARCH</th>
              </tr>
            </thead>
            <tbody>
              {(risk?.comparison_table || []).map((row) => (
                <tr key={row.symbol}>
                  <td>{row.symbol}</td>
                  <td>{row.bucket}</td>
                  <td>{row.regime}</td>
                  <td>{row.var_95_parametric.toFixed(2)}</td>
                  <td>{row.var_99_parametric.toFixed(2)}</td>
                  <td>{row.var_95_garch.toFixed(2)}</td>
                  <td>{row.var_99_garch.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
