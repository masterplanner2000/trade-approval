"""Experimental, read-only higher-volatility equity research lane.

This module never creates a proposal or calls a broker. Numerical thresholds are
test variables, not a claim of profitability. The separate cache prevents a
refresh from changing the existing 500-stock recommendation strategy.
"""

from __future__ import annotations

import json
import sqlite3
import sys
import time
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

from alpaca_market_cache import (
    ASSETS_URL, DATA_DIRECTORY,
    HISTORY_CALENDAR_DAYS, api_json, batches, data_feed, fetch_bars,
    is_common_stock, load_bars,
)
from ibkr_daily_scanner import DailyBar, average_true_range_percent


DATABASE_PATH = DATA_DIRECTORY / "aggressive-market-cache.sqlite3"
RULESET_VERSION = "volatile-growth-shadow-v1"
UNIVERSE_LIMIT = 1500
MINIMUM_BARS = 60
MINIMUM_AVERAGE_DOLLAR_VOLUME = 1_000_000  # IEX venue volume, not consolidated liquidity.
WATCHLIST = (
    "BE", "VNET", "EQIX", "APLD", "DLR", "LEU", "NEM", "AA", "OKLO",
    "UUUU", "MP", "MRNA", "WTTR", "ONDS", "CIFR", "NBIS", "LITE", "AAOI",
)


