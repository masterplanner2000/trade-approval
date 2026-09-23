"""Pure, research-only intraday opportunity evaluation.

The evaluator accepts an as-known-at-the-time snapshot. It never fetches data,
creates a recommendation, sizes a trade, or calls a broker. Thresholds are
proposed test variables that must be evaluated before any promotion.
"""

from __future__ import annotations

from datetime import datetime, timezone
from math import isfinite
from typing import Mapping


RULESET_VERSION = "intraday-momentum-shadow-v1"
MAX_SNAPSHOT_AGE_SECONDS = 60
MAX_QUOTE_AGE_SECONDS = 5
MINIMUM_PRICE = 5.0
MINIMUM_DAY_CHANGE_PERCENT = 3.0
MAXIMUM_DAY_CHANGE_PERCENT = 20.0
MAXIMUM_OPENING_GAP_PERCENT = 12.0
MINIMUM_RELATIVE_VOLUME = 1.5
MINIMUM_SESSION_DOLLAR_VOLUME = 5_000_000.0
MAXIMUM_SPREAD_PERCENT = 0.75


def _number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and isfinite(value)


def _instant(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else None


def evaluate_intraday_snapshot(snapshot: Mapping[str, object], *, now: str) -> dict[str, object]:
    """Evaluate one immutable observation and return all gate outcomes."""
    observed = _instant(snapshot.get("observedAt"))
    quote_observed = _instant(snapshot.get("quoteObservedAt"))
    current = _instant(now)
    required_numbers = (
        "priorClose", "sessionOpen", "lastPrice", "sessionHigh", "sessionLow",
        "cumulativeVolume", "expectedCumulativeVolume", "bid", "ask",
    )
    missing = [field for field in required_numbers if not _number(snapshot.get(field))]
    if not isinstance(snapshot.get("symbol"), str) or not snapshot.get("symbol", "").strip():
        missing.append("symbol")
    if observed is None:
        missing.append("observedAt")
    if quote_observed is None:
        missing.append("quoteObservedAt")
    if current is None:
        missing.append("validNow")

    base = {
        "rulesetVersion": RULESET_VERSION,
        "classification": "research_only",
        "orderSubmissionAllowed": False,
        "symbol": str(snapshot.get("symbol") or "").upper(),
        "observedAt": snapshot.get("observedAt"),
        "eligible": False,
    }
    if missing:
        return {**base, "status": "INCOMPLETE", "reason": "missing_or_invalid_inputs",
                "missing": sorted(set(missing)), "checks": [], "researchScore": None}

    prior_close = float(snapshot["priorClose"])
    session_open = float(snapshot["sessionOpen"])
    last = float(snapshot["lastPrice"])
    high = float(snapshot["sessionHigh"])
    low = float(snapshot["sessionLow"])
    volume = float(snapshot["cumulativeVolume"])
    expected_volume = float(snapshot["expectedCumulativeVolume"])
    bid = float(snapshot["bid"])
    ask = float(snapshot["ask"])

    positive_prices = all(value > 0 for value in (prior_close, session_open, last, high, low, bid, ask))
    coherent_range = positive_prices and low <= min(session_open, last) <= max(session_open, last) <= high
    quote_ordered = positive_prices and ask >= bid
    day_change = (last / prior_close - 1) * 100 if prior_close > 0 else 0.0
    opening_gap = abs((session_open / prior_close - 1) * 100) if prior_close > 0 else 0.0
    relative_volume = volume / expected_volume if expected_volume > 0 else 0.0
    session_dollar_volume = last * volume
    midpoint = (bid + ask) / 2
    spread = ((ask - bid) / midpoint * 100) if quote_ordered and midpoint > 0 else float("inf")
    snapshot_age = (current - observed).total_seconds()
    quote_age = (current - quote_observed).total_seconds()

    checks = [
        {"id": "regular_session", "passed": snapshot.get("session") == "regular", "actual": snapshot.get("session")},
        {"id": "snapshot_fresh", "passed": 0 <= snapshot_age <= MAX_SNAPSHOT_AGE_SECONDS, "actual": round(snapshot_age, 3)},
        {"id": "quote_fresh", "passed": 0 <= quote_age <= MAX_QUOTE_AGE_SECONDS, "actual": round(quote_age, 3)},
        {"id": "not_halted", "passed": snapshot.get("halted") is False, "actual": snapshot.get("halted")},
        {"id": "coherent_prices", "passed": coherent_range and quote_ordered, "actual": {"low": low, "high": high, "bid": bid, "ask": ask}},
        {"id": "minimum_price", "passed": last >= MINIMUM_PRICE, "actual": round(last, 4)},
        {"id": "day_momentum", "passed": MINIMUM_DAY_CHANGE_PERCENT <= day_change <= MAXIMUM_DAY_CHANGE_PERCENT, "actual": round(day_change, 2)},
        {"id": "opening_gap", "passed": opening_gap <= MAXIMUM_OPENING_GAP_PERCENT, "actual": round(opening_gap, 2)},
        {"id": "relative_volume", "passed": relative_volume >= MINIMUM_RELATIVE_VOLUME, "actual": round(relative_volume, 2)},
        {"id": "session_liquidity", "passed": session_dollar_volume >= MINIMUM_SESSION_DOLLAR_VOLUME, "actual": round(session_dollar_volume, 2)},
        {"id": "current_spread", "passed": spread <= MAXIMUM_SPREAD_PERCENT, "actual": round(spread, 4) if isfinite(spread) else None},
    ]
    failed = [check["id"] for check in checks if not check["passed"]]
    eligible = not failed
    score = min(100.0, max(0.0,
        30.0 + min(day_change, 12.0) * 2.5 + min(relative_volume, 5.0) * 8.0 - min(spread, 1.0) * 10.0
    )) if eligible else None
    return {
        **base,
        "status": "COMPLETE",
        "eligible": eligible,
        "reason": None if eligible else "intraday_gates_failed",
        "failedChecks": failed,
        "researchScore": round(score, 1) if score is not None else None,
        "metrics": {
            "dayChangePercent": round(day_change, 2),
            "openingGapPercent": round(opening_gap, 2),
            "relativeVolume": round(relative_volume, 2),
            "sessionDollarVolume": round(session_dollar_volume, 2),
            "spreadPercent": round(spread, 4) if isfinite(spread) else None,
        },
        "checks": checks,
        "signalBasis": "price_volume_direction",
        "catalystRequired": False,
        "optionalContext": ["news_catalyst", "macro_theme", "scheduled_event"],
        "missingBeforeProposal": [
            "completed_daily_context", "portfolio_sizing",
            "account_validation", "broker_what_if", "forward_performance_evidence",
        ],
    }
