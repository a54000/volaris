# Greeks & Financial Formulas

## 1. Black-Scholes-Merton (BSM) Pricing

Defined in `frontend/src/financialService.js:87` (`function bsm`).

### D1 / D2

```
d1 = [ln(S/K) + (r + σ²/2) × T] / (σ × √T)
d2 = d1 - σ × √T
```

### Call Price

```
C = S × N(d1) − K × e⁻ʳᵀ × N(d2)
```

### Put Price

```
P = K × e⁻ʳᵀ × N(−d2) − S × N(−d1)
```

### Greeks

| Greek | Call | Put | Formula |
|-------|------|-----|---------|
| **Delta (Δ)** | `N(d1)` | `N(d1) − 1` | First derivative w.r.t. spot |
| **Gamma (Γ)** | `N'(d1) / (S × σ × √T)` | Same | Second derivative w.r.t. spot (identical for call & put) |
| **Vega (ν)** | `S × N'(d1) × √T / 100` | Same | Per 1% IV change (divided by 100) |
| **Theta (Θ)** | `[−S × N'(d1) × σ / (2√T) − r × K × e⁻ʳᵀ × N(d2)] / 365` | `[−S × N'(d1) × σ / (2√T) + r × K × e⁻ʳᵀ × N(−d2)] / 365` | Per calendar day (divided by 365) |
| **Rho (ρ)** | `K × T × e⁻ʳᵀ × N(d2) / 100` | `−K × T × e⁻ʳᵀ × N(−d2) / 100` | Per 1% rate change (divided by 100) |

### Helper Functions

- **N(x) (normCdf)**: `0.5 × (1 + erf(x / √2))` — standard normal CDF via Abramowitz & Stegun approximation
- **N'(x) (normPdf)**: `(1 / √(2π)) × exp(−x² / 2)` — standard normal PDF
- **erf**: Horner-form polynomial approximation (6 terms)

### Edge Case

When `T ≤ 0` or `σ ≤ 0`: price defaults to intrinsic value, all Greeks except delta are zero. Delta is 0/1/−1 depending on moneyness.

---

## 2. Implied Volatility Solver

`financialService.js:146` (`solveImpliedVolatility`)

Bisection search on `σ ∈ [0.01, 3.0]` until `|modelPrice − marketPrice| < 1e⁻⁵`. Maximum 80 iterations.

Returns `null` if the market price is below intrinsic value (arbitrage violation).

---

## 3. GARCH-TA IV (Transform-Augmented Volatility)

`financialService.js:323` (`computeTransformAugmentedVolatility`)

Not a real GARCH model. A heuristic that adjusts historical volatility by return distribution moments:

```
baseVol = annualizedHistoricalVolatility (or 0.22 fallback)
skew    = sample skewness of daily log returns
kurt    = sample excess kurtosis of daily log returns
factor  = exp(0.08 × skew + 0.04 × kurt)
result  = clamp(baseVol × factor, 0.08, 1.25)
```

Interpretation: positive skew and leptokurtosis (fat tails) amplify the volatility estimate; negative skew and platykurtosis reduce it.

---

## 4. Strike-Adjusted IV (Volatility Smile)

`financialService.js:331` (`computeStrikeAdjustedGarchTaIv`)

```
moneyness = ln(strike / spot)
adjusted  = baseGarchIV × (1 + 0.2 × moneyness² − 0.1 × moneyness)
result    = clamp(adjusted, 0.08, 1.25)
```

A quadratic smile adjustment — OTM/ITM strikes get higher IV than ATM.

---

## 5. Portfolio Greeks Aggregation

`financialService.js:686` (`calculatePortfolioGreeks`)

```
portfolioDelta = Σ (position.quantity × option.delta)     [+ position.quantity for stock legs]
portfolioGamma = Σ (position.quantity × option.gamma)
portfolioVega  = Σ (position.quantity × option.vega)
portfolioTheta = Σ (position.quantity × option.theta)
portfolioRho   = Σ (position.quantity × option.rho)
```

Where `position.quantity` = number of lots (positive for long, negative for short).

The output is in **per-contract units** (not yet scaled by lot size). Lot size scaling happens at the display layer:

```
displayedDelta = lotSize × portfolioDelta    (share-equivalent delta)
displayedGamma = lotSize × portfolioGamma    (shares of delta drift per ₹1 spot move)
displayedVega  = lotSize × portfolioVega     (rupee P&L per 1% IV change)
displayedTheta = lotSize × portfolioTheta    (rupee decay per calendar day)
displayedRho   = lotSize × portfolioRho      (rupee P&L per 1% rate change)
```

### Stock Leg Handling

Stock positions contribute only to delta: `delta += position.quantity`. Gamma, vega, theta, rho are zero for stock legs.

---

