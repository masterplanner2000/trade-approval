"""Stage-13 promotion review and immutable decision record.

This module cannot enable a feature or submit orders. It creates review
evidence, records an attributable decision, and emits a default-off manifest.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Mapping


REVIEW_VERSION = "macro-promotion-review-v1"
DECISIONS = {
    "REJECT_AND_ARCHIVE", "REVISE_AND_REPEAT_9_12",
    "CONTINUE_OBSERVATION", "APPROVE_BOUNDED_RANKING",
}


def _canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _digest(value: object) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _instant(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else None


def _approved_review(value: object, generated: datetime) -> bool:
    reviewed = _instant(value.get("reviewedAt")) if isinstance(value, Mapping) else None
    return (isinstance(value, Mapping) and value.get("status") == "APPROVED"
            and isinstance(value.get("reviewerId"), str) and bool(value["reviewerId"].strip())
            and reviewed is not None and reviewed <= generated)


def _digest_matches(value: Mapping[str, object], field: str) -> bool:
    claimed = value.get(field)
    if not isinstance(claimed, str) or not claimed:
        return False
    unsigned = {key: item for key, item in value.items() if key != field}
    return claimed == _digest(unsigned)


def assess_promotion_readiness(evidence: Mapping[str, object], *, generated_at: str) -> dict[str, object]:
    generated = _instant(generated_at)
    if generated is None:
        raise ValueError("macro_promotion_generated_at_invalid")
    blockers: list[str] = []
    stage12 = evidence.get("stage12Report")
    if not isinstance(stage12, Mapping) \
            or stage12.get("shadowRulesetVersion") != "macro-shadow-ranking-v1" \
            or stage12.get("classification") != "research_only" \
            or stage12.get("orderSubmissionAllowed") is not False \
            or not isinstance(stage12.get("reportDigest"), str) \
            or _instant(stage12.get("generatedAt")) is None \
            or _instant(stage12.get("generatedAt")) > generated:
        blockers.append("stage12_report_contract_invalid")
    else:
        if stage12.get("conclusion") != "IMPROVED_PROCEED_TO_PROMOTION_REVIEW":
            blockers.append("stage12_not_improved")
        if stage12.get("adequateSample") is not True:
            blockers.append("forward_sample_inadequate")
        if stage12.get("rollbackReasons") != []:
            blockers.append("stage12_rollback_triggered")
    if not _approved_review(evidence.get("sourceDataRightsReview"), generated):
        blockers.append("source_data_rights_unapproved")
    if evidence.get("performanceReproduced") is not True:
        blockers.append("performance_not_reproduced")
    failure = evidence.get("failureRateReview")
    if not isinstance(failure, Mapping) or failure.get("acceptable") is not True \
            or not isinstance(failure.get("reportDigest"), str) \
            or isinstance(failure.get("rate"), bool) \
            or not isinstance(failure.get("rate"), (int, float)) \
            or not 0 <= float(failure["rate"]) <= 0.05:
        blockers.append("failure_rate_unapproved")
    if not _approved_review(evidence.get("securityReview"), generated):
        blockers.append("security_review_unapproved")
    for key, blocker in (("strategyPolicyVersion", "strategy_policy_missing"),
                         ("userExplanationVersion", "user_explanation_missing")):
        if not isinstance(evidence.get(key), str) or not evidence[key].strip():
            blockers.append(blocker)
    rollback = evidence.get("rollbackPlan")
    if not isinstance(rollback, Mapping) or rollback.get("complete") is not True \
            or rollback.get("disableMechanismTested") is not True \
            or not isinstance(rollback.get("version"), str) or not rollback["version"].strip():
        blockers.append("rollback_plan_incomplete")
    monitoring = evidence.get("monitoringPlan")
    if not isinstance(monitoring, Mapping) or monitoring.get("alertingTested") is not True \
            or not isinstance(monitoring.get("version"), str) or not monitoring["version"].strip():
        blockers.append("monitoring_plan_missing")
    integration = evidence.get("integrationTestReview")
    if not isinstance(integration, Mapping) or integration.get("passed") is not True \
            or not isinstance(integration.get("version"), str) or not integration["version"].strip():
        blockers.append("integration_test_plan_missing")
    broker = evidence.get("brokerReconciliationReview")
    if not isinstance(broker, Mapping) or broker.get("passed") is not True \
            or not isinstance(broker.get("reportDigest"), str):
        blockers.append("broker_reconciliation_gates_open")
    report: dict[str, object] = {
        "reviewVersion": REVIEW_VERSION, "classification": "promotion_review_only",
        "generatedAt": generated.isoformat().replace("+00:00", "Z"),
        "stage12ReportDigest": stage12.get("reportDigest") if isinstance(stage12, Mapping) else None,
        "readyForBoundedRanking": not blockers, "blockers": blockers,
        "featureEnabled": False, "orderSubmissionAllowed": False,
        "automaticOrderAuthority": False,
    }
    report["evidenceDigest"] = _digest(evidence)
    report["assessmentDigest"] = _digest(report)
    return report


def build_decision_record(
    assessment: Mapping[str, object], *, decision: str, approver_id: str,
    recorded_at: str, attested: bool, change_control_id: str, rationale: str,
) -> dict[str, object]:
    if assessment.get("reviewVersion") != REVIEW_VERSION \
            or assessment.get("classification") != "promotion_review_only" \
            or assessment.get("featureEnabled") is not False \
            or assessment.get("orderSubmissionAllowed") is not False \
            or not _digest_matches(assessment, "assessmentDigest"):
        raise ValueError("macro_promotion_assessment_invalid")
    if decision not in DECISIONS:
        raise ValueError("macro_promotion_decision_invalid")
    if decision == "APPROVE_BOUNDED_RANKING" and assessment.get("readyForBoundedRanking") is not True:
        raise ValueError("macro_promotion_not_ready")
    if not isinstance(approver_id, str) or not approver_id.strip() or attested is not True:
        raise ValueError("macro_promotion_signoff_required")
    recorded = _instant(recorded_at)
    assessed = _instant(assessment.get("generatedAt"))
    if recorded is None or assessed is None or recorded < assessed:
        raise ValueError("macro_promotion_recorded_at_invalid")
    if not isinstance(change_control_id, str) or not change_control_id.strip():
        raise ValueError("macro_promotion_change_control_required")
    if not isinstance(rationale, str) or not rationale.strip():
        raise ValueError("macro_promotion_rationale_required")
    record: dict[str, object] = {
        "reviewVersion": REVIEW_VERSION, "assessmentDigest": assessment["assessmentDigest"],
        "evidenceDigest": assessment.get("evidenceDigest"), "decision": decision,
        "approverId": approver_id.strip(), "recordedAt": recorded_at, "attested": True,
        "changeControlId": change_control_id.strip(), "rationale": rationale.strip(),
        "boundedRankingApproved": decision == "APPROVE_BOUNDED_RANKING",
        "featureEnabled": False, "orderSubmissionAllowed": False,
        "automaticOrderAuthority": False,
    }
    record["decisionId"] = _digest(record)
    return record


def build_release_manifest(decision_record: Mapping[str, object]) -> dict[str, object]:
    if decision_record.get("reviewVersion") != REVIEW_VERSION \
            or decision_record.get("decision") != "APPROVE_BOUNDED_RANKING" \
            or decision_record.get("boundedRankingApproved") is not True \
            or decision_record.get("attested") is not True \
            or not _digest_matches(decision_record, "decisionId"):
        raise ValueError("macro_promotion_approval_required")
    return {
        "manifestVersion": "macro-bounded-ranking-release-v1",
        "decisionId": decision_record["decisionId"],
        "featureFlag": "macroBoundedRankingEnabled", "defaultEnabled": False,
        "shadowRulesetVersion": "macro-shadow-ranking-v1", "maximumAdjustmentPoints": 5,
        "requiresShadowActiveComparison": True, "requiresSeparateIntegrationTests": True,
        "rollbackPlanRequired": True, "orderSubmissionAllowed": False,
        "automaticOrderAuthority": False,
    }


class MacroPromotionJournal:
    """Append-only local record; it does not activate a release manifest."""

    def __init__(self, path: str | Path):
        if not path:
            raise ValueError("macro_promotion_journal_path_required")
        path = str(path)
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA synchronous=FULL")
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS macro_promotion_decisions (
              decision_id TEXT PRIMARY KEY,
              assessment_digest TEXT NOT NULL,
              decision TEXT NOT NULL,
              approver_id TEXT NOT NULL,
              recorded_at TEXT NOT NULL,
              record_json TEXT NOT NULL
            ) STRICT;
            CREATE UNIQUE INDEX IF NOT EXISTS one_macro_decision_per_assessment
              ON macro_promotion_decisions(assessment_digest);
            CREATE TRIGGER IF NOT EXISTS macro_promotion_no_update
              BEFORE UPDATE ON macro_promotion_decisions BEGIN
                SELECT RAISE(ABORT, 'macro_promotion_decisions_are_immutable');
              END;
            CREATE TRIGGER IF NOT EXISTS macro_promotion_no_delete
              BEFORE DELETE ON macro_promotion_decisions BEGIN
                SELECT RAISE(ABORT, 'macro_promotion_decisions_are_immutable');
              END;
            """
        )

    def append(self, record: Mapping[str, object]) -> dict[str, object]:
        if record.get("reviewVersion") != REVIEW_VERSION \
                or record.get("decision") not in DECISIONS \
                or not _digest_matches(record, "decisionId"):
            raise ValueError("macro_promotion_record_invalid")
        payload = _canonical(record)
        with self.connection:
            existing = self.connection.execute(
                "SELECT record_json FROM macro_promotion_decisions WHERE assessment_digest=?",
                (record.get("assessmentDigest"),),
            ).fetchone()
            if existing is not None:
                if existing["record_json"] != payload:
                    raise ValueError("macro_promotion_decision_already_recorded")
                return {"created": False, "record": json.loads(existing["record_json"])}
            self.connection.execute(
                "INSERT INTO macro_promotion_decisions VALUES(?,?,?,?,?,?)",
                (record["decisionId"], record["assessmentDigest"], record["decision"],
                 record["approverId"], record["recordedAt"], payload),
            )
        return {"created": True, "record": dict(record)}

    def list(self) -> list[dict[str, object]]:
        return [json.loads(row["record_json"]) for row in self.connection.execute(
            "SELECT record_json FROM macro_promotion_decisions ORDER BY recorded_at,decision_id"
        ).fetchall()]

    def close(self) -> None:
        self.connection.close()
