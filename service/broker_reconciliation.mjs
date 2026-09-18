import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const required = (value, name) => {
  if (value === undefined || value === null || value === "") throw new Error(`reconciliation_invalid_${name}`);
  return value;
};

const json = (value) => JSON.stringify(value ?? null);
const parse = (value) => value == null ? null : JSON.parse(value);
const summaryNumber = (snapshot, tag) => {
  const value = snapshot.summary?.[tag]?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

export function proposalReference(orderRef) {
  const match = /^trade-approval-([0-9a-f-]{1,36})-(entry|target|stop)$/i.exec(orderRef ?? "");
  return match ? { decisionPrefix: match[1], role: match[2] } : null;
}

const appStyleOrderReference = (orderRef) => /^trade-approval-[0-9a-f-]{8,36}(?:-(?:entry|target|stop))?$/i.test(orderRef ?? "");

export function reconcileSnapshotToLedger(snapshot, ledger) {
  const linked = [];
  const proposals = ledger.listProposals();
  const matches = new Map();
  for (const proposal of proposals) {
    const decision = ledger.getDecisionForProposal(proposal.id);
    if (decision) {
      const prefix = decision.id.slice(0, 12);
      matches.set(prefix, matches.has(prefix) ? null : { proposal, decision });
    }
  }
  const observations = [
    ...(snapshot.openOrders ?? []).map((payload) => ({ payload, status: payload.status ?? "Open", execution: false })),
    ...(snapshot.executions ?? []).map((payload) => ({ payload, status: null, execution: true })),
  ];
  const aggregateExecution = (payload) => {
    const identity = String(payload.permanentId ?? payload.orderId);
    const executions = (snapshot.executions ?? []).filter((item) => String(item.permanentId ?? item.orderId) === identity);
    if (executions.length <= 1) return payload;
    const cumulativeQuantity = Math.max(...executions.map((item) => Number(item.cumulativeQuantity ?? item.quantity ?? 0)));
    const commissionValues = executions.map((item) => item.commission).filter((value) => typeof value === "number" && Number.isFinite(value));
    const latest = executions.at(-1);
    return {
      ...latest,
      quantity: cumulativeQuantity,
      cumulativeQuantity,
      commission: commissionValues.length === executions.length
        ? Math.round(commissionValues.reduce((sum, value) => sum + value, 0) * 1e8) / 1e8
        : undefined,
      executionIds: executions.map((item) => item.executionId),
    };
  };
  for (const observation of observations) {
    const payload = observation.execution ? aggregateExecution(observation.payload) : observation.payload;
    const reference = proposalReference(payload.orderRef);
    const match = reference ? matches.get(reference.decisionPrefix) : null;
    if (!match) continue;
    const role = reference.role === "target" ? "profit_target" : reference.role === "stop" ? "protective_stop" : "entry";
    const expectedQuantity = Number(match.proposal.terms?.quantity ?? 0);
    const cumulativeQuantity = Number(payload.cumulativeQuantity ?? payload.quantity ?? 0);
    const status = observation.execution && expectedQuantity > 0 && cumulativeQuantity < expectedQuantity
      ? "PartiallyFilled"
      : observation.status ?? "Filled";
    const brokerOrderId = payload.permanentId ?? payload.orderId;
    if (brokerOrderId == null) continue;
    const attempt = ledger.listSubmissionAttemptsForDecision(match.decision.id)[0] ?? null;
    ledger.recordBrokerOrder({
      proposalId: match.proposal.id,
      submissionAttemptId: attempt?.id ?? null,
      broker: "IBKR",
      accountId: snapshot.account,
      brokerOrderId,
      parentBrokerOrderId: payload.parentId ?? null,
      role,
      status,
      order: payload,
      seenAt: snapshot.capturedAt,
    });
    if (attempt?.status === "unknown") {
      ledger.completeSubmission({
        id: attempt.id,
        status: "submitted",
        completedAt: snapshot.capturedAt,
        brokerOrderId: String(brokerOrderId),
        response: { reconciled: true, brokerObservation: payload },
      });
    }
    ledger.appendEvent({
      eventKey: observation.payload.executionId
        ? `ibkr:execution:${observation.payload.executionId}`
        : `ibkr:order:${snapshot.account}:${brokerOrderId}:${observation.status}`,
      proposalId: match.proposal.id,
      decisionId: match.decision.id,
      submissionAttemptId: attempt?.id ?? null,
      eventType: observation.payload.executionId ? "broker_execution_reconciled" : "broker_order_reconciled",
      occurredAt: snapshot.capturedAt,
      payload,
    });
    linked.push({ proposalId: match.proposal.id, decisionId: match.decision.id, brokerOrderId: String(brokerOrderId), role, status });
  }
  return linked;
}

export function authoritativePortfolio(snapshot, { maximumAgeMs = 30_000, now = Date.now() } = {}) {
  const requiredValues = {
    netLiquidation: summaryNumber(snapshot, "NetLiquidation"),
    totalCash: summaryNumber(snapshot, "TotalCashValue"),
    availableFunds: summaryNumber(snapshot, "AvailableFunds"),
    buyingPower: summaryNumber(snapshot, "BuyingPower"),
    grossPositionValue: summaryNumber(snapshot, "GrossPositionValue"),
    maintenanceMargin: summaryNumber(snapshot, "MaintMarginReq"),
  };
  const missing = Object.entries(requiredValues).filter(([, value]) => value === null).map(([key]) => key);
  if (!snapshot.complete) missing.push("completeBrokerSnapshot");
  if (snapshot.environment !== "paper") missing.push("paperEnvironment");
  if (snapshot.readOnly !== true) missing.push("readOnlyCollection");
  if (typeof snapshot.capturedAt !== "number" || snapshot.capturedAt > now + 1_000 || now - snapshot.capturedAt > maximumAgeMs) {
    missing.push("freshSnapshot");
  }
  return {
    status: missing.length ? "INCOMPLETE" : "COMPLETE",
    environment: snapshot.environment ?? null,
    accountId: snapshot.account ?? null,
    asOf: snapshot.capturedAt ?? null,
    ...requiredValues,
    settledCash: summaryNumber(snapshot, "SettledCash"),
    unrealizedPnl: summaryNumber(snapshot, "UnrealizedPnL"),
    realizedPnl: summaryNumber(snapshot, "RealizedPnL"),
    positions: Array.isArray(snapshot.positions) ? snapshot.positions : [],
    openOrders: Array.isArray(snapshot.openOrders) ? snapshot.openOrders : [],
    executions: Array.isArray(snapshot.executions) ? snapshot.executions : [],
    missing,
  };
}

export class BrokerReconciliationStore {
  constructor(databasePath) {
    required(databasePath, "database_path");
    if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS reconciliation_runs (
        id TEXT PRIMARY KEY, broker TEXT NOT NULL, environment TEXT NOT NULL, account_id TEXT,
        captured_at INTEGER NOT NULL, recorded_at INTEGER NOT NULL, status TEXT NOT NULL,
        snapshot_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS reconciled_broker_activity (
        broker TEXT NOT NULL, environment TEXT NOT NULL, account_id TEXT NOT NULL,
        activity_type TEXT NOT NULL, broker_identity TEXT NOT NULL, symbol TEXT,
        order_ref TEXT, ownership TEXT NOT NULL, first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL, payload_json TEXT NOT NULL,
        PRIMARY KEY (broker, environment, account_id, activity_type, broker_identity)
      ) STRICT;
    `);
    // Older builds labelled an app-referenced order "external" whenever its
    // decision was absent from the new ledger. Preserve the missing link, but
    // do not misclassify a recognizable pre-ledger app order as a manual trade.
    const legacy = this.database.prepare("SELECT broker, environment, account_id, activity_type, broker_identity, order_ref FROM reconciled_broker_activity WHERE ownership = 'external'").all();
    const revise = this.database.prepare("UPDATE reconciled_broker_activity SET ownership = 'legacy_application_unlinked' WHERE broker = ? AND environment = ? AND account_id = ? AND activity_type = ? AND broker_identity = ?");
    for (const row of legacy) {
      if (appStyleOrderReference(row.order_ref)) revise.run(row.broker, row.environment, row.account_id, row.activity_type, row.broker_identity);
    }
  }

  record(snapshot, { knownDecisionPrefixes = [] } = {}) {
    const portfolio = authoritativePortfolio(snapshot);
    const runId = randomUUID();
    const recordedAt = Date.now();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        INSERT INTO reconciliation_runs
          (id, broker, environment, account_id, captured_at, recorded_at, status, snapshot_json)
        VALUES (?, 'IBKR', ?, ?, ?, ?, ?, ?)
      `).run(runId, snapshot.environment, snapshot.account, snapshot.capturedAt, recordedAt, portfolio.status, json(snapshot));

      const known = new Set(knownDecisionPrefixes);
      const activity = [
        ...(snapshot.openOrders ?? []).map((payload) => ({ type: "order", identity: String(payload.permanentId ?? payload.orderId), payload })),
        ...(snapshot.executions ?? []).map((payload) => ({ type: "execution", identity: String(payload.executionId), payload })),
      ];
      for (const item of activity) {
        const reference = proposalReference(item.payload.orderRef);
        const ownership = reference && known.has(reference.decisionPrefix) ? "application"
          : appStyleOrderReference(item.payload.orderRef) ? "legacy_application_unlinked" : "external";
        this.database.prepare(`
          INSERT INTO reconciled_broker_activity
            (broker, environment, account_id, activity_type, broker_identity, symbol, order_ref,
             ownership, first_seen_at, last_seen_at, payload_json)
          VALUES ('IBKR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (broker, environment, account_id, activity_type, broker_identity) DO UPDATE SET
            symbol = excluded.symbol, order_ref = excluded.order_ref, ownership = excluded.ownership,
            last_seen_at = excluded.last_seen_at, payload_json = excluded.payload_json
        `).run(snapshot.environment, snapshot.account, item.type, item.identity, item.payload.symbol ?? null,
          item.payload.orderRef ?? null, ownership, snapshot.capturedAt, snapshot.capturedAt, json(item.payload));
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { runId, portfolio, activity: this.listActivity() };
  }

  latest() {
    const row = this.database.prepare("SELECT * FROM reconciliation_runs ORDER BY captured_at DESC, rowid DESC LIMIT 1").get();
    if (!row) return null;
    return { id: row.id, broker: row.broker, environment: row.environment, accountId: row.account_id,
      capturedAt: row.captured_at, recordedAt: row.recorded_at, status: row.status, snapshot: parse(row.snapshot_json) };
  }

  listActivity() {
    return this.database.prepare("SELECT * FROM reconciled_broker_activity ORDER BY last_seen_at DESC, rowid DESC").all().map((row) => ({
      type: row.activity_type, brokerIdentity: row.broker_identity, symbol: row.symbol,
      orderRef: row.order_ref, ownership: row.ownership, firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at, payload: parse(row.payload_json),
    }));
  }

  close() { this.database.close(); }
}
