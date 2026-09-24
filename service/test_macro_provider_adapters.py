import json
import unittest
from datetime import datetime, timezone
from urllib.error import URLError

from macro_capture_worker import validate_capture_result
from macro_provider_adapters import (
    MAX_RESPONSE_BYTES, AlpacaSnapshotClient, MacroResearchProviderAdapter,
)


class Response:
    def __init__(self, payload, *, url="https://data.alpaca.markets/v2/stocks/TEST/snapshot?feed=iex", status=200):
        self.body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.url, self.status = url, status
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def geturl(self): return self.url
    def read(self, count): return self.body[:count]


SNAPSHOT = {
    "latestQuote": {"bp": 99.9, "ap": 100.1, "t": "2026-10-01T12:25:00Z"},
    "latestTrade": {"p": 100.0, "t": "2026-10-01T12:24:59Z"},
    "dailyBar": {"v": 1000, "o": 99.0, "h": 101.0, "l": 98.5},
    "prevDailyBar": {"c": 98.0},
}
PLAN = {"eventKey": "cpi-1", "linkVersion": "link-v1", "mapVersion": "map-v1"}
TASK = {"kind": "baseline", "symbol": "TEST", "dueAt": "2026-10-01T12:25:00Z", "plan": PLAN}


class MacroProviderAdapterTests(unittest.TestCase):
    def client(self, payload=SNAPSHOT, **response_args):
        requests = []
        def opener(request, **kwargs):
            requests.append((request, kwargs))
            return Response(payload, **response_args)
        return AlpacaSnapshotClient(api_key="key", api_secret="secret", opener=opener), requests

    def test_normalizes_iex_snapshot_and_keeps_secrets_out_of_url(self):
        client, requests = self.client()
        result = client.fetch("test")
        self.assertEqual((result["symbol"], result["volumeScope"]), ("TEST", "single_venue"))
        self.assertEqual((result["sessionOpen"], result["sessionHigh"], result["sessionLow"]),
                         (99.0, 101.0, 98.5))
        self.assertEqual(result["quoteObservedAt"], "2026-10-01T12:25:00Z")
        request = requests[0][0]
        self.assertNotIn("key", request.full_url)
        self.assertNotIn("secret", request.full_url)
        self.assertEqual(request.headers["Apca-api-key-id"], "key")

    def test_sip_is_explicitly_consolidated_and_other_feeds_are_rejected(self):
        client = AlpacaSnapshotClient(api_key="k", api_secret="s", feed="sip", opener=lambda *a, **k: None)
        self.assertEqual(client.normalize("TEST", SNAPSHOT)["volumeScope"], "consolidated")
        with self.assertRaisesRegex(ValueError, "alpaca_feed_not_approved"):
            AlpacaSnapshotClient(api_key="k", api_secret="s", feed="delayed_sip")

    def test_redirect_rate_limit_malformed_oversized_and_crossed_quote_fail_closed(self):
        cases = [
            ({}, {"url": "https://attacker.example/snapshot"}, "macro_provider_redirect_not_allowed"),
            ({}, {"status": 429}, "macro_provider_rate_limited"),
            (b"not json", {}, "macro_provider_json_invalid"),
            (b"x" * (MAX_RESPONSE_BYTES + 1), {}, "macro_provider_response_too_large"),
            ({**SNAPSHOT, "latestQuote": {"bp": 101, "ap": 100, "t": "2026-10-01T12:25:00Z"}}, {}, "macro_provider_snapshot_invalid"),
        ]
        for payload, args, error in cases:
            with self.subTest(error=error):
                client, _ = self.client(payload, **args)
                with self.assertRaisesRegex(ValueError, error): client.fetch("TEST")

    def test_transport_failure_is_sanitized(self):
        def opener(*args, **kwargs): raise URLError("secret upstream detail")
        client = AlpacaSnapshotClient(api_key="key", api_secret="secret", opener=opener)
        with self.assertRaisesRegex(ValueError, "^macro_provider_unavailable$"):
            client.fetch("TEST")

    def test_worker_contract_receives_explicit_context_and_provenance(self):
        client, _ = self.client()
        adapter = MacroResearchProviderAdapter(
            client,
            market_context_reader=lambda symbol, observed: {
                "observedAt": observed, "dataSource": "licensed intraday profile and halt feed",
                "expectedVolume": 800, "atrPercent14": 5, "halted": False,
            },
            official_release_reader=lambda plan, observed: {},
            consensus_release_reader=lambda plan, observed: {},
        )
        result = adapter.capture_market(TASK, PLAN)
        validated = validate_capture_result(TASK, result)
        self.assertEqual(validated["quote"]["expectedVolume"], 800)
        self.assertEqual(validated["volumeScope"], "single_venue")

    def test_missing_stale_or_future_context_is_never_invented(self):
        client, _ = self.client()
        for context in ({}, {
            "observedAt": "2026-10-01T12:23:59Z", "dataSource": "context",
            "expectedVolume": 800, "atrPercent14": 5, "halted": False,
        }, {
            "observedAt": "2026-10-01T12:25:01Z", "dataSource": "context",
            "expectedVolume": 800, "atrPercent14": 5, "halted": False,
        }):
            adapter = MacroResearchProviderAdapter(
                client, market_context_reader=lambda *args, value=context: value,
                official_release_reader=lambda *args: {}, consensus_release_reader=lambda *args: {},
            )
            with self.assertRaisesRegex(ValueError, "macro_market_context_incomplete_or_stale"):
                adapter.capture_market(TASK, PLAN)

    def test_release_readers_normalize_to_existing_contract(self):
        client, _ = self.client()
        adapter = MacroResearchProviderAdapter(
            client, market_context_reader=lambda *args: {},
            official_release_reader=lambda plan, observed: {
                "eventKey": plan["eventKey"], "provider": "BLS", "primarySourceVerified": True,
            },
            consensus_release_reader=lambda plan, observed: {
                "eventKey": "consensus-cpi-1", "provider": "reviewed consensus", "status": "RELEASED_WITH_CONSENSUS",
            },
            clock=lambda: datetime(2026, 10, 1, 12, 30, tzinfo=timezone.utc),
        )
        task = {"kind": "release", "dueAt": "2026-10-01T12:30:00Z", "plan": PLAN}
        validated = validate_capture_result(task, adapter.capture_release(task, PLAN))
        self.assertEqual(validated["official"]["eventKey"], "cpi-1")


if __name__ == "__main__": unittest.main()
