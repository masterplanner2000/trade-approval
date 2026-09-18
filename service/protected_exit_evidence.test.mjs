import assert from "node:assert/strict";
import test from "node:test";
import { assessProtectedExitEvidence } from "./protected_exit_evidence.mjs";

const parameters = { account: "SIM-PAPER", symbol: "CVX", targetId: 101, stopId: 102, requestedLimitPrice: 99, now: 10_000 };
const fixture = () => ({ ok: true, complete: true, readOnly: true, environment: "paper", account: "SIM-PAPER", capturedAt: 10_000,
  positions: [{ account: "SIM-PAPER", symbol: "CVX", quantity: 5 }],
  openOrders: [
    { permanentId: 101, account: "SIM-PAPER", symbol: "CVX", action: "SELL", orderType: "LMT", status: "Submitted", quantity: 5, limitPrice: 110 },
    { permanentId: 102, account: "SIM-PAPER", symbol: "CVX", action: "SELL", orderType: "STP", status: "PreSubmitted", quantity: 5, stopPrice: 95 },
  ], completedOrders: [], executions: [] });

const state = (snapshot) => assessProtectedExitEvidence(snapshot, parameters);

test("replacement cannot be called working before broker order evidence changes", () => {
  const input = fixture();
  assert.deepEqual(state(input), state(input), "duplicate callbacks must not change classification");
  assert.equal(state(input).reason, "replacement_not_acknowledged");
  input.openOrders[0].limitPrice = 99;
  assert.equal(state(input).state, "replacement_working");
});

test("rejection and connection loss leave no false success", () => {
  const input = fixture();
  input.openOrders[0].status = "Rejected";
  assert.equal(state(input).reason, "replacement_rejected");
  input.ok = false;
  assert.equal(state(input).state, "unknown");
  input.ok = true;
  input.capturedAt = 1;
  assert.equal(state(input).reason, "broker_evidence_stale");
});

test("partial sale cannot retain an oversized stop or target as verified", () => {
  const input = fixture();
  input.positions[0].quantity = 3;
  input.openOrders[0].quantity = 3;
  input.openOrders[0].limitPrice = 99;
  assert.equal(state(input).reason, "stop_quantity_mismatch");
  input.openOrders[1].quantity = 3;
  assert.equal(state(input).state, "replacement_working");
});

test("stop/target race cannot call a flat holding closed with an orphan sell", () => {
  const input = fixture();
  input.positions = [];
  input.openOrders[1].status = "Filled";
  assert.equal(state(input).reason, "orphan_sell_order");
  input.openOrders[0].status = "Cancelled";
  assert.equal(state(input).reason, "closure_not_confirmed");
  input.executions.push({ permanentId: 102, account: "SIM-PAPER", symbol: "CVX", side: "SLD", cumulativeQuantity: 5 });
  assert.equal(state(input).state, "closed");
  input.openOrders[0].status = "Filled";
  assert.equal(state(input).reason, "closure_not_confirmed", "two filled sells could mean an oversell");
});

test("closure requires same-account execution evidence for the full order quantity", () => {
  const input = fixture();
  input.positions = [];
  input.openOrders[0].status = "Filled";
  input.openOrders[1].status = "Cancelled";
  input.executions = [{ permanentId: 101, account: "OTHER", symbol: "CVX", side: "SLD", cumulativeQuantity: 5 }];
  assert.equal(state(input).reason, "closure_not_confirmed");
  input.executions[0].account = "SIM-PAPER";
  input.executions[0].cumulativeQuantity = 2;
  assert.equal(state(input).reason, "closure_not_confirmed");
  input.executions[0].cumulativeQuantity = 5;
  assert.equal(state(input).state, "closed");
});
