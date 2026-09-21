import tempfile
import unittest
from pathlib import Path

from macro_capture_scheduler import MacroCaptureScheduler
from macro_capture_worker import MacroCaptureWorker
from macro_forward_pilot import assess_pilot_readiness, build_pilot_report, register_ready_pilot
from macro_research_universe import load_universe


UNIVERSE = Path(__file__).parent / "data" / "macro-research-universe-2026-09-20-v1.json"
PROVIDERS = {"official_release": "READY", "consensus": "READY",
             "market_snapshot": "READY", "market_context": "READY"}


class RecordedAdapter:
    def capture_release(self, task, plan):
        return {"observedAt": task["dueAt"], "dataSource": "recorded official + consensus",
                "linkVersion": plan["linkVersion"], "mapVersion": plan["mapVersion"],
                "official": {"eventKey": plan["eventKey"], "primarySourceVerified": True},
                "consensus": {"eventKey": "consensus-cpi", "status": "RELEASED_WITH_CONSENSUS"}}

    def capture_market(self, task, plan):
        return {"observedAt": task["dueAt"], "dataSource": "recorded consolidated market",
                "symbol": task["symbol"], "linkVersion": plan["linkVersion"],
                "mapVersion": plan["mapVersion"], "volumeScope": "consolidated",
                "quote": {"bid": 99.9, "ask": 100.1, "last": 100, "sessionVolume": 1000,
                          "expectedVolume": 800, "previousClose": 98, "atrPercent14": 5,
                          "halted": False}}


class MacroForwardPilotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.scheduler = MacroCaptureScheduler(Path(self.temp.name) / "pilot.sqlite3")

    def tearDown(self):
        self.scheduler.close()
        self.temp.cleanup()

    def active_summary(self):
        return {"activeStudies": [{
            "studyId": "recorded-cpi-hd-v1", "status": "REVIEWED_ACTIVE",
            "eventKey": "official-cpi-2026-10", "linkVersion": "cpi-link-v1",
            "symbols": ["HD"], "officialSeries": {"nextScheduledAt": "2026-10-14T12:30:00Z"},
        }]}

    def test_current_frozen_universe_blocks_real_registration(self):
        _, summary = load_universe(UNIVERSE)
        readiness = assess_pilot_readiness(
            summary, study_id="cpi-hd-v1", checked_at="2026-09-21T12:00:00Z",
            worker_id="supervised-worker", provider_status=PROVIDERS, clock_offset_milliseconds=50,
        )
        self.assertFalse(readiness["ready"])
        self.assertIn("study_not_active", readiness["blockers"])
        with self.assertRaisesRegex(ValueError, "macro_pilot_not_ready"):
            register_ready_pilot(self.scheduler, readiness, created_at="2026-09-21T12:00:00Z",
                                 map_version="macro-exposure-2026-09-20-v1")

    def test_preflight_reports_all_worker_provider_clock_and_timing_failures(self):
        readiness = assess_pilot_readiness(
            self.active_summary(), study_id="recorded-cpi-hd-v1",
            checked_at="2026-10-14T12:25:00Z", worker_id=" ",
            provider_status={"official_release": "READY"}, clock_offset_milliseconds=1001,
        )
        self.assertEqual(set(readiness["blockers"]), {
            "worker_identity_missing", "clock_not_synchronized", "provider_status_incomplete",
            "provider_not_ready", "baseline_window_already_started",
        })

    def test_recorded_complete_lifecycle_is_deterministic_and_research_only(self):
        readiness = assess_pilot_readiness(
            self.active_summary(), study_id="recorded-cpi-hd-v1",
            checked_at="2026-10-14T12:00:00Z", worker_id="supervised-worker",
            provider_status=PROVIDERS, clock_offset_milliseconds=-20,
        )
        plan = register_ready_pilot(self.scheduler, readiness, created_at="2026-10-14T12:00:00Z",
                                    map_version="macro-exposure-v1")
        worker = MacroCaptureWorker(self.scheduler, RecordedAdapter(), worker_id="supervised-worker")
        for now in ("2026-10-14T12:25:00Z", "2026-10-14T12:30:00Z",
                    "2026-10-14T12:31:00Z", "2026-10-14T12:35:00Z", "2026-10-14T13:00:00Z"):
            worker.run_once(now=now)
        evaluation = {"ruleset": "fixture-v1", "eligible": False, "failed": ["control"]}
        report = build_pilot_report(
            self.scheduler, plan["planId"], generated_at="2026-10-14T13:00:01Z",
            provider_status=PROVIDERS,
            replay_evaluations={"HD": {"original": evaluation, "replayed": dict(evaluation)}},
        )
        self.assertEqual(report["taskCounts"], {"COMPLETED": 5})
        self.assertTrue(report["complete"])
        self.assertTrue(report["performanceEligible"])
        self.assertFalse(report["orderSubmissionAllowed"])
        repeated = build_pilot_report(
            self.scheduler, plan["planId"], generated_at="2026-10-14T13:00:01Z",
            provider_status=PROVIDERS,
            replay_evaluations={"HD": {"original": evaluation, "replayed": dict(evaluation)}},
        )
        self.assertEqual(report["reportDigest"], repeated["reportDigest"])

    def test_partial_or_replay_mismatch_is_excluded_from_performance(self):
        plan = self.scheduler.register(
            {"eventKey": "event", "scheduledAt": "2026-10-14T12:30:00Z"}, ["HD"],
            created_at="2026-10-14T12:00:00Z", link_version="link-v1", map_version="map-v1",
        )
        MacroCaptureWorker(self.scheduler, RecordedAdapter(), worker_id="worker").run_once(
            now="2026-10-14T12:25:00Z")
        report = build_pilot_report(
            self.scheduler, plan["planId"], generated_at="2026-10-14T12:25:01Z",
            provider_status=PROVIDERS,
            replay_evaluations={"HD": {"original": {"a": 1}, "replayed": {"a": 2}}},
        )
        self.assertFalse(report["complete"])
        self.assertFalse(report["performanceEligible"])
        self.assertEqual(report["taskCounts"], {"COMPLETED": 1, "PENDING": 4})


if __name__ == "__main__": unittest.main()
