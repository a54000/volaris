export default function GreeksIV({ optionsData, portfolio }) {
  const mergedRows = [];
  (optionsData?.symbols || []).forEach((symbolBlock) => {
    const portfolioBlock = (portfolio?.portfolios || []).find((item) => item.symbol === symbolBlock.symbol);
    symbolBlock.contracts.forEach((contract) => {
      mergedRows.push({
        symbol: symbolBlock.symbol,
        contract: contract.label,
        garchVol: symbolBlock.garch_volatility,
        historicalVol: symbolBlock.historical_volatility,
        delta: portfolioBlock?.portfolio_greeks.delta || 0,
        gamma: portfolioBlock?.portfolio_greeks.gamma || 0,
        vega: portfolioBlock?.portfolio_greeks.vega || 0,
      });
    });
  });

  return (
    <div className="tab-content">
      <section className="panel">
        <div className="panel-header">
          <h3>Greeks and IV Matrix</h3>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Contract</th>
                <th>Hist Vol</th>
                <th>GARCH Vol</th>
                <th>Delta</th>
                <th>Gamma</th>
                <th>Vega</th>
              </tr>
            </thead>
            <tbody>
              {mergedRows.map((row) => (
                <tr key={`${row.symbol}-${row.contract}`}>
                  <td>{row.symbol}</td>
                  <td>{row.contract}</td>
                  <td>{row.historicalVol.toFixed(4)}</td>
                  <td>{row.garchVol.toFixed(4)}</td>
                  <td>{row.delta.toFixed(4)}</td>
                  <td>{row.gamma.toFixed(4)}</td>
                  <td>{row.vega.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
