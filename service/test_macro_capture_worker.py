import tempfile
import unittest
from pathlib import Path

from macro_capture_scheduler import MacroCaptureScheduler
from macro_capture_worker import MacroCaptureWorker


EVENT = {"eventKey": "cpi-2026-10", "scheduledAt": "2026-10-01T12:30:00Z"}


class FixtureAdapter:
    def __init__(self, *, fail=False, invalid=False, crash=False):
        self.fail, self.invalid, self.crash = fail, invalid, crash

    def capture_release(self, task, plan):
        if self.crash:
            raise KeyboardInterrupt("simulated process death")
        if self.fail:
            raise RuntimeError("secret-key=must-not-be-persisted")
        if self.invalid:
            return {"observedAt": task["dueAt"], "dataSource": "fixture"}
        return {"observedAt": task["dueAt"], "dataSource": "fixture release",
                "linkVersion": plan["linkVersion"], "mapVersion": plan["mapVersion"],
                "official": {"eventKey": plan["eventKey"], "primarySourceVerified": True},
                "consensus": {"eventKey": "consensus-1", "status": "RELEASED_WITH_CONSENSUS"}}

    def capture_market(self, task, plan):
        if self.crash:
            raise KeyboardInterrupt("simulated process death")
        if self.fail:
            raise RuntimeError("secret-key=must-not-be-persisted")
        if self.invalid:
            return {"observedAt": task["dueAt"], "dataSource": "fixture", "quote": {}}
        return {"observedAt": task["dueAt"], "dataSource": "fixture market",
                "symbol": task["symbol"], "linkVersion": plan["linkVersion"],
                "mapVersion": plan["mapVersion"],
                "volumeScope": "consolidated", "quote": {
                    "bid": 99.9, "ask": 100.1, "last": 100.0, "sessionVolume": 1000,
                    "expectedVolume": 800, "previousClose": 98.0, "atrPercent14": 5.0,
                    "halted": False}}


class MacroCaptureWorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "capture.sqlite3"
        self.scheduler = MacroCaptureScheduler(self.path)
        self.plan = self.scheduler.register(
            EVENT, ["TEST"], created_at="2026-09-20T12:00:00Z",
            link_version="link-v1", map_version="map-v1")

    def tearDown(self):
        self.scheduler.close()
        self.temp.cleanup()

    def test_market_and_release_tasks_complete_exactly_once(self):
        worker = MacroCaptureWorker(self.scheduler, FixtureAdapter(), worker_id="worker-a")
        baseline = worker.run_once(now="2026-10-01T12:25:00Z")
        release = worker.run_once(now="2026-10-01T12:30:00Z")
        self.assertEqual((baseline["completedCount"], release["completedCount"]), (1, 1))
        self.assertEqual(worker.run_once(now="2026-10-01T12:30:00Z")["claimedCount"], 0)
        self.assertEqual(release["outcomes"][0]["result"]["workerVersion"], "macro-capture-worker-v1")

    def test_provider_errors_are_sanitized_and_terminal(self):
        worker = MacroCaptureWorker(self.scheduler, FixtureAdapter(fail=True), worker_id="worker-a")
        result = worker.run_once(now="2026-10-01T12:25:00Z")
        self.assertEqual(result["failedCount"], 1)
        saved = str(result["outcomes"][0]["result"])
        self.assertNotIn("secret-key", saved)
        self.assertEqual(worker.run_once(now="2026-10-01T12:25:00Z")["claimedCount"], 0)

    def test_invalid_provider_evidence_fails_instead_of_completing(self):
        worker = MacroCaptureWorker(self.scheduler, FixtureAdapter(invalid=True), worker_id="worker-a")
        result = worker.run_once(now="2026-10-01T12:25:00Z")
        self.assertEqual(result["failedCount"], 1)

    def test_wrong_symbol_event_or_pinned_version_fails_closed(self):
        class WrongSymbol(FixtureAdapter):
            def capture_market(self, task, plan):
                return {**super().capture_market(task, plan), "symbol": "OTHER"}
        result = MacroCaptureWorker(self.scheduler, WrongSymbol(), worker_id="worker-a").run_once(
            now="2026-10-01T12:25:00Z")
        self.assertEqual(result["failedCount"], 1)

        other_path = Path(self.temp.name) / "other.sqlite3"
        other = MacroCaptureScheduler(other_path)
        try:
            other.register(EVENT, ["TEST"], created_at="2026-09-20T12:00:00Z",
                           link_version="link-v1", map_version="map-v1")
            class WrongRelease(FixtureAdapter):
                def capture_release(self, task, plan):
                    value = super().capture_release(task, plan)
                    value["official"]["eventKey"] = "other-event"
                    value["mapVersion"] = "other-map"
                    return value
            failed = MacroCaptureWorker(other, WrongRelease(), worker_id="worker-b").run_once(
                now="2026-10-01T12:30:00Z")
            self.assertEqual(failed["failedCount"], 1)
        finally:
            other.close()

    def test_process_death_leaves_claim_visible_after_restart(self):
        worker = MacroCaptureWorker(self.scheduler, FixtureAdapter(crash=True), worker_id="worker-a")
        with self.assertRaises(KeyboardInterrupt):
            worker.run_once(now="2026-10-01T12:25:00Z")
        task_id = next(item["taskId"] for item in self.plan["tasks"] if item["kind"] == "baseline")
        self.scheduler.close()
        self.scheduler = MacroCaptureScheduler(self.path)
        self.assertEqual(self.scheduler.get_task(task_id)["state"], "CLAIMED")
        other = MacroCaptureWorker(self.scheduler, FixtureAdapter(), worker_id="worker-b")
        self.assertEqual(other.run_once(now="2026-10-01T12:25:10Z")["claimedCount"], 0)


if __name__ == "__main__":
    unittest.main()
