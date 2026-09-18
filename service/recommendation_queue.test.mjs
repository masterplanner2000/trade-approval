import test from "node:test";
import assert from "node:assert/strict";
import { buildPortfolioReview, eligibleQueueCandidates, recommendationTtlMs, wasDeniedForSignal } from "./server.mjs";

test("recommendation expiry shortens as volatility rises", () => {
  assert.equal(recommendationTtlMs({ atrPercent14: 2 }), 10 * 60 * 1000);
  assert.equal(recommendationTtlMs({ atrPercent14: 3 }), 5 * 60 * 1000);
  assert.equal(recommendationTtlMs({ atrPercent14: 5 }), 2 * 60 * 1000);
});

test("recommendation set contains every eligible non-excluded candidate", () => {
  const evaluations = Array.from({ length: 7 }, (_, index) => ({
    symbol: `TEST${index}`,
    eligible: index !== 1,
    recommendationScore: index,
  }));
  const candidates = eligibleQueueCandidates({ evaluations }, new Set(["TEST4"]));
  assert.deepEqual(candidates.map(({ symbol }) => symbol), ["TEST6", "TEST5", "TEST3", "TEST2", "TEST0"]);
});

test("a denied symbol is excluded only for the same signal date", () => {
  const completed = [{ symbol: "NVDA", outcome: "denied", signalDate: "2026-09-04" }];
  assert.equal(wasDeniedForSignal({ symbol: "NVDA", signalDate: "2026-09-04" }, completed), true);
  assert.equal(wasDeniedForSignal({ symbol: "NVDA", signalDate: "2026-09-05" }, completed), false);
  assert.equal(wasDeniedForSignal({ symbol: "MSFT", signalDate: "2026-09-04" }, completed), false);
});

test("a fully deployed portfolio produces sequential exit reviews and replacement candidates", () => {
  const evaluation = (symbol, eligible, score) => ({
    symbol, company: symbol, eligible, recommendationScore: score, referenceClose: 100,
    marketRisk: { level: "MODERATE" }, signalDate: "2026-09-11",
  });
  const review = buildPortfolioReview({ evaluations: [
    evaluation("HOLD", true, 80), evaluation("EXIT", false, 20), evaluation("NEXT", true, 90),
  ] }, {
    complete: true, capturedAt: 1000,
    positions: [
      { symbol: "HOLD", quantity: 5, averageCost: 100 },
      { symbol: "EXIT", quantity: 6, averageCost: 100 },
    ],
    openOrders: [{ symbol: "HOLD", action: "SELL", orderType: "STP", quantity: 5, status: "PreSubmitted" }],
  }, { deployed: 1100, capitalLimit: 500, ownership: { items: [
    { symbol: "HOLD", ownership: "strategy_owned", protection: "verified", reasons: [] },
    { symbol: "EXIT", ownership: "strategy_owned", protection: "missing", reasons: [] },
  ] } });

  assert.equal(review.reductionRequired, 600);
  assert.equal(review.holdings.find((item) => item.symbol === "HOLD").status, "HOLD");
  assert.equal(review.holdings.find((item) => item.symbol === "EXIT").recommendedForExit, true);
  assert.deepEqual(review.replacements.map((item) => item.symbol), ["NEXT"]);
  assert.equal(review.nextStep, "APPROVE_EXIT_SEQUENTIALLY");
});

test("unknown position ownership cannot be recommended for an exit", () => {
  const review = buildPortfolioReview({ evaluations: [{ symbol: "NVDA", eligible: false, referenceClose: 100 }] }, {
    positions: [{ symbol: "NVDA", quantity: 25, averageCost: 100 }], openOrders: [],
  }, { deployed: 2500, capitalLimit: 500, ownership: { items: [
    { symbol: "NVDA", ownership: "conflict", protection: "unverified", reasons: ["Unmatched shares"] },
  ] } });
  assert.equal(review.holdings[0].status, "OWNERSHIP_REVIEW");
  assert.equal(review.holdings[0].recommendedForExit, false);
  assert.equal(review.nextStep, "MANUAL_REVIEW_REQUIRED");
});
