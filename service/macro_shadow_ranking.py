"""Stage-12 bounded macro shadow-ranking experiment.

The functions are pure and research-only. They cannot alter the production
queue, portfolio policy, approvals, or broker orders.
"""

from __future__ import annotations

import hashlib
import json
import math
import statistics
from datetime import datetime, timezone
from typing import Mapping, Sequence


SHADOW_RULESET_VERSION = "macro-shadow-ranking-v1"
MAX_ABSOLUTE_ADJUSTMENT = 5.0
REQUIRED_GATES = ("liquidity", "spread", "freshness", "ownership", "protection", "portfolio")
MIN_FORWARD_SESSIONS = 30
ROLLBACK_MAX_MEAN_DEGRADATION_BPS = -5.0
ROLLBACK_MAX_ADDITIONAL_TROUGH_BPS = 100.0
ROLLBACK_MAX_OPERATIONAL_FAILURE_RATE = 0.05


def _canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _digest(value: object) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _finite(value: object) -> bool:
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(float(value))


def _instant(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else None


def _mean_ci(values: Sequence[float]) -> dict[str, float | int | None]:
    if not values:
        return {"count": 0, "mean": None, "lower95": None, "upper95": None}
    mean = statistics.fmean(values)
    if len(values) == 1:
        return {"count": 1, "mean": round(mean, 6), "lower95": None, "upper95": None}
    margin = 1.96 * statistics.stdev(values) / math.sqrt(len(values))
    return {"count": len(values), "mean": round(mean, 6),
            "lower95": round(mean - margin, 6), "upper95": round(mean + margin, 6)}


def authorize_experiment(stage11_report: Mapping[str, object], *, mode: str) -> dict[str, object]:
    """Gate real forward work on Stage 11; fixtures receive no promotion authority."""
    blockers: list[str] = []
    if mode not in {"REAL_FORWARD", "RECORDED_REHEARSAL"}:
        blockers.append("experiment_mode_invalid")
    if mode == "REAL_FORWARD":
        if stage11_report.get("analysisVersion") != "macro-outcomes-v1" \
                or stage11_report.get("classification") != "research_only" \
                or stage11_report.get("orderSubmissionAllowed") is not False:
            blockers.append("stage11_report_contract_invalid")
        if stage11_report.get("conclusion") != "PROCEED_TO_SHADOW_RANKING":
            blockers.append("stage11_not_promoted")
        if stage11_report.get("adequateSample") is not True:
            blockers.append("stage11_sample_inadequate")
        if not isinstance(stage11_report.get("reportDigest"), str) \
                or not stage11_report["reportDigest"].strip():
            blockers.append("stage11_digest_missing")
    return {
        "shadowRulesetVersion": SHADOW_RULESET_VERSION, "mode": mode,
        "authorized": not blockers, "blockers": blockers,
        "stage11ReportDigest": stage11_report.get("reportDigest"),
        "promotionEvidenceAllowed": mode == "REAL_FORWARD" and not blockers,
        "orderSubmissionAllowed": False, "recommendationAuthority": False,
    }


def compare_rankings(
    candidates: Sequence[Mapping[str, object]], macro_observations: Mapping[str, Mapping[str, object]],
    *, as_known_at: str, authorization: Mapping[str, object],
) -> dict[str, object]:
    if authorization.get("authorized") is not True \
            or authorization.get("shadowRulesetVersion") != SHADOW_RULESET_VERSION \
            or authorization.get("mode") not in {"REAL_FORWARD", "RECORDED_REHEARSAL"} \
            or authorization.get("orderSubmissionAllowed") is not False:
        raise ValueError("macro_shadow_experiment_not_authorized")
    known_at = _instant(as_known_at)
    if known_at is None:
        raise ValueError("macro_shadow_as_known_at_invalid")
    seen: set[str] = set()
    rows: list[dict[str, object]] = []
    for candidate in candidates:
        symbol = str(candidate.get("symbol") or "").upper()
        if not symbol or symbol in seen:
            raise ValueError("macro_shadow_candidate_identity_invalid")
        seen.add(symbol)
        score = candidate.get("baselineScore")
        if not _finite(score) or not 0 <= float(score) <= 100:
            raise ValueError("macro_shadow_baseline_score_invalid")
        gates = candidate.get("gates")
        if not isinstance(gates, Mapping):
            raise ValueError("macro_shadow_gates_missing")
        failed = [gate for gate in REQUIRED_GATES if gates.get(gate) is not True]
        macro = macro_observations.get(symbol)
        adjustment, macro_reason = 0.0, "no_eligible_macro_observation"
        macro_time = _instant(macro.get("evaluatedAt")) if isinstance(macro, Mapping) else None
        macro_provenance_valid = (isinstance(macro, Mapping)
                                  and macro.get("classification") == "research_observation_only"
                                  and isinstance(macro.get("rulesetVersion"), str)
                                  and bool(macro["rulesetVersion"].strip())
                                  and macro_time is not None and macro_time <= known_at)
        if isinstance(macro, Mapping) and macro.get("eligible") is True \
                and _finite(macro.get("rankingBiasScore")) and macro_provenance_valid:
            raw = min(100.0, max(0.0, float(macro["rankingBiasScore"]))) / 100 * MAX_ABSOLUTE_ADJUSTMENT
            if macro.get("biasDirection") == "LONG":
                adjustment, macro_reason = raw, "eligible_long_macro_bias"
            elif macro.get("biasDirection") == "AVOID_OR_EXIT":
                adjustment, macro_reason = -raw, "eligible_adverse_macro_bias"
        elif isinstance(macro, Mapping) and macro.get("eligible") is True:
            macro_reason = "macro_provenance_or_timing_invalid"
        if failed:
            adjustment, macro_reason = 0.0, "hard_gate_failed"
        rows.append({
            "symbol": symbol, "baselineScore": round(float(score), 6),
            "macroAdjustment": round(adjustment, 6),
            "shadowScore": round(max(0.0, min(100.0, float(score) + adjustment)), 6),
            "failedGates": failed, "rankEligible": not failed, "macroReason": macro_reason,
        })
    baseline = sorted((row for row in rows if row["rankEligible"]),
                      key=lambda row: (-float(row["baselineScore"]), str(row["symbol"])))
    shadow = sorted((row for row in rows if row["rankEligible"]),
                    key=lambda row: (-float(row["shadowScore"]), str(row["symbol"])))
    baseline_order = [str(row["symbol"]) for row in baseline]
    shadow_order = [str(row["symbol"]) for row in shadow]
    output: dict[str, object] = {
        "shadowRulesetVersion": SHADOW_RULESET_VERSION, "classification": "research_only",
        "asKnownAt": as_known_at, "inputDigest": _digest({"candidates": candidates,
                                                            "macro": macro_observations}),
        "baselineOrder": baseline_order, "shadowOrder": shadow_order,
        "rows": rows, "rankChanges": {symbol: baseline_order.index(symbol) - shadow_order.index(symbol)
                                        for symbol in baseline_order},
        "maxAbsoluteAdjustment": MAX_ABSOLUTE_ADJUSTMENT,
        "productionQueueChanged": False, "orderSubmissionAllowed": False,
        "recommendationAuthority": False,
    }
    output["comparisonDigest"] = _digest(output)
    return output


def build_forward_comparison(
    sessions: Sequence[Mapping[str, object]], *, generated_at: str,
    authorization: Mapping[str, object],
) -> dict[str, object]:
    if _instant(generated_at) is None:
        raise ValueError("macro_shadow_report_time_invalid")
    if authorization.get("authorized") is not True \
            or authorization.get("mode") not in {"REAL_FORWARD", "RECORDED_REHEARSAL"} \
            or authorization.get("shadowRulesetVersion") != SHADOW_RULESET_VERSION:
        raise ValueError("macro_shadow_experiment_not_authorized")
    seen: set[str] = set()
    eligible: list[Mapping[str, object]] = []
    excluded: list[dict[str, object]] = []
    previous: datetime | None = None
    for index, session in enumerate(sessions):
        session_id = str(session.get("sessionId") or "")
        observed = _instant(session.get("observedAt"))
        if not session_id or session_id in seen:
            raise ValueError("macro_shadow_session_identity_invalid")
        seen.add(session_id)
        if observed is None or (previous is not None and observed <= previous):
            raise ValueError("macro_shadow_session_order_invalid")
        previous = observed
        reasons: list[str] = []
        if session.get("classification") != "REAL_FORWARD" \
                or authorization.get("promotionEvidenceAllowed") is not True:
            reasons.append("not_real_forward")
        if session.get("complete") is not True:
            reasons.append("incomplete")
        baseline_digest = session.get("baselineInputDigest")
        shadow_digest = session.get("shadowInputDigest")
        if not isinstance(baseline_digest, str) or not isinstance(shadow_digest, str):
            reasons.append("input_digest_missing")
        elif baseline_digest != shadow_digest:
            reasons.append("input_digest_mismatch")
        for field in ("baselineOutcomeBps", "shadowOutcomeBps"):
            if not _finite(session.get(field)):
                reasons.append(f"{field}_invalid")
        if reasons:
            excluded.append({"sessionId": session_id, "reasons": reasons})
        else:
            eligible.append(session)
    differences = [float(item["shadowOutcomeBps"]) - float(item["baselineOutcomeBps"])
                   for item in eligible]
    difference_ci = _mean_ci(differences)
    baseline_sum = shadow_sum = baseline_trough = shadow_trough = 0.0
    for item in eligible:
        baseline_sum += float(item["baselineOutcomeBps"])
        shadow_sum += float(item["shadowOutcomeBps"])
        baseline_trough = min(baseline_trough, baseline_sum)
        shadow_trough = min(shadow_trough, shadow_sum)
    failure_rate = (sum(1 for item in sessions if item.get("operationalFailure") is True)
                    / len(sessions) if sessions else None)
    additional_trough = abs(min(0.0, shadow_trough)) - abs(min(0.0, baseline_trough))
    rollback_reasons: list[str] = []
    if difference_ci["mean"] is not None and float(difference_ci["mean"]) < ROLLBACK_MAX_MEAN_DEGRADATION_BPS:
        rollback_reasons.append("mean_degradation")
    if additional_trough > ROLLBACK_MAX_ADDITIONAL_TROUGH_BPS:
        rollback_reasons.append("drawdown_degradation")
    if failure_rate is not None and failure_rate > ROLLBACK_MAX_OPERATIONAL_FAILURE_RATE:
        rollback_reasons.append("operational_failure_rate")
    adequate = len(eligible) >= MIN_FORWARD_SESSIONS
    if rollback_reasons:
        conclusion = "REJECT_ROLLBACK"
    elif adequate and difference_ci["lower95"] is not None and float(difference_ci["lower95"]) > 0:
        conclusion = "IMPROVED_PROCEED_TO_PROMOTION_REVIEW"
    elif adequate and difference_ci["upper95"] is not None and float(difference_ci["upper95"]) <= 0:
        conclusion = "REJECT_NO_IMPROVEMENT"
    else:
        conclusion = "CONTINUE_COLLECTING"
    report: dict[str, object] = {
        "shadowRulesetVersion": SHADOW_RULESET_VERSION, "classification": "research_only",
        "generatedAt": generated_at, "scheduledSessionCount": len(sessions),
        "eligibleSessionCount": len(eligible), "excluded": excluded,
        "minimumForwardSessions": MIN_FORWARD_SESSIONS, "adequateSample": adequate,
        "pairedOutcomeDifferenceBps": difference_ci,
        "baselineCumulativeTroughBps": round(baseline_trough, 6),
        "shadowCumulativeTroughBps": round(shadow_trough, 6),
        "additionalTroughBps": round(additional_trough, 6),
        "operationalFailureRate": round(failure_rate, 6) if failure_rate is not None else None,
        "rollbackThresholds": {
            "meanDegradationBps": ROLLBACK_MAX_MEAN_DEGRADATION_BPS,
            "additionalTroughBps": ROLLBACK_MAX_ADDITIONAL_TROUGH_BPS,
            "operationalFailureRate": ROLLBACK_MAX_OPERATIONAL_FAILURE_RATE,
        },
        "rollbackReasons": rollback_reasons, "conclusion": conclusion,
        "productionQueueChanged": False, "orderSubmissionAllowed": False,
        "recommendationAuthority": False,
    }
    report["reportDigest"] = _digest(report)
    return report
