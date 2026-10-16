"""Point-in-time cumulative minute-volume profiles for intraday research.

Profiles use completed regular sessions strictly before the requested as-of
instant.  They are deterministic research evidence and have no recommendation
or broker authority.
"""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from datetime import date, datetime, time, timezone
from math import isfinite
from statistics import median
from typing import Iterable, Mapping
from zoneinfo import ZoneInfo


NEW_YORK = ZoneInfo("America/New_York")
PROFILE_VERSION = "cumulative-minute-volume-v1"
REGULAR_SESSION_MINUTES = 390
MINIMUM_PROFILE_SESSIONS = 20
MAXIMUM_PROFILE_SESSIONS = 30
MINIMUM_OBSERVED_MINUTES = 380


def _instant(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else None


def _volume(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    result = float(value)
    return result if isfinite(result) and result >= 0 else None


def _minute_index(instant: datetime) -> int | None:
    local = instant.astimezone(NEW_YORK)
    if local.weekday() >= 5 or not time(9, 30) <= local.time().replace(tzinfo=None) < time(16):
        return None
    return (local.hour * 60 + local.minute) - (9 * 60 + 30)


def build_cumulative_volume_profile(
    symbol: str,
    bars: Iterable[Mapping[str, object]],
    *,
    as_of: str,
    data_source: str,
) -> dict[str, object]:
    """Build the median cumulative-volume curve from recent complete sessions."""
    normalized_symbol = symbol.strip().upper()
    cutoff = _instant(as_of)
    if not normalized_symbol or normalized_symbol != symbol or cutoff is None:
        raise ValueError("intraday_profile_identity_invalid")
    if not data_source.strip():
        raise ValueError("intraday_profile_source_required")

    cutoff_day = cutoff.astimezone(NEW_YORK).date()
    sessions: dict[date, dict[int, float]] = defaultdict(dict)
    canonical_bars: list[tuple[str, int, float]] = []
    for bar in bars:
        observed = _instant(bar.get("t"))
        volume = _volume(bar.get("v"))
        if observed is None or volume is None:
            raise ValueError("intraday_profile_bar_invalid")
        local = observed.astimezone(NEW_YORK)
        minute = _minute_index(observed)
        if local.date() >= cutoff_day or observed >= cutoff or minute is None:
            continue
        if minute in sessions[local.date()]:
            raise ValueError("intraday_profile_duplicate_minute")
        sessions[local.date()][minute] = volume
        canonical_bars.append((observed.isoformat(), minute, volume))

    complete: list[tuple[date, list[float]]] = []
    for session_day, minute_volumes in sessions.items():
        if (len(minute_volumes) < MINIMUM_OBSERVED_MINUTES
                or 0 not in minute_volumes or REGULAR_SESSION_MINUTES - 1 not in minute_volumes):
            continue
        cumulative, running = [], 0.0
        for minute in range(REGULAR_SESSION_MINUTES):
            running += minute_volumes.get(minute, 0.0)
            cumulative.append(running)
        if running > 0:
            complete.append((session_day, cumulative))

    complete.sort(key=lambda item: item[0])
    selected = complete[-MAXIMUM_PROFILE_SESSIONS:]
    if len(selected) < MINIMUM_PROFILE_SESSIONS:
        raise ValueError("intraday_volume_profile_incomplete")

    expected = [round(float(median(curve[minute] for _, curve in selected)), 6)
                for minute in range(REGULAR_SESSION_MINUTES)]
    if any(value <= 0 for value in expected):
        raise ValueError("intraday_volume_profile_invalid")
    included_days = [session_day.isoformat() for session_day, _ in selected]
    included = set(included_days)
    digest_payload = sorted(item for item in canonical_bars
                            if datetime.fromisoformat(item[0]).astimezone(NEW_YORK).date().isoformat() in included)
    digest = hashlib.sha256(json.dumps(digest_payload, separators=(",", ":")).encode()).hexdigest()
    return {
        "profileVersion": PROFILE_VERSION,
        "symbol": normalized_symbol,
        "asOf": cutoff.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "dataSource": data_source.strip(),
        "sessionCount": len(selected),
        "sessionDates": included_days,
        "minimumObservedMinutes": MINIMUM_OBSERVED_MINUTES,
        "estimator": "median_cumulative_volume",
        "minuteCount": REGULAR_SESSION_MINUTES,
        "expectedCumulativeVolumeByMinute": expected,
        "inputDigest": digest,
        "classification": "research_only",
        "recommendationAllowed": False,
        "orderSubmissionAllowed": False,
    }


def volume_context_at(
    profile: Mapping[str, object], *, observed_at: str, halted: bool,
    halt_data_source: str,
) -> dict[str, object]:
    """Resolve one profile checkpoint into the provider contract's context."""
    observed = _instant(observed_at)
    minute = _minute_index(observed) if observed is not None else None
    values = profile.get("expectedCumulativeVolumeByMinute")
    sessions = profile.get("sessionCount")
    if (observed is None or minute is None or not isinstance(values, list)
            or len(values) != REGULAR_SESSION_MINUTES or not isinstance(sessions, int)
            or sessions < MINIMUM_PROFILE_SESSIONS):
        raise ValueError("intraday_volume_profile_context_invalid")
    expected = _volume(values[minute])
    if expected is None or expected <= 0 or not isinstance(halted, bool):
        raise ValueError("intraday_volume_profile_context_invalid")
    if not halt_data_source.strip():
        raise ValueError("intraday_halt_source_required")
    return {
        "symbol": profile.get("symbol"),
        "observedAt": observed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "expectedCumulativeVolume": expected,
        "profileSessionCount": sessions,
        "profileVersion": profile.get("profileVersion"),
        "profileInputDigest": profile.get("inputDigest"),
        "halted": halted,
        "dataSource": f"{profile.get('dataSource')} + {halt_data_source.strip()}",
    }
