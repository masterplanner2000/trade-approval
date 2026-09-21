"""Deterministic Stage-11 outcomes and matched-control analysis.

This module is research-only. It summarizes immutable forward observations and
cannot create recommendations, change portfolio policy, or submit orders.
"""

from __future__ import annotations

import hashlib
import json
import math
import statistics
from datetime import datetime, timezone
from typing import Mapping, Sequence


ANALYSIS_VERSION = "macro-outcomes-v1"
DEFAULT_HORIZONS = ("1m", "5m", "30m")
MIN_FORWARD_EVENTS = 30
MIN_MATCHED_CONTROLS = 30
REAL_FORWARD = "REAL_FORWARD"


def _instant(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else None


def _canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _finite(value: object) -> bool:
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(float(value))


def _mean_ci(values: Sequence[float]) -> dict[str, float | int | None]:
    count = len(values)
    if not count:
        return {"count": 0, "mean": None, "lower95": None, "upper95": None}
    mean = statistics.fmean(values)
    if count < 2:
        return {"count": count, "mean": round(mean, 6), "lower95": None, "upper95": None}
    margin = 1.96 * statistics.stdev(values) / math.sqrt(count)
    return {"count": count, "mean": round(mean, 6),
            "lower95": round(mean - margin, 6), "upper95": round(mean + margin, 6)}


def _record_key(record: Mapping[str, object]) -> tuple[str, str, str]:
    return (str(record.get("studyId") or ""), str(record.get("symbol") or "").upper(),
            str(record.get("scheduledAt") or ""))


def _validate(records: Sequence[Mapping[str, object]], horizons: Sequence[str]) -> list[str]:
    errors: list[str] = []
    seen: set[tuple[str, str, str]] = set()
    seen_matches: set[tuple[str, str]] = set()
    calibration_times: list[datetime] = []
    forward_times: list[datetime] = []
    for index, record in enumerate(records):
        prefix = f"record_{index}"
        key = _record_key(record)
        if not all(key):
            errors.append(f"{prefix}_identity_invalid")
        elif key in seen:
            errors.append(f"{prefix}_duplicate")
        seen.add(key)
        scheduled, captured = _instant(record.get("scheduledAt")), _instant(record.get("capturedAt"))
        if scheduled is None or captured is None or captured < scheduled:
            errors.append(f"{prefix}_timeline_invalid")
        split = record.get("split")
        if split == "CALIBRATION" and scheduled:
            calibration_times.append(scheduled)
        elif split == "FORWARD" and scheduled:
            forward_times.append(scheduled)
        else:
            errors.append(f"{prefix}_split_invalid")
        if record.get("observationType") not in {"EVENT", "MATCHED_NO_EVENT"}:
            errors.append(f"{prefix}_observation_type_invalid")
        if record.get("signalDirection") not in {-1, 0, 1}:
            errors.append(f"{prefix}_direction_invalid")
        if not isinstance(record.get("matchKey"), str) or not record["matchKey"].strip():
            errors.append(f"{prefix}_match_key_invalid")
        else:
            match_identity = (str(record.get("observationType")), str(record["matchKey"]))
            if match_identity in seen_matches:
                errors.append(f"{prefix}_duplicate_match_key")
            seen_matches.add(match_identity)
        if not _finite(record.get("latenessMilliseconds")) or float(record["latenessMilliseconds"]) < 0:
            errors.append(f"{prefix}_lateness_invalid")
        observations = record.get("horizons")
        if not isinstance(observations, Mapping):
            errors.append(f"{prefix}_horizons_invalid")
            continue
        for horizon in horizons:
            item = observations.get(horizon)
            if item is None:
                continue
            if not isinstance(item, Mapping):
                errors.append(f"{prefix}_{horizon}_invalid")
                continue
            for field in ("grossReturnBps", "spreadBps", "estimatedSlippageBps",
                          "favorableExcursionBps", "adverseExcursionBps", "volume",
                          "benchmarkReturnBps", "cashReturnBps", "momentumScore"):
                if not _finite(item.get(field)):
                    errors.append(f"{prefix}_{horizon}_{field}_invalid")
            if item.get("volatilityRegime") not in {"LOW", "NORMAL", "HIGH"}:
                errors.append(f"{prefix}_{horizon}_volatility_regime_invalid")
    if calibration_times and forward_times and max(calibration_times) >= min(forward_times):
        errors.append("walk_forward_split_overlap")
    return errors


def build_outcome_report(
    records: Sequence[Mapping[str, object]], *, generated_at: str,
    horizons: Sequence[str] = DEFAULT_HORIZONS,
    minimum_events: int = MIN_FORWARD_EVENTS, minimum_controls: int = MIN_MATCHED_CONTROLS,
) -> dict[str, object]:
    """Build a reproducible report while keeping excluded observations visible."""
    generated = _instant(generated_at)
    if generated is None:
        raise ValueError("macro_outcome_generated_at_invalid")
    if not horizons or len(set(horizons)) != len(horizons):
        raise ValueError("macro_outcome_horizons_invalid")
    errors = _validate(records, horizons)
    if errors:
        raise ValueError(";".join(errors))

    excluded: list[dict[str, object]] = []
    eligible: list[Mapping[str, object]] = []
    scheduled_forward = [record for record in records if record.get("split") == "FORWARD"]
    for record in records:
        reasons: list[str] = []
        if record.get("classification") != REAL_FORWARD:
            reasons.append("not_real_forward")
        if record.get("split") != "FORWARD":
            reasons.append("not_forward_split")
        if record.get("pilotComplete") is not True:
            reasons.append("pilot_incomplete")
        if record.get("replayMatch") is not True:
            reasons.append("replay_mismatch")
        if record.get("correctionPending") is True:
            reasons.append("correction_pending")
        if reasons:
            excluded.append({"identity": _record_key(record), "reasons": reasons,
                             "missingReason": record.get("missingReason")})
        else:
            eligible.append(record)

    event_records = [record for record in eligible if record["observationType"] == "EVENT"]
    control_records = [record for record in eligible if record["observationType"] == "MATCHED_NO_EVENT"]
    controls_by_match = {str(record["matchKey"]): record for record in control_records}
    version_fields = ("rulesetVersion", "mappingVersion", "universeVersion")
    version_sets = {field: sorted({str(record.get(field)) for record in eligible}) for field in version_fields}
    version_consistent = all(len(values) <= 1 and values != ["None"] for values in version_sets.values())

    metrics: dict[str, object] = {}
    for horizon in horizons:
        event_net: list[float] = []
        control_net: list[float] = []
        benchmark_excess: list[float] = []
        cash_excess: list[float] = []
        momentum_scores: list[float] = []
        favorable: list[float] = []
        adverse: list[float] = []
        regimes: dict[str, int] = {"LOW": 0, "NORMAL": 0, "HIGH": 0}
        missing = 0
        event_values_by_match: dict[str, float] = {}
        control_values_by_match: dict[str, float] = {}
        for record in eligible:
            item = record["horizons"].get(horizon)
            if not isinstance(item, Mapping):
                missing += 1
                continue
            direction = int(record["signalDirection"])
            gross = direction * float(item["grossReturnBps"])
            cost = float(item["spreadBps"]) + float(item["estimatedSlippageBps"])
            net = gross - cost
            target = event_net if record["observationType"] == "EVENT" else control_net
            target.append(net)
            regimes[str(item["volatilityRegime"])] += 1
            if record["observationType"] == "EVENT":
                event_values_by_match[str(record["matchKey"])] = net
                favorable.append(direction * float(item["favorableExcursionBps"]))
                adverse.append(direction * float(item["adverseExcursionBps"]))
                benchmark_excess.append(gross - direction * float(item["benchmarkReturnBps"]) - cost)
                cash_excess.append(gross - direction * float(item["cashReturnBps"]) - cost)
                momentum_scores.append(float(item["momentumScore"]))
            else:
                control_values_by_match[str(record["matchKey"])] = net
        event_ci, control_ci = _mean_ci(event_net), _mean_ci(control_net)
        matched_excess = [value - control_values_by_match[key]
                          for key, value in event_values_by_match.items()
                          if key in control_values_by_match]
        cumulative, trough = 0.0, 0.0
        for value in event_net:
            cumulative += value
            trough = min(trough, cumulative)
        metrics[horizon] = {
            "eventNetBps": event_ci, "controlNetBps": control_ci,
            "matchedControlExcessBps": _mean_ci(matched_excess),
            "benchmarkExcessBps": _mean_ci(benchmark_excess),
            "cashExcessBps": _mean_ci(cash_excess),
            "momentumScore": _mean_ci(momentum_scores),
            "favorableExcursionBps": _mean_ci(favorable),
            "adverseExcursionBps": _mean_ci(adverse),
            "cumulativeNetTroughBps": round(trough, 6), "missingObservations": missing,
            "volatilityRegimeCounts": regimes,
        }

    matched_pairs = sum(1 for record in event_records if str(record["matchKey"]) in controls_by_match)
    def valid_match(event: Mapping[str, object], control: Mapping[str, object]) -> bool:
        event_time, control_time = _instant(event.get("scheduledAt")), _instant(control.get("scheduledAt"))
        if event.get("symbol") != control.get("symbol") or event_time is None or control_time is None:
            return False
        if (event_time.hour, event_time.minute) != (control_time.hour, control_time.minute):
            return False
        return all(
            not isinstance(event["horizons"].get(horizon), Mapping)
            or not isinstance(control["horizons"].get(horizon), Mapping)
            or event["horizons"][horizon].get("volatilityRegime")
            == control["horizons"][horizon].get("volatilityRegime")
            for horizon in horizons
        )

    match_valid = all(valid_match(record, controls_by_match[str(record["matchKey"])])
                      for record in event_records if str(record["matchKey"]) in controls_by_match)
    adequacy = (len(event_records) >= minimum_events and len(control_records) >= minimum_controls
                and matched_pairs >= min(minimum_events, minimum_controls) and match_valid
                and version_consistent)
    primary = metrics[horizons[-1]]["matchedControlExcessBps"]
    lower, upper = primary["lower95"], primary["upper95"]
    if adequacy and upper is not None and upper <= 0:
        conclusion, rationale = "REJECT", "matched_control_upper_bound_not_positive"
    elif adequacy and lower is not None and lower > 0:
        conclusion, rationale = "PROCEED_TO_SHADOW_RANKING", "matched_control_lower_bound_positive"
    else:
        conclusion, rationale = "CONTINUE_COLLECTING", "sample_or_uncertainty_gate_not_met"

    report: dict[str, object] = {
        "analysisVersion": ANALYSIS_VERSION, "classification": "research_only",
        "generatedAt": generated.isoformat().replace("+00:00", "Z"),
        "horizons": list(horizons), "scheduledForwardCount": len(scheduled_forward),
        "eligibleEventCount": len(event_records), "eligibleControlCount": len(control_records),
        "matchedPairCount": matched_pairs, "matchesValid": match_valid,
        "excludedCount": len(excluded), "excluded": excluded,
        "failureRate": (round(sum(1 for item in excluded if "not_forward_split" not in item["reasons"])
                              / len(scheduled_forward), 6) if scheduled_forward else None),
        "latenessMilliseconds": _mean_ci([float(record["latenessMilliseconds"])
                                           for record in eligible]),
        "versions": version_sets, "versionConsistent": version_consistent,
        "minimumSamples": {"events": minimum_events, "matchedControls": minimum_controls},
        "adequateSample": adequacy, "metrics": metrics,
        "conclusion": conclusion, "conclusionRationale": rationale,
        "costModel": "net_bps = signed_gross_return - observed_spread - estimated_slippage",
        "uncertaintyMethod": "normal_approximation_95_percent_descriptive_not_causal",
        "orderSubmissionAllowed": False, "recommendationAuthority": False,
    }
    report["reportDigest"] = hashlib.sha256(_canonical(report).encode("utf-8")).hexdigest()
    return report
