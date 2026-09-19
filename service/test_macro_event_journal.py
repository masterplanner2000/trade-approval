import sqlite3
import tempfile
import unittest
from pathlib import Path

from macro_event_journal import MacroEventJournal, all_deterministic


NOW = "2026-09-19T14:30:00Z"


def evidence(*, revision=1, symbol="WTTR", quote_at="2026-09-19T14:29:30Z"):
    return {
        "symbol": symbol,
        "event": {
            "eventKey": "industry:data-center-water:2026-09-19", "revision": revision,
            "type": "industry", "publishedAt": "2026-09-19T14:00:00Z",
            "primarySourceVerified": True, "independentSourceCount": 2,
            "surpriseMagnitude": 2.0, "confidence": 0.8,
            "sources": [{
                "publisher": "Example primary source", "url": "https://example.gov/release",
                "publishedAt": "2026-09-19T14:00:00Z", "retrievedAt": "2026-09-19T14:01:00Z",
            }],
        },
        "exposure": {
            "theme": "data-center-water-demand", "strength": 0.8, "direction": 1,
            "mappingVersion": "theme-map-v1", "rationale": "Revenue is directly exposed to industrial water demand.",
        },
        "reaction": {
            "quoteObservedAt": quote_at, "halted": False, "returnPercent": 3.2,
            "relativeVolume": 2.4, "atrPercent14": 6.5, "spreadBps": 24,
            "marketDataSource": "fixture", "volumeScope": "consolidated",
        },
    }


class MacroEventJournalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "macro.sqlite3"
        self.journal = MacroEventJournal(self.path)

    def tearDown(self):
        self.journal.close()
        self.temp.cleanup()

    def test_exact_observation_is_idempotent_and_survives_restart(self):
        first = self.journal.append(evidence(), evaluated_at=NOW)
        second = self.journal.append(evidence(), evaluated_at=NOW)
        self.assertTrue(first["created"])
        self.assertFalse(second["created"])
        self.journal.close()
        self.journal = MacroEventJournal(self.path)
        self.assertEqual(self.journal.get(first["observationId"])["evaluation"], first["evaluation"])

    def test_revisions_are_preserved_instead_of_overwriting_history(self):
        self.journal.append(evidence(revision=1), evaluated_at=NOW)
        revised = evidence(revision=2, quote_at="2026-09-19T14:29:40Z")
        revised["event"]["confidence"] = 0.9
        self.journal.append(revised, evaluated_at="2026-09-19T14:30:10Z")
        replay = self.journal.replay(event_key="industry:data-center-water:2026-09-19")
        self.assertEqual([item["eventRevision"] for item in replay], [1, 2])
        self.assertTrue(all_deterministic(replay))

    def test_sources_exposure_mapping_and_market_provenance_are_required(self):
        missing_sources = evidence()
        missing_sources["event"]["sources"] = []
        with self.assertRaisesRegex(ValueError, "macro_event_sources_required"):
            self.journal.append(missing_sources, evaluated_at=NOW)
        missing_mapping = evidence()
        del missing_mapping["exposure"]["mappingVersion"]
        with self.assertRaisesRegex(ValueError, "macro_exposure_mapping_version_required"):
            self.journal.append(missing_mapping, evaluated_at=NOW)
        bad_scope = evidence()
        bad_scope["reaction"]["volumeScope"] = "maybe"
        with self.assertRaisesRegex(ValueError, "macro_volume_scope_invalid"):
            self.journal.append(bad_scope, evaluated_at=NOW)

    def test_observations_are_immutable_at_database_boundary(self):
        item = self.journal.append(evidence(), evaluated_at=NOW)
        with self.assertRaisesRegex(sqlite3.IntegrityError, "macro_event_observations_are_immutable"):
            self.journal.connection.execute(
                "UPDATE macro_event_observations SET symbol='EDITED' WHERE observation_id=?",
                (item["observationId"],),
            )
        self.journal.connection.rollback()
        with self.assertRaisesRegex(sqlite3.IntegrityError, "macro_event_observations_are_immutable"):
            self.journal.connection.execute(
                "DELETE FROM macro_event_observations WHERE observation_id=?", (item["observationId"],)
            )

    def test_replay_filters_symbol_and_refuses_unknown_ruleset(self):
        item = self.journal.append(evidence(symbol="WTTR"), evaluated_at=NOW)
        self.journal.append(evidence(symbol="VRT"), evaluated_at=NOW)
        self.assertEqual(len(self.journal.replay(symbol="WTTR")), 1)
        self.journal.connection.execute("DROP TRIGGER macro_event_observations_no_update")
        self.journal.connection.execute(
            "UPDATE macro_event_observations SET ruleset_version='retired-v0' WHERE observation_id=?",
            (item["observationId"],),
        )
        self.journal.connection.commit()
        replay = self.journal.replay(symbol="WTTR")[0]
        self.assertFalse(replay["replaySupported"])
        self.assertIsNone(replay["deterministic"])


if __name__ == "__main__":
    unittest.main()
