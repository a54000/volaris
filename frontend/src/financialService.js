const OPTION_TYPE = {
  CALL: "call",
  PUT: "put",
};

const STRATEGY_TYPE = {
  STRADDLE: "Straddle",
  STRANGLE: "Strangle",
  BUTTERFLY: "Butterfly",
  IRON_CONDOR: "Iron Condor",
};

const PRICING_MODEL = {
  GARCH_TA: "garch_ta",
  HIST_VOL: "hist_vol",
  MARKET: "market",
};

const BACKEND_API_BASE =
  import.meta.env.VITE_MARKET_API_BASE_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  "";

const DEFAULT_MARKET_PROFILES = {
  BAJFINANCE: { liquidity: "HIGH", turnoverCr: 94.2, beta: 1.18, marketCap: "2.87L Cr", amihud: 0.0012 },
  RELIANCE: { liquidity: "HIGH", turnoverCr: 102.1, beta: 0.89, marketCap: "19.2L Cr", amihud: 0.0008 },
  TCS: { liquidity: "HIGH", turnoverCr: 88.4, beta: 0.72, marketCap: "12.8L Cr", amihud: 0.0006 },
  INFY: { liquidity: "HIGH", turnoverCr: 79.3, beta: 0.81, marketCap: "6.4L Cr", amihud: 0.0009 },
  HDFCBANK: { liquidity: "HIGH", turnoverCr: 115.6, beta: 0.94, marketCap: "14.2L Cr", amihud: 0.0007 },
  ICICIBANK: { liquidity: "HIGH", turnoverCr: 98.7, beta: 1.02, marketCap: "8.8L Cr", amihud: 0.0011 },
  KOTAKBANK: { liquidity: "HIGH", turnoverCr: 72.1, beta: 0.88, marketCap: "4.2L Cr", amihud: 0.0013 },
  SBIN: { liquidity: "HIGH", turnoverCr: 87.9, beta: 1.21, marketCap: "7.6L Cr", amihud: 0.0014 },
  ADANIENT: { liquidity: "MED", turnoverCr: 38.4, beta: 1.52, marketCap: "11.1L Cr", amihud: 0.0048 },
  TATAMOTORS: { liquidity: "MED", turnoverCr: 52.8, beta: 1.44, marketCap: "2.6L Cr", amihud: 0.0031 },
  WIPRO: { liquidity: "MED", turnoverCr: 44.1, beta: 0.79, marketCap: "2.7L Cr", amihud: 0.0022 },
  MARUTI: { liquidity: "MED", turnoverCr: 35.2, beta: 0.85, marketCap: "3.9L Cr", amihud: 0.0025 },
  SUNPHARMA: { liquidity: "MED", turnoverCr: 48.7, beta: 0.68, marketCap: "4.3L Cr", amihud: 0.0019 },
  POWERGRID: { liquidity: "LOW", turnoverCr: 21.4, beta: 0.58, marketCap: "2.2L Cr", amihud: 0.0081 },
  ONGC: { liquidity: "LOW", turnoverCr: 24.8, beta: 1.07, marketCap: "3.4L Cr", amihud: 0.0072 },
  COALINDIA: { liquidity: "LOW", turnoverCr: 18.9, beta: 0.82, marketCap: "2.7L Cr", amihud: 0.0064 },
  ITC: { liquidity: "MED", turnoverCr: 42.3, beta: 0.64, marketCap: "5.3L Cr", amihud: 0.0028 },
  LT: { liquidity: "MED", turnoverCr: 41.8, beta: 0.91, marketCap: "5.4L Cr", amihud: 0.0021 },
  ULTRACEMCO: { liquidity: "LOW", turnoverCr: 16.4, beta: 0.87, marketCap: "3.2L Cr", amihud: 0.0067 },
  NESTLEIND: { liquidity: "LOW", turnoverCr: 12.1, beta: 0.51, marketCap: "2.2L Cr", amihud: 0.0092 },
};

const DEFAULT_LIQUID_BENCHMARK = "BAJFINANCE";
const DEFAULT_ILLIQUID_BENCHMARK = "NESTLEIND";

function mulberry32(a) {
  return function random() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getNormal(rand1, rand2) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand1();
  while (v === 0) v = rand2();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function erf(x) {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x >= 0 ? 1 : -1;
  const value = Math.abs(x);
  const t = 1.0 / (1.0 + p * value);
  const y = 1.0 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-value * value));
  return sign * y;
}

