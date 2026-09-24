"""Append-only full-pipeline records for scheduled intraday shadow capture."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Iterable, Mapping


SCHEMA_VERSION = 1
ALLOWED_STATUSES = {"PASS", "REJECTED", "INCOMPLETE"}


def canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


class IntradayCaptureJournal:
    def __init__(self, path: str | Path):
        if not path:
            raise ValueError("capture_journal_path_required")
        path = str(path)
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA synchronous=FULL")
        self.connection.executescript("""
        CREATE TABLE IF NOT EXISTS capture_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS capture_runs(
          run_id TEXT PRIMARY KEY, scheduled_at TEXT NOT NULL, completed_at TEXT NOT NULL,
          symbols_json TEXT NOT NULL, summary_json TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS capture_records(
          record_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, symbol TEXT NOT NULL,
          status TEXT NOT NULL, envelope_json TEXT NOT NULL,
          FOREIGN KEY(run_id) REFERENCES capture_runs(run_id)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS capture_records_run ON capture_records(run_id,symbol);
        CREATE TRIGGER IF NOT EXISTS capture_runs_no_update BEFORE UPDATE ON capture_runs BEGIN
          SELECT RAISE(ABORT,'intraday_capture_is_immutable'); END;
        CREATE TRIGGER IF NOT EXISTS capture_runs_no_delete BEFORE DELETE ON capture_runs BEGIN
          SELECT RAISE(ABORT,'intraday_capture_is_immutable'); END;
        CREATE TRIGGER IF NOT EXISTS capture_records_no_update BEFORE UPDATE ON capture_records BEGIN
          SELECT RAISE(ABORT,'intraday_capture_is_immutable'); END;
        CREATE TRIGGER IF NOT EXISTS capture_records_no_delete BEFORE DELETE ON capture_records BEGIN
          SELECT RAISE(ABORT,'intraday_capture_is_immutable'); END;
        """)
        version = self.connection.execute(
            "SELECT value FROM capture_meta WHERE key='schema_version'"
        ).fetchone()
        if version is None:
            self.connection.execute("INSERT INTO capture_meta VALUES('schema_version',?)",
                                    (str(SCHEMA_VERSION),))
            self.connection.commit()
        elif version["value"] != str(SCHEMA_VERSION):
            raise RuntimeError("unsupported_intraday_capture_schema")

    def append_run(self, *, scheduled_at: str, completed_at: str,
                   records: Iterable[Mapping[str, object]]) -> dict[str, object]:
        values = [dict(record) for record in records]
        symbols = [record.get("symbol") for record in values]
        if (not values or any(not isinstance(symbol, str) or not symbol for symbol in symbols)
                or len(symbols) != len(set(symbols))
                or any(record.get("status") not in ALLOWED_STATUSES for record in values)
                or any(not isinstance(record.get("envelope"), Mapping) for record in values)):
            raise ValueError("intraday_capture_records_invalid")
        run_payload = {"scheduledAt": scheduled_at, "symbols": sorted(symbols)}
        run_id = hashlib.sha256(canonical(run_payload).encode()).hexdigest()
        counts = {status: sum(record["status"] == status for record in values)
                  for status in sorted(ALLOWED_STATUSES)}
        summary = {"recordCount": len(values), "statusCounts": counts,
                   "classification": "research_only", "orderSubmissionAllowed": False}
        with self.connection:
            existing = self.connection.execute(
                "SELECT summary_json FROM capture_runs WHERE run_id=?", (run_id,)
            ).fetchone()
            if existing is None:
                self.connection.execute(
                    "INSERT INTO capture_runs VALUES(?,?,?,?,?)",
                    (run_id, scheduled_at, completed_at, canonical(sorted(symbols)), canonical(summary)),
                )
                for record in values:
                    record_id = hashlib.sha256(canonical({
                        "runId": run_id, "symbol": record["symbol"],
                        "status": record["status"], "envelope": record["envelope"],
                    }).encode()).hexdigest()
                    self.connection.execute(
                        "INSERT INTO capture_records VALUES(?,?,?,?,?)",
                        (record_id, run_id, record["symbol"], record["status"],
                         canonical(record["envelope"])),
                    )
                created = True
            else:
                stored = self.get_run(run_id)
                expected_records = sorted(
                    ({"symbol": record["symbol"], "status": record["status"],
                      "envelope": record["envelope"]} for record in values),
                    key=lambda item: item["symbol"],
                )
                stored_records = [{"symbol": record["symbol"], "status": record["status"],
                                   "envelope": record["envelope"]} for record in stored["records"]]
                if (canonical(stored["summary"]) != canonical(summary)
                        or canonical(stored_records) != canonical(expected_records)):
                    raise ValueError("intraday_capture_run_conflict")
                created = False
        return {"created": created, **self.get_run(run_id)}

    def get_run(self, run_id: str) -> dict[str, object]:
        run = self.connection.execute("SELECT * FROM capture_runs WHERE run_id=?", (run_id,)).fetchone()
        if run is None:
            raise KeyError("intraday_capture_run_not_found")
        records = self.connection.execute(
            "SELECT * FROM capture_records WHERE run_id=? ORDER BY symbol", (run_id,)
        ).fetchall()
        return {
            "runId": run["run_id"], "scheduledAt": run["scheduled_at"],
            "completedAt": run["completed_at"], "symbols": json.loads(run["symbols_json"]),
            "summary": json.loads(run["summary_json"]),
            "records": [{"recordId": row["record_id"], "symbol": row["symbol"],
                         "status": row["status"], "envelope": json.loads(row["envelope_json"])}
                        for row in records],
        }

    def latest(self) -> dict[str, object] | None:
        row = self.connection.execute(
            "SELECT run_id FROM capture_runs ORDER BY scheduled_at DESC,run_id DESC LIMIT 1"
        ).fetchone()
        return self.get_run(row["run_id"]) if row else None

    def runs(self, *, through: str | None = None) -> list[dict[str, object]]:
        if through:
            rows = self.connection.execute(
                "SELECT run_id FROM capture_runs WHERE scheduled_at<=? ORDER BY scheduled_at,run_id",
                (through,),
            ).fetchall()
        else:
            rows = self.connection.execute(
                "SELECT run_id FROM capture_runs ORDER BY scheduled_at,run_id"
            ).fetchall()
        return [self.get_run(row["run_id"]) for row in rows]

    def close(self) -> None:
        self.connection.close()