## 6. Delta Hedge

`financialService.js:1186` (`hedgePortfolio`)

```
fullDeltaHedgeShares = −portfolioDelta × lotSize
hedgeRatio           = computeLiquidityHedgeRatio(marketProfile)
deltaHedgeShares     = fullDeltaHedgeShares × hedgeRatio
residualDeltaShares  = fullDeltaHedgeShares − deltaHedgeShares
```

### Liquidity Hedge Ratio

`financialService.js:1174` (`computeLiquidityHedgeRatio`)

```
amihudRef     = 75th percentile of all-stock Amihud values
turnoverRef   = median of all-stock turnover values

amihudRatio   = clamp(1 − amihud / amihudRef, 0.65, 1)
turnoverRatio = clamp(0.7 + 0.3 × min(1, ln(turnoverCr+1) / ln(turnoverRef+1)), 0.7, 1)

hedgeRatio    = √(amihudRatio × turnoverRatio)
```

Geometric mean of two correlated liquidity signals with floors at 0.65 (Amihud) and 0.7 (turnover).

---

## 7. PnL Scenario Estimation

`frontend/src/utils/pnlCalculator.js:5` (`computePnL`)

Second-order Taylor expansion of option P&L around current spot:

```
ΔS        = S × spotChangePct
Δσ_pp     = volChangePct × 100          (in percentage points)
deltaPnL  = Δ × ΔS × lotSize
gammaPnL  = ½ × Γ × ΔS² × lotSize
vegaPnL   = ν × Δσ_pp × lotSize
thetaPnL  = Θ × daysElapsed × lotSize
totalPnL  = deltaPnL + gammaPnL + vegaPnL + thetaPnL
```

---

## 8. VaR (Value at Risk) & CVaR (Expected Shortfall)

`financialService.js:1031` (`calculatePortfolioVaR`)

### Methodology

The portfolio is priced at each historical stock price point, producing a time series of portfolio values (`pvSeries`). The PnL series is the first difference of `pvSeries`. All VaR/CVaR estimates are derived from this PnL series.

**Important**: Gamma enters VaR indirectly through the PnL series (re-pricing at each historical price captures full non-linear P&L), not through the Taylor approximation.

### Statistics

```
μ       = mean(pnlSeries)
σ       = std(pnlSeries)                    (sample standard deviation)
sorted  = sort(pnlSeries)
dailyLogReturns = ln(Sₜ / Sₜ₋₁)
σ_ret   = std(dailyLogReturns)
garchDailyVol = weightedAvgPortfolioIV / √252   (clamped ≥ σ_ret)
volScale     = garchDailyVol / σ_ret
σ_adj       = σ × volScale
```

### VaR Formulas

| Method | 95% | 99% |
|--------|-----|-----|
| **Parametric** | `−(μ − 1.645σ)` | `−(μ − 2.326σ)` |
| **GARCH** | `|1.645 × σ_adj|` | `|2.326 × σ_adj|` |
| **Monte Carlo** | `|P₅|` from 5000 `N(0, σ_adj)` samples | `|P₁|` from 5000 `N(0, σ_adj)` samples |
| **Historical** | `−sorted[⌊0.05×N⌋]` | `−sorted[⌊0.01×N⌋]` |

### CVaR (Expected Shortfall) Formulas

CVaR factors from standard normal PDF:

```
CF₉₅ = N'(1.645) / 0.05 ≈ 2.06
CF₉₉ = N'(2.326) / 0.01 ≈ 2.66
```

| Method | 95% | 99% |
|--------|-----|-----|
| **Parametric** | `−(μ − CF₉₅ × σ)` | `−(μ − CF₉₉ × σ)` |
| **GARCH** | `|CF₉₅ × σ_adj|` | `|CF₉₉ × σ_adj|` |
| **Monte Carlo** | Mean of worst 5% of simulated PnLs | Mean of worst 1% of simulated PnLs |
| **Historical** | Mean of worst 5% of historical PnLs | Mean of worst 1% of historical PnLs |

---

## 9. Summary Statistics (Daily Log Returns)

`financialService.js:166` (`calculateSummaryStatistics`)

```
rₜ      = ln(Pₜ / Pₜ₋₁)                   Daily log return
μ       = mean(r)                          Sample mean
σ       = std(r)                           Sample standard deviation
σ_ann   = σ × √252                         Annualized volatility
m₃      = mean((r − μ)³)                   Third central moment
m₄      = mean((r − μ)⁴)                   Fourth central moment
S       = m₃ / σ³                          Skewness
K       = m₄ / σ⁴ − 3                      Excess kurtosis
σ_down  = √(mean(r_negative²)) × √252      Downside volatility (semi-deviation)
```

### Rolling Windows (20-day)

