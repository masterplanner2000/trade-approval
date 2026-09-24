import json
import tempfile
import unittest
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from intraday_volume_profile_job import fetch_minute_bars, refresh_profiles


NEW_YORK = ZoneInfo("America/New_York")


def history():
    bars, day, sessions = [], date(2026, 7, 1), 0
    while sessions < 20:
        if day.weekday() < 5:
            start = datetime.combine(day, time(9, 30), NEW_YORK)
            bars.extend({"t": (start + timedelta(minutes=minute)).isoformat(), "v": 100}
                        for minute in range(390))
            sessions += 1
        day += timedelta(days=1)
    return bars


class IntradayVolumeProfileJobTests(unittest.TestCase):
    def test_fetch_paginates_and_preserves_requested_contract(self):
        calls = []
        def reader(url, params):
            calls.append((url, dict(params)))
            return ({"bars": {"TEST": [{"t": "2026-01-01T14:30:00Z", "v": 1}]},
                     "next_page_token": "next"} if len(calls) == 1 else
                    {"bars": {"TEST": [{"t": "2026-01-01T14:31:00Z", "v": 2}]},
                     "next_page_token": None})
        bars = fetch_minute_bars(
            "TEST", start="start", end="end", feed="iex", reader=reader,
        )
        self.assertEqual(len(bars), 2)
        self.assertEqual(calls[0][1]["timeframe"], "1Min")
        self.assertEqual(calls[1][1]["page_token"], "next")

    def test_refresh_writes_atomic_research_artifact_and_keeps_failures_visible(self):
        def reader(url, params):
            symbol = params["symbols"]
            return {"bars": {symbol: history() if symbol == "GOOD" else []},
                    "next_page_token": None}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "profiles.json"
            result = refresh_profiles(
                ["GOOD", "BAD"], now=datetime(2026, 9, 24, 15, 30, tzinfo=timezone.utc),
                output_path=path, reader=reader, feed="iex",
            )
            stored = json.loads(path.read_text())
        self.assertEqual(set(result["profiles"]), {"GOOD"})
        self.assertEqual(result["failures"]["BAD"], "intraday_volume_profile_incomplete")
        self.assertEqual(stored["volumeScope"], "single_venue")
        self.assertFalse(stored["orderSubmissionAllowed"])


if __name__ == "__main__":
    unittest.main()
