import unittest
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from intraday_volume_profile import (
    MAXIMUM_PROFILE_SESSIONS, MINIMUM_PROFILE_SESSIONS,
    build_cumulative_volume_profile, volume_context_at,
)


NEW_YORK = ZoneInfo("America/New_York")


def session_bars(day: date, *, volume: int = 100, missing: set[int] | None = None):
    start = datetime.combine(day, time(9, 30), NEW_YORK)
    return [
        {"t": (start + timedelta(minutes=minute)).isoformat(), "v": volume}
        for minute in range(390) if minute not in (missing or set())
    ]


def trading_days(start: date, count: int):
    result, current = [], start
    while len(result) < count:
        if current.weekday() < 5:
            result.append(current)
        current += timedelta(days=1)
    return result


class IntradayVolumeProfileTests(unittest.TestCase):
    def bars(self, count=20):
        return [bar for index, day in enumerate(trading_days(date(2026, 7, 1), count))
                for bar in session_bars(day, volume=100 + index * 10)]

    def test_builds_390_point_median_curve_from_prior_complete_sessions(self):
        profile = build_cumulative_volume_profile(
            "TEST", self.bars(), as_of="2026-09-24T15:30:00Z", data_source="Alpaca IEX 1Min bars",
        )
        self.assertEqual(profile["sessionCount"], MINIMUM_PROFILE_SESSIONS)
        self.assertEqual(len(profile["expectedCumulativeVolumeByMinute"]), 390)
        self.assertEqual(profile["expectedCumulativeVolumeByMinute"][0], 195.0)
        self.assertEqual(profile["expectedCumulativeVolumeByMinute"][60], 11_895.0)
        self.assertFalse(profile["recommendationAllowed"])
        self.assertFalse(profile["orderSubmissionAllowed"])

    def test_uses_only_latest_thirty_sessions_and_excludes_current_day(self):
        days = trading_days(date(2026, 7, 1), 36)
        bars = [bar for index, day in enumerate(days)
                for bar in session_bars(day, volume=100 + index)]
        current_day = date(2026, 9, 24)
        bars.extend(session_bars(current_day, volume=999_999))
        profile = build_cumulative_volume_profile(
            "TEST", bars, as_of="2026-09-24T15:30:00Z", data_source="recorded bars",
        )
        self.assertEqual(profile["sessionCount"], MAXIMUM_PROFILE_SESSIONS)
        self.assertNotIn(current_day.isoformat(), profile["sessionDates"])
        self.assertEqual(profile["expectedCumulativeVolumeByMinute"][0], 120.5)

    def test_incomplete_sessions_do_not_count_and_history_fails_closed(self):
        bars = self.bars(MINIMUM_PROFILE_SESSIONS - 1)
        incomplete_day = date(2026, 8, 3)
        bars.extend(session_bars(incomplete_day, missing=set(range(20, 40))))
        with self.assertRaisesRegex(ValueError, "intraday_volume_profile_incomplete"):
            build_cumulative_volume_profile(
                "TEST", bars, as_of="2026-09-24T15:30:00Z", data_source="recorded bars",
            )

    def test_duplicate_minute_and_invalid_bar_fail_closed(self):
        bars = self.bars()
        with self.assertRaisesRegex(ValueError, "intraday_profile_duplicate_minute"):
            build_cumulative_volume_profile(
                "TEST", [*bars, bars[0]], as_of="2026-09-24T15:30:00Z", data_source="bars",
            )
        with self.assertRaisesRegex(ValueError, "intraday_profile_bar_invalid"):
            build_cumulative_volume_profile(
                "TEST", [*bars, {"t": "bad", "v": 1}],
                as_of="2026-09-24T15:30:00Z", data_source="bars",
            )

    def test_context_uses_the_exact_market_minute(self):
        profile = build_cumulative_volume_profile(
            "TEST", self.bars(), as_of="2026-09-24T15:30:00Z", data_source="IEX profile",
        )
        context = volume_context_at(
            profile, observed_at="2026-09-24T15:30:00Z", halted=False,
            halt_data_source="approved halt feed",
        )
        # 15:30 UTC is 11:30 ET: 121 cumulative minute buckets including 9:30.
        self.assertEqual(context["expectedCumulativeVolume"], 23_595.0)
        self.assertEqual(context["profileSessionCount"], 20)
        self.assertIn("approved halt feed", context["dataSource"])


if __name__ == "__main__":
    unittest.main()
