import assert from "node:assert/strict";
import test from "node:test";
import { reconcilePositionOwnership } from "./position_ownership.mjs";

const account = "PAPER-123";
const ledger = (positions, orders = {}) => ({
  listPositions: () => positions,
  listBrokerOrders: (proposalId) => orders[proposalId] ?? [],
});
const position = (symbol, quantity, id = symbol) => ({
  id, symbol, quantity, averageEntryPrice: 100, accountId: account, environment: "paper",
});
const snapshot = (positions, openOrders = []) => ({
  account, capturedAt: 1, positions: positions.map(([symbol, quantity]) => ({ symbol, quantity, averageCost: 105 })), openOrders,
});
const stop = (symbol, quantity, permanentId = 22) => ({
  account, symbol, action: "SELL", orderType: "STP", quantity, permanentId, status: "Submitted", stopPrice: 92,
});

test("exact application fill and linked active stop verify ownership and protection", () => {
  const result = reconcilePositionOwnership(snapshot([["ABC", 5]], [stop("ABC", 5)]),
    ledger([position("ABC", 5)], { ABC: [{ role: "protective_stop", brokerOrderId: "22" }] }));
  assert.equal(result.ownershipComplete, true);
  assert.equal(result.protectionComplete, true);
  assert.equal(result.items[0].ownership, "strategy_owned");
  assert.equal(result.items[0].strategyCost, 500);
  assert.equal(result.items[0].protection, "verified");
  assert.equal(result.items[0].protectiveStopPrice, 92);
});

test("ticker match does not establish ownership when broker has additional shares", () => {
  const result = reconcilePositionOwnership(snapshot([["ABC", 25]], [stop("ABC", 25)]),
    ledger([position("ABC", 5)], { ABC: [{ role: "protective_stop", brokerOrderId: "22" }] }));
  assert.equal(result.ownershipComplete, false);
  assert.equal(result.items[0].ownership, "conflict");
  assert.equal(result.items[0].strategyOwnedQuantity, 0);
  assert.equal(result.items[0].protection, "unverified");
});

test("unlinked stop does not protect a strategy position", () => {
  const result = reconcilePositionOwnership(snapshot([["ABC", 5]], [stop("ABC", 5, 99)]),
    ledger([position("ABC", 5)], { ABC: [{ role: "protective_stop", brokerOrderId: "22" }] }));
  assert.equal(result.items[0].ownership, "strategy_owned");
  assert.equal(result.items[0].protection, "missing");
  assert.equal(result.protectionComplete, false);
});

test("an oversized linked stop is not verified after a partial exit", () => {
  const result = reconcilePositionOwnership(snapshot([["ABC", 3]], [stop("ABC", 5)]),
    ledger([position("ABC", 3)], { ABC: [{ role: "protective_stop", brokerOrderId: "22" }] }));
  assert.equal(result.items[0].ownership, "strategy_owned");
  assert.equal(result.items[0].protection, "overcovered");
  assert.equal(result.protectionComplete, false);
});

test("unattributed holdings are not silently assigned to the strategy", () => {
  const result = reconcilePositionOwnership(snapshot([["XYZ", 3]]), ledger([]));
  assert.equal(result.ownershipComplete, true);
  assert.equal(result.items[0].ownership, "unknown");
  assert.equal(result.items[0].strategyOwnedQuantity, 0);
  assert.equal(result.items[0].protection, "unverified");
});

test("historical strategy symbol without an open ledger fill blocks ownership completion", () => {
  const result = reconcilePositionOwnership(snapshot([["XYZ", 3]]), ledger([]), { historicalSymbols: ["XYZ"] });
  assert.equal(result.ownershipComplete, false);
  assert.equal(result.items[0].ownership, "conflict");
});

test("complete app-referenced legacy trades establish ownership but not protection", () => {
  const flexEvidence = new Map([["XYZ", { account, environment: "paper", netQuantity: 3,
    observedOn: "2026-09-18", orderAttribution: "verified_application_reference", orderCount: 2 }]]);
  const result = reconcilePositionOwnership(snapshot([["XYZ", 3]]), ledger([]),
    { historicalSymbols: ["XYZ"], flexEvidence });
  assert.equal(result.items[0].ownership, "strategy_owned");
  assert.equal(result.items[0].ownershipSource, "broker_flex_legacy");
  assert.equal(result.items[0].strategyOwnedQuantity, 3);
  assert.equal(result.items[0].protection, "missing");
  assert.equal(result.items[0].strategyCost, 315);
  assert.equal(result.ownershipComplete, true);
  assert.equal(result.protectionComplete, false);
});

test("legacy attribution fails closed on a changed holding or external trade", () => {
  const flexEvidence = new Map([["XYZ", { account, environment: "paper", netQuantity: 3,
    observedOn: "2026-09-18", orderAttribution: "verified_application_reference" }]]);
  const changed = reconcilePositionOwnership(snapshot([["XYZ", 4]]), ledger([]), { flexEvidence });
  const external = reconcilePositionOwnership(snapshot([["XYZ", 3]]), ledger([]), { flexEvidence, externalSymbols: ["XYZ"] });
  assert.equal(changed.items[0].ownership, "conflict");
  assert.equal(external.items[0].ownership, "conflict");
});

test("observed external activity prevents an exact ticker and quantity match from claiming ownership", () => {
  const result = reconcilePositionOwnership(snapshot([["ABC", 5]]), ledger([position("ABC", 5)]),
    { externalSymbols: ["ABC"] });
  assert.equal(result.ownershipComplete, false);
  assert.equal(result.items[0].ownership, "conflict");
});

test("recorded open fill missing at broker is a conflict", () => {
  const result = reconcilePositionOwnership(snapshot([]), ledger([position("ABC", 5)]));
  assert.equal(result.ownershipComplete, false);
  assert.deepEqual(result.missingBrokerPositions, [{ symbol: "ABC", recordedQuantity: 5 }]);
});
