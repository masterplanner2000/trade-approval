import test from "node:test";
import assert from "node:assert/strict";
import { eligibleQueueCandidates, recommendationTtlMs, wasDeniedForSignal } from "./server.mjs";

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
