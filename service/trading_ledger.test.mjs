import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TradingLedger } from "./trading_ledger.mjs";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "trade-ledger-"));
  return { directory, path: join(directory, "ledger.sqlite3") };
}

function proposal(overrides = {}) {
  return {
    id: "proposal-1",
    createdAt: 1_000,
    expiresAt: 61_000,
    status: "pending",
    environment: "paper",
    broker: "IBKR",
    accountId: "paper-account",
    symbol: "NVDA",
    side: "buy",
    terms: { quantity: 2, limitPrice: 200, stopPrice: 190 },
    source: { strategyVersion: "momentum-v1" },
    ...overrides,
  };
}

test("proposal and approval survive reopening", () => {
  const { directory, path } = fixture();
  try {
    let ledger = new TradingLedger(path);
    ledger.recordProposal(proposal());
    ledger.recordDecision({
      id: "decision-1",
      proposalId: "proposal-1",
      decision: "approved",
      decidedAt: 2_000,
      approvalFingerprint: "sha256:exact-terms",
    });
    ledger.close();

    ledger = new TradingLedger(path);
    assert.equal(ledger.getProposal("proposal-1").status, "approved");
    assert.deepEqual(ledger.getDecision("decision-1"), {
      id: "decision-1",
      proposalId: "proposal-1",
      decision: "approved",
      decidedAt: 2_000,
      approvalFingerprint: "sha256:exact-terms",
      payload: null,
    });
    ledger.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("proposal writes are idempotent but immutable", () => {
  const ledger = new TradingLedger(":memory:");
  assert.equal(ledger.recordProposal(proposal()).created, true);
  assert.equal(ledger.recordProposal(proposal()).created, false);
  assert.throws(
    () => ledger.recordProposal(proposal({ terms: { quantity: 3, limitPrice: 200, stopPrice: 190 } })),
    /ledger_proposal_conflict/,
  );
  ledger.close();
});

test("one proposal cannot receive conflicting decisions", () => {
  const ledger = new TradingLedger(":memory:");
  ledger.recordProposal(proposal());
  const approval = { id: "decision-1", proposalId: "proposal-1", decision: "approved", decidedAt: 2_000 };
  assert.equal(ledger.recordDecision(approval).created, true);
  assert.equal(ledger.recordDecision(approval).created, false);
  assert.throws(
    () => ledger.recordDecision({ ...approval, id: "decision-2", decision: "denied" }),
    /ledger_decision_conflict/,
  );
  ledger.close();
});

test("submission idempotency survives reopening", () => {
  const { directory, path } = fixture();
  try {
    let ledger = new TradingLedger(path);
    ledger.recordProposal(proposal());
    ledger.recordDecision({ id: "decision-1", proposalId: "proposal-1", decision: "approved", decidedAt: 2_000 });
    const first = ledger.beginSubmission({
      id: "attempt-1",
      decisionId: "decision-1",
      idempotencyKey: "paper:decision-1",
      startedAt: 3_000,
    });
    assert.equal(first.created, true);
    ledger.close();

    ledger = new TradingLedger(path);
    const replay = ledger.beginSubmission({
      id: "attempt-new-id-is-ignored",
      decisionId: "decision-1",
      idempotencyKey: "paper:decision-1",
      startedAt: 9_000,
    });
    assert.equal(replay.created, false);
    assert.equal(replay.attempt.id, "attempt-1");
    ledger.completeSubmission({
      id: "attempt-1",
      status: "submitted",
      completedAt: 4_000,
      brokerOrderId: "12345",
      response: { status: "PreSubmitted" },
    });
    assert.equal(ledger.getProposal("proposal-1").status, "submitted");
    assert.deepEqual(
      ledger.listEvents("proposal-1").map(({ eventType }) => eventType),
      ["proposal_created", "proposal_approved", "submission_started", "submission_submitted"],
    );
    ledger.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("denied decisions cannot begin submissions", () => {
  const ledger = new TradingLedger(":memory:");
  ledger.recordProposal(proposal());
  ledger.recordDecision({ id: "decision-1", proposalId: "proposal-1", decision: "denied", decidedAt: 2_000 });
  assert.throws(
    () => ledger.beginSubmission({ decisionId: "decision-1", idempotencyKey: "paper:decision-1" }),
    /ledger_submission_not_approved/,
  );
  ledger.close();
});

test("proposal lifecycle status and proposal listing are durable", () => {
  const { directory, path } = fixture();
  try {
    let ledger = new TradingLedger(path);
    ledger.recordProposal(proposal());
    ledger.setProposalStatus("proposal-1", "replaced", { occurredAt: 2_000 });
    ledger.close();

    ledger = new TradingLedger(path);
    assert.equal(ledger.listProposals()[0].status, "replaced");
    assert.deepEqual(
      ledger.listEvents("proposal-1").map(({ eventType }) => eventType),
      ["proposal_created", "proposal_replaced"],
    );
    ledger.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("broker order identity is linked once and updated on later observations", () => {
  const ledger = new TradingLedger(":memory:");
  ledger.recordProposal(proposal());
  ledger.recordDecision({ id: "decision-1", proposalId: "proposal-1", decision: "approved", decidedAt: 2_000 });
  ledger.beginSubmission({ id: "attempt-1", decisionId: "decision-1", idempotencyKey: "paper:decision-1", startedAt: 3_000 });
  const order = {
    proposalId: "proposal-1",
    submissionAttemptId: "attempt-1",
    broker: "IBKR",
    accountId: "paper-account",
    brokerOrderId: "12345",
    role: "entry",
    status: "PreSubmitted",
    order: { action: "BUY", quantity: 2 },
    seenAt: 4_000,
  };
  ledger.recordBrokerOrder(order);
  ledger.recordBrokerOrder({ ...order, status: "Filled", order: { ...order.order, filled: 2 }, seenAt: 5_000 });
  const [stored] = ledger.listBrokerOrders("proposal-1");
  assert.equal(stored.status, "Filled");
  assert.equal(stored.firstSeenAt, 4_000);
  assert.equal(stored.lastSeenAt, 5_000);
  assert.equal(stored.order.filled, 2);
  ledger.close();
});

test("activity read model combines proposal, decision, submission, and broker status", () => {
  const ledger = new TradingLedger(":memory:");
  ledger.recordProposal(proposal());
  ledger.recordDecision({ id: "decision-1", proposalId: "proposal-1", decision: "approved", decidedAt: 2_000 });
  ledger.beginSubmission({ id: "attempt-1", decisionId: "decision-1", idempotencyKey: "paper:decision-1", startedAt: 3_000 });
  ledger.completeSubmission({ id: "attempt-1", status: "submitted", completedAt: 4_000, brokerOrderId: "12345" });
  ledger.recordBrokerOrder({ proposalId: "proposal-1", submissionAttemptId: "attempt-1", broker: "IBKR", accountId: "paper-account", brokerOrderId: "12345", role: "entry", status: "PreSubmitted", order: { filled: 0 }, seenAt: 5_000 });
  assert.deepEqual(ledger.listActivity(), [{
    id: "proposal-1", symbol: "NVDA", company: "NVDA", side: "buy", status: "PreSubmitted", occurredAt: 2_000,
    quantity: 2, limitPrice: 200, stopPrice: 190, targetPrice: null, targetTimeframe: null,
    researchContext: null, rationale: [], environment: "paper", brokerOrderId: "12345",
  }]);
  ledger.close();
});

test("positions include filled entries and disappear after a filled exit", () => {
  const ledger = new TradingLedger(":memory:");
  ledger.recordProposal(proposal({ terms: { quantity: 2, limitPrice: 200, stopPrice: 190, targetPrice: 220 } }));
  ledger.recordBrokerOrder({ proposalId: "proposal-1", broker: "IBKR", accountId: "paper-account", brokerOrderId: "12345", role: "entry", status: "Filled", order: { filled: 2, averageFillPrice: 199.5 }, seenAt: 5_000 });
  assert.equal(ledger.listPositions()[0].averageEntryPrice, 199.5);
  ledger.recordBrokerOrder({ proposalId: "proposal-1", broker: "IBKR", accountId: "paper-account", brokerOrderId: "12346", parentBrokerOrderId: "12345", role: "profit_target", status: "Filled", order: { filled: 2 }, seenAt: 6_000 });
  assert.deepEqual(ledger.listPositions(), []);
  ledger.close();
});

test("closed trades calculate net profit only when both commissions are known", () => {
  const ledger = new TradingLedger(":memory:");
  ledger.recordProposal(proposal({ terms: { quantity: 2, limitPrice: 200, stopPrice: 190, targetPrice: 220 } }));
  ledger.recordBrokerOrder({ proposalId: "proposal-1", broker: "IBKR", accountId: "paper-account", brokerOrderId: "1", role: "entry", status: "Filled", order: { quantity: 2, averagePrice: 199.5, commission: 1 }, seenAt: 5_000 });
  ledger.recordBrokerOrder({ proposalId: "proposal-1", broker: "IBKR", accountId: "paper-account", brokerOrderId: "2", role: "profit_target", status: "Filled", order: { quantity: 2, averagePrice: 220, commission: 1.25 }, seenAt: 6_000 });
  const [trade] = ledger.listTrades();
  assert.equal(trade.status, "closed");
  assert.equal(trade.grossProfit, 41);
  assert.equal(trade.netProfit, 38.75);
  assert.equal(trade.feesComplete, true);
  assert.equal(trade.exitReason, "profit_target");
  ledger.close();
});

test("closed trades do not present gross profit as net when fees are missing", () => {
  const ledger = new TradingLedger(":memory:");
  ledger.recordProposal(proposal({ terms: { quantity: 1, limitPrice: 100, stopPrice: 95, targetPrice: 110 } }));
  ledger.recordBrokerOrder({ proposalId: "proposal-1", broker: "IBKR", accountId: "paper-account", brokerOrderId: "1", role: "entry", status: "Filled", order: { quantity: 1, averagePrice: 100 }, seenAt: 5_000 });
  ledger.recordBrokerOrder({ proposalId: "proposal-1", broker: "IBKR", accountId: "paper-account", brokerOrderId: "2", role: "protective_stop", status: "Filled", order: { quantity: 1, averagePrice: 94 }, seenAt: 6_000 });
  const [trade] = ledger.listTrades();
  assert.equal(trade.grossProfit, -6);
  assert.equal(trade.netProfit, null);
  assert.equal(trade.feesComplete, false);
  ledger.close();
});

test("strategy budget reserves submitted entries and releases capital after an exit fill", () => {
  const ledger = new TradingLedger(":memory:");
  ledger.recordProposal(proposal({ terms: { quantity: 2, limitPrice: 200, stopPrice: 190, targetPrice: 220 } }));
  ledger.recordDecision({ id: "decision-1", proposalId: "proposal-1", decision: "approved", decidedAt: 2_000 });
  ledger.beginSubmission({ id: "attempt-1", decisionId: "decision-1", idempotencyKey: "paper:decision-1", startedAt: 3_000 });
  ledger.completeSubmission({ id: "attempt-1", status: "submitted", completedAt: 4_000 });
  assert.deepEqual(ledger.strategyBudget(1_000), { capitalLimit: 1_000, invested: 0, reserved: 400, deployed: 400, available: 600, overAllocated: false });
  ledger.recordBrokerOrder({ proposalId: "proposal-1", broker: "IBKR", accountId: "paper-account", brokerOrderId: "1", role: "entry", status: "Filled", order: { quantity: 2, averagePrice: 199 }, seenAt: 5_000 });
  assert.equal(ledger.strategyBudget(1_000).invested, 398);
  assert.equal(ledger.strategyBudget(1_000).reserved, 0);
  ledger.recordBrokerOrder({ proposalId: "proposal-1", broker: "IBKR", accountId: "paper-account", brokerOrderId: "2", role: "profit_target", status: "Filled", order: { quantity: 2, averagePrice: 220 }, seenAt: 6_000 });
  assert.equal(ledger.strategyBudget(1_000).deployed, 0);
  assert.equal(ledger.strategyBudget(1_000).available, 1_000);
  ledger.close();
});
