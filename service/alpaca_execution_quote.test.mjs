import assert from "node:assert/strict";
import test from "node:test";
import { assessAlpacaExecutionQuote, assessProfitablePaperBidFallback } from "./alpaca_execution_quote.mjs";

const now = Date.parse("2026-10-02T14:00:10Z");
const payload = { symbol: "MRVL", quote: { bp: 278.46, ap: 278.69, t: "2026-10-02T14:00:05Z" } };

test("a fresh bounded IEX quote can price a Paper-only approved exit", () => {
  const result = assessAlpacaExecutionQuote(payload, { symbol: "MRVL", now });
  assert.equal(result.ok, true);
  assert.equal(result.source, "alpaca_iex");
});

test("identity, freshness, crossed markets and spread fail closed", () => {
  assert.equal(assessAlpacaExecutionQuote(payload, { symbol: "CRWD", now }).reason, "alpaca_quote_identity_mismatch");
  assert.equal(assessAlpacaExecutionQuote(payload, { symbol: "MRVL", now: now + 20_001 }).reason, "alpaca_quote_stale");
  assert.equal(assessAlpacaExecutionQuote({ symbol: "MRVL", quote: { bp: 280, ap: 279, t: "2026-10-02T14:00:05Z" } }, { symbol: "MRVL", now }).reason, "invalid_bid_ask");
assert.equal(assessAlpacaExecutionQuote({ symbol: "MRVL", quote: { bp: 270, ap: 280, t: "2026-10-02T14:00:05Z" } }, { symbol: "MRVL", now }).reason, "spread_too_wide");

const wide = assessAlpacaExecutionQuote({ symbol: "CRWD", quote: { bp: 271.68, ap: 278.8, t: "2026-10-02T14:00:05Z" } }, { symbol: "CRWD", now });
assert.equal(assessProfitablePaperBidFallback(wide, { averageCost: 259.44 }).ok, true);
assert.equal(assessProfitablePaperBidFallback(wide, { averageCost: 272 }).reason, "paper_profit_floor_not_met");
});
