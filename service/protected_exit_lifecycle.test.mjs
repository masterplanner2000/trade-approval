import assert from "node:assert/strict";
import test from "node:test";
import { advanceProtectedExitLifecycle } from "./protected_exit_lifecycle.mjs";
import { DeterministicBroker } from "./testing/deterministic_broker.mjs";

function setup() {
  const broker = new DeterministicBroker();
  const ids = broker.submitBracket({ symbol: "CVX", quantity: 5, limitPrice: 100,
    stopPrice: 95, targetPrice: 110, decisionId: "simulated-only" });
  broker.fill(ids.entryId, 5, 100);
  const terms = { account: broker.account, symbol: "CVX", requestId: "exit-1",
    targetId: broker.orders.get(ids.targetId).permanentId,
    stopId: broker.orders.get(ids.stopId).permanentId,
    requestedLimitPrice: 99 };
  const advance = (previous, snapshot = broker.snapshot()) => advanceProtectedExitLifecycle(previous,
    { snapshot, ...terms, now: broker.now });
  return { broker, ids, terms, advance };
}

test("replacement is issued once; only broker-confirmed terms become working", () => {
  const { broker, ids, advance } = setup();
  const start = advance(null);
  assert.equal(start.state.phase, "awaiting_ack");
  assert.equal(start.commands.length, 1);
  broker.requestTargetReplacement({ orderId: ids.targetId, limitPrice: 99, requestId: "exit-1" });
  assert.equal(advance(start.state).commands.length, 0);
  assert.equal(broker.orders.get(ids.stopId).status, "Submitted", "old stop remains active");
  broker.resolveTargetReplacement("exit-1", "Accepted");
  assert.equal(advance(start.state).state.phase, "working");
  assert.equal(advance(start.state).commands.length, 0);
});

test("rejection preserves the old target and stop but cannot claim new exit working", () => {
  const { broker, ids, advance } = setup();
  const start = advance(null);
  broker.requestTargetReplacement({ orderId: ids.targetId, limitPrice: 99, requestId: "exit-1" });
  broker.resolveTargetReplacement("exit-1", "Rejected");
  const result = advance(start.state);
  assert.equal(result.state.phase, "blocked");
  assert.equal(result.state.reason, "replacement_rejected");
  assert.equal(broker.orders.get(ids.targetId).limitPrice, 110);
  assert.equal(broker.orders.get(ids.stopId).status, "Submitted");
  assert.deepEqual(result.commands, []);
});

test("disconnect and JSON restart do not retransmit an uncertain replacement", () => {
  const { broker, ids, advance } = setup();
  const start = advance(null);
  broker.requestTargetReplacement({ orderId: ids.targetId, limitPrice: 99, requestId: "exit-1" });
  broker.disconnect();
  const lost = advance(start.state);
  assert.equal(lost.state.phase, "unknown");
  assert.deepEqual(lost.commands, []);
  const restored = JSON.parse(JSON.stringify(lost.state));
  broker.reconnect();
  assert.equal(advance(restored).state.phase, "unknown");
  assert.deepEqual(advance(restored).commands, []);
  broker.resolveTargetReplacement("exit-1", "Accepted");
  assert.equal(advance(restored).state.phase, "working");
});

test("partial target fill with oversized sibling stop fails closed", () => {
  const { broker, ids, advance } = setup();
  const start = advance(null);
  broker.requestTargetReplacement({ orderId: ids.targetId, limitPrice: 99, requestId: "exit-1" });
  broker.resolveTargetReplacement("exit-1", "Accepted");
  broker.fill(ids.targetId, 2, 99);
  const result = advance(start.state);
  assert.equal(result.state.phase, "blocked");
  assert.equal(result.state.reason, "stop_quantity_mismatch");
  assert.equal(broker.snapshot().positions[0].quantity, 3);
  assert.equal(broker.orders.get(ids.stopId).quantity, 5);
});

test("stop wins before replacement acknowledgement; closure requires sibling cancellation and execution", () => {
  const { broker, ids, advance } = setup();
  const start = advance(null);
  broker.requestTargetReplacement({ orderId: ids.targetId, limitPrice: 99, requestId: "exit-1" });
  broker.fill(ids.stopId, 5, 95);
  const closed = advance(start.state);
  assert.equal(closed.state.phase, "closed");
  assert.equal(broker.orders.get(ids.targetId).status, "Cancelled");
  assert.deepEqual(closed.commands, []);
  assert.throws(() => broker.resolveTargetReplacement("exit-1", "Accepted"), /target_no_longer_active/);
});

test("a flat position and exact execution confirm closure when IBKR reports completed quantity as zero", () => {
  const { broker, ids, advance } = setup();
  const start = advance(null);
  broker.requestTargetReplacement({ orderId: ids.targetId, limitPrice: 99, requestId: "exit-1" });
  broker.resolveTargetReplacement("exit-1", "Accepted");
  broker.fill(ids.targetId, 5, 99);
  const snapshot = broker.snapshot();
  const target = snapshot.completedOrders.find((order) => order.orderId === ids.targetId);
  target.quantity = 0;
  assert.equal(advance(start.state, snapshot).state.phase, "closed");
});

test("partial target/stop race and duplicate callbacks cannot prove safe closure", () => {
  const { broker, ids, advance } = setup();
  const start = advance(null);
  broker.requestTargetReplacement({ orderId: ids.targetId, limitPrice: 99, requestId: "exit-1" });
  broker.resolveTargetReplacement("exit-1", "Accepted");
  const sale = broker.fill(ids.targetId, 2, 99);
  broker.repeatExecution(sale.executionId);
  broker.fill(ids.stopId, 3, 95);
  assert.equal(advance(start.state).state.reason, "orphan_sell_order");
  broker.cancel(ids.targetId);
  broker.cancel(ids.stopId);
  assert.equal(advance(start.state).state.reason, "closure_not_confirmed");
});

test("extra working sell and changed intent are rejected without issuing another command", () => {
  const { broker, terms, advance } = setup();
  const start = advance(null);
  broker.addExternalOrder({ symbol: "CVX", action: "SELL", quantity: 5 });
  assert.equal(advance(start.state).state.reason, "other_working_sell_order");
  const changed = advanceProtectedExitLifecycle(start.state, { snapshot: broker.snapshot(), ...terms,
    requestedLimitPrice: 98, now: broker.now });
  assert.equal(changed.state.requestedLimitPrice, 99);
  assert.deepEqual(changed.commands, []);
});
