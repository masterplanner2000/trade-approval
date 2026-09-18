import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authoritativePortfolio, BrokerReconciliationStore, proposalReference, reconcileSnapshotToLedger } from "./broker_reconciliation.mjs";
import { TradingLedger } from "./trading_ledger.mjs";

function snapshot(overrides = {}) {
  return {
    ok: true, complete: true, environment: "paper", readOnly: true, account: "DUR…217",
    capturedAt: 10_000,
    summary: Object.fromEntries([
      ["NetLiquidation", 100_000], ["TotalCashValue", 80_000], ["SettledCash", 79_000],
      ["AvailableFunds", 78_000], ["BuyingPower", 78_000], ["GrossPositionValue", 20_000],
      ["MaintMarginReq", 0], ["UnrealizedPnL", 500], ["RealizedPnL", -50],
    ].map(([key, value]) => [key, { value, currency: "USD" }])),
    positions: [{ symbol: "NVDA", quantity: 5, averageCost: 180 }],
    openOrders: [], completedOrders: [], executions: [], warnings: [], ...overrides,
  };
}

test("order references identify the decision prefix and bracket role", () => {
  assert.deepEqual(proposalReference("trade-approval-abc123-entry"), { decisionPrefix: "abc123", role: "entry" });
  assert.equal(proposalReference("manual-order"), null);
});

test("authoritative portfolio fails closed when stale or incomplete", () => {
  assert.equal(authoritativePortfolio(snapshot(), { now: 20_000 }).status, "COMPLETE");
  const stale = authoritativePortfolio(snapshot(), { now: 50_001 });
  assert.equal(stale.status, "INCOMPLETE");
  assert.ok(stale.missing.includes("freshSnapshot"));
});

test("optional PnL and settled-cash fields do not invalidate otherwise complete broker evidence", () => {
  const input = snapshot();
  delete input.summary.SettledCash;
  delete input.summary.UnrealizedPnL;
  delete input.summary.RealizedPnL;
  const portfolio = authoritativePortfolio(input, { now: 20_000 });
  assert.equal(portfolio.status, "COMPLETE");
  assert.equal(portfolio.settledCash, null);
  assert.equal(portfolio.realizedPnl, null);
});

test("reconciliation is durable, idempotent by broker identity, and detects external activity", () => {
  const store = new BrokerReconciliationStore(":memory:");
  const input = snapshot({
    openOrders: [
      { orderId: 10, permanentId: 100, symbol: "NVDA", orderRef: "trade-approval-abc123-entry" },
      { orderId: 11, permanentId: 101, symbol: "AAPL", orderRef: null },
    ],
    executions: [{ executionId: "exec-1", symbol: "MSFT", orderRef: "manual-order" }],
  });
  store.record(input, { knownDecisionPrefixes: ["abc123"] });
  store.record({ ...input, capturedAt: 11_000 }, { knownDecisionPrefixes: ["abc123"] });
  const activity = store.listActivity();
  assert.equal(activity.length, 3);
  assert.equal(activity.find((item) => item.brokerIdentity === "100").ownership, "application");
  assert.equal(activity.find((item) => item.brokerIdentity === "101").ownership, "external");
  assert.equal(activity.find((item) => item.brokerIdentity === "100").firstSeenAt, 10_000);
  assert.equal(activity.find((item) => item.brokerIdentity === "100").lastSeenAt, 11_000);
  assert.equal(store.latest().capturedAt, 11_000);
  store.close();
});

test("pre-ledger app references are unlinked, not falsely labelled external", () => {
  const store = new BrokerReconciliationStore(":memory:");
  store.record(snapshot({ openOrders: [{ orderId: 71, permanentId: 171, symbol: "NVDA",
    orderRef: "trade-approval-229c9369-49a", status: "Submitted" }] }), { knownDecisionPrefixes: [] });
  assert.equal(store.listActivity()[0].ownership, "legacy_application_unlinked");
  store.close();
});

