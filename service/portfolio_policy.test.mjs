import assert from "node:assert/strict";
import test from "node:test";
import { effectivePortfolioLimits, portfolioBuyCapacity } from "./portfolio_policy.mjs";

test("effective limits preserve the sleeve while allowing a stricter configurable position count", () => {
  assert.deepEqual(effectivePortfolioLimits(
    { capitalLimit: 10_000, maxOpenPositions: 8 },
    { sleeveValue: 10_000, maximumDeployedPercent: 60, maximumPositions: 5 },
  ), {
    capitalLimit: 10_000,
    maxOpenPositions: 5,
    maximumPositionPercent: 15,
    maximumSectorPercent: 35,
    maximumThemePercent: 35,
    maxPositionValue: 1_500,
    maxSectorValue: 3_500,
    maxThemeValue: 3_500,
  });
});

test("new buys stop when the position limit is reached", () => {
  const result = portfolioBuyCapacity({
    deployed: 4_000,
    openPositionCount: 5,
    ownershipComplete: true,
    protectionComplete: true,
    limits: { capitalLimit: 6_000, maxOpenPositions: 5 },
  });
  assert.equal(result.buyAllowed, false);
  assert.equal(result.available, 0);
  assert.deepEqual(result.blockers, ["position_limit_reached"]);
});

test("exceeded deployment and position limits are both visible", () => {
  const result = portfolioBuyCapacity({
    deployed: 8_092.13,
    openPositionCount: 9,
    ownershipComplete: true,
    protectionComplete: true,
    limits: { capitalLimit: 6_000, maxOpenPositions: 5 },
  });
  assert.equal(result.buyAllowed, false);
  assert.equal(result.overAllocated, true);
  assert.deepEqual(result.blockers, ["deployment_limit_exceeded", "position_limit_exceeded"]);
});
