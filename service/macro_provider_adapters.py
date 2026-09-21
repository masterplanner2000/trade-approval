"""Bounded read-only provider adapters for supervised macro capture.

The market adapter reads an Alpaca stock snapshot, but deliberately requires a
separate timestamped context reader for expected intraday volume, ATR and halt
state.  A snapshot alone cannot establish those values without guessing.
"""

from __future__ import annotations

import json
import math
import re
import urllib.request
from datetime import datetime, timezone
from typing import Callable, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlparse


ADAPTER_VERSION = "macro-provider-adapters-v1"
ALPACA_HOST = "data.alpaca.markets"
ALPACA_SNAPSHOT_ROOT = f"https://{ALPACA_HOST}/v2/stocks"
MAX_RESPONSE_BYTES = 1_000_000
FETCH_TIMEOUT_SECONDS = 10
ALLOWED_FEEDS = {"iex": "single_venue", "sip": "consolidated"}
SYMBOL = re.compile(r"^[A-Z][A-Z0-9.\-]{0,14}$")


def _instant(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else None


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _number(value: object, *, allow_zero: bool = False) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    result = float(value)
    if not math.isfinite(result) or result < 0 or (result == 0 and not allow_zero):
        return None
    return result


class _RejectRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):  # noqa: ANN001
        raise ValueError("macro_provider_redirect_not_allowed")


def _default_opener(request: urllib.request.Request, *, timeout: int):
    return urllib.request.build_opener(_RejectRedirects()).open(request, timeout=timeout)


class AlpacaSnapshotClient:
    """Fetches one fixed-host, read-only stock snapshot with no account endpoint."""

    def __init__(
        self, *, api_key: str, api_secret: str, feed: str = "iex",
        opener: Callable[..., object] = _default_opener,
    ):
        if not api_key.strip() or not api_secret.strip():
            raise ValueError("alpaca_credentials_missing")
        if feed not in ALLOWED_FEEDS:
            raise ValueError("alpaca_feed_not_approved")
        self._api_key = api_key
        self._api_secret = api_secret
        self.feed = feed
        self._opener = opener

    def fetch(self, symbol: str) -> dict[str, object]:
        normalized_symbol = symbol.strip().upper()
        if not SYMBOL.fullmatch(normalized_symbol):
            raise ValueError("alpaca_symbol_invalid")
        url = f"{ALPACA_SNAPSHOT_ROOT}/{quote(normalized_symbol, safe='')}/snapshot?{urlencode({'feed': self.feed})}"
        request = urllib.request.Request(url, headers={
            "APCA-API-KEY-ID": self._api_key,
            "APCA-API-SECRET-KEY": self._api_secret,
            "Accept": "application/json",
            "User-Agent": "TradeApprovalResearch/1.0 macro-shadow",
        })
        try:
            with self._opener(request, timeout=FETCH_TIMEOUT_SECONDS) as response:
                final = urlparse(response.geturl())
                if final.scheme != "https" or final.hostname != ALPACA_HOST:
                    raise ValueError("macro_provider_redirect_not_allowed")
                status = getattr(response, "status", 200)
                if status == 429:
                    raise ValueError("macro_provider_rate_limited")
                if status != 200:
                    raise ValueError("macro_provider_http_error")
                body = response.read(MAX_RESPONSE_BYTES + 1)
        except HTTPError as error:
            raise ValueError(
                "macro_provider_rate_limited" if error.code == 429 else "macro_provider_http_error"
            ) from None
        except (URLError, TimeoutError):
            raise ValueError("macro_provider_unavailable") from None
        if len(body) > MAX_RESPONSE_BYTES:
            raise ValueError("macro_provider_response_too_large")
        try:
            payload = json.loads(body)
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("macro_provider_json_invalid") from None
        if not isinstance(payload, Mapping):
            raise ValueError("macro_provider_response_invalid")
        return self.normalize(normalized_symbol, payload)

    def normalize(self, symbol: str, payload: Mapping[str, object]) -> dict[str, object]:
        latest_quote = payload.get("latestQuote")
        latest_trade = payload.get("latestTrade")
        daily_bar = payload.get("dailyBar")
        previous_bar = payload.get("prevDailyBar")
        if not all(isinstance(value, Mapping) for value in (latest_quote, latest_trade, daily_bar, previous_bar)):
            raise ValueError("macro_provider_snapshot_incomplete")
        bid = _number(latest_quote.get("bp"))
        ask = _number(latest_quote.get("ap"))
        last = _number(latest_trade.get("p"))
        volume = _number(daily_bar.get("v"), allow_zero=True)
        previous_close = _number(previous_bar.get("c"))
        quote_at, trade_at = _instant(latest_quote.get("t")), _instant(latest_trade.get("t"))
        if (None in {bid, ask, last, volume, previous_close, quote_at, trade_at}
                or bid > ask):
            raise ValueError("macro_provider_snapshot_invalid")
        observed = max(quote_at, trade_at)
        return {
            "adapterVersion": ADAPTER_VERSION,
            "provider": "Alpaca Market Data",
            "symbol": symbol,
            "feed": self.feed,
            "volumeScope": ALLOWED_FEEDS[self.feed],
            "observedAt": _iso(observed),
            "bid": bid,
            "ask": ask,
            "last": last,
            "sessionVolume": volume,
            "previousClose": previous_close,
        }


