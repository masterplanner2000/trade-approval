import test from "node:test";
import assert from "node:assert/strict";
import { assessAutomaticExitQuote } from "./automatic_exit_quote.mjs";

const live = { ok: true, environment: "paper", quote: { dataType: 1, bid: 100, ask: 100.1, bidReceivedAt: 10_000, askReceivedAt: 10_000 } };
const assess = (snapshot) => assessAutomaticExitQuote(snapshot, { now: 11_000 });

test("fresh live paper bid and ask pass", () => {
  assert.equal(assess(live).ok, true);
});

test("delayed, frozen, simulated and incomplete snapshots fail closed", () => {
  for (const dataType of [2, 3, 4, "simulated", null]) {
    assert.equal(assess({ ...live, quote: { ...live.quote, dataType } }).reason, "live_quote_unavailable");
  }
  assert.equal(assess({ ...live, ok: false }).ok, false);
  assert.equal(assess({ ...live, environment: "live" }).ok, false);
});

test("an old, missing, or future bid or ask callback fails even when type is live", () => {
  for (const [key, value] of [["bidReceivedAt", 5_000], ["askReceivedAt", null], ["askReceivedAt", 12_000]]) {
    assert.equal(assess({ ...live, quote: { ...live.quote, [key]: value } }).reason, "quote_callback_stale");
  }
});

test("crossed, invalid and wide quotes fail", () => {
  assert.equal(assess({ ...live, quote: { ...live.quote, bid: 101 } }).reason, "invalid_bid_ask");
  assert.equal(assess({ ...live, quote: { ...live.quote, bid: 0 } }).reason, "invalid_bid_ask");
  assert.equal(assess({ ...live, quote: { ...live.quote, ask: 101 } }).reason, "spread_too_wide");
});
