"""Durable, provider-neutral schedule for forward macro research capture."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Mapping, Sequence


SCHEMA_VERSION = 1
SCHEDULER_VERSION = "macro-forward-capture-v1"
SYMBOL = re.compile(r"^[A-Z][A-Z0-9.\-]{0,14}$")
TASK_WINDOWS = (
    ("baseline", -300, 60),
    ("release", 0, 300),
    ("reaction_1m", 60, 60),
    ("reaction_5m", 300, 90),
    ("reaction_30m", 1800, 180),
)


def _instant(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(timezone.utc)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _hash(value: object) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


class MacroCaptureScheduler:
    """Persistent capture plan only; it performs no network or market-data calls."""

    def __init__(self, path: str | Path):
        if not path:
            raise ValueError("macro_capture_path_required")
        path = str(path)
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path, isolation_level=None)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA synchronous=FULL")
        self.connection.execute("PRAGMA foreign_keys=ON")
        self.connection.executescript("""
            CREATE TABLE IF NOT EXISTS macro_capture_meta (
              key TEXT PRIMARY KEY, value TEXT NOT NULL
            ) STRICT;
            CREATE TABLE IF NOT EXISTS macro_capture_plans (
              plan_id TEXT PRIMARY KEY, event_key TEXT NOT NULL, scheduled_at TEXT NOT NULL,
              created_at TEXT NOT NULL, plan_hash TEXT NOT NULL, plan_json TEXT NOT NULL
            ) STRICT;
            CREATE TABLE IF NOT EXISTS macro_capture_tasks (
              task_id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, kind TEXT NOT NULL,
              symbol TEXT, due_at TEXT NOT NULL, late_after TEXT NOT NULL,
              state TEXT NOT NULL CHECK(state IN ('PENDING','CLAIMED','COMPLETED','FAILED','MISSED')),
              claimed_by TEXT, claimed_at TEXT, completed_at TEXT, result_json TEXT,
              FOREIGN KEY(plan_id) REFERENCES macro_capture_plans(plan_id)
            ) STRICT;
            CREATE INDEX IF NOT EXISTS macro_capture_due
              ON macro_capture_tasks(state,due_at,task_id);
            CREATE TABLE IF NOT EXISTS macro_capture_audit (
              audit_id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL,
              occurred_at TEXT NOT NULL, transition TEXT NOT NULL, detail_json TEXT NOT NULL,
              FOREIGN KEY(task_id) REFERENCES macro_capture_tasks(task_id)
            ) STRICT;
            CREATE TABLE IF NOT EXISTS macro_capture_resolutions (
              task_id TEXT PRIMARY KEY, disposition TEXT NOT NULL,
              resolver TEXT NOT NULL, resolved_at TEXT NOT NULL,
              reason TEXT NOT NULL, evidence_json TEXT NOT NULL,
              FOREIGN KEY(task_id) REFERENCES macro_capture_tasks(task_id)
            ) STRICT;
            CREATE TRIGGER IF NOT EXISTS macro_capture_plans_no_update
              BEFORE UPDATE ON macro_capture_plans BEGIN
                SELECT RAISE(ABORT, 'macro_capture_plan_is_immutable');
              END;
            CREATE TRIGGER IF NOT EXISTS macro_capture_plans_no_delete
              BEFORE DELETE ON macro_capture_plans BEGIN
                SELECT RAISE(ABORT, 'macro_capture_plan_is_immutable');
              END;
            CREATE TRIGGER IF NOT EXISTS macro_capture_audit_no_update
              BEFORE UPDATE ON macro_capture_audit BEGIN
                SELECT RAISE(ABORT, 'macro_capture_audit_is_immutable');
              END;
            CREATE TRIGGER IF NOT EXISTS macro_capture_audit_no_delete
              BEFORE DELETE ON macro_capture_audit BEGIN
                SELECT RAISE(ABORT, 'macro_capture_audit_is_immutable');
              END;
            CREATE TRIGGER IF NOT EXISTS macro_capture_resolutions_no_update
              BEFORE UPDATE ON macro_capture_resolutions BEGIN
                SELECT RAISE(ABORT, 'macro_capture_resolution_is_immutable');
              END;
            CREATE TRIGGER IF NOT EXISTS macro_capture_resolutions_no_delete
              BEFORE DELETE ON macro_capture_resolutions BEGIN
                SELECT RAISE(ABORT, 'macro_capture_resolution_is_immutable');
              END;
        """)
        version = self.connection.execute(
            "SELECT value FROM macro_capture_meta WHERE key='schema_version'"
        ).fetchone()
        if version is None:
            self.connection.execute(
                "INSERT INTO macro_capture_meta(key,value) VALUES('schema_version',?)", (str(SCHEMA_VERSION),)
            )
        elif version["value"] != str(SCHEMA_VERSION):
            raise RuntimeError("unsupported_macro_capture_schema")

    def register(self, event: Mapping[str, object], symbols: Sequence[str], *,
                 created_at: str, link_version: str, map_version: str) -> dict[str, object]:
        created, scheduled = _instant(created_at), _instant(event.get("scheduledAt"))
        event_key = event.get("eventKey")
        if created is None or scheduled is None or created >= scheduled:
            raise ValueError("macro_capture_not_forward_planned")
        if not isinstance(event_key, str) or not event_key.strip():
            raise ValueError("macro_capture_event_key_required")
        if not link_version or not map_version:
            raise ValueError("macro_capture_versions_required")
        normalized_symbols = sorted(set(str(item).upper() for item in symbols))
        if not normalized_symbols or any(not SYMBOL.fullmatch(item) for item in normalized_symbols):
            raise ValueError("macro_capture_symbols_invalid")
        plan = {
            "schedulerVersion": SCHEDULER_VERSION, "eventKey": event_key,
            "scheduledAt": _iso(scheduled), "createdAt": _iso(created),
            "linkVersion": link_version, "mapVersion": map_version,
            "symbols": normalized_symbols,
        }
        plan_id = _hash({"eventKey": event_key, "scheduledAt": plan["scheduledAt"],
                         "linkVersion": link_version, "mapVersion": map_version})
        plan_hash = _hash(plan)
        existing = self.connection.execute(
            "SELECT plan_hash FROM macro_capture_plans WHERE plan_id=?", (plan_id,)
        ).fetchone()
        if existing is not None:
            if existing["plan_hash"] != plan_hash:
                raise ValueError("macro_capture_plan_conflict")
            return {"created": False, **self.get_plan(plan_id)}
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            self.connection.execute(
                "INSERT INTO macro_capture_plans VALUES(?,?,?,?,?,?)",
                (plan_id, event_key, plan["scheduledAt"], plan["createdAt"], plan_hash, _canonical(plan)),
            )
            tasks = []
            for kind, offset, tolerance in TASK_WINDOWS:
                targets = [None] if kind == "release" else normalized_symbols
                for symbol in targets:
                    due = scheduled + timedelta(seconds=offset)
                    task_id = _hash({"planId": plan_id, "kind": kind, "symbol": symbol})
                    tasks.append((task_id, plan_id, kind, symbol, _iso(due),
                                  _iso(due + timedelta(seconds=tolerance)), "PENDING"))
            self.connection.executemany(
                """INSERT INTO macro_capture_tasks
                   (task_id,plan_id,kind,symbol,due_at,late_after,state) VALUES(?,?,?,?,?,?,?)""", tasks)
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            raise
        return {"created": True, **self.get_plan(plan_id)}

    def claim_due(self, *, now: str, worker_id: str, limit: int = 20) -> list[dict[str, object]]:
        current = _instant(now)
        if current is None or not worker_id.strip() or not 1 <= limit <= 100:
            raise ValueError("macro_capture_claim_invalid")
        now_iso = _iso(current)
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            missed = self.connection.execute(
                "SELECT task_id FROM macro_capture_tasks WHERE state='PENDING' AND late_after<? ORDER BY due_at,task_id",
                (now_iso,),
            ).fetchall()
            for row in missed:
                self.connection.execute(
                    "UPDATE macro_capture_tasks SET state='MISSED',completed_at=? WHERE task_id=?",
                    (now_iso, row["task_id"]),
                )
                self._audit(row["task_id"], now_iso, "MISSED", {"reason": "capture_window_elapsed"})
            rows = self.connection.execute(
                """SELECT task_id FROM macro_capture_tasks
                   WHERE state='PENDING' AND due_at<=? AND late_after>=?
                   ORDER BY due_at,task_id LIMIT ?""", (now_iso, now_iso, limit)
            ).fetchall()
            for row in rows:
                self.connection.execute(
                    """UPDATE macro_capture_tasks SET state='CLAIMED',claimed_by=?,claimed_at=?
                       WHERE task_id=? AND state='PENDING'""", (worker_id, now_iso, row["task_id"])
                )
                self._audit(row["task_id"], now_iso, "CLAIMED", {"workerId": worker_id})
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            raise
        return [self.get_task(row["task_id"]) for row in rows]

    def finish(self, task_id: str, *, worker_id: str, completed_at: str,
               status: str, result: Mapping[str, object]) -> dict[str, object]:
        completed = _instant(completed_at)
        if completed is None or status not in {"COMPLETED", "FAILED"} or not isinstance(result, Mapping):
            raise ValueError("macro_capture_completion_invalid")
        task = self.get_task(task_id)
        if task["state"] != "CLAIMED" or task["claimedBy"] != worker_id:
            raise ValueError("macro_capture_claim_ownership_mismatch")
        if completed < _instant(task["claimedAt"]):
            raise ValueError("macro_capture_completion_time_invalid")
        if status == "COMPLETED":
            observed = _instant(result.get("observedAt"))
            if (observed is None or observed < _instant(task["dueAt"])
                    or observed > _instant(task["lateAfter"]) or completed < observed):
                raise ValueError("macro_capture_observation_outside_window")
            if not isinstance(result.get("dataSource"), str) or not result["dataSource"].strip():
                raise ValueError("macro_capture_data_source_required")
        completed_iso = _iso(completed)
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            self.connection.execute(
                """UPDATE macro_capture_tasks SET state=?,completed_at=?,result_json=?
                   WHERE task_id=? AND state='CLAIMED' AND claimed_by=?""",
                (status, completed_iso, _canonical(dict(result)), task_id, worker_id),
            )
            self._audit(task_id, completed_iso, status, dict(result))
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            raise
        return self.get_task(task_id)

    def resolve_claim(self, task_id: str, *, resolver: str, resolved_at: str,
                      disposition: str, reason: str,
                      evidence: Mapping[str, object] | None = None) -> dict[str, object]:
        resolved = _instant(resolved_at)
        allowed = {"FAILED_CONFIRMED", "COMPLETED_FROM_DURABLE_EVIDENCE", "ABANDONED_UNKNOWN"}
        if (resolved is None or disposition not in allowed or not resolver.strip()
                or not isinstance(reason, str) or len(reason.strip()) < 10):
            raise ValueError("macro_capture_resolution_invalid")
        task = self.get_task(task_id)
        if task["state"] != "CLAIMED" or task["resolution"] is not None:
            raise ValueError("macro_capture_resolution_not_allowed")
        if resolved < _instant(task["claimedAt"]):
            raise ValueError("macro_capture_resolution_time_invalid")
        proof = dict(evidence or {})
        if disposition == "COMPLETED_FROM_DURABLE_EVIDENCE":
            observed = _instant(proof.get("observedAt"))
            plan = self.get_plan(str(task["planId"]))["plan"]
            if (observed is None or observed < _instant(task["dueAt"])
                    or observed > _instant(task["lateAfter"])
                    or not isinstance(proof.get("dataSource"), str)
                    or not proof["dataSource"].strip()
                    or proof.get("linkVersion") != plan.get("linkVersion")
                    or proof.get("mapVersion") != plan.get("mapVersion")):
                raise ValueError("macro_capture_resolution_evidence_invalid")
            if task["kind"] == "release":
                official, consensus = proof.get("official"), proof.get("consensus")
                if (not isinstance(official, Mapping)
                        or official.get("eventKey") != plan.get("eventKey")
                        or official.get("primarySourceVerified") is not True
                        or not isinstance(consensus, Mapping) or not consensus.get("eventKey")):
                    raise ValueError("macro_capture_resolution_evidence_invalid")
            elif (proof.get("symbol") != task["symbol"]
                  or proof.get("volumeScope") not in {"consolidated", "single_venue", "unknown"}
                  or not isinstance(proof.get("quote"), Mapping)):
                raise ValueError("macro_capture_resolution_evidence_invalid")
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            self.connection.execute(
                """INSERT INTO macro_capture_resolutions
                   (task_id,disposition,resolver,resolved_at,reason,evidence_json)
                   VALUES(?,?,?,?,?,?)""",
                (task_id, disposition, resolver, _iso(resolved), reason.strip(), _canonical(proof)),
            )
            self._audit(task_id, _iso(resolved), f"RESOLVED_{disposition}",
                        {"resolver": resolver, "reason": reason.strip(), "evidence": proof})
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            raise
        return self.get_task(task_id)

    def get_plan(self, plan_id: str) -> dict[str, object]:
        row = self.connection.execute(
            "SELECT * FROM macro_capture_plans WHERE plan_id=?", (plan_id,)
        ).fetchone()
        if row is None:
            raise KeyError("macro_capture_plan_not_found")
        tasks = self.connection.execute(
            "SELECT task_id FROM macro_capture_tasks WHERE plan_id=? ORDER BY due_at,task_id", (plan_id,)
        ).fetchall()
        return {"planId": plan_id, "plan": json.loads(row["plan_json"]),
                "tasks": [self.get_task(item["task_id"]) for item in tasks]}

    def get_task(self, task_id: str) -> dict[str, object]:
        row = self.connection.execute(
            "SELECT * FROM macro_capture_tasks WHERE task_id=?", (task_id,)
        ).fetchone()
        if row is None:
            raise KeyError("macro_capture_task_not_found")
        resolution_row = self.connection.execute(
            "SELECT * FROM macro_capture_resolutions WHERE task_id=?", (task_id,)
        ).fetchone()
        resolution = ({"disposition": resolution_row["disposition"],
                       "resolver": resolution_row["resolver"],
                       "resolvedAt": resolution_row["resolved_at"],
                       "reason": resolution_row["reason"],
                       "evidence": json.loads(resolution_row["evidence_json"])}
                      if resolution_row else None)
        return {"taskId": row["task_id"], "planId": row["plan_id"], "kind": row["kind"],
                "symbol": row["symbol"], "dueAt": row["due_at"], "lateAfter": row["late_after"],
                "state": row["state"], "claimedBy": row["claimed_by"], "claimedAt": row["claimed_at"],
                "completedAt": row["completed_at"],
                "result": json.loads(row["result_json"]) if row["result_json"] else None,
                "resolution": resolution,
                "effectiveState": resolution["disposition"] if resolution else row["state"]}

    def audit(self, task_id: str) -> list[dict[str, object]]:
        rows = self.connection.execute(
            "SELECT occurred_at,transition,detail_json FROM macro_capture_audit WHERE task_id=? ORDER BY audit_id",
            (task_id,),
        ).fetchall()
        return [{"occurredAt": row["occurred_at"], "transition": row["transition"],
                 "detail": json.loads(row["detail_json"])} for row in rows]

    def _audit(self, task_id: str, occurred_at: str, transition: str, detail: Mapping[str, object]) -> None:
        self.connection.execute(
            "INSERT INTO macro_capture_audit(task_id,occurred_at,transition,detail_json) VALUES(?,?,?,?)",
            (task_id, occurred_at, transition, _canonical(dict(detail))),
        )

    def close(self) -> None:
        self.connection.close()
