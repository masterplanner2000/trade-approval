"""Provider-neutral consensus records and Trading Economics adapter."""

from __future__ import annotations

import hashlib
import json
import math
import statistics
import urllib.request
from datetime import date, datetime, timezone
from typing import Callable, Iterable, Mapping
from urllib.parse import urlencode, urlparse


ADAPTER_VERSION = "macro-consensus-v1"
PROVIDER = "Trading Economics"
ENDPOINT = "https://api.tradingeconomics.com/calendar/country/united%20states"
MAX_RESPONSE_BYTES = 2_000_000
MAX_RECORDS = 1_000
MAX_RANGE_DAYS = 31
MIN_STANDARDIZATION_HISTORY = 12


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        return None
    return float(value)


def _utc(value: object, *, provider_declares_utc: bool = False) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        if not provider_declares_utc:
            return None
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _url(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    parsed = urlparse(value)
    return value if parsed.scheme in {"http", "https"} and parsed.netloc else None


def _fingerprint(value: object) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def normalize_trading_economics(payload: object, *, retrieved_at: str) -> dict[str, object]:
    if _utc(retrieved_at) is None:
        raise ValueError("macro_consensus_retrieved_at_invalid")
    if not isinstance(payload, list):
        raise ValueError("macro_consensus_response_invalid")
    records: list[dict[str, object]] = []
    rejected = 0
    for raw in payload[:MAX_RECORDS]:
        if not isinstance(raw, Mapping) or raw.get("Country") != "United States":
            rejected += 1
            continue
        calendar_id = str(raw.get("CalendarID") or "").strip()
        scheduled_at = _utc(raw.get("Date"), provider_declares_utc=True)
        updated_at = _utc(raw.get("LastUpdate"), provider_declares_utc=True)
        category = str(raw.get("Category") or "").strip()
        event_name = str(raw.get("Event") or "").strip()
        source = str(raw.get("Source") or "").strip()
        source_url = _url(raw.get("SourceURL"))
        importance = _number(raw.get("Importance"))
        date_span = str(raw.get("DateSpan") if raw.get("DateSpan") is not None else "")
        if (not calendar_id or not scheduled_at or not updated_at or not category or not event_name
                or not source or not source_url or importance is None or importance < 2 or date_span != "0"):
            rejected += 1
            continue
        actual = _number(raw.get("ActualValue"))
        consensus = _number(raw.get("ForecastValue"))
        previous = _number(raw.get("PreviousValue"))
        provider_forecast = _number(raw.get("TEForecastValue"))
        series_identity = str(raw.get("Ticker") or raw.get("Symbol") or category).strip()
        series_key = f"trading_economics:{_fingerprint(series_identity)[:24]}"
        raw_surprise = actual - consensus if actual is not None and consensus is not None else None
        status = ("RELEASED_WITH_CONSENSUS" if raw_surprise is not None else
                  "RELEASED_NO_CONSENSUS" if actual is not None else "SCHEDULED")
        record = {
            "adapterVersion": ADAPTER_VERSION,
            "provider": PROVIDER,
            "providerEventId": calendar_id,
            "eventKey": f"trading_economics:{calendar_id}",
            "seriesKey": series_key,
            "country": "United States",
            "category": category,
            "eventName": event_name,
            "reference": raw.get("Reference"),
            "scheduledAt": scheduled_at,
            "updatedAt": updated_at,
            "retrievedAt": retrieved_at,
            "timingPrecision": "exact",
            "importance": int(importance),
            "unit": raw.get("Unit"),
            "source": source,
            "sourceUrl": source_url,
            "actualValue": actual,
            "consensusValue": consensus,
            "providerForecastValue": provider_forecast,
            "previousValue": previous,
            "revisedPreviousText": raw.get("Revised"),
            "rawSurprise": raw_surprise,
            "standardizedSurprise": None,
            "standardizationSampleCount": 0,
            "status": status,
        }
        record["contentFingerprint"] = _fingerprint(record)
        records.append(record)
    overflow = max(0, len(payload) - MAX_RECORDS)
    return {
        "adapterVersion": ADAPTER_VERSION,
        "provider": PROVIDER,
        "retrievedAt": retrieved_at,
        "status": "partial" if rejected or overflow else "complete",
        "rejectedCount": rejected + overflow,
        "records": records,
    }


def calculate_standardized_surprise(
    current: Mapping[str, object], history: Iterable[Mapping[str, object]],
    *, minimum_history: int = MIN_STANDARDIZATION_HISTORY,
) -> dict[str, object]:
    raw_surprise = _number(current.get("rawSurprise"))
    current_time = _utc(current.get("scheduledAt"))
    series_key = current.get("seriesKey")
    if raw_surprise is None or current_time is None or not series_key:
        return {"standardizedSurprise": None, "sampleCount": 0, "reason": "current_surprise_incomplete"}
    eligible: list[float] = []
    for item in history:
        item_time = _utc(item.get("scheduledAt"))
        item_surprise = _number(item.get("rawSurprise"))
        if item.get("seriesKey") == series_key and item_time and item_time < current_time and item_surprise is not None:
            eligible.append(item_surprise)
    if len(eligible) < minimum_history:
        return {"standardizedSurprise": None, "sampleCount": len(eligible), "reason": "insufficient_prior_history"}
    deviation = statistics.stdev(eligible)
    if deviation == 0:
        return {"standardizedSurprise": None, "sampleCount": len(eligible), "reason": "zero_historical_variance"}
    score = max(-5.0, min(5.0, (raw_surprise - statistics.mean(eligible)) / deviation))
    return {"standardizedSurprise": round(score, 4), "sampleCount": len(eligible), "reason": None}


def fetch_trading_economics(
    start: str, end: str, *, api_key: str, retrieved_at: str,
    opener: Callable[..., object] = urllib.request.urlopen,
) -> dict[str, object]:
    if not api_key or not api_key.strip():
        raise ValueError("macro_consensus_api_key_required")
    try:
        start_date, end_date = date.fromisoformat(start), date.fromisoformat(end)
    except ValueError as error:
        raise ValueError("macro_consensus_date_invalid") from error
    if end_date < start_date or (end_date - start_date).days > MAX_RANGE_DAYS:
        raise ValueError("macro_consensus_date_range_invalid")
    query = urlencode({"importance": 2, "values": "true", "f": "json"})
    url = f"{ENDPOINT}/{start_date.isoformat()}/{end_date.isoformat()}?{query}"
    request = urllib.request.Request(url, headers={
        "Authorization": api_key,
        "Accept": "application/json",
        "User-Agent": "TradeApprovalResearch/1.0 macro-shadow",
    })
    with opener(request, timeout=10) as response:
        final = urlparse(response.geturl())
        if final.scheme != "https" or final.hostname != "api.tradingeconomics.com":
            raise ValueError("macro_consensus_redirect_not_allowed")
        if getattr(response, "status", 200) != 200:
            raise ValueError("macro_consensus_http_error")
        body = response.read(MAX_RESPONSE_BYTES + 1)
    if len(body) > MAX_RESPONSE_BYTES:
        raise ValueError("macro_consensus_response_too_large")
    try:
        payload = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("macro_consensus_json_invalid") from error
    return normalize_trading_economics(payload, retrieved_at=retrieved_at)
