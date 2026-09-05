from __future__ import annotations

import unittest

from alpaca_market_cache import batches, is_common_stock


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


if __name__ == "__main__":
    unittest.main()
