import tempfile
import unittest
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from intraday_capture_journal import IntradayCaptureJournal
from intraday_forward_outcomes import IntradayOutcomeJournal
from intraday_shadow_capture import capture_cycle
from intraday_shadow_journal import IntradayShadowJournal


NY = ZoneInfo("America/New_York")
SCHEDULED = datetime(2026, 9, 24, 15, 0, 30, tzinfo=timezone.utc)


def profile(symbol):
    return {
        "symbol": symbol, "profileVersion": "volume-v1", "inputDigest": "v" * 64,
        "sessionCount": 30, "expectedCumulativeVolumeByMinute": [50_000] * 390,
        "priceProfileVersion": "range-v1", "priceProfileInputDigest": "p" * 64,
        "priceProfileSessionCount": 30, "expectedRangePercentByMinute": [1.5] * 390,
    }


def market(symbol, volume=100_000):
    return {
        "provider": "Alpaca Market Data", "symbol": symbol, "feed": "iex",
        "volumeScope": "single_venue", "observedAt": "2026-09-24T15:00:28Z",
        "quoteObservedAt": "2026-09-24T15:00:28Z", "bid": 102.78, "ask": 102.82,
        "last": 102.8, "sessionVolume": volume, "sessionOpen": 100,
        "sessionHigh": 102.9, "sessionLow": 99.9, "previousClose": 99,
    }


def bars(symbol, start, end):
    opening = datetime.combine(SCHEDULED.astimezone(NY).date(), time(9, 30), NY)
    return [{
        "t": (opening + timedelta(minutes=minute)).isoformat(),
        "o": 100 + minute * 0.03, "h": 100.12 + minute * 0.03,
        "l": 99.95 + minute * 0.03, "c": 100.1 + minute * 0.03,
        "v": 1_000 + minute,
    } for minute in range(91)]


def halt_reader(symbols, observed):
    return {symbol: {"symbol": symbol, "observedAt": "2026-09-24T15:00:25Z",
                     "halted": False, "activeHalts": [], "dataSource": "Nasdaq RSS"}
            for symbol in symbols}


def portfolio(symbol, observed):
    return {
        "observedAt": "2026-09-24T15:00:25Z", "openPositionCount": 1,
        "maxOpenPositions": 5, "symbolExposurePercent": 5, "maxSymbolExposurePercent": 10,
        "sectorExposurePercent": 10, "maxSectorExposurePercent": 25,
        "dailyLossPercent": 0.2, "maxDailyLossPercent": 2,
        "availableBuyingPower": 10_000, "proposedNotional": 1_000,
        "addingToExistingPosition": False,
    }


class IntradayShadowCaptureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.capture = IntradayCaptureJournal(Path(self.temp.name) / "capture.sqlite3")
        self.shadow = IntradayShadowJournal(Path(self.temp.name) / "shadow.sqlite3")
        self.outcomes = IntradayOutcomeJournal(Path(self.temp.name) / "outcomes.sqlite3")

    def tearDown(self):
        self.capture.close()
        self.shadow.close()
        self.outcomes.close()
        self.temp.cleanup()

    def test_cycle_records_pass_reject_and_incomplete_without_order_authority(self):
        profiles = {symbol: profile(symbol) for symbol in ("GOOD", "REJECT", "MISSING")}
        def snapshots(symbol):
            if symbol == "MISSING":
                raise ValueError("fixture_provider_unavailable")
            return market(symbol, volume=100_000 if symbol == "GOOD" else 60_000)
        result = capture_cycle(
            scheduled_at=SCHEDULED, profiles=profiles, snapshot_reader=snapshots,
            bars_reader=bars, halt_reader=halt_reader, portfolio_reader=portfolio,
            capture_journal=self.capture, shadow_journal=self.shadow,
            completed_at=lambda: SCHEDULED + timedelta(seconds=2),
        )
        self.assertEqual(result["statusCounts"], {"INCOMPLETE": 1, "PASS": 1, "REJECTED": 1})
        records = {item["symbol"]: item for item in self.capture.latest()["records"]}
        self.assertFalse(records["GOOD"]["envelope"]["safety"]["orderSubmissionAllowed"])
        self.assertEqual(records["MISSING"]["envelope"]["error"], "fixture_provider_unavailable")
        self.assertEqual(len(self.shadow.replay()), 2)

    def test_outside_session_is_a_no_network_no_storage_skip(self):
        called = []
        result = capture_cycle(
            scheduled_at=datetime(2026, 9, 26, 15, tzinfo=timezone.utc),
            profiles={"TEST": profile("TEST")},
            snapshot_reader=lambda symbol: called.append(symbol), bars_reader=bars,
            halt_reader=lambda symbols, observed: {}, portfolio_reader=portfolio,
            capture_journal=self.capture, shadow_journal=self.shadow,
        )
        self.assertTrue(result["skipped"])
        self.assertEqual(called, [])
        self.assertIsNone(self.capture.latest())

    def test_shared_halt_outage_is_journaled_for_every_symbol(self):
        result = capture_cycle(
            scheduled_at=SCHEDULED,
            profiles={symbol: profile(symbol) for symbol in ("ONE", "TWO")},
            snapshot_reader=market, bars_reader=bars,
            halt_reader=lambda symbols, observed: (_ for _ in ()).throw(OSError("raw outage")),
            portfolio_reader=portfolio, capture_journal=self.capture,
            shadow_journal=self.shadow,
            completed_at=lambda: SCHEDULED + timedelta(seconds=2),
        )
        self.assertEqual(result["statusCounts"], {"INCOMPLETE": 2, "PASS": 0, "REJECTED": 0})
        records = self.capture.latest()["records"]
        self.assertEqual({item["envelope"]["error"] for item in records},
                         {"halt_evidence_unavailable"})
        self.assertEqual(self.shadow.replay(), [])

    def test_later_cycle_settles_earlier_outcome_without_order_authority(self):
        common = dict(
            profiles={"GOOD": profile("GOOD")}, snapshot_reader=market,
            bars_reader=bars, halt_reader=halt_reader, portfolio_reader=portfolio,
            capture_journal=self.capture, shadow_journal=self.shadow,
            outcome_journal=self.outcomes,
        )
        first = capture_cycle(scheduled_at=SCHEDULED, **common)
        second = capture_cycle(scheduled_at=SCHEDULED + timedelta(minutes=5), **common)
        self.assertEqual(first["outcomes"]["summary"]["outcomeCount"], 0)
        self.assertEqual(second["outcomes"]["summary"]["outcomeCount"], 1)
        outcome = self.outcomes.list()[0]
        self.assertEqual(outcome["horizon"], "5m")
        self.assertFalse(outcome["orderSubmissionAllowed"])

    def test_quote_fetched_after_cycle_start_is_not_mislabeled_future(self):
        late_market = {**market("GOOD"), "observedAt": "2026-09-24T15:00:31Z",
                       "quoteObservedAt": "2026-09-24T15:00:31Z"}
        capture_cycle(
            scheduled_at=SCHEDULED, profiles={"GOOD": profile("GOOD")},
            snapshot_reader=lambda symbol: late_market, bars_reader=bars,
            halt_reader=halt_reader, portfolio_reader=portfolio,
            capture_journal=self.capture, shadow_journal=self.shadow,
            completed_at=lambda: SCHEDULED + timedelta(seconds=2),
        )
        evaluation = self.capture.latest()["records"][0]["envelope"]["evaluation"]
        checks = {item["id"]: item for item in evaluation["checks"]}
        self.assertTrue(checks["snapshot_fresh"]["passed"])
        self.assertTrue(checks["quote_fresh"]["passed"])


if __name__ == "__main__":
    unittest.main()
