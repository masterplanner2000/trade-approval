import unittest

from intraday_market_data_readiness import evaluate_market_data_readiness


def snapshot(feed, scope):
    return lambda symbol: {
        "symbol": symbol, "feed": feed, "volumeScope": scope,
        "observedAt": "2026-09-24T15:00:00Z",
    }


class IntradayMarketDataReadinessTests(unittest.TestCase):
    def test_single_venue_is_research_available_but_promotion_blocked(self):
        def denied(_symbol):
            raise ValueError("macro_provider_http_error")
        result = evaluate_market_data_readiness("NVDA", readers={
            "iex": snapshot("iex", "single_venue"), "sip": denied,
        })
        self.assertTrue(result["shadowResearchAllowed"])
        self.assertFalse(result["promotionDataGatePassed"])
        self.assertEqual(result["promotionBlockers"], ["consolidated_market_data_unavailable"])
        self.assertFalse(result["orderSubmissionAllowed"])

    def test_consolidated_entitlement_passes_only_the_data_gate(self):
        result = evaluate_market_data_readiness("NVDA", readers={
            "iex": snapshot("iex", "single_venue"),
            "sip": snapshot("sip", "consolidated"),
        })
        self.assertTrue(result["promotionDataGatePassed"])
        self.assertEqual(result["promotionBlockers"], [])
        self.assertFalse(result["recommendationAllowed"])

    def test_wrong_provenance_and_raw_errors_fail_closed(self):
        def raw_failure(_symbol):
            raise RuntimeError("credential=secret upstream detail")
        result = evaluate_market_data_readiness("nvda", readers={
            "iex": snapshot("sip", "consolidated"), "sip": raw_failure,
        })
        self.assertEqual(result["feeds"]["iex"]["status"], "INCOMPLETE")
        self.assertEqual(result["feeds"]["sip"]["reason"], "provider_check_failed")
        self.assertNotIn("secret", str(result))


if __name__ == "__main__":
    unittest.main()
