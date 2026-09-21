"""Generate the current-cache retrospective shadow comparison report."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from shadow_strategy_comparison import compare_daily_lanes, load_cache


DATA = Path(__file__).parent / "data"


def main() -> int:
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("reports/daily-shadow-comparison.json")
    baseline_symbols, baseline_history = load_cache(DATA / "market-cache.sqlite3")
    shadow_symbols, shadow_history = load_cache(DATA / "aggressive-market-cache.sqlite3")
    histories = {**baseline_history, **shadow_history}
    benchmark_symbol = next((symbol for symbol in ("SPY", "QQQ", "IWM", "VOO") if histories.get(symbol)), None)
    if benchmark_symbol is None:
        raise RuntimeError("comparison_benchmark_missing")
    benchmark = histories[benchmark_symbol]
    # Reserve the latest ten sessions for outcomes and compare the preceding 80.
    available_dates = [bar.date for bar in benchmark]
    signal_dates = available_dates[-90:-10]
    if len(signal_dates) < 40:
        raise RuntimeError("comparison_history_insufficient")
    split_index = max(1, int(len(signal_dates) * .75))
    split = signal_dates[split_index - 1]
    calibration_end = f"{split[:4]}-{split[4:6]}-{split[6:]}"
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    report = compare_daily_lanes(
        histories, benchmark, signal_dates=signal_dates, generated_at=now,
        calibration_end=calibration_end, baseline_symbols=sorted(baseline_symbols),
        shadow_symbols=sorted(shadow_symbols), universe_provenance="current_universe_retrospective",
        benchmark_symbol=benchmark_symbol,
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "ok": True, "output": str(output), "signalDateCount": report["signalDateCount"],
        "forwardSessionCount": report["forwardSessionCount"], "metrics": report["metrics"],
        "promotionEvidenceAllowed": report["promotionEvidenceAllowed"],
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
