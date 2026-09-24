import unittest

from intraday_safety_filters import evaluate_intraday_safety


NOW = "2026-09-24T17:05:30Z"


def evidence():
    gate = {
        "symbol": "TEST", "observedAt": "2026-09-24T17:05:20Z",
        "status": "COMPLETE", "eligible": True, "failedChecks": [],
        "volumeScope": "single_venue", "profileSessionCount": 30,
        "metrics": {"spreadPercent": 0.2, "sessionDollarVolume": 25_000_000},
    }
    price = {
        "symbol": "TEST", "status": "COMPLETE",
        "metrics": {"priceVsVwapPercent": 1.2, "rangeExpansionRatio": 1.4,
                    "pullbackFromSessionHighPercent": 0.5},
    }
    score = {"symbol": "TEST", "status": "COMPLETE", "score": 78}
    halt = {
        "symbol": "TEST", "observedAt": "2026-09-24T17:05:29Z", "halted": False,
        "activeHalts": [], "dataSource": "Nasdaq Trader Trade Halt RSS",
    }
    portfolio = {
        "observedAt": "2026-09-24T17:05:25Z", "openPositionCount": 2,
        "maxOpenPositions": 5, "symbolExposurePercent": 8,
        "maxSymbolExposurePercent": 10, "sectorExposurePercent": 18,
        "maxSectorExposurePercent": 25, "dailyLossPercent": 0.5,
        "maxDailyLossPercent": 2, "availableBuyingPower": 10_000,
        "proposedNotional": 1_000, "addingToExistingPosition": False,
    }
    return gate, price, score, halt, portfolio


class IntradaySafetyFilterTests(unittest.TestCase):
    def test_complete_safe_evidence_allows_shadow_but_never_actionable(self):
        result = evaluate_intraday_safety(*evidence(), now=NOW)
        self.assertTrue(result["shadowEligible"])
        self.assertTrue(result["portfolioEligible"])
        self.assertFalse(result["actionableEligible"])
        self.assertIn("consolidated_market_data_unavailable", result["promotionBlockers"])
        self.assertFalse(result["recommendationAllowed"])

    def test_active_or_stale_halt_evidence_blocks_shadow(self):
        gate, price, score, halt, portfolio = evidence()
        halt["halted"], halt["activeHalts"] = True, [{"reasonCode": "LUDP"}]
        active = evaluate_intraday_safety(gate, price, score, halt, portfolio, now=NOW)
        self.assertIn("not_halted", active["failedMarketChecks"])
        halt["halted"], halt["observedAt"] = False, "2026-09-24T17:00:00Z"
        stale = evaluate_intraday_safety(gate, price, score, halt, portfolio, now=NOW)
        self.assertIn("halt_evidence_fresh", stale["failedMarketChecks"])

    def test_overextension_and_extreme_range_are_explicit_market_blocks(self):
        gate, price, score, halt, portfolio = evidence()
        price["metrics"].update({"priceVsVwapPercent": 5, "rangeExpansionRatio": 3.5,
                                 "pullbackFromSessionHighPercent": 4})
        result = evaluate_intraday_safety(gate, price, score, halt, portfolio, now=NOW)
        self.assertEqual(set(result["failedMarketChecks"]), {
            "vwap_not_overextended", "range_not_extreme", "pullback_not_broken",
        })

    def test_portfolio_conflicts_do_not_corrupt_market_research_verdict(self):
        gate, price, score, halt, portfolio = evidence()
        portfolio.update({"openPositionCount": 5, "symbolExposurePercent": 15,
                          "sectorExposurePercent": 30, "dailyLossPercent": 2.5,
                          "availableBuyingPower": 500})
        result = evaluate_intraday_safety(gate, price, score, halt, portfolio, now=NOW)
        self.assertTrue(result["shadowEligible"])
        self.assertFalse(result["portfolioEligible"])
        self.assertEqual(set(result["failedPortfolioChecks"]), {
            "position_capacity", "symbol_exposure", "sector_exposure",
            "daily_loss_limit", "buying_power",
        })

    def test_missing_or_mismatched_evidence_fails_closed(self):
        gate, price, score, halt, portfolio = evidence()
        gate["profileSessionCount"] = None
        score["symbol"] = "OTHER"
        result = evaluate_intraday_safety(gate, price, score, halt, portfolio, now=NOW)
        self.assertIn("profile_complete", result["failedMarketChecks"])
        self.assertIn("evidence_identity", result["failedMarketChecks"])


if __name__ == "__main__":
    unittest.main()
