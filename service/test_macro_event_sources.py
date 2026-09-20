import unittest

from macro_event_sources import fetch_official_source, normalize_bls_calendar, normalize_rss


NOW = "2026-09-20T14:00:00Z"

FED_RSS = b"""<?xml version='1.0'?>
<rss><channel><item><title>Federal Reserve issues FOMC statement</title>
<link>https://www.federalreserve.gov/newsevents/pressreleases/monetary20260918a.htm</link>
<guid>monetary20260918a</guid><pubDate>Fri, 18 Sep 2026 14:00:00 GMT</pubDate>
</item></channel></rss>"""

BLS_RSS = b"""<?xml version='1.0'?>
<rss><channel><item><title>Consumer Price Index - August 2026</title>
<link>https://www.bls.gov/news.release/cpi.nr0.htm</link>
<guid>cpi-2026-08</guid><pubDate>Fri, 11 Sep 2026 08:30:00 -0400</pubDate>
</item></channel></rss>"""

BLS_ICS = b"""BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:empsit-2026-10@bls.gov\r
DTSTART;TZID=America/New_York:20261002T083000\r
SUMMARY:Employment Situation\r
END:VEVENT\r
END:VCALENDAR\r
"""


class Response:
    def __init__(self, payload, url):
        self.payload = payload
        self.url = url

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def geturl(self):
        return self.url

    def read(self, limit):
        return self.payload[:limit]


class MacroEventSourceTests(unittest.TestCase):
    def test_fed_and_bls_feeds_normalize_to_same_contract(self):
        fed = normalize_rss("fed_monetary_policy", FED_RSS, retrieved_at=NOW)["events"][0]
        bls = normalize_rss("bls_consumer_price_index", BLS_RSS, retrieved_at=NOW)["events"][0]
        self.assertEqual(fed["eventType"], "monetary_policy")
        self.assertEqual(bls["eventType"], "inflation")
        self.assertTrue(fed["primarySourceVerified"])
        self.assertEqual(fed["status"], "IDENTIFIED_NOT_SCORED")
        self.assertIsNone(fed["surprise"])

    def test_changed_content_preserves_identity_but_changes_fingerprint(self):
        original = normalize_rss("fed_monetary_policy", FED_RSS, retrieved_at=NOW)["events"][0]
        corrected = normalize_rss(
            "fed_monetary_policy", FED_RSS.replace(b"issues FOMC", b"corrects FOMC"), retrieved_at=NOW
        )["events"][0]
        self.assertEqual(original["eventKey"], corrected["eventKey"])
        self.assertNotEqual(original["contentFingerprint"], corrected["contentFingerprint"])

    def test_untrusted_link_and_malformed_item_are_rejected_not_promoted(self):
        unsafe = BLS_RSS.replace(b"https://www.bls.gov/", b"https://example.com/")
        result = normalize_rss("bls_consumer_price_index", unsafe, retrieved_at=NOW)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["rejectedCount"], 1)
        self.assertEqual(result["events"], [])
        with self.assertRaisesRegex(ValueError, "macro_feed_unsafe_xml"):
            normalize_rss("fed_monetary_policy", b"<!DOCTYPE x><rss/>", retrieved_at=NOW)

    def test_bls_calendar_preserves_official_eastern_release_time(self):
        event = normalize_bls_calendar(BLS_ICS, retrieved_at=NOW)["events"][0]
        self.assertEqual(event["scheduledAt"], "2026-10-02T12:30:00Z")
        self.assertEqual(event["status"], "SCHEDULED")

    def test_fetcher_uses_allowlist_and_rejects_cross_host_redirect(self):
        def allowed(request, timeout):
            self.assertEqual(timeout, 10)
            return Response(FED_RSS, request.full_url)
        result = fetch_official_source("fed_monetary_policy", retrieved_at=NOW, opener=allowed)
        self.assertEqual(len(result["events"]), 1)

        def redirected(_request, timeout):
            return Response(FED_RSS, "https://example.com/feed.xml")
        with self.assertRaisesRegex(ValueError, "macro_source_redirect_not_allowed"):
            fetch_official_source("fed_monetary_policy", retrieved_at=NOW, opener=redirected)
        with self.assertRaisesRegex(ValueError, "macro_source_not_allowed"):
            fetch_official_source("arbitrary_url", retrieved_at=NOW, opener=allowed)


if __name__ == "__main__":
    unittest.main()
