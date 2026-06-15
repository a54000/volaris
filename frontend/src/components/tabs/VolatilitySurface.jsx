import Surface3D from "../charts/Surface3D";

export default function VolatilitySurface({ optionsData }) {
  const points = [];
  (optionsData?.symbols || []).forEach((symbolBlock) => {
    points.push({ symbol: symbolBlock.symbol, maturity: "30D", volatility: symbolBlock.historical_volatility });
    points.push({ symbol: symbolBlock.symbol, maturity: "60D", volatility: symbolBlock.garch_volatility });
  });

  return (
    <div className="tab-content">
      <Surface3D points={points} />
    </div>
  );
}
