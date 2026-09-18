from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import alpaca_market_cache as cache
from alpaca_market_cache import batches, is_common_stock
from test_momentum_scanner import momentum_bars


class AlpacaMarketCacheTests(unittest.TestCase):
    def test_accepts_active_tradable_us_common_stock(self) -> None:
        self.assertTrue(is_common_stock({
            "symbol": "TEST",
            "name": "Test Corporation Common Stock",
            "class": "us_equity",
            "exchange": "NASDAQ",
            "status": "active",
            "tradable": True,
        }))

    def test_rejects_otc_and_non_common_instruments(self) -> None:
        base = {"symbol": "TEST", "class": "us_equity", "status": "active", "tradable": True}
        self.assertFalse(is_common_stock({**base, "name": "Test Corp", "exchange": "OTC"}))
        self.assertFalse(is_common_stock({**base, "name": "Test Growth ETF", "exchange": "NASDAQ"}))
        self.assertFalse(is_common_stock({**base, "name": "Test Acquisition Corp Unit", "exchange": "NYSE"}))

    def test_batches_do_not_drop_symbols(self) -> None:
        symbols = [f"S{index}" for index in range(11)]
        self.assertEqual([item for group in batches(symbols, 4) for item in group], symbols)

    def test_scan_keeps_failed_evaluations_for_held_position_review(self) -> None:
        with TemporaryDirectory() as directory, patch.object(cache, "DATABASE_PATH", Path(directory) / "cache.sqlite3"):
            with cache.connect() as connection:
                connection.execute("INSERT INTO cache_meta(key,value) VALUES('data_feed','iex')")
                for rank, (symbol, declining) in enumerate((("PASS", False), ("FAIL", True)), start=1):
                    connection.execute(
                        "INSERT INTO assets VALUES(?,?,?,?,?,?,?)",
                        (symbol, symbol, "NASDAQ", 1, rank, 100_000_000, 1),
                    )
                    connection.executemany(
                        "INSERT INTO daily_bars VALUES(?,?,?,?,?,?,?)",
                        [(symbol, bar.date, bar.open, bar.high, bar.low, bar.close, bar.volume)
                         for bar in momentum_bars(declining=declining)],
                    )
            report = cache.scan()
        by_symbol = {item["symbol"]: item for item in report["evaluations"]}
        self.assertEqual(report["qualifiedCount"], 1)
        self.assertEqual(report["evaluatedCount"], 2)
        self.assertEqual(report["selected"]["symbol"], "PASS")
        self.assertTrue(by_symbol["PASS"]["eligible"])
        self.assertFalse(by_symbol["FAIL"]["eligible"])
        self.assertTrue(any(not check["passed"] for check in by_symbol["FAIL"]["checks"]))


if __name__ == "__main__":
    unittest.main()
