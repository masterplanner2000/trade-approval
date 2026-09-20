"""Bounded primary-source adapters for macro-event shadow research."""

from __future__ import annotations

import hashlib
import re
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Callable
from urllib.parse import urlparse
from zoneinfo import ZoneInfo


ADAPTER_VERSION = "official-macro-sources-v1"
MAX_RESPONSE_BYTES = 1_000_000
MAX_ITEMS = 200
FETCH_TIMEOUT_SECONDS = 10
NEW_YORK = ZoneInfo("America/New_York")

FEEDS = {
    "fed_monetary_policy": {
        "url": "https://www.federalreserve.gov/feeds/press_monetary.xml",
        "provider": "Federal Reserve Board",
        "hosts": {"www.federalreserve.gov", "federalreserve.gov"},
        "eventType": "monetary_policy",
    },
    "bls_employment_situation": {
        "url": "https://www.bls.gov/feed/empsit.rss",
        "provider": "U.S. Bureau of Labor Statistics",
        "hosts": {"www.bls.gov", "bls.gov"},
        "eventType": "labor",
    },
    "bls_consumer_price_index": {
        "url": "https://www.bls.gov/feed/cpi.rss",
        "provider": "U.S. Bureau of Labor Statistics",
        "hosts": {"www.bls.gov", "bls.gov"},
        "eventType": "inflation",
    },
}

BLS_CALENDAR = {
    "url": "https://www.bls.gov/schedule/news_release/bls.ics",
    "provider": "U.S. Bureau of Labor Statistics",
    "hosts": {"www.bls.gov", "bls.gov"},
}


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _instant(value: str) -> str:
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("macro_source_timestamp_timezone_required")
    return _iso(parsed)


def _text(node: ET.Element, names: set[str]) -> str | None:
    for child in node.iter():
        name = child.tag.rsplit("}", 1)[-1].lower()
        if name in names and child.text and child.text.strip():
            return child.text.strip()
    return None


def _link(node: ET.Element) -> str | None:
    for child in node.iter():
        if child.tag.rsplit("}", 1)[-1].lower() != "link":
            continue
        href = child.attrib.get("href")
        if href:
            return href.strip()
        if child.text and child.text.strip():
            return child.text.strip()
    return None


def _allowed_url(value: str | None, hosts: set[str]) -> bool:
    if not value:
        return False
    parsed = urlparse(value)
    return parsed.scheme == "https" and parsed.hostname in hosts


def _fingerprint(value: object) -> str:
    return hashlib.sha256(repr(value).encode("utf-8")).hexdigest()


def normalize_rss(feed_id: str, payload: bytes, *, retrieved_at: str) -> dict[str, object]:
    config = FEEDS.get(feed_id)
    if config is None:
        raise ValueError("macro_feed_not_allowed")
    if not payload or len(payload) > MAX_RESPONSE_BYTES:
        raise ValueError("macro_feed_size_invalid")
    lowered = payload.lower()
    if b"<!doctype" in lowered or b"<!entity" in lowered:
        raise ValueError("macro_feed_unsafe_xml")
    _instant(retrieved_at)
    try:
        root = ET.fromstring(payload)
    except ET.ParseError as error:
        raise ValueError("macro_feed_invalid_xml") from error
    nodes = [node for node in root.iter() if node.tag.rsplit("}", 1)[-1].lower() in {"item", "entry"}]
    events: list[dict[str, object]] = []
    rejected = 0
    for node in nodes[:MAX_ITEMS]:
        title = _text(node, {"title"})
        published = _text(node, {"pubdate", "published", "updated"})
        link = _link(node)
        source_id = _text(node, {"guid", "id"}) or link
        try:
            published_at = _instant(published) if published else None
        except ValueError:
            published_at = None
        if not title or not published_at or not source_id or not _allowed_url(link, config["hosts"]):
            rejected += 1
            continue
        identity = f"{feed_id}:{source_id}"
        events.append({
            "adapterVersion": ADAPTER_VERSION,
            "provider": config["provider"],
            "feedId": feed_id,
            "eventType": config["eventType"],
            "sourceEventId": source_id,
            "eventKey": f"{feed_id}:{_fingerprint(identity)[:24]}",
            "title": title,
            "publishedAt": published_at,
            "retrievedAt": retrieved_at,
            "url": link,
            "primarySourceVerified": True,
            "contentFingerprint": _fingerprint((title, published_at, link)),
            "surprise": None,
            "status": "IDENTIFIED_NOT_SCORED",
        })
    return {
        "adapterVersion": ADAPTER_VERSION,
        "feedId": feed_id,
        "sourceUrl": config["url"],
        "retrievedAt": retrieved_at,
        "status": "partial" if rejected or len(nodes) > MAX_ITEMS else "complete",
        "rejectedCount": rejected + max(0, len(nodes) - MAX_ITEMS),
        "events": events,
    }


