"""Immutable daily evidence capture for baseline and volatile-growth lanes."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import statistics
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from aggressive_shadow_scanner import RULESET_VERSION as SHADOW_RULESET, evaluate as shadow_evaluate
from directional_volume_experiment import evaluate as directional_evaluate, manifest as directional_manifest
from ibkr_daily_scanner import RULESET_VERSION as BASELINE_RULESET, DailyBar, evaluate as baseline_evaluate
from shadow_strategy_comparison import load_cache


SCHEMA_VERSION = 4
CAPTURE_VERSION = "daily-forward-evidence-v2"
HORIZONS = (1, 5, 10)
MINIMUM_SESSION_COVERAGE = 0.8


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


def _align_evaluation(evaluation: dict[str, Any], signal_date: str) -> dict[str, Any]:
    expected = signal_date.replace("-", "")
    observed = evaluation.get("signalDate")
    if observed in {expected, None}:
        return evaluation
    return {
        **evaluation,
        "signalDate": expected,
        "eligible": False,
        "reason": "completed_session_bar_missing",
        "lastAvailableSignalDate": observed,
        "researchScore": None,
    }


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
        CREATE TABLE IF NOT EXISTS evidence_counterfactuals(
          run_id TEXT NOT NULL, lane TEXT NOT NULL, symbol TEXT NOT NULL, horizon INTEGER NOT NULL,
          status TEXT NOT NULL, entry_date TEXT NOT NULL, entry_price REAL NOT NULL,
          exit_date TEXT NOT NULL, exit_price REAL NOT NULL, gross_return_bps REAL NOT NULL,
          round_trip_cost_bps REAL NOT NULL, net_return_bps REAL NOT NULL,
          max_favorable_excursion_bps REAL NOT NULL, max_adverse_excursion_bps REAL NOT NULL,
          recorded_at TEXT NOT NULL,
          PRIMARY KEY(run_id,lane,symbol,horizon), FOREIGN KEY(run_id,lane,symbol)
            REFERENCES evidence_symbols(run_id,lane,symbol)
        );
        CREATE TABLE IF NOT EXISTS evidence_benchmarks(
          run_id TEXT NOT NULL, horizon INTEGER NOT NULL, benchmark TEXT NOT NULL,
          status TEXT NOT NULL, entry_date TEXT NOT NULL, entry_price REAL NOT NULL,
          exit_date TEXT NOT NULL, exit_price REAL NOT NULL, gross_return_bps REAL NOT NULL,
          round_trip_cost_bps REAL NOT NULL, net_return_bps REAL NOT NULL, recorded_at TEXT NOT NULL,
          PRIMARY KEY(run_id,horizon,benchmark), FOREIGN KEY(run_id) REFERENCES evidence_runs(run_id)
        );
        CREATE TABLE IF NOT EXISTS evidence_lifecycle_observations(
          observation_id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
          run_id TEXT, lane TEXT, symbol TEXT NOT NULL, signal_date TEXT,
          observed_at TEXT NOT NULL, environment TEXT NOT NULL, side TEXT NOT NULL,
          proposal_status TEXT NOT NULL, decision TEXT, submission_status TEXT,
          broker_entry_status TEXT, proposed_quantity REAL, proposed_limit_price REAL,
          filled_quantity REAL, average_fill_price REAL, commission REAL, slippage_bps REAL,
          match_status TEXT NOT NULL, incomplete_reasons_json TEXT NOT NULL,
          UNIQUE(proposal_id,payload_hash), FOREIGN KEY(run_id) REFERENCES evidence_runs(run_id)
        );
        CREATE TABLE IF NOT EXISTS evidence_run_invalidations(
          run_id TEXT PRIMARY KEY, reason TEXT NOT NULL, recorded_at TEXT NOT NULL,
          FOREIGN KEY(run_id) REFERENCES evidence_runs(run_id)
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
        CREATE TRIGGER IF NOT EXISTS evidence_counterfactuals_no_update BEFORE UPDATE ON evidence_counterfactuals
          BEGIN SELECT RAISE(ABORT,'evidence_counterfactual_is_immutable'); END;
        CREATE TRIGGER IF NOT EXISTS evidence_counterfactuals_no_delete BEFORE DELETE ON evidence_counterfactuals
          BEGIN SELECT RAISE(ABORT,'evidence_counterfactual_is_immutable'); END;
        CREATE TRIGGER IF NOT EXISTS evidence_benchmarks_no_update BEFORE UPDATE ON evidence_benchmarks
          BEGIN SELECT RAISE(ABORT,'evidence_benchmark_is_immutable'); END;
        CREATE TRIGGER IF NOT EXISTS evidence_benchmarks_no_delete BEFORE DELETE ON evidence_benchmarks
          BEGIN SELECT RAISE(ABORT,'evidence_benchmark_is_immutable'); END;
        CREATE TRIGGER IF NOT EXISTS evidence_lifecycle_no_update BEFORE UPDATE ON evidence_lifecycle_observations
          BEGIN SELECT RAISE(ABORT,'evidence_lifecycle_is_immutable'); END;
        CREATE TRIGGER IF NOT EXISTS evidence_lifecycle_no_delete BEFORE DELETE ON evidence_lifecycle_observations
          BEGIN SELECT RAISE(ABORT,'evidence_lifecycle_is_immutable'); END;
        CREATE TRIGGER IF NOT EXISTS evidence_invalidations_no_update BEFORE UPDATE ON evidence_run_invalidations
          BEGIN SELECT RAISE(ABORT,'evidence_invalidation_is_immutable'); END;
        CREATE TRIGGER IF NOT EXISTS evidence_invalidations_no_delete BEFORE DELETE ON evidence_run_invalidations
          BEGIN SELECT RAISE(ABORT,'evidence_invalidation_is_immutable'); END;
        """)
        current = self.connection.execute("SELECT value FROM evidence_meta WHERE key='schema_version'").fetchone()
        if current is None:
            self.connection.execute("INSERT INTO evidence_meta VALUES('schema_version',?)", (str(SCHEMA_VERSION),))
        elif int(current[0]) in {1, 2, 3}:
            self.connection.execute(
                "UPDATE evidence_meta SET value=? WHERE key='schema_version'", (str(SCHEMA_VERSION),)
            )
        elif int(current[0]) != SCHEMA_VERSION:
            raise RuntimeError("daily_evidence_schema_unsupported")
        self.connection.commit()

    def close(self) -> None:
        self.connection.close()

    def invalidate_run(self, run_id: str, *, reason: str, recorded_at: str) -> dict[str, object]:
        normalized_reason = reason.strip()
        if not normalized_reason:
            raise ValueError("daily_evidence_invalidation_reason_required")
        recorded = datetime.fromisoformat(recorded_at.replace("Z", "+00:00"))
        if recorded.tzinfo is None:
            raise ValueError("daily_evidence_invalidation_time_invalid")
        run = self.connection.execute(
            "SELECT run_id,signal_date FROM evidence_runs WHERE run_id=?", (run_id,)
        ).fetchone()
        if run is None:
            raise ValueError("daily_evidence_run_unknown")
        existing = self.connection.execute(
            "SELECT reason,recorded_at FROM evidence_run_invalidations WHERE run_id=?", (run_id,)
        ).fetchone()
        if existing:
            if existing["reason"] != normalized_reason:
                raise ValueError("daily_evidence_invalidation_conflict")
            return {"runId": run_id, "signalDate": run["signal_date"], "invalidated": True,
                    "idempotent": True, "reason": existing["reason"], "recordedAt": existing["recorded_at"]}
        timestamp = recorded.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        with self.connection:
            self.connection.execute(
                "INSERT INTO evidence_run_invalidations VALUES(?,?,?)",
                (run_id, normalized_reason, timestamp),
            )
        return {"runId": run_id, "signalDate": run["signal_date"], "invalidated": True,
                "idempotent": False, "reason": normalized_reason, "recordedAt": timestamp}

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
        lanes: dict[str, list[dict[str, Any]]] = {
            "baseline": [], "shadow": [], "directional_volume_context": [],
        }
        expected = signal_date.replace("-", "")
        baseline_current = sum(bool(baseline_history.get(symbol)) and baseline_history[symbol][-1].date == expected
                               for symbol in _ranked_symbols(baseline_cache))
        shadow_current = sum(bool(shadow_history.get(symbol)) and shadow_history[symbol][-1].date == expected
                             for symbol in _ranked_symbols(shadow_cache))
        if baseline_current < len(baseline_symbols) * MINIMUM_SESSION_COVERAGE or \
                shadow_current < len(shadow_symbols) * MINIMUM_SESSION_COVERAGE:
            raise ValueError("daily_evidence_signal_coverage_incomplete")
        for rank, symbol in enumerate(_ranked_symbols(baseline_cache), 1):
            evaluation = _align_evaluation(
                baseline_evaluate(symbol, baseline_history[symbol], [], today="99999999"), signal_date
            )
            lanes["baseline"].append({"symbol": symbol, "rank": rank, "evaluation": evaluation})
        for rank, symbol in enumerate(_ranked_symbols(shadow_cache), 1):
            evaluation = _align_evaluation(
                shadow_evaluate(symbol, shadow_history[symbol], today="99999999"), signal_date
            )
            lanes["shadow"].append({"symbol": symbol, "rank": rank, "evaluation": evaluation})
            directional = _align_evaluation(
                directional_evaluate(symbol, shadow_history[symbol], today="99999999"), signal_date
            )
            lanes["directional_volume_context"].append(
                {"symbol": symbol, "rank": rank, "evaluation": directional}
            )
        summary = {
            "signalDate": signal_date, "baselineUniverseSize": len(lanes["baseline"]),
            "shadowUniverseSize": len(lanes["shadow"]),
            "baselineEligible": sum(bool(row["evaluation"].get("eligible")) for row in lanes["baseline"]),
            "shadowEligible": sum(bool(row["evaluation"].get("eligible")) for row in lanes["shadow"]),
            "directionalVolumeContextEligible": sum(
                bool(row["evaluation"].get("eligible"))
                for row in lanes["directional_volume_context"]
            ),
            "directionalExperimentId": directional_manifest()["experimentId"],
            "baselineSessionCoverage": round(baseline_current / len(baseline_symbols), 6),
            "shadowSessionCoverage": round(shadow_current / len(shadow_symbols), 6),
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
               JOIN evidence_runs r ON r.run_id=s.run_id
               LEFT JOIN evidence_run_invalidations i ON i.run_id=r.run_id
               WHERE s.eligible=1 AND i.run_id IS NULL
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

    def record_available_counterfactuals(
        self,
        histories: dict[str, list[DailyBar]],
        *,
        recorded_at: str,
        round_trip_cost_bps: float = 20,
    ) -> dict[str, int]:
        """Measure every observed candidate, including candidates the rules rejected.

        The measurement is deliberately independent of recommendation eligibility. Entry is the
        next session's open; exit is the selected horizon's close. MFE and MAE use the complete
        high/low path from entry through exit. These are counterfactual research results, not fills.
        """
        recorded = datetime.fromisoformat(recorded_at.replace("Z", "+00:00"))
        if recorded.tzinfo is None:
            raise ValueError("daily_evidence_counterfactual_time_invalid")
        if round_trip_cost_bps < 0:
            raise ValueError("daily_evidence_counterfactual_cost_invalid")
        timestamp = recorded.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        inserted = 0
        pending = 0
        rows = self.connection.execute(
            """SELECT s.run_id,s.lane,s.symbol,r.signal_date FROM evidence_symbols s
               JOIN evidence_runs r ON r.run_id=s.run_id
               LEFT JOIN evidence_run_invalidations i ON i.run_id=r.run_id
               WHERE i.run_id IS NULL
               ORDER BY r.signal_date,s.lane,s.symbol"""
        ).fetchall()
        with self.connection:
            for row in rows:
                bars = histories.get(row["symbol"], [])
                index = next(
                    (i for i, bar in enumerate(bars) if bar.date == row["signal_date"].replace("-", "")),
                    None,
                )
                for horizon in HORIZONS:
                    identity = (row["run_id"], row["lane"], row["symbol"], horizon)
                    if self.connection.execute(
                        """SELECT 1 FROM evidence_counterfactuals
                           WHERE run_id=? AND lane=? AND symbol=? AND horizon=?""",
                        identity,
                    ).fetchone():
                        continue
                    if index is None or index + horizon >= len(bars):
                        pending += 1
                        continue
                    entry_bar = bars[index + 1]
                    exit_bar = bars[index + horizon]
                    path = bars[index + 1:index + horizon + 1]
                    entry_price = entry_bar.open
                    if entry_price <= 0 or any(bar.high <= 0 or bar.low <= 0 for bar in path):
                        pending += 1
                        continue
                    gross = ((exit_bar.close / entry_price) - 1) * 10_000
                    favorable = ((max(bar.high for bar in path) / entry_price) - 1) * 10_000
                    adverse = ((min(bar.low for bar in path) / entry_price) - 1) * 10_000
                    self.connection.execute(
                        """INSERT INTO evidence_counterfactuals VALUES(
                           ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (*identity, "COMPLETE", entry_bar.date, entry_price, exit_bar.date,
                         exit_bar.close, round(gross, 6), round_trip_cost_bps,
                         round(gross - round_trip_cost_bps, 6), round(favorable, 6),
                         round(adverse, 6), timestamp),
                    )
                    inserted += 1
        return {"inserted": inserted, "pending": pending}

    def record_available_benchmarks(
        self,
        histories: dict[str, list[DailyBar]],
        *,
        recorded_at: str,
        benchmark_symbol: str = "QQQ",
        round_trip_cost_bps: float = 20,
    ) -> dict[str, int]:
        """Attach immutable cash and market benchmarks on the exact candidate time windows."""
        recorded = datetime.fromisoformat(recorded_at.replace("Z", "+00:00"))
        if recorded.tzinfo is None:
            raise ValueError("daily_evidence_benchmark_time_invalid")
        if round_trip_cost_bps < 0:
            raise ValueError("daily_evidence_benchmark_cost_invalid")
        timestamp = recorded.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        bars = histories.get(benchmark_symbol, [])
        inserted = 0
        pending = 0
        runs = self.connection.execute(
            """SELECT r.run_id,r.signal_date FROM evidence_runs r
               LEFT JOIN evidence_run_invalidations i ON i.run_id=r.run_id
               WHERE i.run_id IS NULL ORDER BY r.signal_date"""
        ).fetchall()
        with self.connection:
            for run in runs:
                index = next(
                    (i for i, bar in enumerate(bars) if bar.date == run["signal_date"].replace("-", "")),
                    None,
                )
                for horizon in HORIZONS:
                    missing = [name for name in ("CASH", benchmark_symbol) if not self.connection.execute(
                        """SELECT 1 FROM evidence_benchmarks
                           WHERE run_id=? AND horizon=? AND benchmark=?""",
                        (run["run_id"], horizon, name),
                    ).fetchone()]
                    if not missing:
                        continue
                    if index is None or index + horizon >= len(bars):
                        pending += len(missing)
                        continue
                    entry_bar = bars[index + 1]
                    exit_bar = bars[index + horizon]
                    if entry_bar.open <= 0 or exit_bar.close <= 0:
                        pending += len(missing)
                        continue
                    qqq_gross = ((exit_bar.close / entry_bar.open) - 1) * 10_000
                    values = {
                        "CASH": (1.0, 1.0, 0.0, 0.0, 0.0),
                        benchmark_symbol: (
                            entry_bar.open, exit_bar.close, qqq_gross,
                            round_trip_cost_bps, qqq_gross - round_trip_cost_bps,
                        ),
                    }
                    for name in missing:
                        entry_price, exit_price, gross, cost, net = values[name]
                        self.connection.execute(
                            """INSERT INTO evidence_benchmarks VALUES(
                               ?,?,?,?,?,?,?,?,?,?,?,?)""",
                            (run["run_id"], horizon, name, "COMPLETE", entry_bar.date,
                             entry_price, exit_bar.date, exit_price, round(gross, 6), cost,
                             round(net, 6), timestamp),
                        )
                        inserted += 1
        return {"inserted": inserted, "pending": pending}

    def record_ledger_lifecycle(self, ledger_path: Path, *, recorded_at: str) -> dict[str, int]:
        """Append exact proposal/decision/submission/fill observations from the app ledger."""
        recorded = datetime.fromisoformat(recorded_at.replace("Z", "+00:00"))
        if recorded.tzinfo is None:
            raise ValueError("daily_evidence_lifecycle_time_invalid")
        timestamp = recorded.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        if not ledger_path.exists():
            return {"inserted": 0, "idempotent": 0, "unlinked": 0}
        with sqlite3.connect(f"file:{ledger_path}?mode=ro", uri=True) as ledger:
            ledger.row_factory = sqlite3.Row
            proposals = ledger.execute(
                """SELECT p.*,d.decision,d.decided_at,
                          (SELECT status FROM submission_attempts sa WHERE sa.decision_id=d.id
                           ORDER BY sa.started_at DESC,sa.rowid DESC LIMIT 1) AS submission_status
                   FROM proposals p LEFT JOIN decisions d ON d.proposal_id=p.id
                   ORDER BY p.created_at,p.rowid"""
            ).fetchall()
            order_rows = ledger.execute(
                "SELECT proposal_id,role,status,order_json FROM broker_orders ORDER BY last_seen_at,rowid"
            ).fetchall()
        orders_by_proposal: dict[str, list[sqlite3.Row]] = {}
        for order in order_rows:
            orders_by_proposal.setdefault(order["proposal_id"], []).append(order)
        inserted = 0
        idempotent = 0
        unlinked = 0
        with self.connection:
            for proposal in proposals:
                source = json.loads(proposal["source_json"]) if proposal["source_json"] else {}
                terms = json.loads(proposal["terms_json"])
                raw_signal_date = source.get("signalDate") or terms.get("signalDate")
                signal_date = None
                if isinstance(raw_signal_date, str) and len(raw_signal_date) == 8 and raw_signal_date.isdigit():
                    signal_date = f"{raw_signal_date[:4]}-{raw_signal_date[4:6]}-{raw_signal_date[6:]}"
                universe = source.get("universeSource") or terms.get("universeSource")
                lane = "baseline" if universe == "alpaca-cache" else None
                run_id = None
                match_status = "signal_identity_missing"
                if signal_date and lane:
                    matched = self.connection.execute(
                        """SELECT s.run_id FROM evidence_symbols s JOIN evidence_runs r ON r.run_id=s.run_id
                           LEFT JOIN evidence_run_invalidations i ON i.run_id=r.run_id
                           WHERE r.signal_date=? AND s.lane=? AND s.symbol=? AND i.run_id IS NULL""",
                        (signal_date, lane, proposal["symbol"]),
                    ).fetchone()
                    if matched:
                        run_id = matched["run_id"]
                        match_status = "matched"
                    else:
                        match_status = "evidence_run_or_symbol_missing"
                elif signal_date:
                    match_status = "lane_unknown"
                entry_orders = [row for row in orders_by_proposal.get(proposal["id"], [])
                                if row["role"] == "entry"]
                entry = entry_orders[-1] if entry_orders else None
                entry_payload = json.loads(entry["order_json"]) if entry else {}
                proposed_quantity = terms.get("quantity")
                proposed_limit = terms.get("limitPrice")
                filled_quantity = entry_payload.get("cumulativeQuantity", entry_payload.get("filled"))
                average_fill = entry_payload.get(
                    "averagePrice", entry_payload.get("averageFillPrice", entry_payload.get("price"))
                )
                commission_values = []
                for order in orders_by_proposal.get(proposal["id"], []):
                    payload = json.loads(order["order_json"])
                    value = payload.get("commission")
                    if isinstance(value, (int, float)):
                        commission_values.append(float(value))
                commission = sum(commission_values) if commission_values else None
                slippage = None
                if isinstance(average_fill, (int, float)) and isinstance(proposed_limit, (int, float)) \
                        and proposed_limit > 0:
                    direction = 1 if proposal["side"] == "buy" else -1
                    slippage = direction * ((float(average_fill) / float(proposed_limit)) - 1) * 10_000
                incomplete = []
                if match_status != "matched":
                    incomplete.append(match_status)
                    unlinked += 1
                if proposal["decision"] is None and proposal["status"] not in {"replaced", "blocked"}:
                    incomplete.append("decision_missing")
                if proposal["decision"] == "approved" and proposal["submission_status"] is None:
                    incomplete.append("submission_missing")
                if entry and str(entry["status"]).lower() in {"filled", "partiallyfilled"}:
                    if filled_quantity is None or average_fill is None:
                        incomplete.append("fill_terms_missing")
                    if commission is None:
                        incomplete.append("commission_missing")
                payload = {
                    "proposalId": proposal["id"], "runId": run_id, "lane": lane,
                    "symbol": proposal["symbol"], "signalDate": signal_date,
                    "environment": proposal["environment"], "side": proposal["side"],
                    "proposalStatus": proposal["status"], "decision": proposal["decision"],
                    "submissionStatus": proposal["submission_status"],
                    "brokerEntryStatus": entry["status"] if entry else None,
                    "proposedQuantity": proposed_quantity, "proposedLimitPrice": proposed_limit,
                    "filledQuantity": filled_quantity, "averageFillPrice": average_fill,
                    "commission": commission,
                    "slippageBps": round(slippage, 6) if slippage is not None else None,
                    "matchStatus": match_status, "incompleteReasons": sorted(set(incomplete)),
                }
                payload_hash = _digest(payload)
                observation_id = f"lifecycle-{proposal['id']}-{payload_hash[:16]}"
                if self.connection.execute(
                    "SELECT 1 FROM evidence_lifecycle_observations WHERE observation_id=?",
                    (observation_id,),
                ).fetchone():
                    idempotent += 1
                    continue
                self.connection.execute(
                    """INSERT INTO evidence_lifecycle_observations VALUES(
                       ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (observation_id, proposal["id"], payload_hash, run_id, lane, proposal["symbol"],
                     signal_date, timestamp, proposal["environment"], proposal["side"],
                     proposal["status"], proposal["decision"], proposal["submission_status"],
                     entry["status"] if entry else None, proposed_quantity, proposed_limit,
                     filled_quantity, average_fill, commission,
                     round(slippage, 6) if slippage is not None else None, match_status,
                     _canonical(sorted(set(incomplete)))),
                )
                inserted += 1
        return {"inserted": inserted, "idempotent": idempotent, "unlinked": unlinked}

    def lifecycle_report(self) -> dict[str, object]:
        rows = self.connection.execute(
            """WITH latest AS (
                 SELECT *,ROW_NUMBER() OVER(PARTITION BY proposal_id ORDER BY observed_at DESC,rowid DESC) n
                 FROM evidence_lifecycle_observations
               ) SELECT * FROM latest WHERE n=1 ORDER BY proposal_id"""
        ).fetchall()
        def counts(field: str) -> dict[str, int]:
            result: dict[str, int] = {}
            for row in rows:
                key = str(row[field] if row[field] is not None else "missing")
                result[key] = result.get(key, 0) + 1
            return dict(sorted(result.items()))
        dispositions: dict[str, int] = {}
        for row in rows:
            disposition = row["decision"]
            if disposition is None and row["proposal_status"] == "replaced":
                disposition = "unselected_replaced"
            elif disposition is None and row["proposal_status"] == "blocked":
                disposition = "blocked_before_decision"
            elif disposition is None:
                disposition = "undecided"
            dispositions[str(disposition)] = dispositions.get(str(disposition), 0) + 1
        filled = [row for row in rows if str(row["broker_entry_status"] or "").lower()
                  in {"filled", "partiallyfilled"}]
        slippage = [float(row["slippage_bps"]) for row in filled if row["slippage_bps"] is not None]
        complete_costs = [row for row in filled if row["commission"] is not None]
        incomplete: dict[str, int] = {}
        for row in rows:
            for reason in json.loads(row["incomplete_reasons_json"]):
                incomplete[reason] = incomplete.get(reason, 0) + 1
        selection_rows = self.connection.execute(
            """WITH latest AS (
                 SELECT *,ROW_NUMBER() OVER(PARTITION BY proposal_id ORDER BY observed_at DESC,rowid DESC) n
                 FROM evidence_lifecycle_observations
               )
               SELECT l.decision,c.horizon,c.net_return_bps,q.net_return_bps AS qqq_return_bps
               FROM latest l JOIN evidence_counterfactuals c
                 ON c.run_id=l.run_id AND c.lane=l.lane AND c.symbol=l.symbol
               LEFT JOIN evidence_benchmarks q ON q.run_id=c.run_id AND q.horizon=c.horizon
                 AND q.benchmark='QQQ'
               WHERE l.n=1 AND l.match_status='matched' AND c.status='COMPLETE'"""
        ).fetchall()
        selection_groups: dict[tuple[str, int], list[sqlite3.Row]] = {}
        for row in selection_rows:
            selection_groups.setdefault((str(row["decision"] or "undecided"), row["horizon"]), []).append(row)
        selection = []
        for (decision, horizon), samples in sorted(selection_groups.items()):
            returns = [float(row["net_return_bps"]) for row in samples]
            benchmark = [float(row["net_return_bps"]) - float(row["qqq_return_bps"])
                         for row in samples if row["qqq_return_bps"] is not None]
            selection.append({
                "decision": decision,
                "horizonSessions": horizon,
                "sampleSize": len(samples),
                "averageNetReturnBps": round(statistics.fmean(returns), 6),
                "averageExcessVsQqqBps": (
                    round(statistics.fmean(benchmark), 6) if benchmark else None
                ),
            })
        return {
            "proposalCount": len(rows),
            "matchedProposalCount": sum(row["match_status"] == "matched" for row in rows),
            "decisions": counts("decision"),
            "proposalDispositions": dict(sorted(dispositions.items())),
            "submissionStatuses": counts("submission_status"),
            "brokerEntryStatuses": counts("broker_entry_status"),
            "filledEntryCount": len(filled),
            "slippageSampleSize": len(slippage),
            "averageEntrySlippageBps": round(statistics.fmean(slippage), 6) if slippage else None,
            "commissionCompleteFillCount": len(complete_costs),
            "incompleteReasons": dict(sorted(incomplete.items())),
            "selectionOutcomesByDecision": selection,
        }

    def collection_readiness(self, *, target_sessions: int = 20) -> dict[str, object]:
        if target_sessions <= 0:
            raise ValueError("daily_evidence_target_sessions_invalid")
        captured = self.connection.execute(
            """SELECT COUNT(DISTINCT r.signal_date) FROM evidence_runs r
               LEFT JOIN evidence_run_invalidations i ON i.run_id=r.run_id
               WHERE i.run_id IS NULL"""
        ).fetchone()[0]
        measured_rows = self.connection.execute(
            """SELECT c.horizon,COUNT(DISTINCT r.signal_date) AS sessions
               FROM evidence_counterfactuals c JOIN evidence_runs r ON r.run_id=c.run_id
               LEFT JOIN evidence_run_invalidations i ON i.run_id=r.run_id
               WHERE i.run_id IS NULL AND c.status='COMPLETE' GROUP BY c.horizon"""
        ).fetchall()
        measured = {int(row["horizon"]): int(row["sessions"]) for row in measured_rows}
        benchmark_rows = self.connection.execute(
            """SELECT b.horizon,COUNT(DISTINCT r.signal_date) AS sessions
               FROM evidence_benchmarks b JOIN evidence_runs r ON r.run_id=b.run_id
               LEFT JOIN evidence_run_invalidations i ON i.run_id=r.run_id
               WHERE i.run_id IS NULL AND b.status='COMPLETE' AND b.benchmark='QQQ'
               GROUP BY b.horizon"""
        ).fetchall()
        benchmark = {int(row["horizon"]): int(row["sessions"]) for row in benchmark_rows}
        lifecycle_sessions = self.connection.execute(
            """WITH latest AS (
                 SELECT *,ROW_NUMBER() OVER(PARTITION BY proposal_id ORDER BY observed_at DESC,rowid DESC) n
                 FROM evidence_lifecycle_observations
               ) SELECT COUNT(DISTINCT signal_date) FROM latest
                 WHERE n=1 AND match_status='matched'"""
        ).fetchone()[0]
        horizons = []
        for horizon in HORIZONS:
            count = measured.get(horizon, 0)
            benchmark_count = benchmark.get(horizon, 0)
            usable = min(count, benchmark_count)
            horizons.append({
                "horizonSessions": horizon,
                "measuredSessionCount": count,
                "benchmarkSessionCount": benchmark_count,
                "usableSessionCount": usable,
                "remainingSessionCount": max(0, target_sessions - usable),
                "progressPercent": round(min(1, usable / target_sessions) * 100, 2),
                "ready": usable >= target_sessions,
            })
        strategy_ready = all(item["ready"] for item in horizons)
        execution_ready = lifecycle_sessions >= target_sessions
        blockers = []
        if not strategy_ready:
            blockers.append("forward_horizon_sessions_below_target")
        if not execution_ready:
            blockers.append("matched_proposal_sessions_below_target")
        return {
            "targetSessionCount": target_sessions,
            "capturedSessionCount": captured,
            "horizons": horizons,
            "matchedProposalSessionCount": lifecycle_sessions,
            "strategyRuleReviewReady": strategy_ready,
            "executionReviewReady": execution_ready,
            "blockers": blockers,
        }

    def directional_experiment_readiness(self) -> dict[str, object]:
        definition = directional_manifest()
        target = int(definition["minimumDistinctSessions"])
        rows = self.connection.execute(
            """SELECT c.horizon,COUNT(DISTINCT r.signal_date) AS sessions
               FROM evidence_counterfactuals c
               JOIN evidence_runs r ON r.run_id=c.run_id
               JOIN evidence_symbols s USING(run_id,lane,symbol)
               LEFT JOIN evidence_run_invalidations i ON i.run_id=r.run_id
               WHERE i.run_id IS NULL AND c.lane='directional_volume_context'
                 AND c.status='COMPLETE' GROUP BY c.horizon"""
        ).fetchall()
        sessions = {int(row["horizon"]): int(row["sessions"]) for row in rows}
        progress = [{
            "horizonSessions": horizon,
            "measuredSessionCount": sessions.get(horizon, 0),
            "remainingSessionCount": max(0, target - sessions.get(horizon, 0)),
            "ready": sessions.get(horizon, 0) >= target,
        } for horizon in HORIZONS]
        return {
            "manifest": definition,
            "horizons": progress,
            "reviewReady": all(item["ready"] for item in progress),
            "conclusion": "AWAIT_FORWARD_EVIDENCE",
        }

    def directional_experiment_report(self, *, selection_size: int = 5) -> dict[str, object]:
        """Compare frozen control and treatment selections on paired forward sessions.

        A session enters this report only when both lanes have at least one eligible candidate and
        every selected candidate has a complete outcome for the horizon. This avoids making a
        temporarily missing bar look like strategy performance. Selection is deterministic by the
        frozen research score, source-universe rank and symbol.
        """
        if selection_size < 1:
            raise ValueError("directional_experiment_selection_size_invalid")
        definition = directional_manifest()
        target = int(definition["minimumDistinctSessions"])
        rows = self.connection.execute(
            """SELECT r.run_id,r.signal_date,s.lane,s.symbol,s.rank,s.evaluation_json,
                      c.horizon,c.net_return_bps
               FROM evidence_runs r
               JOIN evidence_symbols s ON s.run_id=r.run_id
               LEFT JOIN evidence_counterfactuals c ON c.run_id=s.run_id AND c.lane=s.lane
                    AND c.symbol=s.symbol AND c.status='COMPLETE'
               LEFT JOIN evidence_run_invalidations i ON i.run_id=r.run_id
               WHERE i.run_id IS NULL AND s.eligible=1
                 AND s.lane IN ('shadow','directional_volume_context')
               ORDER BY r.signal_date,s.lane,s.rank,s.symbol"""
        ).fetchall()
        candidates: dict[tuple[str, str], list[dict[str, object]]] = {}
        for row in rows:
            evaluation = json.loads(row["evaluation_json"])
            score = evaluation.get("researchScore")
            candidates.setdefault((row["run_id"], row["lane"]), []).append({
                "signalDate": row["signal_date"],
                "symbol": row["symbol"],
                "rank": int(row["rank"]),
                "score": float(score) if isinstance(score, (int, float)) else float("-inf"),
                "horizon": int(row["horizon"]) if row["horizon"] is not None else None,
                "netReturnBps": (
                    float(row["net_return_bps"]) if row["net_return_bps"] is not None else None
                ),
            })
        selected: dict[tuple[str, str], list[str]] = {}
        for key, lane_rows in candidates.items():
            identities: dict[str, dict[str, object]] = {}
            for row in lane_rows:
                identities.setdefault(str(row["symbol"]), row)
            ranked = sorted(
                identities.values(),
                key=lambda item: (-float(item["score"]), int(item["rank"]), str(item["symbol"])),
            )
            selected[key] = [str(item["symbol"]) for item in ranked[:selection_size]]

        comparisons: dict[int, list[dict[str, object]]] = {horizon: [] for horizon in HORIZONS}
        run_ids = sorted({key[0] for key in candidates})
        for run_id in run_ids:
            control_symbols = selected.get((run_id, "shadow"), [])
            treatment_symbols = selected.get((run_id, "directional_volume_context"), [])
            if not control_symbols or not treatment_symbols:
                continue
            for horizon in HORIZONS:
                lane_values: dict[str, list[float]] = {}
                complete = True
                for lane, symbols in (("shadow", control_symbols),
                                      ("directional_volume_context", treatment_symbols)):
                    values_by_symbol = {
                        str(row["symbol"]): float(row["netReturnBps"])
                        for row in candidates[(run_id, lane)]
                        if row["horizon"] == horizon and row["netReturnBps"] is not None
                    }
                    if any(symbol not in values_by_symbol for symbol in symbols):
                        complete = False
                        break
                    lane_values[lane] = [values_by_symbol[symbol] for symbol in symbols]
                if not complete:
                    continue
                control_return = statistics.fmean(lane_values["shadow"])
                treatment_return = statistics.fmean(lane_values["directional_volume_context"])
                signal_date = str(candidates[(run_id, "shadow")][0]["signalDate"])
                comparisons[horizon].append({
                    "signalDate": signal_date,
                    "controlNetReturnBps": control_return,
                    "treatmentNetReturnBps": treatment_return,
                    "pairedDifferenceBps": treatment_return - control_return,
                    "controlSymbols": control_symbols,
                    "treatmentSymbols": treatment_symbols,
                })

        def maximum_drawdown_bps(values: list[float]) -> float:
            equity = peak = 1.0
            drawdown = 0.0
            for value in values:
                equity *= 1 + value / 10_000
                peak = max(peak, equity)
                drawdown = max(drawdown, (peak - equity) / peak * 10_000)
            return drawdown

        horizon_reports = []
        for horizon in HORIZONS:
            sessions = comparisons[horizon]
            differences = [float(row["pairedDifferenceBps"]) for row in sessions]
            controls = [float(row["controlNetReturnBps"]) for row in sessions]
            treatments = [float(row["treatmentNetReturnBps"]) for row in sessions]
            mean_difference = statistics.fmean(differences) if differences else None
            standard_error = (
                statistics.stdev(differences) / len(differences) ** 0.5
                if len(differences) >= 2 else None
            )
            lower_95 = mean_difference - 1.96 * standard_error if standard_error is not None else None
            upper_95 = mean_difference + 1.96 * standard_error if standard_error is not None else None
            control_drawdown = maximum_drawdown_bps(controls)
            treatment_drawdown = maximum_drawdown_bps(treatments)
            extra_drawdown = treatment_drawdown - control_drawdown
            rollback = bool(
                mean_difference is not None and (
                    mean_difference <= float(definition["rollbackCriteria"]["meanPairedReturnBpsAtOrBelow"])
                    or extra_drawdown > float(definition["rollbackCriteria"]
                                              ["additionalMaximumDrawdownBpsAboveControl"])
                )
            )
            if len(sessions) < target:
                decision = "CONTINUE_COLLECTING"
            elif rollback:
                decision = "REJECT"
            elif lower_95 is not None and lower_95 > 0:
                decision = "ELIGIBLE_FOR_REVIEW"
            else:
                decision = "CONTINUE_COLLECTING"
            horizon_reports.append({
                "horizonSessions": horizon,
                "pairedSessionCount": len(sessions),
                "remainingSessionCount": max(0, target - len(sessions)),
                "meanControlNetReturnBps": round(statistics.fmean(controls), 6) if controls else None,
                "meanTreatmentNetReturnBps": (
                    round(statistics.fmean(treatments), 6) if treatments else None
                ),
                "meanPairedDifferenceBps": (
                    round(mean_difference, 6) if mean_difference is not None else None
                ),
                "pairedDifferenceLower95Bps": round(lower_95, 6) if lower_95 is not None else None,
                "pairedDifferenceUpper95Bps": round(upper_95, 6) if upper_95 is not None else None,
                "controlMaximumDrawdownBps": round(control_drawdown, 6),
                "treatmentMaximumDrawdownBps": round(treatment_drawdown, 6),
                "additionalMaximumDrawdownBps": round(extra_drawdown, 6),
                "rollbackTriggered": rollback,
                "decision": decision,
            })
        return {
            "ok": True,
            "researchOnly": True,
            "manifest": definition,
            "selectionSize": selection_size,
            "selectionPolicy": "top_research_score_then_source_rank_then_symbol",
            "pairedSessionPolicy": "both_lanes_complete_for_every_selected_candidate",
            "recommendationAuthority": False,
            "orderSubmissionAllowed": False,
            "horizons": horizon_reports,
        }

    def counterfactual_report(
        self, *, minimum_sample_size: int = 20, minimum_session_count: int = 20
    ) -> dict[str, object]:
        """Summarize pass/fail opportunity cost without turning research into trade authority."""
        rows = self.connection.execute(
            """SELECT s.lane,s.eligible,s.evaluation_json,r.signal_date,c.horizon,c.net_return_bps,
                      c.max_favorable_excursion_bps,c.max_adverse_excursion_bps,
                      cash.net_return_bps AS cash_return_bps,
                      qqq.net_return_bps AS qqq_return_bps
               FROM evidence_counterfactuals c
               JOIN evidence_symbols s USING(run_id,lane,symbol)
               JOIN evidence_runs r ON r.run_id=c.run_id
               LEFT JOIN evidence_benchmarks cash ON cash.run_id=c.run_id
                    AND cash.horizon=c.horizon AND cash.benchmark='CASH'
               LEFT JOIN evidence_benchmarks qqq ON qqq.run_id=c.run_id
                    AND qqq.horizon=c.horizon AND qqq.benchmark='QQQ'
               LEFT JOIN evidence_run_invalidations i ON i.run_id=c.run_id
               WHERE i.run_id IS NULL AND c.status='COMPLETE'
               ORDER BY s.lane,c.horizon"""
        ).fetchall()
        groups: dict[tuple[str, int, str, str], list[sqlite3.Row]] = {}
        for row in rows:
            evaluation = json.loads(row["evaluation_json"])
            disposition = "eligible" if row["eligible"] else "filtered"
            if row["eligible"]:
                reason = "eligible"
            elif evaluation.get("reason"):
                reason = str(evaluation["reason"])
            elif evaluation.get("error"):
                reason = str(evaluation["error"])
            else:
                failed = sorted(
                    str(check.get("id")) for check in evaluation.get("checks", [])
                    if isinstance(check, dict) and check.get("passed") is False and check.get("id")
                )
                reason = "+".join(failed) if failed else "unspecified"
            groups.setdefault((row["lane"], row["horizon"], disposition, reason), []).append(row)
        summaries = []
        for (lane, horizon, disposition, reason), samples in sorted(groups.items()):
            returns = [float(row["net_return_bps"]) for row in samples]
            benchmark_samples = [row for row in samples if row["cash_return_bps"] is not None
                                 and row["qqq_return_bps"] is not None]
            cash_excess = [float(row["net_return_bps"]) - float(row["cash_return_bps"])
                           for row in benchmark_samples]
            qqq_excess = [float(row["net_return_bps"]) - float(row["qqq_return_bps"])
                          for row in benchmark_samples]
            session_count = len({row["signal_date"] for row in samples})
            summaries.append({
                "lane": lane,
                "horizonSessions": horizon,
                "disposition": disposition,
                "reason": reason,
                "sampleSize": len(samples),
                "sessionCount": session_count,
                "sufficientSample": (
                    len(samples) >= minimum_sample_size and session_count >= minimum_session_count
                ),
                "averageNetReturnBps": round(statistics.fmean(returns), 6),
                "medianNetReturnBps": round(statistics.median(returns), 6),
                "winRate": round(sum(value > 0 for value in returns) / len(returns), 6),
                "benchmarkSampleSize": len(benchmark_samples),
                "averageExcessVsCashBps": (
                    round(statistics.fmean(cash_excess), 6) if cash_excess else None
                ),
                "averageExcessVsQqqBps": (
                    round(statistics.fmean(qqq_excess), 6) if qqq_excess else None
                ),
                "averageMfeBps": round(statistics.fmean(
                    float(row["max_favorable_excursion_bps"]) for row in samples
                ), 6),
                "averageMaeBps": round(statistics.fmean(
                    float(row["max_adverse_excursion_bps"]) for row in samples
                ), 6),
            })
        return {
            "ok": True,
            "researchOnly": True,
            "minimumSampleSize": minimum_sample_size,
            "minimumSessionCount": minimum_session_count,
            "completeOutcomeCount": len(rows),
            "proposalLifecycle": self.lifecycle_report(),
            "collectionReadiness": self.collection_readiness(),
            "directionalVolumeExperiment": self.directional_experiment_report(),
            "groups": summaries,
        }

    def status(self) -> dict[str, object]:
        runs = self.connection.execute("SELECT COUNT(*) FROM evidence_runs").fetchone()[0]
        invalidated = self.connection.execute("SELECT COUNT(*) FROM evidence_run_invalidations").fetchone()[0]
        latest = self.connection.execute(
            """SELECT r.signal_date,r.summary_json FROM evidence_runs r
               LEFT JOIN evidence_run_invalidations i ON i.run_id=r.run_id
               WHERE i.run_id IS NULL ORDER BY r.signal_date DESC LIMIT 1"""
        ).fetchone()
        outcomes = self.connection.execute(
            """SELECT COUNT(*) FROM evidence_outcomes o
               LEFT JOIN evidence_run_invalidations i ON i.run_id=o.run_id WHERE i.run_id IS NULL"""
        ).fetchone()[0]
        counterfactuals = self.connection.execute(
            """SELECT COUNT(*) FROM evidence_counterfactuals c
               LEFT JOIN evidence_run_invalidations i ON i.run_id=c.run_id WHERE i.run_id IS NULL"""
        ).fetchone()[0]
        benchmarks = self.connection.execute(
            """SELECT COUNT(*) FROM evidence_benchmarks b
               LEFT JOIN evidence_run_invalidations i ON i.run_id=b.run_id WHERE i.run_id IS NULL"""
        ).fetchone()[0]
        lifecycle = self.connection.execute(
            "SELECT COUNT(*) FROM evidence_lifecycle_observations"
        ).fetchone()[0]
        return {"ok": True, "runCount": runs, "activeRunCount": runs - invalidated,
                "invalidatedRunCount": invalidated, "outcomeCount": outcomes,
                "counterfactualOutcomeCount": counterfactuals,
                "benchmarkOutcomeCount": benchmarks,
                "lifecycleObservationCount": lifecycle,
                "latestSignalDate": latest["signal_date"] if latest else None,
                "latestSummary": json.loads(latest["summary_json"]) if latest else None}
