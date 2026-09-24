import unittest
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from intraday_price_signals import (
    build_intraday_range_profile, calculate_intraday_price_signals, expected_range_at,
)


NEW_YORK = ZoneInfo("America/New_York")


def days(count):
    output, current = [], date(2026, 7, 1)
    while len(output) < count:
        if current.weekday() < 5:
            output.append(current)
        current += timedelta(days=1)
    return output


def historical_bars(count=20):
    output = []
    for session_index, day in enumerate(days(count)):
        start = datetime.combine(day, time(9, 30), NEW_YORK)
        base = 100 + session_index
        for minute in range(390):
            opened = base + minute * 0.01
            output.append({
                "t": (start + timedelta(minutes=minute)).isoformat(),
                "o": opened, "h": opened + 0.2, "l": opened - 0.1,
                "c": opened + 0.05, "v": 1_000,
            })
    return output


def current_bars(day=date(2026, 9, 24), through=90):
    start = datetime.combine(day, time(9, 30), NEW_YORK)
    output = []
    for minute in range(through + 1):
        opened = 100 + minute * 0.1
        output.append({
            "t": (start + timedelta(minutes=minute)).isoformat(),
            "o": opened, "h": opened + 0.12, "l": opened - 0.05,
            "c": opened + 0.1, "v": 1_000 + minute,
        })
    return output


class IntradayPriceSignalTests(unittest.TestCase):
    def test_builds_point_in_time_expected_range_curve(self):
        profile = build_intraday_range_profile(
            "TEST", historical_bars(), as_of="2026-09-24T15:30:00Z",
            data_source="Alpaca IEX historical 1Min bars",
        )
        self.assertEqual(profile["priceProfileSessionCount"], 20)
        self.assertEqual(len(profile["expectedRangePercentByMinute"]), 390)
        self.assertGreater(profile["expectedRangePercentByMinute"][90],
                           profile["expectedRangePercentByMinute"][0])
        self.assertEqual(len(profile["priceProfileInputDigest"]), 64)
        self.assertEqual(
            expected_range_at(profile, observed_at="2026-09-24T15:00:00Z"),
            profile["expectedRangePercentByMinute"][90],
        )

    def test_calculates_momentum_acceleration_vwap_and_range_expansion(self):
        bars = current_bars()
        result = calculate_intraday_price_signals(
            "TEST", bars, observed_at="2026-09-24T15:00:30Z",
            current_price=109.1, expected_range_percent=1.5,
            data_source="Alpaca IEX current-session 1Min bars",
        )
        metrics = result["metrics"]
        self.assertGreater(metrics["return5MinutePercent"], 0)
        self.assertGreater(metrics["return15MinutePercent"], metrics["return5MinutePercent"])
        self.assertGreater(metrics["return60MinutePercent"], metrics["return15MinutePercent"])
        self.assertGreater(metrics["priceVsVwapPercent"], 0)
        self.assertGreater(metrics["rangeExpansionRatio"], 1)
        self.assertLess(metrics["pullbackFromSessionHighPercent"], 1)
        self.assertFalse(result["recommendationAllowed"])
        self.assertFalse(result["orderSubmissionAllowed"])

    def test_stale_sparse_future_and_cross_session_data_fail_closed(self):
        base = current_bars()
        cases = [
            ([bar for index, bar in enumerate(base) if index != 85],
             "2026-09-24T15:00:30Z", "intraday_price_signal_history_incomplete"),
            (base, "2026-09-24T15:03:30Z", "intraday_price_signal_stale"),
            ([*base, {**base[-1], "t": "2026-09-24T15:01:00Z"}],
             "2026-09-24T15:00:30Z", "intraday_price_signal_future_bar"),
            ([*base, {**base[-1], "t": "2026-09-23T15:00:00Z"}],
             "2026-09-24T15:00:30Z", "intraday_price_signal_session_mismatch"),
        ]
        for bars, observed, error in cases:
            with self.subTest(error=error), self.assertRaisesRegex(ValueError, error):
                calculate_intraday_price_signals(
                    "TEST", bars, observed_at=observed, current_price=109.1,
                    expected_range_percent=1.5, data_source="recorded bars",
                )

    def test_profile_excludes_current_day_and_rejects_incomplete_history(self):
        current = historical_bars()
        current.extend({**bar, "t": bar["t"].replace("2026-07-01", "2026-09-24")}
                       for bar in historical_bars(1))
        profile = build_intraday_range_profile(
            "TEST", current, as_of="2026-09-24T15:30:00Z", data_source="bars",
        )
        self.assertNotIn("2026-09-24", profile["priceProfileSessionDates"])
        with self.assertRaisesRegex(ValueError, "intraday_price_profile_incomplete"):
            build_intraday_range_profile(
                "TEST", historical_bars(19), as_of="2026-09-24T15:30:00Z", data_source="bars",
            )


if __name__ == "__main__":
    unittest.main()
