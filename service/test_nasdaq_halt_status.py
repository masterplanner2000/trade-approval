import unittest

from nasdaq_halt_status import NasdaqHaltClient, parse_halt_feed


def feed(*items, published="Thu, 24 Sep 2026 17:05:29 GMT"):
    body = "".join(items)
    return f'''<?xml version="1.0" encoding="utf-8"?>
    <rss xmlns:ndaq="http://www.nasdaqtrader.com/"><channel>
    <pubDate>{published}</pubDate>{body}</channel></rss>'''.encode()


def item(symbol="TEST", halt="12:41:37.646", resume="", reason="LUDP"):
    resume_fields = (f"<ndaq:ResumptionDate>09/24/2026</ndaq:ResumptionDate>"
                     f"<ndaq:ResumptionTradeTime>{resume}</ndaq:ResumptionTradeTime>" if resume else "")
    return f'''<item><title>{symbol}</title><ndaq:HaltDate>09/24/2026</ndaq:HaltDate>
    <ndaq:HaltTime>{halt}</ndaq:HaltTime><ndaq:IssueSymbol>{symbol}</ndaq:IssueSymbol>
    <ndaq:Market>NASDAQ</ndaq:Market><ndaq:ReasonCode>{reason}</ndaq:ReasonCode>
    {resume_fields}</item>'''


class Response:
    status = 200
    def __init__(self, payload, url="https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts"):
        self.payload, self.url = payload, url
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def geturl(self): return self.url
    def read(self, count): return self.payload[:count]


class NasdaqHaltStatusTests(unittest.TestCase):
    def test_active_halt_is_detected_with_reason_and_no_authority(self):
        result = parse_halt_feed(
            feed(item()), symbol="TEST", observed_at="2026-09-24T17:05:30Z",
        )
        self.assertTrue(result["halted"])
        self.assertEqual(result["activeHalts"][0]["reasonCode"], "LUDP")
        self.assertFalse(result["orderSubmissionAllowed"])

    def test_resumed_or_other_symbol_is_not_currently_halted(self):
        result = parse_halt_feed(
            feed(item(resume="12:46:37"), item(symbol="OTHER")),
            symbol="TEST", observed_at="2026-09-24T17:05:30Z",
        )
        self.assertFalse(result["halted"])
        self.assertEqual(result["activeHalts"], [])

    def test_stale_future_malformed_and_entity_payloads_fail_closed(self):
        cases = [
            (feed(item(), published="Thu, 24 Sep 2026 17:00:00 GMT"), "halt_provider_stale_or_future"),
            (feed(item(), published="Thu, 24 Sep 2026 17:06:00 GMT"), "halt_provider_stale_or_future"),
            (b"not xml", "halt_provider_xml_invalid"),
            (b'<!DOCTYPE x [<!ENTITY y "z">]><rss/>', "halt_provider_xml_invalid"),
        ]
        for payload, error in cases:
            with self.subTest(error=error), self.assertRaisesRegex(ValueError, error):
                parse_halt_feed(payload, symbol="TEST", observed_at="2026-09-24T17:05:30Z")

    def test_client_uses_fixed_https_host_and_rejects_redirect(self):
        requests = []
        def opener(request, **kwargs):
            requests.append(request)
            return Response(feed(item(symbol="OTHER")))
        result = NasdaqHaltClient(opener=opener).fetch(
            "test", observed_at="2026-09-24T17:05:30Z",
        )
        self.assertFalse(result["halted"])
        self.assertEqual(requests[0].full_url,
                         "https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts")
        many = NasdaqHaltClient(opener=opener).fetch_many(
            ["TEST", "OTHER", "TEST"], observed_at="2026-09-24T17:05:30Z",
        )
        self.assertEqual(set(many), {"TEST", "OTHER"})
        self.assertEqual(len(requests), 2)
        client = NasdaqHaltClient(opener=lambda *args, **kwargs: Response(
            feed(), url="https://attacker.example/feed"))
        with self.assertRaisesRegex(ValueError, "halt_provider_redirect_not_allowed"):
            client.fetch("TEST", observed_at="2026-09-24T17:05:30Z")


if __name__ == "__main__":
    unittest.main()
