"""Read-only Nasdaq Trader current-halt evidence for intraday research."""

from __future__ import annotations

import re
import urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from xml.etree import ElementTree
from zoneinfo import ZoneInfo


HOST = "www.nasdaqtrader.com"
URL = f"https://{HOST}/rss.aspx?feed=tradehalts"
SOURCE_NAME = "Nasdaq Trader Trade Halt RSS"
MAX_RESPONSE_BYTES = 2_000_000
TIMEOUT_SECONDS = 10
MAX_FEED_AGE_SECONDS = 120
FUTURE_TOLERANCE_SECONDS = 5
NEW_YORK = ZoneInfo("America/New_York")
SYMBOL = re.compile(r"^[A-Z][A-Z0-9.\-]{0,14}$")
NDAQ = "{http://www.nasdaqtrader.com/}"


class _RejectRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):  # noqa: ANN001
        raise ValueError("halt_provider_redirect_not_allowed")


def _default_opener(request: urllib.request.Request, *, timeout: int):
    return urllib.request.build_opener(_RejectRedirects()).open(request, timeout=timeout)


def _instant(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else None


def _feed_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else None


def _event_time(day: str | None, clock: str | None) -> datetime | None:
    if not day or not clock:
        return None
    try:
        parsed_day = datetime.strptime(day.strip(), "%m/%d/%Y").date()
        parsed_clock = datetime.strptime(clock.strip(), "%H:%M:%S.%f" if "." in clock else "%H:%M:%S").time()
    except ValueError:
        return None
    return datetime.combine(parsed_day, parsed_clock, NEW_YORK).astimezone(timezone.utc)


def parse_halt_feed(payload: bytes, *, symbol: str, observed_at: str) -> dict[str, object]:
    requested = _instant(observed_at)
    if requested is None:
        raise ValueError("halt_observation_time_invalid")
    if b"<!DOCTYPE" in payload.upper() or b"<!ENTITY" in payload.upper():
        raise ValueError("halt_provider_xml_invalid")
    try:
        root = ElementTree.fromstring(payload.decode("utf-8-sig"))
    except (UnicodeDecodeError, ElementTree.ParseError):
        raise ValueError("halt_provider_xml_invalid") from None
    channel = root.find("channel")
    published = _feed_time(channel.findtext("pubDate") if channel is not None else None)
    if published is None:
        raise ValueError("halt_provider_timestamp_invalid")
    age = (requested - published).total_seconds()
    if age < -FUTURE_TOLERANCE_SECONDS or age > MAX_FEED_AGE_SECONDS:
        raise ValueError("halt_provider_stale_or_future")

    matches: list[dict[str, object]] = []
    for item in root.findall("./channel/item"):
        item_symbol = (item.findtext(f"{NDAQ}IssueSymbol") or item.findtext("title") or "").strip().upper()
        if item_symbol != symbol:
            continue
        halted_at = _event_time(item.findtext(f"{NDAQ}HaltDate"), item.findtext(f"{NDAQ}HaltTime"))
        if halted_at is None:
            raise ValueError("halt_provider_item_invalid")
        resumed_at = _event_time(item.findtext(f"{NDAQ}ResumptionDate"),
                                 item.findtext(f"{NDAQ}ResumptionTradeTime"))
        if halted_at <= requested and (resumed_at is None or requested < resumed_at):
            matches.append({
                "reasonCode": (item.findtext(f"{NDAQ}ReasonCode") or "").strip() or None,
                "haltedAt": halted_at.isoformat().replace("+00:00", "Z"),
                "scheduledResumeAt": (resumed_at.isoformat().replace("+00:00", "Z")
                                      if resumed_at else None),
                "market": (item.findtext(f"{NDAQ}Market") or "").strip() or None,
            })
    return {
        "symbol": symbol,
        "observedAt": published.isoformat().replace("+00:00", "Z"),
        "halted": bool(matches),
        "activeHalts": matches,
        "dataSource": SOURCE_NAME,
        "sourceUrl": URL,
        "classification": "market_safety_evidence",
        "recommendationAllowed": False,
        "orderSubmissionAllowed": False,
    }


class NasdaqHaltClient:
    def __init__(self, *, opener: Callable[..., object] = _default_opener):
        self._opener = opener

    def _fetch_payload(self) -> bytes:
        request = urllib.request.Request(URL, headers={
            "Accept": "application/rss+xml, application/xml", "User-Agent": "TradeApprovalResearch/1.0",
        })
        try:
            with self._opener(request, timeout=TIMEOUT_SECONDS) as response:
                final = urlparse(response.geturl())
                if final.scheme != "https" or final.hostname != HOST:
                    raise ValueError("halt_provider_redirect_not_allowed")
                if getattr(response, "status", 200) != 200:
                    raise ValueError("halt_provider_http_error")
                payload = response.read(MAX_RESPONSE_BYTES + 1)
        except HTTPError:
            raise ValueError("halt_provider_http_error") from None
        except (URLError, TimeoutError):
            raise ValueError("halt_provider_unavailable") from None
        if len(payload) > MAX_RESPONSE_BYTES:
            raise ValueError("halt_provider_response_too_large")
        return payload

    def fetch(self, symbol: str, *, observed_at: str) -> dict[str, object]:
        return self.fetch_many([symbol], observed_at=observed_at)[symbol.strip().upper()]

    def fetch_many(self, symbols: list[str], *, observed_at: str) -> dict[str, dict[str, object]]:
        normalized = list(dict.fromkeys(symbol.strip().upper() for symbol in symbols))
        if not normalized or any(not SYMBOL.fullmatch(symbol) for symbol in normalized):
            raise ValueError("halt_symbol_invalid")
        payload = self._fetch_payload()
        return {symbol: parse_halt_feed(payload, symbol=symbol, observed_at=observed_at)
                for symbol in normalized}