function normCdf(x) {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

function normPdf(x) {
  return (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x);
}

function bsm(S, K, T, sigma, r, optionType) {
  if (T <= 0 || sigma <= 0) {
    const fallbackPrice = optionType === OPTION_TYPE.CALL ? Math.max(0, S - K) : Math.max(0, K - S);
    return {
      price: fallbackPrice,
      greeks: {
        delta: optionType === OPTION_TYPE.CALL ? (S > K ? 1 : 0) : S < K ? -1 : 0,
        gamma: 0,
        vega: 0,
        theta: 0,
        rho: 0,
      },
      d1: Infinity,
      d2: Infinity,
    };
  }

  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const N_d1 = normCdf(d1);
  const N_d2 = normCdf(d2);
  const N_minus_d1 = normCdf(-d1);
  const N_minus_d2 = normCdf(-d2);
  const N_prime_d1 = normPdf(d1);

  let price;
  let delta;
  let theta;
  let rho;

  if (optionType === OPTION_TYPE.CALL) {
    price = S * N_d1 - K * Math.exp(-r * T) * N_d2;
    delta = N_d1;
    theta = -(S * N_prime_d1 * sigma) / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * N_d2;
    rho = K * T * Math.exp(-r * T) * N_d2;
  } else {
    price = K * Math.exp(-r * T) * N_minus_d2 - S * N_minus_d1;
    delta = N_d1 - 1;
    theta = -(S * N_prime_d1 * sigma) / (2 * Math.sqrt(T)) + r * K * Math.exp(-r * T) * N_minus_d2;
    rho = -K * T * Math.exp(-r * T) * N_minus_d2;
  }

  const gamma = N_prime_d1 / (S * sigma * Math.sqrt(T));
  const vega = (S * N_prime_d1 * Math.sqrt(T)) / 100;

  return {
    price,
    greeks: {
      delta,
      gamma,
      vega,
      theta: theta / 365,
      rho: rho / 100,
    },
    d1,
    d2,
  };
}

function solveImpliedVolatility(price, S, K, T, r, optionType) {
  if (!Number.isFinite(price) || price <= 0 || T <= 0 || S <= 0 || K <= 0) return null;
  const intrinsic = optionType === OPTION_TYPE.CALL ? Math.max(0, S - K * Math.exp(-r * T)) : Math.max(0, K * Math.exp(-r * T) - S);
  if (price < intrinsic) return null;

  let low = 0.01;
  let high = 3.0;
  let mid = 0.2;

  for (let index = 0; index < 80; index += 1) {
    mid = (low + high) / 2;
    const modelPrice = bsm(S, K, T, mid, r, optionType).price;
    if (Math.abs(modelPrice - price) < 1e-5) return mid;
    if (modelPrice > price) high = mid;
    else low = mid;
  }

  return mid;
}

function calculateSummaryStatistics(prices) {
  const returns = prices.slice(1).map((price, index) => Math.log(price / prices[index]));
  const n = returns.length;
  if (n < 2) {
    return {
      dailyLogReturns: [],
      annualizedVolatility: 0,
      skewness: 0,
      kurtosis: 0,
      downsideVolatility: 0,
      volOfVol: 0,
      rollingVolatility20d: [],
      rollingIv20d: [],
    };
  }

  const mean = returns.reduce((sum, value) => sum + value, 0) / n;
  const stdDev = Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1));
  const m3 = returns.reduce((sum, value) => sum + (value - mean) ** 3, 0) / n;
  const m4 = returns.reduce((sum, value) => sum + (value - mean) ** 4, 0) / n;

  const negativeReturns = returns.filter((value) => value < 0);
  const downsideStdDev =
    negativeReturns.length > 1
      ? Math.sqrt(negativeReturns.reduce((sum, value) => sum + value ** 2, 0) / (negativeReturns.length - 1))
      : 0;
  const rollingWindowStats = returns
    .map((_, index) => {
      if (index < 19) return null;
      const window = returns.slice(index - 19, index + 1);
      const windowMean = window.reduce((sum, value) => sum + value, 0) / window.length;
      const windowStd = Math.sqrt(window.reduce((sum, value) => sum + (value - windowMean) ** 2, 0) / (window.length - 1));
      const windowM3 = window.reduce((sum, value) => sum + (value - windowMean) ** 3, 0) / window.length;
      const windowM4 = window.reduce((sum, value) => sum + (value - windowMean) ** 4, 0) / window.length;
      const windowAnnualizedVolatility = windowStd * Math.sqrt(252);
      const windowSkewness = windowStd ? windowM3 / windowStd ** 3 : 0;
      const windowKurtosis = windowStd ? windowM4 / windowStd ** 4 - 3 : 0;
      return {
        annualizedVolatility: windowAnnualizedVolatility,
        skewness: windowSkewness,
        kurtosis: windowKurtosis,
      };
    })
    .filter((value) => value != null);
  const rollingVolatility20d = rollingWindowStats.map((value) => value.annualizedVolatility);
  const rollingIv20d = rollingWindowStats.map((value) => computeTransformAugmentedVolatility(value, value.annualizedVolatility || 0.22));
  const rollingVolMean =
    rollingVolatility20d.length > 0 ? rollingVolatility20d.reduce((sum, value) => sum + value, 0) / rollingVolatility20d.length : 0;
  const volOfVol =
    rollingVolatility20d.length > 1
      ? Math.sqrt(
          rollingVolatility20d.reduce((sum, value) => sum + (value - rollingVolMean) ** 2, 0) / (rollingVolatility20d.length - 1),
        )
      : 0;

  return {
    dailyLogReturns: returns,
    annualizedVolatility: stdDev * Math.sqrt(252),
    skewness: stdDev ? m3 / stdDev ** 3 : 0,
    kurtosis: stdDev ? m4 / stdDev ** 4 - 3 : 0,
    downsideVolatility: downsideStdDev * Math.sqrt(252),
    volOfVol,
    rollingVolatility20d,
    rollingIv20d,
  };
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pearsonCorrelation(xs, ys) {
  if (xs.length !== ys.length || xs.length < 2) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const dx = xs[index] - mx;
    const dy = ys[index] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx <= 0 || vy <= 0) return 0;
  return cov / Math.sqrt(vx * vy);
}

function rankValues(values) {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = Array(values.length).fill(0);
  let cursor = 0;
  while (cursor < sorted.length) {
    let end = cursor;
    while (end + 1 < sorted.length && sorted[end + 1].value === sorted[cursor].value) end += 1;
    const avgRank = (cursor + end + 2) / 2;
    for (let index = cursor; index <= end; index += 1) ranks[sorted[index].index] = avgRank;
    cursor = end + 1;
  }
  return ranks;
}

function spearmanCorrelation(xs, ys) {
  if (xs.length !== ys.length || xs.length < 2) return 0;
  return pearsonCorrelation(rankValues(xs), rankValues(ys));
}

