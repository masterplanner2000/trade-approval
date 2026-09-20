"""Versioned, append-only theme-to-symbol exposure registry."""

from __future__ import annotations

import hashlib
import json
import math
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Mapping
from urllib.parse import urlparse


SCHEMA_VERSION = 1
REGISTRY_VERSION = "macro-exposure-registry-v1"
THEME_PATTERN = re.compile(r"^[a-z][a-z0-9_]{2,63}$")
SYMBOL_PATTERN = re.compile(r"^[A-Z][A-Z0-9.\-]{0,14}$")
EVIDENCE_KINDS = {
    "regulatory_filing", "company_report", "official_data",
    "index_methodology", "regulator_publication",
}


def canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _hash(value: object) -> str:
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


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


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    result = float(value)
    return result if math.isfinite(result) else None


def _https(value: object) -> bool:
    if not isinstance(value, str):
        return False
    parsed = urlparse(value)
    return parsed.scheme == "https" and bool(parsed.netloc)


def validate_exposure_map(document: Mapping[str, object]) -> list[dict[str, object]]:
    version = document.get("mapVersion")
    reviewed_at = _instant(document.get("reviewedAt"))
    if not isinstance(version, str) or not version.strip():
        raise ValueError("exposure_map_version_required")
    if document.get("status") != "REVIEWED":
        raise ValueError("exposure_map_not_reviewed")
    if reviewed_at is None:
        raise ValueError("exposure_map_reviewed_at_invalid")
    if not isinstance(document.get("reviewedBy"), str) or not document["reviewedBy"].strip():
        raise ValueError("exposure_map_reviewer_required")
    entries = document.get("entries")
    if not isinstance(entries, list) or not entries:
        raise ValueError("exposure_map_entries_required")

    normalized: list[dict[str, object]] = []
    pairs: set[tuple[str, str]] = set()
    for raw in entries:
        if not isinstance(raw, Mapping):
            raise ValueError("exposure_entry_invalid")
        theme = str(raw.get("theme") or "")
        symbol = str(raw.get("symbol") or "").upper()
        if not THEME_PATTERN.fullmatch(theme):
            raise ValueError("exposure_theme_invalid")
        if not SYMBOL_PATTERN.fullmatch(symbol):
            raise ValueError("exposure_symbol_invalid")
        if (theme, symbol) in pairs:
            raise ValueError("exposure_entry_duplicate")
        pairs.add((theme, symbol))
        direction, strength = _number(raw.get("direction")), _number(raw.get("strength"))
        if direction is None or not -1 <= direction <= 1 or direction == 0:
            raise ValueError("exposure_direction_invalid")
        if strength is None or not 0.5 <= strength <= 1:
            raise ValueError("exposure_strength_invalid")
        effective_from = _instant(raw.get("effectiveFrom"))
        effective_to = _instant(raw.get("effectiveTo")) if raw.get("effectiveTo") is not None else None
        if effective_from is None or effective_from > reviewed_at:
            raise ValueError("exposure_effective_from_invalid")
        if effective_to is not None and effective_to <= effective_from:
            raise ValueError("exposure_effective_to_invalid")
        rationale = raw.get("rationale")
        if not isinstance(rationale, str) or len(rationale.strip()) < 20:
            raise ValueError("exposure_rationale_invalid")
        evidence = raw.get("evidence")
        if not isinstance(evidence, list) or not evidence:
            raise ValueError("exposure_evidence_required")
        normalized_evidence = []
        for source in evidence:
            if not isinstance(source, Mapping) or source.get("kind") not in EVIDENCE_KINDS:
                raise ValueError("exposure_evidence_kind_invalid")
            published_at = _instant(source.get("publishedAt"))
            retrieved_at = _instant(source.get("retrievedAt"))
            if (not _https(source.get("url")) or not isinstance(source.get("publisher"), str)
                    or not source["publisher"].strip()):
                raise ValueError("exposure_evidence_source_invalid")
            if published_at is None or retrieved_at is None or published_at > retrieved_at or retrieved_at > reviewed_at:
                raise ValueError("exposure_evidence_timestamp_invalid")
            normalized_evidence.append(dict(source))
        normalized.append({
            "theme": theme, "symbol": symbol, "direction": direction,
            "strength": strength, "effectiveFrom": _iso(effective_from),
            "effectiveTo": _iso(effective_to) if effective_to is not None else None,
            "rationale": rationale.strip(),
            "evidence": normalized_evidence,
        })
    return normalized


