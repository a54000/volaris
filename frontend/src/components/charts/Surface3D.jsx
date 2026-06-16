export default function Surface3D({ points = [] }) {
  const uniqueSymbols = [...new Set(points.map((point) => point.symbol))];
  const maturities = ["30D", "60D"];
  const rows = uniqueSymbols.map((symbol) => {
    const symbolRows = points.filter((point) => point.symbol === symbol);
    const columns = maturities.map((maturity) => {
      const match = symbolRows.find((row) => row.maturity === maturity);
      return {
        maturity,
        volatility: match ? match.volatility : 0,
      };
    });
    return { symbol, columns };
  });
  const maxVolatility = Math.max(...points.map((point) => point.volatility), 0.0001);

  return (
    <section className="panel">
      <div className="panel-header">
        <h3>Volatility Surface</h3>
      </div>
      <div className="surface-legend">
        <span>Lower Vol</span>
        <div className="surface-gradient" />
        <span>Higher Vol</span>
      </div>
      <div className="surface-grid">
        <div className="surface-header" />
        {maturities.map((maturity) => (
          <div key={maturity} className="surface-header">
            {maturity}
          </div>
        ))}
        {rows.map((row) => (
          <div className="surface-row" key={row.symbol}>
            <div className="surface-symbol">{row.symbol.replace(".NS", "")}</div>
            {row.columns.map((column) => {
              const ratio = column.volatility / maxVolatility;
              const height = 44 + ratio * 88;
              return (
                <div className="surface-cell" key={`${row.symbol}-${column.maturity}`}>
                  <div
                    className="surface-bar"
                    style={{
                      height: `${height}px`,
                      background: `linear-gradient(180deg, rgba(255,183,3,${0.45 + ratio * 0.35}), rgba(33,150,243,${0.35 + ratio * 0.4}))`,
                    }}
                  >
                    <span>{column.volatility.toFixed(3)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
