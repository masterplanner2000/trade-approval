import sqlite3
import tempfile
import unittest
from pathlib import Path

from macro_capture_scheduler import MacroCaptureScheduler


EVENT = {"eventKey": "cpi-2026-10", "scheduledAt": "2026-10-01T12:30:00Z"}
CREATED = "2026-09-20T12:00:00Z"


class MacroCaptureSchedulerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "capture.sqlite3"
        self.scheduler = MacroCaptureScheduler(self.path)

    def tearDown(self):
        self.scheduler.close()
        self.temp.cleanup()

    def register(self):
        return self.scheduler.register(EVENT, ["TEST", "ALT"], created_at=CREATED,
                                       link_version="cpi-link-v1", map_version="map-v1")

    def test_forward_plan_is_idempotent_and_survives_restart(self):
        first, second = self.register(), self.register()
        self.assertTrue(first["created"])
        self.assertFalse(second["created"])
        self.assertEqual(len(first["tasks"]), 9)
        plan_id = first["planId"]
        self.scheduler.close()
        self.scheduler = MacroCaptureScheduler(self.path)
        self.assertEqual(len(self.scheduler.get_plan(plan_id)["tasks"]), 9)

    def test_plan_after_release_and_changed_symbols_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "macro_capture_not_forward_planned"):
            self.scheduler.register(EVENT, ["TEST"], created_at="2026-10-01T12:30:00Z",
                                    link_version="v1", map_version="m1")
        self.register()
        with self.assertRaisesRegex(ValueError, "macro_capture_plan_conflict"):
            self.scheduler.register(EVENT, ["TEST"], created_at=CREATED,
                                    link_version="cpi-link-v1", map_version="map-v1")

    def test_due_tasks_are_claimed_once_and_completion_is_window_bounded(self):
        self.register()
        claimed = self.scheduler.claim_due(now="2026-10-01T12:25:00Z", worker_id="worker-a")
        self.assertEqual(len(claimed), 2)
        self.assertTrue(all(item["kind"] == "baseline" for item in claimed))
        self.assertEqual(self.scheduler.claim_due(now="2026-10-01T12:25:00Z", worker_id="worker-b"), [])
        task = claimed[0]
        with self.assertRaisesRegex(ValueError, "macro_capture_claim_ownership_mismatch"):
            self.scheduler.finish(task["taskId"], worker_id="worker-b", completed_at="2026-10-01T12:25:10Z",
                                  status="FAILED", result={"reason": "test"})
        finished = self.scheduler.finish(
            task["taskId"], worker_id="worker-a", completed_at="2026-10-01T12:25:10Z",
            status="COMPLETED", result={"observedAt": "2026-10-01T12:25:10Z", "dataSource": "fixture"})
        self.assertEqual(finished["state"], "COMPLETED")

    def test_late_tasks_are_missed_and_never_claimed(self):
        plan = self.register()
        claimed = self.scheduler.claim_due(now="2026-10-01T13:03:01Z", worker_id="worker-a")
        self.assertEqual(claimed, [])
        states = [item["state"] for item in self.scheduler.get_plan(plan["planId"])["tasks"]]
        self.assertTrue(all(state == "MISSED" for state in states))

    def test_audit_history_is_immutable(self):
        self.register()
        task = self.scheduler.claim_due(now="2026-10-01T12:25:00Z", worker_id="worker-a")[0]
        self.assertEqual(self.scheduler.audit(task["taskId"])[0]["transition"], "CLAIMED")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "macro_capture_audit_is_immutable"):
            self.scheduler.connection.execute("UPDATE macro_capture_audit SET transition='X'")
        self.scheduler.connection.rollback()


if __name__ == "__main__":
    unittest.main()
