import unittest

from macro_event_bias import evaluate_macro_event_bias


NOW = "2026-09-19T14:30:00Z"


def evidence(**overrides):
    value = {
        "symbol": "WTTR",
        "event": {
            "type": "industry", "publishedAt": "2026-09-19T14:00:00Z",
            "primarySourceVerified": True, "independentSourceCount": 2,
            "surpriseMagnitude": 2.0, "confidence": 0.8,
        },
        "exposure": {"theme": "data-center-water-demand", "strength": 0.8, "direction": 1},
        "reaction": {
            "quoteObservedAt": "2026-09-19T14:29:30Z", "halted": False,
            "returnPercent": 3.2, "relativeVolume": 2.4, "atrPercent14": 6.5,
            "spreadBps": 24,
        },
    }
    for key, item in overrides.items():
        value[key] = item
    return value


class MacroEventBiasTests(unittest.TestCase):
    def test_verified_aligned_event_is_research_only(self):
        result = evaluate_macro_event_bias(evidence(), now=NOW)
        self.assertTrue(result["eligible"])
        self.assertEqual(result["biasDirection"], "LONG")
        self.assertGreater(result["rankingBiasScore"], 0)
        self.assertFalse(result["orderSubmissionAllowed"])

    def test_negative_exposure_can_produce_avoid_or_exit_bias(self):
        item = evidence(
            exposure={"theme": "restrictive-policy", "strength": 0.9, "direction": -1},
            reaction={
                "quoteObservedAt": "2026-09-19T14:29:30Z", "halted": False,
                "returnPercent": -4.0, "relativeVolume": 3.0, "atrPercent14": 7.0,
                "spreadBps": 20,
            },
        )
        result = evaluate_macro_event_bias(item, now=NOW)
        self.assertTrue(result["eligible"])
        self.assertEqual(result["biasDirection"], "AVOID_OR_EXIT")

    def test_unverified_or_stale_event_fails_closed(self):
        item = evidence(event={
            "type": "industry", "publishedAt": "2026-09-18T14:00:00Z",
            "primarySourceVerified": False, "independentSourceCount": 1,
            "surpriseMagnitude": 2.0, "confidence": 0.8,
        })
        result = evaluate_macro_event_bias(item, now=NOW)
        self.assertFalse(result["eligible"])
        self.assertIn("event_provenance", result["failedChecks"])
        self.assertIn("event_freshness", result["failedChecks"])

    def test_event_without_confirming_market_reaction_fails(self):
        item = evidence(reaction={
            "quoteObservedAt": "2026-09-19T14:29:30Z", "halted": False,
            "returnPercent": -0.2, "relativeVolume": 0.8, "atrPercent14": 2.0,
            "spreadBps": 100,
        })
        result = evaluate_macro_event_bias(item, now=NOW)
        self.assertFalse(result["eligible"])
        self.assertTrue({"reaction_magnitude", "reaction_alignment", "relative_volume",
                         "volatility_band", "spread"}.issubset(result["failedChecks"]))

    def test_all_missing_fields_are_reported(self):
        result = evaluate_macro_event_bias({}, now=NOW)
        self.assertFalse(result["eligible"])
        self.assertGreaterEqual(len(result["failedChecks"]), 10)
        self.assertIsNone(result["rankingBiasScore"])


if __name__ == "__main__":
    unittest.main()
