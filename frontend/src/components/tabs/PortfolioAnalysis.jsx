export default function PortfolioAnalysis({ portfolio }) {
  return (
    <div className="tab-content">
      {(portfolio?.portfolios || []).map((item) => (
        <section className="panel" key={item.symbol}>
          <div className="panel-header">
            <h3>{`${item.symbol} ${item.bucket.toUpperCase()} Strategy`}</h3>
            <span>{`${item.position.option_type.toUpperCase()} ${item.position.maturity_days}D`}</span>
          </div>
          <div className="stats-grid compact">
            <article>
              <span>Delta</span>
              <strong>{item.portfolio_greeks.delta.toFixed(4)}</strong>
            </article>
            <article>
              <span>Gamma</span>
              <strong>{item.portfolio_greeks.gamma.toFixed(4)}</strong>
            </article>
            <article>
              <span>Vega</span>
              <strong>{item.portfolio_greeks.vega.toFixed(4)}</strong>
            </article>
            <article>
              <span>Hedge Shares</span>
              <strong>{item.hedge.raw_shares.toFixed(4)}</strong>
            </article>
          </div>
        </section>
      ))}
    </div>
  );
}
