import unittest
from datetime import datetime, timedelta, timezone

from macro_outcome_analysis import build_outcome_report


def record(index, kind="EVENT", classification="REAL_FORWARD", split="FORWARD", net=8.0):
    instant = datetime(2026, 1, 1, 12, 30, tzinfo=timezone.utc) + timedelta(days=index)
    scheduled = instant.isoformat().replace("+00:00", "Z")
    captured = (instant + timedelta(minutes=30)).isoformat().replace("+00:00", "Z")
    item = {
        "studyId": f"study-{kind.lower()}-{index}", "symbol": "HD", "scheduledAt": scheduled,
        "capturedAt": captured, "classification": classification,
        "split": split, "observationType": kind, "signalDirection": 1,
        "matchKey": f"match-{index}", "latenessMilliseconds": 50,
        "pilotComplete": True, "replayMatch": True, "correctionPending": False,
        "rulesetVersion": "rules-v1", "mappingVersion": "map-v1", "universeVersion": "universe-v1",
        "horizons": {},
    }
    for horizon in ("1m", "5m", "30m"):
        item["horizons"][horizon] = {
            "grossReturnBps": net + 3, "spreadBps": 2, "estimatedSlippageBps": 1,
            "favorableExcursionBps": net + 5, "adverseExcursionBps": -4,
            "benchmarkReturnBps": 1, "volume": 10000, "volatilityRegime": "NORMAL",
            "cashReturnBps": 0, "momentumScore": 0.6,
        }
    return item


class MacroOutcomeAnalysisTests(unittest.TestCase):
    def test_rehearsal_is_visible_but_never_performance_eligible(self):
        report = build_outcome_report([record(0, classification="RECORDED_REHEARSAL")],
                                      generated_at="2026-11-01T00:00:00Z")
        self.assertEqual(report["eligibleEventCount"], 0)
        self.assertEqual(report["excluded"][0]["reasons"], ["not_real_forward"])
        self.assertEqual(report["conclusion"], "CONTINUE_COLLECTING")

    def test_complete_real_events_and_controls_include_costs_and_drawdown(self):
        rows = [record(index, net=8) for index in range(30)]
        rows += [record(index, kind="MATCHED_NO_EVENT", net=2) for index in range(30)]
        report = build_outcome_report(rows, generated_at="2026-12-31T00:00:00Z")
        self.assertTrue(report["adequateSample"])
        self.assertEqual(report["metrics"]["30m"]["eventNetBps"]["mean"], 8)
        self.assertEqual(report["metrics"]["30m"]["matchedControlExcessBps"]["mean"], 6)
        self.assertEqual(report["conclusion"], "PROCEED_TO_SHADOW_RANKING")
        self.assertFalse(report["orderSubmissionAllowed"])

    def test_adverse_adequate_sample_is_rejected(self):
        rows = [record(index, net=-8) for index in range(30)]
        rows += [record(index, kind="MATCHED_NO_EVENT", net=2) for index in range(30)]
        report = build_outcome_report(rows, generated_at="2026-12-31T00:00:00Z")
        self.assertEqual(report["conclusion"], "REJECT")
        self.assertLess(report["metrics"]["30m"]["cumulativeNetTroughBps"], 0)

    def test_incomplete_correction_and_missing_horizon_remain_visible(self):
        incomplete = record(0)
        incomplete["pilotComplete"] = False
        incomplete["missingReason"] = "provider_timeout"
        correction = record(1)
        correction["correctionPending"] = True
        report = build_outcome_report([incomplete, correction], generated_at="2026-11-01T00:00:00Z")
        self.assertEqual(report["excludedCount"], 2)
        self.assertEqual(report["failureRate"], 1)

    def test_duplicate_or_walk_forward_leakage_fails_closed(self):
        duplicate = record(0)
        with self.assertRaisesRegex(ValueError, "duplicate"):
            build_outcome_report([duplicate, dict(duplicate)], generated_at="2026-11-01T00:00:00Z")
        calibration = record(5, split="CALIBRATION")
        forward = record(0)
        with self.assertRaisesRegex(ValueError, "walk_forward_split_overlap"):
            build_outcome_report([calibration, forward], generated_at="2026-11-01T00:00:00Z")

    def test_mixed_versions_block_promotion(self):
        rows = [record(index) for index in range(30)]
        rows += [record(index, kind="MATCHED_NO_EVENT") for index in range(30)]
        rows[-1]["rulesetVersion"] = "rules-v2"
        report = build_outcome_report(rows, generated_at="2026-12-31T00:00:00Z")
        self.assertFalse(report["versionConsistent"])
        self.assertEqual(report["conclusion"], "CONTINUE_COLLECTING")

    def test_mismatched_symbol_or_volatility_cannot_satisfy_control_gate(self):
        rows = [record(index) for index in range(30)]
        controls = [record(index, kind="MATCHED_NO_EVENT") for index in range(30)]
        controls[0]["symbol"] = "JPM"
        controls[1]["horizons"]["30m"]["volatilityRegime"] = "HIGH"
        report = build_outcome_report(rows + controls, generated_at="2026-12-31T00:00:00Z")
        self.assertFalse(report["matchesValid"])
        self.assertFalse(report["adequateSample"])
        self.assertEqual(report["conclusion"], "CONTINUE_COLLECTING")


if __name__ == "__main__":
    unittest.main()
