import unittest

from intraday_shadow_evaluator import evaluate_intraday_snapshot


NOW = "2026-09-18T15:30:00Z"


def snapshot(**changes):
    value = {
        "symbol": "BMNR", "observedAt": "2026-09-18T15:29:50Z",
        "quoteObservedAt": "2026-09-18T15:29:58Z", "session": "regular",
        "halted": False, "priorClose": 23.89, "sessionOpen": 24.80,
        "lastPrice": 26.21, "sessionHigh": 26.21, "sessionLow": 24.49,
        "cumulativeVolume": 39_183_473, "expectedCumulativeVolume": 20_000_000,
        "bid": 26.19, "ask": 26.22,
    }
    value.update(changes)
    return value


class IntradayShadowEvaluatorTests(unittest.TestCase):
    def test_bmnr_like_move_is_research_only_even_when_every_gate_passes(self):
        result = evaluate_intraday_snapshot(snapshot(), now=NOW)
        self.assertTrue(result["eligible"])
        self.assertFalse(result["orderSubmissionAllowed"])
        self.assertEqual(result["classification"], "research_only")
        self.assertAlmostEqual(result["metrics"]["dayChangePercent"], 9.71, places=2)
        self.assertIn("forward_performance_evidence", result["missingBeforeProposal"])
        self.assertNotIn("verified_catalyst", result["missingBeforeProposal"])
        self.assertFalse(result["catalystRequired"])
        self.assertEqual(result["signalBasis"], "price_volume_direction")

    def test_every_failed_gate_is_reported_instead_of_only_the_first(self):
        result = evaluate_intraday_snapshot(snapshot(
            session="postmarket", halted=True, lastPrice=24.0, sessionHigh=24.8,
            cumulativeVolume=100_000, expectedCumulativeVolume=2_000_000,
            bid=23.0, ask=24.0,
        ), now=NOW)
        self.assertFalse(result["eligible"])
        self.assertEqual(result["reason"], "intraday_gates_failed")
        self.assertTrue({"regular_session", "not_halted", "day_momentum", "relative_volume",
                         "session_liquidity", "current_spread"}.issubset(result["failedChecks"]))

    def test_stale_or_future_observations_fail_closed(self):
        stale = evaluate_intraday_snapshot(snapshot(
            observedAt="2026-09-18T15:28:00Z", quoteObservedAt="2026-09-18T15:29:30Z"), now=NOW)
        self.assertIn("snapshot_fresh", stale["failedChecks"])
        self.assertIn("quote_fresh", stale["failedChecks"])
        future = evaluate_intraday_snapshot(snapshot(
            observedAt="2026-09-18T15:30:01Z", quoteObservedAt="2026-09-18T15:30:01Z"), now=NOW)
        self.assertIn("snapshot_fresh", future["failedChecks"])
        self.assertIn("quote_fresh", future["failedChecks"])

    def test_missing_inputs_are_explicit_and_never_eligible(self):
        value = snapshot()
        del value["expectedCumulativeVolume"]
        value["bid"] = None
        result = evaluate_intraday_snapshot(value, now=NOW)
        self.assertEqual(result["status"], "INCOMPLETE")
        self.assertEqual(result["missing"], ["bid", "expectedCumulativeVolume"])
        self.assertFalse(result["eligible"])
        self.assertFalse(result["orderSubmissionAllowed"])

    def test_crossed_or_incoherent_prices_fail(self):
        result = evaluate_intraday_snapshot(snapshot(bid=26.3, ask=26.2), now=NOW)
        self.assertIn("coherent_prices", result["failedChecks"])


if __name__ == "__main__":
    unittest.main()
