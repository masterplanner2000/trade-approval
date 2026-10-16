import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const token = "integration-test-token";
let directory;
let child;
let baseUrl;

const freePort = () => new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

async function request(path, { method = "GET", json } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "x-app-token": token, ...(json ? { "content-type": "application/json" } : {}) },
    body: json ? JSON.stringify(json) : undefined,
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

async function waitUntilReady() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await request("/health");
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("simulated service did not start");
}

async function prepareApprovedProposal(symbol) {
  assert.equal((await request("/broker/reconcile", { method: "POST" })).status, 200);
  const created = await request("/__test/proposals", { method: "POST", json: { symbol } });
  assert.equal(created.status, 201);
  const decided = await request(`/proposals/${created.payload.proposal.id}/decision`, { method: "POST", json: { decision: "approved" } });
  assert.equal(decided.status, 200);
  const tokenValue = decided.payload.approval.token;
  assert.equal((await request("/orders/preview", { method: "POST", json: { token: tokenValue } })).status, 200);
  assert.equal((await request("/orders/what-if", { method: "POST", json: { token: tokenValue } })).status, 200);
  return { proposal: created.payload.proposal, token: tokenValue };
}

before(async () => {
  directory = mkdtempSync(join(tmpdir(), "trade-service-integration-"));
  writeFileSync(join(directory, "strategy.json"), JSON.stringify({
    id: "integration-strategy", name: "Integration Strategy", status: "active",
    capitalLimit: 5_000, perTradeLimit: 1_000, maxOpenPositions: 5,
    maxLossPerTrade: 75, expectedHoldingPeriod: "1–3 trading days",
    currentExposure: 0, universeSource: "alpaca-cache", universeLimit: 500,
    nextUniverseIndex: 0, completed: [],
  }));
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["service/server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TRADE_APPROVAL_PORT: String(port),
      TRADE_APPROVAL_HOST: "127.0.0.1",
      TRADE_APPROVAL_APP_TOKEN: token,
      TRADE_APPROVAL_BROKER_MODE: "simulated",
      IBKR_ENABLE_WHAT_IF: "true",
      IBKR_ENABLE_PAPER_SUBMIT: "true",
      IBKR_ENABLE_AUTOMATIC_SELLS: "true",
      IBKR_ENABLE_RECONCILIATION: "false",
      APPROVAL_SIGNING_SECRET: "integration-only-signing-secret",
      TRADE_LEDGER_PATH: join(directory, "ledger.sqlite3"),
      STRATEGY_STATE_PATH: join(directory, "strategy.json"),
      SHADOW_LEDGER_PATH: join(directory, "shadow.json"),
      RISK_POLICY_PATH: join(directory, "risk.json"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitUntilReady();
});

after(() => {
  child?.kill("SIGTERM");
  rmSync(directory, { recursive: true, force: true });
});

test("an automatic-sell environment toggle cannot bypass the release hold", async () => {
  const health = await request("/health");
  assert.equal(health.status, 200);
  assert.equal(health.payload.automaticPaperSellsRequested, true);
  assert.equal(health.payload.automaticPaperSellsEnabled, false);
  assert.equal(health.payload.automaticPaperSellsBlocker, "protected_exit_lifecycle_not_ready");
});

test("HTTP lifecycle records submission, partial fill, full fill and closed trade", async () => {
  const prepared = await prepareApprovedProposal("NVDA");
  const submitted = await request("/orders/submit-paper", { method: "POST", json: { token: prepared.token } });
  assert.equal(submitted.status, 200);
  const { orderId: entryId } = submitted.payload.submission.result;
  const targetId = submitted.payload.submission.exitOrders[0].orderId;

  await request("/__test/broker-events", { method: "POST", json: { type: "fill", orderId: entryId, quantity: 2, price: 99, commission: 0.5 } });
  assert.equal((await request("/broker/reconcile", { method: "POST" })).status, 200);
  let positions = await request("/positions");
  assert.equal(positions.payload.items[0].quantity, 2);

  await request("/__test/broker-events", { method: "POST", json: { type: "fill", orderId: entryId, quantity: 3, price: 100, commission: 0.5 } });
  await request("/broker/reconcile", { method: "POST" });
  positions = await request("/positions");
  assert.equal(positions.payload.items[0].quantity, 5);

  await request("/__test/broker-events", { method: "POST", json: { type: "fill", orderId: targetId, quantity: 5, price: 110, commission: 1 } });
  await request("/broker/reconcile", { method: "POST" });
  const trades = await request("/trades");
  assert.equal(trades.payload.items[0].status, "closed");
  assert.equal(trades.payload.items[0].exitReason, "profit_target");
  assert.equal(trades.payload.items[0].entryFee, 1);
  assert.equal(trades.payload.items[0].exitFee, 1);
  assert.equal(trades.payload.items[0].feesComplete, true);
  assert.deepEqual((await request("/positions")).payload.items, []);
});

test("HTTP lifecycle resolves disconnect-after-transmission without resubmitting", async () => {
  const prepared = await prepareApprovedProposal("AAPL");
  await request("/__test/broker-events", { method: "POST", json: { type: "disconnect_after_submit" } });
  const uncertain = await request("/orders/submit-paper", { method: "POST", json: { token: prepared.token } });
  assert.equal(uncertain.status, 503);
  assert.equal(uncertain.payload.error, "broker_unavailable_submission_outcome_unknown");

  await request("/__test/broker-events", { method: "POST", json: { type: "reconnect" } });
  const reconciliation = await request("/broker/reconcile", { method: "POST" });
  assert.equal(reconciliation.status, 200);
  assert.ok(reconciliation.payload.linkedOrders.some((order) => order.role === "entry"));

  const replay = await request("/orders/submit-paper", { method: "POST", json: { token: prepared.token } });
  assert.equal(replay.status, 200);
  assert.equal(replay.payload.replayed, true);
});

test("HTTP Activity visibly includes manual broker activity", async () => {
  await request("/__test/broker-events", { method: "POST", json: { type: "external_order", symbol: "MSFT", quantity: 3 } });
  await request("/broker/reconcile", { method: "POST" });
  const activity = await request("/activity");
  const external = activity.payload.items.find((item) => item.id.startsWith("external:"));
  assert.equal(external.symbol, "MSFT");
  assert.equal(external.status, "Submitted");
});

test("broker-confirmed rejected and cancelled entries create no holding and release reserved capital", async () => {
  for (const [symbol, event, expectedStatus] of [
    ["QCOM", "reject", "Rejected"],
    ["NOW", "cancel", "Cancelled"],
  ]) {
    const prepared = await prepareApprovedProposal(symbol);
    const submitted = await request("/orders/submit-paper", { method: "POST", json: { token: prepared.token } });
    assert.equal(submitted.status, 200);
    const orderId = submitted.payload.submission.result.orderId;
    const reservedBefore = (await request("/strategy")).payload.strategy.budget.reserved;
    assert.ok(reservedBefore > 0);

    assert.equal((await request("/__test/broker-events", { method: "POST", json: { type: event, orderId } })).status, 200);
    assert.equal((await request("/broker/reconcile", { method: "POST" })).status, 200);
    const activity = await request("/activity");
    assert.equal(activity.payload.items.find((item) => item.id === prepared.proposal.id)?.status, expectedStatus);
    assert.equal((await request("/positions")).payload.items.some((item) => item.symbol === symbol), false);
    const reservedAfter = (await request("/strategy")).payload.strategy.budget.reserved;
    assert.ok(reservedAfter < reservedBefore, `${symbol} should release its entry reservation`);
  }
});

test("missing linked protection is visible and blocks new strategy capacity", async () => {
  const prepared = await prepareApprovedProposal("TSLA");
  const submitted = await request("/orders/submit-paper", { method: "POST", json: { token: prepared.token } });
  assert.equal(submitted.status, 200);
  const entryId = submitted.payload.submission.result.orderId;
  const targetId = submitted.payload.submission.exitOrders[0].orderId;
  const stopId = submitted.payload.submission.exitOrders[1].orderId;
  await request("/__test/broker-events", { method: "POST", json: { type: "fill", orderId: entryId, quantity: 5, price: 100 } });
  await request("/broker/reconcile", { method: "POST" });
  let positions = await request("/positions");
  const owned = positions.payload.items.find((item) => item.symbol === "TSLA");
  assert.equal(owned.ownership, "strategy_owned");
  assert.equal(owned.protection, "verified");

  await request("/__test/broker-events", { method: "POST", json: { type: "fill", orderId: targetId, quantity: 2, price: 110 } });
  await request("/broker/reconcile", { method: "POST" });
  positions = await request("/positions");
  const partiallyExited = positions.payload.items.find((item) => item.symbol === "TSLA");
  assert.equal(partiallyExited.quantity, 3);
  assert.equal(partiallyExited.protection, "overcovered", "five-share stop must not verify a three-share position");
  assert.equal((await request("/strategy")).payload.strategy.budget.available, 0);

  const manual = await request("/__test/broker-events", { method: "POST",
    json: { type: "external_order", symbol: "TSLA", action: "BUY", quantity: 1 } });
  const manualOrder = manual.payload.snapshot.openOrders.find((order) => order.role === "external" && order.symbol === "TSLA");
  await request("/__test/broker-events", { method: "POST", json: { type: "cancel", orderId: manualOrder.orderId } });
  await request("/broker/reconcile", { method: "POST" });
  assert.equal((await request("/positions")).payload.items.find((item) => item.symbol === "TSLA").ownership,
    "strategy_owned", "an unfilled cancelled manual order must not change share provenance");

  await request("/__test/broker-events", { method: "POST", json: { type: "remove_order", orderId: stopId } });
  await request("/broker/reconcile", { method: "POST" });
  positions = await request("/positions");
  assert.equal(positions.payload.items.find((item) => item.symbol === "TSLA").protection, "missing");
  const strategy = await request("/strategy");
  assert.equal(strategy.payload.strategy.budget.status, "protection_incomplete");
  assert.equal(strategy.payload.strategy.budget.available, 0);
});
