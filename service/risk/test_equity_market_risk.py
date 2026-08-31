from __future__ import annotations

import unittest
from dataclasses import dataclass

from risk.equity_market_risk import calculate_equity_market_risk


@dataclass
class Bar:
    open: float
    high: float
    low: float
    close: float
    volume: float


def steady_bars(count: int = 220) -> list[Bar]:
    bars: list[Bar] = []
    close = 100.0
    for index in range(count):
        previous = close
        close = previous * (1.001 if index % 3 else 0.999)
        bars.append(Bar(previous, max(previous, close) * 1.003, min(previous, close) * 0.997, close, 10_000_000))
    return bars


class EquityMarketRiskTests(unittest.TestCase):
    def test_incomplete_without_enough_bars(self) -> None:
        result = calculate_equity_market_risk(steady_bars(30))
        self.assertEqual(result["status"], "INCOMPLETE")
        self.assertIsNone(result["score"])

    def test_complete_score_has_three_components(self) -> None:
        result = calculate_equity_market_risk(steady_bars())
        self.assertEqual(result["status"], "COMPLETE")
        self.assertGreaterEqual(result["score"], 0)
        self.assertLessEqual(result["score"], 100)
        self.assertEqual(len(result["components"]), 3)
        self.assertEqual(result["tradeRisk"]["status"], "INCOMPLETE")

    def test_larger_gaps_and_volatility_raise_score(self) -> None:
        calmer = calculate_equity_market_risk(steady_bars())
        volatile = steady_bars()
        for index in range(160, len(volatile), 5):
            prior = volatile[index - 1].close
            volatile[index].open = prior * 1.12
            volatile[index].high = prior * 1.16
            volatile[index].low = prior * 0.90
            volatile[index].close = prior * 1.08
        riskier = calculate_equity_market_risk(volatile)
        self.assertGreater(riskier["score"], calmer["score"])


if __name__ == "__main__":
    unittest.main()
