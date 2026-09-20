import sqlite3
import tempfile
import unittest
from pathlib import Path

from macro_exposure_map import MacroExposureRegistry, validate_exposure_map


def document(version="theme-map-2026-09-20-v1", **changes):
    value = {
        "mapVersion": version, "status": "REVIEWED",
        "reviewedAt": "2026-09-20T15:00:00Z", "reviewedBy": "research-reviewer",
        "entries": [{
            "theme": "data_center_water_demand", "symbol": "TEST",
            "direction": 1, "strength": 0.8,
            "effectiveFrom": "2026-09-20T14:00:00Z", "effectiveTo": None,
            "rationale": "Documented revenue exposure to industrial water infrastructure demand.",
            "evidence": [{
                "kind": "regulatory_filing", "publisher": "Example filing authority",
                "url": "https://example.gov/filing", "publishedAt": "2026-09-19T12:00:00Z",
                "retrievedAt": "2026-09-20T13:00:00Z",
            }],
        }],
    }
    value.update(changes)
    return value


class MacroExposureMapTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "exposure.sqlite3"
        self.registry = MacroExposureRegistry(self.path)

    def tearDown(self):
        self.registry.close()
        self.temp.cleanup()

    def test_reviewed_version_is_idempotent_and_resolvable(self):
        first = self.registry.append(document())
        second = self.registry.append(document())
        self.assertTrue(first["created"])
        self.assertFalse(second["created"])
        exposure = self.registry.resolve(
            "data_center_water_demand", "test", at="2026-09-20T10:30:00-04:00",
            map_version="theme-map-2026-09-20-v1",
        )
        self.assertEqual(exposure["direction"], 1)
        self.assertEqual(exposure["effectiveFrom"], "2026-09-20T14:00:00Z")
        self.assertEqual(exposure["mappingVersion"], "theme-map-2026-09-20-v1")

    def test_draft_future_evidence_and_duplicate_pairs_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "exposure_map_not_reviewed"):
            validate_exposure_map(document(status="DRAFT"))
        future = document()
        future["entries"][0]["evidence"][0]["retrievedAt"] = "2026-09-21T13:00:00Z"
        with self.assertRaisesRegex(ValueError, "exposure_evidence_timestamp_invalid"):
            validate_exposure_map(future)
        duplicate = document()
        duplicate["entries"].append(dict(duplicate["entries"][0]))
        with self.assertRaisesRegex(ValueError, "exposure_entry_duplicate"):
            validate_exposure_map(duplicate)

    def test_expired_or_unknown_mapping_does_not_resolve(self):
        expired = document()
        expired["entries"][0]["effectiveTo"] = "2026-09-20T14:15:00Z"
        self.registry.append(expired)
        self.assertIsNone(self.registry.resolve(
            "data_center_water_demand", "TEST", at="2026-09-20T14:30:00Z",
            map_version="theme-map-2026-09-20-v1",
        ))
        self.assertIsNone(self.registry.resolve(
            "unknown_theme", "TEST", at="2026-09-20T14:00:00Z",
            map_version="theme-map-2026-09-20-v1",
        ))

    def test_changed_content_requires_new_version_and_supersedes_known_version(self):
        self.registry.append(document())
        changed = document()
        changed["entries"][0]["strength"] = 0.9
        with self.assertRaisesRegex(ValueError, "exposure_map_version_conflict"):
            self.registry.append(changed)
        successor = document("theme-map-2026-09-20-v2", supersedes="theme-map-2026-09-20-v1")
        successor["entries"][0]["strength"] = 0.9
        self.assertTrue(self.registry.append(successor)["created"])
        self.assertEqual(len(self.registry.versions()), 2)

    def test_history_is_immutable_at_database_boundary(self):
        self.registry.append(document())
        with self.assertRaisesRegex(sqlite3.IntegrityError, "exposure_map_history_is_immutable"):
            self.registry.connection.execute(
                "UPDATE exposure_map_entries SET strength=.9 WHERE map_version='theme-map-2026-09-20-v1'"
            )
        self.registry.connection.rollback()


if __name__ == "__main__":
    unittest.main()
