import copy
import unittest
from pathlib import Path

from macro_research_universe import load_universe, validate_universe


PATH = Path(__file__).parent / "data" / "macro-research-universe-2026-09-20-v1.json"


class MacroResearchUniverseTests(unittest.TestCase):
    def setUp(self):
        self.document, self.summary = load_universe(PATH)

    def test_frozen_universe_is_reviewed_but_not_registerable(self):
        self.assertEqual(self.summary["studyCount"], 2)
        self.assertEqual(self.summary["activeStudyCount"], 0)
        self.assertEqual(self.summary["blockedStudyCount"], 2)
        self.assertEqual(self.summary["activeStudies"], [])

    def test_pending_consensus_cannot_be_mislabeled_active(self):
        changed = copy.deepcopy(self.document)
        changed["studies"][0]["status"] = "REVIEWED_ACTIVE"
        changed["studies"][0]["crosswalkStatus"] = "REVIEWED"
        with self.assertRaisesRegex(ValueError, "macro_universe_active_consensus_invalid"):
            validate_universe(changed)

    def test_blocked_study_cannot_invent_consensus_identity(self):
        changed = copy.deepcopy(self.document)
        changed["studies"][0]["consensusSeries"]["seriesId"] = "guessed-series"
        with self.assertRaisesRegex(ValueError, "macro_universe_blocked_consensus_invalid"):
            validate_universe(changed)

    def test_every_symbol_requires_liquidity_and_matching_reviewed_exposure(self):
        changed = copy.deepcopy(self.document)
        changed["studies"][0]["symbols"] = ["UNKNOWN"]
        with self.assertRaisesRegex(ValueError, "macro_universe_symbol_not_reviewed"):
            validate_universe(changed)
        changed = copy.deepcopy(self.document)
        changed["liquidityEvidence"][0]["averageDollarVolume20Day"] = 9_999_999
        with self.assertRaisesRegex(ValueError, "macro_universe_liquidity_invalid"):
            validate_universe(changed)

    def test_separate_source_review_is_mandatory_and_later(self):
        changed = copy.deepcopy(self.document)
        changed["independentReview"]["reviewedBy"] = changed["curatedBy"]
        with self.assertRaisesRegex(ValueError, "macro_universe_independent_review_invalid"):
            validate_universe(changed)
        changed = copy.deepcopy(self.document)
        changed["independentReview"]["reviewedAt"] = changed["curatedAt"]
        with self.assertRaisesRegex(ValueError, "macro_universe_independent_review_invalid"):
            validate_universe(changed)


if __name__ == "__main__": unittest.main()
