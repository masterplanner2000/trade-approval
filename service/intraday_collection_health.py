"""Operational coverage report for immutable intraday shadow collection."""

from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Iterable, Mapping
from zoneinfo import ZoneInfo

from intraday_capture_journal import IntradayCaptureJournal
from intraday_forward_outcomes import IntradayOutcomeJournal


NEW_YORK = ZoneInfo("America/New_York")
REPORT_VERSION = "intraday-collection-health-v1"
INTERVAL_SECONDS = 300
MIN_CAPTURE_COVERAGE_PERCENT = 90
MIN_RECORD_COMPLETENESS_PERCENT = 95
DATA = Path(__file__).resolve().parent / "data"


def _instant(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("collection_timestamp_timezone_required")
    return parsed.astimezone(timezone.utc)


def _session_bounds(day: date) -> tuple[datetime, datetime]:
    return (datetime.combine(day, time(9, 30), NEW_YORK),
            datetime.combine(day, time(16), NEW_YORK))


def _expected_slots(day: date, as_of: datetime) -> int:
    opened, closed = _session_bounds(day)
    cutoff = min(as_of.astimezone(NEW_YORK), closed)
    if cutoff < opened:
        return 0
    return min(78, int((cutoff - opened).total_seconds() // INTERVAL_SECONDS) + 1)


def build_collection_health(
    runs: Iterable[Mapping[str, object]], *, outcome_records: Iterable[Mapping[str, object]],
    as_of: datetime,
) -> dict[str, object]:
    now = as_of.astimezone(timezone.utc)
    grouped: dict[str, list[Mapping[str, object]]] = {}
    for run in runs:
        scheduled = _instant(str(run["scheduledAt"]))
        if scheduled > now:
            continue
        local = scheduled.astimezone(NEW_YORK)
        if local.weekday() >= 5 or not time(9, 30) <= local.time() < time(16):
            continue
        grouped.setdefault(local.date().isoformat(), []).append(run)

    sessions = []
    for day_text, values in sorted(grouped.items()):
        day = date.fromisoformat(day_text)
        opened, closed = _session_bounds(day)
        slots = set()
        records = []
        for run in values:
            local = _instant(str(run["scheduledAt"])).astimezone(NEW_YORK)
            slot = int((local - opened).total_seconds() // INTERVAL_SECONDS)
            if 0 <= slot < 78:
                slots.add(slot)
            records.extend(item for item in run.get("records", []) if isinstance(item, Mapping))
        expected = _expected_slots(day, now)
        complete = sum(item.get("status") in {"PASS", "REJECTED"} for item in records)
        incomplete = sum(item.get("status") == "INCOMPLETE" for item in records)
        portfolio_complete = sum(
            isinstance(item.get("envelope"), Mapping)
            and isinstance(item["envelope"].get("portfolio"), Mapping)
            and item["envelope"]["portfolio"].get("status") == "COMPLETE"
            for item in records if item.get("status") in {"PASS", "REJECTED"}
        )
        coverage = 0.0 if expected == 0 else min(100.0, len(slots) / expected * 100)
        completeness = 0.0 if not records else complete / len(records) * 100
        portfolio_rate = 0.0 if complete == 0 else portfolio_complete / complete * 100
        ended = now.astimezone(NEW_YORK) >= closed
        usable = (coverage >= MIN_CAPTURE_COVERAGE_PERCENT
                  and completeness >= MIN_RECORD_COMPLETENESS_PERCENT
                  and portfolio_rate == 100.0)
        blockers = []
        if coverage < MIN_CAPTURE_COVERAGE_PERCENT:
            blockers.append("capture_coverage_below_threshold")
        if completeness < MIN_RECORD_COMPLETENESS_PERCENT:
            blockers.append("record_completeness_below_threshold")
        if portfolio_rate < 100:
            blockers.append("portfolio_context_incomplete")
        sessions.append({
            "sessionDate": day_text, "state": "CLOSED" if ended else "IN_PROGRESS",
            "status": "USABLE" if usable else "DEGRADED",
            "expectedCaptureSlots": expected, "observedCaptureSlots": len(slots),
            "coveragePercent": round(coverage, 2), "recordCount": len(records),
            "completeRecordCount": complete, "incompleteRecordCount": incomplete,
            "recordCompletenessPercent": round(completeness, 2),
            "portfolioCompletenessPercent": round(portfolio_rate, 2),
            "blockers": blockers,
        })
    usable_dates = {str(item["sessionDate"]) for item in sessions
                    if item["state"] == "CLOSED" and item["status"] == "USABLE"}
    outcome_dates = {
        _instant(str(item["sourceScheduledAt"])).astimezone(NEW_YORK).date().isoformat()
        for item in outcome_records
        if item.get("status") == "COMPLETE" and isinstance(item.get("sourceScheduledAt"), str)
    }
    qualified_dates = sorted(usable_dates & outcome_dates)
    return {
        "reportVersion": REPORT_VERSION, "generatedAt": now.isoformat().replace("+00:00", "Z"),
        "status": "HEALTHY" if sessions and sessions[-1]["status"] == "USABLE" else "DEGRADED",
        "sessions": sessions, "usableClosedSessions": len(usable_dates),
        "forwardOutcomeDistinctSessions": len(outcome_dates),
        "qualifiedSessionDates": qualified_dates,
        "qualifiedDistinctSessionsForReview": len(qualified_dates),
        "minimumDistinctSessionsForReview": 20,
        "sessionsRemainingForReview": max(0, 20 - len(qualified_dates)),
        "classification": "operational_research_health",
        "recommendationAllowed": False, "orderSubmissionAllowed": False,
    }


def live_report(as_of: datetime | None = None) -> dict[str, object]:
    captures = IntradayCaptureJournal(DATA / "intraday-captures.sqlite3")
    outcomes = IntradayOutcomeJournal(DATA / "intraday-outcomes.sqlite3")
    try:
        return build_collection_health(captures.runs(), outcome_records=outcomes.list(),
                                       as_of=as_of or datetime.now(timezone.utc))
    finally:
        captures.close()
        outcomes.close()


if __name__ == "__main__":
    print(json.dumps({"ok": True, **live_report()}))
