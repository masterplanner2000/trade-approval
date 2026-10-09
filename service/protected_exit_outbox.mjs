import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { advanceProtectedExitLifecycle } from "./protected_exit_lifecycle.mjs";

const decode = (row) => row && ({
  requestId: row.request_id,
  account: row.account,
  symbol: row.symbol,
  phase: row.phase,
  state: JSON.parse(row.state_json),
  command: JSON.parse(row.command_json),
  updatedAt: row.updated_at,
});

/** Durable, simulator-only boundary; it has no broker socket or order adapter. */
export class ProtectedExitOutbox {
  constructor(path) {
    if (!path) throw new Error("exit_outbox_path_required");
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS protected_exit_intents (
        request_id TEXT PRIMARY KEY,
        account TEXT NOT NULL,
        symbol TEXT NOT NULL,
        phase TEXT NOT NULL,
        state_json TEXT NOT NULL,
        command_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;
      DROP INDEX IF EXISTS protected_exit_active_symbol;
      CREATE UNIQUE INDEX protected_exit_active_symbol
        ON protected_exit_intents(account, symbol) WHERE phase NOT IN ('closed', 'blocked');
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

  get(requestId) {
    return decode(this.database.prepare("SELECT * FROM protected_exit_intents WHERE request_id = ?").get(requestId));
  }

  listUnresolved() {
    return this.database.prepare("SELECT * FROM protected_exit_intents WHERE phase != 'closed' ORDER BY created_at")
      .all().map(decode);
  }

  prepare({ snapshot, now = Date.now(), ...terms }) {
    const evaluated = advanceProtectedExitLifecycle(null, { snapshot, now, ...terms });
    if (evaluated.commands.length !== 1 || evaluated.state.phase !== "awaiting_ack") {
      return { created: false, reason: evaluated.state.reason, intent: null };
    }
    return this.transaction(() => {
      const existing = this.get(terms.requestId);
      if (existing) {
        const old = existing.state;
        if (["requestId", "account", "symbol", "targetId", "stopId", "requestedLimitPrice"]
          .some((key) => old[key] !== evaluated.state[key])) throw new Error("exit_outbox_intent_conflict");
        return { created: false, reason: "already_prepared", intent: existing };
      }
      this.database.prepare(`
        INSERT INTO protected_exit_intents
          (request_id, account, symbol, phase, state_json, command_json, created_at, updated_at)
        VALUES (?, ?, ?, 'prepared', ?, ?, ?, ?)
      `).run(terms.requestId, terms.account, terms.symbol,
        JSON.stringify(evaluated.state), JSON.stringify(evaluated.commands[0]), now, now);
      return { created: true, reason: null, intent: this.get(terms.requestId) };
    });
  }

  // Commit this state BEFORE invoking any external adapter. If the process
  // dies after this commit, the call may or may not have reached the broker.
  // The only safe recovery is read-only broker reconciliation, not retry.
  claimForDispatch(requestId, { snapshot, now = Date.now() } = {}) {
    return this.transaction(() => {
      const intent = this.get(requestId);
      if (!intent) throw new Error("exit_outbox_intent_missing");
      if (intent.phase !== "prepared") return { claimed: false, command: null, intent };
      const checked = advanceProtectedExitLifecycle(null, { snapshot, ...intent.state, now });
      if (checked.commands.length !== 1 || checked.state.phase !== "awaiting_ack") {
        return { claimed: false, command: null, reason: checked.state.reason, intent };
      }
      const state = { ...intent.state, phase: "transmission_unknown", reason: "transport_outcome_unconfirmed" };
      this.database.prepare(`UPDATE protected_exit_intents SET phase = 'transmission_unknown',
        state_json = ?, updated_at = ? WHERE request_id = ?`).run(JSON.stringify(state), now, requestId);
      return { claimed: true, command: intent.command, intent: this.get(requestId) };
    });
  }

  reconcile(requestId, snapshot, { now = Date.now() } = {}) {
    return this.transaction(() => {
      const intent = this.get(requestId);
      if (!intent) throw new Error("exit_outbox_intent_missing");
      const next = advanceProtectedExitLifecycle(intent.state, { snapshot, ...intent.state, now });
      // Closed is an observed terminal outcome; a later stale or incomplete
      // snapshot must not undo it. A new request needs a separate ID.
      if (intent.phase === "closed") return intent;
      const phase = next.state.phase === "awaiting_ack" && intent.phase === "prepared"
        ? "prepared" : next.state.phase;
      this.database.prepare(`UPDATE protected_exit_intents SET phase = ?, state_json = ?, updated_at = ?
        WHERE request_id = ?`).run(phase, JSON.stringify(next.state), now, requestId);
      return this.get(requestId);
    });
  }

  close() { this.database.close(); }
}
