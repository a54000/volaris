import HeatmapPnL from "../charts/HeatmapPnL";

export default function PnLScenarios({ portfolio }) {
  const scenarios = portfolio?.portfolios?.[0]?.scenarios || [];
  return (
    <div className="tab-content">
      <HeatmapPnL scenarios={scenarios} />
    </div>
  );
}
