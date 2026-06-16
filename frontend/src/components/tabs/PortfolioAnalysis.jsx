export default function PortfolioAnalysis({ portfolio }) {
  const item = portfolio?.portfolios?.[0];
  const scenarios = item?.scenarios || [];

  if (!item) {
    return (
      <section className="panel workspace-panel">
        <h3>Portfolio Analysis</h3>
        <p>No portfolio analysis is available for the selected stock.</p>
      </section>
    );
  }

  return (
    <section className="panel workspace-panel">
      <div className="portfolio-block">
        <h3>Composition</h3>
        <div className="portfolio-strategy-card">
          <div>
            <span className="summary-label">Strategy Seed</span>
            <strong>{`${item.position.option_type.toUpperCase()} ${item.position.maturity_days}D`}</strong>
            <p>{`A ${item.bucket} bucket setup built from the current pricing and hedge pipeline.`}</p>
          </div>
          <div className="portfolio-chip-row">
            <span className="portfolio-chip">{`Strike ${item.position.strike.toFixed(2)}`}</span>
            <span className="portfolio-chip">{`Qty ${item.position.quantity}`}</span>
            <span className="portfolio-chip">{`Value ${item.position.valuation_price.toFixed(2)}`}</span>
          </div>
        </div>
      </div>

      <div className="portfolio-metric-grid">
        <article className="portfolio-metric-card">
          <span className="summary-label">Portfolio Delta</span>
          <strong>{item.portfolio_greeks.delta.toFixed(4)}</strong>
          <p>{`Gamma ${item.portfolio_greeks.gamma.toFixed(4)} | Vega ${item.portfolio_greeks.vega.toFixed(4)}`}</p>
        </article>
        <article className="portfolio-metric-card">
          <span className="summary-label">Raw Hedge</span>
          <strong>{item.hedge.raw_shares.toFixed(2)}</strong>
          <p>Shares required for a flat delta position.</p>
        </article>
        <article className="portfolio-metric-card">
          <span className="summary-label">Liquidity Adjusted</span>
          <strong>{item.hedge.liquidity_adjusted_shares.toFixed(2)}</strong>
          <p>Scaled with the selected stock’s liquidity profile.</p>
        </article>
      </div>

      <div className="portfolio-var-grid">
        <article>
          <h4>Unhedged Portfolio</h4>
          <p>{`Delta ${item.portfolio_greeks.delta.toFixed(4)}`}</p>
          <p>{`Gamma ${item.portfolio_greeks.gamma.toFixed(4)}`}</p>
          <p>{`Vega ${item.portfolio_greeks.vega.toFixed(4)}`}</p>
        </article>
        <article>
          <h4>Delta-Hedged Portfolio</h4>
          <p>{`Raw hedge ${item.hedge.raw_shares.toFixed(4)} shares`}</p>
          <p>{`Liquidity-adjusted ${item.hedge.liquidity_adjusted_shares.toFixed(4)} shares`}</p>
        </article>
      </div>

      <div className="portfolio-scenario-strip">
        <h4>PnL Scenarios</h4>
        <div className="portfolio-scenario-grid">
          {scenarios.slice(0, 6).map((scenario) => (
            <div
              key={`${scenario.price_shock}-${scenario.vol_shock}`}
              className={scenario.pnl >= 0 ? "scenario-pill up" : "scenario-pill down"}
            >
              <span>{`${(scenario.price_shock * 100).toFixed(0)}% / ${(scenario.vol_shock * 100).toFixed(0)}%`}</span>
              <strong>{scenario.pnl.toFixed(2)}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