def _unfold_ics(payload: str) -> list[str]:
    lines: list[str] = []
    for raw in payload.replace("\r\n", "\n").split("\n"):
        if raw.startswith((" ", "\t")) and lines:
            lines[-1] += raw[1:]
        else:
            lines.append(raw)
    return lines


def _ics_time(key: str, value: str) -> str:
    timezone_name = None
    for parameter in key.split(";")[1:]:
        if parameter.upper().startswith("TZID="):
            timezone_name = parameter.split("=", 1)[1]
    if value.endswith("Z"):
        parsed = datetime.strptime(value, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
    elif "T" in value:
        parsed = datetime.strptime(value, "%Y%m%dT%H%M%S")
        parsed = parsed.replace(tzinfo=ZoneInfo(timezone_name) if timezone_name else NEW_YORK)
    else:
        parsed = datetime.strptime(value, "%Y%m%d").replace(tzinfo=NEW_YORK)
    return _iso(parsed)


def normalize_bls_calendar(payload: bytes, *, retrieved_at: str) -> dict[str, object]:
    if not payload or len(payload) > MAX_RESPONSE_BYTES:
        raise ValueError("macro_calendar_size_invalid")
    _instant(retrieved_at)
    text = payload.decode("utf-8", errors="strict")
    if "BEGIN:VCALENDAR" not in text:
        raise ValueError("macro_calendar_invalid_ics")
    events: list[dict[str, object]] = []
    rejected = 0
    current: dict[str, str] | None = None
    for line in _unfold_ics(text):
        if line == "BEGIN:VEVENT":
            current = {}
        elif line == "END:VEVENT" and current is not None:
            uid = current.get("UID")
            summary = current.get("SUMMARY")
            dt_key = next((key for key in current if key.split(";", 1)[0] == "DTSTART"), None)
            try:
                scheduled_at = _ics_time(dt_key, current[dt_key]) if dt_key else None
            except (ValueError, KeyError):
                scheduled_at = None
            if uid and summary and scheduled_at:
                events.append({
                    "adapterVersion": ADAPTER_VERSION,
                    "provider": BLS_CALENDAR["provider"],
                    "calendarId": "bls_release_calendar",
                    "sourceEventId": uid,
                    "eventKey": f"bls_calendar:{_fingerprint(uid)[:24]}",
                    "title": summary.replace("\\,", ","),
                    "scheduledAt": scheduled_at,
                    "retrievedAt": retrieved_at,
                    "primarySourceVerified": True,
                    "status": "SCHEDULED",
                })
            else:
                rejected += 1
            current = None
        elif current is not None and ":" in line:
            key, value = line.split(":", 1)
            current[key] = value
    overflow = max(0, len(events) - MAX_ITEMS)
    return {
        "adapterVersion": ADAPTER_VERSION,
        "calendarId": "bls_release_calendar",
        "sourceUrl": BLS_CALENDAR["url"],
        "retrievedAt": retrieved_at,
        "status": "partial" if rejected or overflow else "complete",
        "rejectedCount": rejected + overflow,
        "events": events[:MAX_ITEMS],
    }


def fetch_official_source(
    source_id: str, *, retrieved_at: str,
    opener: Callable[..., object] = urllib.request.urlopen,
) -> dict[str, object]:
    config = FEEDS.get(source_id) if source_id in FEEDS else BLS_CALENDAR if source_id == "bls_release_calendar" else None
    if config is None:
        raise ValueError("macro_source_not_allowed")
    request = urllib.request.Request(config["url"], headers={
        "User-Agent": "Mozilla/5.0 (compatible; TradeApprovalResearch/1.0; macro-shadow)",
        "Accept": "application/rss+xml, application/xml, text/xml, text/calendar",
    })
    with opener(request, timeout=FETCH_TIMEOUT_SECONDS) as response:
        final_url = response.geturl()
        if not _allowed_url(final_url, config["hosts"]):
            raise ValueError("macro_source_redirect_not_allowed")
        status = getattr(response, "status", 200)
        if status != 200:
            raise ValueError("macro_source_http_error")
        payload = response.read(MAX_RESPONSE_BYTES + 1)
    if len(payload) > MAX_RESPONSE_BYTES:
        raise ValueError("macro_source_response_too_large")
    return (normalize_bls_calendar(payload, retrieved_at=retrieved_at)
            if source_id == "bls_release_calendar"
            else normalize_rss(source_id, payload, retrieved_at=retrieved_at))
