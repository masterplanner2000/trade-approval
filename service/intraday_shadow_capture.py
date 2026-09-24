"""Scheduled read-only orchestration for the intraday shadow pipeline."""

from __future__ import annotations

import json
import sys
from datetime import datetime, time, timezone
from pathlib import Path
from typing import Callable, Mapping
from zoneinfo import ZoneInfo

from alpaca_market_cache import api_json, credentials, data_feed
from intraday_capture_journal import IntradayCaptureJournal
from intraday_forward_outcomes import IntradayOutcomeJournal, build_mature_outcomes
from intraday_opportunity_score import score_intraday_opportunity
from intraday_portfolio_context import IbkrPaperPortfolioReader
from intraday_price_signals import calculate_intraday_price_signals, expected_range_at
from intraday_provider_contract import build_intraday_research_snapshot
from intraday_safety_filters import evaluate_intraday_safety
from intraday_shadow_evaluator import evaluate_intraday_snapshot
from intraday_shadow_journal import IntradayShadowJournal
from intraday_volume_profile import volume_context_at
from intraday_volume_profile_job import fetch_minute_bars
from macro_provider_adapters import AlpacaSnapshotClient
from nasdaq_halt_status import NasdaqHaltClient


NEW_YORK = ZoneInfo("America/New_York")
DATA = Path(__file__).resolve().parent / "data"
PROFILE_PATH = DATA / "intraday-volume-profiles.json"
CAPTURE_PATH = DATA / "intraday-captures.sqlite3"
SHADOW_PATH = DATA / "intraday-shadow.sqlite3"
OUTCOME_PATH = DATA / "intraday-outcomes.sqlite3"
PIPELINE_VERSION = "intraday-shadow-capture-v1"


def iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def regular_session(value: datetime) -> bool:
    local = value.astimezone(NEW_YORK)
    return local.weekday() < 5 and time(9, 30) <= local.time() < time(16)


def load_profiles(path: Path = PROFILE_PATH) -> dict[str, Mapping[str, object]]:
    try:
        payload = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        raise ValueError("intraday_profiles_unavailable") from None
    profiles = payload.get("profiles") if isinstance(payload, Mapping) else None
    if not isinstance(profiles, Mapping) or not profiles:
        raise ValueError("intraday_profiles_unavailable")
    return {str(symbol): profile for symbol, profile in profiles.items()
            if isinstance(profile, Mapping)}


