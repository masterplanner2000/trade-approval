import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProtectedExitOutbox } from "./protected_exit_outbox.mjs";
import { DeterministicBroker } from "./testing/deterministic_broker.mjs";

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "protected-exit-outbox-"));
  const path = join(directory, "exit.sqlite3");
  const broker = new DeterministicBroker();
  const ids = broker.submitBracket({ symbol: "CVX", quantity: 5, limitPrice: 100,
    stopPrice: 95, targetPrice: 110, decisionId: "simulated-only" });
  broker.fill(ids.entryId, 5, 100);
  const terms = { account: broker.account, symbol: "CVX", requestId: "exit-1",
    targetId: broker.orders.get(ids.targetId).permanentId,
    stopId: broker.orders.get(ids.stopId).permanentId,
    requestedLimitPrice: 99 };
  return { directory, path, broker, ids, terms, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

const prepare = (outbox, broker, terms) => outbox.prepare({ snapshot: broker.snapshot(), now: broker.now, ...terms });
const reconcile = (outbox, broker, requestId = "exit-1") => outbox.reconcile(requestId, broker.snapshot(), { now: broker.now });

test("crash before dispatch preserves one prepared command; claim commits before send", () => {
  const { directory, path, broker, terms, cleanup } = setup();
  try {
    let outbox = new ProtectedExitOutbox(path);
    assert.equal(prepare(outbox, broker, terms).created, true);
    outbox.close();
    outbox = new ProtectedExitOutbox(path);
    assert.equal(prepare(outbox, broker, terms).created, false);
    const first = outbox.claimForDispatch(terms.requestId, { snapshot: broker.snapshot(), now: broker.now });
    assert.equal(first.claimed, true);
    assert.equal(first.command.kind, "replace_target");
    assert.equal(first.intent.phase, "transmission_unknown");
    assert.equal(outbox.claimForDispatch(terms.requestId).claimed, false);
    outbox.close();
  } finally { cleanup(); }
});

test("crash after claim but before send cannot trigger a blind resend", () => {
  const { path, broker, terms, cleanup } = setup();
  try {
    let outbox = new ProtectedExitOutbox(path);
    prepare(outbox, broker, terms);
    outbox.claimForDispatch(terms.requestId, { snapshot: broker.snapshot(), now: broker.now });
    outbox.close();
    outbox = new ProtectedExitOutbox(path);
    assert.equal(reconcile(outbox, broker).phase, "unknown");
    assert.equal(outbox.claimForDispatch(terms.requestId).claimed, false);
    assert.equal(broker.orders.get(1_002).status, "Submitted", "the original stop remains active");
    outbox.close();
  } finally { cleanup(); }
});

test("dispatch claim requires a fresh protected broker snapshot", () => {
  const { path, broker, ids, terms, cleanup } = setup();
  try {
    const outbox = new ProtectedExitOutbox(path);
    prepare(outbox, broker, terms);
    broker.advance(6_000);
    const stale = { ...broker.snapshot(), capturedAt: broker.now - 6_000 };
    assert.equal(outbox.claimForDispatch(terms.requestId, { snapshot: stale, now: broker.now }).claimed, false);
    assert.equal(outbox.get(terms.requestId).phase, "prepared");
    broker.addExternalOrder({ symbol: "CVX", action: "SELL", quantity: 5 });
    assert.equal(outbox.claimForDispatch(terms.requestId, { snapshot: broker.snapshot(), now: broker.now }).claimed, false);
    broker.removeOrder(ids.targetId);
    assert.equal(outbox.claimForDispatch(terms.requestId, { snapshot: broker.snapshot(), now: broker.now }).claimed, false);
    outbox.close();
  } finally { cleanup(); }
});

test("lost acknowledgement is recovered from broker evidence after restart", () => {
  const { path, broker, ids, terms, cleanup } = setup();
  try {
    let outbox = new ProtectedExitOutbox(path);
    prepare(outbox, broker, terms);
    const claimed = outbox.claimForDispatch(terms.requestId, { snapshot: broker.snapshot(), now: broker.now });
    broker.requestTargetReplacement({ orderId: ids.targetId, limitPrice: claimed.command.limitPrice,
      requestId: claimed.command.requestId });
    outbox.close();
    broker.resolveTargetReplacement(terms.requestId, "Accepted");
    outbox = new ProtectedExitOutbox(path);
    assert.equal(reconcile(outbox, broker).phase, "working");
    assert.equal(reconcile(outbox, broker).phase, "working");
    assert.equal(outbox.claimForDispatch(terms.requestId).claimed, false);
    outbox.close();
  } finally { cleanup(); }
});

test("rejected modification remains blocked while original target and stop stay active", () => {
  const { path, broker, ids, terms, cleanup } = setup();
  try {
    const outbox = new ProtectedExitOutbox(path);
    prepare(outbox, broker, terms);
    outbox.claimForDispatch(terms.requestId, { snapshot: broker.snapshot(), now: broker.now });
    broker.requestTargetReplacement({ orderId: ids.targetId, limitPrice: 99, requestId: terms.requestId });
    broker.resolveTargetReplacement(terms.requestId, "Rejected");
    assert.equal(reconcile(outbox, broker).phase, "blocked");
    assert.equal(broker.orders.get(ids.targetId).limitPrice, 110);
    assert.equal(broker.orders.get(ids.stopId).status, "Submitted");
    assert.equal(outbox.claimForDispatch(terms.requestId).claimed, false);
    broker.replacementResults = []; // A later broker snapshot may omit the old rejection.
    assert.equal(reconcile(outbox, broker).phase, "blocked");
    assert.equal(outbox.claimForDispatch(terms.requestId, { snapshot: broker.snapshot(), now: broker.now }).claimed, false);
    outbox.close();
  } finally { cleanup(); }
});

test("a previously working replacement that disappears cannot rearm dispatch", () => {
  const { path, broker, ids, terms, cleanup } = setup();
  try {
    const outbox = new ProtectedExitOutbox(path);
    prepare(outbox, broker, terms);
    outbox.claimForDispatch(terms.requestId, { snapshot: broker.snapshot(), now: broker.now });
    broker.requestTargetReplacement({ orderId: ids.targetId, limitPrice: 99, requestId: terms.requestId });
    broker.resolveTargetReplacement(terms.requestId, "Accepted");
    assert.equal(reconcile(outbox, broker).phase, "working");
    broker.orders.get(ids.targetId).limitPrice = 110;
    assert.equal(reconcile(outbox, broker).phase, "unknown");
    assert.equal(outbox.claimForDispatch(terms.requestId, { snapshot: broker.snapshot(), now: broker.now }).claimed, false);
    outbox.close();
  } finally { cleanup(); }
});

test("partial sale, disconnect and restart cannot be mistaken for protected or closed", () => {
  const { path, broker, ids, terms, cleanup } = setup();
  try {
    let outbox = new ProtectedExitOutbox(path);
    prepare(outbox, broker, terms);
    outbox.claimForDispatch(terms.requestId, { snapshot: broker.snapshot(), now: broker.now });
    broker.requestTargetReplacement({ orderId: ids.targetId, limitPrice: 99, requestId: terms.requestId });
    broker.resolveTargetReplacement(terms.requestId, "Accepted");
    assert.equal(reconcile(outbox, broker).phase, "working");
    broker.fill(ids.targetId, 2, 99);
    assert.equal(reconcile(outbox, broker).state.reason, "stop_quantity_mismatch");
    outbox.close();
    broker.disconnect();
    outbox = new ProtectedExitOutbox(path);
    assert.equal(reconcile(outbox, broker).phase, "unknown");
    broker.reconnect();
    assert.equal(reconcile(outbox, broker).phase, "blocked");
    assert.equal(outbox.claimForDispatch(terms.requestId).claimed, false);
    outbox.close();
  } finally { cleanup(); }
});

test("stop wins race and terminal evidence closes request without duplicate dispatch", () => {
  const { path, broker, ids, terms, cleanup } = setup();
  try {
    const outbox = new ProtectedExitOutbox(path);
    prepare(outbox, broker, terms);
    outbox.claimForDispatch(terms.requestId, { snapshot: broker.snapshot(), now: broker.now });
    broker.fill(ids.stopId, 5, 95);
    assert.equal(reconcile(outbox, broker).phase, "closed");
    assert.equal(outbox.listUnresolved().length, 0);
    assert.equal(outbox.claimForDispatch(terms.requestId).claimed, false);
    outbox.close();
  } finally { cleanup(); }
});

test("another active request for the same account/symbol cannot be prepared", () => {
  const { path, broker, terms, cleanup } = setup();
  try {
    const outbox = new ProtectedExitOutbox(path);
    prepare(outbox, broker, terms);
    assert.throws(() => prepare(outbox, broker, { ...terms, requestId: "exit-2" }), /UNIQUE constraint failed/);
    assert.equal(outbox.listUnresolved().length, 1);
    outbox.close();
  } finally { cleanup(); }
});
