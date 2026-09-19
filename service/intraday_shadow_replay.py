"""Recorded-data import and outcome reporting for intraday shadow research."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable
from zoneinfo import ZoneInfo

from intraday_shadow_journal import IntradayShadowJournal


REPORT_VERSION = "intraday-shadow-outcomes-v1"
DEFAULT_HORIZONS_SECONDS = (300, 1800)
MAX_HORIZON_LATENESS_SECONDS = 60
MARKET_TIMEZONE = ZoneInfo("America/New_York")


def instant(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timezone_required")
    return parsed.astimezone(timezone.utc)


def load_jsonl(path: str | Path) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    for line_number, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as error:
            raise ValueError(f"invalid_jsonl_line_{line_number}") from error
        if not isinstance(value, dict) or not isinstance(value.get("snapshot"), dict):
            raise ValueError(f"invalid_snapshot_line_{line_number}")
        evaluated_at = value.get("evaluatedAt")
        if not isinstance(evaluated_at, str):
            raise ValueError(f"invalid_evaluated_at_line_{line_number}")
        instant(evaluated_at)
        source = value["snapshot"].get("dataSource")
        if not isinstance(source, str) or not source.strip():
            raise ValueError(f"invalid_data_source_line_{line_number}")
        if value["snapshot"].get("volumeScope") not in {"consolidated", "single_venue", "unknown"}:
            raise ValueError(f"invalid_volume_scope_line_{line_number}")
        records.append({"snapshot": value["snapshot"], "evaluatedAt": evaluated_at})
    if not records:
        raise ValueError("recorded_snapshot_file_empty")
    return records


def import_jsonl(path: str | Path, journal: IntradayShadowJournal) -> dict[str, object]:
    """Validate the complete file before making idempotent journal appends."""
    records = load_jsonl(path)
    results = [journal.append(item["snapshot"], evaluated_at=item["evaluatedAt"]) for item in records]
    return {
        "records": len(results),
        "created": sum(1 for item in results if item["created"]),
        "duplicates": sum(1 for item in results if not item["created"]),
        "observationIds": [item["observationId"] for item in results],
    }


def _return(entry: float, later: float) -> float:
    return round((later / entry - 1) * 100, 4)


def _first_at_horizon(items: list[dict[str, object]], target: datetime, maximum_lateness: int):
    latest = target + timedelta(seconds=maximum_lateness)
    return next((item for item in items if target <= instant(item["observedAt"]) <= latest), None)


def build_outcome_report(
    replayed: Iterable[dict[str, object]], *, horizons_seconds: tuple[int, ...] = DEFAULT_HORIZONS_SECONDS,
    maximum_lateness_seconds: int = MAX_HORIZON_LATENESS_SECONDS,
) -> dict[str, object]:
    """Measure observations, not fills; select the first eligible signal per session."""
    timeline = sorted(replayed, key=lambda item: (item["observedAt"], item["symbol"], item["observationId"]))
    complete = [item for item in timeline if item.get("deterministic") is True]
    grouped: dict[tuple[str, str], list[dict[str, object]]] = {}
    for item in complete:
        session_date = instant(str(item["observedAt"])).astimezone(MARKET_TIMEZONE).date().isoformat()
        grouped.setdefault((item["symbol"], session_date), []).append(item)

    outcomes: list[dict[str, object]] = []
    for (symbol, session_date), items in sorted(grouped.items()):
        signal = next((item for item in items if item["evaluation"].get("eligible") is True), None)
        if signal is None:
            continue
        signal_time = instant(signal["observedAt"])
        entry = float(signal["snapshot"]["lastPrice"])
        subsequent = [item for item in items if instant(item["observedAt"]) > signal_time
                      and isinstance(item["snapshot"].get("lastPrice"), (int, float))]
        horizons: dict[str, object] = {}
        missing: list[str] = []
        for seconds in horizons_seconds:
            observed = _first_at_horizon(subsequent, signal_time + timedelta(seconds=seconds), maximum_lateness_seconds)
            label = f"{seconds // 60}m"
            if observed is None:
                horizons[label] = None
                missing.append(label)
            else:
                price = float(observed["snapshot"]["lastPrice"])
                horizons[label] = {"observedAt": observed["observedAt"], "price": price,
                                   "returnPercent": _return(entry, price)}
        later_prices = [float(item["snapshot"]["lastPrice"]) for item in subsequent]
        last = subsequent[-1] if subsequent else None
        outcomes.append({
            "symbol": symbol, "sessionDate": session_date,
            "signalObservationId": signal["observationId"], "signalObservedAt": signal["observedAt"],
            "entryReferencePrice": entry, "selectionRule": "first_eligible_observation",
            "horizons": horizons,
            "lastObserved": None if last is None else {
                "observedAt": last["observedAt"], "price": float(last["snapshot"]["lastPrice"]),
                "returnPercent": _return(entry, float(last["snapshot"]["lastPrice"])),
            },
            "maximumFavorableExcursionPercent": round(max((_return(entry, price) for price in later_prices), default=0.0), 4),
            "maximumAdverseExcursionPercent": round(min((_return(entry, price) for price in later_prices), default=0.0), 4),
            "status": "COMPLETE" if not missing and last is not None else "INCOMPLETE",
            "missing": missing + ([] if last is not None else ["subsequent_observation"]),
        })

    return {
        "reportVersion": REPORT_VERSION,
        "classification": "research_observation_only",
        "orderSubmissionAllowed": False,
        "observationCount": len(timeline),
        "deterministicObservationCount": len(complete),
        "unsupportedOrChangedObservationCount": len(timeline) - len(complete),
        "outcomeCount": len(outcomes),
        "outcomes": outcomes,
        "limitations": [
            "Reference prices are observations, not executable fills.",
            "Returns exclude spread, slippage, fees, taxes and market impact.",
            "Last observed is not asserted to be the official closing price.",
            "This report does not establish expected return or strategy profitability.",
        ],
    }
