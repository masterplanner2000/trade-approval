import unittest

from intraday_portfolio_context import IbkrPaperPortfolioReader, build_portfolio_context


OBSERVED = "2026-09-24T15:00:32Z"
LIMITS = {
    "sleeveValue": 10_000, "maxOpenPositions": 5,
    "maxSymbolExposurePercent": 10, "maxSectorExposurePercent": 25,
    "maxDailyLossPercent": 2, "perTradeLimit": 1_500,
}
SECTORS = {"version": "test-sectors-v1", "entries": {
    "NVDA": {"sector": "technology"}, "MRK": {"sector": "health_care"},
    "MSFT": {"sector": "technology"}, "TEST": {"sector": "test"},
}}


def snapshot():
    return {
        "ok": True, "complete": True, "environment": "paper", "readOnly": True,
        "account": "DUR…217", "capturedAt": 1790262031000,
        "summary": {
            "BuyingPower": {"value": 20_000}, "AvailableFunds": {"value": 12_000},
        },
        "pnl": {"dailyPnl": -10, "realizedPnl": -20, "unrealizedPnl": 10},
        "positions": [
            {"symbol": "NVDA", "securityType": "STK", "quantity": 2, "averageCost": 220},
            {"symbol": "MRK", "securityType": "STK", "quantity": 3, "averageCost": 140},
        ],
    }


class IntradayPortfolioContextTests(unittest.TestCase):
    def test_complete_paper_snapshot_builds_reviewed_sector_context(self):
        result = build_portfolio_context(
            snapshot(), symbol="NVDA", observed_at=OBSERVED, market_price=225, limits=LIMITS,
            sector_registry=SECTORS,
        )
        self.assertEqual(result["status"], "COMPLETE")
        self.assertEqual(result["openPositionCount"], 2)
        self.assertTrue(result["addingToExistingPosition"])
        self.assertEqual(result["symbolExposurePercent"], 10)
        self.assertEqual(result["proposedNotional"], 550)
        self.assertEqual(result["dailyLossPercent"], 0.1)
        self.assertEqual(result["sectorExposurePercent"], 10)
        self.assertEqual(result["sectorExposureMethod"],
                         "explicit_source_reviewed_exposure_bucket")
        self.assertFalse(result["orderSubmissionAllowed"])

    def test_live_stale_or_incomplete_snapshot_fails_closed(self):
        value = snapshot()
        value.update({"environment": "live", "complete": False, "capturedAt": 1})
        result = build_portfolio_context(
            value, symbol="TEST", observed_at=OBSERVED, market_price=10, limits=LIMITS,
            sector_registry=SECTORS,
        )
        self.assertEqual(result["status"], "INCOMPLETE")
        self.assertIsNone(result["observedAt"])
        self.assertIn("complete_snapshot", result["missing"])
        self.assertIn("paper_environment", result["missing"])
        self.assertIn("fresh_snapshot", result["missing"])

    def test_reader_fetches_broker_only_once_for_multiple_symbols(self):
        calls = []
        reader = IbkrPaperPortfolioReader(
            snapshot_reader=lambda: calls.append(True) or snapshot(), limits=LIMITS,
            sector_registry=SECTORS,
        )
        first = reader.context("NVDA", OBSERVED, {"last": 225})
        second = reader.context("MSFT", OBSERVED, {"last": 500})
        self.assertEqual(len(calls), 1)
        self.assertEqual(first["status"], "COMPLETE")
        self.assertEqual(second["status"], "COMPLETE")

    def test_reader_sanitizes_connection_failure(self):
        def unavailable():
            raise OSError("secret raw connection detail")
        reader = IbkrPaperPortfolioReader(snapshot_reader=unavailable, limits=LIMITS,
                                          sector_registry=SECTORS)
        result = reader.context("NVDA", OBSERVED, {"last": 225})
        self.assertEqual(result["status"], "INCOMPLETE")
        self.assertNotIn("secret", str(result))
        self.assertFalse(result["orderSubmissionAllowed"])

    def test_duplicate_broker_rows_are_aggregated_by_symbol(self):
        value = snapshot()
        value["positions"].append(
            {"symbol": "NVDA", "securityType": "STK", "quantity": 1, "averageCost": 220})
        result = build_portfolio_context(
            value, symbol="NVDA", observed_at=OBSERVED, market_price=225, limits=LIMITS,
            sector_registry=SECTORS,
        )
        self.assertEqual(result["openPositionCount"], 2)
        self.assertEqual(result["symbolExposurePercent"], 10)

    def test_unknown_sector_fails_closed(self):
        value = snapshot()
        value["positions"].append(
            {"symbol": "UNKNOWN", "securityType": "STK", "quantity": 1, "averageCost": 10})
        result = build_portfolio_context(
            value, symbol="NVDA", observed_at=OBSERVED, market_price=225, limits=LIMITS,
            sector_registry=SECTORS,
        )
        self.assertEqual(result["status"], "INCOMPLETE")
        self.assertEqual(result["unclassifiedSymbols"], ["UNKNOWN"])


if __name__ == "__main__":
    unittest.main()
