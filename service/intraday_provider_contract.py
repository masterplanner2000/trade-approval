"""Fail-closed normalization from approved provider evidence to intraday research input."""

from __future__ import annotations

from datetime import datetime, time, timezone
from math import isfinite
from typing import Mapping
from zoneinfo import ZoneInfo


NEW_YORK = ZoneInfo("America/New_York")
MAX_CONTEXT_AGE_SECONDS = 60
MINIMUM_PROFILE_SESSIONS = 10


def _instant(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else None


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    result = float(value)
    return result if isfinite(result) and result > 0 else None


def build_intraday_research_snapshot(
    market: Mapping[str, object], context: Mapping[str, object]
) -> dict[str, object]:
    """Join independently sourced market and session context without inventing values."""
    market_at = _instant(market.get("observedAt"))
    quote_at = _instant(market.get("quoteObservedAt"))
    context_at = _instant(context.get("observedAt"))
    if None in {market_at, quote_at, context_at}:
        raise ValueError("intraday_provider_timestamp_invalid")
    assert market_at is not None and quote_at is not None and context_at is not None
    if context_at > market_at or (market_at - context_at).total_seconds() > MAX_CONTEXT_AGE_SECONDS:
        raise ValueError("intraday_context_stale_or_future")
    symbol = market.get("symbol")
    if not isinstance(symbol, str) or not symbol or symbol != symbol.upper():
        raise ValueError("intraday_provider_symbol_invalid")
    if context.get("symbol") != symbol:
        raise ValueError("intraday_context_symbol_mismatch")
    expected = _number(context.get("expectedCumulativeVolume"))
    sessions = context.get("profileSessionCount")
    halted = context.get("halted")
    if expected is None or not isinstance(sessions, int) or sessions < MINIMUM_PROFILE_SESSIONS:
        raise ValueError("intraday_volume_profile_incomplete")
    if not isinstance(halted, bool):
        raise ValueError("intraday_halt_state_unknown")
    context_source = context.get("dataSource")
    if not isinstance(context_source, str) or not context_source.strip():
        raise ValueError("intraday_context_source_required")
    required = {
        "priorClose": market.get("previousClose"), "sessionOpen": market.get("sessionOpen"),
        "lastPrice": market.get("last"), "sessionHigh": market.get("sessionHigh"),
        "sessionLow": market.get("sessionLow"), "cumulativeVolume": market.get("sessionVolume"),
        "bid": market.get("bid"), "ask": market.get("ask"),
    }
    if any(_number(value) is None for value in required.values()):
        raise ValueError("intraday_market_snapshot_incomplete")
    local = market_at.astimezone(NEW_YORK)
    regular = local.weekday() < 5 and time(9, 30) <= local.time().replace(tzinfo=None) < time(16)
    feed = market.get("feed")
    volume_scope = market.get("volumeScope")
    if feed not in {"iex", "sip"} or volume_scope not in {"single_venue", "consolidated"}:
        raise ValueError("intraday_feed_provenance_invalid")
    return {
        "symbol": symbol,
        "observedAt": market["observedAt"],
        "quoteObservedAt": market["quoteObservedAt"],
        "session": "regular" if regular else "outside_regular",
        "halted": halted,
        **required,
        "expectedCumulativeVolume": expected,
        "dataSource": f"{market.get('provider')} {feed} snapshot + {context_source.strip()}",
        "volumeScope": volume_scope,
        "profileSessionCount": sessions,
        "profileVersion": context.get("profileVersion"),
    }
