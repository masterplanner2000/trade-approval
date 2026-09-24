from __future__ import annotations

import unittest
from datetime import date, timedelta

from directional_volume_experiment import evaluate, manifest
from ibkr_daily_scanner import DailyBar


def bars(*, latest_volume_multiplier: float = 1.0, declining: bool = False) -> list[DailyBar]:
    result = []
    price = 20.0
    start = date(2026, 1, 1)
    for index in range(80):
        price *= .99 if declining else 1.004
        volume = 1_000_000 * (latest_volume_multiplier if index == 79 else 1)
        result.append(DailyBar((start + timedelta(days=index)).strftime("%Y%m%d"),
                               price * .99, price * 1.04, price * .97, price, volume))
    return result


class DirectionalVolumeExperimentTests(unittest.TestCase):
    def test_relative_volume_only_failure_is_admitted_without_authority(self) -> None:
        result = evaluate("TEST", bars(latest_volume_multiplier=1.0), today="99999999")
        failed = {check["id"] for check in result["checks"] if not check["passed"]}
        self.assertEqual(failed, {"relative_volume"})
        self.assertTrue(result["eligible"])
        self.assertTrue(result["admittedBySingleChange"])
        self.assertFalse(result["orderSubmissionAllowed"])

    def test_other_failed_gate_remains_ineligible(self) -> None:
        result = evaluate("TEST", bars(latest_volume_multiplier=1.0, declining=True), today="99999999")
        self.assertFalse(result["eligible"])
        self.assertIsNone(result["researchScore"])

    def test_manifest_freezes_one_change_and_review_gates(self) -> None:
        value = manifest()
        self.assertEqual(value["singleChange"], "relative_volume_removed_as_hard_gate")
        self.assertEqual(value["minimumDistinctSessions"], 20)
        self.assertFalse(value["recommendationAuthority"])
        self.assertFalse(value["orderSubmissionAllowed"])


if __name__ == "__main__":
    unittest.main()
