import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

function normalizedDate(value) {
  if (typeof value !== "string") return null;
  if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
}

export function resolveProposalEvidenceIdentity(databasePath, identity = {}) {
  const signalDate = normalizedDate(identity.signalDate);
  const lane = identity.lane;
  const symbol = typeof identity.symbol === "string" ? identity.symbol.trim().toUpperCase() : null;
  const rulesetVersion = identity.rulesetVersion;
  const result = {
    signalDate,
    lane: lane ?? null,
    symbol,
    rulesetVersion: rulesetVersion ?? null,
    evidenceRunId: null,
    evidenceStatus: "UNAVAILABLE",
  };
  if (!signalDate || !new Set(["baseline", "shadow", "directional_volume_context"]).has(lane)
      || !symbol || !rulesetVersion) {
    return { ...result, evidenceStatus: "IDENTITY_INCOMPLETE" };
  }
  if (!databasePath || !existsSync(databasePath)) return result;
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = database.prepare(`
      SELECT r.run_id,r.baseline_ruleset,r.shadow_ruleset,s.evaluation_json
      FROM evidence_runs r
      JOIN evidence_symbols s ON s.run_id=r.run_id
      LEFT JOIN evidence_run_invalidations i ON i.run_id=r.run_id
      WHERE r.signal_date=? AND s.lane=? AND s.symbol=? AND i.run_id IS NULL
    `).get(signalDate, lane, symbol);
    if (!row) return { ...result, evidenceStatus: "NOT_CAPTURED" };
    let recordedRuleset = lane === "baseline" ? row.baseline_ruleset : row.shadow_ruleset;
    if (lane === "directional_volume_context") {
      try {
        recordedRuleset = JSON.parse(row.evaluation_json).rulesetVersion ?? null;
      } catch {
        recordedRuleset = null;
      }
    }
    if (recordedRuleset !== rulesetVersion) {
      return { ...result, evidenceStatus: "RULESET_MISMATCH" };
    }
    return { ...result, evidenceRunId: row.run_id, evidenceStatus: "MATCHED" };
  } catch {
    return result;
  } finally {
    database.close();
  }
}

