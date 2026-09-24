from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from performance_report_archive import PerformanceReportArchive


class PerformanceReportArchiveTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "reports.sqlite3"
        self.archive = PerformanceReportArchive(self.path)

    def tearDown(self) -> None:
        self.archive.close()
        self.temp.cleanup()

    @staticmethod
    def report(fees: bool = False) -> dict:
        return {"ok": True, "status": "COMPLETE_NET" if fees else "COMPLETE_GROSS",
                "feesComplete": fees, "window": {"startDate": "20260901",
                                                   "endDate": "20260923"},
                "grossReturnBps": 12.5, "netReturnBps": 10 if fees else None}

    def test_exact_repeat_is_idempotent_and_fee_revision_is_preserved(self) -> None:
        first = self.archive.record(self.report(), observed_at="2026-09-23T20:30:00Z")
        repeat = self.archive.record(self.report(), observed_at="2026-09-23T20:31:00Z")
        revised = self.archive.record(self.report(True), observed_at="2026-09-23T21:00:00Z")
        self.assertTrue(first["recorded"])
        self.assertTrue(repeat["idempotent"])
        self.assertTrue(revised["recorded"])
        self.assertTrue(self.archive.latest()["feesComplete"])
        count = self.archive.connection.execute(
            "SELECT COUNT(*) FROM performance_reports"
        ).fetchone()[0]
        self.assertEqual(count, 2)

    def test_archive_rows_are_immutable_and_invalid_reports_fail(self) -> None:
        self.archive.record(self.report(), observed_at="2026-09-23T20:30:00Z")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "performance_report_is_immutable"):
            self.archive.connection.execute("UPDATE performance_reports SET status='changed'")
        with self.assertRaisesRegex(ValueError, "performance_report_window_invalid"):
            self.archive.record({"ok": True, "status": "X"}, observed_at="now")


if __name__ == "__main__":
    unittest.main()