def connect(path: Path = DATABASE_PATH) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS assets (
          symbol TEXT PRIMARY KEY, name TEXT NOT NULL, exchange TEXT NOT NULL,
          selection_dollar_volume REAL NOT NULL, rank INTEGER NOT NULL,
          watchlist INTEGER NOT NULL, refreshed_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS daily_bars (
          symbol TEXT NOT NULL, trading_day TEXT NOT NULL, open REAL NOT NULL,
          high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL,
          volume REAL NOT NULL, PRIMARY KEY (symbol, trading_day)
        );
        CREATE TABLE IF NOT EXISTS cache_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        """
    )
    return connection


def selected_symbols(
    assets: list[dict[str, object]], dollar_volume: dict[str, float],
    watchlist: tuple[str, ...] = WATCHLIST, limit: int = UNIVERSE_LIMIT,
) -> list[str]:
    eligible = {str(asset["symbol"]).upper() for asset in assets if is_common_stock(asset)}
    ranked = sorted(eligible & dollar_volume.keys(), key=lambda symbol: (-dollar_volume[symbol], symbol))
    selected = ranked[:limit]
    return selected + [symbol for symbol in watchlist if symbol in eligible and symbol not in selected]


def evaluate(symbol: str, bars: list[DailyBar], *, today: str | None = None) -> dict[str, object]:
    today = today or date.today().strftime("%Y%m%d")
    completed = [bar for bar in bars if bar.date < today]
    result: dict[str, object] = {
        "symbol": symbol, "signalDate": completed[-1].date if completed else None,
        "eligible": False, "orderSubmissionAllowed": False,
        "classification": "research_only", "rulesetVersion": RULESET_VERSION,
        "barCount": len(completed),
    }
    if len(completed) < MINIMUM_BARS:
        return {**result, "reason": "insufficient_completed_daily_bars"}
    latest = completed[-1]
    closes = [bar.close for bar in completed]
    if min(closes[-21:]) <= 0:
        return {**result, "reason": "invalid_price_history"}
    momentum5 = (latest.close / closes[-6] - 1) * 100
    momentum20 = (latest.close / closes[-21] - 1) * 100
    atr = average_true_range_percent(completed)
    volume20 = sum(bar.close * bar.volume for bar in completed[-20:]) / 20
    prior_volume20 = sum(bar.volume for bar in completed[-21:-1]) / 20
    relative_volume = latest.volume / prior_volume20 if prior_volume20 > 0 else 0
    checks = [
        {"id": "price", "passed": latest.close >= 5, "actual": round(latest.close, 4)},
        {"id": "venue_liquidity", "passed": volume20 >= MINIMUM_AVERAGE_DOLLAR_VOLUME, "actual": round(volume20, 2)},
        {"id": "volatility", "passed": atr is not None and 3 <= atr <= 20, "actual": round(atr, 2) if atr is not None else None},
        {"id": "five_day_momentum", "passed": 2 <= momentum5 <= 35, "actual": round(momentum5, 2)},
        {"id": "twenty_day_momentum", "passed": momentum20 > -10, "actual": round(momentum20, 2)},
        {"id": "relative_volume", "passed": relative_volume >= 1.3, "actual": round(relative_volume, 2)},
    ]
    eligible = all(check["passed"] for check in checks)
    # Ranking is deliberately bounded; it is not an expected-return estimate.
    score = min(100, max(0, 35 + min(momentum5, 20) * 1.5 + min(relative_volume, 4) * 8 + min(atr or 0, 12)))
    return {
        **result, "eligible": eligible, "reason": None if eligible else "technical_gate_failed",
        "referenceClose": round(latest.close, 4), "momentum5Percent": round(momentum5, 2),
        "momentum20Percent": round(momentum20, 2), "atrPercent14": round(atr, 2) if atr is not None else None,
        "relativeVolume": round(relative_volume, 2), "venueDollarVolume20": round(volume20, 2),
        "researchScore": round(score, 1) if eligible else None, "checks": checks,
        "missingBeforeProposal": ["verified_catalyst", "consolidated_liquidity", "current_bid_ask_spread", "portfolio_sizing", "fresh_broker_validation"],
    }


def refresh() -> dict[str, object]:
    raw_assets = api_json(ASSETS_URL, {"status": "active", "asset_class": "us_equity"})
    if not isinstance(raw_assets, list):
        raise RuntimeError("alpaca_assets_invalid_response")
    assets = [asset for asset in raw_assets if isinstance(asset, dict) and is_common_stock(asset)]
    by_symbol = {str(asset["symbol"]).upper(): asset for asset in assets}
    end = date.today().isoformat()
    start = (date.today() - timedelta(days=10)).isoformat()
    dollar_volume: dict[str, float] = {}
    for symbol_batch in batches(sorted(by_symbol)):
        for symbol, bars in fetch_bars(symbol_batch, start, end).items():
            if bars:
                latest = bars[-1]
                dollar_volume[symbol] = float(latest.get("c", 0)) * float(latest.get("v", 0))
    symbols = selected_symbols(assets, dollar_volume)
    history_start = (date.today() - timedelta(days=HISTORY_CALENDAR_DAYS)).isoformat()
    history: dict[str, list[dict[str, object]]] = {}
    for symbol_batch in batches(symbols):
        history.update(fetch_bars(symbol_batch, history_start, end))
    if not history or sum(bool(bars) for bars in history.values()) < len(symbols) * 0.8:
        raise RuntimeError("alpaca_history_incomplete")
    refreshed_at = int(time.time() * 1000)
    with connect() as connection:
        connection.execute("DELETE FROM assets")
        connection.execute("DELETE FROM daily_bars")
        for rank, symbol in enumerate(symbols, start=1):
            asset = by_symbol[symbol]
            connection.execute(
                "INSERT INTO assets VALUES(?,?,?,?,?,?,?)",
                (symbol, str(asset.get("name") or symbol), str(asset.get("exchange") or ""),
                 dollar_volume.get(symbol, 0), rank, int(symbol in WATCHLIST), refreshed_at),
            )
            for bar in history.get(symbol, []):
                connection.execute(
                    "INSERT OR REPLACE INTO daily_bars VALUES(?,?,?,?,?,?,?)",
                    (symbol, str(bar["t"])[:10].replace("-", ""), bar["o"], bar["h"], bar["l"], bar["c"], bar["v"]),
                )
        for key, value in {"last_refresh": str(refreshed_at), "data_feed": data_feed()}.items():
            connection.execute("INSERT OR REPLACE INTO cache_meta VALUES(?,?)", (key, value))
    return {"ok": True, "mode": "aggressive_shadow", "feed": data_feed(),
            "universeSize": len(symbols), "watchlistIncluded": sum(symbol in WATCHLIST for symbol in symbols),
            "refreshedAt": refreshed_at}


def scan() -> dict[str, object]:
    if not DATABASE_PATH.exists():
        raise RuntimeError("aggressive_cache_missing")
    with connect() as connection:
        assets = connection.execute("SELECT symbol,name,watchlist FROM assets ORDER BY rank").fetchall()
        meta = dict(connection.execute("SELECT key,value FROM cache_meta"))
        results = []
        rejection_counts: Counter[str] = Counter()
        for symbol, name, watchlist in assets:
            result = evaluate(symbol, load_bars(connection, symbol))
            result.update({"company": name, "watchlist": bool(watchlist)})
            results.append(result)
            for check in result.get("checks", []):
                if not check["passed"]:
                    rejection_counts[check["id"]] += 1
            if result.get("reason") == "insufficient_completed_daily_bars":
                rejection_counts["history"] += 1
    ranked = sorted((item for item in results if item["eligible"]), key=lambda item: (-item["researchScore"], item["symbol"]))
    return {
        "ok": bool(assets), "mode": "aggressive_shadow", "rulesetVersion": RULESET_VERSION,
        "orderSubmissionAllowed": False, "dataSource": "alpaca", "feed": meta.get("data_feed"),
        "cacheRefreshedAt": int(meta["last_refresh"]) if "last_refresh" in meta else None,
        "generatedAt": int(time.time() * 1000), "universeSize": len(assets),
        "evaluatedCount": len(results), "qualifiedCount": len(ranked),
        "candidates": ranked, "rejectionCounts": dict(rejection_counts),
        "limitations": ["No verified catalyst or current spread", "Venue volume is not consolidated when feed=iex", "No portfolio-aware sizing or order authority"],
    }


def status() -> dict[str, object]:
    if not DATABASE_PATH.exists():
        return {"ok": False, "error": "aggressive_cache_missing"}
    with connect() as connection:
        count = connection.execute("SELECT COUNT(*) FROM assets").fetchone()[0]
        meta = dict(connection.execute("SELECT key,value FROM cache_meta"))
    return {"ok": count > 0, "mode": "aggressive_shadow", "universeSize": count,
            "feed": meta.get("data_feed"), "refreshedAt": int(meta["last_refresh"]) if "last_refresh" in meta else None}


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