function linearRegression(xs, ys) {
  if (xs.length !== ys.length || xs.length < 2) {
    return { slope: 0, intercept: 0, r2: 0 };
  }
  const mx = mean(xs);
  const my = mean(ys);
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < xs.length; index += 1) {
    numerator += (xs[index] - mx) * (ys[index] - my);
    denominator += (xs[index] - mx) ** 2;
  }
  const slope = denominator ? numerator / denominator : 0;
  const intercept = my - slope * mx;
  const predicted = xs.map((x) => intercept + slope * x);
  const ssRes = ys.reduce((sum, y, index) => sum + (y - predicted[index]) ** 2, 0);
  const ssTot = ys.reduce((sum, y) => sum + (y - my) ** 2, 0);
  return {
    slope,
    intercept,
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 0,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function inferStrikeStep(currentPrice) {
  if (currentPrice < 100) return 2.5;
  if (currentPrice < 250) return 5;
  if (currentPrice < 1000) return 10;
  if (currentPrice < 2500) return 20;
  if (currentPrice < 10000) return 50;
  return 100;
}

function snapToStrike(price, step) {
  return Math.round(price / step) * step;
}

function buildTargetStrikes(currentPrice, strikeStep, otmCount = 5) {
  const atmStrike = snapToStrike(currentPrice, strikeStep);
  return Array.from({ length: otmCount * 2 + 1 }, (_, index) => atmStrike + (index - otmCount) * strikeStep)
    .filter((strike) => strike > 0);
}

function computeTransformAugmentedVolatility(summaryStats, fallbackVol = 0.22) {
  const baseVol = summaryStats.annualizedVolatility || fallbackVol;
  const skew = Number.isFinite(summaryStats.skewness) ? summaryStats.skewness : 0;
  const kurtosis = Number.isFinite(summaryStats.kurtosis) ? summaryStats.kurtosis : 0;
  const transformFactor = Math.exp(0.08 * skew + 0.04 * kurtosis);
  return clamp(baseVol * transformFactor, 0.08, 1.25);
}

function computeStrikeAdjustedGarchTaIv(currentPrice, strike, baseGarchVolatility) {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return clamp(baseGarchVolatility || 0.22, 0.08, 1.25);
  const moneyness = Math.log(strike / currentPrice);
  const adjusted = (baseGarchVolatility || 0.22) * (1 + 0.2 * moneyness ** 2 - 0.1 * moneyness);
  return clamp(adjusted, 0.08, 1.25);
}

function computeRollingVolatilitySignals(prices, fallbackVol = 0.22, windowSize = 20) {
  if (prices.length <= windowSize) {
    return {
      rollingHv20d: 0,
      rollingGarchIv20d: fallbackVol,
      ivHvSpread: fallbackVol,
    };
  }

  const windowPrices = prices.slice(-(windowSize + 1));
  const windowStats = calculateSummaryStatistics(windowPrices);
  const rollingHv20d = windowStats.annualizedVolatility || 0;
  const rollingGarchIv20d = computeTransformAugmentedVolatility(windowStats, fallbackVol);

  return {
    rollingHv20d,
    rollingGarchIv20d,
    ivHvSpread: rollingGarchIv20d - rollingHv20d,
  };
}

function rollingCorrelation(xs, ys, windowSize = 20) {
  const results = [];
  for (let index = windowSize - 1; index < xs.length; index += 1) {
    const windowX = xs.slice(index - windowSize + 1, index + 1);
    const windowY = ys.slice(index - windowSize + 1, index + 1);
    results.push(pearsonCorrelation(windowX, windowY));
  }
  return results;
}

function quantile(values, probability) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function pickLiquidityPair(ticker) {
  const normalized = ticker.replace(".NS", "").toUpperCase();
  const currentProfile = DEFAULT_MARKET_PROFILES[normalized];
  const liquidTicker =
    currentProfile?.liquidity === "HIGH"
      ? normalized
      : DEFAULT_LIQUID_BENCHMARK;
  const illiquidTicker =
    currentProfile?.liquidity === "LOW"
      ? normalized
      : DEFAULT_ILLIQUID_BENCHMARK;
  if (liquidTicker === illiquidTicker) {
    return { liquidTicker: DEFAULT_LIQUID_BENCHMARK, illiquidTicker: DEFAULT_ILLIQUID_BENCHMARK };
  }
  return { liquidTicker, illiquidTicker };
}

function buildLiquidityAnalysis(ticker, stock, marketProfile) {
  const rows = stock.historicalData || [];
  if (rows.length < 25) {
    return {
      ticker,
      label: marketProfile?.liquidity === "HIGH" ? "Liquid Stock" : "Illiquid Stock",
      liquidityTier: marketProfile?.liquidity || "MED",
      points: [],
      rollingCorrelation: [],
      summary: { pearson: 0, spearman: 0, r2: 0, avgLow: 0, avgHigh: 0, ratio: 0, avgTurnoverRatio: 0 },
      regression: { slope: 0, intercept: 0, r2: 0 },
      regimeAverages: [
        { regime: "Low Vol", amihud: 0 },
        { regime: "Normal Vol", amihud: 0 },
        { regime: "High Vol", amihud: 0 },
      ],
    };
  }

  const prices = rows.map((row) => row.price ?? row.close).filter((value) => Number.isFinite(value) && value > 0);
  const returns = prices.slice(1).map((price, index) => Math.log(price / prices[index]));
  const dailyAbsReturns = returns.map((value) => Math.abs(value));
  const rollingVol = returns.map((_, index) => {
    if (index < 19) return null;
    const window = returns.slice(index - 19, index + 1);
    return Math.sqrt(window.reduce((sum, value) => sum + (value - mean(window)) ** 2, 0) / (window.length - 1));
  });

  const baseTurnoverRatio = clamp((marketProfile?.turnoverCr || 40) / 10000, 0.001, 0.04);
  const points = rows.slice(1).map((row, index) => {
    const price = row.price ?? row.close ?? prices[index + 1];
    const volume = row.volume ?? Math.max(1, Math.round((marketProfile?.turnoverCr || 40) * 100000));
    const turnoverValue = Math.max(volume * price, 1);
    const amihud = (dailyAbsReturns[index] / turnoverValue) * 1_000_000;
    const turnoverRatio = baseTurnoverRatio * (0.85 + Math.min(volume / Math.max(1, mean(rows.map((item) => item.volume || volume))), 1.25) * 0.3);
    return {
      date: row.date,
      absReturn: dailyAbsReturns[index],
      realizedVol: dailyAbsReturns[index],
      rollingVolatility: rollingVol[index],
      amihud,
      turnoverRatio,
      volume,
      price,
    };
  });

  const validVols = points.map((point) => point.rollingVolatility).filter((value) => value != null);
  const lowCut = quantile(validVols, 0.25);
  const highCut = quantile(validVols, 0.75);
  points.forEach((point) => {
    if (point.rollingVolatility == null) {
      point.regime = "Normal Vol";
    } else if (point.rollingVolatility < lowCut) {
      point.regime = "Low Vol";
    } else if (point.rollingVolatility > highCut) {
      point.regime = "High Vol";
    } else {
      point.regime = "Normal Vol";
    }
  });

  const xs = points.map((point) => point.amihud);
  const ys = points.map((point) => point.realizedVol);
  const regression = linearRegression(xs, ys);
  const rollingCorr = rollingCorrelation(xs, ys, 20);
  const regimeAverages = ["Low Vol", "Normal Vol", "High Vol"].map((regime) => {
    const regimePoints = points.filter((point) => point.regime === regime);
    return {
      regime,
      amihud: mean(regimePoints.map((point) => point.amihud)),
    };
  });
  const avgLow = regimeAverages.find((item) => item.regime === "Low Vol")?.amihud || 0;
  const avgHigh = regimeAverages.find((item) => item.regime === "High Vol")?.amihud || 0;

  return {
    ticker,
    label: marketProfile?.liquidity === "HIGH" ? "Liquid Stock" : "Illiquid Stock",
    liquidityTier: marketProfile?.liquidity || "MED",
    points,
    rollingCorrelation: rollingCorr.map((value, index) => ({
      date: points[index + 19]?.date?.slice(5) || `${index + 1}`,
      corr: value,
    })),
    summary: {
      pearson: pearsonCorrelation(xs, ys),
      spearman: spearmanCorrelation(xs, ys),
      r2: regression.r2,
      avgLow,
      avgHigh,
      ratio: avgLow > 0 ? avgHigh / avgLow : 0,
      avgTurnoverRatio: mean(points.map((point) => point.turnoverRatio)),
    },
    regression,
    regimeAverages,
  };
}

function simulateStockDataUsingGBM(ticker, startDateStr, endDateStr) {
  const seed = ticker.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0) + new Date(startDateStr).getTime();
  const rand1 = mulberry32(seed);
  const rand2 = mulberry32(seed + 1);
  const basePrice = 200 + (seed % 300);
  const mu = 0.15 + (seed % 10) / 100;
  const sigma = 0.2 + (seed % 20) / 100;
  const dt = 1 / 252;
  const historicalData = [];
  let currentPrice = basePrice;
  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    if (currentDate.getDay() !== 0 && currentDate.getDay() !== 6) {
      historicalData.push({
        date: currentDate.toISOString().split("T")[0],
        price: currentPrice,
      });
      const z = getNormal(rand1, rand2);
      currentPrice *= Math.exp((mu - 0.5 * sigma * sigma) * dt + sigma * Math.sqrt(dt) * z);
      currentPrice = Math.max(10, currentPrice);
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return {
    ticker,
    lastPrice: historicalData.at(-1)?.price ?? basePrice,
    historicalData: historicalData.length ? historicalData : [{ date: endDateStr, price: basePrice }],
    source: "simulation",
  };
}

async function getStockData(ticker, startDateStr, endDateStr) {
  const backendUrl = `${BACKEND_API_BASE}/api/market/stock?ticker=${encodeURIComponent(ticker)}&start_date=${encodeURIComponent(startDateStr)}&end_date=${encodeURIComponent(endDateStr)}`;

  try {
    const response = await fetch(backendUrl);
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data?.historical_data) && data.historical_data.length) {
        return {
          ticker: data.ticker,
          lastPrice: data.last_price,
          historicalData: data.historical_data.map((row) => ({
            ...row,
            price: row.price ?? row.close,
          })),
          liveQuote: data.live_quote
            ? {
                open: data.live_quote.open,
                high: data.live_quote.high,
                low: data.live_quote.low,
                close: data.live_quote.close,
                previousClose: data.live_quote.previous_close ?? data.live_quote.previousClose ?? data.last_price,
                volume: data.live_quote.volume,
              }
            : null,
          source: data.source || "backend_live",
          provider: data.provider || "backend",
        };
      }
    }
  } catch (error) {
    console.warn(`Backend stock fetch failed for ${ticker}`, error);
  }

  console.warn(`Falling back to simulated stock data for ${ticker} because backend market data was unavailable.`);
  return simulateStockDataUsingGBM(ticker, startDateStr, endDateStr);
}

