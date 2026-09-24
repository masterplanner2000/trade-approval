"""Append-only archive for reproducible daily strategy-performance reports."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Any


def _canonical(value: dict[str, Any]) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


class PerformanceReportArchive:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path)
        self.connection.row_factory = sqlite3.Row
        self.connection.executescript("""
            CREATE TABLE IF NOT EXISTS performance_reports(
              report_sha256 TEXT PRIMARY KEY,
              report_date TEXT NOT NULL,
              observed_at TEXT NOT NULL,
              status TEXT NOT NULL,
              fees_complete INTEGER NOT NULL,
              report_json TEXT NOT NULL,
              UNIQUE(report_date, report_sha256)
            );
            CREATE TRIGGER IF NOT EXISTS performance_reports_no_update
            BEFORE UPDATE ON performance_reports
            BEGIN SELECT RAISE(ABORT,'performance_report_is_immutable'); END;
            CREATE TRIGGER IF NOT EXISTS performance_reports_no_delete
            BEFORE DELETE ON performance_reports
            BEGIN SELECT RAISE(ABORT,'performance_report_is_immutable'); END;
        """)

    def close(self) -> None:
        self.connection.close()

    def record(self, report: dict[str, Any], *, observed_at: str) -> dict[str, Any]:
        if not report.get("ok") or not isinstance(report.get("status"), str):
            raise ValueError("performance_report_invalid")
        window = report.get("window")
        if not isinstance(window, dict) or not isinstance(window.get("endDate"), str):
            raise ValueError("performance_report_window_invalid")
        payload = _canonical(report)
        digest = hashlib.sha256(payload.encode()).hexdigest()
        existing = self.connection.execute(
            "SELECT 1 FROM performance_reports WHERE report_sha256=?", (digest,)
        ).fetchone()
        if existing:
            return {"recorded": False, "idempotent": True, "reportSha256": digest}
        with self.connection:
            self.connection.execute(
                "INSERT INTO performance_reports VALUES(?,?,?,?,?,?)",
                (digest, window["endDate"], observed_at, report["status"],
                 int(bool(report.get("feesComplete"))), payload),
            )
        return {"recorded": True, "idempotent": False, "reportSha256": digest}

    def latest(self) -> dict[str, Any] | None:
        row = self.connection.execute(
            "SELECT * FROM performance_reports ORDER BY observed_at DESC,rowid DESC LIMIT 1"
        ).fetchone()
        if row is None:
            return None
        return {
            "reportSha256": row["report_sha256"], "reportDate": row["report_date"],
            "observedAt": row["observed_at"], "status": row["status"],
            "feesComplete": bool(row["fees_complete"]),
            "report": json.loads(row["report_json"]),
        }
