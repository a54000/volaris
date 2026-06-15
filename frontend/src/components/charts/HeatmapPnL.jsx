export default function HeatmapPnL({ scenarios = [] }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h3>Scenario PnL Grid</h3>
      </div>
      <div className="heatmap-grid">
        {scenarios.map((scenario) => {
          const positive = scenario.estimated_pnl >= 0;
          return (
            <div key={`${scenario.price_shock}-${scenario.volatility_shock}`} className={`heatmap-cell ${positive ? "up" : "down"}`}>
              <span>{`${(scenario.price_shock * 100).toFixed(0)}% / ${(scenario.volatility_shock * 100).toFixed(0)}%`}</span>
              <strong>{scenario.estimated_pnl.toFixed(2)}</strong>
            </div>
          );
        })}
      </div>
    </section>
  );
}
