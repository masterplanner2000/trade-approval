import assert from "node:assert/strict";
import test from "node:test";
import { ConnectionSupervisor } from "./connection_supervisor.mjs";

test("disconnects only after the configured consecutive failures", () => {
  const supervisor = new ConnectionSupervisor({ failureThreshold: 3, clock: () => 10 });
  supervisor.success(1);
  supervisor.failure("one", 2);
  supervisor.failure("two", 3);
  assert.equal(supervisor.snapshot().state, "connected");
  const transition = supervisor.failure("three", 4);
  assert.deepEqual(transition, { from: "connected", to: "disconnected", at: 4 });
  assert.equal(supervisor.snapshot().newOrdersAllowed, false);
});

test("a successful check recovers and clears failure state", () => {
  const supervisor = new ConnectionSupervisor({ failureThreshold: 1 });
  supervisor.failure("lost", 4);
  const transition = supervisor.success(5);
  assert.deepEqual(transition, { from: "disconnected", to: "connected", at: 5 });
  assert.equal(supervisor.snapshot().consecutiveFailures, 0);
  assert.equal(supervisor.snapshot().lastError, null);
});
