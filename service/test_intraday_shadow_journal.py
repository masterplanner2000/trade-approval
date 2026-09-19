import sqlite3
import tempfile
import unittest
from pathlib import Path

from intraday_shadow_journal import IntradayShadowJournal, all_deterministic


NOW = "2026-09-18T15:30:00Z"


def snapshot(symbol="BMNR", observed_at="2026-09-18T15:29:50Z", **changes):
    value = {
        "symbol": symbol, "observedAt": observed_at,
        "quoteObservedAt": "2026-09-18T15:29:58Z", "session": "regular",
        "halted": False, "priorClose": 23.89, "sessionOpen": 24.80,
        "lastPrice": 26.21, "sessionHigh": 26.21, "sessionLow": 24.49,
        "cumulativeVolume": 39_183_473, "expectedCumulativeVolume": 20_000_000,
        "bid": 26.19, "ask": 26.22, "dataSource": "fixture",
        "volumeScope": "consolidated",
    }
    value.update(changes)
    return value


class IntradayShadowJournalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "intraday.sqlite3"
        self.journal = IntradayShadowJournal(self.path)

    def tearDown(self):
        self.journal.close()
        self.temp.cleanup()

    def test_exact_repeated_observation_is_idempotent(self):
        first = self.journal.append(snapshot(), evaluated_at=NOW)
        second = self.journal.append(snapshot(), evaluated_at=NOW)
        self.assertTrue(first["created"])
        self.assertFalse(second["created"])
        self.assertEqual(first["observationId"], second["observationId"])
        self.assertEqual(len(self.journal.replay()), 1)

    def test_observations_are_immutable_at_the_database_boundary(self):
        item = self.journal.append(snapshot(), evaluated_at=NOW)
        with self.assertRaisesRegex(sqlite3.IntegrityError, "intraday_observations_are_immutable"):
            self.journal.connection.execute(
                "UPDATE intraday_observations SET symbol='EDITED' WHERE observation_id=?",
                (item["observationId"],),
            )
        self.journal.connection.rollback()
        with self.assertRaisesRegex(sqlite3.IntegrityError, "intraday_observations_are_immutable"):
            self.journal.connection.execute(
                "DELETE FROM intraday_observations WHERE observation_id=?", (item["observationId"],)
            )

    def test_replay_is_chronological_filtered_and_deterministic(self):
        self.journal.append(snapshot("ZZZ", "2026-09-18T15:29:55Z"), evaluated_at=NOW)
        self.journal.append(snapshot("BMNR", "2026-09-18T15:29:40Z"), evaluated_at=NOW)
        replayed = self.journal.replay()
        self.assertEqual([item["symbol"] for item in replayed], ["BMNR", "ZZZ"])
        self.assertTrue(all_deterministic(replayed))
        self.assertEqual(len(self.journal.replay(symbol="BMNR")), 1)
        self.assertEqual(len(self.journal.replay(through="2026-09-18T15:29:45Z")), 1)

    def test_failed_and_incomplete_observations_are_preserved(self):
        failed = self.journal.append(snapshot(session="postmarket"), evaluated_at=NOW)
        incomplete_value = snapshot()
        del incomplete_value["bid"]
        incomplete = self.journal.append(incomplete_value, evaluated_at=NOW)
        self.assertEqual(failed["evaluation"]["status"], "COMPLETE")
        self.assertFalse(failed["evaluation"]["eligible"])
        self.assertEqual(incomplete["evaluation"]["status"], "INCOMPLETE")
        self.assertEqual(len(self.journal.replay()), 2)

    def test_source_and_volume_scope_are_mandatory_provenance(self):
        value = snapshot()
        del value["dataSource"]
        with self.assertRaisesRegex(ValueError, "intraday_data_source_required"):
            self.journal.append(value, evaluated_at=NOW)
        with self.assertRaisesRegex(ValueError, "intraday_volume_scope_invalid"):
            self.journal.append(snapshot(volumeScope="maybe"), evaluated_at=NOW)

    def test_persistence_survives_restart(self):
        expected = self.journal.append(snapshot(), evaluated_at=NOW)
        self.journal.close()
        self.journal = IntradayShadowJournal(self.path)
        actual = self.journal.get(expected["observationId"])
        self.assertEqual(actual["evaluation"], expected["evaluation"])
        self.assertTrue(self.journal.replay()[0]["deterministic"])

    def test_unknown_historical_ruleset_is_not_reinterpreted(self):
        item = self.journal.append(snapshot(), evaluated_at=NOW)
        self.journal.connection.execute("DROP TRIGGER intraday_observations_no_update")
        self.journal.connection.execute(
            "UPDATE intraday_observations SET ruleset_version='retired-v0' WHERE observation_id=?",
            (item["observationId"],),
        )
        self.journal.connection.commit()
        replay = self.journal.replay()[0]
        self.assertFalse(replay["replaySupported"])
        self.assertIsNone(replay["deterministic"])
        self.assertIsNone(replay["replayedEvaluation"])


if __name__ == "__main__":
    unittest.main()
