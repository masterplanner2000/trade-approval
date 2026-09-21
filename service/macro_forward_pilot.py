"""Supervised, research-only forward-pilot gate and evidence report."""

from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timedelta, timezone
from typing import Mapping

from macro_capture_scheduler import MacroCaptureScheduler


PILOT_VERSION = "macro-forward-pilot-v1"
REQUIRED_PROVIDERS = {"official_release", "consensus", "market_snapshot", "market_context"}
MAX_CLOCK_OFFSET_MILLISECONDS = 1_000


def _instant(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else None


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _digest(value: object) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def assess_pilot_readiness(
    universe_summary: Mapping[str, object], *, study_id: str, checked_at: str,
    worker_id: str, provider_status: Mapping[str, object], clock_offset_milliseconds: object,
) -> dict[str, object]:
    """Return every preflight blocker; this function grants no network authority."""
    checked = _instant(checked_at)
    reasons: list[str] = []
    if checked is None:
        reasons.append("checked_at_invalid")
    if not isinstance(worker_id, str) or not worker_id.strip():
        reasons.append("worker_identity_missing")
    if (isinstance(clock_offset_milliseconds, bool)
            or not isinstance(clock_offset_milliseconds, (int, float))
            or not math.isfinite(float(clock_offset_milliseconds))
            or abs(float(clock_offset_milliseconds)) > MAX_CLOCK_OFFSET_MILLISECONDS):
        reasons.append("clock_not_synchronized")
    missing_providers = sorted(REQUIRED_PROVIDERS - set(provider_status))
    if missing_providers:
        reasons.append("provider_status_incomplete")
    degraded = sorted(name for name in REQUIRED_PROVIDERS
                      if provider_status.get(name) != "READY")
    if degraded:
        reasons.append("provider_not_ready")
    active = universe_summary.get("activeStudies")
    study = next((item for item in active if isinstance(item, Mapping)
                  and item.get("studyId") == study_id), None) if isinstance(active, list) else None
    if study is None:
        reasons.append("study_not_active")
    else:
        scheduled = _instant(study.get("officialSeries", {}).get("nextScheduledAt")
                             if isinstance(study.get("officialSeries"), Mapping) else None)
        if scheduled is None:
            reasons.append("release_time_invalid")
        elif checked is not None and checked >= scheduled - timedelta(minutes=5):
            reasons.append("baseline_window_already_started")
    return {
        "pilotVersion": PILOT_VERSION,
        "classification": "research_only",
        "checkedAt": _iso(checked) if checked else None,
        "studyId": study_id,
        "workerId": worker_id if isinstance(worker_id, str) else None,
        "providerStatus": {key: provider_status.get(key) for key in sorted(REQUIRED_PROVIDERS)},
        "clockOffsetMilliseconds": clock_offset_milliseconds,
        "ready": not reasons,
        "blockers": reasons,
        "study": dict(study) if study is not None else None,
        "orderSubmissionAllowed": False,
    }


def register_ready_pilot(
    scheduler: MacroCaptureScheduler, readiness: Mapping[str, object], *, created_at: str,
    map_version: str,
) -> dict[str, object]:
    if readiness.get("pilotVersion") != PILOT_VERSION or readiness.get("ready") is not True:
        raise ValueError("macro_pilot_not_ready")
    if readiness.get("orderSubmissionAllowed") is not False:
        raise ValueError("macro_pilot_authority_invalid")
    study = readiness.get("study")
    if not isinstance(study, Mapping):
        raise ValueError("macro_pilot_study_invalid")
    official = study.get("officialSeries")
    if not isinstance(official, Mapping):
        raise ValueError("macro_pilot_study_invalid")
    return scheduler.register(
        {"eventKey": study.get("eventKey"), "scheduledAt": official.get("nextScheduledAt")},
        list(study.get("symbols") or []), created_at=created_at,
        link_version=str(study.get("linkVersion") or ""), map_version=map_version,
    )


def build_pilot_report(
    scheduler: MacroCaptureScheduler, plan_id: str, *, generated_at: str,
    provider_status: Mapping[str, object], replay_evaluations: Mapping[str, object] | None = None,
) -> dict[str, object]:
    generated = _instant(generated_at)
    if generated is None:
        raise ValueError("macro_pilot_report_time_invalid")
    plan_record = scheduler.get_plan(plan_id)
    timeline = []
    counts: dict[str, int] = {}
    unresolved = 0
    for task in plan_record["tasks"]:
        effective = str(task["effectiveState"])
        counts[effective] = counts.get(effective, 0) + 1
        if task["state"] == "CLAIMED" and task["resolution"] is None:
            unresolved += 1
        due, completed = _instant(task["dueAt"]), _instant(task["completedAt"])
        timeline.append({
            "taskId": task["taskId"], "kind": task["kind"], "symbol": task["symbol"],
            "dueAt": task["dueAt"], "lateAfter": task["lateAfter"],
            "state": task["state"], "effectiveState": effective,
            "completedAt": task["completedAt"],
            "latencyMilliseconds": (round((completed - due).total_seconds() * 1000)
                                    if due and completed else None),
            "dataSource": (task["result"].get("dataSource")
                           if isinstance(task.get("result"), Mapping) else None),
            "audit": scheduler.audit(task["taskId"]),
        })
    completed = counts.get("COMPLETED", 0) + counts.get("COMPLETED_FROM_DURABLE_EVIDENCE", 0)
    total = len(timeline)
    replay = dict(replay_evaluations or {})
    replay_match = bool(replay) and all(
        isinstance(value, Mapping) and value.get("original") is not None
        and value.get("replayed") is not None
        and _canonical(value["original"]) == _canonical(value["replayed"])
        for value in replay.values()
    )
    complete = total > 0 and completed == total and unresolved == 0 and replay_match
    report = {
        "pilotVersion": PILOT_VERSION, "classification": "research_only",
        "generatedAt": _iso(generated), "planId": plan_id, "plan": plan_record["plan"],
        "providerStatus": dict(provider_status), "taskCounts": counts,
        "totalTasks": total, "unresolvedClaims": unresolved, "timeline": timeline,
        "replay": {"evaluationCount": len(replay), "byteCanonicalMatch": replay_match},
        "complete": complete,
        "performanceEligible": complete,
        "orderSubmissionAllowed": False,
    }
    report["reportDigest"] = _digest(report)
    return report
