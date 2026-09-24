from __future__ import annotations

import sqlite3
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from daily_evidence_capture import DailyEvidenceStore
from ibkr_daily_scanner import DailyBar
from shadow_strategy_comparison import load_cache


def make_cache(path: Path, *, shadow: bool = False, count: int = 270) -> None:
    with sqlite3.connect(path) as connection:
        connection.execute("CREATE TABLE assets(symbol TEXT PRIMARY KEY,rank INTEGER)")
        connection.execute("""CREATE TABLE daily_bars(symbol TEXT,trading_day TEXT,open REAL,high REAL,
                            low REAL,close REAL,volume REAL,PRIMARY KEY(symbol,trading_day))""")
        connection.execute("CREATE TABLE cache_meta(key TEXT PRIMARY KEY,value TEXT)")
        connection.execute("INSERT INTO assets VALUES('TEST',1)")
        price = 20.0
        start = date(2025, 1, 1)
        for index in range(count):
            price *= 1.012 if index % 5 < 3 else .992
            day = (start + timedelta(days=index)).strftime("%Y%m%d")
            volume = 10_000_000 if index % 5 == 0 else 5_000_000
            connection.execute("INSERT INTO daily_bars VALUES(?,?,?,?,?,?,?)",
                               ("TEST", day, price * .995, price * 1.02, price * .98, price, volume))
        completed = (start + timedelta(days=count - 1)).isoformat()
        connection.executemany("INSERT INTO cache_meta VALUES(?,?)",
                               (("completed_through", completed), ("data_feed", "iex")))


class DailyEvidenceCaptureTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.baseline, self.shadow = root / "baseline.sqlite3", root / "shadow.sqlite3"
        make_cache(self.baseline)
        make_cache(self.shadow, shadow=True)
        self.store = DailyEvidenceStore(root / "evidence.sqlite3")

    def tearDown(self) -> None:
        self.store.close()
        self.temp.cleanup()

    def test_capture_is_restart_safe_idempotent_and_immutable(self) -> None:
        first = self.store.capture(self.baseline, self.shadow, captured_at="2026-09-21T21:00:00Z")
        second = self.store.capture(self.baseline, self.shadow, captured_at="2026-09-21T22:00:00Z")
        self.assertFalse(first["idempotent"])
        self.assertTrue(second["idempotent"])
        self.assertEqual(first["runId"], second["runId"])
        with self.assertRaisesRegex(sqlite3.IntegrityError, "evidence_run_is_immutable"):
            self.store.connection.execute("UPDATE evidence_runs SET captured_at='x'")

    def test_changed_same_day_evidence_is_a_conflict(self) -> None:
        self.store.capture(self.baseline, self.shadow, captured_at="2026-09-21T21:00:00Z")
        with self.assertRaisesRegex(ValueError, "daily_evidence_capture_conflict"):
            self.store.capture(self.baseline, self.shadow, captured_at="2026-09-21T22:00:00Z",
                               catalysts={"TEST": {"category": "earnings"}})

    def test_outcomes_append_only_when_horizon_exists(self) -> None:
        self.store.capture(self.baseline, self.shadow, captured_at="2026-09-21T21:00:00Z")
        _, histories = load_cache(self.baseline)
        first = self.store.record_available_outcomes(histories, recorded_at="2026-09-22T21:00:00Z")
        self.assertEqual(first["inserted"], 0)
        self.assertGreater(first["pending"], 0)

    def test_counterfactuals_measure_every_candidate_with_path_and_costs(self) -> None:
        self.store.capture(self.baseline, self.shadow, captured_at="2026-09-21T21:00:00Z")
        _, histories = load_cache(self.baseline)
        last = histories["TEST"][-1]
        price = last.close
        for offset in range(1, 11):
            price *= 1.01
            histories["TEST"].append(DailyBar(
                date=(date.fromisoformat(last.date[:4] + "-" + last.date[4:6] + "-" + last.date[6:])
                      + timedelta(days=offset)).strftime("%Y%m%d"),
                open=price, high=price * 1.03, low=price * .98, close=price * 1.01,
                volume=6_000_000,
            ))
        result = self.store.record_available_counterfactuals(
            histories, recorded_at="2027-09-22T21:00:00Z", round_trip_cost_bps=25
        )
        symbol_count = self.store.connection.execute(
            "SELECT COUNT(*) FROM evidence_symbols"
        ).fetchone()[0]
        self.assertEqual(result, {"inserted": symbol_count * 3, "pending": 0})
        row = self.store.connection.execute(
            """SELECT gross_return_bps,net_return_bps,round_trip_cost_bps,
                      max_favorable_excursion_bps,max_adverse_excursion_bps
               FROM evidence_counterfactuals WHERE horizon=5 LIMIT 1"""
        ).fetchone()
        self.assertAlmostEqual(row["gross_return_bps"] - row["net_return_bps"], 25)
        self.assertEqual(row["round_trip_cost_bps"], 25)
        self.assertGreater(row["max_favorable_excursion_bps"], 0)
        self.assertLess(row["max_adverse_excursion_bps"], row["max_favorable_excursion_bps"])
        self.assertEqual(
            self.store.record_available_counterfactuals(
                histories, recorded_at="2027-09-22T22:00:00Z", round_trip_cost_bps=25
            ),
            {"inserted": 0, "pending": 0},
        )

    def test_counterfactual_report_separates_passes_and_rejection_reasons(self) -> None:
        self.store.capture(self.baseline, self.shadow, captured_at="2026-09-21T21:00:00Z")
        _, histories = load_cache(self.baseline)
        last = histories["TEST"][-1]
        for offset in range(1, 11):
            histories["TEST"].append(DailyBar(
                date=(date.fromisoformat(last.date[:4] + "-" + last.date[4:6] + "-" + last.date[6:])
                      + timedelta(days=offset)).strftime("%Y%m%d"),
                open=last.close, high=last.close * 1.02, low=last.close * .99,
                close=last.close * 1.01, volume=6_000_000,
            ))
        self.store.record_available_counterfactuals(histories, recorded_at="2027-09-22T21:00:00Z")
        report = self.store.counterfactual_report(minimum_sample_size=20)
        self.assertTrue(report["researchOnly"])
        self.assertGreater(report["completeOutcomeCount"], 0)
        self.assertTrue(all(not group["sufficientSample"] for group in report["groups"]))
        self.assertTrue(all(group["sessionCount"] == 1 for group in report["groups"]))
        dispositions = {group["disposition"] for group in report["groups"]}
        expected = {"eligible" if row[0] else "filtered" for row in self.store.connection.execute(
            "SELECT eligible FROM evidence_symbols"
        )}
        self.assertEqual(dispositions, expected)

    def test_cash_and_qqq_benchmarks_share_exact_windows_and_are_immutable(self) -> None:
        run = self.store.capture(
            self.baseline, self.shadow, captured_at="2026-09-21T21:00:00Z"
        )
        _, histories = load_cache(self.baseline)
        last = histories["TEST"][-1]
        qqq = [DailyBar(last.date, 100, 101, 99, 100, 10_000_000)]
        for offset in range(1, 11):
            day = (date.fromisoformat(
                last.date[:4] + "-" + last.date[4:6] + "-" + last.date[6:]
            ) + timedelta(days=offset)).strftime("%Y%m%d")
            qqq.append(DailyBar(day, 100, 103, 99, 102, 10_000_000))
        histories["QQQ"] = qqq
        result = self.store.record_available_benchmarks(
            histories, recorded_at="2027-09-22T21:00:00Z", round_trip_cost_bps=20
        )
        self.assertEqual(result, {"inserted": 6, "pending": 0})
        cash = self.store.connection.execute(
            """SELECT * FROM evidence_benchmarks
               WHERE run_id=? AND horizon=1 AND benchmark='CASH'""", (run["runId"],)
        ).fetchone()
        qqq_row = self.store.connection.execute(
            """SELECT * FROM evidence_benchmarks
               WHERE run_id=? AND horizon=1 AND benchmark='QQQ'""", (run["runId"],)
        ).fetchone()
        self.assertEqual(cash["net_return_bps"], 0)
        self.assertEqual(cash["entry_date"], qqq_row["entry_date"])
        self.assertEqual(cash["exit_date"], qqq_row["exit_date"])
        self.assertAlmostEqual(qqq_row["net_return_bps"], 180)
        self.assertEqual(
            self.store.record_available_benchmarks(
                histories, recorded_at="2027-09-22T22:00:00Z"
            ),
            {"inserted": 0, "pending": 0},
        )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "evidence_benchmark_is_immutable"):
            self.store.connection.execute(
                "UPDATE evidence_benchmarks SET net_return_bps=999 WHERE run_id=?", (run["runId"],)
            )

    def test_report_includes_cash_and_qqq_excess_returns(self) -> None:
        self.store.capture(self.baseline, self.shadow, captured_at="2026-09-21T21:00:00Z")
        _, histories = load_cache(self.baseline)
        last = histories["TEST"][-1]
        future = []
        for offset in range(1, 11):
            day = (date.fromisoformat(
                last.date[:4] + "-" + last.date[4:6] + "-" + last.date[6:]
            ) + timedelta(days=offset)).strftime("%Y%m%d")
            future.append(DailyBar(day, last.close, last.close * 1.03, last.close * .99,
                                   last.close * 1.02, 10_000_000))
        histories["TEST"].extend(future)
        histories["QQQ"] = [DailyBar(last.date, 100, 101, 99, 100, 10_000_000)] + [
            DailyBar(bar.date, 100, 102, 99, 101, 10_000_000) for bar in future
        ]
        self.store.record_available_counterfactuals(histories, recorded_at="2027-09-22T21:00:00Z")
        self.store.record_available_benchmarks(histories, recorded_at="2027-09-22T21:00:00Z")
        report = self.store.counterfactual_report()
        self.assertTrue(all(group["benchmarkSampleSize"] == group["sampleSize"]
                            for group in report["groups"]))
        self.assertTrue(all(group["averageExcessVsCashBps"] is not None
                            and group["averageExcessVsQqqBps"] is not None
                            for group in report["groups"]))
        readiness = self.store.collection_readiness(target_sessions=2)
        self.assertEqual(readiness["capturedSessionCount"], 1)
        self.assertFalse(readiness["strategyRuleReviewReady"])
        self.assertTrue(all(item["usableSessionCount"] == 1 for item in readiness["horizons"]))
        self.assertTrue(all(item["remainingSessionCount"] == 1 for item in readiness["horizons"]))
        self.assertIn("forward_horizon_sessions_below_target", readiness["blockers"])

    def test_collection_readiness_rejects_invalid_target(self) -> None:
        with self.assertRaisesRegex(ValueError, "daily_evidence_target_sessions_invalid"):
            self.store.collection_readiness(target_sessions=0)

    def test_directional_experiment_requires_paired_complete_forward_sessions(self) -> None:
        # Freeze one setup eligible in both lanes so the paired-session mechanics can be verified.
        with sqlite3.connect(self.shadow) as connection:
            days = [row[0] for row in connection.execute(
                "SELECT trading_day FROM daily_bars WHERE symbol='TEST' ORDER BY trading_day DESC LIMIT 6"
            ).fetchall()][::-1]
            starting = connection.execute(
                "SELECT close FROM daily_bars WHERE symbol='TEST' AND trading_day=?", (days[0],)
            ).fetchone()[0]
            for index, day in enumerate(days):
                close = starting * (1.02 ** index)
                connection.execute(
                    """UPDATE daily_bars SET open=?,high=?,low=?,close=?,volume=?
                       WHERE symbol='TEST' AND trading_day=?""",
                    (close * .995, close * 1.02, close * .98, close,
                     20_000_000 if index == len(days) - 1 else 5_000_000, day),
                )
        self.store.capture(self.baseline, self.shadow, captured_at="2026-09-21T21:00:00Z")
        before = self.store.directional_experiment_report(selection_size=1)
        self.assertTrue(before["researchOnly"])
        self.assertFalse(before["recommendationAuthority"])
        self.assertFalse(before["orderSubmissionAllowed"])
        self.assertTrue(all(item["pairedSessionCount"] == 0 for item in before["horizons"]))
        _, histories = load_cache(self.baseline)
        last = histories["TEST"][-1]
        for offset in range(1, 11):
            day = (date.fromisoformat(
                last.date[:4] + "-" + last.date[4:6] + "-" + last.date[6:]
            ) + timedelta(days=offset)).strftime("%Y%m%d")
            histories["TEST"].append(DailyBar(
                day, last.close, last.close * 1.03, last.close * .99,
                last.close * 1.01, 6_000_000,
            ))
        self.store.record_available_counterfactuals(
            histories, recorded_at="2027-09-22T21:00:00Z"
        )
        after = self.store.directional_experiment_report(selection_size=1)
        self.assertTrue(all(item["pairedSessionCount"] == 1 for item in after["horizons"]))
        self.assertTrue(all(item["decision"] == "CONTINUE_COLLECTING"
                            for item in after["horizons"]))
        self.assertTrue(all(item["remainingSessionCount"] == 19 for item in after["horizons"]))

    def test_directional_experiment_rejects_invalid_selection_size(self) -> None:
        with self.assertRaisesRegex(ValueError, "directional_experiment_selection_size_invalid"):
            self.store.directional_experiment_report(selection_size=0)

    def test_ledger_lifecycle_links_exact_signal_and_preserves_execution_gaps(self) -> None:
        run = self.store.capture(self.baseline, self.shadow, captured_at="2026-09-21T21:00:00Z")
        signal_date = run["signalDate"].replace("-", "")
        ledger_path = Path(self.temp.name) / "ledger.sqlite3"
        with sqlite3.connect(ledger_path) as ledger:
            ledger.executescript("""
                CREATE TABLE proposals(id TEXT PRIMARY KEY,created_at INTEGER,status TEXT,
                  environment TEXT,symbol TEXT,side TEXT,terms_json TEXT,source_json TEXT);
                CREATE TABLE decisions(id TEXT PRIMARY KEY,proposal_id TEXT,decision TEXT,decided_at INTEGER);
                CREATE TABLE submission_attempts(id TEXT PRIMARY KEY,decision_id TEXT,status TEXT,started_at INTEGER);
                CREATE TABLE broker_orders(proposal_id TEXT,role TEXT,status TEXT,order_json TEXT,
                  last_seen_at INTEGER);
            """)
            ledger.execute("INSERT INTO proposals VALUES(?,?,?,?,?,?,?,?)", (
                "proposal-1", 1_000, "submitted", "paper", "TEST", "buy",
                __import__("json").dumps({"quantity": 2, "limitPrice": 101}),
                __import__("json").dumps({"signalDate": signal_date,
                                          "universeSource": "alpaca-cache"}),
            ))
            ledger.execute("INSERT INTO decisions VALUES(?,?,?,?)",
                           ("decision-1", "proposal-1", "approved", 2_000))
            ledger.execute("INSERT INTO submission_attempts VALUES(?,?,?,?)",
                           ("attempt-1", "decision-1", "submitted", 3_000))
            ledger.execute("INSERT INTO broker_orders VALUES(?,?,?,?,?)", (
                "proposal-1", "entry", "Filled",
                __import__("json").dumps({"cumulativeQuantity": 2, "averagePrice": 100}), 4_000,
            ))
        first = self.store.record_ledger_lifecycle(
            ledger_path, recorded_at="2026-09-22T21:00:00Z"
        )
        self.assertEqual(first, {"inserted": 1, "idempotent": 0, "unlinked": 0})
        self.assertEqual(
            self.store.record_ledger_lifecycle(ledger_path, recorded_at="2026-09-22T22:00:00Z"),
            {"inserted": 0, "idempotent": 1, "unlinked": 0},
        )
        report = self.store.lifecycle_report()
        self.assertEqual(report["matchedProposalCount"], 1)
        self.assertEqual(report["filledEntryCount"], 1)
        self.assertEqual(report["slippageSampleSize"], 1)
        self.assertAlmostEqual(report["averageEntrySlippageBps"], -99.009901)
        self.assertEqual(report["commissionCompleteFillCount"], 0)
        self.assertEqual(report["incompleteReasons"], {"commission_missing": 1})
        self.assertEqual(report["proposalDispositions"], {"approved": 1})
        with self.assertRaisesRegex(sqlite3.IntegrityError, "evidence_lifecycle_is_immutable"):
            self.store.connection.execute(
                "UPDATE evidence_lifecycle_observations SET proposal_status='changed'"
            )

    def test_unmatched_historical_proposal_is_visible_but_not_attributed(self) -> None:
        self.store.capture(self.baseline, self.shadow, captured_at="2026-09-21T21:00:00Z")
        ledger_path = Path(self.temp.name) / "old-ledger.sqlite3"
        with sqlite3.connect(ledger_path) as ledger:
            ledger.executescript("""
                CREATE TABLE proposals(id TEXT PRIMARY KEY,created_at INTEGER,status TEXT,
                  environment TEXT,symbol TEXT,side TEXT,terms_json TEXT,source_json TEXT);
                CREATE TABLE decisions(id TEXT PRIMARY KEY,proposal_id TEXT,decision TEXT,decided_at INTEGER);
                CREATE TABLE submission_attempts(id TEXT PRIMARY KEY,decision_id TEXT,status TEXT,started_at INTEGER);
                CREATE TABLE broker_orders(proposal_id TEXT,role TEXT,status TEXT,order_json TEXT,
                  last_seen_at INTEGER);
            """)
            ledger.execute("INSERT INTO proposals VALUES(?,?,?,?,?,?,?,?)", (
                "old", 1, "denied", "paper", "TEST", "buy", "{}",
                '{"signalDate":"20200101","universeSource":"alpaca-cache"}',
            ))
            ledger.execute("INSERT INTO decisions VALUES(?,?,?,?)", ("d", "old", "denied", 2))
        result = self.store.record_ledger_lifecycle(
            ledger_path, recorded_at="2026-09-22T21:00:00Z"
        )
        self.assertEqual(result, {"inserted": 1, "idempotent": 0, "unlinked": 1})
        report = self.store.lifecycle_report()
        self.assertEqual(report["matchedProposalCount"], 0)
        self.assertEqual(report["incompleteReasons"], {"evidence_run_or_symbol_missing": 1})

    def test_schema_one_migrates_without_rewriting_evidence(self) -> None:
        path = Path(self.temp.name) / "legacy-evidence.sqlite3"
        with sqlite3.connect(path) as connection:
            connection.execute("CREATE TABLE evidence_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
            connection.execute("INSERT INTO evidence_meta VALUES('schema_version','1')")
        migrated = DailyEvidenceStore(path)
        try:
            self.assertEqual(
                migrated.connection.execute(
                    "SELECT value FROM evidence_meta WHERE key='schema_version'"
                ).fetchone()[0],
                "4",
            )
            self.assertIsNotNone(migrated.connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='evidence_counterfactuals'"
            ).fetchone())
            self.assertIsNotNone(migrated.connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='evidence_benchmarks'"
            ).fetchone())
            self.assertIsNotNone(migrated.connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='evidence_lifecycle_observations'"
            ).fetchone())
        finally:
            migrated.close()

    def test_invalidation_is_append_only_idempotent_and_excluded_from_status(self) -> None:
        run = self.store.capture(self.baseline, self.shadow, captured_at="2026-09-21T21:00:00Z")
        first = self.store.invalidate_run(
            run["runId"], reason="certified close was evaluated as intraday",
            recorded_at="2026-09-22T12:00:00Z",
        )
        second = self.store.invalidate_run(
            run["runId"], reason="certified close was evaluated as intraday",
            recorded_at="2026-09-22T13:00:00Z",
        )
        self.assertFalse(first["idempotent"])
        self.assertTrue(second["idempotent"])
        status = self.store.status()
        self.assertEqual(status["runCount"], 1)
        self.assertEqual(status["activeRunCount"], 0)
        self.assertEqual(status["invalidatedRunCount"], 1)
        self.assertIsNone(status["latestSignalDate"])
        with self.assertRaisesRegex(ValueError, "daily_evidence_invalidation_conflict"):
            self.store.invalidate_run(
                run["runId"], reason="different reason", recorded_at="2026-09-22T14:00:00Z"
            )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "evidence_invalidation_is_immutable"):
            self.store.connection.execute(
                "UPDATE evidence_run_invalidations SET reason='changed' WHERE run_id=?", (run["runId"],)
            )

    def test_invalidated_run_never_receives_new_outcomes(self) -> None:
        run = self.store.capture(self.baseline, self.shadow, captured_at="2026-09-21T21:00:00Z")
        self.store.invalidate_run(run["runId"], reason="bad input boundary",
                                  recorded_at="2026-09-22T12:00:00Z")
        _, histories = load_cache(self.baseline)
        result = self.store.record_available_outcomes(histories, recorded_at="2027-09-22T21:00:00Z")
        self.assertEqual(result, {"inserted": 0, "pending": 0})

    def test_mismatched_cache_boundaries_fail_closed(self) -> None:
        with sqlite3.connect(self.shadow) as connection:
            connection.execute("UPDATE cache_meta SET value='2025-01-01' WHERE key='completed_through'")
        with self.assertRaisesRegex(ValueError, "daily_evidence_completion_boundary_mismatch"):
            self.store.capture(self.baseline, self.shadow, captured_at="2026-09-21T21:00:00Z")

    def test_missing_symbol_bar_is_preserved_as_explicit_rejection(self) -> None:
        with sqlite3.connect(self.shadow) as connection:
            latest = connection.execute("SELECT max(trading_day) FROM daily_bars WHERE symbol='TEST'").fetchone()[0]
            rows = connection.execute(
                "SELECT trading_day,open,high,low,close,volume FROM daily_bars WHERE symbol='TEST'"
            ).fetchall()
            connection.execute("DELETE FROM daily_bars WHERE symbol='TEST' AND trading_day=?", (latest,))
            for rank in range(2, 6):
                symbol = f"CURRENT{rank}"
                connection.execute("INSERT INTO assets VALUES(?,?)", (symbol, rank))
                connection.executemany("INSERT INTO daily_bars VALUES(?,?,?,?,?,?,?)",
                                       [(symbol, *row) for row in rows])
        result = self.store.capture(self.baseline, self.shadow, captured_at="2026-09-21T21:00:00Z")
        row = self.store.connection.execute(
            "SELECT evaluation_json FROM evidence_symbols WHERE run_id=? AND lane='shadow' AND symbol='TEST'",
            (result["runId"],),
        ).fetchone()
        evaluation = __import__("json").loads(row[0])
        self.assertFalse(evaluation["eligible"])
        self.assertEqual(evaluation["reason"], "completed_session_bar_missing")
        self.assertIn("lastAvailableSignalDate", evaluation)


if __name__ == "__main__":
    unittest.main()