class MacroResearchProviderAdapter:
    """Joins approved readers into the worker's existing evidence contract."""

    def __init__(
        self, market_client: AlpacaSnapshotClient, *,
        market_context_reader: Callable[[str, str], Mapping[str, object]],
        official_release_reader: Callable[[Mapping[str, object], str], Mapping[str, object]],
        consensus_release_reader: Callable[[Mapping[str, object], str], Mapping[str, object]],
        clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    ):
        self.market_client = market_client
        self.market_context_reader = market_context_reader
        self.official_release_reader = official_release_reader
        self.consensus_release_reader = consensus_release_reader
        self.clock = clock

    def capture_market(self, task: Mapping[str, object], plan: Mapping[str, object]) -> dict[str, object]:
        symbol = str(task.get("symbol") or "").upper()
        snapshot = self.market_client.fetch(symbol)
        context = self.market_context_reader(symbol, str(snapshot["observedAt"]))
        context_at = _instant(context.get("observedAt")) if isinstance(context, Mapping) else None
        snapshot_at = _instant(snapshot["observedAt"])
        expected = _number(context.get("expectedVolume")) if isinstance(context, Mapping) else None
        atr = _number(context.get("atrPercent14")) if isinstance(context, Mapping) else None
        halted = context.get("halted") if isinstance(context, Mapping) else None
        source = context.get("dataSource") if isinstance(context, Mapping) else None
        if (context_at is None or snapshot_at is None or context_at > snapshot_at
                or (snapshot_at - context_at).total_seconds() > 60
                or expected is None or atr is None or not isinstance(halted, bool)
                or not isinstance(source, str) or not source.strip()):
            raise ValueError("macro_market_context_incomplete_or_stale")
        return {
            "observedAt": snapshot["observedAt"],
            "dataSource": f"Alpaca {snapshot['feed']} snapshot + {source.strip()}",
            "symbol": snapshot["symbol"],
            "linkVersion": plan.get("linkVersion"),
            "mapVersion": plan.get("mapVersion"),
            "volumeScope": snapshot["volumeScope"],
            "quote": {
                "bid": snapshot["bid"], "ask": snapshot["ask"], "last": snapshot["last"],
                "sessionVolume": snapshot["sessionVolume"], "expectedVolume": expected,
                "previousClose": snapshot["previousClose"], "atrPercent14": atr,
                "halted": halted,
            },
        }

    def capture_release(self, task: Mapping[str, object], plan: Mapping[str, object]) -> dict[str, object]:
        observed_at = _iso(self.clock())
        official = self.official_release_reader(plan, observed_at)
        consensus = self.consensus_release_reader(plan, observed_at)
        if not isinstance(official, Mapping) or not isinstance(consensus, Mapping):
            raise ValueError("macro_release_provider_response_invalid")
        return {
            "observedAt": observed_at,
            "dataSource": f"{official.get('provider', 'official source')} + {consensus.get('provider', 'consensus source')}",
            "linkVersion": plan.get("linkVersion"),
            "mapVersion": plan.get("mapVersion"),
            "official": dict(official),
            "consensus": dict(consensus),
        }
