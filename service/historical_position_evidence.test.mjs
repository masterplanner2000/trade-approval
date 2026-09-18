import test from "node:test";
import assert from "node:assert/strict";
import { summarizeHistoricalEvidence } from "./historical_position_evidence.mjs";
import { reconcilePositionOwnership } from "./position_ownership.mjs";

const evidence = () => summarizeHistoricalEvidence({
  environment: "paper", account: "PAPER", observedOn: "2026-09-18",
  symbols: [{ symbol: "NVDA", movements: [
    { date: "2026-08-24", side: "buy", quantity: 20, rows: 13 },
    { date: "2026-09-01", side: "buy", quantity: 20, rows: 4 },
    { date: "2026-09-01", side: "sell", quantity: 15, rows: 3 },
    { date: "2026-09-08", side: "buy", quantity: 7, rows: 2 },
    { date: "2026-09-14", side: "sell", quantity: 7, rows: 2 },
  ] }],
});

test("paper transaction movements explain 25 shares without asserting app ownership", () => {
  const history = evidence();
  assert.equal(history.get("NVDA").netQuantity, 25);
  assert.equal(history.get("NVDA").rowCount, 24);
  assert.equal(history.get("NVDA").orderAttribution, "unverified");
  const snapshot = { account: "PAPER", positions: [{ symbol: "NVDA", quantity: 25 }], openOrders: [] };
  const ledger = { listPositions: () => [{ environment: "paper", accountId: "PAPER", symbol: "NVDA", quantity: 17 }] };
  const result = reconcilePositionOwnership(snapshot, ledger, { historicalEvidence: history });
  assert.equal(result.items[0].brokerHistory.status, "matched");
  assert.equal(result.items[0].ownership, "conflict");
  assert.equal(result.items[0].strategyOwnedQuantity, 0);
  assert.equal(result.ownershipComplete, false);
});

test("mismatched broker history blocks automatic ownership even with an equal ledger quantity", () => {
  const snapshot = { account: "PAPER", positions: [{ symbol: "NVDA", quantity: 24 }], openOrders: [] };
  const ledger = { listPositions: () => [{ environment: "paper", accountId: "PAPER", symbol: "NVDA", quantity: 24 }] };
  const result = reconcilePositionOwnership(snapshot, ledger, { historicalEvidence: evidence() });
  assert.equal(result.items[0].brokerHistory.status, "mismatch");
  assert.equal(result.items[0].ownership, "conflict");
});

test("historical evidence from a different account cannot affect paper ownership", () => {
  const snapshot = { account: "OTHER", positions: [{ symbol: "NVDA", quantity: 25 }], openOrders: [] };
  const ledger = { listPositions: () => [] };
  const result = reconcilePositionOwnership(snapshot, ledger, { historicalEvidence: evidence() });
  assert.equal(result.items[0].brokerHistory, null);
  assert.equal(result.items[0].ownership, "unknown");
});
