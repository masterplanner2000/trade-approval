import unittest
from datetime import date, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from zoneinfo import ZoneInfo

import aggressive_shadow_scanner as scanner
from aggressive_shadow_scanner import evaluate, selected_symbols
from ibkr_daily_scanner import DailyBar


def asset(symbol):
    return {"symbol": symbol, "name": f"{symbol} Inc", "exchange": "NASDAQ",
            "status": "active", "tradable": True, "class": "us_equity"}


class AggressiveShadowScannerTests(unittest.TestCase):
    def test_watchlist_extends_ranked_universe_without_admitting_ineligible_assets(self):
        assets = [asset("AAA"), asset("BE"), asset("OKLO"), asset("SPY")]
        assets[-1]["name"] = "SPY ETF"
        selected = selected_symbols(assets, {"AAA": 100, "BE": 10, "OKLO": 5, "SPY": 500}, ("BE", "OKLO", "SPY"), 1)
        self.assertEqual(selected, ["AAA", "BE", "OKLO"])

    def test_volatile_candidate_is_research_only(self):
        first = date(2026, 5, 1)
        bars = []
        price = 20.0
        for index in range(80):
            previous = price
            price *= 1.012 if index >= 60 else 1.002
            volume = 800_000 if index == 79 else 400_000
            bars.append(DailyBar((first + timedelta(days=index)).strftime("%Y%m%d"), previous, price * 1.04, price * 0.96, price, volume))
        result = evaluate("BE", bars, today="20260917")
        self.assertTrue(result["eligible"])
        self.assertFalse(result["orderSubmissionAllowed"])
        self.assertIn("verified_catalyst", result["missingBeforeProposal"])

    def test_current_incomplete_bar_cannot_trigger_signal(self):
        bars = [DailyBar((date(2026, 6, 1) + timedelta(days=index)).strftime("%Y%m%d"), 20, 21, 19, 20, 500_000) for index in range(59)]
        bars.append(DailyBar("20260917", 20, 40, 19, 40, 5_000_000))
        result = evaluate("BE", bars, today="20260917")
        self.assertFalse(result["eligible"])
        self.assertEqual(result["reason"], "insufficient_completed_daily_bars")

    def test_future_bar_cannot_change_historical_evaluation(self):
        first = date(2026, 5, 1)
        bars = []
        price = 20.0
        for index in range(80):
            previous = price
            price *= 1.012 if index >= 60 else 1.002
            volume = 800_000 if index == 79 else 400_000
            bars.append(DailyBar((first + timedelta(days=index)).strftime("%Y%m%d"), previous, price * 1.04, price * 0.96, price, volume))
        cutoff = (first + timedelta(days=80)).strftime("%Y%m%d")
        baseline = evaluate("TEST", bars, today=cutoff)
        future = DailyBar((first + timedelta(days=81)).strftime("%Y%m%d"), price, price * 2, price * 0.2, price * 0.25, 20_000_000)
        replay = evaluate("TEST", bars + [future], today=cutoff)
        self.assertEqual(baseline, replay)

    def test_refresh_excludes_partial_bar_from_selection_and_storage(self):
        now = datetime(2026, 9, 17, 10, 18, tzinfo=ZoneInfo("America/New_York"))
        assets = [asset("AAA")]
        old = {"t": "2026-09-16T04:00:00Z", "o": 10, "h": 11, "l": 9, "c": 10, "v": 100}
        partial = {"t": "2026-09-17T04:00:00Z", "o": 10, "h": 30, "l": 9, "c": 30, "v": 10_000}

        def fake_fetch(symbols, _start, _end):
            return {symbol: [old, partial] for symbol in symbols}

        with TemporaryDirectory() as directory, \
                patch.object(scanner, "DATABASE_PATH", Path(directory) / "cache.sqlite3"), \
                patch.object(scanner, "api_json", return_value=assets), \
                patch.object(scanner, "fetch_bars", side_effect=fake_fetch), \
                patch.object(scanner, "data_feed", return_value="iex"):
            report = scanner.refresh(now=now)
            with scanner.connect() as connection:
                days = [row[0] for row in connection.execute("SELECT trading_day FROM daily_bars")]
                selection_volume = connection.execute("SELECT selection_dollar_volume FROM assets").fetchone()[0]
        self.assertEqual(report["completedThrough"], "2026-09-16")
        self.assertEqual(days, ["20260916"])
        self.assertEqual(selection_volume, 1_000)


if __name__ == "__main__":
    unittest.main()
