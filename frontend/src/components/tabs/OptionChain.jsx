import { useMemo, useState } from "react";

export default function OptionChain({ optionsData }) {
  const symbols = optionsData?.symbols || [];
  const [selectedMaturity, setSelectedMaturity] = useState(30);
  const symbolBlock = symbols[0];

  const contracts = useMemo(() => {
    return (symbolBlock?.contracts || []).filter((contract) => contract.maturity_days === selectedMaturity);
  }, [symbolBlock, selectedMaturity]);

  if (!symbolBlock) {
    return (
      <section className="panel workspace-panel">
        <h3>Option Chain</h3>
        <p>No option chain data is available for the selected stock.</p>
      </section>
    );
  }

  const calls = contracts.filter((contract) => contract.option_type === "call");
  const puts = contracts.filter((contract) => contract.option_type === "put");
  const spot = symbolBlock.spot || 0;
  const rows = calls.map((call, index) => ({
    call,
    put: puts[index] || null,
  }));

  function buildGreeks(contract) {
    const strikeGap = spot ? (contract.strike - spot) / spot : 0;
    const distance = Math.abs(strikeGap);
    const deltaMagnitude = Math.max(0.18, 0.54 - distance * 2.2);
    const gamma = Math.max(0.0018, 0.0042 - distance * 0.018);
    const vega = Math.max(0.78, 1.32 - distance * 2.4);

    return {
      delta: contract.option_type === "call" ? deltaMagnitude : -deltaMagnitude,
      gamma,
      vega,
    };
  }

  return (
    <section className="panel workspace-panel">
      <div className="panel-header">
        <h3>Select Maturity</h3>
      </div>
      <div className="maturity-switcher">
        {[30, 60].map((days) => (
          <button
            key={days}
            type="button"
            className={days === selectedMaturity ? "maturity-pill active" : "maturity-pill"}
            onClick={() => setSelectedMaturity(days)}
          >
            {`${days} Days`}
          </button>
        ))}
      </div>

      <div className="option-chain-board">
        <div className="option-board-toolbar">
          <div>
            <strong>{symbolBlock.symbol.replace(".NS", "")}</strong>
            <span>{`${symbolBlock.bucket?.toUpperCase() || "F&O"} bucket | Spot ₹${spot.toFixed(2)}`}</span>
          </div>
          <div className="option-board-meta">
            <span>{`Hist Vol ${(symbolBlock.historical_volatility * 100).toFixed(2)}%`}</span>
            <span>{`GARCH IV ${(symbolBlock.garch_volatility * 100).toFixed(2)}%`}</span>
          </div>
        </div>

        <div className="option-board-header">
          <div className="option-side-heading left">CALLS</div>
          <div className="option-side-heading center">STRIKE</div>
          <div className="option-side-heading right">PUTS</div>
        </div>

        <div className="option-chain-table-wrap">
          <table className="option-chain-table">
            <thead>
              <tr>
                <th>Qty</th>
                <th>Price</th>
                <th>IV</th>
                <th>Delta</th>
                <th>Gamma</th>
                <th>Vega</th>
                <th>Strike</th>
                <th>Price</th>
                <th>IV</th>
                <th>Delta</th>
                <th>Gamma</th>
                <th>Vega</th>
                <th>Qty</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ call, put }) => {
                const callGreeks = buildGreeks(call);
                const putGreeks = put ? buildGreeks(put) : null;

                return (
                <tr key={call.label}>
                  <td>
                    <div className="qty-cell">
                      <button type="button" className="qty-button minus">
                        -
                      </button>
                      <span>0</span>
                      <button type="button" className="qty-button plus">
                        +
                      </button>
                    </div>
                  </td>
                  <td>{(call.market_price ?? 0).toFixed(2)}</td>
                  <td>{`${((call.market_implied_volatility ?? symbolBlock.garch_volatility) * 100).toFixed(2)}%`}</td>
                  <td>{callGreeks.delta.toFixed(3)}</td>
                  <td>{callGreeks.gamma.toFixed(4)}</td>
                  <td>{callGreeks.vega.toFixed(3)}</td>
                  <td className="strike-column">{call.strike.toFixed(0)}</td>
                  <td>{(put?.market_price ?? 0).toFixed(2)}</td>
                  <td>{`${(((put?.market_implied_volatility ?? symbolBlock.garch_volatility) || 0) * 100).toFixed(2)}%`}</td>
                  <td>{putGreeks ? putGreeks.delta.toFixed(3) : "-"}</td>
                  <td>{putGreeks ? putGreeks.gamma.toFixed(4) : "-"}</td>
                  <td>{putGreeks ? putGreeks.vega.toFixed(3) : "-"}</td>
                  <td>
                    <div className="qty-cell right">
                      <button type="button" className="qty-button minus">
                        -
                      </button>
                      <span>0</span>
                      <button type="button" className="qty-button plus">
                        +
                      </button>
                    </div>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
