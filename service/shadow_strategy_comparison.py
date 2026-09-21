"""Matched daily comparison of the baseline and volatile-growth research lanes.

The comparison uses only bars available through each signal date, enters at the
next session's open, and keeps incomplete outcomes visible. A run made from a
present-day universe is a retrospective diagnostic, not promotion evidence.
"""

from __future__ import annotations

import hashlib
import json
import math
import sqlite3
import statistics
from collections.abc import Mapping, Sequence
from datetime import date
from typing import Any
from pathlib import Path

from aggressive_shadow_scanner import RULESET_VERSION as SHADOW_RULESET, evaluate as evaluate_shadow
from ibkr_daily_scanner import DailyBar, RULESET_VERSION as BASELINE_RULESET, evaluate as evaluate_baseline


ANALYSIS_VERSION = "daily-shadow-comparison-v1"
DEFAULT_HORIZONS = (1, 5, 10)


def _canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _finite(value: object) -> bool:
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(float(value))


def _summary(values: Sequence[float]) -> dict[str, float | int | None]:
    if not values:
        return {"count": 0, "meanBps": None, "medianBps": None, "winRate": None,
                "lower95Bps": None, "upper95Bps": None}
    mean = statistics.fmean(values)
    margin = 1.96 * statistics.stdev(values) / math.sqrt(len(values)) if len(values) > 1 else None
    return {
        "count": len(values), "meanBps": round(mean, 6),
        "medianBps": round(statistics.median(values), 6),
        "winRate": round(sum(value > 0 for value in values) / len(values), 6),
        "lower95Bps": round(mean - margin, 6) if margin is not None else None,
        "upper95Bps": round(mean + margin, 6) if margin is not None else None,
    }


def _validate_bars(bars_by_symbol: Mapping[str, Sequence[DailyBar]]) -> None:
    for symbol, bars in bars_by_symbol.items():
        if not symbol or symbol != symbol.upper() or not bars:
            raise ValueError("comparison_symbol_history_invalid")
        dates = [bar.date for bar in bars]
        if dates != sorted(set(dates)):
            raise ValueError("comparison_bar_order_invalid")
        for bar in bars:
            prices = (bar.open, bar.high, bar.low, bar.close)
            if (len(bar.date) != 8 or not all(_finite(value) and float(value) > 0 for value in prices)
                    or not _finite(bar.volume) or float(bar.volume) < 0):
                raise ValueError("comparison_bar_invalid")


def _outcome(bars: Sequence[DailyBar], signal_date: str, horizon: int, cost_bps: float) -> float | None:
    index = next((i for i, bar in enumerate(bars) if bar.date == signal_date), None)
    if index is None or index + horizon >= len(bars):
        return None
    entry = bars[index + 1].open
    exit_price = bars[index + horizon].close
    return ((exit_price / entry) - 1) * 10_000 - cost_bps


def _drawdown(values: Sequence[float]) -> float | None:
    if not values:
        return None
    wealth, peak, maximum = 1.0, 1.0, 0.0
    for value in values:
        wealth *= 1 + value / 10_000
        peak = max(peak, wealth)
        maximum = max(maximum, (peak - wealth) / peak * 10_000)
    return round(maximum, 6)


