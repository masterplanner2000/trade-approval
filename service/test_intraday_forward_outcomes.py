import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from intraday_forward_outcomes import IntradayOutcomeJournal, build_mature_outcomes


START = datetime(2026, 9, 24, 15, 0, tzinfo=timezone.utc)


def run(at, *, status="PASS", last=100.0, bid=99.98, ask=100.02, symbol="TEST"):
    record_id = f"{symbol}-{at.isoformat()}"
    return {
        "runId": f"run-{at.isoformat()}", "scheduledAt": at.isoformat(),
        "records": [{
            "recordId": record_id, "symbol": symbol, "status": status,
            "envelope": {
                "market": {"last": last, "bid": bid, "ask": ask},
                "score": {"total": 81, "band": "strong"},
                "safety": {"shadowEligible": status == "PASS"},
            },
        }],
    }


class IntradayForwardOutcomeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.journal = IntradayOutcomeJournal(Path(self.temp.name) / "outcomes.sqlite3")

    def tearDown(self):
        self.journal.close()
        self.temp.cleanup()

    def test_exact_forward_observation_records_raw_and_after_cost_returns(self):
        runs = [
            run(START, status="REJECTED"),
            run(START + timedelta(minutes=5), last=101, bid=100.98, ask=101.02),
            run(START + timedelta(minutes=30), last=103, bid=102.98, ask=103.02),
        ]
        outcomes = build_mature_outcomes(runs, as_of=START + timedelta(minutes=30))
        source = [item for item in outcomes if item["sourceScheduledAt"] == "2026-09-24T15:00:00Z"]
        self.assertEqual([item["horizon"] for item in source], ["5m", "30m"])
        self.assertEqual(source[0]["grossLastReturnPercent"], 1.0)
        self.assertLess(source[0]["estimatedAfterCostReturnPercent"], 1.0)
        self.assertEqual(source[0]["sourceStatus"], "REJECTED")
        self.assertEqual(source[0]["sourceScore"]["total"], 81)
        self.assertFalse(source[0]["orderSubmissionAllowed"])

    def test_missing_mature_window_is_incomplete_but_future_window_waits(self):
        runs = [run(START)]
        waiting = build_mature_outcomes(runs, as_of=START + timedelta(minutes=6))
        self.assertEqual(waiting, [])
        mature = build_mature_outcomes(runs, as_of=START + timedelta(minutes=8))
        self.assertEqual(len(mature), 1)
        self.assertEqual(mature[0]["horizon"], "5m")
        self.assertEqual(mature[0]["status"], "INCOMPLETE")
        self.assertEqual(mature[0]["missing"], ["target_observation"])

    def test_horizon_past_market_close_is_not_an_expected_outcome(self):
        near_close = datetime(2026, 9, 24, 19, 45, tzinfo=timezone.utc)
        outcomes = build_mature_outcomes([run(near_close)],
                                         as_of=near_close + timedelta(hours=1))
        self.assertEqual([item["horizon"] for item in outcomes], ["5m"])

    def test_journal_is_idempotent_immutable_and_conflict_safe(self):
        outcome = build_mature_outcomes(
            [run(START), run(START + timedelta(minutes=5), last=101, bid=100.98, ask=101.02)],
            as_of=START + timedelta(minutes=5),
        )[0]
        self.assertEqual(self.journal.append_many([outcome]),
                         {"created": 1, "duplicates": 0, "total": 1})
        self.assertEqual(self.journal.append_many([outcome]),
                         {"created": 0, "duplicates": 1, "total": 1})
        with self.assertRaisesRegex(ValueError, "intraday_outcome_conflict"):
            self.journal.append_many([{**outcome, "grossLastReturnPercent": 999}])
        with self.assertRaisesRegex(sqlite3.IntegrityError, "intraday_outcomes_are_immutable"):
            self.journal.connection.execute("UPDATE intraday_outcomes SET status='INCOMPLETE'")
        summary = self.journal.summary()
        self.assertEqual(summary["statusCounts"], {"COMPLETE": 1, "INCOMPLETE": 0})
        self.assertEqual(summary["cohorts"]["PASS:5m"]["complete"], 1)
        self.assertEqual(summary["cohorts"]["PASS:5m"]["distinctSessions"], 1)
        self.assertIsNotNone(summary["cohorts"]["PASS:5m"]["averageAfterCostReturnPercent"])
        self.assertFalse(summary["cohorts"]["PASS:5m"]["adequateSample"])
        self.assertFalse(summary["orderSubmissionAllowed"])


if __name__ == "__main__":
    unittest.main()
