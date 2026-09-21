from __future__ import annotations

import sqlite3
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from daily_evidence_capture import DailyEvidenceStore
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
