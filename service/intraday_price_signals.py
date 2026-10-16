"""Point-in-time intraday price profiles and research-only movement signals."""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from datetime import date, datetime, time, timezone
from math import isfinite
from statistics import median
from typing import Iterable, Mapping
from zoneinfo import ZoneInfo

from intraday_volume_profile import (
    MAXIMUM_PROFILE_SESSIONS, MINIMUM_OBSERVED_MINUTES,
    MINIMUM_PROFILE_SESSIONS, REGULAR_SESSION_MINUTES,
)


NEW_YORK = ZoneInfo("America/New_York")
PRICE_PROFILE_VERSION = "cumulative-minute-range-v1"
SIGNAL_VERSION = "intraday-price-movement-v1"
MAX_LATEST_BAR_AGE_SECONDS = 120


def _instant(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else None


def _positive(value: object, *, zero: bool = False) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    result = float(value)
    if not isfinite(result) or result < 0 or (result == 0 and not zero):
        return None
    return result


def _minute_index(instant: datetime) -> int | None:
    local = instant.astimezone(NEW_YORK)
    if local.weekday() >= 5 or not time(9, 30) <= local.time().replace(tzinfo=None) < time(16):
        return None
    return (local.hour * 60 + local.minute) - 570


def _ohlcv(bar: Mapping[str, object]) -> tuple[float, float, float, float, float] | None:
    values = tuple(_positive(bar.get(key), zero=(key == "v")) for key in ("o", "h", "l", "c", "v"))
    if any(value is None for value in values):
        return None
    opened, high, low, closed, volume = values
    assert opened is not None and high is not None and low is not None and closed is not None and volume is not None
    if low > min(opened, closed) or high < max(opened, closed) or low > high:
        return None
    return opened, high, low, closed, volume


def build_intraday_range_profile(
    symbol: str, bars: Iterable[Mapping[str, object]], *, as_of: str, data_source: str,
) -> dict[str, object]:
    """Build median cumulative high/low range by minute from prior sessions."""
    cutoff = _instant(as_of)
    if not symbol or symbol != symbol.strip().upper() or cutoff is None:
        raise ValueError("intraday_price_profile_identity_invalid")
    if not data_source.strip():
        raise ValueError("intraday_price_profile_source_required")
    cutoff_day = cutoff.astimezone(NEW_YORK).date()
    sessions: dict[date, dict[int, tuple[float, float, float, float, float]]] = defaultdict(dict)
    canonical: list[tuple[str, int, tuple[float, float, float, float, float]]] = []
    for bar in bars:
        observed, values = _instant(bar.get("t")), _ohlcv(bar)
        if observed is None or values is None:
            raise ValueError("intraday_price_profile_bar_invalid")
        local, minute = observed.astimezone(NEW_YORK), _minute_index(observed)
        if local.date() >= cutoff_day or observed >= cutoff or minute is None:
            continue
        if minute in sessions[local.date()]:
            raise ValueError("intraday_price_profile_duplicate_minute")
        sessions[local.date()][minute] = values
        canonical.append((observed.isoformat(), minute, values))

    complete: list[tuple[date, list[float]]] = []
    for session_day, values in sessions.items():
        if (len(values) < MINIMUM_OBSERVED_MINUTES or 0 not in values
                or REGULAR_SESSION_MINUTES - 1 not in values):
            continue
        session_open = values[0][0]
        running_high, running_low, curve = session_open, session_open, []
        for minute in range(REGULAR_SESSION_MINUTES):
            if minute in values:
                running_high = max(running_high, values[minute][1])
                running_low = min(running_low, values[minute][2])
            curve.append((running_high - running_low) / session_open * 100)
        if all(value > 0 for value in curve):
            complete.append((session_day, curve))
    complete.sort(key=lambda item: item[0])
    selected = complete[-MAXIMUM_PROFILE_SESSIONS:]
    if len(selected) < MINIMUM_PROFILE_SESSIONS:
        raise ValueError("intraday_price_profile_incomplete")
    expected = [round(float(median(curve[minute] for _, curve in selected)), 6)
                for minute in range(REGULAR_SESSION_MINUTES)]
    included_days = [session_day.isoformat() for session_day, _ in selected]
    included = set(included_days)
    payload = sorted(item for item in canonical
                     if datetime.fromisoformat(item[0]).astimezone(NEW_YORK).date().isoformat() in included)
    digest = hashlib.sha256(json.dumps(payload, separators=(",", ":")).encode()).hexdigest()
    return {
        "priceProfileVersion": PRICE_PROFILE_VERSION,
        "priceProfileSessionCount": len(selected),
        "priceProfileSessionDates": included_days,
        "expectedRangePercentByMinute": expected,
        "priceProfileInputDigest": digest,
        "priceProfileEstimator": "median_cumulative_high_low_range_percent",
    }


def expected_range_at(profile: Mapping[str, object], *, observed_at: str) -> float:
    """Return the exact time-of-day range baseline for one regular-session instant."""
    observed = _instant(observed_at)
    minute = _minute_index(observed) if observed is not None else None
    values = profile.get("expectedRangePercentByMinute")
    sessions = profile.get("priceProfileSessionCount")
    if (minute is None or not isinstance(values, list) or len(values) != REGULAR_SESSION_MINUTES
            or not isinstance(sessions, int) or sessions < MINIMUM_PROFILE_SESSIONS):
        raise ValueError("intraday_price_profile_context_invalid")
    expected = _positive(values[minute])
    if expected is None:
        raise ValueError("intraday_price_profile_context_invalid")
    return expected


def calculate_intraday_price_signals(
    symbol: str, bars: Iterable[Mapping[str, object]], *, observed_at: str,
    current_price: float, expected_range_percent: float, data_source: str,
) -> dict[str, object]:
    """Calculate as-known movement diagnostics without ranking or order authority."""
    observed = _instant(observed_at)
    price, expected = _positive(current_price), _positive(expected_range_percent)
    if (not symbol or symbol != symbol.strip().upper() or observed is None
            or price is None or expected is None or not data_source.strip()):
        raise ValueError("intraday_price_signal_input_invalid")
    observed_local = observed.astimezone(NEW_YORK)
    observed_minute = _minute_index(observed)
    if observed_minute is None:
        raise ValueError("intraday_price_signal_outside_regular_session")

    session: dict[int, tuple[datetime, tuple[float, float, float, float, float]]] = {}
    for bar in bars:
        instant, values = _instant(bar.get("t")), _ohlcv(bar)
        if instant is None or values is None:
            raise ValueError("intraday_price_signal_bar_invalid")
        local, minute = instant.astimezone(NEW_YORK), _minute_index(instant)
        if instant > observed:
            raise ValueError("intraday_price_signal_future_bar")
        if local.date() != observed_local.date() or minute is None:
            raise ValueError("intraday_price_signal_session_mismatch")
        if minute in session:
            raise ValueError("intraday_price_signal_duplicate_minute")
        session[minute] = (instant, values)

    if not session:
        raise ValueError("intraday_price_signal_history_incomplete")
    signal_minute = max(session)
    required_minutes = {signal_minute, signal_minute - 5, signal_minute - 10,
                        signal_minute - 15, signal_minute - 60}
    if signal_minute < 60 or any(minute not in session for minute in required_minutes):
        raise ValueError("intraday_price_signal_history_incomplete")
    latest_at = session[signal_minute][0]
    age = (observed - latest_at).total_seconds()
    if not 0 <= age <= MAX_LATEST_BAR_AGE_SECONDS:
        raise ValueError("intraday_price_signal_stale")

    def close_at(minute: int) -> float:
        return session[minute][1][3]

    def change(reference: float) -> float:
        return (price / reference - 1) * 100

    return_5 = change(close_at(signal_minute - 5))
    return_15 = change(close_at(signal_minute - 15))
    return_60 = change(close_at(signal_minute - 60))
    prior_5 = (close_at(signal_minute - 5) / close_at(signal_minute - 10) - 1) * 100
    acceleration = return_5 - prior_5

    admitted = [values for minute, (_, values) in sorted(session.items()) if minute <= signal_minute]
    session_open = session[0][1][0] if 0 in session else admitted[0][0]
    session_high = max(values[1] for values in admitted)
    session_low = min(values[2] for values in admitted)
    cumulative_range = (session_high - session_low) / session_open * 100
    range_expansion = cumulative_range / expected
    total_volume = sum(values[4] for values in admitted)
    if total_volume <= 0:
        raise ValueError("intraday_price_signal_volume_missing")
    vwap = sum(((values[1] + values[2] + values[3]) / 3) * values[4]
               for values in admitted) / total_volume
    price_vs_vwap = (price / vwap - 1) * 100
    pullback = (session_high - price) / session_high * 100

    recent = [session[minute][1] for minute in range(signal_minute - 14, signal_minute + 1)
              if minute in session]
    if len(recent) < 14:
        raise ValueError("intraday_price_signal_history_incomplete")
    recent_high, recent_low = max(value[1] for value in recent), min(value[2] for value in recent)
    close_location = ((price - recent_low) / (recent_high - recent_low) * 100
                      if recent_high > recent_low else 50.0)
    positive_share = sum(value[3] > value[0] for value in recent) / len(recent) * 100

    return {
        "signalVersion": SIGNAL_VERSION,
        "symbol": symbol,
        "observedAt": observed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "dataSource": data_source.strip(),
        "status": "COMPLETE",
        "metrics": {
            "return5MinutePercent": round(return_5, 4),
            "return15MinutePercent": round(return_15, 4),
            "return60MinutePercent": round(return_60, 4),
            "prior5MinuteReturnPercent": round(prior_5, 4),
            "fiveMinuteAccelerationPoints": round(acceleration, 4),
            "vwap": round(vwap, 6),
            "priceVsVwapPercent": round(price_vs_vwap, 4),
            "sessionRangePercent": round(cumulative_range, 4),
            "expectedRangePercent": round(expected, 4),
            "rangeExpansionRatio": round(range_expansion, 4),
            "pullbackFromSessionHighPercent": round(pullback, 4),
            "recent15MinuteCloseLocationPercent": round(close_location, 2),
            "recent15MinutePositiveBarSharePercent": round(positive_share, 2),
        },
        "classification": "research_only",
        "recommendationAllowed": False,
        "orderSubmissionAllowed": False,
    }
