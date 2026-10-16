"""Transparent research-only scoring for intraday price/volume evidence."""

from __future__ import annotations

from datetime import datetime, timezone
from math import isfinite
from typing import Mapping


SCORE_VERSION = "intraday-opportunity-score-v1"
MAX_EVIDENCE_SKEW_SECONDS = 60


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    result = float(value)
    return result if isfinite(result) else None


def _instant(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else None


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _component(identifier: str, label: str, points: float, maximum: float,
               actual: object, explanation: str) -> dict[str, object]:
    return {
        "id": identifier, "label": label, "points": round(points, 2),
        "maximumPoints": maximum, "actual": actual, "explanation": explanation,
    }


def score_intraday_opportunity(
    gate_evaluation: Mapping[str, object], price_signals: Mapping[str, object],
) -> dict[str, object]:
    """Score a long-direction setup only after every upstream hard gate passes."""
    gate_symbol = gate_evaluation.get("symbol")
    signal_symbol = price_signals.get("symbol")
    gate_at = _instant(gate_evaluation.get("observedAt"))
    signal_at = _instant(price_signals.get("observedAt"))
    failures: list[str] = []
    if gate_evaluation.get("status") != "COMPLETE" or gate_evaluation.get("eligible") is not True:
        failures.append("intraday_hard_gates_not_passed")
    if price_signals.get("status") != "COMPLETE":
        failures.append("price_signals_incomplete")
    if not isinstance(gate_symbol, str) or gate_symbol != signal_symbol:
        failures.append("evidence_symbol_mismatch")
    if gate_at is None or signal_at is None:
        failures.append("evidence_timestamp_invalid")
    elif abs((gate_at - signal_at).total_seconds()) > MAX_EVIDENCE_SKEW_SECONDS:
        failures.append("evidence_timestamp_mismatch")
    if gate_evaluation.get("volumeScope") not in {"single_venue", "consolidated"}:
        failures.append("volume_provenance_missing")
    if not isinstance(gate_evaluation.get("dataSource"), str) or not str(gate_evaluation["dataSource"]).strip():
        failures.append("gate_data_source_missing")
    if not isinstance(price_signals.get("dataSource"), str) or not str(price_signals["dataSource"]).strip():
        failures.append("price_data_source_missing")

    gate_metrics = gate_evaluation.get("metrics")
    price_metrics = price_signals.get("metrics")
    required_gate = ("relativeVolume",)
    required_price = (
        "return5MinutePercent", "return15MinutePercent", "return60MinutePercent",
        "fiveMinuteAccelerationPoints", "priceVsVwapPercent", "rangeExpansionRatio",
        "pullbackFromSessionHighPercent", "recent15MinuteCloseLocationPercent",
        "recent15MinutePositiveBarSharePercent",
    )
    values: dict[str, float] = {}
    if isinstance(gate_metrics, Mapping):
        for key in required_gate:
            value = _number(gate_metrics.get(key))
            if value is None:
                failures.append(f"metric_missing:{key}")
            else:
                values[key] = value
    else:
        failures.append("gate_metrics_missing")
    if isinstance(price_metrics, Mapping):
        for key in required_price:
            value = _number(price_metrics.get(key))
            if value is None:
                failures.append(f"metric_missing:{key}")
            else:
                values[key] = value
    else:
        failures.append("price_metrics_missing")
    base = {
        "scoreVersion": SCORE_VERSION, "symbol": str(gate_symbol or ""),
        "observedAt": price_signals.get("observedAt"), "direction": "LONG",
        "classification": "research_only", "recommendationAllowed": False,
        "orderSubmissionAllowed": False,
    }
    if failures:
        return {**base, "status": "BLOCKED", "score": None, "band": None,
                "failedEvidence": sorted(set(failures)), "components": [], "rationale": []}

    relative_volume = values["relativeVolume"]
    volume_points = _clamp((relative_volume - 1.0) / 2.0) * 25

    return_5, return_15, return_60 = (values["return5MinutePercent"],
                                      values["return15MinutePercent"],
                                      values["return60MinutePercent"])
    momentum_strength = (
        _clamp(return_5 / 0.75) * 0.35
        + _clamp(return_15 / 1.5) * 0.35
        + _clamp(return_60 / 3.0) * 0.30
    )
    momentum_points = momentum_strength * 25

    acceleration = values["fiveMinuteAccelerationPoints"]
    acceleration_points = _clamp(acceleration / 0.75) * 10

    vwap_distance = values["priceVsVwapPercent"]
    if vwap_distance <= 0:
        vwap_points = 0.0
    elif vwap_distance <= 1:
        vwap_points = vwap_distance * 10
    elif vwap_distance <= 3:
        vwap_points = 10.0
    elif vwap_distance < 5:
        vwap_points = (5 - vwap_distance) / 2 * 10
    else:
        vwap_points = 0.0

    range_ratio = values["rangeExpansionRatio"]
    range_points = _clamp((range_ratio - 0.75) / 0.75) * 15

    close_location = values["recent15MinuteCloseLocationPercent"]
    positive_share = values["recent15MinutePositiveBarSharePercent"]
    pullback = values["pullbackFromSessionHighPercent"]
    location_points = _clamp((close_location - 30) / 60) * 8
    positive_points = _clamp((positive_share - 40) / 30) * 4
    pullback_points = 3 * (1 - _clamp((pullback - 0.5) / 2.5))
    path_points = location_points + positive_points + pullback_points

    components = [
        _component("relative_volume", "Relative volume", volume_points, 25,
                   round(relative_volume, 2),
                   f"Cumulative volume is {relative_volume:.2f}× its time-matched baseline."),
        _component("momentum", "Multi-horizon momentum", momentum_points, 25,
                   {"5m": return_5, "15m": return_15, "60m": return_60},
                   f"Returns are {return_5:.2f}% over 5m, {return_15:.2f}% over 15m and {return_60:.2f}% over 60m."),
        _component("acceleration", "Momentum acceleration", acceleration_points, 10,
                   round(acceleration, 4),
                   f"The latest five-minute return changed by {acceleration:.2f} percentage points versus the prior five minutes."),
        _component("vwap_position", "VWAP position", vwap_points, 10,
                   round(vwap_distance, 4),
                   f"Price is {vwap_distance:.2f}% relative to session VWAP; extreme extension is not rewarded."),
        _component("range_expansion", "Range expansion", range_points, 15,
                   round(range_ratio, 4),
                   f"The session range is {range_ratio:.2f}× its time-matched baseline."),
        _component("path_quality", "Recent path quality", path_points, 15,
                   {"closeLocation": close_location, "positiveBarShare": positive_share,
                    "pullbackFromHigh": pullback},
                   f"Recent close location is {close_location:.0f}%, positive-bar share is {positive_share:.0f}% and pullback from the high is {pullback:.2f}%."),
    ]
    score = round(sum(float(component["points"]) for component in components), 1)
    band = "STRONG_SHADOW" if score >= 75 else "DEVELOPING_SHADOW" if score >= 60 else "WEAK_SHADOW"
    ranked = sorted(components, key=lambda item: float(item["points"]), reverse=True)
    rationale = [f"{item['label']}: {item['explanation']} ({item['points']}/{item['maximumPoints']} points)"
                 for item in ranked]
    return {
        **base, "status": "COMPLETE", "score": score, "maximumScore": 100,
        "band": band, "components": components, "rationale": rationale,
        "thresholds": {"developing": 60, "strong": 75},
        "limitations": [
            "Uncalibrated research weights; score is not evidence of expected profit.",
            "Long-direction price/volume score only; costs and portfolio sizing are excluded.",
            "No component can override an upstream freshness, halt, spread or liquidity failure.",
        ],
    }
