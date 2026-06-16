function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}

export function computePnL(
  greeks,
  spot,
  spotChangePct = 0,
  volChangePct = 0,
  daysElapsed = 0,
  lotSize = 1
) {
  const { delta = 0, gamma = 0, vega = 0, theta = 0 } = greeks || {};
  const deltaS = spot * spotChangePct;
  const deltaPnL = delta * deltaS * lotSize;
  const gammaPnL = 0.5 * gamma * deltaS ** 2 * lotSize;
  const volChangePP = volChangePct * 100;
  const vegaPnL = vega * volChangePP * lotSize;
  const thetaPnL = theta * daysElapsed * lotSize;
  const totalPnL = deltaPnL + gammaPnL + vegaPnL + thetaPnL;
  const denom = Math.abs(totalPnL);

  return {
    deltaPnL: round(deltaPnL),
    gammaPnL: round(gammaPnL),
    vegaPnL: round(vegaPnL),
    thetaPnL: round(thetaPnL),
    totalPnL: round(totalPnL),
    breakdown: {
      deltaContrib: totalPnL !== 0 ? round((deltaPnL / denom) * 100, 1) : 0,
      gammaContrib: totalPnL !== 0 ? round((gammaPnL / denom) * 100, 1) : 0,
      vegaContrib: totalPnL !== 0 ? round((vegaPnL / denom) * 100, 1) : 0,
      thetaContrib: totalPnL !== 0 ? round((thetaPnL / denom) * 100, 1) : 0,
    },
  };
}

export function applyHedge(baseGreeks, hedge) {
  const { quantity = 0, delta = 0, gamma = 0, vega = 0, theta = 0 } = hedge || {};

  return {
    delta: round((baseGreeks?.delta || 0) + quantity * delta, 4),
    gamma: round((baseGreeks?.gamma || 0) + quantity * gamma, 6),
    vega: round((baseGreeks?.vega || 0) + quantity * vega, 4),
    theta: round((baseGreeks?.theta || 0) + quantity * theta, 4),
    rho: baseGreeks?.rho || 0,
  };
}

export function applyDeltaHedge(baseGreeks, sharesToHedge) {
  return applyHedge(baseGreeks, {
    type: "shares",
    quantity: sharesToHedge,
    delta: 1,
    gamma: 0,
    vega: 0,
    theta: 0,
  });
}

export function applyOptionHedge(baseGreeks, lots, optionGreeks) {
  return applyHedge(baseGreeks, {
    type: "option",
    quantity: lots,
    ...(optionGreeks || {}),
  });
}

export function generateScenarioMatrix(baseGreeks, hedgedGreeks, spot, lotSize = 1) {
  const scenarios = [
    { id: "spot_up_1", label: "Spot +1%", spotChangePct: 0.01, volChangePct: 0, daysElapsed: 0, category: "price", icon: "↑" },
    { id: "spot_dn_1", label: "Spot −1%", spotChangePct: -0.01, volChangePct: 0, daysElapsed: 0, category: "price", icon: "↓" },
    { id: "spot_up_2", label: "Spot +2%", spotChangePct: 0.02, volChangePct: 0, daysElapsed: 0, category: "price", icon: "↑↑" },
    { id: "spot_dn_2", label: "Spot −2%", spotChangePct: -0.02, volChangePct: 0, daysElapsed: 0, category: "price", icon: "↓↓" },
    { id: "spot_up_5", label: "Spot +5%", spotChangePct: 0.05, volChangePct: 0, daysElapsed: 0, category: "price", icon: "↑↑↑" },
    { id: "spot_dn_5", label: "Spot −5%", spotChangePct: -0.05, volChangePct: 0, daysElapsed: 0, category: "price", icon: "↓↓↓" },
    { id: "vol_up_20", label: "IV +20%", spotChangePct: 0, volChangePct: 0.2, daysElapsed: 0, category: "volatility", icon: "📈" },
    { id: "vol_dn_20", label: "IV −20%", spotChangePct: 0, volChangePct: -0.2, daysElapsed: 0, category: "volatility", icon: "📉" },
    { id: "vol_up_50", label: "IV +50% (stress)", spotChangePct: 0, volChangePct: 0.5, daysElapsed: 0, category: "volatility", icon: "🔥" },
    { id: "crash", label: "Market Crash (−5% + IV+50%)", spotChangePct: -0.05, volChangePct: 0.5, daysElapsed: 0, category: "stress", icon: "💥" },
    { id: "rally", label: "Sharp Rally (+5% + IV−20%)", spotChangePct: 0.05, volChangePct: -0.2, daysElapsed: 0, category: "stress", icon: "🚀" },
    { id: "theta_7d", label: "7 Days Pass (no move)", spotChangePct: 0, volChangePct: 0, daysElapsed: 7, category: "time", icon: "⏱" },
    { id: "theta_15d", label: "15 Days Pass (no move)", spotChangePct: 0, volChangePct: 0, daysElapsed: 15, category: "time", icon: "⏱⏱" },
  ];

  return scenarios.map((scenario) => {
    const before = computePnL(baseGreeks, spot, scenario.spotChangePct, scenario.volChangePct, scenario.daysElapsed, lotSize);
    const after = computePnL(hedgedGreeks, spot, scenario.spotChangePct, scenario.volChangePct, scenario.daysElapsed, lotSize);
    const improvement = after.totalPnL - before.totalPnL;
    const improvementPct = before.totalPnL !== 0 ? round((improvement / Math.abs(before.totalPnL)) * 100, 1) : 0;
    const hedgeHelped = after.totalPnL > before.totalPnL;
    const hedgeNeutral = Math.abs(improvement) < 0.5;

    return {
      ...scenario,
      before: {
        totalPnL: before.totalPnL,
        deltaPnL: before.deltaPnL,
        gammaPnL: before.gammaPnL,
        vegaPnL: before.vegaPnL,
        thetaPnL: before.thetaPnL,
        breakdown: before.breakdown,
      },
      after: {
        totalPnL: after.totalPnL,
        deltaPnL: after.deltaPnL,
        gammaPnL: after.gammaPnL,
        vegaPnL: after.vegaPnL,
        thetaPnL: after.thetaPnL,
        breakdown: after.breakdown,
      },
      improvement: round(improvement),
      improvementPct,
      hedgeHelped,
      hedgeNeutral,
      signal: hedgeNeutral ? "neutral" : hedgeHelped ? "improved" : "worsened",
    };
  });
}

