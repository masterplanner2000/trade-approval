import unittest

from intraday_opportunity_score import score_intraday_opportunity


def gate(**changes):
    value = {
        "status": "COMPLETE", "eligible": True, "symbol": "TEST",
        "observedAt": "2026-09-24T15:00:00Z", "dataSource": "Alpaca IEX + profile",
        "volumeScope": "single_venue", "metrics": {"relativeVolume": 2.5},
    }
    value.update(changes)
    return value


def signals(**metric_changes):
    metrics = {
        "return5MinutePercent": 0.8, "return15MinutePercent": 1.7,
        "return60MinutePercent": 3.2, "fiveMinuteAccelerationPoints": 0.8,
        "priceVsVwapPercent": 1.2, "rangeExpansionRatio": 1.6,
        "pullbackFromSessionHighPercent": 0.3,
        "recent15MinuteCloseLocationPercent": 90,
        "recent15MinutePositiveBarSharePercent": 75,
    }
    metrics.update(metric_changes)
    return {
        "status": "COMPLETE", "symbol": "TEST", "observedAt": "2026-09-24T15:00:20Z",
        "dataSource": "Alpaca IEX current 1Min bars", "metrics": metrics,
    }


class IntradayOpportunityScoreTests(unittest.TestCase):
    def test_strong_setup_is_transparent_and_never_actionable(self):
        result = score_intraday_opportunity(gate(), signals())
        self.assertEqual(result["status"], "COMPLETE")
        self.assertEqual(result["band"], "STRONG_SHADOW")
        self.assertGreaterEqual(result["score"], 75)
        self.assertEqual(sum(item["maximumPoints"] for item in result["components"]), 100)
        self.assertEqual({item["id"] for item in result["components"]}, {
            "relative_volume", "momentum", "acceleration", "vwap_position",
            "range_expansion", "path_quality",
        })
        self.assertFalse(result["recommendationAllowed"])
        self.assertFalse(result["orderSubmissionAllowed"])

    def test_weak_path_and_negative_momentum_score_low(self):
        result = score_intraday_opportunity(gate(metrics={"relativeVolume": 1.6}), signals(
            return5MinutePercent=-0.4, return15MinutePercent=-0.8,
            return60MinutePercent=0.2, fiveMinuteAccelerationPoints=-0.3,
            priceVsVwapPercent=-0.5, rangeExpansionRatio=0.9,
            pullbackFromSessionHighPercent=4, recent15MinuteCloseLocationPercent=20,
            recent15MinutePositiveBarSharePercent=25,
        ))
        self.assertEqual(result["band"], "WEAK_SHADOW")
        self.assertLess(result["score"], 30)

    def test_extreme_vwap_extension_is_not_rewarded(self):
        moderate = score_intraday_opportunity(gate(), signals(priceVsVwapPercent=1.5))
        extended = score_intraday_opportunity(gate(), signals(priceVsVwapPercent=5.5))
        moderate_points = next(item["points"] for item in moderate["components"] if item["id"] == "vwap_position")
        extended_points = next(item["points"] for item in extended["components"] if item["id"] == "vwap_position")
        self.assertEqual(moderate_points, 10)
        self.assertEqual(extended_points, 0)

    def test_hard_gate_timestamp_symbol_and_provenance_failures_block_scoring(self):
        cases = [
            (gate(eligible=False), signals(), "intraday_hard_gates_not_passed"),
            (gate(), {**signals(), "symbol": "OTHER"}, "evidence_symbol_mismatch"),
            (gate(), {**signals(), "observedAt": "2026-09-24T15:02:00Z"}, "evidence_timestamp_mismatch"),
            (gate(volumeScope=None), signals(), "volume_provenance_missing"),
        ]
        for gate_value, signal_value, failure in cases:
            with self.subTest(failure=failure):
                result = score_intraday_opportunity(gate_value, signal_value)
                self.assertEqual(result["status"], "BLOCKED")
                self.assertIsNone(result["score"])
                self.assertIn(failure, result["failedEvidence"])

    def test_missing_metric_is_named_and_cannot_be_scored(self):
        value = signals()
        del value["metrics"]["rangeExpansionRatio"]
        result = score_intraday_opportunity(gate(), value)
        self.assertEqual(result["status"], "BLOCKED")
        self.assertIn("metric_missing:rangeExpansionRatio", result["failedEvidence"])


if __name__ == "__main__":
    unittest.main()