function generateLiveStockData(ticker, lastPrice) {
  const seed = ticker.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0) + new Date().getDate();
  const random = mulberry32(seed);
  const volatility = 0.025;
  const change = lastPrice * volatility * (random() - 0.5);
  const open = lastPrice - change + (random() - 0.5) * lastPrice * 0.01;
  const high = Math.max(open, lastPrice) + random() * lastPrice * 0.015;
  const low = Math.min(open, lastPrice) - random() * lastPrice * 0.015;
  const previousClose = lastPrice / (1 + change / lastPrice);
  const volume = Math.floor(100000 + random() * 5000000);

  return {
    open,
    high,
    low,
    close: lastPrice,
    previousClose,
    volume,
  };
}

function simulateOptionChain(currentPrice, histVolatility, riskFreeRate, existingStrikes = [], garchVolatility = histVolatility) {
  const chain = {};
  const maturities = [30, 60];
  const strikeStep = inferStrikeStep(currentPrice);
  const generatedStrikes = buildTargetStrikes(currentPrice, strikeStep, 5);
  const strikes = [...new Set([...generatedStrikes, ...existingStrikes])].sort((a, b) => a - b);
  const r = riskFreeRate / 100;

  maturities.forEach((maturity) => {
    chain[maturity] = [];
    strikes.forEach((strike) => {
      const iv = computeStrikeAdjustedGarchTaIv(currentPrice, strike, garchVolatility);

      [OPTION_TYPE.CALL, OPTION_TYPE.PUT].forEach((type) => {
        const T = maturity / 252;
        const ivResult = bsm(currentPrice, strike, T, iv, r, type);
        const histResult = bsm(currentPrice, strike, T, histVolatility, r, type);
        chain[maturity].push({
          id: `${strike}-${maturity}-${type}`,
          strike,
          maturity,
          type,
          marketPrice: null,
          bid: ivResult.price * 0.99,
          ask: ivResult.price * 1.01,
          openInterest: Math.round(1500 + Math.abs(strike - currentPrice) * 8),
          volume: Math.round(500 + Math.abs(currentPrice - strike) * 3),
          bsmPrice: ivResult.price,
          histVolatility,
          iv,
          greeks: ivResult.greeks,
          marketIv: null,
          greeksMarket: null,
          d1: ivResult.d1,
          d2: ivResult.d2,
          bsmPriceHistVol: histResult.price,
          greeksHistVol: histResult.greeks,
          source: "simulation",
        });
      });
    });
  });

  return chain;
}

async function getOptionChain(ticker, currentPrice, histVolatility, riskFreeRate, garchVolatility = histVolatility) {
  const backendUrl =
    `${BACKEND_API_BASE}/api/market/options?ticker=${encodeURIComponent(ticker)}` +
    `&current_price=${encodeURIComponent(currentPrice)}` +
    `&hist_volatility=${encodeURIComponent(histVolatility)}` +
    `&risk_free_rate=${encodeURIComponent(riskFreeRate)}`;

  try {
    const response = await fetch(backendUrl);
    if (response.ok) {
      const data = await response.json();
      if (data?.chain && Object.keys(data.chain).length) {
        const normalized = {};
        Object.entries(data.chain).forEach(([maturityKey, rows]) => {
          normalized[maturityKey] = rows.map((option) => {
            const T = Number(maturityKey) / 365;
            const iv = option.iv || garchVolatility;
            const garchTaIv = computeStrikeAdjustedGarchTaIv(currentPrice, option.strike, iv || garchVolatility);
            const ivResult = bsm(currentPrice, option.strike, T, iv, riskFreeRate / 100, option.type);
            const histResult = bsm(currentPrice, option.strike, T, histVolatility, riskFreeRate / 100, option.type);
            const marketIv = option.market_price != null
              ? solveImpliedVolatility(option.market_price, currentPrice, option.strike, T, riskFreeRate / 100, option.type)
              : null;
            const marketResult = marketIv ? bsm(currentPrice, option.strike, T, marketIv, riskFreeRate / 100, option.type) : null;
            const garchResult = bsm(currentPrice, option.strike, T, garchTaIv, riskFreeRate / 100, option.type);
            return {
              id: option.id,
              strike: option.strike,
              maturity: Number(maturityKey),
              type: option.type,
              marketPrice: option.market_price,
              bid: option.bid,
              ask: option.ask,
              openInterest: option.open_interest,
              volume: option.volume,
              bsmPrice: garchResult.price,
              histVolatility,
              iv: garchTaIv,
              greeks: garchResult.greeks,
              marketIv,
              greeksMarket: marketResult?.greeks || null,
              d1: garchResult.d1,
              d2: garchResult.d2,
              bsmPriceHistVol: histResult.price,
              greeksHistVol: histResult.greeks,
              source: option.source || data.source || "backend_live",
              provider: option.provider || data.provider || "backend",
              modelPriceLabel: "BSM (GARCH-TA IV)",
            };
          });
        });
        return normalized;
      }
    }
  } catch (error) {
    console.warn(`Backend option fetch failed for ${ticker}`, error);
  }

  console.warn(`Falling back to simulated option chain for ${ticker} because backend market data was unavailable.`);
  return simulateOptionChain(currentPrice, histVolatility, riskFreeRate, [], garchVolatility);
}

function getOptionPriceByModel(option, pricingModel = PRICING_MODEL.GARCH_TA) {
  if (pricingModel === PRICING_MODEL.HIST_VOL) {
    return option.bsmPriceHistVol ?? option.bsmPrice ?? 0;
  }
  if (pricingModel === PRICING_MODEL.MARKET) {
    return option.marketPrice ?? option.bsmPrice ?? 0;
  }
  return option.bsmPrice ?? 0;
}

function getOptionGreeksByModel(option, pricingModel = PRICING_MODEL.GARCH_TA) {
  if (pricingModel === PRICING_MODEL.HIST_VOL) {
    return option.greeksHistVol || option.greeks;
  }
  if (pricingModel === PRICING_MODEL.MARKET) {
    return option.greeksMarket || option.greeks;
  }
  return option.greeks;
}

function calculatePortfolioGreeks(portfolio, pricingModel = PRICING_MODEL.GARCH_TA) {
  return portfolio.reduce(
    (accumulator, position) => {
      const greeks = getOptionGreeksByModel(position.option, pricingModel);
      accumulator.delta += position.quantity * greeks.delta;
      accumulator.gamma += position.quantity * greeks.gamma;
      accumulator.vega += position.quantity * greeks.vega;
      accumulator.theta += position.quantity * greeks.theta;
      accumulator.rho += position.quantity * greeks.rho;
      return accumulator;
    },
    { delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 },
  );
}

