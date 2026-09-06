import test from "node:test";
import assert from "node:assert/strict";
import { recommendationTtlMs } from "./server.mjs";

test("recommendation expiry shortens as volatility rises", () => {
  assert.equal(recommendationTtlMs({ atrPercent14: 2 }), 10 * 60 * 1000);
  assert.equal(recommendationTtlMs({ atrPercent14: 3 }), 5 * 60 * 1000);
  assert.equal(recommendationTtlMs({ atrPercent14: 5 }), 2 * 60 * 1000);
});
