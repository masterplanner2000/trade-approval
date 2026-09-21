"""Immutable daily evidence capture for baseline and volatile-growth lanes."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from aggressive_shadow_scanner import RULESET_VERSION as SHADOW_RULESET, evaluate as shadow_evaluate
from ibkr_daily_scanner import RULESET_VERSION as BASELINE_RULESET, DailyBar, evaluate as baseline_evaluate
from shadow_strategy_comparison import load_cache


SCHEMA_VERSION = 1
CAPTURE_VERSION = "daily-forward-evidence-v1"
HORIZONS = (1, 5, 10)


def _canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _digest(value: object) -> str:
    return hashlib.sha256(_canonical(value).encode()).hexdigest()


def _meta(path: Path) -> dict[str, str]:
    with sqlite3.connect(path) as connection:
        return dict(connection.execute("SELECT key,value FROM cache_meta"))


def _ranked_symbols(path: Path) -> list[str]:
    with sqlite3.connect(path) as connection:
        return [row[0] for row in connection.execute(
            "SELECT symbol FROM assets ORDER BY rank,symbol"
        )]


class DailyEvidenceStore:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path)
        self.connection.row_factory = sqlite3.Row
        self.connection.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS evidence_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS evidence_runs(
          run_id TEXT PRIMARY KEY, signal_date TEXT NOT NULL UNIQUE, captured_at TEXT NOT NULL,
          capture_version TEXT NOT NULL, baseline_ruleset TEXT NOT NULL, shadow_ruleset TEXT NOT NULL,
          baseline_feed TEXT NOT NULL, shadow_feed TEXT NOT NULL, payload_hash TEXT NOT NULL,
          summary_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS evidence_symbols(
          run_id TEXT NOT NULL, lane TEXT NOT NULL, symbol TEXT NOT NULL, rank INTEGER NOT NULL,
          eligible INTEGER NOT NULL, evaluation_json TEXT NOT NULL, catalyst_json TEXT,
          PRIMARY KEY(run_id,lane,symbol), FOREIGN KEY(run_id) REFERENCES evidence_runs(run_id)
        );
        CREATE TABLE IF NOT EXISTS evidence_outcomes(
          run_id TEXT NOT NULL, lane TEXT NOT NULL, symbol TEXT NOT NULL, horizon INTEGER NOT NULL,
          status TEXT NOT NULL, exit_date TEXT, net_return_bps REAL, recorded_at TEXT NOT NULL,
          PRIMARY KEY(run_id,lane,symbol,horizon), FOREIGN KEY(run_id,lane,symbol)
            REFERENCES evidence_symbols(run_id,lane,symbol)
        );
        CREATE TRIGGER IF NOT EXISTS evidence_runs_no_update BEFORE UPDATE ON evidence_runs
          BEGIN SELECT RAISE(ABORT,'evidence_run_is_immutable'); END;
        CREATE TRIGGER IF NOT EXISTS evidence_runs_no_delete BEFORE DELETE ON evidence_runs
          BEGIN SELECT RAISE(ABORT,'evidence_run_is_immutable'); END;
        CREATE TRIGGER IF NOT EXISTS evidence_symbols_no_update BEFORE UPDATE ON evidence_symbols
          BEGIN SELECT RAISE(ABORT,'evidence_symbol_is_immutable'); END;
        CREATE TRIGGER IF NOT EXISTS evidence_symbols_no_delete BEFORE DELETE ON evidence_symbols
          BEGIN SELECT RAISE(ABORT,'evidence_symbol_is_immutable'); END;
        CREATE TRIGGER IF NOT EXISTS evidence_outcomes_no_update BEFORE UPDATE ON evidence_outcomes
          BEGIN SELECT RAISE(ABORT,'evidence_outcome_is_immutable'); END;
        CREATE TRIGGER IF NOT EXISTS evidence_outcomes_no_delete BEFORE DELETE ON evidence_outcomes
          BEGIN SELECT RAISE(ABORT,'evidence_outcome_is_immutable'); END;
        """)
        current = self.connection.execute("SELECT value FROM evidence_meta WHERE key='schema_version'").fetchone()
        if current is None:
            self.connection.execute("INSERT INTO evidence_meta VALUES('schema_version',?)", (str(SCHEMA_VERSION),))
        elif int(current[0]) != SCHEMA_VERSION:
            raise RuntimeError("daily_evidence_schema_unsupported")
        self.connection.commit()

    def close(self) -> None:
        self.connection.close()

    def capture(self, baseline_cache: Path, shadow_cache: Path, *, captured_at: str,
                catalysts: dict[str, object] | None = None) -> dict[str, object]:
        baseline_meta, shadow_meta = _meta(baseline_cache), _meta(shadow_cache)
        signal_date = baseline_meta.get("completed_through")
        if not signal_date or signal_date != shadow_meta.get("completed_through"):
            raise ValueError("daily_evidence_completion_boundary_mismatch")
        captured = datetime.fromisoformat(captured_at.replace("Z", "+00:00"))
        if captured.tzinfo is None:
            raise ValueError("daily_evidence_capture_time_invalid")
        baseline_symbols, baseline_history = load_cache(baseline_cache)
        shadow_symbols, shadow_history = load_cache(shadow_cache)
        lanes: dict[str, list[dict[str, Any]]] = {"baseline": [], "shadow": []}
        for rank, symbol in enumerate(_ranked_symbols(baseline_cache), 1):
            evaluation = baseline_evaluate(symbol, baseline_history[symbol], [])
            lanes["baseline"].append({"symbol": symbol, "rank": rank, "evaluation": evaluation})
        for rank, symbol in enumerate(_ranked_symbols(shadow_cache), 1):
            evaluation = shadow_evaluate(symbol, shadow_history[symbol], today="99999999")
            lanes["shadow"].append({"symbol": symbol, "rank": rank, "evaluation": evaluation})
        for lane in lanes.values():
            if any(item["evaluation"].get("signalDate") not in {signal_date.replace("-", ""), None} for item in lane):
                raise ValueError("daily_evidence_signal_boundary_mismatch")
        summary = {
            "signalDate": signal_date, "baselineUniverseSize": len(lanes["baseline"]),
            "shadowUniverseSize": len(lanes["shadow"]),
            "baselineEligible": sum(bool(row["evaluation"].get("eligible")) for row in lanes["baseline"]),
            "shadowEligible": sum(bool(row["evaluation"].get("eligible")) for row in lanes["shadow"]),
            "catalystSymbols": sorted((catalysts or {}).keys()),
            "orderSubmissionAllowed": False, "recommendationAuthority": False,
        }
        payload = {"summary": summary, "lanes": lanes, "catalysts": catalysts or {}}
        payload_hash = _digest(payload)
        run_id = f"daily-{signal_date}-{payload_hash[:16]}"
        existing = self.connection.execute("SELECT run_id,payload_hash FROM evidence_runs WHERE signal_date=?", (signal_date,)).fetchone()
        if existing:
            if existing["payload_hash"] != payload_hash:
                raise ValueError("daily_evidence_capture_conflict")
            return {**summary, "runId": existing["run_id"], "idempotent": True}
        with self.connection:
            self.connection.execute("INSERT INTO evidence_runs VALUES(?,?,?,?,?,?,?,?,?,?)", (
                run_id, signal_date, captured.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                CAPTURE_VERSION, BASELINE_RULESET, SHADOW_RULESET,
                baseline_meta.get("data_feed", "unknown"), shadow_meta.get("data_feed", "unknown"),
                payload_hash, _canonical(summary),
            ))
            for lane_name, rows in lanes.items():
                for row in rows:
                    symbol = row["symbol"]
                    catalyst = (catalysts or {}).get(symbol)
                    self.connection.execute("INSERT INTO evidence_symbols VALUES(?,?,?,?,?,?,?)", (
                        run_id, lane_name, symbol, row["rank"], int(bool(row["evaluation"].get("eligible"))),
                        _canonical(row["evaluation"]), _canonical(catalyst) if catalyst is not None else None,
                    ))
        return {**summary, "runId": run_id, "idempotent": False}

    def record_available_outcomes(self, histories: dict[str, list[DailyBar]], *, recorded_at: str,
                                  round_trip_cost_bps: float = 20) -> dict[str, int]:
        recorded = datetime.fromisoformat(recorded_at.replace("Z", "+00:00"))
        if recorded.tzinfo is None:
            raise ValueError("daily_evidence_outcome_time_invalid")
        inserted = 0
        pending = 0
        rows = self.connection.execute(
            """SELECT s.run_id,s.lane,s.symbol,r.signal_date FROM evidence_symbols s
               JOIN evidence_runs r ON r.run_id=s.run_id WHERE s.eligible=1
               ORDER BY r.signal_date,s.lane,s.symbol"""
        ).fetchall()
        with self.connection:
            for row in rows:
                bars = histories.get(row["symbol"], [])
                index = next((i for i, bar in enumerate(bars) if bar.date == row["signal_date"].replace("-", "")), None)
                for horizon in HORIZONS:
                    if self.connection.execute(
                        "SELECT 1 FROM evidence_outcomes WHERE run_id=? AND lane=? AND symbol=? AND horizon=?",
                        (row["run_id"], row["lane"], row["symbol"], horizon),
                    ).fetchone():
                        continue
                    if index is None or index + horizon >= len(bars):
                        pending += 1
                        continue
                    entry, exit_bar = bars[index + 1].open, bars[index + horizon]
                    net = ((exit_bar.close / entry) - 1) * 10_000 - round_trip_cost_bps
                    self.connection.execute("INSERT INTO evidence_outcomes VALUES(?,?,?,?,?,?,?,?)", (
                        row["run_id"], row["lane"], row["symbol"], horizon, "COMPLETE",
                        exit_bar.date, round(net, 6), recorded.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                    ))
                    inserted += 1
        return {"inserted": inserted, "pending": pending}

    def status(self) -> dict[str, object]:
        runs = self.connection.execute("SELECT COUNT(*) FROM evidence_runs").fetchone()[0]
        latest = self.connection.execute("SELECT signal_date,summary_json FROM evidence_runs ORDER BY signal_date DESC LIMIT 1").fetchone()
        outcomes = self.connection.execute("SELECT COUNT(*) FROM evidence_outcomes").fetchone()[0]
        return {"ok": True, "runCount": runs, "outcomeCount": outcomes,
                "latestSignalDate": latest["signal_date"] if latest else None,
                "latestSummary": json.loads(latest["summary_json"]) if latest else None}
