"""Supervised read-only executor for durable macro capture tasks."""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Mapping, Protocol

from macro_capture_scheduler import MacroCaptureScheduler


WORKER_VERSION = "macro-capture-worker-v1"
VOLUME_SCOPES = {"consolidated", "single_venue", "unknown"}


class ReadOnlyCaptureAdapter(Protocol):
    def capture_release(self, task: Mapping[str, object], plan: Mapping[str, object]) -> Mapping[str, object]: ...
    def capture_market(self, task: Mapping[str, object], plan: Mapping[str, object]) -> Mapping[str, object]: ...


def _instant(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(timezone.utc)


def _number(value: object, *, allow_zero: bool = False) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    result = float(value)
    if not math.isfinite(result) or result < 0 or (result == 0 and not allow_zero):
        return None
    return result


def validate_capture_result(task: Mapping[str, object], result: Mapping[str, object]) -> dict[str, object]:
    if not isinstance(result, Mapping):
        raise ValueError("macro_capture_result_invalid")
    if _instant(result.get("observedAt")) is None:
        raise ValueError("macro_capture_result_time_invalid")
    source = result.get("dataSource")
    if not isinstance(source, str) or not source.strip():
        raise ValueError("macro_capture_result_source_invalid")
    normalized = dict(result)
    normalized["workerVersion"] = WORKER_VERSION
    plan = task.get("plan") if isinstance(task.get("plan"), Mapping) else {}
    if (result.get("linkVersion") != plan.get("linkVersion")
            or result.get("mapVersion") != plan.get("mapVersion")):
        raise ValueError("macro_capture_pinned_version_mismatch")
    kind = task.get("kind")
    if kind == "release":
        official, consensus = result.get("official"), result.get("consensus")
        if (not isinstance(official, Mapping) or official.get("eventKey") != plan.get("eventKey")
                or official.get("primarySourceVerified") is not True):
            raise ValueError("macro_capture_official_release_invalid")
        if (not isinstance(consensus, Mapping) or not consensus.get("eventKey")
                or not consensus.get("status")):
            raise ValueError("macro_capture_consensus_release_invalid")
        normalized["official"] = dict(official)
        normalized["consensus"] = dict(consensus)
        return normalized
    if kind not in {"baseline", "reaction_1m", "reaction_5m", "reaction_30m"}:
        raise ValueError("macro_capture_task_kind_invalid")
    if result.get("symbol") != task.get("symbol"):
        raise ValueError("macro_capture_symbol_mismatch")
    if result.get("volumeScope") not in VOLUME_SCOPES:
        raise ValueError("macro_capture_volume_scope_invalid")
    quote = result.get("quote")
    if not isinstance(quote, Mapping):
        raise ValueError("macro_capture_quote_invalid")
    bid, ask, last = (_number(quote.get(name)) for name in ("bid", "ask", "last"))
    volume = _number(quote.get("sessionVolume"), allow_zero=True)
    expected_volume = _number(quote.get("expectedVolume"))
    previous_close = _number(quote.get("previousClose"))
    atr = _number(quote.get("atrPercent14"))
    if (None in {bid, ask, last, volume, expected_volume, previous_close, atr}
            or bid > ask or not isinstance(quote.get("halted"), bool)):
        raise ValueError("macro_capture_quote_invalid")
    normalized["quote"] = dict(quote)
    return normalized


class MacroCaptureWorker:
    """Runs already-due tasks; it owns no timer and has no order authority."""

    def __init__(self, scheduler: MacroCaptureScheduler, adapter: ReadOnlyCaptureAdapter, *, worker_id: str):
        if not worker_id or not worker_id.strip():
            raise ValueError("macro_capture_worker_id_required")
        self.scheduler = scheduler
        self.adapter = adapter
        self.worker_id = worker_id

    def run_once(self, *, now: str, limit: int = 20) -> dict[str, object]:
        if _instant(now) is None:
            raise ValueError("macro_capture_worker_time_invalid")
        claimed = self.scheduler.claim_due(now=now, worker_id=self.worker_id, limit=limit)
        outcomes = []
        for task in claimed:
            plan = self.scheduler.get_plan(str(task["planId"]))["plan"]
            task_with_plan = {**task, "plan": plan}
            try:
                raw = (self.adapter.capture_release(task_with_plan, plan) if task["kind"] == "release"
                       else self.adapter.capture_market(task_with_plan, plan))
                result = validate_capture_result(task_with_plan, raw)
                finished = self.scheduler.finish(
                    str(task["taskId"]), worker_id=self.worker_id, completed_at=now,
                    status="COMPLETED", result=result,
                )
            except Exception as error:
                # Never persist provider messages: they may contain URLs, keys or payloads.
                failure = {"reason": "capture_failed", "errorType": type(error).__name__,
                           "workerVersion": WORKER_VERSION}
                finished = self.scheduler.finish(
                    str(task["taskId"]), worker_id=self.worker_id, completed_at=now,
                    status="FAILED", result=failure,
                )
            outcomes.append(finished)
        return {
            "workerVersion": WORKER_VERSION, "workerId": self.worker_id,
            "claimedCount": len(claimed),
            "completedCount": sum(item["state"] == "COMPLETED" for item in outcomes),
            "failedCount": sum(item["state"] == "FAILED" for item in outcomes),
            "outcomes": outcomes,
        }
