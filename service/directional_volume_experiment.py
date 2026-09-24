"""Frozen research-only test: relative volume ranks, but does not veto, direction."""

from __future__ import annotations

from typing import Any

from aggressive_shadow_scanner import RULESET_VERSION as CONTROL_RULESET, evaluate as control_evaluate
from ibkr_daily_scanner import DailyBar


EXPERIMENT_ID = "directional-volume-context-2026-09-23-v1"
RULESET_VERSION = "volatile-growth-directional-volume-context-v1"
FROZEN_AT = "2026-09-23T23:59:00Z"


def manifest() -> dict[str, object]:
    return {
        "experimentId": EXPERIMENT_ID,
        "classification": "research_only",
        "frozenAt": FROZEN_AT,
        "controlRuleset": CONTROL_RULESET,
        "treatmentRuleset": RULESET_VERSION,
        "hypothesis": (
            "A confirmed directional setup can retain useful forward performance when relative "
            "volume is a ranking input rather than a hard eligibility veto."
        ),
        "singleChange": "relative_volume_removed_as_hard_gate",
        "unchangedGates": ["price", "venue_liquidity", "volatility", "five_day_momentum",
                           "twenty_day_momentum"],
        "horizonsSessions": [1, 5, 10],
        "roundTripCostBps": 20,
        "minimumDistinctSessions": 20,
        "promotionCriterion": "positive_paired_lower_95_bound_after_costs",
        "rollbackCriteria": {
            "meanPairedReturnBpsAtOrBelow": 0,
            "additionalMaximumDrawdownBpsAboveControl": 100,
        },
        "recommendationAuthority": False,
        "orderSubmissionAllowed": False,
    }


def evaluate(symbol: str, bars: list[DailyBar], *, today: str | None = None) -> dict[str, Any]:
    control = control_evaluate(symbol, bars, today=today)
    checks = control.get("checks")
    result: dict[str, Any] = {
        **control,
        "experimentId": EXPERIMENT_ID,
        "rulesetVersion": RULESET_VERSION,
        "classification": "research_only",
        "orderSubmissionAllowed": False,
        "controlEligible": bool(control.get("eligible")),
    }
    if not isinstance(checks, list):
        return result
    failed = {str(check.get("id")) for check in checks
              if isinstance(check, dict) and check.get("passed") is False}
    eligible = not (failed - {"relative_volume"})
    if not eligible:
        return {**result, "eligible": False, "researchScore": None,
                "reason": control.get("reason") or "technical_gate_failed"}
    momentum = float(control.get("momentum5Percent") or 0)
    relative_volume = float(control.get("relativeVolume") or 0)
    atr = float(control.get("atrPercent14") or 0)
    score = min(100, max(0, 35 + min(momentum, 20) * 1.5
                         + min(relative_volume, 4) * 8 + min(atr, 12)))
    return {
        **result,
        "eligible": True,
        "reason": None,
        "researchScore": round(score, 1),
        "relativeVolumeRole": "ranking_context",
        "admittedBySingleChange": failed == {"relative_volume"},
    }
