import assert from "node:assert/strict";
import test from "node:test";
import { authoritativePortfolio, BrokerReconciliationStore } from "./broker_reconciliation.mjs";
import { DeterministicBroker } from "./testing/deterministic_broker.mjs";

const bracket = (broker) => broker.submitBracket({
  symbol: "NVDA", quantity: 4, limitPrice: 100, targetPrice: 110,
  stopPrice: 95, decisionId: "abcdef123456-full",
});

test("simulator is paper-only, complete, fresh and starts without network authority", () => {
  const broker = new DeterministicBroker({ cash: 5_000 });
  const portfolio = authoritativePortfolio(broker.snapshot(), { now: 10_000 });
  assert.equal(portfolio.status, "COMPLETE");
  assert.equal(portfolio.environment, "paper");
  assert.equal(portfolio.totalCash, 5_000);
});

test("partial entry fill activates protection for exactly the filled quantity", () => {
  const broker = new DeterministicBroker({ cash: 5_000 });
  const ids = bracket(broker);
  broker.accept(ids.entryId);
  broker.fill(ids.entryId, 2, 99, { commission: 1 });
  const snapshot = broker.snapshot();
  assert.equal(snapshot.positions[0].quantity, 2);
  assert.equal(snapshot.summary.TotalCashValue.value, 4_801);
  const stop = snapshot.openOrders.find((order) => order.orderId === ids.stopId);
  const target = snapshot.openOrders.find((order) => order.orderId === ids.targetId);
  assert.equal(stop.quantity, 2);
  assert.equal(target.quantity, 2);
  assert.equal(stop.status, "Submitted");
  assert.equal(snapshot.executions[0].cumulativeQuantity, 2);
});

test("rejection and cancellation cannot create a position and cancel attached children", () => {
  for (const operation of ["reject", "cancel"]) {
    const broker = new DeterministicBroker();
    const ids = bracket(broker);
    broker[operation](ids.entryId);
    assert.deepEqual(broker.snapshot().positions, []);
    assert.deepEqual(broker.snapshot().openOrders, []);
  }
});

test("disconnect produces incomplete evidence and reconnect restores fresh authority", () => {
  const broker = new DeterministicBroker();
  broker.disconnect();
  const unavailable = authoritativePortfolio(broker.snapshot(), { now: 10_000 });
  assert.equal(unavailable.status, "INCOMPLETE");
  assert.ok(unavailable.missing.includes("completeBrokerSnapshot"));
  assert.throws(() => bracket(broker), /simulated_broker_disconnected/);
  broker.reconnect();
  assert.equal(authoritativePortfolio(broker.advance(1), { now: 10_001 }).status, "COMPLETE");
});

test("scheduled evidence appears only after deterministic time advances", () => {
  const broker = new DeterministicBroker();
  const ids = bracket(broker);
  broker.later(500, () => broker.accept(ids.entryId));
  assert.equal(broker.snapshot().openOrders.find((order) => order.orderId === ids.entryId).status, "PendingSubmit");
  broker.advance(499);
  assert.equal(broker.snapshot().openOrders.find((order) => order.orderId === ids.entryId).status, "PendingSubmit");
  broker.advance(1);
  assert.equal(broker.snapshot().openOrders.find((order) => order.orderId === ids.entryId).status, "Submitted");
});

test("duplicate execution callbacks are idempotent in reconciliation storage", () => {
  const broker = new DeterministicBroker();
  const ids = bracket(broker);
  const execution = broker.fill(ids.entryId, 4, 100, { executionId: "same-execution" });
  broker.repeatExecution(execution.executionId);
  const store = new BrokerReconciliationStore(":memory:");
  store.record(broker.snapshot(), { knownDecisionPrefixes: ["abcdef123456"] });
  const matching = store.listActivity().filter((item) => item.brokerIdentity === "same-execution");
  assert.equal(matching.length, 1);
  store.close();
});

test("manual broker activity remains classified as external", () => {
  const broker = new DeterministicBroker();
  broker.addExternalOrder({ symbol: "AAPL", quantity: 3 });
  const store = new BrokerReconciliationStore(":memory:");
  const result = store.record(broker.snapshot(), { knownDecisionPrefixes: ["abcdef123456"] });
  assert.equal(result.activity.length, 1);
  assert.equal(result.activity[0].ownership, "external");
  assert.equal(result.activity[0].symbol, "AAPL");
  store.close();
});

test("filled exit closes the simulated position and includes both commissions", () => {
  const broker = new DeterministicBroker({ cash: 5_000 });
  const ids = bracket(broker);
  broker.fill(ids.entryId, 4, 100, { commission: 1 });
  broker.fill(ids.targetId, 4, 110, { commission: 1.25 });
  const snapshot = broker.snapshot();
  assert.deepEqual(snapshot.positions, []);
  assert.equal(snapshot.summary.TotalCashValue.value, 5_037.75);
  assert.equal(snapshot.executions.length, 2);
  assert.deepEqual(snapshot.executions.map((item) => item.commission), [1, 1.25]);
  assert.equal(snapshot.openOrders.length, 0, "the sibling protective stop must be cancelled after the target fills");
});
