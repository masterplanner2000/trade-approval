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
