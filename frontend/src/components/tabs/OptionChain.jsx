export default function OptionChain({ optionsData }) {
  return (
    <div className="tab-content">
      {(optionsData?.symbols || []).map((symbolBlock) => (
        <section className="panel" key={symbolBlock.symbol}>
          <div className="panel-header">
            <h3>{symbolBlock.symbol}</h3>
            <span>{`Spot ${symbolBlock.spot.toFixed(2)} | Hist Vol ${symbolBlock.historical_volatility.toFixed(4)} | GARCH ${symbolBlock.garch_volatility.toFixed(4)}`}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Contract</th>
                  <th>Type</th>
                  <th>Strike</th>
                  <th>Market Proxy</th>
                  <th>BSM HistVol</th>
                  <th>BSM GARCH</th>
                </tr>
              </thead>
              <tbody>
                {symbolBlock.contracts.map((contract) => (
                  <tr key={`${symbolBlock.symbol}-${contract.label}`}>
                    <td>{contract.label}</td>
                    <td>{contract.option_type}</td>
                    <td>{contract.strike.toFixed(2)}</td>
                    <td>{contract.market_price_proxy.toFixed(4)}</td>
                    <td>{contract.bsm_historical_vol_price.toFixed(4)}</td>
                    <td>{contract.bsm_garch_vol_price.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
