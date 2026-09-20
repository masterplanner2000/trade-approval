"""Pure, fail-closed assembly of macro records into journal-ready evidence."""

from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
from typing import Mapping
from urllib.parse import urlparse

from macro_event_bias import EVENT_TYPES
from macro_exposure_map import MacroExposureRegistry


JOINER_VERSION = "macro-event-joiner-v1"
MAX_RELEASE_SCHEDULE_DELTA_SECONDS = 24 * 60 * 60


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


def _revision(*values: object) -> int:
    payload = json.dumps(values, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return int(hashlib.sha256(payload.encode("utf-8")).hexdigest()[:8], 16) + 1


def _validate_link(link: Mapping[str, object], *, joined_at: datetime) -> None:
    if link.get("status") != "REVIEWED":
        raise ValueError("macro_event_link_not_reviewed")
    required = ("linkVersion", "reviewedBy", "officialEventKey", "consensusEventKey",
                "eventType", "theme", "rationale")
    if any(not isinstance(link.get(key), str) or not str(link[key]).strip() for key in required):
        raise ValueError("macro_event_link_incomplete")
    reviewed_at = _instant(link.get("reviewedAt"))
    if reviewed_at is None or reviewed_at > joined_at:
        raise ValueError("macro_event_link_review_time_invalid")
    if link["eventType"] not in EVENT_TYPES:
        raise ValueError("macro_event_link_type_invalid")
    if len(str(link["rationale"]).strip()) < 20:
        raise ValueError("macro_event_link_rationale_invalid")
    evidence = link.get("evidence")
    if not isinstance(evidence, list) or not evidence:
        raise ValueError("macro_event_link_evidence_required")
    for item in evidence:
        published_at = _instant(item.get("publishedAt")) if isinstance(item, Mapping) else None
        retrieved_at = _instant(item.get("retrievedAt")) if isinstance(item, Mapping) else None
        if (not isinstance(item, Mapping) or not _https(item.get("url"))
                or not isinstance(item.get("publisher"), str) or not item["publisher"].strip()
                or published_at is None or retrieved_at is None
                or published_at > retrieved_at or retrieved_at > reviewed_at):
            raise ValueError("macro_event_link_evidence_invalid")


def assemble_macro_evidence(
    official: Mapping[str, object], consensus: Mapping[str, object],
    link: Mapping[str, object], reaction: Mapping[str, object], *,
    symbol: str, map_version: str, joined_at: str,
    exposures: MacroExposureRegistry,
) -> dict[str, object]:
    """Join explicit reviewed records; never infer event or company relationships."""
    joined = _instant(joined_at)
    if joined is None:
        raise ValueError("macro_join_time_invalid")
    _validate_link(link, joined_at=joined)
    if official.get("eventKey") != link["officialEventKey"]:
        raise ValueError("macro_official_event_identity_mismatch")
    if consensus.get("eventKey") != link["consensusEventKey"]:
        raise ValueError("macro_consensus_event_identity_mismatch")
    if official.get("eventType") != link["eventType"]:
        raise ValueError("macro_event_type_mismatch")
    if official.get("primarySourceVerified") is not True or official.get("status") != "IDENTIFIED_NOT_SCORED":
        raise ValueError("macro_official_event_unverified")
    published = _instant(official.get("publishedAt"))
    official_retrieved = _instant(official.get("retrievedAt"))
    scheduled = _instant(consensus.get("scheduledAt"))
    updated = _instant(consensus.get("updatedAt"))
    consensus_retrieved = _instant(consensus.get("retrievedAt"))
    if (published is None or official_retrieved is None or scheduled is None or updated is None
            or consensus_retrieved is None or published > official_retrieved
            or updated > consensus_retrieved or official_retrieved > joined
            or consensus_retrieved > joined):
        raise ValueError("macro_event_timing_invalid")
    if abs((published - scheduled).total_seconds()) > MAX_RELEASE_SCHEDULE_DELTA_SECONDS:
        raise ValueError("macro_release_schedule_mismatch")
    surprise = _number(consensus.get("standardizedSurprise"))
    sample_count = consensus.get("standardizationSampleCount")
    if (consensus.get("status") != "RELEASED_WITH_CONSENSUS" or surprise is None
            or not -5 <= surprise <= 5 or surprise == 0
            or isinstance(sample_count, bool) or not isinstance(sample_count, int) or sample_count < 12):
        raise ValueError("macro_consensus_not_scored")
    if not _https(official.get("url")) or not _https(consensus.get("sourceUrl")):
        raise ValueError("macro_join_source_invalid")

    exposure = exposures.resolve(str(link["theme"]), symbol, at=joined_at, map_version=map_version)
    if exposure is None:
        raise ValueError("macro_exposure_not_active")
    quote_at = _instant(reaction.get("quoteObservedAt"))
    if quote_at is None or quote_at < published or quote_at > joined:
        raise ValueError("macro_reaction_timing_invalid")

    return {
        "joinerVersion": JOINER_VERSION,
        "symbol": symbol.upper(),
        "event": {
            "eventKey": str(official["eventKey"]),
            "revision": _revision(official.get("contentFingerprint"), consensus.get("contentFingerprint")),
            "type": str(link["eventType"]),
            "publishedAt": str(official["publishedAt"]),
            "primarySourceVerified": True,
            "independentSourceCount": 1,
            "surpriseMagnitude": surprise,
            "confidence": 1.0,
            "sources": [
                {"publisher": official.get("provider"), "url": official["url"],
                 "publishedAt": official["publishedAt"], "retrievedAt": official["retrievedAt"]},
                {"publisher": consensus.get("source"), "url": consensus["sourceUrl"],
                 "publishedAt": consensus["updatedAt"], "retrievedAt": consensus["retrievedAt"]},
            ],
            "consensus": {
                "provider": consensus.get("provider"), "providerEventId": consensus.get("providerEventId"),
                "seriesKey": consensus.get("seriesKey"), "actualValue": consensus.get("actualValue"),
                "consensusValue": consensus.get("consensusValue"), "unit": consensus.get("unit"),
                "rawSurprise": consensus.get("rawSurprise"),
                "standardizedSurprise": surprise, "sampleCount": sample_count,
            },
            "eventLink": {"version": link["linkVersion"], "theme": link["theme"],
                          "rationale": link["rationale"]},
        },
        "exposure": exposure,
        "reaction": dict(reaction),
    }
