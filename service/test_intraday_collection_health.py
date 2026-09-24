import unittest
from datetime import datetime, timedelta, timezone

from intraday_collection_health import build_collection_health


OPEN = datetime(2026, 9, 24, 13, 30, tzinfo=timezone.utc)


def run(offset, status="REJECTED", portfolio="COMPLETE"):
    scheduled = OPEN + timedelta(minutes=offset)
    return {
        "scheduledAt": scheduled.isoformat().replace("+00:00", "Z"),
        "records": [{"symbol": symbol, "status": status,
                     "envelope": {"portfolio": {"status": portfolio}}}
                    for symbol in ("A", "B", "C", "D")],
    }


class IntradayCollectionHealthTests(unittest.TestCase):
    def test_complete_closed_session_is_usable(self):
        runs = [run(index * 5) for index in range(78)]
        report = build_collection_health(
            runs, as_of=datetime(2026, 9, 24, 21, tzinfo=timezone.utc),
            outcome_records=[{"status": "COMPLETE", "sourceScheduledAt":
                              "2026-09-24T14:00:00Z"}],
        )
        session = report["sessions"][0]
        self.assertEqual(session["coveragePercent"], 100)
        self.assertEqual(session["recordCompletenessPercent"], 100)
        self.assertEqual(session["status"], "USABLE")
        self.assertEqual(report["sessionsRemainingForReview"], 19)
        self.assertFalse(report["orderSubmissionAllowed"])

    def test_missing_slots_and_incomplete_records_are_degraded(self):
        runs = [run(index * 10) for index in range(39)]
        for index in range(4):
            runs[index] = run(index * 10, status="INCOMPLETE", portfolio="INCOMPLETE")
        report = build_collection_health(
            runs, as_of=datetime(2026, 9, 24, 21, tzinfo=timezone.utc),
            outcome_records=[],
        )
        session = report["sessions"][0]
        self.assertEqual(session["status"], "DEGRADED")
        self.assertIn("capture_coverage_below_threshold", session["blockers"])
        self.assertIn("record_completeness_below_threshold", session["blockers"])

    def test_duplicate_runs_in_one_slot_do_not_inflate_coverage(self):
        report = build_collection_health(
            [run(0), run(1)], as_of=OPEN + timedelta(minutes=9),
            outcome_records=[],
        )
        session = report["sessions"][0]
        self.assertEqual(session["expectedCaptureSlots"], 2)
        self.assertEqual(session["observedCaptureSlots"], 1)
        self.assertEqual(session["coveragePercent"], 50)


if __name__ == "__main__":
    unittest.main()
