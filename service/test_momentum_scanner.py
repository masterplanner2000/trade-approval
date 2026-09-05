from __future__ import annotations

import unittest

from ibkr_daily_scanner import DailyBar, evaluate


def momentum_bars(
    count: int = 260,
    *,
    liquid: bool = True,
    declining: bool = False,
    starting_price: float = 100.0,
    daily_volume: float | None = None,
) -> list[DailyBar]:
    bars: list[DailyBar] = []
    close = starting_price
    for index in range(count):
        prior = close
        if declining:
            change = -0.002 if index % 3 else 0.0005
        else:
            change = 0.0035 if index % 3 else -0.003
        close = prior * (1 + change)
        spread = 0.013
        bars.append(DailyBar(
            date=f"2025{(index // 28) % 12 + 1:02d}{index % 28 + 1:02d}",
            open=prior,
            high=max(prior, close) * (1 + spread),
            low=min(prior, close) * (1 - spread),
            close=close,
            volume=daily_volume if daily_volume is not None else (2_000_000 if liquid else 10_000),
        ))
    return bars


class MomentumScannerTests(unittest.TestCase):
    def test_eligible_momentum_candidate_has_score_and_metrics(self) -> None:
        result = evaluate("TEST", momentum_bars(), [])
        self.assertTrue(result["eligible"])
        self.assertEqual(result["category"], "MOMENTUM_CONTINUATION")
        self.assertGreater(result["recommendationScore"], 0)
        self.assertGreater(result["sma50"], result["sma200"])
        self.assertTrue(all(check["passed"] for check in result["checks"]))

    def test_declining_stock_is_not_eligible(self) -> None:
        result = evaluate("TEST", momentum_bars(declining=True), [])
        self.assertFalse(result["eligible"])
        self.assertIsNone(result["recommendationScore"])

    def test_illiquid_stock_is_not_eligible(self) -> None:
        result = evaluate("TEST", momentum_bars(liquid=False), [])
        self.assertFalse(result["eligible"])
        liquidity = next(check for check in result["checks"] if check["id"] == "liquidity")
        self.assertFalse(liquidity["passed"])

    def test_low_share_price_is_not_an_automatic_rejection(self) -> None:
        result = evaluate("TEST", momentum_bars(starting_price=8.0, daily_volume=10_000_000), [])
        self.assertTrue(result["eligible"])
        self.assertNotIn("price", {check["id"] for check in result["checks"]})


if __name__ == "__main__":
    unittest.main()
