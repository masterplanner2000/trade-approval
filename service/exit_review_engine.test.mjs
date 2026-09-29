import assert from "node:assert/strict";
import test from "node:test";
import { buildExitReviewCards } from "./exit_review_engine.mjs";

const holding = (overrides = {}) => ({
  symbol: "NVDA", quantity: 2, estimatedValue: 500, estimatedGrossPnl: 25,
  recommendationScore: 40, ownership: "strategy_owned", protected: true,
  recommendedForExit: false, ...overrides,
});

test("policy reduction creates a review-only exit card", () => {
  const [review] = buildExitReviewCards({ holdings: [holding({ recommendedForExit: true })], at: 1_000 });
  assert.equal(review.symbol, "NVDA");
  assert.equal(review.reviewOnly, true);
  assert.equal(review.orderSubmissionAllowed, false);
  assert.deepEqual(review.triggers.map((item) => item.id), ["portfolio_policy"]);
});

test("thesis deterioration and an elapsed holding horizon are both explained", () => {
  const at = 5 * 24 * 60 * 60 * 1000;
  const [review] = buildExitReviewCards({
    holdings: [holding()], at,
    thesisExits: [{ symbol: "NVDA", reason: "Failed two completed-day checks" }],
    openTrades: [{ symbol: "NVDA", status: "open", openedAt: at - 4 * 24 * 60 * 60 * 1000 }],
  });
  assert.equal(review.urgency, "high");
  assert.deepEqual(review.triggers.map((item) => item.id), ["thesis_deterioration", "holding_horizon"]);
});

test("unknown ownership can never become an exit review", () => {
  assert.deepEqual(buildExitReviewCards({ holdings: [holding({ ownership: "conflict", recommendedForExit: true })] }), []);
});
