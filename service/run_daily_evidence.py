from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from daily_evidence_capture import DailyEvidenceStore
from shadow_strategy_comparison import load_cache


DATA = Path(__file__).parent / "data"
STORE = DATA / "daily-forward-evidence.sqlite3"


def main() -> int:
    command = sys.argv[1] if len(sys.argv) > 1 else "capture"
    store = DailyEvidenceStore(STORE)
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        if command == "capture":
            try:
                result = store.capture(DATA / "market-cache.sqlite3", DATA / "aggressive-market-cache.sqlite3", captured_at=now)
            except ValueError as error:
                if str(error) != "daily_evidence_capture_conflict":
                    raise
                status = store.status()
                result = {
                    "signalDate": status["latestSignalDate"], "idempotent": True,
                    "snapshotPreserved": True,
                    "warning": "completed_session_already_frozen_with_different_refresh_payload",
                }
            _, baseline = load_cache(DATA / "market-cache.sqlite3")
            _, shadow = load_cache(DATA / "aggressive-market-cache.sqlite3")
            result["outcomes"] = store.record_available_outcomes({**baseline, **shadow}, recorded_at=now)
        elif command == "status":
            result = store.status()
        elif command == "invalidate":
            if len(sys.argv) < 4:
                raise ValueError("usage: invalidate RUN_ID REASON")
            result = store.invalidate_run(sys.argv[2], reason=" ".join(sys.argv[3:]), recorded_at=now)
        else:
            raise ValueError("usage: capture|status|invalidate RUN_ID REASON")
        print(json.dumps({"ok": True, **result}))
        return 0
    finally:
        store.close()


if __name__ == "__main__":
    raise SystemExit(main())