function calculatePortfolioValue(portfolio, lotSize, pricingModel = PRICING_MODEL.GARCH_TA) {
  return portfolio.reduce((total, position) => total + position.quantity * getOptionPriceByModel(position.option, pricingModel) * lotSize, 0);
}

function calculatePortfolioGrossCost(portfolio, lotSize, pricingModel = PRICING_MODEL.GARCH_TA) {
  return portfolio.reduce((total, position) => total + Math.abs(position.quantity) * getOptionPriceByModel(position.option, pricingModel) * lotSize, 0);
}

function detectStrategyName(portfolio) {
  if (!portfolio?.length) return "Custom Portfolio";

  const normalized = portfolio
    .map((position) => ({
      quantity: position.quantity,
      type: position.option.type,
      strike: position.option.strike,
      maturity: position.option.maturity,
    }))
    .sort((a, b) => a.strike - b.strike || a.type.localeCompare(b.type));

  const sameExpiry = new Set(normalized.map((position) => position.maturity)).size === 1;

  if (normalized.length === 2 && sameExpiry) {
    const [first, second] = normalized;
    const sameType = first.type === second.type;

    if (!sameType) {
      const bothLong = normalized.every((position) => position.quantity > 0);
      const bothShort = normalized.every((position) => position.quantity < 0);
      const sameStrike = first.strike === second.strike;

      if (bothLong) {
        return sameStrike ? "Long Straddle" : "Long Strangle";
      }
      if (bothShort) {
        return sameStrike ? "Short Straddle" : "Short Strangle";
      }
    }

    if (sameType && first.quantity * second.quantity < 0 && first.strike !== second.strike) {
      const isCallSpread = first.type === OPTION_TYPE.CALL;
      const longLeg = normalized.find((position) => position.quantity > 0);
      const shortLeg = normalized.find((position) => position.quantity < 0);

      if (longLeg && shortLeg) {
        if (isCallSpread) {
          if (longLeg.strike < shortLeg.strike) return "Bull Call Spread";
          if (longLeg.strike > shortLeg.strike) return "Bear Call Spread";
        } else {
          if (longLeg.strike > shortLeg.strike) return "Bear Put Spread";
          if (longLeg.strike < shortLeg.strike) return "Bull Put Spread";
        }
      }
    }
  }

  if (normalized.length === 3 && sameExpiry) {
    const calls = normalized.filter((position) => position.type === OPTION_TYPE.CALL);
    const puts = normalized.filter((position) => position.type === OPTION_TYPE.PUT);

    if (
      calls.length === 3 &&
      calls[0].quantity > 0 &&
      calls[1].quantity < 0 &&
      calls[2].quantity > 0 &&
      Math.abs(calls[1].quantity) === Math.abs(calls[0].quantity) + Math.abs(calls[2].quantity)
    ) {
      return "Call Butterfly";
    }

    if (
      puts.length === 3 &&
      puts[0].quantity > 0 &&
      puts[1].quantity < 0 &&
      puts[2].quantity > 0 &&
      Math.abs(puts[1].quantity) === Math.abs(puts[0].quantity) + Math.abs(puts[2].quantity)
    ) {
      return "Put Butterfly";
    }
  }

  if (normalized.length === 4 && sameExpiry) {
    const calls = normalized.filter((position) => position.type === OPTION_TYPE.CALL);
    const puts = normalized.filter((position) => position.type === OPTION_TYPE.PUT);
    if (calls.length === 2 && puts.length === 2) {
      const hasLongPutWing = puts.some((position) => position.quantity > 0);
      const hasShortPut = puts.some((position) => position.quantity < 0);
      const hasShortCall = calls.some((position) => position.quantity < 0);
      const hasLongCallWing = calls.some((position) => position.quantity > 0);
      if (hasLongPutWing && hasShortPut && hasShortCall && hasLongCallWing) {
        return "Iron Condor";
      }
    }
  }

  return "Custom Portfolio";
}

function buildMaturityAliasMap(optionChain) {
  const maturities = Object.keys(optionChain || {})
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  return maturities.reduce((accumulator, maturity, index) => {
    accumulator[maturity] = index === 0 ? "30D" : index === 1 ? "60D" : `${maturity}D`;
    return accumulator;
  }, {});
}

function formatHedgeContract(option, maturityAliasMap) {
  const typeLabel = option.type === OPTION_TYPE.CALL ? "CE" : "PE";
  const maturityLabel = maturityAliasMap?.[option.maturity] || `${option.maturity}D`;
  return `${option.strike} ${typeLabel} (${maturityLabel})`;
}

function scoreOptionLiquidity(option, spot, greeks) {
  const oi = option.openInterest || 0;
  const volume = option.volume || 0;
  const distancePenalty = Math.abs(option.strike - spot);
  const gammaBoost = Math.abs(greeks.gamma || 0) * 10000;
  const vegaBoost = Math.abs(greeks.vega || 0) * 100;
  return oi * 0.4 + volume * 0.6 + gammaBoost + vegaBoost - distancePenalty;
}

function pickSpecificHedgeOption(optionChain, pricingModel, spot, mode) {
  const maturityAliasMap = buildMaturityAliasMap(optionChain);
  const maturities = Object.keys(optionChain || {}).map(Number).sort((a, b) => a - b);
  const preferredMaturity = mode === "vega" && maturities[1] ? maturities[1] : maturities[0];
  const candidateMaturities = preferredMaturity ? [preferredMaturity, ...maturities.filter((m) => m !== preferredMaturity)] : maturities;

  let best = null;

  candidateMaturities.forEach((maturity) => {
    (optionChain?.[maturity] || []).forEach((option) => {
      const greeks = getOptionGreeksByModel(option, pricingModel);
      const absDelta = Math.abs(greeks.delta || 0);
      const isNearAtm = absDelta >= 0.35 && absDelta <= 0.65;
      if (!isNearAtm) return;

      const score = scoreOptionLiquidity(option, spot, greeks);
      const metric = mode === "gamma" ? Math.abs(greeks.gamma || 0) : Math.abs(greeks.vega || 0);
      const composite = score + metric * (mode === "gamma" ? 20000 : 400);

      if (!best || composite > best.composite) {
        best = { option, composite };
      }
    });
  });

  if (!best) return null;
  return {
    option: best.option,
    label: formatHedgeContract(best.option, maturityAliasMap),
  };
}

