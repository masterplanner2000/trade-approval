"""Validation for a frozen, reviewed macro research universe."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Mapping
from urllib.parse import urlparse

from macro_exposure_map import validate_exposure_map


UNIVERSE_SCHEMA_VERSION = "macro-research-universe-v1"
VERSION = re.compile(r"^[a-z0-9][a-z0-9._-]{5,79}$")
SERIES = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$")
STUDY_STATUSES = {"BLOCKED_CONSENSUS_PROVIDER", "REVIEWED_ACTIVE"}


def _instant(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return result.astimezone(timezone.utc) if result.tzinfo else None


def _https(value: object) -> bool:
    if not isinstance(value, str):
        return False
    parsed = urlparse(value)
    return parsed.scheme == "https" and bool(parsed.hostname)


def validate_universe(document: Mapping[str, object]) -> dict[str, object]:
    if document.get("schemaVersion") != UNIVERSE_SCHEMA_VERSION:
        raise ValueError("macro_universe_schema_invalid")
    version = document.get("universeVersion")
    if not isinstance(version, str) or not VERSION.fullmatch(version):
        raise ValueError("macro_universe_version_invalid")
    curated_at = _instant(document.get("curatedAt"))
    curated_by = document.get("curatedBy")
    review = document.get("independentReview")
    if curated_at is None or not isinstance(curated_by, str) or not curated_by.strip():
        raise ValueError("macro_universe_curation_invalid")
    if not isinstance(review, Mapping) or review.get("status") != "APPROVED_WITH_BLOCKERS":
        raise ValueError("macro_universe_review_required")
    reviewed_at = _instant(review.get("reviewedAt"))
    if (reviewed_at is None or reviewed_at <= curated_at
            or not isinstance(review.get("reviewedBy"), str) or not review["reviewedBy"].strip()
            or review.get("reviewedBy") == curated_by
            or not isinstance(review.get("findings"), list) or not review["findings"]):
        raise ValueError("macro_universe_independent_review_invalid")

    exposure_map = document.get("exposureMap")
    if not isinstance(exposure_map, Mapping):
        raise ValueError("macro_universe_exposure_map_required")
    entries = validate_exposure_map(exposure_map)
    exposure_pairs = {(entry["theme"], entry["symbol"]) for entry in entries}

    liquidity = document.get("liquidityEvidence")
    if not isinstance(liquidity, list) or not liquidity:
        raise ValueError("macro_universe_liquidity_required")
    liquid_symbols = set()
    for item in liquidity:
        observed = _instant(item.get("observedAt")) if isinstance(item, Mapping) else None
        average = item.get("averageDollarVolume20Day") if isinstance(item, Mapping) else None
        if (not isinstance(item, Mapping) or item.get("volumeScope") not in {"single_venue", "consolidated"}
                or observed is None or observed > curated_at or isinstance(average, bool)
                or not isinstance(average, (int, float)) or average < 10_000_000
                or not isinstance(item.get("symbol"), str)):
            raise ValueError("macro_universe_liquidity_invalid")
        liquid_symbols.add(item["symbol"].upper())

    studies = document.get("studies")
    if not isinstance(studies, list) or not studies:
        raise ValueError("macro_universe_studies_required")
    active: list[dict[str, object]] = []
    identifiers = set()
    for study in studies:
        if not isinstance(study, Mapping):
            raise ValueError("macro_universe_study_invalid")
        identifier, status = study.get("studyId"), study.get("status")
        if not isinstance(identifier, str) or not VERSION.fullmatch(identifier) or identifier in identifiers:
            raise ValueError("macro_universe_study_id_invalid")
        identifiers.add(identifier)
        if status not in STUDY_STATUSES:
            raise ValueError("macro_universe_study_status_invalid")
        official, consensus = study.get("officialSeries"), study.get("consensusSeries")
        if (not isinstance(official, Mapping) or not SERIES.fullmatch(str(official.get("seriesId") or ""))
                or not _https(official.get("sourceUrl")) or not _https(official.get("scheduleUrl"))):
            raise ValueError("macro_universe_official_series_invalid")
        if not isinstance(consensus, Mapping) or not isinstance(consensus.get("provider"), str):
            raise ValueError("macro_universe_consensus_series_invalid")
        consensus_id = consensus.get("seriesId")
        if status == "REVIEWED_ACTIVE":
            if (consensus.get("accessStatus") != "APPROVED" or not isinstance(consensus_id, str)
                    or not SERIES.fullmatch(consensus_id) or study.get("crosswalkStatus") != "REVIEWED"):
                raise ValueError("macro_universe_active_consensus_invalid")
            active.append(dict(study))
        elif consensus_id is not None or consensus.get("accessStatus") != "PENDING_APPROVAL":
            raise ValueError("macro_universe_blocked_consensus_invalid")
        symbols, theme = study.get("symbols"), study.get("theme")
        if not isinstance(symbols, list) or not symbols or not isinstance(theme, str):
            raise ValueError("macro_universe_study_scope_invalid")
        for symbol in symbols:
            normalized = str(symbol).upper()
            if normalized not in liquid_symbols or (theme, normalized) not in exposure_pairs:
                raise ValueError("macro_universe_symbol_not_reviewed")
        if (not isinstance(study.get("limitations"), list) or not study["limitations"]
                or not isinstance(study.get("rationale"), str) or len(study["rationale"].strip()) < 30):
            raise ValueError("macro_universe_study_documentation_invalid")
    return {
        "schemaVersion": UNIVERSE_SCHEMA_VERSION,
        "universeVersion": version,
        "studyCount": len(studies),
        "activeStudyCount": len(active),
        "blockedStudyCount": len(studies) - len(active),
        "activeStudies": active,
        "mapVersion": exposure_map["mapVersion"],
    }


def load_universe(path: str | Path) -> tuple[dict[str, object], dict[str, object]]:
    try:
        document = json.loads(Path(path).read_text())
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("macro_universe_file_invalid") from error
    if not isinstance(document, Mapping):
        raise ValueError("macro_universe_file_invalid")
    return dict(document), validate_universe(document)