class MacroExposureRegistry:
    """Immutable exposure-map history. It does not infer mappings."""

    def __init__(self, path: str | Path):
        if not path:
            raise ValueError("exposure_registry_path_required")
        path = str(path)
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys=ON")
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA synchronous=FULL")
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS exposure_registry_meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            ) STRICT;
            CREATE TABLE IF NOT EXISTS exposure_map_versions (
              map_version TEXT PRIMARY KEY,
              reviewed_at TEXT NOT NULL,
              reviewed_by TEXT NOT NULL,
              supersedes TEXT,
              content_hash TEXT NOT NULL,
              document_json TEXT NOT NULL
            ) STRICT;
            CREATE TABLE IF NOT EXISTS exposure_map_entries (
              map_version TEXT NOT NULL,
              theme TEXT NOT NULL,
              symbol TEXT NOT NULL,
              direction REAL NOT NULL,
              strength REAL NOT NULL,
              effective_from TEXT NOT NULL,
              effective_to TEXT,
              rationale TEXT NOT NULL,
              evidence_json TEXT NOT NULL,
              PRIMARY KEY(map_version,theme,symbol),
              FOREIGN KEY(map_version) REFERENCES exposure_map_versions(map_version)
            ) STRICT;
            CREATE INDEX IF NOT EXISTS exposure_lookup
              ON exposure_map_entries(theme,symbol,effective_from,effective_to);
            CREATE TRIGGER IF NOT EXISTS exposure_versions_no_update
              BEFORE UPDATE ON exposure_map_versions BEGIN
                SELECT RAISE(ABORT, 'exposure_map_history_is_immutable');
              END;
            CREATE TRIGGER IF NOT EXISTS exposure_versions_no_delete
              BEFORE DELETE ON exposure_map_versions BEGIN
                SELECT RAISE(ABORT, 'exposure_map_history_is_immutable');
              END;
            CREATE TRIGGER IF NOT EXISTS exposure_entries_no_update
              BEFORE UPDATE ON exposure_map_entries BEGIN
                SELECT RAISE(ABORT, 'exposure_map_history_is_immutable');
              END;
            CREATE TRIGGER IF NOT EXISTS exposure_entries_no_delete
              BEFORE DELETE ON exposure_map_entries BEGIN
                SELECT RAISE(ABORT, 'exposure_map_history_is_immutable');
              END;
            """
        )
        version = self.connection.execute(
            "SELECT value FROM exposure_registry_meta WHERE key='schema_version'"
        ).fetchone()
        if version is None:
            self.connection.execute(
                "INSERT INTO exposure_registry_meta(key,value) VALUES('schema_version',?)", (str(SCHEMA_VERSION),)
            )
            self.connection.commit()
        elif version["value"] != str(SCHEMA_VERSION):
            raise RuntimeError("unsupported_exposure_registry_schema")

    def append(self, document: Mapping[str, object]) -> dict[str, object]:
        entries = validate_exposure_map(document)
        version = str(document["mapVersion"])
        content_hash = _hash(document)
        existing = self.connection.execute(
            "SELECT content_hash FROM exposure_map_versions WHERE map_version=?", (version,)
        ).fetchone()
        if existing is not None:
            if existing["content_hash"] != content_hash:
                raise ValueError("exposure_map_version_conflict")
            return {"created": False, "mapVersion": version, "entryCount": len(entries), "contentHash": content_hash}
        supersedes = document.get("supersedes")
        if supersedes is not None:
            predecessor = self.connection.execute(
                "SELECT 1 FROM exposure_map_versions WHERE map_version=?", (supersedes,)
            ).fetchone()
            if predecessor is None:
                raise ValueError("exposure_map_supersedes_unknown")
        with self.connection:
            self.connection.execute(
                """INSERT INTO exposure_map_versions
                   (map_version,reviewed_at,reviewed_by,supersedes,content_hash,document_json)
                   VALUES(?,?,?,?,?,?)""",
                (version, document["reviewedAt"], document["reviewedBy"], supersedes,
                 content_hash, canonical(dict(document))),
            )
            self.connection.executemany(
                """INSERT INTO exposure_map_entries
                   (map_version,theme,symbol,direction,strength,effective_from,effective_to,rationale,evidence_json)
                   VALUES(?,?,?,?,?,?,?,?,?)""",
                [(version, item["theme"], item["symbol"], item["direction"], item["strength"],
                  item["effectiveFrom"], item["effectiveTo"], item["rationale"], canonical(item["evidence"]))
                 for item in entries],
            )
        return {"created": True, "mapVersion": version, "entryCount": len(entries), "contentHash": content_hash}

    def resolve(self, theme: str, symbol: str, *, at: str, map_version: str) -> dict[str, object] | None:
        instant = _instant(at)
        if instant is None:
            raise ValueError("exposure_resolution_time_invalid")
        at_iso = _iso(instant)
        row = self.connection.execute(
            """SELECT * FROM exposure_map_entries
               WHERE map_version=? AND theme=? AND symbol=?
                 AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)""",
            (map_version, theme, symbol.upper(), at_iso, at_iso),
        ).fetchone()
        if row is None:
            return None
        return {
            "theme": row["theme"], "symbol": row["symbol"],
            "direction": row["direction"], "strength": row["strength"],
            "effectiveFrom": row["effective_from"], "effectiveTo": row["effective_to"],
            "rationale": row["rationale"], "evidence": json.loads(row["evidence_json"]),
            "mappingVersion": row["map_version"], "registryVersion": REGISTRY_VERSION,
        }

    def versions(self) -> list[dict[str, object]]:
        rows = self.connection.execute(
            "SELECT map_version,reviewed_at,reviewed_by,supersedes,content_hash FROM exposure_map_versions ORDER BY reviewed_at,map_version"
        ).fetchall()
        return [dict(row) for row in rows]

    def close(self) -> None:
        self.connection.close()