```
σ_20(i)   = std(r[i−19..i]) × √252        Rolling 20-day annualized vol
IV_20(i)  = GARCH-TA(σ_20(i))             Rolling 20-day GARCH-TA IV
σ_vol     = std(σ_20)                     Volatility of volatility
```

---

## 10. Liquidity Comparison (Study VaR)

`App.jsx:1627` (`calculateStudyVaR`)

```
losses    = absReturn values filtered by regime
var95     = quantile(losses, 0.95)
var99     = quantile(losses, 0.99)
cvar95    = mean(losses ≥ var95)
cvar99    = mean(losses ≥ var99)
```

### Liquidity Penalty

```
amihudPenalty       = clamp(avgAmihud × 20, 0, 0.25)
turnoverPenalty     = clamp((0.01 − avgTurnoverRatio) × 12, 0, 0.25)
liquidityFactor     = 1 + amihudPenalty + turnoverPenalty
liquidityAdjusted95 = var95 × liquidityFactor
liquidityAdjusted99 = var99 × liquidityFactor
```

---

## 11. Hedging Recommendations

`financialService.js:862` (`generateHedgingRecommendations`)

### Greeks Scaling

```
scaled.delta = portfolioDelta × lotSize
scaled.gamma = portfolioGamma × lotSize
scaled.vega  = portfolioVega × lotSize
scaled.theta = portfolioTheta × lotSize
scaled.rho   = portfolioRho × lotSize
```

### Delta Recommendation

| Condition | Action |
|-----------|--------|
| `|delta| < 0.1` | Info: Neutral |
| `delta > 0` (long bias) | Short `deltaHedgeShares` shares |
| `delta < 0` (short bias) | Buy `|deltaHedgeShares|` shares |

Severity: `|delta| < 0.25` → low, `< 1` → medium, else high.

### Gamma Recommendation

| Condition | Severity | Action |
|-----------|----------|--------|
| `|scaled.gamma| < 0.5` | Info: Below materiality |
| `scaled.gamma < −0.5` (short gamma) | low/medium/high | Buy `gammaHedgeQty` ATM options |
| `scaled.gamma ≥ 0.5` (high gamma) | low | Monitor delta more frequently |

`gammaHedgeQty = round(|scaled.gamma| / |hedgeOption.gamma|)`

The hedge option is selected by `pickSpecificHedgeOption` with mode=`"gamma"`:
- Uses shortest available maturity (highest gamma per premium)
- Scores ATM options by OI, volume, gamma magnitude, and strike proximity to spot

### Vega Recommendation

| Condition | Severity | Action |
|-----------|----------|--------|
| `|scaled.vega| < ₹50` | Info: Low vega |
| `scaled.vega > 0` (long vega) | low/medium | Sell `vegaHedgeQty` ATM options |
| `scaled.vega < 0` (short vega) | low/medium | Buy `vegaHedgeQty` ATM options |

Severity: `|scaled.vega| > ₹200` → medium, else low.

The hedge option is selected by `pickSpecificHedgeOption` with mode=`"vega"`:
- Uses second-shortest available maturity (~60 days, where vega peaks)
- Scores ATM options by OI, volume, vega magnitude, and strike proximity

`vegaHedgeQty = round(|scaled.vega| / |hedgeOption.vega|)`

---

## 12. Option Scoring for Hedge Selection

`financialService.js:821` (`scoreOptionLiquidity`)

```
score = OI × 0.4 + volume × 0.6 + |gamma| × 10000 + |vega| × 100 − |strike − spot|
```

Higher score wins. The composite prefers high open interest, high volume, ATM (filtered to `|delta| ∈ [0.35, 0.65]`), and close to spot.

---

## 13. Portfolio Value & PnL (Repricing Method)

`financialService.js:705` (`calculatePortfolioValue`)

```
portfolioValue = Σ (position.quantity × optionPrice × lotSize)
```

`calculatePortfolioVaR` uses the repricing method for PnL:

```
pvSeries[t] = Σ (position.quantity × bsm(Sₜ, K, T, σ, r, type).price × lotSize)
pnl[t]      = pvSeries[t] − pvSeries[t−1]
```

This captures full non-linear P&L including gamma, theta decay, and vega effects through actual re-pricing at each historical price.

---

## 14. Payoff Curve

`financialService.js:1234` (`calculatePortfolioPayoffCurve`)

```
for pct = −15% to +15% in 0.5% steps:
    Sₜ = S₀ × (1 + pct)
    pnl = Σ [position.quantity × (intrinsic(Sₜ) − entryPrice)] × lotSize
```

Stock legs: `pnl = qty × (Sₜ − S₀)`
Option legs: `pnl = qty × [max(0, Sₜ − K) for calls / max(0, K − Sₜ) for puts − optionPrice]`
