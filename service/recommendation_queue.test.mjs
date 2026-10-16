import test from "node:test";
import assert from "node:assert/strict";
import { buildPortfolioReview, eligibleQueueCandidates, normalizeAggressiveScan, recommendationTtlMs, wasDeniedForSignal } from "./server.mjs";
import { chooseActiveRecommendationVersions, createQueueSerialExecutor } from "./recommendation_queue.mjs";

test("recommendation expiry shortens as volatility rises", () => {
  assert.equal(recommendationTtlMs({ atrPercent14: 2 }), 10 * 60 * 1000);
  assert.equal(recommendationTtlMs({ atrPercent14: 3 }), 5 * 60 * 1000);
  assert.equal(recommendationTtlMs({ atrPercent14: 5 }), 2 * 60 * 1000);
});

test("recommendation set contains every eligible non-excluded candidate", () => {
  const evaluations = Array.from({ length: 7 }, (_, index) => ({
    symbol: `TEST${index}`, eligible: index !== 1, recommendationScore: index,
  }));
  const candidates = eligibleQueueCandidates({ evaluations }, new Set(["TEST4"]));
  assert.deepEqual(candidates.map(({ symbol }) => symbol), ["TEST6", "TEST5", "TEST3", "TEST2", "TEST0"]);
});

test("aggressive research candidates normalize into a distinct Paper lane", () => {
  const normalized = normalizeAggressiveScan({ candidates: [
    { symbol: "FAST", eligible: true, researchScore: 82.5, atrPercent14: 8.2 },
    { symbol: "PBR.A", eligible: true, researchScore: 80, atrPercent14: 5 },
  ] });
  assert.equal(normalized.mode, "aggressive_paper");
  assert.equal(normalized.evaluations[0].sourceLane, "shadow");
  assert.equal(normalized.evaluations[0].category, "VOLATILE_MOMENTUM");
  assert.equal(normalized.evaluations[0].recommendationScore, 82.5);
  assert.equal(normalized.evaluations.length, 1);
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

test("a fully allocated portfolio proposes one profitable rotation into a stronger candidate", () => {
  const evaluation = (symbol, score, referenceClose = 110) => ({
    symbol, company: symbol, eligible: true, recommendationScore: score, referenceClose,
    marketRisk: { level: "MODERATE" }, signalDate: "2026-09-11",
  });
  const review = buildPortfolioReview({ evaluations: [evaluation("WEAK", 55), evaluation("STRONG", 85)] }, {
    complete: true, capturedAt: 1000,
    positions: [{ symbol: "WEAK", quantity: 5, averageCost: 100 }],
    openOrders: [{ symbol: "WEAK", action: "SELL", orderType: "STP", quantity: 5, status: "Submitted" }],
  }, { deployed: 500, capitalLimit: 500, ownership: { items: [
    { symbol: "WEAK", ownership: "strategy_owned", protection: "verified", reasons: [] },
  ] } });
  assert.equal(review.reductionRequired, 0);
  assert.equal(review.holdings[0].ordinaryRotationProfitEligible, true);
  assert.equal(review.holdings[0].recommendedForExit, true);
  assert.equal(review.replacements[0].symbol, "STRONG");
  assert.equal(review.nextStep, "APPROVE_EXIT_SEQUENTIALLY");
});

test("an ordinary rotation is blocked when the holding is below cost", () => {
  const review = buildPortfolioReview({ evaluations: [
    { symbol: "LOSER", company: "LOSER", eligible: false, recommendationScore: 20, referenceClose: 90, signalDate: "2026-09-11" },
    { symbol: "STRONG", company: "STRONG", eligible: true, recommendationScore: 85, referenceClose: 110, signalDate: "2026-09-11" },
  ] }, {
    complete: true, capturedAt: 1000,
    positions: [{ symbol: "LOSER", quantity: 5, averageCost: 100 }], openOrders: [],
  }, { deployed: 500, capitalLimit: 500, ownership: { items: [
    { symbol: "LOSER", ownership: "strategy_owned", protection: "missing", reasons: [] },
  ] } });
  assert.equal(review.holdings[0].ordinaryRotationProfitEligible, false);
  assert.equal(review.holdings[0].recommendedForExit, false);
  assert.equal(review.nextStep, "MONITOR_HOLDINGS");
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

test("a missing profit target makes an otherwise protected exit review-only", () => {
  const review = buildPortfolioReview({ evaluations: [
    { symbol: "MRVL", eligible: false, recommendationScore: 20, referenceClose: 110, signalDate: "2026-09-11" },
    { symbol: "NEXT", eligible: true, recommendationScore: 90, referenceClose: 100, signalDate: "2026-09-11" },
  ] }, {
    positions: [{ symbol: "MRVL", quantity: 3, averageCost: 100 }],
    openOrders: [{ symbol: "MRVL", action: "SELL", orderType: "STP", quantity: 3, status: "Submitted" }],
  }, { deployed: 330, capitalLimit: 0, openPositionCount: 1, maxOpenPositions: 0, ownership: { items: [
    { symbol: "MRVL", ownership: "strategy_owned", protection: "verified", reasons: [] },
  ] } });
  assert.equal(review.exitReviews[0].orderSubmissionAllowed, false);
  assert.equal(review.exitReviews[0].approvalBlockedReason, "The exact broker target and stop pair could not be verified");
});

test("concurrent queue mutations execute one at a time", async () => {
  const serialize = createQueueSerialExecutor();
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const first = serialize(async () => { events.push("first-start"); await firstGate; events.push("first-end"); return "first"; });
  const second = serialize(async () => { events.push("second-start"); events.push("second-end"); return "second"; });
  await Promise.resolve();
  assert.deepEqual(events, ["first-start"]);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
  assert.deepEqual(events, ["first-start", "first-end", "second-start", "second-end"]);
});

test("only the oldest still-active version of each symbol remains in the queue", () => {
  const proposals = [
    { id: "crwd-1", symbol: "CRWD", status: "pending", createdAt: 10, expiresAt: 1_000 },
    { id: "crwd-2", symbol: "CRWD", status: "pending", createdAt: 20, expiresAt: 1_000 },
    { id: "xom-1", symbol: "XOM", status: "pending", createdAt: 30, expiresAt: 1_000 },
    { id: "old", symbol: "QQQ", status: "pending", createdAt: 5, expiresAt: 50 },
    { id: "done", symbol: "VLO", status: "submitted", createdAt: 1, expiresAt: 1_000 },
  ];
  const result = chooseActiveRecommendationVersions(proposals, 100);
  assert.deepEqual(result.active.map((item) => item.id), ["crwd-1", "xom-1"]);
  assert.deepEqual(result.duplicates.map((item) => item.id), ["crwd-2"]);
});
