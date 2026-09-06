import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const FINAL_ATTEMPT_STATUSES = new Set(["submitted", "failed", "blocked"]);
const DECISIONS = new Set(["approved", "denied", "expired"]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function parseJson(value) {
  return value == null ? null : JSON.parse(value);
}

function required(value, name) {
  if (value === undefined || value === null || value === "") throw new Error(`ledger_invalid_${name}`);
  return value;
}

function normalizeProposal(row) {
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    status: row.status,
    environment: row.environment,
    broker: row.broker,
    accountId: row.account_id,
    symbol: row.symbol,
    side: row.side,
    terms: parseJson(row.terms_json),
    source: parseJson(row.source_json),
  };
}

function normalizeDecision(row) {
  if (!row) return null;
  return {
    id: row.id,
    proposalId: row.proposal_id,
    decision: row.decision,
    decidedAt: row.decided_at,
    approvalFingerprint: row.approval_fingerprint,
    payload: parseJson(row.payload_json),
  };
}

function normalizeAttempt(row) {
  if (!row) return null;
  return {
    id: row.id,
    decisionId: row.decision_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    brokerOrderId: row.broker_order_id,
    errorCode: row.error_code,
    response: parseJson(row.response_json),
  };
}

export class TradingLedger {
  constructor(databasePath, { clock = () => Date.now() } = {}) {
    required(databasePath, "database_path");
    if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
    this.clock = clock;
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
    this.migrate();
  }

  migrate() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS ledger_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      INSERT OR IGNORE INTO ledger_metadata (key, value) VALUES ('schema_version', '1');

      CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'submitted', 'blocked', 'replaced')),
        environment TEXT NOT NULL,
        broker TEXT NOT NULL,
        account_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
        terms_json TEXT NOT NULL,
        source_json TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL UNIQUE REFERENCES proposals(id),
        decision TEXT NOT NULL CHECK (decision IN ('approved', 'denied', 'expired')),
        decided_at INTEGER NOT NULL,
        approval_fingerprint TEXT,
        payload_json TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS submission_attempts (
        id TEXT PRIMARY KEY,
        decision_id TEXT NOT NULL REFERENCES decisions(id),
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('started', 'submitted', 'failed', 'blocked', 'unknown')),
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        broker_order_id TEXT,
        error_code TEXT,
        response_json TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS broker_orders (
        id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL REFERENCES proposals(id),
        submission_attempt_id TEXT REFERENCES submission_attempts(id),
        broker TEXT NOT NULL,
        account_id TEXT NOT NULL,
        broker_order_id TEXT NOT NULL,
        parent_broker_order_id TEXT,
        role TEXT NOT NULL CHECK (role IN ('entry', 'protective_stop', 'profit_target', 'exit')),
        status TEXT NOT NULL,
        order_json TEXT NOT NULL,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        UNIQUE (broker, account_id, broker_order_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS ledger_events (
        id TEXT PRIMARY KEY,
        event_key TEXT UNIQUE,
        proposal_id TEXT REFERENCES proposals(id),
        decision_id TEXT REFERENCES decisions(id),
        submission_attempt_id TEXT REFERENCES submission_attempts(id),
        event_type TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        payload_json TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS submission_attempts_decision_idx ON submission_attempts(decision_id);
      CREATE INDEX IF NOT EXISTS broker_orders_proposal_idx ON broker_orders(proposal_id);
      CREATE INDEX IF NOT EXISTS ledger_events_proposal_idx ON ledger_events(proposal_id, occurred_at);
    `);
  }

  transaction(operation) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  recordProposal(proposal) {
    const record = {
      id: required(proposal.id, "proposal_id"),
      createdAt: required(proposal.createdAt, "proposal_created_at"),
      expiresAt: proposal.expiresAt ?? null,
      status: proposal.status ?? "pending",
      environment: required(proposal.environment, "proposal_environment"),
      broker: required(proposal.broker, "proposal_broker"),
      accountId: required(proposal.accountId, "proposal_account_id"),
      symbol: required(proposal.symbol, "proposal_symbol"),
      side: required(proposal.side, "proposal_side").toLowerCase(),
      terms: required(proposal.terms, "proposal_terms"),
      source: proposal.source ?? null,
    };
    return this.transaction(() => {
      const existing = this.getProposal(record.id);
      if (existing) {
        if (stableJson(existing) !== stableJson(record)) throw new Error("ledger_proposal_conflict");
        return { created: false, proposal: existing };
      }
      this.database.prepare(`
        INSERT INTO proposals
          (id, created_at, expires_at, status, environment, broker, account_id, symbol, side, terms_json, source_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(record.id, record.createdAt, record.expiresAt, record.status, record.environment,
        record.broker, record.accountId, record.symbol, record.side, stableJson(record.terms),
        record.source == null ? null : stableJson(record.source));
      this.appendEvent({
        eventKey: `proposal:${record.id}:created`, proposalId: record.id,
        eventType: "proposal_created", occurredAt: record.createdAt,
      });
      return { created: true, proposal: record };
    });
  }

  getProposal(id) {
    return normalizeProposal(this.database.prepare("SELECT * FROM proposals WHERE id = ?").get(id));
  }

  listProposals() {
    return this.database.prepare("SELECT * FROM proposals ORDER BY created_at, rowid").all().map(normalizeProposal);
  }

  setProposalStatus(id, status, { occurredAt = this.clock(), payload = null } = {}) {
    const allowed = new Set(["pending", "approved", "denied", "expired", "submitted", "blocked", "replaced"]);
    if (!allowed.has(status)) throw new Error("ledger_invalid_proposal_status");
    return this.transaction(() => {
      const proposal = this.getProposal(id);
      if (!proposal) throw new Error("ledger_proposal_not_found");
      if (proposal.status === status) return { updated: false, proposal };
      this.database.prepare("UPDATE proposals SET status = ? WHERE id = ?").run(status, id);
      this.appendEvent({
        eventKey: `proposal:${id}:status:${status}`,
        proposalId: id,
        eventType: `proposal_${status}`,
        occurredAt,
        payload,
      });
      return { updated: true, proposal: this.getProposal(id) };
    });
  }

  recordDecision({ id, proposalId, decision, decidedAt = this.clock(), approvalFingerprint = null, payload = null }) {
    required(id, "decision_id");
    required(proposalId, "decision_proposal_id");
    if (!DECISIONS.has(decision)) throw new Error("ledger_invalid_decision");
    return this.transaction(() => {
      const proposal = this.getProposal(proposalId);
      if (!proposal) throw new Error("ledger_proposal_not_found");
      const existing = normalizeDecision(this.database.prepare("SELECT * FROM decisions WHERE proposal_id = ?").get(proposalId));
      const record = { id, proposalId, decision, decidedAt, approvalFingerprint, payload };
      if (existing) {
        if (stableJson(existing) !== stableJson(record)) throw new Error("ledger_decision_conflict");
        return { created: false, decision: existing };
      }
      this.database.prepare(`
        INSERT INTO decisions (id, proposal_id, decision, decided_at, approval_fingerprint, payload_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, proposalId, decision, decidedAt, approvalFingerprint, payload == null ? null : stableJson(payload));
      this.database.prepare("UPDATE proposals SET status = ? WHERE id = ?").run(decision, proposalId);
      this.appendEvent({
        eventKey: `decision:${id}`, proposalId, decisionId: id,
        eventType: `proposal_${decision}`, occurredAt: decidedAt, payload,
      });
      return { created: true, decision: record };
    });
  }

  getDecision(id) {
    return normalizeDecision(this.database.prepare("SELECT * FROM decisions WHERE id = ?").get(id));
  }

  getDecisionForProposal(proposalId) {
    return normalizeDecision(this.database.prepare("SELECT * FROM decisions WHERE proposal_id = ?").get(proposalId));
  }

  beginSubmission({ id = randomUUID(), decisionId, idempotencyKey, startedAt = this.clock() }) {
    required(decisionId, "submission_decision_id");
    required(idempotencyKey, "submission_idempotency_key");
    return this.transaction(() => {
      const existing = normalizeAttempt(this.database.prepare("SELECT * FROM submission_attempts WHERE idempotency_key = ?").get(idempotencyKey));
      if (existing) {
        if (existing.decisionId !== decisionId) throw new Error("ledger_idempotency_key_conflict");
        return { created: false, attempt: existing };
      }
      const decision = this.getDecision(decisionId);
      if (!decision) throw new Error("ledger_decision_not_found");
      if (decision.decision !== "approved") throw new Error("ledger_submission_not_approved");
      this.database.prepare(`
        INSERT INTO submission_attempts (id, decision_id, idempotency_key, status, started_at)
        VALUES (?, ?, ?, 'started', ?)
      `).run(id, decisionId, idempotencyKey, startedAt);
      this.appendEvent({
        eventKey: `submission:${id}:started`, proposalId: decision.proposalId,
        decisionId, submissionAttemptId: id, eventType: "submission_started", occurredAt: startedAt,
      });
      return { created: true, attempt: this.getSubmissionAttempt(id) };
    });
  }

  completeSubmission({ id, status, completedAt = this.clock(), brokerOrderId = null, errorCode = null, response = null }) {
    if (!FINAL_ATTEMPT_STATUSES.has(status) && status !== "unknown") throw new Error("ledger_invalid_submission_status");
    return this.transaction(() => {
      const existing = this.getSubmissionAttempt(id);
      if (!existing) throw new Error("ledger_submission_not_found");
      if (FINAL_ATTEMPT_STATUSES.has(existing.status)) {
        const replay = { ...existing, status, completedAt, brokerOrderId, errorCode, response };
        if (stableJson(existing) !== stableJson(replay)) throw new Error("ledger_submission_already_final");
        return { updated: false, attempt: existing };
      }
      this.database.prepare(`
        UPDATE submission_attempts SET status = ?, completed_at = ?, broker_order_id = ?, error_code = ?, response_json = ?
        WHERE id = ?
      `).run(status, completedAt, brokerOrderId, errorCode, response == null ? null : stableJson(response), id);
      const attempt = this.getSubmissionAttempt(id);
      const decision = this.getDecision(attempt.decisionId);
      if (status === "submitted") this.database.prepare("UPDATE proposals SET status = 'submitted' WHERE id = ?").run(decision.proposalId);
      this.appendEvent({
        eventKey: `submission:${id}:${status}`, proposalId: decision.proposalId,
        decisionId: decision.id, submissionAttemptId: id, eventType: `submission_${status}`,
        occurredAt: completedAt, payload: { brokerOrderId, errorCode, response },
      });
      return { updated: true, attempt };
    });
  }

  getSubmissionAttempt(id) {
    return normalizeAttempt(this.database.prepare("SELECT * FROM submission_attempts WHERE id = ?").get(id));
  }

  getSubmissionByIdempotencyKey(idempotencyKey) {
    return normalizeAttempt(this.database.prepare("SELECT * FROM submission_attempts WHERE idempotency_key = ?").get(idempotencyKey));
  }

  recordBrokerOrder({
    id = randomUUID(), proposalId, submissionAttemptId = null, broker, accountId,
    brokerOrderId, parentBrokerOrderId = null, role, status, order, seenAt = this.clock(),
  }) {
    required(proposalId, "broker_order_proposal_id");
    required(brokerOrderId, "broker_order_id");
    return this.transaction(() => {
      const existing = this.database.prepare(`
        SELECT * FROM broker_orders WHERE broker = ? AND account_id = ? AND broker_order_id = ?
      `).get(broker, accountId, String(brokerOrderId));
      if (existing && existing.proposal_id !== proposalId) throw new Error("ledger_broker_order_conflict");
      this.database.prepare(`
        INSERT INTO broker_orders
          (id, proposal_id, submission_attempt_id, broker, account_id, broker_order_id,
           parent_broker_order_id, role, status, order_json, first_seen_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (broker, account_id, broker_order_id) DO UPDATE SET
          submission_attempt_id = COALESCE(excluded.submission_attempt_id, broker_orders.submission_attempt_id),
          parent_broker_order_id = excluded.parent_broker_order_id,
          role = excluded.role,
          status = excluded.status,
          order_json = excluded.order_json,
          last_seen_at = excluded.last_seen_at
      `).run(
        id, proposalId, submissionAttemptId, broker, accountId, String(brokerOrderId),
        parentBrokerOrderId == null ? null : String(parentBrokerOrderId), role, status,
        stableJson(order), seenAt, seenAt,
      );
      return this.database.prepare(`
        SELECT * FROM broker_orders WHERE broker = ? AND account_id = ? AND broker_order_id = ?
      `).get(broker, accountId, String(brokerOrderId));
    });
  }

  listBrokerOrders(proposalId) {
    return this.database.prepare(`
      SELECT * FROM broker_orders WHERE proposal_id = ? ORDER BY first_seen_at, rowid
    `).all(proposalId).map((row) => ({
      id: row.id,
      proposalId: row.proposal_id,
      submissionAttemptId: row.submission_attempt_id,
      broker: row.broker,
      accountId: row.account_id,
      brokerOrderId: row.broker_order_id,
      parentBrokerOrderId: row.parent_broker_order_id,
      role: row.role,
      status: row.status,
      order: parseJson(row.order_json),
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
    }));
  }

  appendEvent({ id = randomUUID(), eventKey = null, proposalId = null, decisionId = null, submissionAttemptId = null, eventType, occurredAt = this.clock(), payload = null }) {
    required(eventType, "event_type");
    const result = this.database.prepare(`
      INSERT OR IGNORE INTO ledger_events
        (id, event_key, proposal_id, decision_id, submission_attempt_id, event_type, occurred_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, eventKey, proposalId, decisionId, submissionAttemptId, eventType, occurredAt,
      payload == null ? null : stableJson(payload));
    return { created: result.changes === 1, id };
  }

  listEvents(proposalId) {
    const rows = this.database.prepare("SELECT * FROM ledger_events WHERE proposal_id = ? ORDER BY occurred_at, rowid").all(proposalId);
    return rows.map((row) => ({
      id: row.id,
      eventKey: row.event_key,
      proposalId: row.proposal_id,
      decisionId: row.decision_id,
      submissionAttemptId: row.submission_attempt_id,
      eventType: row.event_type,
      occurredAt: row.occurred_at,
      payload: parseJson(row.payload_json),
    }));
  }

  listActivity({ limit = 100 } = {}) {
    const rows = this.database.prepare(`
      SELECT p.*, d.decision, d.decided_at,
        (SELECT status FROM submission_attempts sa WHERE sa.decision_id = d.id ORDER BY sa.started_at DESC, sa.rowid DESC LIMIT 1) AS submission_status
      FROM proposals p
      LEFT JOIN decisions d ON d.proposal_id = p.id
      ORDER BY COALESCE(d.decided_at, p.created_at) DESC, p.rowid DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(500, Number(limit) || 100)));
    return rows.map((row) => {
      const orders = this.listBrokerOrders(row.id);
      const entry = orders.find((order) => order.role === "entry");
      const status = entry?.status ?? row.submission_status ?? row.decision ?? row.status;
      return {
        id: row.id,
        symbol: row.symbol,
        side: row.side,
        status,
        occurredAt: row.decided_at ?? row.created_at,
        quantity: parseJson(row.terms_json)?.quantity ?? null,
        limitPrice: parseJson(row.terms_json)?.limitPrice ?? null,
        environment: row.environment,
        brokerOrderId: entry?.brokerOrderId ?? null,
      };
    });
  }

  listPositions() {
    return this.listProposals().flatMap((proposal) => {
      const orders = this.listBrokerOrders(proposal.id);
      const entry = orders.find((order) => order.role === "entry");
      if (!entry || entry.status.toLowerCase() !== "filled") return [];
      const closed = orders.some((order) =>
        ["exit", "protective_stop", "profit_target"].includes(order.role)
        && order.status.toLowerCase() === "filled"
      );
      if (closed) return [];
      const quantity = Number(entry.order?.filled ?? proposal.terms?.quantity ?? 0);
      if (!(quantity > 0)) return [];
      return [{
        id: proposal.id,
        symbol: proposal.symbol,
        quantity,
        averageEntryPrice: Number(entry.order?.averageFillPrice ?? proposal.terms?.limitPrice ?? 0),
        currentPrice: null,
        protectiveStopPrice: proposal.terms?.stopPrice ?? null,
        profitTargetPrice: proposal.terms?.targetPrice ?? null,
        environment: proposal.environment,
        broker: proposal.broker,
        accountId: proposal.accountId,
        updatedAt: Math.max(...orders.map((order) => order.lastSeenAt)),
        dataState: "ledger_only",
      }];
    });
  }

  close() {
    this.database.close();
  }
}
