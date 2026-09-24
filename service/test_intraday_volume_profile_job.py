import json
import tempfile
import unittest
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from intraday_volume_profile_job import (
    fetch_minute_bars, load_profile_artifact, refresh_existing_profiles, refresh_profiles,
)


NEW_YORK = ZoneInfo("America/New_York")


def history():
    bars, day, sessions = [], date(2026, 7, 1), 0
    while sessions < 20:
        if day.weekday() < 5:
            start = datetime.combine(day, time(9, 30), NEW_YORK)
            bars.extend({
                "t": (start + timedelta(minutes=minute)).isoformat(),
                "o": 100 + minute * 0.01, "h": 100.2 + minute * 0.01,
                "l": 99.9 + minute * 0.01, "c": 100.05 + minute * 0.01, "v": 100,
            } for minute in range(390))
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
        self.assertEqual(len(stored["profiles"]["GOOD"]["expectedRangePercentByMinute"]), 390)
        self.assertFalse(stored["orderSubmissionAllowed"])

    def test_scheduled_refresh_rebuilds_exact_frozen_set_and_preserves_feed(self):
        def reader(url, params):
            return {"bars": {params["symbols"]: history()}, "next_page_token": None}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "profiles.json"
            refresh_profiles(["ONE", "TWO"], now=datetime(2026, 9, 23, 12, tzinfo=timezone.utc),
                             output_path=path, reader=reader, feed="iex")
            result = refresh_existing_profiles(
                now=datetime(2026, 9, 24, 12, tzinfo=timezone.utc),
                output_path=path, reader=reader,
            )
            stored = load_profile_artifact(path)
        self.assertEqual(set(stored["profiles"]), {"ONE", "TWO"})
        self.assertEqual(stored["feed"], "iex")
        self.assertEqual(result["refreshPolicy"], "complete_frozen_symbol_set_atomic_replace_v1")
        self.assertEqual(set(result["currentSessionThrough"]), {"ONE", "TWO"})

    def test_partial_scheduled_refresh_keeps_previous_artifact_byte_exact(self):
        def initial_reader(url, params):
            return {"bars": {params["symbols"]: history()}, "next_page_token": None}
        def failing_reader(url, params):
            symbol = params["symbols"]
            return {"bars": {symbol: history() if symbol == "GOOD" else []},
                    "next_page_token": None}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "profiles.json"
            refresh_profiles(["GOOD", "BAD"], now=datetime(2026, 9, 23, 12, tzinfo=timezone.utc),
                             output_path=path, reader=initial_reader, feed="iex")
            original = path.read_bytes()
            with self.assertRaisesRegex(RuntimeError, "intraday_profile_refresh_incomplete"):
                refresh_existing_profiles(
                    now=datetime(2026, 9, 24, 12, tzinfo=timezone.utc),
                    output_path=path, reader=failing_reader,
                )
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(list(Path(directory).glob("*.candidate")), [])

    def test_scheduled_refresh_refuses_session_regression(self):
        def reader(url, params):
            return {"bars": {params["symbols"]: history()}, "next_page_token": None}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "profiles.json"
            refresh_profiles(["TEST"], now=datetime(2026, 9, 23, 12, tzinfo=timezone.utc),
                             output_path=path, reader=reader, feed="iex")
            payload = json.loads(path.read_text())
            payload["profiles"]["TEST"]["sessionDates"][-1] = "2026-09-22"
            payload["profiles"]["TEST"]["priceProfileSessionDates"][-1] = "2026-09-22"
            path.write_text(json.dumps(payload))
            original = path.read_bytes()
            with self.assertRaisesRegex(RuntimeError, "intraday_profile_refresh_regression"):
                refresh_existing_profiles(
                    now=datetime(2026, 9, 24, 12, tzinfo=timezone.utc),
                    output_path=path, reader=reader,
                )
            self.assertEqual(path.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
