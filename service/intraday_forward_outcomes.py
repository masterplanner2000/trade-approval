"""Immutable fixed-horizon outcomes for scheduled intraday shadow captures."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from typing import Iterable, Mapping
from zoneinfo import ZoneInfo


SCHEMA_VERSION = 1
OUTCOME_VERSION = "intraday-forward-outcome-v1"
COST_MODEL_VERSION = "spread-plus-2bps-per-leg-plus-1bp-roundtrip-v1"
HORIZONS_SECONDS = (300, 1800)
MAX_LATENESS_SECONDS = 120
SLIPPAGE_BPS_PER_LEG = 2.0
ROUND_TRIP_FEE_BPS = 1.0
NEW_YORK = ZoneInfo("America/New_York")


def canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def instant(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timezone_required")
    return parsed.astimezone(timezone.utc)


def iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _valid_market(record: Mapping[str, object]) -> dict[str, float] | None:
    envelope = record.get("envelope")
    market = envelope.get("market") if isinstance(envelope, Mapping) else None
    if not isinstance(market, Mapping):
        return None
    values = {name: market.get(name) for name in ("last", "bid", "ask")}
    if not all(isinstance(value, (int, float)) and float(value) > 0 for value in values.values()):
        return None
    if float(values["bid"]) > float(values["ask"]):
        return None
    return {name: float(value) for name, value in values.items()}


def _within_regular_session(value: datetime) -> bool:
    local = value.astimezone(NEW_YORK)
    return local.weekday() < 5 and time(9, 30) <= local.time() < time(16)


def _percent(entry: float, exit_price: float) -> float:
    return round((exit_price / entry - 1) * 100, 4)


def build_mature_outcomes(
    runs: Iterable[Mapping[str, object]], *, as_of: datetime,
    horizons_seconds: tuple[int, ...] = HORIZONS_SECONDS,
    maximum_lateness_seconds: int = MAX_LATENESS_SECONDS,
) -> list[dict[str, object]]:
    """Build only outcomes whose future evidence window has matured."""
    now = as_of.astimezone(timezone.utc)
    observations: list[dict[str, object]] = []
    for run in runs:
        scheduled = instant(str(run["scheduledAt"]))
        if scheduled > now:
            continue
        for record in run.get("records", []):
            market = _valid_market(record)
            if market is not None:
                observations.append({
                    "scheduled": scheduled, "scheduledAt": iso(scheduled),
                    "recordId": record["recordId"], "symbol": record["symbol"],
                    "sourceStatus": record["status"], "market": market,
                    "envelope": record["envelope"],
                })
    observations.sort(key=lambda item: (item["scheduled"], item["symbol"], item["recordId"]))
    by_symbol: dict[str, list[dict[str, object]]] = {}
    for item in observations:
        by_symbol.setdefault(str(item["symbol"]), []).append(item)

    outcomes: list[dict[str, object]] = []
    for source in observations:
        for seconds in horizons_seconds:
            target = source["scheduled"] + timedelta(seconds=seconds)
            if not _within_regular_session(target):
                continue
            deadline = target + timedelta(seconds=maximum_lateness_seconds)
            candidates = [item for item in by_symbol[str(source["symbol"])]
                          if target <= item["scheduled"] <= deadline]
            target_item = candidates[0] if candidates else None
            if target_item is None and now <= deadline:
                continue
            label = f"{seconds // 60}m"
            base = {
                "outcomeVersion": OUTCOME_VERSION,
                "sourceRecordId": source["recordId"], "symbol": source["symbol"],
                "sourceStatus": source["sourceStatus"],
                "sourceScheduledAt": source["scheduledAt"], "horizon": label,
                "targetAt": iso(target), "deadlineAt": iso(deadline),
                "classification": "research_observation_only",
                "recommendationAllowed": False, "orderSubmissionAllowed": False,
            }
            if target_item is None:
                outcomes.append({**base, "status": "INCOMPLETE",
                                 "missing": ["target_observation"]})
                continue
            entry_last = source["market"]["last"]
            exit_last = target_item["market"]["last"]
            estimated_entry = source["market"]["ask"] * (1 + SLIPPAGE_BPS_PER_LEG / 10_000)
            estimated_exit = target_item["market"]["bid"] * (1 - SLIPPAGE_BPS_PER_LEG / 10_000)
            after_cost = (estimated_exit / estimated_entry - 1) * 100 - ROUND_TRIP_FEE_BPS / 100
            envelope = source["envelope"]
            outcomes.append({
                **base, "status": "COMPLETE", "missing": [],
                "targetRecordId": target_item["recordId"],
                "targetObservedAt": target_item["scheduledAt"],
                "entryReference": {**source["market"], "scheduledAt": source["scheduledAt"]},
                "exitReference": {**target_item["market"], "scheduledAt": target_item["scheduledAt"]},
                "grossLastReturnPercent": _percent(entry_last, exit_last),
                "estimatedAfterCostReturnPercent": round(after_cost, 4),
                "costModel": {
                    "version": COST_MODEL_VERSION,
                    "entryReference": "ask", "exitReference": "bid",
                    "slippageBpsPerLeg": SLIPPAGE_BPS_PER_LEG,
                    "roundTripFeeBps": ROUND_TRIP_FEE_BPS,
                },
                "sourceScore": envelope.get("score"),
                "sourceSafety": envelope.get("safety"),
            })
    return outcomes


class IntradayOutcomeJournal:
    def __init__(self, path: str | Path):
        if not path:
            raise ValueError("outcome_journal_path_required")
        path = str(path)
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA synchronous=FULL")
        self.connection.executescript("""
        CREATE TABLE IF NOT EXISTS outcome_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS intraday_outcomes(
          outcome_id TEXT PRIMARY KEY, source_record_id TEXT NOT NULL, symbol TEXT NOT NULL,
          horizon TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL,
          UNIQUE(source_record_id,horizon)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS intraday_outcomes_symbol ON intraday_outcomes(symbol,horizon,status);
        CREATE TRIGGER IF NOT EXISTS intraday_outcomes_no_update BEFORE UPDATE ON intraday_outcomes BEGIN
          SELECT RAISE(ABORT,'intraday_outcomes_are_immutable'); END;
        CREATE TRIGGER IF NOT EXISTS intraday_outcomes_no_delete BEFORE DELETE ON intraday_outcomes BEGIN
          SELECT RAISE(ABORT,'intraday_outcomes_are_immutable'); END;
        """)
        version = self.connection.execute(
            "SELECT value FROM outcome_meta WHERE key='schema_version'"
        ).fetchone()
        if version is None:
            self.connection.execute("INSERT INTO outcome_meta VALUES('schema_version',?)",
                                    (str(SCHEMA_VERSION),))
            self.connection.commit()
        elif version["value"] != str(SCHEMA_VERSION):
            raise RuntimeError("unsupported_intraday_outcome_schema")

    def append_many(self, outcomes: Iterable[Mapping[str, object]]) -> dict[str, int]:
        created = duplicates = 0
        with self.connection:
            for value in outcomes:
                payload = dict(value)
                source_id, horizon = payload.get("sourceRecordId"), payload.get("horizon")
                if (not isinstance(source_id, str) or not source_id
                        or not isinstance(horizon, str) or not horizon
                        or payload.get("status") not in {"COMPLETE", "INCOMPLETE"}):
                    raise ValueError("intraday_outcome_invalid")
                outcome_id = hashlib.sha256(canonical({"sourceRecordId": source_id,
                                                       "horizon": horizon}).encode()).hexdigest()
                existing = self.connection.execute(
                    "SELECT payload_json FROM intraday_outcomes WHERE outcome_id=?", (outcome_id,)
                ).fetchone()
                if existing is not None:
                    if existing["payload_json"] != canonical(payload):
                        raise ValueError("intraday_outcome_conflict")
                    duplicates += 1
                    continue
                self.connection.execute(
                    "INSERT INTO intraday_outcomes VALUES(?,?,?,?,?,?)",
                    (outcome_id, source_id, payload["symbol"], horizon,
                     payload["status"], canonical(payload)),
                )
                created += 1
        return {"created": created, "duplicates": duplicates, "total": created + duplicates}

    def list(self) -> list[dict[str, object]]:
        rows = self.connection.execute(
            "SELECT outcome_id,payload_json FROM intraday_outcomes ORDER BY symbol,source_record_id,horizon"
        ).fetchall()
        return [{"outcomeId": row["outcome_id"], **json.loads(row["payload_json"])} for row in rows]

    def summary(self) -> dict[str, object]:
        items = self.list()
        counts = {status: sum(item["status"] == status for item in items)
                  for status in ("COMPLETE", "INCOMPLETE")}
        cohorts: dict[str, dict[str, object]] = {}
        for item in items:
            key = f"{item['sourceStatus']}:{item['horizon']}"
            cohort = cohorts.setdefault(key, {"complete": 0, "incomplete": 0,
                                              "grossReturns": [], "afterCostReturns": [],
                                              "sessions": set()})
            cohort[item["status"].lower()] = int(cohort[item["status"].lower()]) + 1
            if item["status"] == "COMPLETE":
                cohort["grossReturns"].append(float(item["grossLastReturnPercent"]))
                cohort["afterCostReturns"].append(float(item["estimatedAfterCostReturnPercent"]))
                session = instant(str(item["sourceScheduledAt"])).astimezone(NEW_YORK).date().isoformat()
                cohort["sessions"].add(session)
        reported: dict[str, dict[str, object]] = {}
        for key, cohort in cohorts.items():
            gross = cohort["grossReturns"]
            after_cost = cohort["afterCostReturns"]
            sessions = cohort["sessions"]
            reported[key] = {
                "complete": cohort["complete"], "incomplete": cohort["incomplete"],
                "distinctSessions": len(sessions),
                "averageGrossReturnPercent": None if not gross else round(sum(gross) / len(gross), 4),
                "averageAfterCostReturnPercent": None if not after_cost else round(sum(after_cost) / len(after_cost), 4),
                "positiveAfterCostRatePercent": None if not after_cost else round(
                    sum(value > 0 for value in after_cost) / len(after_cost) * 100, 2),
                "adequateSample": len(sessions) >= 20,
            }
        return {"outcomeVersion": OUTCOME_VERSION, "outcomeCount": len(items),
                "statusCounts": counts, "cohorts": reported,
                "minimumDistinctSessionsForReview": 20,
                "classification": "research_observation_only",
                "orderSubmissionAllowed": False}

    def close(self) -> None:
        self.connection.close()