def capture_cycle(
    *, scheduled_at: datetime, profiles: Mapping[str, Mapping[str, object]],
    snapshot_reader: Callable[[str], Mapping[str, object]],
    bars_reader: Callable[[str, datetime, datetime], list[dict[str, object]]],
    halt_reader: Callable[[list[str], str], Mapping[str, Mapping[str, object]]],
    portfolio_reader: Callable[[str, str, Mapping[str, object]], Mapping[str, object]],
    capture_journal: IntradayCaptureJournal, shadow_journal: IntradayShadowJournal,
    outcome_journal: IntradayOutcomeJournal | None = None,
    completed_at: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
) -> dict[str, object]:
    scheduled_at = scheduled_at.astimezone(timezone.utc)
    if not regular_session(scheduled_at):
        return {"ok": True, "skipped": True, "reason": "outside_regular_session",
                "scheduledAt": iso(scheduled_at)}
    symbols = sorted(profiles)
    halt_failure = None
    try:
        halt_evidence = halt_reader(symbols, iso(scheduled_at))
    except Exception:  # The shared dependency must not erase the scheduled run.
        halt_evidence = {}
        halt_failure = "halt_evidence_unavailable"
    records = []
    for symbol in symbols:
        envelope: dict[str, object] = {
            "pipelineVersion": PIPELINE_VERSION, "symbol": symbol,
            "scheduledAt": iso(scheduled_at), "classification": "research_only",
            "recommendationAllowed": False, "orderSubmissionAllowed": False,
        }
        status = "INCOMPLETE"
        try:
            if halt_failure:
                raise RuntimeError(halt_failure)
            profile = profiles[symbol]
            market = dict(snapshot_reader(symbol))
            halt = dict(halt_evidence[symbol])
            context = volume_context_at(
                profile, observed_at=str(market["observedAt"]), halted=bool(halt["halted"]),
                halt_data_source=str(halt["dataSource"]),
            )
            snapshot = build_intraday_research_snapshot(market, context)
            evaluated_at = completed_at().astimezone(timezone.utc)
            evaluation = evaluate_intraday_snapshot(snapshot, now=iso(evaluated_at))
            local_day = scheduled_at.astimezone(NEW_YORK).date()
            start = datetime.combine(local_day, time(9, 30), NEW_YORK).astimezone(timezone.utc)
            bars = bars_reader(symbol, start, scheduled_at)
            price = calculate_intraday_price_signals(
                symbol, bars, observed_at=str(market["observedAt"]),
                current_price=float(market["last"]),
                expected_range_percent=expected_range_at(
                    profile, observed_at=str(market["observedAt"])),
                data_source=f"Alpaca {market['feed']} current-session 1Min bars",
            )
            score = score_intraday_opportunity(evaluation, price)
            portfolio = dict(portfolio_reader(symbol, iso(evaluated_at), market))
            safety = evaluate_intraday_safety(
                evaluation, price, score, halt, portfolio, now=iso(evaluated_at),
            )
            journaled = shadow_journal.append(snapshot, evaluated_at=iso(evaluated_at))
            envelope.update({
                "profileIdentity": {
                    "volumeVersion": profile.get("profileVersion"),
                    "volumeDigest": profile.get("inputDigest"),
                    "priceVersion": profile.get("priceProfileVersion"),
                    "priceDigest": profile.get("priceProfileInputDigest"),
                },
                "market": market, "halt": halt, "snapshot": snapshot,
                "evaluation": evaluation, "priceSignals": price, "score": score,
                "portfolio": portfolio, "safety": safety,
                "shadowObservationId": journaled["observationId"],
            })
            status = "PASS" if safety["shadowEligible"] else "REJECTED"
        except (KeyError, TypeError, ValueError, RuntimeError) as error:
            envelope["error"] = str(error)
        records.append({"symbol": symbol, "status": status, "envelope": envelope})
    finished = completed_at().astimezone(timezone.utc)
    run = capture_journal.append_run(
        scheduled_at=iso(scheduled_at), completed_at=iso(finished), records=records,
    )
    outcome_result = None
    if outcome_journal is not None:
        mature = build_mature_outcomes(capture_journal.runs(through=iso(scheduled_at)),
                                       as_of=scheduled_at)
        outcome_result = {**outcome_journal.append_many(mature),
                          "summary": outcome_journal.summary()}
    return {"ok": True, "skipped": False, "runId": run["runId"], **run["summary"],
            "outcomes": outcome_result}


def run_live(now: datetime | None = None) -> dict[str, object]:
    scheduled = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    if not regular_session(scheduled):
        return {"ok": True, "skipped": True, "reason": "outside_regular_session",
                "scheduledAt": iso(scheduled)}
    profiles = load_profiles()
    key, secret = credentials()
    feed = data_feed()
    snapshot_client = AlpacaSnapshotClient(api_key=key, api_secret=secret, feed=feed)
    halt_client = NasdaqHaltClient()
    portfolio_reader = IbkrPaperPortfolioReader()
    portfolio_reader.prime()
    capture_journal = IntradayCaptureJournal(CAPTURE_PATH)
    shadow_journal = IntradayShadowJournal(SHADOW_PATH)
    outcome_journal = IntradayOutcomeJournal(OUTCOME_PATH)
    try:
        return capture_cycle(
            scheduled_at=scheduled, profiles=profiles,
            snapshot_reader=snapshot_client.fetch,
            bars_reader=lambda symbol, start, end: fetch_minute_bars(
                symbol, start=iso(start), end=iso(end), feed=feed, reader=api_json),
            halt_reader=lambda symbols, observed: halt_client.fetch_many(symbols, observed_at=observed),
            portfolio_reader=portfolio_reader.context,
            capture_journal=capture_journal, shadow_journal=shadow_journal,
            outcome_journal=outcome_journal,
        )
    finally:
        capture_journal.close()
        shadow_journal.close()
        outcome_journal.close()


def status() -> dict[str, object]:
    journal = IntradayCaptureJournal(CAPTURE_PATH)
    outcomes = IntradayOutcomeJournal(OUTCOME_PATH)
    try:
        latest = journal.latest()
        return {"ok": latest is not None, "latest": latest,
                "outcomes": outcomes.summary()}
    finally:
        journal.close()
        outcomes.close()


def main() -> int:
    command = sys.argv[1] if len(sys.argv) > 1 else "capture"
    try:
        result = run_live() if command == "capture" else status() if command == "status" else None
        if result is None:
            raise ValueError("usage: capture|status")
        print(json.dumps(result))
        return 0 if result.get("ok") else 1
    except (ValueError, RuntimeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
