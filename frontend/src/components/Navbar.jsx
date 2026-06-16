export default function Navbar({ summary, activeTab, loading }) {
  const liquidCount = summary?.liquid_bucket?.length || 0;
  const illiquidCount = summary?.illiquid_bucket?.length || 0;
  const universeSize = summary?.universe_size || 0;

  return (
    <header className="hero-card">
      <div className="hero-main">
        <p className="eyebrow">FRAM Risk Analytics Platform</p>
        <h1>Volatility, options, portfolio hedging, and VaR in one cockpit.</h1>
        <div className="hero-meta-row">
          <div className="hero-chip">
            <span>Active View</span>
            <strong>{activeTab}</strong>
          </div>
          <div className={loading ? "hero-chip status-chip loading" : "hero-chip status-chip"}>
            <span>Data State</span>
            <strong>{loading ? "Refreshing" : "Ready"}</strong>
          </div>
        </div>
      </div>
      <div className="hero-side">
        <p className="hero-copy">
          A live research cockpit for comparing liquidity, volatility forecasts, option valuations, hedge posture, and
          risk conditions across the equity universe.
        </p>
        <div className="hero-stats">
          <article>
            <span>Universe</span>
            <strong>{universeSize}</strong>
          </article>
          <article>
            <span>Liquid</span>
            <strong>{liquidCount}</strong>
          </article>
          <article>
            <span>Illiquid</span>
            <strong>{illiquidCount}</strong>
          </article>
        </div>
      </div>
    </header>
  );
}
