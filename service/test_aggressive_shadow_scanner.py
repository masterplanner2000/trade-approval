import unittest
from datetime import date, timedelta

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


if __name__ == "__main__":
    unittest.main()