function generateHedgingRecommendations(portfolioGreeks) {
  const {
    delta = 0,
    gamma = 0,
    vega = 0,
    theta = 0,
    rho = 0,
    spot = 0,
    lotSize = 1,
    deltaHedgeShares = 0,
    stockTicker = "Underlying",
    optionChain = {},
    pricingModel = PRICING_MODEL.GARCH_TA,
  } = portfolioGreeks || {};

  const recommendations = [];
  const absDelta = Math.abs(delta);
  const deltaShares = Math.max(1, Math.round(absDelta * lotSize));
  const gammaHedge = pickSpecificHedgeOption(optionChain, pricingModel, spot, "gamma");
  const vegaHedge = pickSpecificHedgeOption(optionChain, pricingModel, spot, "vega");
  if (absDelta < 0.1) {
    recommendations.push({
      greek: "delta",
      severity: "info",
      status: "Neutral",
      headline: `Delta ${delta.toFixed(3)}`,
      action: null,
      why: "Directional risk is already small.",
    });
  } else {
    const severity = absDelta < 0.25 ? "low" : absDelta < 1 ? "medium" : "high";
    const side = delta > 0 ? "Short" : "Buy";
    recommendations.push({
      greek: "delta",
      severity,
      status: delta > 0 ? "Long Bias" : "Short Bias",
      headline: `Delta ${delta.toFixed(3)}`,
      action: `${side} ${deltaShares} ${stockTicker} shares.`,
      why: "Stock hedge offsets directional exposure fastest.",
      suggestedLeg: {
        kind: "stock",
        side,
        quantity: deltaShares,
        label: `${stockTicker} Shares`,
      },
    });
  }

  if (gamma >= 0 && gamma < 0.02) {
    recommendations.push({
      greek: "gamma",
      severity: "info",
      status: "Long Gamma",
      headline: `Gamma +${gamma.toFixed(3)}`,
      action: null,
      why: "Positive gamma already adds convexity.",
    });
  } else if (gamma < 0) {
    recommendations.push({
      greek: "gamma",
      severity: gamma <= -0.01 ? "high" : "medium",
      status: "Short Gamma",
      headline: `Gamma ${gamma.toFixed(3)}`,
      action: gammaHedge ? `Buy 1 ${gammaHedge.label}.` : "Buy 1 liquid ATM option.",
      why: "Near-ATM long options restore convexity most efficiently.",
      suggestedLeg: gammaHedge
        ? {
            kind: "option",
            side: "Buy",
            quantity: 1,
            option: gammaHedge.option,
          }
        : null,
    });
  } else if (gamma >= 0.05) {
    recommendations.push({
      greek: "gamma",
      severity: "low",
      status: "High Gamma",
      headline: `Gamma +${gamma.toFixed(3)}`,
      action: "Check delta more often.",
      why: "High gamma makes delta drift quickly after spot moves.",
    });
  }

  const absVega = Math.abs(vega);
  if (absVega < 1) {
    recommendations.push({
      greek: "vega",
      severity: "info",
      status: "Low Vega",
      headline: `Vega ${vega.toFixed(3)}`,
      action: null,
      why: "IV sensitivity is limited.",
    });
  } else {
    recommendations.push({
      greek: "vega",
      severity: absVega > 3 ? "medium" : "low",
      status: vega > 0 ? "Long Vega" : "Short Vega",
      headline: `Vega ${vega.toFixed(3)}`,
      action: vega > 0
        ? `Sell 1 ${vegaHedge?.label || "liquid near-ATM option"}.`
        : `Buy 1 ${vegaHedge?.label || "liquid near-ATM option"}.`,
      why: "The selected contract offers strong vega with usable liquidity.",
      suggestedLeg: vegaHedge
        ? {
            kind: "option",
            side: vega > 0 ? "Sell" : "Buy",
            quantity: 1,
            option: vegaHedge.option,
          }
        : null,
    });
  }

  recommendations.push({
    greek: "theta",
    severity: theta < -1 ? "medium" : "info",
    status: theta < 0 ? "Theta Drag" : "Theta Carry",
    headline: `Theta ${theta.toFixed(3)}`,
    action: theta < 0 ? "Reduce long premium if conviction fades." : null,
    why: theta < 0 ? "Time decay is working against the position." : "Time decay is supportive.",
  });

  if (Math.abs(rho) >= 0.1) {
    recommendations.push({
      greek: "rho",
      severity: "info",
      status: "Rate Risk",
      headline: `Rho ${rho.toFixed(3)}`,
      action: null,
      why: "Rate sensitivity is noticeable but secondary.",
    });
  }

  if (Math.abs(deltaHedgeShares) > 0.05) {
    recommendations.push({
      greek: "hedge",
      severity: Math.abs(deltaHedgeShares) > 0.25 ? "low" : "info",
      status: "Stock Hedge",
      headline: `Hedge ${deltaHedgeShares.toFixed(2)} sh`,
      action: Math.abs(deltaHedgeShares) > 0.25 ? `Adjust to ${deltaHedgeShares.toFixed(2)} sh.` : null,
      why: "This is the current delta-neutral stock offset.",
      suggestedLeg: {
        kind: "stock",
        side: deltaHedgeShares < 0 ? "Short" : "Buy",
        quantity: Math.abs(Number(deltaHedgeShares.toFixed(2))),
        label: `${stockTicker} Shares`,
      },
    });
  }

  return recommendations;
}

function calculatePortfolioVaR(portfolio, stockPrices, config) {
  if (!portfolio.length || stockPrices.length < 2) {
    return { parametric95: 0, parametric99: 0, historical95: 0, historical99: 0 };
  }

  const pvSeries = stockPrices.map((priceNow) =>
    portfolio.reduce((total, position) => {
      if (position.kind === "stock") {
        return total + position.quantity * priceNow * config.lotSize;
      }
      const T = position.option.maturity / 252;
      const r = config.riskFreeRate / 100;
      const sigma =
        config.pricingModel === PRICING_MODEL.HIST_VOL
          ? position.option.histVolatility || position.option.iv
          : config.pricingModel === PRICING_MODEL.MARKET
            ? position.option.marketIv || position.option.iv
            : position.option.iv;
      const repriced = bsm(priceNow, position.option.strike, T, sigma, r, position.option.type).price;
      return total + position.quantity * repriced * config.lotSize;
    }, 0),
  );

  const returns = pvSeries
    .slice(1)
    .map((priceNow, index) => (priceNow - pvSeries[index]) / pvSeries[index])
    .filter((value) => Number.isFinite(value));

  if (returns.length < 2) {
    return { parametric95: 0, parametric99: 0, historical95: 0, historical99: 0 };
  }

  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const stdDev = Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1));
  const portfolioValue = pvSeries.at(-1);
  const sorted = [...returns].sort((a, b) => a - b);

  return {
    parametric95: -(mean - 1.645 * stdDev) * portfolioValue,
    parametric99: -(mean - 2.326 * stdDev) * portfolioValue,
    historical95: -sorted[Math.floor(0.05 * sorted.length)] * portfolioValue,
    historical99: -sorted[Math.floor(0.01 * sorted.length)] * portfolioValue,
  };
}

function hedgePortfolio(portfolio, lotSize, pricingModel = PRICING_MODEL.GARCH_TA) {
  const greeks = calculatePortfolioGreeks(portfolio, pricingModel);
  return { deltaHedgeShares: -greeks.delta * lotSize };
}

function calculatePnLScenarios(portfolio, lastPrice, config) {
  const scenarios = [-0.02, -0.01, 0.0, 0.01, 0.02];
  const r = config.riskFreeRate / 100;
  const currentValue = portfolio.reduce((sum, position) => sum + position.quantity * getOptionPriceByModel(position.option, config.pricingModel), 0);
  const { deltaHedgeShares } = hedgePortfolio(portfolio, config.lotSize, config.pricingModel);

  return scenarios.map((change) => {
    const newPrice = lastPrice * (1 + change);
    const newValue = portfolio.reduce((sum, position) => {
      const T = position.option.maturity / 252;
      const sigma =
        config.pricingModel === PRICING_MODEL.HIST_VOL
          ? position.option.histVolatility || position.option.iv
          : config.pricingModel === PRICING_MODEL.MARKET
            ? position.option.marketIv || position.option.iv
            : position.option.iv;
      const repriced = bsm(newPrice, position.option.strike, T, sigma, r, position.option.type).price;
      return sum + position.quantity * repriced;
    }, 0);

    const pnlUnhedged = (newValue - currentValue) * config.lotSize;
    const hedgePnl = deltaHedgeShares * (newPrice - lastPrice);
    return {
      scenario: `${(change * 100).toFixed(0)}%`,
      pnlUnhedged,
      pnlDeltaHedged: pnlUnhedged + hedgePnl,
    };
  });
}

