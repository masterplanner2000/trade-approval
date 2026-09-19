"""Append-only evidence journal for macro/news event bias research."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Iterable, Mapping
from urllib.parse import urlparse

from macro_event_bias import RULESET_VERSION, evaluate_macro_event_bias


SCHEMA_VERSION = 1
VOLUME_SCOPES = {"consolidated", "single_venue", "unknown"}


def canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _timestamp(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return parsed.tzinfo is not None


def _https(value: object) -> bool:
    if not isinstance(value, str):
        return False
    parsed = urlparse(value)
    return parsed.scheme == "https" and bool(parsed.netloc)


def validate_provenance(evidence: Mapping[str, object]) -> None:
    event = evidence.get("event")
    exposure = evidence.get("exposure")
    reaction = evidence.get("reaction")
    if not isinstance(event, Mapping) or not isinstance(event.get("eventKey"), str) or not event["eventKey"].strip():
        raise ValueError("macro_event_key_required")
    revision = event.get("revision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
        raise ValueError("macro_event_revision_invalid")
    sources = event.get("sources")
    if not isinstance(sources, list) or not sources:
        raise ValueError("macro_event_sources_required")
    for source in sources:
        if not isinstance(source, Mapping) or not _https(source.get("url")):
            raise ValueError("macro_event_source_url_invalid")
        if not isinstance(source.get("publisher"), str) or not source["publisher"].strip():
            raise ValueError("macro_event_source_publisher_required")
        if not _timestamp(source.get("publishedAt")) or not _timestamp(source.get("retrievedAt")):
            raise ValueError("macro_event_source_timestamp_invalid")
    if not isinstance(exposure, Mapping) or not isinstance(exposure.get("mappingVersion"), str) \
            or not exposure["mappingVersion"].strip():
        raise ValueError("macro_exposure_mapping_version_required")
    if not isinstance(exposure.get("rationale"), str) or not exposure["rationale"].strip():
        raise ValueError("macro_exposure_rationale_required")
    if not isinstance(reaction, Mapping) or not isinstance(reaction.get("marketDataSource"), str) \
            or not reaction["marketDataSource"].strip():
        raise ValueError("macro_market_data_source_required")
    if reaction.get("volumeScope") not in VOLUME_SCOPES:
        raise ValueError("macro_volume_scope_invalid")


def observation_id(evidence: Mapping[str, object], evaluated_at: str) -> str:
    payload = canonical({"evidence": evidence, "evaluatedAt": evaluated_at, "rulesetVersion": RULESET_VERSION})
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class MacroEventJournal:
    """Immutable research evidence; it has no provider or order authority."""

    def __init__(self, path: str | Path):
        if not path:
            raise ValueError("macro_journal_path_required")
        path = str(path)
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA synchronous=FULL")
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS macro_journal_meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            ) STRICT;
            CREATE TABLE IF NOT EXISTS macro_event_observations (
              observation_id TEXT PRIMARY KEY,
              event_key TEXT NOT NULL,
              event_revision INTEGER NOT NULL,
              symbol TEXT NOT NULL,
              published_at TEXT NOT NULL,
              quote_observed_at TEXT NOT NULL,
              evaluated_at TEXT NOT NULL,
              ruleset_version TEXT NOT NULL,
              exposure_mapping_version TEXT NOT NULL,
              market_data_source TEXT NOT NULL,
              volume_scope TEXT NOT NULL,
              evidence_json TEXT NOT NULL,
              evaluation_json TEXT NOT NULL
            ) STRICT;
            CREATE INDEX IF NOT EXISTS macro_event_timeline
              ON macro_event_observations(published_at,event_key,event_revision,symbol,quote_observed_at);
            CREATE TRIGGER IF NOT EXISTS macro_event_observations_no_update
              BEFORE UPDATE ON macro_event_observations BEGIN
                SELECT RAISE(ABORT, 'macro_event_observations_are_immutable');
              END;
            CREATE TRIGGER IF NOT EXISTS macro_event_observations_no_delete
              BEFORE DELETE ON macro_event_observations BEGIN
                SELECT RAISE(ABORT, 'macro_event_observations_are_immutable');
              END;
            """
        )
        version = self.connection.execute(
            "SELECT value FROM macro_journal_meta WHERE key='schema_version'"
        ).fetchone()
        if version is None:
            self.connection.execute(
                "INSERT INTO macro_journal_meta(key,value) VALUES('schema_version',?)", (str(SCHEMA_VERSION),)
            )
            self.connection.commit()
        elif version["value"] != str(SCHEMA_VERSION):
            raise RuntimeError("unsupported_macro_journal_schema")

    def append(self, evidence: Mapping[str, object], *, evaluated_at: str) -> dict[str, object]:
        validate_provenance(evidence)
        if not _timestamp(evaluated_at):
            raise ValueError("macro_evaluated_at_invalid")
        event = evidence["event"]
        exposure = evidence["exposure"]
        reaction = evidence["reaction"]
        evaluation = evaluate_macro_event_bias(evidence, now=evaluated_at)
        identifier = observation_id(evidence, evaluated_at)
        values = (
            identifier, event["eventKey"], event["revision"], evaluation["symbol"],
            str(event.get("publishedAt") or ""), str(reaction.get("quoteObservedAt") or ""),
            evaluated_at, RULESET_VERSION, exposure["mappingVersion"], reaction["marketDataSource"],
            reaction["volumeScope"], canonical(dict(evidence)), canonical(evaluation),
        )
        with self.connection:
            cursor = self.connection.execute(
                """INSERT OR IGNORE INTO macro_event_observations
                   (observation_id,event_key,event_revision,symbol,published_at,quote_observed_at,
                    evaluated_at,ruleset_version,exposure_mapping_version,market_data_source,
                    volume_scope,evidence_json,evaluation_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                values,
            )
        return {"created": cursor.rowcount == 1, **self.get(identifier)}

    def get(self, identifier: str) -> dict[str, object]:
        row = self.connection.execute(
            "SELECT * FROM macro_event_observations WHERE observation_id=?", (identifier,)
        ).fetchone()
        if row is None:
            raise KeyError("macro_event_observation_not_found")
        return self._decode(row)

    def replay(self, *, symbol: str | None = None, event_key: str | None = None) -> list[dict[str, object]]:
        clauses: list[str] = []
        parameters: list[str] = []
        if symbol:
            clauses.append("symbol=?")
            parameters.append(symbol.upper())
        if event_key:
            clauses.append("event_key=?")
            parameters.append(event_key)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = self.connection.execute(
            f"""SELECT * FROM macro_event_observations {where}
                ORDER BY published_at,event_key,event_revision,symbol,quote_observed_at,observation_id""",
            parameters,
        ).fetchall()
        replayed = []
        for row in rows:
            item = self._decode(row)
            if item["rulesetVersion"] != RULESET_VERSION:
                replayed.append({**item, "replayedEvaluation": None,
                                 "deterministic": None, "replaySupported": False})
                continue
            current = evaluate_macro_event_bias(item["evidence"], now=item["evaluatedAt"])
            replayed.append({**item, "replayedEvaluation": current,
                             "deterministic": canonical(current) == canonical(item["evaluation"]),
                             "replaySupported": True})
        return replayed

    @staticmethod
    def _decode(row: sqlite3.Row) -> dict[str, object]:
        return {
            "observationId": row["observation_id"], "eventKey": row["event_key"],
            "eventRevision": row["event_revision"], "symbol": row["symbol"],
            "publishedAt": row["published_at"], "quoteObservedAt": row["quote_observed_at"],
            "evaluatedAt": row["evaluated_at"], "rulesetVersion": row["ruleset_version"],
            "exposureMappingVersion": row["exposure_mapping_version"],
            "marketDataSource": row["market_data_source"], "volumeScope": row["volume_scope"],
            "evidence": json.loads(row["evidence_json"]),
            "evaluation": json.loads(row["evaluation_json"]),
        }

    def close(self) -> None:
        self.connection.close()


def all_deterministic(items: Iterable[dict[str, object]]) -> bool:
    return all(item.get("deterministic") is True for item in items)
