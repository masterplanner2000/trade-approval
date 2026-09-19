"""Pure, research-only macro/news event bias evaluator.

This module does not fetch news, rank the trading universe, size positions or
submit orders. It only evaluates caller-supplied, timestamped evidence.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Mapping


RULESET_VERSION = "macro-event-volatility-shadow-v1"
EVENT_TYPES = {
    "monetary_policy", "inflation", "labor", "growth", "energy",
    "geopolitical", "regulation", "industry", "company",
}
MAX_EVENT_AGE_SECONDS = 6 * 60 * 60
MAX_QUOTE_AGE_SECONDS = 60


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
    return float(value)


def _bounded(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _in_range(value: float | None, low: float, high: float) -> bool:
    return value is not None and low <= value <= high


def evaluate_macro_event_bias(evidence: Mapping[str, object], *, now: str) -> dict[str, object]:
    """Return a versioned bias observation; all failed gates are preserved."""
    symbol = str(evidence.get("symbol") or "").upper()
    event = evidence.get("event") if isinstance(evidence.get("event"), Mapping) else {}
    exposure = evidence.get("exposure") if isinstance(evidence.get("exposure"), Mapping) else {}
    reaction = evidence.get("reaction") if isinstance(evidence.get("reaction"), Mapping) else {}

    evaluated_at = _instant(now)
    published_at = _instant(event.get("publishedAt"))
    quote_at = _instant(reaction.get("quoteObservedAt"))
    event_age = ((evaluated_at - published_at).total_seconds()
                 if evaluated_at and published_at else None)
    quote_age = ((evaluated_at - quote_at).total_seconds()
                 if evaluated_at and quote_at else None)

    event_type = event.get("type")
    source_count = _number(event.get("independentSourceCount"))
    verified = event.get("primarySourceVerified") is True or (source_count is not None and source_count >= 2)
    surprise = _number(event.get("surpriseMagnitude"))
    event_confidence = _number(event.get("confidence"))
    exposure_strength = _number(exposure.get("strength"))
    exposure_direction = _number(exposure.get("direction"))
    price_return = _number(reaction.get("returnPercent"))
    relative_volume = _number(reaction.get("relativeVolume"))
    atr = _number(reaction.get("atrPercent14"))
    spread = _number(reaction.get("spreadBps"))

    expected_sign = None
    if exposure_direction is not None and surprise is not None and exposure_direction != 0 and surprise != 0:
        expected_sign = 1 if exposure_direction * surprise > 0 else -1
    observed_sign = None
    if price_return is not None and price_return != 0:
        observed_sign = 1 if price_return > 0 else -1

    checks = [
        {"id": "symbol", "passed": bool(symbol)},
        {"id": "supported_event_type", "passed": event_type in EVENT_TYPES, "actual": event_type},
        {"id": "event_provenance", "passed": verified, "actual": {
            "primarySourceVerified": event.get("primarySourceVerified") is True,
            "independentSourceCount": source_count,
        }},
        {"id": "event_freshness", "passed": _in_range(event_age, 0, MAX_EVENT_AGE_SECONDS), "actualSeconds": event_age},
        {"id": "event_strength", "passed": _in_range(surprise, -5, 5) and surprise != 0
         and _in_range(event_confidence, 0.5, 1), "actual": {"surpriseMagnitude": surprise, "confidence": event_confidence}},
        {"id": "symbol_exposure", "passed": _in_range(exposure_strength, 0.5, 1)
         and _in_range(exposure_direction, -1, 1) and exposure_direction != 0,
         "actual": {"strength": exposure_strength, "direction": exposure_direction}},
        {"id": "quote_freshness", "passed": _in_range(quote_age, 0, MAX_QUOTE_AGE_SECONDS), "actualSeconds": quote_age},
        {"id": "not_halted", "passed": reaction.get("halted") is False, "actual": reaction.get("halted")},
        {"id": "reaction_magnitude", "passed": price_return is not None and 1 <= abs(price_return) <= 20,
         "actualPercent": price_return},
        {"id": "reaction_alignment", "passed": expected_sign is not None and observed_sign == expected_sign,
         "actual": {"expectedSign": expected_sign, "observedSign": observed_sign}},
        {"id": "relative_volume", "passed": _in_range(relative_volume, 1.5, 10), "actual": relative_volume},
        {"id": "volatility_band", "passed": _in_range(atr, 3, 20), "actualPercent": atr},
        {"id": "spread", "passed": _in_range(spread, 0, 75), "actualBps": spread},
    ]
    failed = [check["id"] for check in checks if not check["passed"]]
    eligible = not failed

    score = None
    if eligible:
        event_score = min(abs(surprise), 3) / 3 * 25 * event_confidence
        exposure_score = exposure_strength * 20
        reaction_score = min(abs(price_return), 8) / 8 * 20
        volume_score = min(relative_volume, 5) / 5 * 20
        volatility_score = (1 - abs(atr - 8) / 12) * 15
        score = round(_bounded(event_score + exposure_score + reaction_score
                               + volume_score + volatility_score, 0, 100), 1)

    return {
        "rulesetVersion": RULESET_VERSION,
        "classification": "research_observation_only",
        "symbol": symbol,
        "eligible": eligible,
        "reason": None if eligible else "macro_event_gates_failed",
        "failedChecks": failed,
        "checks": checks,
        "biasDirection": "LONG" if eligible and expected_sign == 1 else "AVOID_OR_EXIT" if eligible else None,
        "rankingBiasScore": score,
        "orderSubmissionAllowed": False,
        "missingBeforeProposal": [
            "forward_outcome_validation", "portfolio_sizing", "fresh_broker_validation",
            "strategy_promotion_decision",
        ],
    }
