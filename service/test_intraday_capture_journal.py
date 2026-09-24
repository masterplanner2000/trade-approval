import sqlite3
import tempfile
import unittest
from pathlib import Path

from intraday_capture_journal import IntradayCaptureJournal


class IntradayCaptureJournalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "capture.sqlite3"
        self.journal = IntradayCaptureJournal(self.path)

    def tearDown(self):
        self.journal.close()
        self.temp.cleanup()

    def records(self):
        return [
            {"symbol": "PASS", "status": "PASS", "envelope": {"score": 80}},
            {"symbol": "FAIL", "status": "REJECTED", "envelope": {"reason": "spread"}},
            {"symbol": "MISS", "status": "INCOMPLETE", "envelope": {"error": "provider"}},
        ]

    def test_run_is_atomic_idempotent_and_counts_every_status(self):
        first = self.journal.append_run(
            scheduled_at="2026-09-24T15:00:00Z", completed_at="2026-09-24T15:00:02Z",
            records=self.records(),
        )
        second = self.journal.append_run(
            scheduled_at="2026-09-24T15:00:00Z", completed_at="2026-09-24T15:00:03Z",
            records=self.records(),
        )
        self.assertTrue(first["created"])
        self.assertFalse(second["created"])
        self.assertEqual(first["summary"]["statusCounts"],
                         {"INCOMPLETE": 1, "PASS": 1, "REJECTED": 1})
        self.assertEqual(self.journal.latest()["runId"], first["runId"])

    def test_changed_retry_conflicts_instead_of_rewriting_history(self):
        self.journal.append_run(
            scheduled_at="2026-09-24T15:00:00Z", completed_at="2026-09-24T15:00:02Z",
            records=self.records(),
        )
        changed = self.records()
        changed[0]["envelope"]["score"] = 81
        with self.assertRaisesRegex(ValueError, "intraday_capture_run_conflict"):
            self.journal.append_run(
                scheduled_at="2026-09-24T15:00:00Z", completed_at="2026-09-24T15:00:03Z",
                records=changed,
            )

    def test_database_rejects_update_and_delete(self):
        run = self.journal.append_run(
            scheduled_at="2026-09-24T15:00:00Z", completed_at="2026-09-24T15:00:02Z",
            records=self.records(),
        )
        for statement in ("UPDATE capture_runs SET scheduled_at='x' WHERE run_id=?",
                          "DELETE FROM capture_records WHERE run_id=?"):
            with self.assertRaisesRegex(sqlite3.IntegrityError, "intraday_capture_is_immutable"):
                self.journal.connection.execute(statement, (run["runId"],))
            self.journal.connection.rollback()


if __name__ == "__main__":
    unittest.main()
