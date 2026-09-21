from __future__ import annotations

import unittest
from datetime import date, timedelta

from ibkr_daily_scanner import DailyBar
from shadow_strategy_comparison import compare_daily_lanes


def history(multiplier: float = 1.0, count: int = 280) -> list[DailyBar]:
    bars = []
    price = 20.0
    start = date(2025, 1, 1)
    for index in range(count):
        # Controlled rising history with alternating ranges and a late volume expansion.
        price *= 1.012 if index % 5 < 3 else .992
        volume = 5_000_000 * (2 if index % 5 == 0 else 1)
        day = (start + timedelta(days=index)).strftime("%Y%m%d")
        bars.append(DailyBar(day, price * .995, price * 1.02, price * .98, price, volume * multiplier))
    return bars


class ShadowStrategyComparisonTests(unittest.TestCase):
    def test_comparison_is_research_only_and_uses_next_session_entry(self) -> None:
        bars = history()
        signal_dates = [bars[255].date, bars[260].date, bars[265].date]
        result = compare_daily_lanes(
            {"TEST": bars}, history(2), signal_dates=signal_dates,
            generated_at="2026-09-21T12:00:00Z", calibration_end="2025-09-14",
            horizons=(1, 5), round_trip_cost_bps=10,
        )
        self.assertFalse(result["recommendationAuthority"])
        self.assertFalse(result["orderSubmissionAllowed"])
        self.assertFalse(result["promotionEvidenceAllowed"])
        self.assertEqual(result["sessions"][0]["split"], "CALIBRATION")
        self.assertIn("The present-day universe creates survivorship", result["limitations"][-1])

    def test_future_bars_cannot_change_an_earlier_selection(self) -> None:
        bars = history()
        signal = bars[255].date
        first = compare_daily_lanes(
            {"TEST": bars[:260]}, history(2, 260), signal_dates=[signal],
            generated_at="2026-09-21T12:00:00Z", calibration_end="2025-01-01", horizons=(1,),
        )
        changed = history()
        changed[-1] = DailyBar(changed[-1].date, 1, 2, 1, 1, 1)
        second = compare_daily_lanes(
            {"TEST": changed}, history(2), signal_dates=[signal],
            generated_at="2026-09-21T12:00:00Z", calibration_end="2025-01-01", horizons=(1,),
        )
        self.assertEqual(first["sessions"][0]["selected"], second["sessions"][0]["selected"])

    def test_missing_forward_outcome_remains_missing(self) -> None:
        bars = history(count=260)
        result = compare_daily_lanes(
            {"TEST": bars}, history(2, 260), signal_dates=[bars[-1].date],
            generated_at="2026-09-21T12:00:00Z", calibration_end="2025-01-01", horizons=(5,),
        )
        self.assertIsNone(result["sessions"][0]["outcomesNetBps"]["shadow"]["5"])
        self.assertEqual(result["metrics"]["5"]["missingForwardSessions"], 1)

    def test_signal_dates_must_be_ordered_and_historical(self) -> None:
        bars = history()
        with self.assertRaisesRegex(ValueError, "comparison_signal_dates_invalid"):
            compare_daily_lanes({"TEST": bars}, history(2), signal_dates=[bars[260].date, bars[250].date],
                                generated_at="2026-09-21T12:00:00Z", calibration_end="2025-01-01")


if __name__ == "__main__":
    unittest.main()
