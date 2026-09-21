import sqlite3
import tempfile
import unittest
from pathlib import Path

from macro_promotion_review import (
    MacroPromotionJournal, assess_promotion_readiness, build_decision_record, build_release_manifest,
)


def evidence(ready=True):
    return {
        "stage12Report": {
            "shadowRulesetVersion": "macro-shadow-ranking-v1", "classification": "research_only",
            "orderSubmissionAllowed": False,
            "conclusion": "IMPROVED_PROCEED_TO_PROMOTION_REVIEW" if ready else "CONTINUE_COLLECTING",
            "adequateSample": ready, "rollbackReasons": [], "reportDigest": "stage12-digest",
            "generatedAt": "2027-02-28T00:00:00Z",
        },
        "sourceDataRightsReview": {"status": "APPROVED", "reviewerId": "rights-reviewer",
                                   "reviewedAt": "2027-03-01T00:00:00Z"},
        "performanceReproduced": ready,
        "failureRateReview": {"acceptable": ready, "rate": 0.01, "reportDigest": "failure-digest"},
        "securityReview": {"status": "APPROVED", "reviewerId": "security-reviewer",
                           "reviewedAt": "2027-03-01T00:00:00Z"},
        "strategyPolicyVersion": "macro-policy-v1",
        "monitoringPlan": {"version": "monitor-v1", "alertingTested": ready},
        "rollbackPlan": {"complete": ready, "version": "rollback-v1", "disableMechanismTested": ready},
        "brokerReconciliationReview": {"passed": ready, "reportDigest": "broker-digest"},
        "userExplanationVersion": "explain-v1",
        "integrationTestReview": {"version": "integration-v1", "passed": ready},
    }


def decision(assessment, choice="APPROVE_BOUNDED_RANKING"):
    return build_decision_record(
        assessment, decision=choice, approver_id="risk-owner",
        recorded_at="2027-03-02T00:00:00Z", attested=True,
        change_control_id="change-123", rationale="Fixture review decision.",
    )


class MacroPromotionReviewTests(unittest.TestCase):
    def test_incomplete_evidence_lists_all_blockers_and_enables_nothing(self):
        report = assess_promotion_readiness(evidence(False), generated_at="2027-03-01T01:00:00Z")
        self.assertFalse(report["readyForBoundedRanking"])
        self.assertIn("stage12_not_improved", report["blockers"])
        self.assertIn("broker_reconciliation_gates_open", report["blockers"])
        self.assertFalse(report["featureEnabled"])
        self.assertFalse(report["orderSubmissionAllowed"])

    def test_complete_dossier_is_ready_but_not_enabled(self):
        report = assess_promotion_readiness(evidence(), generated_at="2027-03-01T01:00:00Z")
        self.assertTrue(report["readyForBoundedRanking"])
        self.assertEqual(report["blockers"], [])
        self.assertFalse(report["featureEnabled"])

    def test_approval_requires_readiness_and_attributable_signoff(self):
        blocked = assess_promotion_readiness(evidence(False), generated_at="2027-03-01T01:00:00Z")
        with self.assertRaisesRegex(ValueError, "not_ready"):
            decision(blocked)
        ready = assess_promotion_readiness(evidence(), generated_at="2027-03-01T01:00:00Z")
        with self.assertRaisesRegex(ValueError, "signoff_required"):
            build_decision_record(ready, decision="APPROVE_BOUNDED_RANKING", approver_id="",
                                  recorded_at="2027-03-02T00:00:00Z", attested=False,
                                  change_control_id="change", rationale="reason")

    def test_nonapproval_decision_can_record_blocked_review(self):
        blocked = assess_promotion_readiness(evidence(False), generated_at="2027-03-01T01:00:00Z")
        item = decision(blocked, "CONTINUE_OBSERVATION")
        self.assertFalse(item["boundedRankingApproved"])
        with self.assertRaisesRegex(ValueError, "approval_required"):
            build_release_manifest(item)

    def test_approved_manifest_is_default_off_and_has_no_order_authority(self):
        ready = assess_promotion_readiness(evidence(), generated_at="2027-03-01T01:00:00Z")
        manifest = build_release_manifest(decision(ready))
        self.assertFalse(manifest["defaultEnabled"])
        self.assertTrue(manifest["requiresShadowActiveComparison"])
        self.assertFalse(manifest["orderSubmissionAllowed"])
        self.assertFalse(manifest["automaticOrderAuthority"])
        forged = dict(decision(ready))
        forged["approverId"] = "forged"
        with self.assertRaisesRegex(ValueError, "approval_required"):
            build_release_manifest(forged)

    def test_forged_assessment_cannot_be_signed(self):
        ready = assess_promotion_readiness(evidence(), generated_at="2027-03-01T01:00:00Z")
        ready["readyForBoundedRanking"] = False
        with self.assertRaisesRegex(ValueError, "assessment_invalid"):
            decision(ready)

    def test_journal_is_idempotent_immutable_and_one_decision_per_assessment(self):
        with tempfile.TemporaryDirectory() as directory:
            journal = MacroPromotionJournal(Path(directory) / "promotion.sqlite3")
            ready = assess_promotion_readiness(evidence(), generated_at="2027-03-01T01:00:00Z")
            approved = decision(ready)
            self.assertTrue(journal.append(approved)["created"])
            self.assertFalse(journal.append(approved)["created"])
            alternative = decision(ready, "CONTINUE_OBSERVATION")
            with self.assertRaisesRegex(ValueError, "already_recorded"):
                journal.append(alternative)
            with self.assertRaisesRegex(sqlite3.IntegrityError, "immutable"):
                journal.connection.execute("UPDATE macro_promotion_decisions SET decision='X'")
            self.assertEqual(journal.list(), [approved])
            journal.close()


if __name__ == "__main__":
    unittest.main()
