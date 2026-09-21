"""Build and scan a local 500-stock daily-bar cache using Alpaca Market Data.

Alpaca supplies the research data only. IBKR remains the quote, account, and
execution authority. Credentials are read from APCA_API_KEY_ID and
APCA_API_SECRET_KEY and are never persisted in SQLite.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import time
from collections import Counter
from datetime import date, datetime, time as wall_time, timedelta
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from ibkr_daily_scanner import DailyBar, evaluate


DATA_DIRECTORY = Path(__file__).resolve().parent / "data"
PROJECT_DIRECTORY = Path(__file__).resolve().parent.parent
DATABASE_PATH = DATA_DIRECTORY / "market-cache.sqlite3"
ASSETS_URL = "https://paper-api.alpaca.markets/v2/assets"
BARS_URL = "https://data.alpaca.markets/v2/stocks/bars"
UNIVERSE_LIMIT = 500
SYMBOL_BATCH_SIZE = 150
HISTORY_CALENDAR_DAYS = 430
ALLOWED_EXCHANGES = {"NASDAQ", "NYSE", "AMEX", "ARCA", "BATS", "NYSEARCA"}
EXCLUDED_NAME_PATTERN = re.compile(
    r"\b(ETF|ETN|FUND|WARRANTS?|WTS|UNITS?|PREFERRED|PFD|DEPOSITARY|RIGHTS)\b|\bACQUISITION\s+(CORP|CO|LTD)\b"
)
NEW_YORK = ZoneInfo("America/New_York")
SESSION_COMPLETION_GRACE = wall_time(16, 15)
CACHE_FORMAT_VERSION = "2"


def credentials() -> tuple[str, str]:
    env_path = PROJECT_DIRECTORY / ".env.local"
    if env_path.exists():
        for raw_line in env_path.read_text().splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, value = line.split("=", 1)
            if name in {"APCA_API_KEY_ID", "APCA_API_SECRET_KEY"}:
                os.environ.setdefault(name, value.strip().strip('"').strip("'"))
    key = os.environ.get("APCA_API_KEY_ID", "").strip()
    secret = os.environ.get("APCA_API_SECRET_KEY", "").strip()
    if not key or not secret:
        raise RuntimeError("alpaca_credentials_missing")
    return key, secret


def data_feed() -> str:
    credentials()
    feed = os.environ.get("ALPACA_DATA_FEED", "iex").strip().lower()
    if feed not in {"iex", "sip"}:
        raise RuntimeError("alpaca_data_feed_invalid")
    return feed


def api_json(url: str, params: dict[str, object] | None = None) -> object:
    key, secret = credentials()
    query = urlencode({key: value for key, value in (params or {}).items() if value is not None})
    request = Request(
        f"{url}?{query}" if query else url,
        headers={
            "APCA-API-KEY-ID": key,
            "APCA-API-SECRET-KEY": secret,
            "Accept": "application/json",
            "User-Agent": "trade-approval-local-mvp/0.1",
        },
    )
    try:
        with urlopen(request, timeout=45) as response:
            return json.load(response)
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:300]
        raise RuntimeError(f"alpaca_http_{error.code}:{detail}") from error
    except (URLError, TimeoutError) as error:
        raise RuntimeError("alpaca_network_unavailable") from error


def connect() -> sqlite3.Connection:
    DATA_DIRECTORY.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH)
    connection.executescript(
        """
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS assets (
          symbol TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          exchange TEXT NOT NULL,
          tradable INTEGER NOT NULL,
          rank INTEGER,
          selection_dollar_volume REAL,
          refreshed_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS daily_bars (
          symbol TEXT NOT NULL,
          trading_day TEXT NOT NULL,
          open REAL NOT NULL,
          high REAL NOT NULL,
          low REAL NOT NULL,
          close REAL NOT NULL,
          volume REAL NOT NULL,
          PRIMARY KEY (symbol, trading_day)
        );
        CREATE INDEX IF NOT EXISTS daily_bars_symbol_day
          ON daily_bars(symbol, trading_day);
        CREATE TABLE IF NOT EXISTS cache_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        """
    )
    return connection


def is_common_stock(asset: dict[str, object]) -> bool:
    symbol = str(asset.get("symbol", "")).strip().upper()
    name = f" {str(asset.get('name', '')).upper()} "
    exchange = str(asset.get("exchange", "")).upper()
    if not symbol or not symbol.replace(".", "").replace("-", "").isalnum():
        return False
    if asset.get("status") != "active" or not asset.get("tradable"):
        return False
    if asset.get("class") != "us_equity" or exchange not in ALLOWED_EXCHANGES:
        return False
    return EXCLUDED_NAME_PATTERN.search(name) is None


def batches(values: list[str], size: int = SYMBOL_BATCH_SIZE) -> Iterable[list[str]]:
    for start in range(0, len(values), size):
        yield values[start:start + size]


def completed_bar_date(raw_timestamp: object) -> date | None:
    """Return the market date encoded by an Alpaca daily-bar timestamp."""
    try:
        return date.fromisoformat(str(raw_timestamp)[:10])
    except ValueError:
        return None


def is_completed_daily_bar(raw_timestamp: object, *, now: datetime | None = None) -> bool:
    """Fail closed for today's bar until the regular session has settled.

    Alpaca can return a still-forming 1Day bar during regular trading. A bar
    before today's New York date is complete. Today's bar is accepted only
    after a conservative 16:15 ET grace boundary. Future or malformed dates
    are never accepted. Delaying early-close bars until 16:15 is intentional.
    """
    observed_at = (now or datetime.now(tz=NEW_YORK)).astimezone(NEW_YORK)
    bar_day = completed_bar_date(raw_timestamp)
    if bar_day is None or bar_day > observed_at.date():
        return False
    if bar_day < observed_at.date():
        return True
    return observed_at.weekday() < 5 and observed_at.time() >= SESSION_COMPLETION_GRACE


def completed_bars(
    bars: list[dict[str, object]], *, now: datetime | None = None,
) -> list[dict[str, object]]:
    return [bar for bar in bars if is_completed_daily_bar(bar.get("t"), now=now)]


def fetch_bars(symbols: list[str], start: str, end: str) -> dict[str, list[dict[str, object]]]:
    collected: dict[str, list[dict[str, object]]] = {symbol: [] for symbol in symbols}
    page_token: str | None = None
    while True:
        payload = api_json(BARS_URL, {
            "symbols": ",".join(symbols),
            "timeframe": "1Day",
            "start": start,
            "end": end,
            "limit": 10_000,
            "adjustment": "all",
            "feed": data_feed(),
            "sort": "asc",
            "page_token": page_token,
        })
        if not isinstance(payload, dict):
            raise RuntimeError("alpaca_bars_invalid_response")
        for symbol, bars in payload.get("bars", {}).items():
            if symbol in collected and isinstance(bars, list):
                collected[symbol].extend(bars)
        page_token = payload.get("next_page_token")
        if not page_token:
            break
    return collected


def refresh(*, now: datetime | None = None) -> dict[str, object]:
    observed_at = (now or datetime.now(tz=NEW_YORK)).astimezone(NEW_YORK)
    raw_assets = api_json(ASSETS_URL, {"status": "active", "asset_class": "us_equity"})
    if not isinstance(raw_assets, list):
        raise RuntimeError("alpaca_assets_invalid_response")
    eligible_assets = [asset for asset in raw_assets if isinstance(asset, dict) and is_common_stock(asset)]
    asset_by_symbol = {str(asset["symbol"]).upper(): asset for asset in eligible_assets}
    symbols = sorted(asset_by_symbol)
    # Alpaca's end boundary is exclusive. Request through the next calendar
    # day so the current session can be returned after the close; the
    # completed_bars filter below still rejects it before the 16:15 ET grace.
    completed_end = (observed_at.date() + timedelta(days=1)).isoformat()
    selection_start = (observed_at.date() - timedelta(days=10)).isoformat()
    dollar_volume: dict[str, float] = {}
    for symbol_batch in batches(symbols):
        for symbol, bars in fetch_bars(symbol_batch, selection_start, completed_end).items():
            complete = completed_bars(bars, now=observed_at)
            if complete:
                latest = complete[-1]
                dollar_volume[symbol] = float(latest.get("c", 0)) * float(latest.get("v", 0))

    ranked_symbols = sorted(
        dollar_volume,
        key=lambda symbol: dollar_volume[symbol],
        reverse=True,
    )[:UNIVERSE_LIMIT]
    history_start = (observed_at.date() - timedelta(days=HISTORY_CALENDAR_DAYS)).isoformat()
    history: dict[str, list[dict[str, object]]] = {}
    for symbol_batch in batches(ranked_symbols):
        fetched = fetch_bars(symbol_batch, history_start, completed_end)
        history.update({symbol: completed_bars(bars, now=observed_at) for symbol, bars in fetched.items()})

    stored_days = [completed_bar_date(bar.get("t")) for bars in history.values() for bar in bars]
    completed_through = max((day for day in stored_days if day is not None), default=None)
    if completed_through is None:
        raise RuntimeError("alpaca_completed_history_empty")

    refreshed_at = int(time.time() * 1000)
    with connect() as connection:
        connection.execute("DELETE FROM assets")
        # Rebuild the bar cache atomically so a previously stored partial bar
        # cannot survive a corrected refresh.
        connection.execute("DELETE FROM daily_bars")
        for rank, symbol in enumerate(ranked_symbols, start=1):
            asset = asset_by_symbol[symbol]
            connection.execute(
                "INSERT INTO assets(symbol,name,exchange,tradable,rank,selection_dollar_volume,refreshed_at) VALUES(?,?,?,?,?,?,?)",
                (symbol, asset.get("name") or symbol, asset.get("exchange") or "", 1, rank, dollar_volume[symbol], refreshed_at),
            )
        for symbol, bars in history.items():
            for bar in bars:
                connection.execute(
                    """INSERT INTO daily_bars(symbol,trading_day,open,high,low,close,volume)
                       VALUES(?,?,?,?,?,?,?) ON CONFLICT(symbol,trading_day) DO UPDATE SET
                       open=excluded.open,high=excluded.high,low=excluded.low,
                       close=excluded.close,volume=excluded.volume""",
                    (symbol, str(bar["t"])[:10].replace("-", ""), bar["o"], bar["h"], bar["l"], bar["c"], bar["v"]),
                )
        connection.execute(
            "INSERT INTO cache_meta(key,value) VALUES('last_refresh',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (str(refreshed_at),),
        )
        connection.execute(
            "INSERT INTO cache_meta(key,value) VALUES('data_feed',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (data_feed(),),
        )
        for key, value in {
            "completed_through": completed_through.isoformat(),
            "cache_format_version": CACHE_FORMAT_VERSION,
        }.items():
            connection.execute(
                "INSERT INTO cache_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, value),
            )
    return {
        "ok": True,
        "source": "alpaca",
        "feed": data_feed(),
        "universeSize": len(ranked_symbols),
        "barSymbols": sum(1 for bars in history.values() if bars),
        "completedThrough": completed_through.isoformat(),
        "refreshedAt": refreshed_at,
    }


def load_bars(
    connection: sqlite3.Connection, symbol: str, *, completed_through: str | None = None,
) -> list[DailyBar]:
    boundary = completed_through.replace("-", "") if completed_through else "99999999"
    rows = connection.execute(
        "SELECT trading_day,open,high,low,close,volume FROM daily_bars WHERE symbol=? AND trading_day<=? ORDER BY trading_day",
        (symbol, boundary),
    ).fetchall()
    return [DailyBar(*row) for row in rows]


def scan() -> dict[str, object]:
    if not DATABASE_PATH.exists():
        raise RuntimeError("alpaca_cache_missing")
    with connect() as connection:
        asset_rows = connection.execute(
            "SELECT symbol,name FROM assets WHERE rank IS NOT NULL ORDER BY rank LIMIT ?",
            (UNIVERSE_LIMIT,),
        ).fetchall()
        refresh_row = connection.execute("SELECT value FROM cache_meta WHERE key='last_refresh'").fetchone()
        feed_row = connection.execute("SELECT value FROM cache_meta WHERE key='data_feed'").fetchone()
        completion_row = connection.execute("SELECT value FROM cache_meta WHERE key='completed_through'").fetchone()
        if not completion_row:
            raise RuntimeError("alpaca_cache_completion_unknown_refresh_required")
        completed_through = completion_row[0]
        evaluations = []
        rejection_counts: Counter[str] = Counter()
        for symbol, name in asset_rows:
            result = evaluate(
                symbol,
                load_bars(connection, symbol, completed_through=completed_through),
                [],
                today="99999999",
            )
            result["company"] = name
            evaluations.append(result)
            for check in result.get("checks", []):
                if not check["passed"]:
                    rejection_counts[check["id"]] += 1
            if result.get("error"):
                rejection_counts[str(result["error"])] += 1

    qualified = [item for item in evaluations if item.get("eligible")]
    ranked = sorted(qualified, key=lambda item: float(item["recommendationScore"]), reverse=True)
    return {
        "ok": bool(asset_rows),
        "mode": "cached_daily",
        "dataSource": "alpaca",
        "feed": feed_row[0] if feed_row else data_feed(),
        "rulesetVersion": "liquid-growth-momentum-mvp-v2",
        "generatedAt": int(time.time() * 1000),
        "cacheRefreshedAt": int(refresh_row[0]) if refresh_row else None,
        "completedThrough": completed_through,
        "universeSize": len(asset_rows),
        "evaluatedCount": len(evaluations),
        "qualifiedCount": len(ranked),
        "selected": ranked[0] if ranked else None,
        # Exit and portfolio review must see explicit failed evaluations for
        # held symbols; a qualified-only list makes those failures invisible.
        "evaluations": evaluations,
        "rejectionCounts": dict(rejection_counts),
        "error": None if asset_rows else "alpaca_cache_empty",
    }


def status() -> dict[str, object]:
    if not DATABASE_PATH.exists():
        return {"ok": False, "error": "alpaca_cache_missing", "database": str(DATABASE_PATH)}
    with connect() as connection:
        asset_count = connection.execute("SELECT COUNT(*) FROM assets").fetchone()[0]
        bar_count = connection.execute("SELECT COUNT(*) FROM daily_bars").fetchone()[0]
        refresh_row = connection.execute("SELECT value FROM cache_meta WHERE key='last_refresh'").fetchone()
        completion_row = connection.execute("SELECT value FROM cache_meta WHERE key='completed_through'").fetchone()
    return {
        "ok": asset_count > 0 and bar_count > 0,
        "universeSize": asset_count,
        "barCount": bar_count,
        "refreshedAt": int(refresh_row[0]) if refresh_row else None,
        "completedThrough": completion_row[0] if completion_row else None,
        "refreshRequired": completion_row is None,
        "database": str(DATABASE_PATH),
    }


def main() -> int:
    command = sys.argv[1] if len(sys.argv) > 1 else "status"
    try:
        result = {"refresh": refresh, "scan": scan, "status": status}[command]()
        print(json.dumps(result))
        return 0 if result.get("ok") else 1
    except KeyError:
        print(json.dumps({"ok": False, "error": "usage: refresh|scan|status"}))
        return 2
    except RuntimeError as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
