import tempfile
import unittest
from pathlib import Path

from macro_event_bias import evaluate_macro_event_bias
from macro_event_joiner import assemble_macro_evidence
from macro_event_journal import MacroEventJournal
from macro_exposure_map import MacroExposureRegistry


def exposure_document():
    return {
        "mapVersion": "map-v1", "status": "REVIEWED", "reviewedAt": "2026-09-20T12:00:00Z",
        "reviewedBy": "reviewer", "entries": [{
            "theme": "inflation_sensitive_growth", "symbol": "TEST", "direction": -1, "strength": .8,
            "effectiveFrom": "2026-09-01T00:00:00Z", "effectiveTo": None,
            "rationale": "Company reports establish material sensitivity to discount-rate changes.",
            "evidence": [{"kind": "company_report", "publisher": "Example company",
                          "url": "https://example.com/report", "publishedAt": "2026-08-01T00:00:00Z",
                          "retrievedAt": "2026-09-01T00:00:00Z"}],
        }],
    }


def records():
    official = {
        "provider": "U.S. Bureau of Labor Statistics", "feedId": "bls_consumer_price_index",
        "eventKey": "official-cpi-1", "eventType": "inflation", "publishedAt": "2026-09-20T12:30:00Z",
        "retrievedAt": "2026-09-20T12:31:00Z", "url": "https://www.bls.gov/cpi/release.htm",
        "primarySourceVerified": True, "contentFingerprint": "official-fingerprint",
        "status": "IDENTIFIED_NOT_SCORED",
    }
    consensus = {
        "provider": "Trading Economics", "providerEventId": "123", "eventKey": "consensus-cpi-1",
        "seriesKey": "series-cpi", "scheduledAt": "2026-09-20T12:30:00Z",
        "updatedAt": "2026-09-20T12:31:00Z", "retrievedAt": "2026-09-20T12:32:00Z",
        "source": "U.S. Bureau of Labor Statistics", "sourceUrl": "https://www.bls.gov/cpi/",
        "actualValue": 3.2, "consensusValue": 3.0, "unit": "%", "rawSurprise": .2,
        "standardizedSurprise": 1.5, "standardizationSampleCount": 18,
        "contentFingerprint": "consensus-fingerprint", "status": "RELEASED_WITH_CONSENSUS",
    }
    link = {
        "linkVersion": "cpi-growth-v1", "status": "REVIEWED", "reviewedAt": "2026-09-20T12:00:00Z",
        "reviewedBy": "reviewer", "officialEventKey": "official-cpi-1",
        "consensusEventKey": "consensus-cpi-1", "eventType": "inflation",
        "theme": "inflation_sensitive_growth",
        "rationale": "Reviewed crosswalk connects this official CPI release to the matching consensus series.",
        "evidence": [{"publisher": "U.S. Bureau of Labor Statistics", "url": "https://www.bls.gov/cpi/",
                      "publishedAt": "2026-09-01T00:00:00Z", "retrievedAt": "2026-09-20T11:00:00Z"}],
    }
    reaction = {"quoteObservedAt": "2026-09-20T12:34:30Z", "returnPercent": -2.0,
                "relativeVolume": 2.5, "atrPercent14": 6.0, "spreadBps": 20,
                "halted": False, "marketDataSource": "test consolidated feed", "volumeScope": "consolidated"}
    return official, consensus, link, reaction


class MacroEventJoinerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.exposures = MacroExposureRegistry(Path(self.temp.name) / "exposure.sqlite3")
        self.exposures.append(exposure_document())

    def tearDown(self):
        self.exposures.close()
        self.temp.cleanup()

    def assemble(self, **changes):
        official, consensus, link, reaction = records()
        for name, value in changes.items():
            {"official": official, "consensus": consensus, "link": link, "reaction": reaction}[name].update(value)
        return assemble_macro_evidence(official, consensus, link, reaction, symbol="TEST",
                                       map_version="map-v1", joined_at="2026-09-20T12:35:00Z",
                                       exposures=self.exposures)

    def test_reviewed_records_create_eligible_journal_ready_evidence(self):
        evidence = self.assemble()
        result = evaluate_macro_event_bias(evidence, now="2026-09-20T12:35:00Z")
        self.assertTrue(result["eligible"])
        self.assertEqual(result["biasDirection"], "AVOID_OR_EXIT")
        journal = MacroEventJournal(Path(self.temp.name) / "journal.sqlite3")
        try:
            self.assertTrue(journal.append(evidence, evaluated_at="2026-09-20T12:35:00Z")["created"])
        finally:
            journal.close()

    def test_identity_and_release_time_mismatches_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "macro_consensus_event_identity_mismatch"):
            self.assemble(consensus={"eventKey": "different"})
        with self.assertRaisesRegex(ValueError, "macro_release_schedule_mismatch"):
            self.assemble(consensus={"scheduledAt": "2026-09-18T12:30:00Z"})

    def test_unreviewed_link_or_incomplete_consensus_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "macro_event_link_not_reviewed"):
            self.assemble(link={"status": "DRAFT"})
        with self.assertRaisesRegex(ValueError, "macro_consensus_not_scored"):
            self.assemble(consensus={"standardizedSurprise": None, "standardizationSampleCount": 0})

    def test_inactive_exposure_and_pre_release_reaction_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "macro_exposure_not_active"):
            assemble_macro_evidence(*records()[:3], records()[3], symbol="OTHER", map_version="map-v1",
                                    joined_at="2026-09-20T12:35:00Z", exposures=self.exposures)
        with self.assertRaisesRegex(ValueError, "macro_reaction_timing_invalid"):
            self.assemble(reaction={"quoteObservedAt": "2026-09-20T12:29:00Z"})


if __name__ == "__main__":
    unittest.main()
