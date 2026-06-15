import { Suspense, lazy, useEffect, useState } from "react";
import Navbar from "./components/Navbar";
import ConfigPanel from "./components/ConfigPanel";
import StockSummary from "./components/tabs/StockSummary";
import OptionChain from "./components/tabs/OptionChain";
import PortfolioAnalysis from "./components/tabs/PortfolioAnalysis";
import GreeksIV from "./components/tabs/GreeksIV";
import PnLScenarios from "./components/tabs/PnLScenarios";
import RiskMeasures from "./components/tabs/RiskMeasures";
import { buildDownloadUrl, fetchOptions, fetchPortfolio, fetchRisk, fetchSummary } from "./api";

const VolatilitySurface = lazy(() => import("./components/tabs/VolatilitySurface"));

const tabs = [
  { id: "summary", label: "Stock Summary" },
  { id: "options", label: "Option Chain" },
  { id: "portfolio", label: "Portfolio" },
  { id: "greeks", label: "Greeks & IV" },
  { id: "pnl", label: "PnL Scenarios" },
  { id: "surface", label: "Vol Surface" },
  { id: "risk", label: "Risk" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("summary");
  const [months, setMonths] = useState(6);
  const [riskFreeRate, setRiskFreeRate] = useState(0.07);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);
  const [optionsData, setOptionsData] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [risk, setRisk] = useState(null);

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const [summaryData, optionsResult, portfolioResult, riskResult] = await Promise.all([
        fetchSummary(months),
        fetchOptions(months, riskFreeRate),
        fetchPortfolio(months, riskFreeRate),
        fetchRisk(months),
      ]);
      setSummary(summaryData);
      setOptionsData(optionsResult);
      setPortfolio(portfolioResult);
      setRisk(riskResult);
    } catch (loadError) {
      setError(loadError.message || "Failed to load analytics.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  return (
    <main className="app-shell">
      <div className="background-orb orb-one" />
      <div className="background-orb orb-two" />
      <Navbar />
      <ConfigPanel
        months={months}
        setMonths={setMonths}
        riskFreeRate={riskFreeRate}
        setRiskFreeRate={setRiskFreeRate}
        onRefresh={loadAll}
        loading={loading}
      />

      <section className="panel toolbar">
        <div className="tab-strip">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={tab.id === activeTab ? "tab-button active" : "tab-button"}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="download-group">
          <a className="ghost-button" href={buildDownloadUrl("xlsx", months, riskFreeRate)}>
            Download XLSX
          </a>
          <a className="ghost-button" href={buildDownloadUrl("docx", months, riskFreeRate)}>
            Download Report
          </a>
        </div>
      </section>

      {error ? <section className="panel error-panel">{error}</section> : null}
      {loading ? <section className="panel loading-panel">Loading analytics...</section> : null}

      {!loading && activeTab === "summary" ? <StockSummary summary={summary} /> : null}
      {!loading && activeTab === "options" ? <OptionChain optionsData={optionsData} /> : null}
      {!loading && activeTab === "portfolio" ? <PortfolioAnalysis portfolio={portfolio} /> : null}
      {!loading && activeTab === "greeks" ? <GreeksIV optionsData={optionsData} portfolio={portfolio} /> : null}
      {!loading && activeTab === "pnl" ? <PnLScenarios portfolio={portfolio} /> : null}
      {!loading && activeTab === "surface" ? (
        <Suspense fallback={<section className="panel loading-panel">Loading volatility surface...</section>}>
          <VolatilitySurface optionsData={optionsData} />
        </Suspense>
      ) : null}
      {!loading && activeTab === "risk" ? <RiskMeasures risk={risk} /> : null}
    </main>
  );
}
