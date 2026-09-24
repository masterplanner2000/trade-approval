import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { resolveProposalEvidenceIdentity } from "./proposal_evidence_identity.mjs";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "proposal-evidence-"));
  const path = join(directory, "evidence.sqlite3");
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE evidence_runs(run_id TEXT PRIMARY KEY,signal_date TEXT,baseline_ruleset TEXT,shadow_ruleset TEXT);
    CREATE TABLE evidence_symbols(run_id TEXT,lane TEXT,symbol TEXT,evaluation_json TEXT);
    CREATE TABLE evidence_run_invalidations(run_id TEXT PRIMARY KEY);
    INSERT INTO evidence_runs VALUES('run-1','2026-09-22','baseline-v1','shadow-v1');
    INSERT INTO evidence_symbols VALUES('run-1','baseline','NVDA','{"rulesetVersion":"baseline-v1"}');
    INSERT INTO evidence_symbols VALUES('run-1','directional_volume_context','NVDA','{"rulesetVersion":"treatment-v1"}');
  `);
  database.close();
  return { directory, path };
}

test("resolves exact active date, lane, symbol and ruleset identity", () => {
  const { directory, path } = fixture();
  try {
    assert.deepEqual(resolveProposalEvidenceIdentity(path, {
      signalDate: "20260922", lane: "baseline", symbol: "nvda", rulesetVersion: "baseline-v1",
    }), {
      signalDate: "2026-09-22", lane: "baseline", symbol: "NVDA", rulesetVersion: "baseline-v1",
      evidenceRunId: "run-1", evidenceStatus: "MATCHED",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("never guesses across missing, invalidated, or mismatched evidence", () => {
  const { directory, path } = fixture();
  try {
    assert.equal(resolveProposalEvidenceIdentity(path, {
      signalDate: "20260922", lane: "baseline", symbol: "NVDA", rulesetVersion: "changed",
    }).evidenceStatus, "RULESET_MISMATCH");
    assert.equal(resolveProposalEvidenceIdentity(path, {
      signalDate: "20260921", lane: "baseline", symbol: "NVDA", rulesetVersion: "baseline-v1",
    }).evidenceStatus, "NOT_CAPTURED");
    const database = new DatabaseSync(path);
    database.prepare("INSERT INTO evidence_run_invalidations VALUES(?)").run("run-1");
    database.close();
    assert.equal(resolveProposalEvidenceIdentity(path, {
      signalDate: "20260922", lane: "baseline", symbol: "NVDA", rulesetVersion: "baseline-v1",
    }).evidenceStatus, "NOT_CAPTURED");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("missing database remains explicit and nonfatal", () => {
  const result = resolveProposalEvidenceIdentity("/does/not/exist.sqlite3", {
    signalDate: "20260922", lane: "baseline", symbol: "NVDA", rulesetVersion: "baseline-v1",
  });
  assert.equal(result.evidenceStatus, "UNAVAILABLE");
  assert.equal(result.evidenceRunId, null);
});

