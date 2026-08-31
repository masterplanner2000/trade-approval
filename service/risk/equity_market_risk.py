"""Pure equity market-risk components. No broker, network, or order side effects."""

from __future__ import annotations

import math
import statistics
from typing import Protocol, Sequence


MODEL_VERSION = "equity-observed-market-risk-v1"


class BarLike(Protocol):
    open: float
    high: float
    low: float
    close: float
    volume: float


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def scale_high_is_risky(value: float, low_risk: float, high_risk: float, points: float) -> float:
    if high_risk <= low_risk:
        raise ValueError("high_risk must exceed low_risk")
    ratio = (value - low_risk) / (high_risk - low_risk)
    return round(clamp(ratio, 0.0, 1.0) * points, 2)


def scale_low_is_risky(value: float, high_risk: float, low_risk: float, points: float) -> float:
    if low_risk <= high_risk:
        raise ValueError("low_risk must exceed high_risk")
    ratio = (low_risk - value) / (low_risk - high_risk)
    return round(clamp(ratio, 0.0, 1.0) * points, 2)


def percentile(values: Sequence[float], probability: float) -> float:
    if not values:
        raise ValueError("values must not be empty")
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def annualized_volatility_percent(bars: Sequence[BarLike], window: int = 20) -> float:
    closes = [bar.close for bar in bars]
    returns = [math.log(closes[index] / closes[index - 1]) for index in range(1, len(closes)) if closes[index - 1] > 0 and closes[index] > 0]
    sample = returns[-window:]
    if len(sample) < 2:
        raise ValueError("insufficient returns")
    return statistics.stdev(sample) * math.sqrt(252) * 100


def atr_percent(bars: Sequence[BarLike], window: int = 14) -> float:
    if len(bars) <= window:
        raise ValueError("insufficient bars")
    true_ranges: list[float] = []
    for index in range(1, len(bars)):
        previous_close = bars[index - 1].close
        bar = bars[index]
        true_ranges.append(max(bar.high - bar.low, abs(bar.high - previous_close), abs(bar.low - previous_close)))
    average_true_range = sum(true_ranges[-window:]) / window
    return (average_true_range / bars[-1].close) * 100


def overnight_gap_statistics(bars: Sequence[BarLike], window: int = 60) -> tuple[float, float]:
    gaps = [
        abs((bars[index].open - bars[index - 1].close) / bars[index - 1].close) * 100
        for index in range(1, len(bars))
        if bars[index - 1].close > 0
    ][-window:]
    if not gaps:
        raise ValueError("insufficient gaps")
    return percentile(gaps, 0.95), max(gaps)


def average_dollar_volume(bars: Sequence[BarLike], window: int = 20) -> float:
    sample = bars[-window:]
    if len(sample) < window:
        raise ValueError("insufficient volume bars")
    return sum(bar.close * bar.volume for bar in sample) / window


def level(score: float) -> str:
    if score < 25:
        return "LOWER"
    if score < 50:
        return "MODERATE"
    if score < 75:
        return "HIGH"
    return "VERY_HIGH"


def calculate_equity_market_risk(bars: Sequence[BarLike]) -> dict[str, object]:
    """Return an observed-data risk score; thresholds are proposed test variables."""
    if len(bars) < 61:
        return {
            "modelVersion": MODEL_VERSION,
            "status": "INCOMPLETE",
            "score": None,
            "level": None,
            "missing": ["at_least_61_completed_daily_bars"],
            "components": [],
        }

    atr = atr_percent(bars)
    volatility = annualized_volatility_percent(bars)
    gap95, maximum_gap = overnight_gap_statistics(bars)
    adv20 = average_dollar_volume(bars)
    price = bars[-1].close

    volatility_score = scale_high_is_risky(atr, 1.0, 8.0, 20) + scale_high_is_risky(volatility, 15.0, 80.0, 20)
    gap_score = scale_high_is_risky(gap95, 1.0, 8.0, 20) + scale_high_is_risky(maximum_gap, 2.0, 15.0, 15)
    liquidity_score = scale_low_is_risky(adv20, 20_000_000.0, 1_000_000_000.0, 15) + scale_low_is_risky(price, 5.0, 100.0, 10)
    total = round(clamp(volatility_score + gap_score + liquidity_score, 0.0, 100.0), 1)

    components = [
        {
            "id": "volatility",
            "label": "Price volatility",
            "score": round(volatility_score, 1),
            "maximumPoints": 40,
            "status": "COMPLETE",
            "inputs": {"atrPercent14": round(atr, 2), "annualizedVolatilityPercent20": round(volatility, 2)},
            "explanation": f"ATR is {atr:.1f}% of price and 20-day annualized volatility is {volatility:.1f}%.",
        },
        {
            "id": "gaps",
            "label": "Overnight gaps",
            "score": round(gap_score, 1),
            "maximumPoints": 35,
            "status": "COMPLETE",
            "inputs": {"absoluteGap95thPercentile60": round(gap95, 2), "maximumAbsoluteGap60": round(maximum_gap, 2)},
            "explanation": f"The recent 95th-percentile absolute gap is {gap95:.1f}%; the largest is {maximum_gap:.1f}%.",
        },
        {
            "id": "historical_liquidity",
            "label": "Historical liquidity",
            "score": round(liquidity_score, 1),
            "maximumPoints": 25,
            "status": "COMPLETE",
            "inputs": {"averageDollarVolume20": round(adv20, 2), "referenceClose": round(price, 4)},
            "explanation": f"20-day average dollar volume is ${adv20:,.0f}. Current bid/ask spread is not included yet.",
        },
    ]
    return {
        "modelVersion": MODEL_VERSION,
        "classification": "PROPOSED_TEST_VARIABLES",
        "status": "COMPLETE",
        "score": total,
        "level": level(total),
        "components": components,
        "limitations": [
            "This is observed market-data risk, not probability of loss or success.",
            "It excludes current spread, earnings/events, position size, stop, portfolio concentration, and account loss limits.",
        ],
        "tradeRisk": {
            "status": "INCOMPLETE",
            "score": None,
            "missing": ["entry", "stop", "quantity", "portfolio", "current_spread", "event_data"],
        },
    }