function calculatePortfolioPayoffCurve(portfolio, spot, pricingModel = PRICING_MODEL.GARCH_TA, lotSize = 1) {
  const entryCost = portfolio.reduce(
    (sum, position) =>
      sum
      + position.quantity
      * (position.kind === "stock" ? spot : getOptionPriceByModel(position.option, pricingModel)),
    0,
  );
  const points = [];

  for (let pct = -0.15; pct <= 0.151; pct += 0.005) {
    const stockPrice = spot * (1 + pct);
    const pnl = portfolio.reduce((sum, position) => {
      if (position.kind === "stock") {
        return sum + position.quantity * (stockPrice - spot);
      }
      const intrinsic =
        position.option.type === OPTION_TYPE.CALL
          ? Math.max(0, stockPrice - position.option.strike)
          : Math.max(0, position.option.strike - stockPrice);
      return sum + position.quantity * (intrinsic - getOptionPriceByModel(position.option, pricingModel));
    }, 0) * lotSize;

    points.push({
      stockPrice: Number(stockPrice.toFixed(2)),
      pnl: Number(pnl.toFixed(2)),
    });
  }

  const breakevens = [];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const current = points[i];
    if (prev.pnl === 0) {
      breakevens.push(prev.stockPrice);
    } else if ((prev.pnl < 0 && current.pnl > 0) || (prev.pnl > 0 && current.pnl < 0)) {
      breakevens.push(current.stockPrice);
    }
  }

  return {
    cost: Number((entryCost * lotSize).toFixed(2)),
    points,
    breakevens: breakevens.slice(0, 2),
  };
}

function buildUserPortfolio(selectionByOptionId, optionChain) {
  const allOptions = Object.values(optionChain).flat();
  return Object.entries(selectionByOptionId)
    .filter(([, quantity]) => quantity !== 0)
    .map(([optionId, quantity]) => {
      const option = allOptions.find((candidate) => candidate.id === optionId);
      return option ? { option, quantity } : null;
    })
    .filter(Boolean);
}

function generateStrategy(type, currentPrice, optionChain) {
  const maturities = Object.keys(optionChain).map(Number).sort((a, b) => a - b);
  if (!maturities.length) return null;

  const options = optionChain[maturities[0]];
  const calls = options.filter((option) => option.type === OPTION_TYPE.CALL).sort((a, b) => a.strike - b.strike);
  const puts = options.filter((option) => option.type === OPTION_TYPE.PUT).sort((a, b) => a.strike - b.strike);
  if (!calls.length || !puts.length) return null;

  const atmCall = calls.reduce((prev, curr) => (Math.abs(curr.strike - currentPrice) < Math.abs(prev.strike - currentPrice) ? curr : prev));
  const atmPut = puts.find((option) => option.strike === atmCall.strike) || puts.reduce((prev, curr) => (Math.abs(curr.strike - currentPrice) < Math.abs(prev.strike - currentPrice) ? curr : prev));
  if (!atmCall || !atmPut) return null;

  let legs = [];
  let description = "";
  let maxProfit = "Unlimited";
  let maxLoss = "Unlimited";
  let breakeven = [];

  if (type === STRATEGY_TYPE.STRADDLE) {
    legs = [{ option: atmCall, quantity: 1 }, { option: atmPut, quantity: 1 }];
    description = `Buy ATM Call (${atmCall.strike}) and Put (${atmPut.strike})`;
    maxLoss = (atmCall.bsmPrice + atmPut.bsmPrice).toFixed(2);
    breakeven = [atmPut.strike - (atmCall.bsmPrice + atmPut.bsmPrice), atmCall.strike + (atmCall.bsmPrice + atmPut.bsmPrice)];
  }

  if (type === STRATEGY_TYPE.STRANGLE) {
    const otmCall = calls.find((option) => option.strike > currentPrice * 1.02) || calls.at(-1);
    const otmPut = [...puts].reverse().find((option) => option.strike < currentPrice * 0.98) || puts[0];
    legs = [{ option: otmCall, quantity: 1 }, { option: otmPut, quantity: 1 }];
    description = `Buy OTM Call (${otmCall.strike}) and OTM Put (${otmPut.strike})`;
    maxLoss = (otmCall.bsmPrice + otmPut.bsmPrice).toFixed(2);
    breakeven = [otmPut.strike - (otmCall.bsmPrice + otmPut.bsmPrice), otmCall.strike + (otmCall.bsmPrice + otmPut.bsmPrice)];
  }

  if (type === STRATEGY_TYPE.BUTTERFLY) {
    const centerIndex = calls.findIndex((option) => option.id === atmCall.id);
    if (centerIndex > 0 && centerIndex < calls.length - 1) {
      const lowerCall = calls[centerIndex - 1];
      const upperCall = calls[centerIndex + 1];
      legs = [
        { option: lowerCall, quantity: 1 },
        { option: atmCall, quantity: -2 },
        { option: upperCall, quantity: 1 },
      ];
      description = `Buy ${lowerCall.strike} Call, Sell 2x ${atmCall.strike} Calls, Buy ${upperCall.strike} Call`;
      const netDebit = lowerCall.bsmPrice + upperCall.bsmPrice - 2 * atmCall.bsmPrice;
      maxLoss = netDebit.toFixed(2);
      maxProfit = (atmCall.strike - lowerCall.strike - netDebit).toFixed(2);
      breakeven = [lowerCall.strike + netDebit, upperCall.strike - netDebit];
    }
  }

  if (type === STRATEGY_TYPE.IRON_CONDOR) {
    const shortPut = [...puts].reverse().find((option) => option.strike < currentPrice * 0.95);
    const longPut = [...puts].reverse().find((option) => option.strike < (shortPut?.strike || 0));
    const shortCall = calls.find((option) => option.strike > currentPrice * 1.05);
    const longCall = calls.find((option) => option.strike > (shortCall?.strike || 0));
    if (shortPut && longPut && shortCall && longCall) {
      legs = [
        { option: longPut, quantity: 1 },
        { option: shortPut, quantity: -1 },
        { option: shortCall, quantity: -1 },
        { option: longCall, quantity: 1 },
      ];
      description = `Buy ${longPut.strike} Put, Sell ${shortPut.strike} Put, Sell ${shortCall.strike} Call, Buy ${longCall.strike} Call`;
      const netCredit = shortPut.bsmPrice + shortCall.bsmPrice - longPut.bsmPrice - longCall.bsmPrice;
      maxProfit = netCredit.toFixed(2);
      maxLoss = Math.max(shortCall.strike - longCall.strike, shortPut.strike - longPut.strike) - netCredit;
      maxLoss = maxLoss.toFixed(2);
      breakeven = [shortPut.strike - netCredit, shortCall.strike + netCredit];
    }
  }

  if (!legs.length) return null;

  return {
    type,
    name: type,
    description,
    legs,
    netGreeks: calculatePortfolioGreeks(legs),
    cost: legs.reduce((sum, leg) => sum + leg.quantity * leg.option.bsmPrice, 0),
    maxProfit,
    maxLoss,
    breakeven,
  };
}

