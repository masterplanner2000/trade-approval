import unittest
from datetime import datetime, timedelta, timezone

from macro_shadow_ranking import authorize_experiment, build_forward_comparison, compare_rankings


GATES = {name: True for name in ("liquidity", "spread", "freshness", "ownership", "protection", "portfolio")}


def auth(mode="RECORDED_REHEARSAL"):
    report = {"analysisVersion": "macro-outcomes-v1", "classification": "research_only",
              "orderSubmissionAllowed": False, "conclusion": "PROCEED_TO_SHADOW_RANKING",
              "adequateSample": True, "reportDigest": "stage11-digest"}
    return authorize_experiment(report, mode=mode)


def session(index, baseline=1, shadow=3, classification="REAL_FORWARD"):
    observed = datetime(2027, 1, 1, tzinfo=timezone.utc) + timedelta(days=index)
    return {"sessionId": f"session-{index}", "observedAt": observed.isoformat(),
            "classification": classification, "complete": True,
            "baselineInputDigest": f"digest-{index}", "shadowInputDigest": f"digest-{index}",
            "baselineOutcomeBps": baseline, "shadowOutcomeBps": shadow,
            "operationalFailure": False}


class MacroShadowRankingTests(unittest.TestCase):
    def test_real_experiment_is_blocked_until_stage11_proceeds(self):
        blocked = authorize_experiment({"conclusion": "CONTINUE_COLLECTING", "adequateSample": False},
                                       mode="REAL_FORWARD")
        self.assertFalse(blocked["authorized"])
        self.assertIn("stage11_not_promoted", blocked["blockers"])
        with self.assertRaisesRegex(ValueError, "not_authorized"):
            compare_rankings([], {}, as_known_at="2027-01-01T00:00:00Z", authorization=blocked)
        with self.assertRaisesRegex(ValueError, "not_authorized"):
            compare_rankings([], {}, as_known_at="2027-01-01T00:00:00Z",
                             authorization={"authorized": True})

    def test_macro_adjustment_changes_shadow_only_and_is_capped(self):
        candidates = [{"symbol": "AAA", "baselineScore": 80, "gates": GATES},
                      {"symbol": "BBB", "baselineScore": 78, "gates": GATES}]
        macro = {"BBB": {"eligible": True, "biasDirection": "LONG", "rankingBiasScore": 100,
                          "classification": "research_observation_only", "rulesetVersion": "macro-v1",
                          "evaluatedAt": "2027-01-01T00:00:00Z"}}
        report = compare_rankings(candidates, macro, as_known_at="2027-01-01T00:00:00Z",
                                  authorization=auth())
        self.assertEqual(report["baselineOrder"], ["AAA", "BBB"])
        self.assertEqual(report["shadowOrder"], ["BBB", "AAA"])
        self.assertEqual(report["rows"][1]["macroAdjustment"], 5)
        self.assertFalse(report["productionQueueChanged"])
        self.assertFalse(report["orderSubmissionAllowed"])

    def test_macro_can_never_overcome_a_hard_gate(self):
        failed = dict(GATES)
        failed["spread"] = False
        report = compare_rankings(
            [{"symbol": "AAA", "baselineScore": 99, "gates": failed},
             {"symbol": "BBB", "baselineScore": 20, "gates": GATES}],
            {"AAA": {"eligible": True, "biasDirection": "LONG", "rankingBiasScore": 100,
                     "classification": "research_observation_only", "rulesetVersion": "macro-v1",
                     "evaluatedAt": "2027-01-01T00:00:00Z"}},
            as_known_at="2027-01-01T00:00:00Z", authorization=auth())
        self.assertEqual(report["baselineOrder"], ["BBB"])
        self.assertEqual(report["shadowOrder"], ["BBB"])
        self.assertEqual(report["rows"][0]["macroAdjustment"], 0)

    def test_rehearsal_sessions_are_excluded_from_forward_evidence(self):
        report = build_forward_comparison(
            [session(0, classification="RECORDED_REHEARSAL")], generated_at="2027-02-01T00:00:00Z",
            authorization=auth())
        self.assertEqual(report["eligibleSessionCount"], 0)
        self.assertEqual(report["conclusion"], "CONTINUE_COLLECTING")

    def test_future_macro_evidence_cannot_change_rank(self):
        macro = {"BBB": {"eligible": True, "biasDirection": "LONG", "rankingBiasScore": 100,
                          "classification": "research_observation_only", "rulesetVersion": "macro-v1",
                          "evaluatedAt": "2027-01-01T00:00:01Z"}}
        report = compare_rankings(
            [{"symbol": "AAA", "baselineScore": 80, "gates": GATES},
             {"symbol": "BBB", "baselineScore": 78, "gates": GATES}], macro,
            as_known_at="2027-01-01T00:00:00Z", authorization=auth())
        self.assertEqual(report["shadowOrder"], report["baselineOrder"])
        self.assertEqual(report["rows"][1]["macroReason"], "macro_provenance_or_timing_invalid")

    def test_baseline_and_shadow_input_mismatch_is_excluded(self):
        item = session(0)
        item["shadowInputDigest"] = "different"
        report = build_forward_comparison([item], generated_at="2027-02-01T00:00:00Z",
                                          authorization=auth("REAL_FORWARD"))
        self.assertIn("input_digest_mismatch", report["excluded"][0]["reasons"])

    def test_adequate_positive_paired_forward_sample_can_proceed(self):
        report = build_forward_comparison([session(index) for index in range(30)],
                                          generated_at="2027-02-01T00:00:00Z",
                                          authorization=auth("REAL_FORWARD"))
        self.assertTrue(report["adequateSample"])
        self.assertEqual(report["pairedOutcomeDifferenceBps"]["mean"], 2)
        self.assertEqual(report["conclusion"], "IMPROVED_PROCEED_TO_PROMOTION_REVIEW")

    def test_predeclared_rollback_triggers_on_degradation_or_failures(self):
        degraded = build_forward_comparison([session(index, baseline=5, shadow=-5) for index in range(30)],
                                            generated_at="2027-02-01T00:00:00Z",
                                            authorization=auth("REAL_FORWARD"))
        self.assertEqual(degraded["conclusion"], "REJECT_ROLLBACK")
        failed = [session(index) for index in range(30)]
        failed[0]["operationalFailure"] = True
        failed[1]["operationalFailure"] = True
        report = build_forward_comparison(failed, generated_at="2027-02-01T00:00:00Z",
                                          authorization=auth("REAL_FORWARD"))
        self.assertIn("operational_failure_rate", report["rollbackReasons"])

    def test_session_order_and_identity_are_fail_closed(self):
        rows = [session(1), session(0)]
        with self.assertRaisesRegex(ValueError, "session_order_invalid"):
            build_forward_comparison(rows, generated_at="2027-02-01T00:00:00Z",
                                     authorization=auth("REAL_FORWARD"))


if __name__ == "__main__":
    unittest.main()
