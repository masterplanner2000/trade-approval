"""Audit an external symbol list against both completed-daily research lanes.

This is a diagnostic report. It does not create proposals, size positions, call
IBKR, or submit orders.
"""

from __future__ import annotations

import csv
import json
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import aggressive_shadow_scanner as aggressive
import alpaca_market_cache as core


NEW_YORK = ZoneInfo("America/New_York")


def symbols_from_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as source:
        rows = list(csv.DictReader(source))
    required = {"Rank", "Symbol", "Company", "IV", "Price (USD)", "1D % Chg", "Volume (shares)", "Market cap (USD)"}
    if not rows or not required.issubset(rows[0]):
        raise RuntimeError("volatile_list_columns_invalid")
    normalized = []
    seen: set[str] = set()
    for row in rows:
        symbol = row["Symbol"].strip().upper()
        if symbol and symbol not in seen:
            seen.add(symbol)
            normalized.append({**row, "Symbol": symbol})
    return normalized


def evaluations_for(database_path: Path, lane: str) -> tuple[dict[str, dict[str, object]], dict[str, str]]:
    connector = aggressive.connect if lane == "aggressive" else core.connect
    with connector(database_path) if lane == "aggressive" else connector() as connection:
        meta = dict(connection.execute("SELECT key,value FROM cache_meta"))
        completed_through = meta.get("completed_through")
        if not completed_through:
            raise RuntimeError(f"{lane}_cache_completion_unknown_refresh_required")
        names = dict(connection.execute("SELECT symbol,name FROM assets"))
        output = {}
        for symbol, name in names.items():
            bars = core.load_bars(connection, symbol, completed_through=completed_through)
            result = aggressive.evaluate(symbol, bars, today="99999999") if lane == "aggressive" else core.evaluate(symbol, bars, [])
            output[symbol] = {**result, "company": name}
    return output, meta


def audit(source_csv: Path) -> dict[str, object]:
    rows = symbols_from_csv(source_csv)
    core_results, core_meta = evaluations_for(core.DATABASE_PATH, "core")
    aggressive_results, aggressive_meta = evaluations_for(aggressive.DATABASE_PATH, "aggressive")
    details = []
    counts: Counter[str] = Counter()
    failed_checks: Counter[str] = Counter()
    for row in rows:
        symbol = row["Symbol"]
        core_result = core_results.get(symbol)
        aggressive_result = aggressive_results.get(symbol)
        if aggressive_result and aggressive_result.get("eligible"):
            category = "qualified_research"
        elif aggressive_result and aggressive_result.get("reason") == "insufficient_completed_daily_bars":
            category = "insufficient_history"
        elif aggressive_result:
            category = "technical_reject"
        elif core_result:
            category = "core_only_observed"
        else:
            category = "not_observed"
        failures = [check["id"] for check in (aggressive_result or {}).get("checks", []) if not check.get("passed")]
        counts[category] += 1
        failed_checks.update(failures)
        details.append({
            "rank": row["Rank"], "symbol": symbol, "company": row["Company"],
            "listedIV": row["IV"], "listedPrice": row["Price (USD)"],
            "listedOneDayChange": row["1D % Chg"], "listedVolume": row["Volume (shares)"],
            "listedMarketCap": row["Market cap (USD)"], "classification": category,
            "inCoreUniverse": core_result is not None, "inAggressiveUniverse": aggressive_result is not None,
            "failedAggressiveChecks": failures,
            "aggressiveMetrics": None if not aggressive_result else {
                key: aggressive_result.get(key) for key in (
                    "signalDate", "barCount", "referenceClose", "atrPercent14",
                    "momentum5Percent", "momentum20Percent", "relativeVolume", "venueDollarVolume20",
                )
            },
        })
    return {
        "generatedAt": datetime.now(tz=NEW_YORK).isoformat(),
        "classification": "diagnostic_research_only", "orderSubmissionAllowed": False,
        "source": str(source_csv), "sourceSymbolCount": len(rows),
        "coreCompletedThrough": core_meta["completed_through"],
        "aggressiveCompletedThrough": aggressive_meta["completed_through"],
        "coverage": dict(sorted(counts.items())),
        "failedAggressiveChecks": dict(failed_checks.most_common()),
        "limitations": [
            "The source CSV has no as-of timestamp or catalyst field.",
            "Listed implied volatility is directionless and is not a buy signal.",
            "Alpaca IEX volume is single-venue rather than consolidated volume.",
            "Qualified research still lacks a verified catalyst, current spread, portfolio sizing and broker validation.",
        ],
        "symbols": details,
    }


def markdown(report: dict[str, object]) -> str:
    coverage = report["coverage"]
    lines = [
        "# Volatile-stock coverage audit", "",
        f"Generated: {report['generatedAt']}",
        f"Source symbols: {report['sourceSymbolCount']}",
        f"Completed daily data through: {report['aggressiveCompletedThrough']}", "",
        "## Coverage", "",
    ]
    for category in ("qualified_research", "technical_reject", "insufficient_history", "core_only_observed", "not_observed"):
        lines.append(f"- {category.replace('_', ' ').title()}: {coverage.get(category, 0)}")
    lines.extend(["", "## Most common aggressive-lane rejections", ""])
    for check, count in report["failedAggressiveChecks"].items():
        lines.append(f"- {check.replace('_', ' ').title()}: {count}")
    qualified = [item for item in report["symbols"] if item["classification"] == "qualified_research"]
    lines.extend(["", "## Qualified research observations", ""])
    if not qualified:
        lines.append("None.")
    else:
        lines.extend(["| Symbol | Company | Listed IV | Failed checks |", "|---|---|---:|---|"])
        for item in qualified:
            lines.append(f"| {item['symbol']} | {item['company']} | {item['listedIV']} | None |")
    lines.extend(["", "## Limitations", ""])
    lines.extend(f"- {item}" for item in report["limitations"])
    lines.extend(["", "The JSON companion contains one classification and the failed scanner checks for every source symbol.", ""])
    return "\n".join(lines)


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: volatile_stock_coverage.py SOURCE.csv OUTPUT_PREFIX", file=sys.stderr)
        return 2
    source, output_prefix = Path(sys.argv[1]), Path(sys.argv[2])
    report = audit(source)
    output_prefix.parent.mkdir(parents=True, exist_ok=True)
    output_prefix.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n")
    output_prefix.with_suffix(".md").write_text(markdown(report))
    print(json.dumps({"ok": True, "json": str(output_prefix.with_suffix('.json')), "markdown": str(output_prefix.with_suffix('.md')), "coverage": report["coverage"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