function calculateStrategyPnL(strategy, targetPrice, elapsedDays, targetIVChange, riskFreeRate) {
  const r = riskFreeRate / 100;
  return strategy.legs.reduce((sum, leg) => {
    const newT = Math.max((leg.option.maturity - elapsedDays) / 365, 0);
    const newIV = Math.max(0.01, leg.option.iv + targetIVChange);
    const price =
      newT === 0
        ? leg.option.type === OPTION_TYPE.CALL
          ? Math.max(0, targetPrice - leg.option.strike)
          : Math.max(0, leg.option.strike - targetPrice)
        : bsm(targetPrice, leg.option.strike, newT, newIV, r, leg.option.type).price;

    return sum + (price - leg.option.bsmPrice) * leg.quantity;
  }, 0);
}

function exportDataToCSV(report) {
  const rows = [
    ["Ticker", report.ticker],
    ["Last Price", report.stock.lastPrice.toFixed(4)],
    ["Data Source", report.stock.source],
    ["Annualized Volatility", report.summaryStats.annualizedVolatility.toFixed(6)],
    ["Skewness", report.summaryStats.skewness.toFixed(6)],
    ["Excess Kurtosis", report.summaryStats.kurtosis.toFixed(6)],
    [],
    ["Date", "Close"],
    ...report.stock.historicalData.map((row) => [row.date, row.price.toFixed(4)]),
  ];
  return rows.map((row) => row.map((cell) => `"${cell ?? ""}"`).join(",")).join("\n");
}

export async function buildAnalyticsReport({ ticker, startDate, endDate, riskFreeRate = 7, lotSize = 1 }) {
  const stock = await getStockData(ticker, startDate, endDate);
  const prices = stock.historicalData.map((row) => row.price);
  const summaryStats = calculateSummaryStatistics(prices);
  const garchVolatility = computeTransformAugmentedVolatility(summaryStats, 0.22);
  const volatilitySignals = computeRollingVolatilitySignals(prices, garchVolatility, 20);
  const historyClose = prices.at(-1) ?? stock.lastPrice;
  const historyPreviousClose = prices.at(-2) ?? historyClose;
  const rawLiveQuote = stock.liveQuote || generateLiveStockData(ticker, stock.lastPrice);
  const liveQuote = {
    ...rawLiveQuote,
    close: Number.isFinite(rawLiveQuote?.close) ? rawLiveQuote.close : historyClose,
    previousClose:
      Number.isFinite(rawLiveQuote?.previousClose) && rawLiveQuote.previousClose > 0
        ? rawLiveQuote.previousClose
        : historyPreviousClose,
    open: Number.isFinite(rawLiveQuote?.open) ? rawLiveQuote.open : historyPreviousClose,
    high: Number.isFinite(rawLiveQuote?.high) ? rawLiveQuote.high : Math.max(historyClose, historyPreviousClose),
    low: Number.isFinite(rawLiveQuote?.low) ? rawLiveQuote.low : Math.min(historyClose, historyPreviousClose),
    volume: Number.isFinite(rawLiveQuote?.volume) ? rawLiveQuote.volume : 0,
  };
  const optionChain = await getOptionChain(
    ticker,
    stock.lastPrice,
    summaryStats.annualizedVolatility || 0.22,
    riskFreeRate,
    garchVolatility,
  );
  const defaultStrategy = generateStrategy(STRATEGY_TYPE.STRADDLE, stock.lastPrice, optionChain);
  const portfolio = defaultStrategy?.legs || [];
  const portfolioGreeks = calculatePortfolioGreeks(portfolio);
  const portfolioValue = calculatePortfolioValue(portfolio, lotSize);
  const hedge = hedgePortfolio(portfolio, lotSize);
  const pnlScenarios = calculatePnLScenarios(portfolio, stock.lastPrice, { riskFreeRate, lotSize });
  const varResult = calculatePortfolioVaR(portfolio, prices, { riskFreeRate, lotSize });
  const strategies = Object.values(STRATEGY_TYPE)
    .map((type) => generateStrategy(type, stock.lastPrice, optionChain))
    .filter(Boolean);
  const { liquidTicker, illiquidTicker } = pickLiquidityPair(ticker);
  const [liquidStock, illiquidStock] = await Promise.all([
    getStockData(liquidTicker, startDate, endDate),
    getStockData(illiquidTicker, startDate, endDate),
  ]);
  const liquidityStudy = {
    liquid: buildLiquidityAnalysis(liquidTicker, liquidStock, DEFAULT_MARKET_PROFILES[liquidTicker]),
    illiquid: buildLiquidityAnalysis(illiquidTicker, illiquidStock, DEFAULT_MARKET_PROFILES[illiquidTicker]),
  };

  return {
    ticker,
    stock,
    liveQuote,
    summaryStats,
    garchVolatility,
    volatilitySignals,
    optionChain,
    portfolio,
    portfolioGreeks,
    portfolioValue,
    hedge,
    pnlScenarios,
    varResult,
    strategies,
    liquidityStudy,
    marketProfile: DEFAULT_MARKET_PROFILES[ticker] || {
      liquidity: "MED",
      turnoverCr: 40,
      beta: 1,
      marketCap: "N/A",
      amihud: 0.002,
    },
    dataSource: {
      stock: stock.source || "simulation",
      options:
        Object.values(optionChain).flat()[0]?.source ||
        "simulation",
      provider:
        stock.provider ||
        Object.values(optionChain).flat()[0]?.provider ||
        "simulation",
    },
    exportCsv: () => exportDataToCSV({ ticker, stock, summaryStats }),
    calculateStrategyPnL: (strategy, targetPrice, elapsedDays, ivChange) =>
      calculateStrategyPnL(strategy, targetPrice, elapsedDays, ivChange, riskFreeRate),
    pricingFramework: {
      source: "Historical prices (yfinance) -> GARCH(1,1)-style conditional volatility -> Transform-Augmented IV -> BSM pricing",
      labels: {
        garchTa: "GARCH-TA Model Price",
        histVol: "BSM (Hist Vol) Price",
      },
      targetContracts: ["ATM Call / Put", "OTM Call (+7.5%)", "OTM Put (-7.5%)", "30-day", "60-day"],
    },
  };
}

export const STOCK_UNIVERSE = Object.keys(DEFAULT_MARKET_PROFILES);
export {
  OPTION_TYPE,
  PRICING_MODEL,
  STRATEGY_TYPE,
  buildUserPortfolio,
  calculatePortfolioGreeks,
  calculatePortfolioGrossCost,
  calculatePortfolioPayoffCurve,
  calculatePortfolioValue,
  calculatePortfolioVaR,
  calculatePnLScenarios,
  computeTransformAugmentedVolatility,
  detectStrategyName,
  generateHedgingRecommendations,
  getOptionGreeksByModel,
  getOptionPriceByModel,
  hedgePortfolio,
  inferStrikeStep,
  snapToStrike,
};
