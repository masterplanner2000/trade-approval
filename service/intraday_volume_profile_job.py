"""Fetch and persist research-only intraday cumulative-volume profiles."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from alpaca_market_cache import BARS_URL, api_json, data_feed
from intraday_volume_profile import build_cumulative_volume_profile


OUTPUT_PATH = Path(__file__).resolve().parent / "data" / "intraday-volume-profiles.json"
HISTORY_CALENDAR_DAYS = 70


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
            profiles[symbol] = build_cumulative_volume_profile(
                symbol, bars, as_of=as_of,
                data_source=f"Alpaca {selected_feed.upper()} historical 1Min bars",
            )
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


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "usage: SYMBOL [SYMBOL ...]"}))
        return 2
    try:
        result = refresh_profiles(sys.argv[1:])
        print(json.dumps({
            "ok": bool(result["profiles"]), "generatedAt": result["generatedAt"],
            "feed": result["feed"], "profileCount": len(result["profiles"]),
            "failures": result["failures"],
        }))
        return 0 if result["profiles"] else 1
    except (RuntimeError, ValueError) as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
