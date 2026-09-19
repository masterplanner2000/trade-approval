import json
import tempfile
import unittest
from pathlib import Path

from intraday_shadow_journal import IntradayShadowJournal
from intraday_shadow_replay import build_outcome_report, import_jsonl, load_jsonl


def snapshot(observed_at, price, *, symbol="BMNR", relative_volume=2.0):
    return {
        "symbol": symbol, "observedAt": observed_at, "quoteObservedAt": observed_at,
        "session": "regular", "halted": False, "priorClose": 23.89,
        "sessionOpen": 24.80, "lastPrice": price, "sessionHigh": max(26.5, price),
        "sessionLow": 24.49, "cumulativeVolume": 40_000_000,
        "expectedCumulativeVolume": 40_000_000 / relative_volume,
        "bid": price - 0.01, "ask": price + 0.01,
        "dataSource": "fixture", "volumeScope": "consolidated",
    }


class IntradayShadowReplayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.journal = IntradayShadowJournal(self.directory / "journal.sqlite3")

    def tearDown(self):
        self.journal.close()
        self.temp.cleanup()

    def write_jsonl(self, records):
        path = self.directory / "observations.jsonl"
        path.write_text("\n".join(json.dumps(item) for item in records), encoding="utf-8")
        return path

    def test_import_validates_whole_file_before_writing_and_is_idempotent(self):
        records = [
            {"evaluatedAt": "2026-09-18T15:30:01Z", "snapshot": snapshot("2026-09-18T15:30:00Z", 26.21)},
            {"evaluatedAt": "2026-09-18T15:35:01Z", "snapshot": snapshot("2026-09-18T15:35:00Z", 26.50)},
        ]
        path = self.write_jsonl(records)
        first = import_jsonl(path, self.journal)
        second = import_jsonl(path, self.journal)
        self.assertEqual((first["created"], first["duplicates"]), (2, 0))
        self.assertEqual((second["created"], second["duplicates"]), (0, 2))
        invalid = self.write_jsonl(records + [{"evaluatedAt": 123, "snapshot": {}}])
        with self.assertRaisesRegex(ValueError, "invalid_evaluated_at_line_3"):
            import_jsonl(invalid, self.journal)
        self.assertEqual(len(self.journal.replay()), 2)

        missing_provenance = self.write_jsonl(records + [{
            "evaluatedAt": "2026-09-18T15:40:01Z",
            "snapshot": {**snapshot("2026-09-18T15:40:00Z", 26.70), "dataSource": ""},
        }])
        with self.assertRaisesRegex(ValueError, "invalid_data_source_line_3"):
            import_jsonl(missing_provenance, self.journal)
        self.assertEqual(len(self.journal.replay()), 2)

    def test_invalid_json_and_empty_files_are_rejected(self):
        path = self.directory / "bad.jsonl"
        path.write_text("{bad", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "invalid_jsonl_line_1"):
            load_jsonl(path)
        path.write_text("\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "recorded_snapshot_file_empty"):
            load_jsonl(path)

    def test_report_uses_first_eligible_observation_and_exact_horizon_windows(self):
        observations = [
            ("2026-09-18T15:29:00Z", 24.20, 0.5),  # ineligible relative volume
            ("2026-09-18T15:30:00Z", 26.21, 2.0),  # first eligible signal
            ("2026-09-18T15:31:00Z", 26.00, 2.0),
            ("2026-09-18T15:35:00Z", 26.50, 2.0),
            ("2026-09-18T16:00:00Z", 25.50, 2.0),
            ("2026-09-18T19:59:00Z", 27.00, 2.0),
        ]
        for observed_at, price, volume in observations:
            self.journal.append(snapshot(observed_at, price, relative_volume=volume), evaluated_at=observed_at)
        report = build_outcome_report(self.journal.replay())
        self.assertEqual(report["outcomeCount"], 1)
        outcome = report["outcomes"][0]
        self.assertEqual(outcome["signalObservedAt"], "2026-09-18T15:30:00Z")
        self.assertEqual(outcome["horizons"]["5m"]["price"], 26.50)
        self.assertEqual(outcome["horizons"]["30m"]["price"], 25.50)
        self.assertEqual(outcome["lastObserved"]["price"], 27.00)
        self.assertGreater(outcome["maximumFavorableExcursionPercent"], 0)
        self.assertLess(outcome["maximumAdverseExcursionPercent"], 0)
        self.assertEqual(outcome["status"], "COMPLETE")
        self.assertFalse(report["orderSubmissionAllowed"])

    def test_missing_horizons_remain_incomplete_instead_of_using_nearest_distant_price(self):
        self.journal.append(snapshot("2026-09-18T15:30:00Z", 26.21), evaluated_at="2026-09-18T15:30:00Z")
        self.journal.append(snapshot("2026-09-18T15:40:00Z", 27.00), evaluated_at="2026-09-18T15:40:00Z")
        outcome = build_outcome_report(self.journal.replay())["outcomes"][0]
        self.assertIsNone(outcome["horizons"]["5m"])
        self.assertIsNone(outcome["horizons"]["30m"])
        self.assertEqual(outcome["status"], "INCOMPLETE")

    def test_no_eligible_observation_produces_no_outcome(self):
        self.journal.append(snapshot("2026-09-18T15:30:00Z", 24.20, relative_volume=0.2),
                            evaluated_at="2026-09-18T15:30:00Z")
        report = build_outcome_report(self.journal.replay())
        self.assertEqual(report["outcomeCount"], 0)
        self.assertEqual(report["observationCount"], 1)


if __name__ == "__main__":
    unittest.main()
