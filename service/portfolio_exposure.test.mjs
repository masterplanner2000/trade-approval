import assert from "node:assert/strict";
import test from "node:test";
import { canonicalExposureSymbol, evaluatePortfolioAddition } from "./portfolio_exposure.mjs";

const limits = {
  capitalLimit: 10_000,
  maxPositionValue: 1_500,
  maxSectorValue: 3_500,
  maxThemeValue: 3_500,
  maxOpenPositions: 8,
};

test("GOOG and GOOGL share one capped security exposure", () => {
  assert.equal(canonicalExposureSymbol("GOOG"), "ALPHABET");
  assert.equal(canonicalExposureSymbol("googl"), "ALPHABET");
  const result = evaluatePortfolioAddition({
    ...limits,
    symbol: "GOOGL",
    notional: 500,
    holdings: [{ symbol: "GOOG", notional: 1_000 }],
  });
  assert.equal(result.allowed, true);
  assert.equal(result.resultingPositionValue, 1_500);
  const exceeded = evaluatePortfolioAddition({
    ...limits,
    symbol: "GOOGL",
    notional: 501,
    holdings: [{ symbol: "GOOG", notional: 1_000 }],
  });
  assert.equal(exceeded.checks.securityExposureAllowed, false);
});

test("a sixth position must add a different classified exposure", () => {
  const holdings = [
    { symbol: "NVDA", notional: 1_000 },
    { symbol: "MSFT", notional: 1_000 },
    { symbol: "XOM", notional: 1_000 },
    { symbol: "CAT", notional: 1_000 },
    { symbol: "MRK", notional: 1_000 },
  ];
  const concentrated = evaluatePortfolioAddition({ ...limits, symbol: "SMCI", notional: 1_000, holdings });
  assert.equal(concentrated.allowed, false);
  assert.equal(concentrated.checks.diversificationAllowed, false);
  const diversified = evaluatePortfolioAddition({ ...limits, symbol: "AMZN", notional: 1_000, holdings });
  assert.equal(diversified.allowed, true);
});

test("unknown classifications fail closed because concentration cannot be measured", () => {
  const four = ["NVDA", "MSFT", "XOM", "CAT"].map((symbol) => ({ symbol, notional: 1_000 }));
  assert.equal(evaluatePortfolioAddition({ ...limits, symbol: "UNKNOWN", notional: 500, holdings: four }).allowed, false);
  const five = [...four, { symbol: "MRK", notional: 1_000 }];
  const result = evaluatePortfolioAddition({ ...limits, symbol: "UNKNOWN", notional: 500, holdings: five });
  assert.equal(result.allowed, false);
  assert.equal(result.checks.classificationComplete, false);
});

test("position and sector-theme caps are enforced", () => {
  const position = evaluatePortfolioAddition({ ...limits, symbol: "NVDA", notional: 600,
    holdings: [{ symbol: "NVDA", notional: 1_000 }] });
  assert.equal(position.checks.positionAllowed, false);
  const sector = evaluatePortfolioAddition({ ...limits, symbol: "INTC", notional: 1_000,
    holdings: [{ symbol: "NVDA", notional: 1_300 }, { symbol: "MSFT", notional: 1_300 }] });
  assert.equal(sector.checks.sectorAllowed, false);
});
