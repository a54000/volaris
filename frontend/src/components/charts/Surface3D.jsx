import Plot from "react-plotly.js";

export default function Surface3D({ points = [] }) {
  const symbols = points.map((point) => point.symbol);
  const maturities = ["30D", "60D"];
  const zValues = symbols.map((symbol) => {
    const symbolRows = points.filter((point) => point.symbol === symbol);
    return maturities.map((maturity) => {
      const match = symbolRows.find((row) => row.maturity === maturity);
      return match ? match.volatility : 0;
    });
  });

  return (
    <section className="panel">
      <div className="panel-header">
        <h3>Volatility Surface</h3>
      </div>
      <Plot
        data={[
          {
            type: "surface",
            x: maturities,
            y: symbols,
            z: zValues,
            colorscale: "YlOrRd",
          },
        ]}
        layout={{
          autosize: true,
          height: 380,
          paper_bgcolor: "rgba(0,0,0,0)",
          plot_bgcolor: "rgba(0,0,0,0)",
          margin: { l: 10, r: 10, b: 20, t: 10 },
          scene: {
            xaxis: { title: "Maturity" },
            yaxis: { title: "Symbol" },
            zaxis: { title: "Volatility" },
          },
        }}
        style={{ width: "100%" }}
        config={{ displayModeBar: false, responsive: true }}
      />
    </section>
  );
}