test("reopening a store repairs the older external label for app orders", () => {
  const directory = mkdtempSync(join(tmpdir(), "paper-attribution-"));
  try {
    const path = join(directory, "reconciliation.sqlite3");
    const oldStore = new BrokerReconciliationStore(path);
    oldStore.record(snapshot({ openOrders: [{ orderId: 72, permanentId: 172, symbol: "NVDA",
      orderRef: "trade-approval-77159ad2-8d4-stop", status: "Submitted" }] }));
    oldStore.database.prepare("UPDATE reconciled_broker_activity SET ownership = 'external'").run();
    oldStore.close();
    const reopened = new BrokerReconciliationStore(path);
    assert.equal(reopened.listActivity()[0].ownership, "legacy_application_unlinked");
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("broker evidence links to the ledger and resolves an unknown submission", () => {
  const ledger = new TradingLedger(":memory:");
  ledger.recordProposal({ id: "proposal-1", createdAt: 1_000, expiresAt: 20_000, environment: "paper", broker: "IBKR", accountId: "DUR…217", symbol: "NVDA", side: "buy", terms: { quantity: 2, limitPrice: 200 } });
  ledger.recordDecision({ id: "abc123456789-full", proposalId: "proposal-1", decision: "approved", decidedAt: 2_000 });
  ledger.beginSubmission({ id: "attempt-1", decisionId: "abc123456789-full", idempotencyKey: "paper:abc123456789-full", startedAt: 3_000 });
  ledger.completeSubmission({ id: "attempt-1", status: "unknown", completedAt: 4_000, errorCode: "connection_lost" });
  const linked = reconcileSnapshotToLedger(snapshot({ openOrders: [{ orderId: 10, permanentId: 100, symbol: "NVDA", orderRef: "trade-approval-abc123456789-entry", status: "PreSubmitted" }] }), ledger);
  assert.equal(linked.length, 1);
  assert.equal(ledger.getSubmissionAttempt("attempt-1").status, "submitted");
  assert.equal(ledger.listBrokerOrders("proposal-1")[0].brokerOrderId, "100");
  assert.ok(ledger.listEvents("proposal-1").some((event) => event.eventType === "broker_order_reconciled"));
  ledger.close();
});

test("completed cancellation resolves an uncertain submission without fabricating a fill", () => {
  const ledger = new TradingLedger(":memory:");
  ledger.recordProposal({ id: "cancel-proposal", createdAt: 1_000, environment: "paper", broker: "IBKR",
    accountId: "DUR…217", symbol: "QCOM", side: "buy", terms: { quantity: 2, limitPrice: 100 } });
  ledger.recordDecision({ id: "123456789abc-full", proposalId: "cancel-proposal", decision: "approved", decidedAt: 2_000 });
  ledger.beginSubmission({ id: "cancel-attempt", decisionId: "123456789abc-full", idempotencyKey: "paper:cancel-attempt", startedAt: 3_000 });
  ledger.completeSubmission({ id: "cancel-attempt", status: "unknown", completedAt: 4_000 });
  reconcileSnapshotToLedger(snapshot({ completedOrders: [{ orderId: 99, permanentId: 199, symbol: "QCOM",
    orderRef: "trade-approval-123456789abc-entry", status: "Cancelled" }] }), ledger);
  assert.equal(ledger.getSubmissionAttempt("cancel-attempt").status, "failed");
  assert.equal(ledger.listActivity()[0].status, "Cancelled");
  assert.deepEqual(ledger.listPositions(), []);
  assert.equal(ledger.strategyBudget(5_000).reserved, 0);
  ledger.close();
});

test("a cancelled remainder cannot erase an observed partial entry fill", () => {
  const ledger = new TradingLedger(":memory:");
  ledger.recordProposal({ id: "partial-proposal", createdAt: 1_000, environment: "paper", broker: "IBKR",
    accountId: "DUR…217", symbol: "AAPL", side: "buy", terms: { quantity: 5, limitPrice: 100 } });
  ledger.recordDecision({ id: "abcdef123456-full", proposalId: "partial-proposal", decision: "approved", decidedAt: 2_000 });
  reconcileSnapshotToLedger(snapshot({
    completedOrders: [{ orderId: 80, permanentId: 180, symbol: "AAPL",
      orderRef: "trade-approval-abcdef123456-entry", status: "Cancelled" }],
    executions: [{ executionId: "exec-partial", orderId: 80, permanentId: 180, symbol: "AAPL",
      side: "BOT", quantity: 2, cumulativeQuantity: 2, price: 100,
      orderRef: "trade-approval-abcdef123456-entry" }],
  }), ledger);
  assert.equal(ledger.listBrokerOrders("partial-proposal")[0].status, "PartiallyFilled");
  assert.equal(ledger.listPositions()[0].quantity, 2);
  ledger.close();
});

test("a colliding truncated decision reference never guesses which proposal owns an order", () => {
  const ledger = new TradingLedger(":memory:");
  for (const suffix of ["one", "two"]) {
    ledger.recordProposal({ id: `proposal-${suffix}`, createdAt: 1_000, environment: "paper", broker: "IBKR", accountId: "DUR…217", symbol: "NVDA", side: "buy", terms: { quantity: 1 } });
    ledger.recordDecision({ id: `abcdef123456-${suffix}`, proposalId: `proposal-${suffix}`, decision: "approved", decidedAt: 2_000 });
  }
  const linked = reconcileSnapshotToLedger(snapshot({ openOrders: [{ orderId: 10, symbol: "NVDA", orderRef: "trade-approval-abcdef123456-entry" }] }), ledger);
  assert.deepEqual(linked, []);
  assert.deepEqual(ledger.listBrokerOrders("proposal-one"), []);
  assert.deepEqual(ledger.listBrokerOrders("proposal-two"), []);
  ledger.close();
});
