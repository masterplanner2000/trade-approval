"""Read-only entitlement/readiness audit for intraday market-data feeds."""

from __future__ import annotations

import json
import sys
from typing import Callable, Mapping

from alpaca_market_cache import credentials
from macro_provider_adapters import AlpacaSnapshotClient


READINESS_VERSION = "intraday-market-data-readiness-v1"


def evaluate_market_data_readiness(
    symbol: str, *, readers: Mapping[str, Callable[[str], Mapping[str, object]]],
) -> dict[str, object]:
    normalized = symbol.strip().upper()
    feeds: dict[str, dict[str, object]] = {}
    expected_scope = {"iex": "single_venue", "sip": "consolidated"}
    for feed in ("iex", "sip"):
        reader = readers.get(feed)
        if reader is None:
            feeds[feed] = {"status": "UNAVAILABLE", "reason": "reader_not_configured",
                           "expectedVolumeScope": expected_scope[feed]}
            continue
        try:
            snapshot = reader(normalized)
            valid = (snapshot.get("symbol") == normalized and snapshot.get("feed") == feed and
                     snapshot.get("volumeScope") == expected_scope[feed])
            feeds[feed] = {
                "status": "AVAILABLE" if valid else "INCOMPLETE",
                "reason": None if valid else "provider_provenance_mismatch",
                "expectedVolumeScope": expected_scope[feed],
                "observedAt": snapshot.get("observedAt") if valid else None,
            }
        except Exception as error:
            reason = str(error)
            allowed = {
                "macro_provider_http_error", "macro_provider_rate_limited",
                "macro_provider_unavailable", "macro_provider_snapshot_incomplete",
                "macro_provider_snapshot_invalid",
            }
            feeds[feed] = {
                "status": "UNAVAILABLE",
                "reason": reason if reason in allowed else "provider_check_failed",
                "expectedVolumeScope": expected_scope[feed],
            }
    consolidated = feeds["sip"]["status"] == "AVAILABLE"
    return {
        "readinessVersion": READINESS_VERSION,
        "symbol": normalized,
        "classification": "read_only_diagnostic",
        "feeds": feeds,
        "consolidatedIntradayAvailable": consolidated,
        "shadowResearchAllowed": feeds["iex"]["status"] == "AVAILABLE" or consolidated,
        "promotionDataGatePassed": consolidated,
        "promotionBlockers": [] if consolidated else ["consolidated_market_data_unavailable"],
        "recommendationAllowed": False,
        "orderSubmissionAllowed": False,
    }


def live_readiness(symbol: str = "NVDA") -> dict[str, object]:
    key, secret = credentials()
    clients = {feed: AlpacaSnapshotClient(api_key=key, api_secret=secret, feed=feed)
               for feed in ("iex", "sip")}
    return evaluate_market_data_readiness(
        symbol, readers={feed: client.fetch for feed, client in clients.items()},
    )


def main() -> int:
    symbol = (sys.argv[1] if len(sys.argv) > 1 else "NVDA").strip().upper()
    if not symbol or not symbol.replace(".", "").replace("-", "").isalnum():
        print(json.dumps({"ok": False, "error": "symbol_invalid"}))
        return 2
    try:
        report = live_readiness(symbol)
    except Exception:
        report = {
            "readinessVersion": READINESS_VERSION, "symbol": symbol,
            "classification": "read_only_diagnostic", "error": "readiness_check_unavailable",
            "recommendationAllowed": False, "orderSubmissionAllowed": False,
        }
    print(json.dumps({"ok": "error" not in report, **report}))
    return 0 if "error" not in report else 1


if __name__ == "__main__":
    raise SystemExit(main())
