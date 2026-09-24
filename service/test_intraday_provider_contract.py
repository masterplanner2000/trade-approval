import unittest

from intraday_provider_contract import build_intraday_research_snapshot
from intraday_shadow_evaluator import evaluate_intraday_snapshot


MARKET = {
    "provider": "Alpaca Market Data", "symbol": "BMNR", "feed": "sip",
    "volumeScope": "consolidated", "observedAt": "2026-09-24T15:30:00Z",
    "quoteObservedAt": "2026-09-24T15:29:59Z", "bid": 26.19, "ask": 26.22,
    "last": 26.21, "sessionVolume": 39_183_473, "sessionOpen": 24.8,
    "sessionHigh": 26.21, "sessionLow": 24.49, "previousClose": 23.89,
}
CONTEXT = {
    "symbol": "BMNR", "observedAt": "2026-09-24T15:29:55Z", "halted": False,
    "expectedCumulativeVolume": 20_000_000, "profileSessionCount": 20,
    "profileVersion": "minute-profile-v1", "dataSource": "reviewed 20-session profile + halt feed",
}


class IntradayProviderContractTests(unittest.TestCase):
    def test_complete_consolidated_evidence_evaluates_without_order_authority(self):
        snapshot = build_intraday_research_snapshot(MARKET, CONTEXT)
        result = evaluate_intraday_snapshot(snapshot, now="2026-09-24T15:30:00Z")
        self.assertTrue(result["eligible"])
        self.assertFalse(result["orderSubmissionAllowed"])
        self.assertEqual(snapshot["volumeScope"], "consolidated")
        self.assertEqual(snapshot["profileSessionCount"], 20)

    def test_single_venue_is_preserved_not_mislabeled_consolidated(self):
        snapshot = build_intraday_research_snapshot(
            {**MARKET, "feed": "iex", "volumeScope": "single_venue"}, CONTEXT
        )
        self.assertEqual(snapshot["volumeScope"], "single_venue")
        self.assertIn("iex", snapshot["dataSource"])

    def test_context_must_match_symbol_time_profile_and_halt_state(self):
        cases = [
            ({**CONTEXT, "symbol": "OTHER"}, "intraday_context_symbol_mismatch"),
            ({**CONTEXT, "observedAt": "2026-09-24T15:28:00Z"}, "intraday_context_stale_or_future"),
            ({**CONTEXT, "profileSessionCount": 19}, "intraday_volume_profile_incomplete"),
            ({**CONTEXT, "halted": None}, "intraday_halt_state_unknown"),
        ]
        for context, error in cases:
            with self.subTest(error=error), self.assertRaisesRegex(ValueError, error):
                build_intraday_research_snapshot(MARKET, context)

    def test_outside_regular_session_is_explicitly_ineligible(self):
        market = {**MARKET, "observedAt": "2026-09-24T21:00:00Z",
                  "quoteObservedAt": "2026-09-24T20:59:59Z"}
        context = {**CONTEXT, "observedAt": "2026-09-24T20:59:55Z"}
        snapshot = build_intraday_research_snapshot(market, context)
        result = evaluate_intraday_snapshot(snapshot, now="2026-09-24T21:00:00Z")
        self.assertEqual(snapshot["session"], "outside_regular")
        self.assertIn("regular_session", result["failedChecks"])


if __name__ == "__main__":
    unittest.main()
