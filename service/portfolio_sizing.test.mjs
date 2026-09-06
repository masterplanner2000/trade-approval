import test from "node:test";
import assert from "node:assert/strict";
import { calculatePortfolioPositionSize } from "./portfolio_sizing.mjs";

const now = 1_800_000_000_000;
const candidate = {
  symbol: "NVDA",
  sector: "Technology",
  entryPrice: 100,
  stopPrice: 95,
  averageDollarVolume20: 1_000_000_000,
};
const portfolio = {
  asOf: now,
  sleeveValue: 50_000,
  settledCash: 30_000,
  availableFunds: 30_000,
  buyingPower: 30_000,
  currentExposure: 10_000,
  pendingBuyNotional: 0,
  currentOpenRisk: 200,
  dailyPnl: 0,
  openPositionCount: 2,
  symbolExposure: 0,
  sectorExposure: 5_000,
  correlatedExposure: 5_000,
};
const policy = {
  riskPerTradePercent: 0.005,
  maxDailyLossPercent: 0.015,
  maxTotalOpenRiskPercent: 0.025,
  maxPositionPercent: 0.1,
  maxTotalExposurePercent: 0.5,
  maxSectorExposurePercent: 0.25,
  maxCorrelatedExposurePercent: 0.25,
  minimumCashReservePercent: 0.3,
  maxOpenPositions: 5,
  maxLiquidityParticipationPercent: 0.0001,
};

test("fails closed when portfolio data is missing or stale", () => {
  assert.equal(calculatePortfolioPositionSize({ candidate, portfolio: {}, policy, now }).status, "INCOMPLETE");
  const result = calculatePortfolioPositionSize({ candidate, portfolio: { ...portfolio, asOf: now - 31_000 }, policy, now });
  assert.deepEqual(result.missing, ["portfolio.freshSnapshot"]);
});

test("sizes whole shares from the most restrictive constraint", () => {
  const result = calculatePortfolioPositionSize({ candidate, portfolio, policy, now });
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.classification, "ACTIONABLE_WITH_CASH");
  assert.equal(result.quantity, 50);
  assert.equal(result.notional, 5_000);
  assert.equal(result.estimatedLossAtStop, 250);
  assert.deepEqual(result.bindingConstraints, [{ id: "trade_risk", label: "Per-trade loss limit" }, { id: "position", label: "Maximum position exposure" }]);
});

test("cash reserve can be the binding constraint", () => {
  const result = calculatePortfolioPositionSize({
    candidate,
    portfolio: { ...portfolio, settledCash: 16_200, availableFunds: 16_200, buyingPower: 16_200 },
    policy,
    now,
  });
  assert.equal(result.quantity, 12);
  assert.deepEqual(result.bindingConstraints, [{ id: "cash", label: "Settled cash after reserve and pending buys" }]);
});

test("blocks a new symbol when the open-position limit is reached", () => {
  const result = calculatePortfolioPositionSize({ candidate, portfolio: { ...portfolio, openPositionCount: 5 }, policy, now });
  assert.equal(result.quantity, 0);
  assert.equal(result.classification, "QUALIFIED_CAPACITY_BLOCKED");
  assert.equal(result.bindingConstraints[0].id, "open_positions");
});

test("does not apply the slot limit when adding to an existing symbol", () => {
  const result = calculatePortfolioPositionSize({
    candidate,
    portfolio: { ...portfolio, openPositionCount: 5, symbolExposure: 1_000 },
    policy,
    now,
  });
  assert.equal(result.quantity, 40);
  assert.equal(result.classification, "ACTIONABLE_WITH_CASH");
});

test("labels a blocked candidate as a possible rotation without authorizing it", () => {
  const result = calculatePortfolioPositionSize({
    candidate,
    portfolio: { ...portfolio, openPositionCount: 5 },
    policy,
    rotation: { eligible: true, symbol: "XYZ", estimatedNetProceeds: 4_000 },
    now,
  });
  assert.equal(result.classification, "POSSIBLE_ROTATION");
  assert.equal(result.quantity, 0);
  assert.deepEqual(result.rotation, {
    status: "REQUIRES_SEQUENTIAL_APPROVAL_AND_FILL",
    sellSymbol: "XYZ",
    estimatedNetProceeds: 4_000,
  });
});
