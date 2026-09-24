from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from ibkr_daily_scanner import DailyBar
from portfolio_performance import portfolio_performance


class PortfolioPerformanceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "ledger.sqlite3"
        with sqlite3.connect(self.path) as connection:
            connection.executescript("""
                CREATE TABLE proposals(id TEXT PRIMARY KEY,environment TEXT,symbol TEXT,terms_json TEXT);
                CREATE TABLE broker_orders(proposal_id TEXT,role TEXT,status TEXT,order_json TEXT,
                  last_seen_at INTEGER);
            """)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def add_trade(self, proposal: str, symbol: str, entry: float, exit_price: float | None = None,
                  commissions: bool = True) -> None:
        with sqlite3.connect(self.path) as connection:
            connection.execute("INSERT INTO proposals VALUES(?,?,?,?)", (
                proposal, "paper", symbol, json.dumps({"quantity": 2, "limitPrice": entry - 0.1}),
            ))
            entry_payload = {"time": "20260911 10:00:00 US/Eastern", "cumulativeQuantity": 2,
                             "averagePrice": entry}
            if commissions:
                entry_payload["commission"] = 1
            connection.execute("INSERT INTO broker_orders VALUES(?,?,?,?,?)", (
                proposal, "entry", "Filled", json.dumps(entry_payload), 1_789_000_000_000,
            ))
            if exit_price is not None:
                exit_payload = {"time": "20260912 10:00:00 US/Eastern", "cumulativeQuantity": 2,
                                "averagePrice": exit_price}
                if commissions:
                    exit_payload["commission"] = 1
                connection.execute("INSERT INTO broker_orders VALUES(?,?,?,?,?)", (
                    proposal, "protective_stop", "Filled", json.dumps(exit_payload),
                    1_789_086_400_000,
                ))

    @staticmethod
    def histories() -> dict[str, list[DailyBar]]:
        return {
            "AAA": [DailyBar("20260911", 100, 105, 99, 104, 1),
                    DailyBar("20260912", 104, 106, 100, 102, 1)],
            "BBB": [DailyBar("20260911", 50, 55, 49, 54, 1),
                    DailyBar("20260912", 54, 57, 53, 56, 1)],
            "QQQ": [DailyBar("20260911", 500, 505, 499, 504, 1),
                    DailyBar("20260912", 504, 510, 503, 508, 1)],
        }

    def test_calculates_exposure_turnover_drawdown_and_benchmarks(self) -> None:
        self.add_trade("closed", "AAA", 100, 102)
        self.add_trade("open", "BBB", 50)
        report = portfolio_performance(self.path, self.histories(), capital=1_000)
        self.assertTrue(report["ok"])
        self.assertEqual(report["status"], "COMPLETE_NET")
        self.assertTrue(report["feesComplete"])
        self.assertEqual(report["grossRealizedPnl"], 4)
        self.assertEqual(report["grossUnrealizedPnl"], 12)
        self.assertEqual(report["openPositionCount"], 1)
        self.assertAlmostEqual(report["turnoverDollars"], 504)
        self.assertGreater(report["endingExposurePercent"], 0)
        self.assertEqual(len(report["equityCurve"]), 2)
        self.assertIsNotNone(report["netReturnBps"])
        self.assertEqual(report["executionSlippageSampleCount"], 2)
        self.assertGreater(report["notionalWeightedExecutionSlippageBps"], 0)
        self.assertEqual(len(report["dailyPerformance"]), 2)
        self.assertTrue(report["dataQuality"]["netPerformanceAvailable"])
        self.assertIsNotNone(report["exposureMatchedQqqNetReturnBps"])
        self.assertIsNotNone(report["grossExcessVsExposureMatchedQqqBps"])
        self.assertEqual(
            report["riskAdjustedComparison"]["status"], "INSUFFICIENT_SAMPLE"
        )
        self.assertEqual(report["riskAdjustedComparison"]["observedSessionCount"], 2)
        self.assertIn("exposureMatchedQqqReturnBps", report["dailyPerformance"][0])

    def test_missing_commissions_make_net_performance_incomplete(self) -> None:
        self.add_trade("open", "BBB", 50, commissions=False)
        report = portfolio_performance(self.path, self.histories(), capital=1_000)
        self.assertFalse(report["feesComplete"])
        self.assertEqual(report["status"], "COMPLETE_GROSS")
        self.assertIsNone(report["netReturnBps"])
        self.assertIsNone(report["netExcessVsQqqBps"])
        self.assertFalse(report["dataQuality"]["netPerformanceAvailable"])
        self.assertIsNotNone(report["grossReturnBps"])

    def test_risk_adjusted_comparison_requires_twenty_sessions(self) -> None:
        self.add_trade("open", "BBB", 50)
        dates = [f"202609{day:02d}" for day in range(1, 21)]
        histories = {
            "BBB": [DailyBar(date, 50 + day, 52 + day, 49 + day, 51 + day, 1)
                    for day, date in enumerate(dates)],
            "QQQ": [DailyBar(date, 500 + day, 504 + day, 499 + day,
                             501 + day + (day % 2), 1)
                    for day, date in enumerate(dates)],
        }
        with sqlite3.connect(self.path) as connection:
            payload = json.loads(connection.execute(
                "SELECT order_json FROM broker_orders WHERE proposal_id='open'"
            ).fetchone()[0])
            payload["time"] = "20260901 10:00:00 US/Eastern"
            connection.execute(
                "UPDATE broker_orders SET order_json=? WHERE proposal_id='open'",
                (json.dumps(payload),),
            )
        report = portfolio_performance(self.path, histories, capital=1_000)
        self.assertEqual(report["riskAdjustedComparison"]["status"], "COMPLETE")
        self.assertEqual(report["riskAdjustedComparison"]["observedSessionCount"], 20)
        self.assertIsNotNone(
            report["riskAdjustedComparison"]["annualizedInformationRatio"]
        )

    def test_external_or_live_records_are_excluded(self) -> None:
        with sqlite3.connect(self.path) as connection:
            connection.execute("INSERT INTO proposals VALUES(?,?,?,?)",
                               ("live", "live", "AAA", '{"quantity":10,"limitPrice":100}'))
            connection.execute("INSERT INTO broker_orders VALUES(?,?,?,?,?)", (
                "live", "entry", "Filled",
                '{"time":"20260911 10:00:00 US/Eastern","quantity":10,"averagePrice":100}', 1,
            ))
        report = portfolio_performance(self.path, self.histories(), capital=1_000)
        self.assertEqual(report["status"], "NO_STRATEGY_FILLS")


if __name__ == "__main__":
    unittest.main()
