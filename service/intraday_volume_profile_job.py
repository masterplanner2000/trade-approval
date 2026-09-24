"""Fetch and persist research-only intraday cumulative-volume profiles."""

from __future__ import annotations

import json
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from alpaca_market_cache import BARS_URL, api_json, data_feed
from intraday_price_signals import build_intraday_range_profile
from intraday_volume_profile import build_cumulative_volume_profile


OUTPUT_PATH = Path(__file__).resolve().parent / "data" / "intraday-volume-profiles.json"
HISTORY_CALENDAR_DAYS = 70


def _profile_session_through(profile: object) -> str:
    if not isinstance(profile, dict):
        raise ValueError("intraday_profile_artifact_invalid")
    volume_dates = profile.get("sessionDates")
    price_dates = profile.get("priceProfileSessionDates")
    if (not isinstance(volume_dates, list) or not volume_dates
            or any(not isinstance(value, str) for value in volume_dates)
            or volume_dates != price_dates):
        raise ValueError("intraday_profile_sessions_mismatch")
    return volume_dates[-1]


def load_profile_artifact(path: Path = OUTPUT_PATH) -> dict[str, object]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise ValueError("intraday_profile_artifact_unavailable") from None
    profiles = payload.get("profiles") if isinstance(payload, dict) else None
    if (payload.get("formatVersion") != 1 or payload.get("feed") not in {"iex", "sip"}
            or not isinstance(profiles, dict) or not profiles
            or payload.get("failures") not in ({}, None)):
        raise ValueError("intraday_profile_artifact_invalid")
    for symbol, profile in profiles.items():
        if (not isinstance(symbol, str) or not isinstance(profile, dict)
                or profile.get("symbol") != symbol):
            raise ValueError("intraday_profile_artifact_invalid")
        _profile_session_through(profile)
    return payload


def fetch_minute_bars(
    symbol: str, *, start: str, end: str, feed: str,
    reader: Callable[[str, dict[str, object]], object] = api_json,
) -> list[dict[str, object]]:
    collected: list[dict[str, object]] = []
    page_token: str | None = None
    while True:
        payload = reader(BARS_URL, {
            "symbols": symbol, "timeframe": "1Min", "start": start, "end": end,
            "limit": 10_000, "adjustment": "all", "feed": feed, "sort": "asc",
            "page_token": page_token,
        })
        if not isinstance(payload, dict) or not isinstance(payload.get("bars"), dict):
            raise RuntimeError("alpaca_intraday_bars_invalid_response")
        bars = payload["bars"].get(symbol, [])
        if not isinstance(bars, list) or any(not isinstance(bar, dict) for bar in bars):
            raise RuntimeError("alpaca_intraday_bars_invalid_response")
        collected.extend(bars)
        token = payload.get("next_page_token")
        if token is not None and not isinstance(token, str):
            raise RuntimeError("alpaca_intraday_bars_invalid_response")
        page_token = token or None
        if page_token is None:
            return collected


def refresh_profiles(
    symbols: list[str], *, now: datetime | None = None, output_path: Path = OUTPUT_PATH,
    reader: Callable[[str, dict[str, object]], object] = api_json,
    feed: str | None = None,
) -> dict[str, object]:
    observed = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    selected_feed = feed or data_feed()
    if selected_feed not in {"iex", "sip"}:
        raise RuntimeError("alpaca_data_feed_invalid")
    normalized = list(dict.fromkeys(symbol.strip().upper() for symbol in symbols if symbol.strip()))
    if not normalized or any(not symbol.replace(".", "").replace("-", "").isalnum()
                             for symbol in normalized):
        raise RuntimeError("intraday_profile_symbols_invalid")
    start = (observed - timedelta(days=HISTORY_CALENDAR_DAYS)).isoformat()
    end = observed.isoformat()
    as_of = observed.isoformat().replace("+00:00", "Z")
    profiles: dict[str, object] = {}
    failures: dict[str, str] = {}
    for symbol in normalized:
        try:
            bars = fetch_minute_bars(
                symbol, start=start, end=end, feed=selected_feed, reader=reader,
            )
            volume_profile = build_cumulative_volume_profile(
                symbol, bars, as_of=as_of,
                data_source=f"Alpaca {selected_feed.upper()} historical 1Min bars",
            )
            price_profile = build_intraday_range_profile(
                symbol, bars, as_of=as_of,
                data_source=f"Alpaca {selected_feed.upper()} historical 1Min bars",
            )
            profiles[symbol] = {**volume_profile, **price_profile}
        except (RuntimeError, ValueError) as error:
            failures[symbol] = str(error)
    result = {
        "formatVersion": 1,
        "generatedAt": as_of,
        "feed": selected_feed,
        "volumeScope": "consolidated" if selected_feed == "sip" else "single_venue",
        "profiles": profiles,
        "failures": failures,
        "classification": "research_only",
        "recommendationAllowed": False,
        "orderSubmissionAllowed": False,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_suffix(f"{output_path.suffix}.tmp")
    temporary.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    temporary.replace(output_path)
    return result


def refresh_existing_profiles(
    *, now: datetime | None = None, output_path: Path = OUTPUT_PATH,
    reader: Callable[[str, dict[str, object]], object] = api_json,
) -> dict[str, object]:
    """Replace the live artifact only after the entire frozen profile set validates."""
    previous = load_profile_artifact(output_path)
    previous_profiles = previous["profiles"]
    symbols = sorted(previous_profiles)
    previous_through = {symbol: _profile_session_through(previous_profiles[symbol])
                        for symbol in symbols}
    candidate = output_path.with_name(f".{output_path.name}.{uuid.uuid4().hex}.candidate")
    try:
        result = refresh_profiles(
            symbols, now=now, output_path=candidate, reader=reader,
            feed=str(previous["feed"]),
        )
        profiles = result["profiles"]
        if result["failures"] or set(profiles) != set(symbols):
            raise RuntimeError("intraday_profile_refresh_incomplete")
        current_through = {symbol: _profile_session_through(profiles[symbol]) for symbol in symbols}
        if any(current_through[symbol] < previous_through[symbol] for symbol in symbols):
            raise RuntimeError("intraday_profile_refresh_regression")
        result["refreshPolicy"] = "complete_frozen_symbol_set_atomic_replace_v1"
        result["previousSessionThrough"] = previous_through
        result["currentSessionThrough"] = current_through
        candidate.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        candidate.replace(output_path)
        return result
    finally:
        candidate.unlink(missing_ok=True)


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "usage: --refresh-existing | SYMBOL [SYMBOL ...]"}))
        return 2
    try:
        result = (refresh_existing_profiles() if sys.argv[1:] == ["--refresh-existing"]
                  else refresh_profiles(sys.argv[1:]))
        print(json.dumps({
            "ok": bool(result["profiles"]), "generatedAt": result["generatedAt"],
            "feed": result["feed"], "profileCount": len(result["profiles"]),
            "failures": result["failures"],
            "currentSessionThrough": result.get("currentSessionThrough"),
        }))
        return 0 if result["profiles"] else 1
    except (RuntimeError, ValueError) as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
