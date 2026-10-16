import assert from "node:assert/strict";
import test from "node:test";
import { buildExitReviewCards } from "./exit_review_engine.mjs";

const holding = (overrides = {}) => ({
  symbol: "NVDA", quantity: 2, estimatedValue: 500, estimatedGrossPnl: 25,
  recommendationScore: 40, ownership: "strategy_owned", protected: true,
  ordinaryRotationProfitEligible: true, recommendedForExit: false, ...overrides,
});

test("a profitable protected policy reduction creates an approvable exit card", () => {
  const [review] = buildExitReviewCards({ holdings: [holding({ recommendedForExit: true })], at: 1_000 });
  assert.equal(review.symbol, "NVDA");
  assert.equal(review.reviewOnly, false);
  assert.equal(review.orderSubmissionAllowed, true);
  assert.deepEqual(review.triggers.map((item) => item.id), ["portfolio_policy"]);
});

test("a loss-making ordinary rotation remains review only", () => {
  const [review] = buildExitReviewCards({ holdings: [holding({ recommendedForExit: true, ordinaryRotationProfitEligible: false })] });
  assert.equal(review.orderSubmissionAllowed, false);
  assert.match(review.approvalBlockedReason, /below average cost/);
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

test("a breached recorded stop is directly actionable even below cost", () => {
  const [review] = buildExitReviewCards({ holdings: [holding({
    protected: false, exitPairVerified: false, ordinaryRotationProfitEligible: false,
    recommendedForExit: false, protectiveStopBreached: true,
  })] });
  assert.equal(review.orderSubmissionAllowed, true);
  assert.equal(review.exitMode, "direct_exit");
  assert.equal(review.triggers[0].id, "protective_stop_breached");
});

test("a profitable recommended exit without an active pair uses the direct path", () => {
  const [review] = buildExitReviewCards({ holdings: [holding({
    protected: false, exitPairVerified: false, recommendedForExit: true,
  })] });
  assert.equal(review.orderSubmissionAllowed, true);
  assert.equal(review.exitMode, "direct_exit");
});