def compare_daily_lanes(
    bars_by_symbol: Mapping[str, Sequence[DailyBar]], benchmark_bars: Sequence[DailyBar], *,
    signal_dates: Sequence[str], generated_at: str, calibration_end: str,
    top_k: int = 5, horizons: Sequence[int] = DEFAULT_HORIZONS, round_trip_cost_bps: float = 20,
    universe_provenance: str = "current_universe_retrospective",
    baseline_symbols: Sequence[str] | None = None, shadow_symbols: Sequence[str] | None = None,
    benchmark_symbol: str = "SPY",
) -> dict[str, object]:
    """Compare equal-weight top-k lane portfolios on identical signal dates."""
    _validate_bars(bars_by_symbol)
    _validate_bars({"BENCHMARK": benchmark_bars})
    try:
        generated_day = date.fromisoformat(generated_at[:10])
        split_day = date.fromisoformat(calibration_end)
    except (TypeError, ValueError):
        raise ValueError("comparison_date_invalid") from None
    dates = list(signal_dates)
    if not dates or dates != sorted(set(dates)) or any(len(item) != 8 for item in dates):
        raise ValueError("comparison_signal_dates_invalid")
    if top_k < 1 or not horizons or any(not isinstance(item, int) or item < 1 for item in horizons):
        raise ValueError("comparison_configuration_invalid")
    if not _finite(round_trip_cost_bps) or not 0 <= round_trip_cost_bps <= 500:
        raise ValueError("comparison_cost_invalid")
    if universe_provenance not in {"current_universe_retrospective", "point_in_time_universe"}:
        raise ValueError("comparison_universe_provenance_invalid")
    if not benchmark_symbol or benchmark_symbol != benchmark_symbol.upper():
        raise ValueError("comparison_benchmark_symbol_invalid")
    baseline_set = set(baseline_symbols or bars_by_symbol)
    shadow_set = set(shadow_symbols or bars_by_symbol)
    if not baseline_set <= set(bars_by_symbol) or not shadow_set <= set(bars_by_symbol):
        raise ValueError("comparison_universe_symbols_invalid")

    sessions: list[dict[str, Any]] = []
    for signal_date in dates:
        if date.fromisoformat(f"{signal_date[:4]}-{signal_date[4:6]}-{signal_date[6:]}") >= generated_day:
            raise ValueError("comparison_future_or_current_signal")
        selections: dict[str, list[dict[str, Any]]] = {"baseline": [], "shadow": []}
        for symbol, full_history in bars_by_symbol.items():
            available = [bar for bar in full_history if bar.date <= signal_date]
            baseline = evaluate_baseline(symbol, available, [])
            shadow = evaluate_shadow(symbol, available, today="99999999")
            if symbol in baseline_set and baseline.get("eligible") and baseline.get("signalDate") == signal_date:
                selections["baseline"].append({"symbol": symbol, "score": baseline["recommendationScore"]})
            if symbol in shadow_set and shadow.get("eligible") and shadow.get("signalDate") == signal_date:
                selections["shadow"].append({"symbol": symbol, "score": shadow["researchScore"]})
        selections["baseline"] = sorted(selections["baseline"], key=lambda row: (-row["score"], row["symbol"]))[:top_k]
        selections["shadow"] = sorted(selections["shadow"], key=lambda row: (-row["score"], row["symbol"]))[:top_k]
        outcomes: dict[str, dict[str, float | None]] = {"baseline": {}, "shadow": {}, "benchmark": {}}
        for horizon in horizons:
            for lane in ("baseline", "shadow"):
                values = [_outcome(bars_by_symbol[item["symbol"]], signal_date, horizon, float(round_trip_cost_bps))
                          for item in selections[lane]]
                complete = [value for value in values if value is not None]
                outcomes[lane][str(horizon)] = (round(statistics.fmean(complete), 6)
                                                 if complete and len(complete) == len(values) else None)
            benchmark = _outcome(benchmark_bars, signal_date, horizon, 0)
            outcomes["benchmark"][str(horizon)] = round(benchmark, 6) if benchmark is not None else None
        sessions.append({
            "signalDate": signal_date,
            "split": "CALIBRATION" if signal_date <= calibration_end.replace("-", "") else "FORWARD",
            "selected": selections, "outcomesNetBps": outcomes,
        })

    forward = [row for row in sessions if row["split"] == "FORWARD"]
    metrics: dict[str, object] = {}
    for horizon in horizons:
        key = str(horizon)
        baseline = [row["outcomesNetBps"]["baseline"][key] for row in forward
                    if row["outcomesNetBps"]["baseline"][key] is not None]
        shadow = [row["outcomesNetBps"]["shadow"][key] for row in forward
                  if row["outcomesNetBps"]["shadow"][key] is not None]
        paired = [row["outcomesNetBps"]["shadow"][key] - row["outcomesNetBps"]["baseline"][key]
                  for row in forward if row["outcomesNetBps"]["shadow"][key] is not None
                  and row["outcomesNetBps"]["baseline"][key] is not None]
        benchmark_excess = [row["outcomesNetBps"]["shadow"][key] - row["outcomesNetBps"]["benchmark"][key]
                            for row in forward if row["outcomesNetBps"]["shadow"][key] is not None
                            and row["outcomesNetBps"]["benchmark"][key] is not None]
        metrics[key] = {
            "baseline": _summary(baseline), "shadow": _summary(shadow),
            "shadowMinusBaseline": _summary(paired), "shadowMinusBenchmark": _summary(benchmark_excess),
            "baselineMaxDrawdownBps": _drawdown(baseline), "shadowMaxDrawdownBps": _drawdown(shadow),
            "missingForwardSessions": sum(row["outcomesNetBps"]["shadow"][key] is None
                                           or row["outcomesNetBps"]["baseline"][key] is None for row in forward),
        }

    clean_history = universe_provenance == "point_in_time_universe"
    report: dict[str, object] = {
        "analysisVersion": ANALYSIS_VERSION, "classification": "research_only",
        "generatedAt": generated_at, "baselineRuleset": BASELINE_RULESET,
        "shadowRuleset": SHADOW_RULESET, "calibrationEnd": split_day.isoformat(),
        "signalDateCount": len(dates), "forwardSessionCount": len(forward),
        "baselineUniverseSize": len(baseline_set), "shadowUniverseSize": len(shadow_set),
        "topK": top_k, "horizonsSessions": list(horizons), "roundTripCostBps": round_trip_cost_bps,
        "benchmarkSymbol": benchmark_symbol,
        "universeProvenance": universe_provenance, "promotionEvidenceAllowed": clean_history,
        "recommendationAuthority": False, "orderSubmissionAllowed": False,
        "metrics": metrics, "sessions": sessions,
        "limitations": [
            "Daily bars do not model intraday path, fills, market impact, halts or borrow constraints.",
            "Drawdown chains overlapping horizon observations and is a stress diagnostic, not a realized portfolio path.",
            "Headline catalysts are excluded unless an immutable as-known-at-the-time archive is supplied.",
            *( ["The present-day universe creates survivorship and selection bias; results are diagnostic only."]
               if not clean_history else []),
        ],
    }
    report["reportDigest"] = hashlib.sha256(_canonical(report).encode()).hexdigest()
    return report


def load_cache(path: Path) -> tuple[set[str], dict[str, list[DailyBar]]]:
    if not path.exists():
        raise ValueError("comparison_cache_missing")
    with sqlite3.connect(path) as connection:
        symbols = {row[0] for row in connection.execute("SELECT symbol FROM assets")}
        histories: dict[str, list[DailyBar]] = {symbol: [] for symbol in symbols}
        for symbol, day, open_price, high, low, close, volume in connection.execute(
            "SELECT symbol,trading_day,open,high,low,close,volume FROM daily_bars ORDER BY symbol,trading_day"
        ):
            if symbol in histories:
                histories[symbol].append(DailyBar(day, open_price, high, low, close, volume))
    return symbols, histories
