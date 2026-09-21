from __future__ import annotations

import unittest
from datetime import datetime, timezone

from options_volatility_research import evaluate_options_volatility


NOW = datetime(2026, 9, 21, 14, 0, tzinfo=timezone.utc)


def complete_snapshot() -> dict[str, object]:
    contracts = []
    for expiration, base_iv in (("2026-10-16", 50), ("2026-11-20", 55)):
        contracts.extend([
            {"expiration": expiration, "type": "call", "strike": 100, "bid": 4.8, "ask": 5.2,
             "impliedVolatilityPercent": base_iv, "delta": 0.25, "volume": 500, "openInterest": 3000},
            {"expiration": expiration, "type": "put", "strike": 100, "bid": 5.3, "ask": 5.7,
             "impliedVolatilityPercent": base_iv + 5, "delta": -0.25, "volume": 600, "openInterest": 3500},
        ])
    return {"symbol": "TEST", "observedAt": "2026-09-21T13:55:00Z", "source": "licensed-provider",
            "feed": "opra", "underlyingPrice": 100, "realizedVolatilityPercent20": 40,
            "underlyingIvHistoryPercent": list(range(20, 80)), "daysToKnownEvent": 20, "contracts": contracts}


class OptionsVolatilityResearchTests(unittest.TestCase):
    def test_complete_snapshot_calculates_bounded_research_metrics(self) -> None:
        result = evaluate_options_volatility(complete_snapshot(), evaluated_at=NOW)
        self.assertEqual(result["status"], "COMPLETE")
        self.assertEqual(result["metrics"]["atmImpliedVolatilityPercent"], 52.5)
        self.assertEqual(result["metrics"]["nearFarTermStructurePoints"], 5.0)
        self.assertEqual(result["metrics"]["putCall25DeltaSkewPoints"], 5.0)
        self.assertFalse(result["rankingAdjustmentAllowed"])
        self.assertFalse(result["orderSubmissionAllowed"])

    def test_indicative_snapshot_and_missing_history_fail_closed(self) -> None:
        snapshot = complete_snapshot()
        snapshot["feed"] = "indicative"
        snapshot["underlyingIvHistoryPercent"] = []
        result = evaluate_options_volatility(snapshot, evaluated_at=NOW)
        self.assertEqual(result["status"], "INCOMPLETE")
        self.assertIn("consolidated_opra_feed", result["missing"])
        self.assertIn("sixty_observation_iv_history", result["missing"])

    def test_stale_or_future_snapshot_is_never_complete(self) -> None:
        for observed_at in ("2026-09-21T12:00:00Z", "2026-09-21T15:00:00Z"):
            snapshot = complete_snapshot()
            snapshot["observedAt"] = observed_at
            result = evaluate_options_volatility(snapshot, evaluated_at=NOW)
            self.assertIn("fresh_snapshot", result["missing"])


if __name__ == "__main__":
    unittest.main()
