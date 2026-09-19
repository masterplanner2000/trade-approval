"""Append-only persistence and deterministic replay for intraday shadow research."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Iterable, Mapping

from intraday_shadow_evaluator import RULESET_VERSION, evaluate_intraday_snapshot


SCHEMA_VERSION = 1


def canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def observation_id(snapshot: Mapping[str, object], evaluated_at: str) -> str:
    payload = canonical({"snapshot": snapshot, "evaluatedAt": evaluated_at, "rulesetVersion": RULESET_VERSION})
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class IntradayShadowJournal:
    """Immutable evidence store. It has no market-data or broker adapter."""

    def __init__(self, path: str | Path):
        if not path:
            raise ValueError("journal_path_required")
        path = str(path)
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA synchronous=FULL")
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS journal_meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            ) STRICT;
            CREATE TABLE IF NOT EXISTS intraday_observations (
              observation_id TEXT PRIMARY KEY,
              symbol TEXT NOT NULL,
              observed_at TEXT NOT NULL,
              evaluated_at TEXT NOT NULL,
              ruleset_version TEXT NOT NULL,
              data_source TEXT NOT NULL,
              volume_scope TEXT NOT NULL,
              snapshot_json TEXT NOT NULL,
              evaluation_json TEXT NOT NULL
            ) STRICT;
            CREATE INDEX IF NOT EXISTS intraday_observations_timeline
              ON intraday_observations(observed_at, symbol, observation_id);
            CREATE TRIGGER IF NOT EXISTS intraday_observations_no_update
              BEFORE UPDATE ON intraday_observations BEGIN
                SELECT RAISE(ABORT, 'intraday_observations_are_immutable');
              END;
            CREATE TRIGGER IF NOT EXISTS intraday_observations_no_delete
              BEFORE DELETE ON intraday_observations BEGIN
                SELECT RAISE(ABORT, 'intraday_observations_are_immutable');
              END;
            """
        )
        version = self.connection.execute(
            "SELECT value FROM journal_meta WHERE key='schema_version'"
        ).fetchone()
        if version is None:
            self.connection.execute(
                "INSERT INTO journal_meta(key,value) VALUES('schema_version',?)", (str(SCHEMA_VERSION),)
            )
            self.connection.commit()
        elif version["value"] != str(SCHEMA_VERSION):
            raise RuntimeError("unsupported_intraday_journal_schema")

    def append(self, snapshot: Mapping[str, object], *, evaluated_at: str) -> dict[str, object]:
        source = snapshot.get("dataSource")
        volume_scope = snapshot.get("volumeScope")
        if not isinstance(source, str) or not source.strip():
            raise ValueError("intraday_data_source_required")
        if volume_scope not in {"consolidated", "single_venue", "unknown"}:
            raise ValueError("intraday_volume_scope_invalid")
        evaluation = evaluate_intraday_snapshot(snapshot, now=evaluated_at)
        identifier = observation_id(snapshot, evaluated_at)
        values = (
            identifier, evaluation["symbol"], str(snapshot.get("observedAt") or ""), evaluated_at,
            RULESET_VERSION, source, volume_scope, canonical(dict(snapshot)), canonical(evaluation),
        )
        with self.connection:
            cursor = self.connection.execute(
                """INSERT OR IGNORE INTO intraday_observations
                   (observation_id,symbol,observed_at,evaluated_at,ruleset_version,data_source,
                    volume_scope,snapshot_json,evaluation_json) VALUES(?,?,?,?,?,?,?,?,?)""",
                values,
            )
        return {"created": cursor.rowcount == 1, **self.get(identifier)}

    def get(self, identifier: str) -> dict[str, object]:
        row = self.connection.execute(
            "SELECT * FROM intraday_observations WHERE observation_id=?", (identifier,)
        ).fetchone()
        if row is None:
            raise KeyError("intraday_observation_not_found")
        return self._decode(row)

    def replay(self, *, symbol: str | None = None, through: str | None = None) -> list[dict[str, object]]:
        clauses: list[str] = []
        parameters: list[str] = []
        if symbol:
            clauses.append("symbol=?")
            parameters.append(symbol.upper())
        if through:
            clauses.append("observed_at<=?")
            parameters.append(through)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = self.connection.execute(
            f"""SELECT * FROM intraday_observations {where}
                ORDER BY observed_at,symbol,observation_id""", parameters
        ).fetchall()
        replayed = []
        for row in rows:
            item = self._decode(row)
            if item["rulesetVersion"] != RULESET_VERSION:
                replayed.append({**item, "replayedEvaluation": None,
                                 "deterministic": None, "replaySupported": False})
                continue
            current = evaluate_intraday_snapshot(item["snapshot"], now=item["evaluatedAt"])
            replayed.append({**item, "replayedEvaluation": current,
                             "deterministic": canonical(current) == canonical(item["evaluation"]),
                             "replaySupported": True})
        return replayed

    @staticmethod
    def _decode(row: sqlite3.Row) -> dict[str, object]:
        return {
            "observationId": row["observation_id"], "symbol": row["symbol"],
            "observedAt": row["observed_at"], "evaluatedAt": row["evaluated_at"],
            "rulesetVersion": row["ruleset_version"], "dataSource": row["data_source"],
            "volumeScope": row["volume_scope"], "snapshot": json.loads(row["snapshot_json"]),
            "evaluation": json.loads(row["evaluation_json"]),
        }

    def close(self) -> None:
        self.connection.close()


def all_deterministic(items: Iterable[dict[str, object]]) -> bool:
    return all(item.get("deterministic") is True for item in items)