export function generatePnLCurve(baseGreeks, hedgedGreeks, spot, lotSize = 1, volChangePct = 0) {
  const steps = [];

  for (let pct = -0.15; pct <= 0.151; pct += 0.005) {
    const spotPrice = round(spot * (1 + pct));
    const beforeResult = computePnL(baseGreeks, spot, pct, volChangePct, 0, lotSize);
    const afterResult = computePnL(hedgedGreeks, spot, pct, volChangePct, 0, lotSize);

    steps.push({
      spotPrice,
      spotChangePct: round(pct * 100, 1),
      beforePnL: beforeResult.totalPnL,
      afterPnL: afterResult.totalPnL,
      isBreakeven: Math.abs(beforeResult.totalPnL) < 5,
    });
  }

  return {
    curveData: steps,
    maxLossBefore: Math.min(...steps.map((step) => step.beforePnL)),
    maxGainBefore: Math.max(...steps.map((step) => step.beforePnL)),
    maxLossAfter: Math.min(...steps.map((step) => step.afterPnL)),
    maxGainAfter: Math.max(...steps.map((step) => step.afterPnL)),
    currentSpot: spot,
  };
}

export function computeBeforeAfterHedge(portfolioGreeks, hedgeConfig, spot, lotSize = 1) {
  let hedgedGreeks;

  if (!hedgeConfig || hedgeConfig.type === "none") {
    hedgedGreeks = { ...portfolioGreeks };
  } else if (hedgeConfig.type === "shares") {
    hedgedGreeks = applyDeltaHedge(portfolioGreeks, hedgeConfig.sharesToHedge);
  } else if (hedgeConfig.type === "option") {
    hedgedGreeks = applyOptionHedge(portfolioGreeks, hedgeConfig.lots, hedgeConfig.optionGreeks);
  } else {
    hedgedGreeks = { ...portfolioGreeks };
  }

  const scenarioMatrix = generateScenarioMatrix(portfolioGreeks, hedgedGreeks, spot, lotSize);
  const pnlCurve = generatePnLCurve(portfolioGreeks, hedgedGreeks, spot, lotSize);

  const greekComparison = {
    before: {
      delta: portfolioGreeks.delta,
      gamma: portfolioGreeks.gamma,
      vega: portfolioGreeks.vega,
      theta: portfolioGreeks.theta,
    },
    after: {
      delta: hedgedGreeks.delta,
      gamma: hedgedGreeks.gamma,
      vega: hedgedGreeks.vega,
      theta: hedgedGreeks.theta,
    },
    changes: {
      delta: round(hedgedGreeks.delta - portfolioGreeks.delta, 4),
      gamma: round(hedgedGreeks.gamma - portfolioGreeks.gamma, 6),
      vega: round(hedgedGreeks.vega - portfolioGreeks.vega, 4),
      theta: round(hedgedGreeks.theta - portfolioGreeks.theta, 4),
    },
    reductionPct: {
      delta: portfolioGreeks.delta !== 0
        ? round((1 - Math.abs(hedgedGreeks.delta) / Math.abs(portfolioGreeks.delta)) * 100, 1)
        : 100,
    },
  };

  const hedgeCost = hedgeConfig?.type === "shares"
    ? Math.abs(hedgeConfig.sharesToHedge) * spot
    : hedgeConfig?.type === "option"
      ? Math.abs(hedgeConfig.lots) * (hedgeConfig.optionPremium || 0)
      : 0;

  return {
    baseGreeks: portfolioGreeks,
    hedgedGreeks,
    hedgeConfig,
    hedgeCost: round(hedgeCost),
    scenarioMatrix,
    pnlCurve,
    greekComparison,
    priceScenarios: scenarioMatrix.filter((scenario) => scenario.category === "price"),
    volScenarios: scenarioMatrix.filter((scenario) => scenario.category === "volatility"),
    stressScenarios: scenarioMatrix.filter((scenario) => scenario.category === "stress"),
    timeScenarios: scenarioMatrix.filter((scenario) => scenario.category === "time"),
  };
}
