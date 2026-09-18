import assert from "node:assert/strict";
import test from "node:test";
import { assessProtectionRepair } from "./protection_repair.mjs";

const now = 10_000;
const base = () => ({
  now, symbol: "MSFT", stopPrice: 98, maxLossDollars: 75,
  snapshot: { ok: true, complete: true, readOnly: true, environment: "paper", account: "DUR…217", capturedAt: now,
    positions: [{ account: "DUR…217", symbol: "MSFT", securityType: "STK", quantity: 2 }], openOrders: [] },
  ownership: { account: "DUR…217", items: [{ symbol: "MSFT", ownership: "strategy_owned", protection: "missing", strategyOwnedQuantity: 2 }] },
  quoteSnapshot: { ok: true, readOnly: true, environment: "paper", account: "DUR…217", quote: {
    symbol: "MSFT", dataType: 1, bid: 100, ask: 100.05, bidReceivedAt: now, askReceivedAt: now } },
});

test("legacy stop repair preflight requires exact fresh paper position and live quote", () => {
  assert.equal(assessProtectionRepair(base()).ok, true);
  const cases = [
    [(input) => { input.snapshot.capturedAt = 1; }, "broker_snapshot_stale"],
    [(input) => { input.snapshot.environment = "live"; }, "paper_snapshot_unavailable"],
    [(input) => { input.quoteSnapshot.account = "other"; }, "account_mismatch"],
    [(input) => { input.quoteSnapshot.readOnly = false; }, "account_mismatch"],
    [(input) => { input.ownership.items[0].protection = "unverified"; }, "position_not_verified_for_repair"],
    [(input) => { input.snapshot.positions[0].quantity = 3; }, "position_not_verified_for_repair"],
    [(input) => { input.snapshot.openOrders = [{ account: "DUR…217", symbol: "MSFT", action: "SELL", status: "Submitted" }]; }, "working_sell_order_exists"],
    [(input) => { input.quoteSnapshot.quote.dataType = 3; }, "live_quote_unavailable"],
    [(input) => { input.quoteSnapshot.quote.bidReceivedAt = 1; }, "quote_callback_stale"],
    [(input) => { input.stopPrice = 101; }, "invalid_stop_price"],
    [(input) => { input.maxLossDollars = 1; }, "risk_budget_exceeded"],
  ];
  for (const [change, reason] of cases) {
    const input = base(); change(input);
    assert.equal(assessProtectionRepair(input).reason, reason);
  }
});
