import json
import unittest

from macro_consensus import calculate_standardized_surprise, fetch_trading_economics, normalize_trading_economics


NOW = "2026-09-20T14:00:00Z"


def item(**changes):
    value = {
        "CalendarID": "87220", "Date": "2026-10-02T12:30:00",
        "Country": "United States", "Category": "Non Farm Payrolls",
        "Event": "Non Farm Payrolls", "Reference": "Sep/26",
        "Source": "U.S. Bureau of Labor Statistics", "SourceURL": "https://www.bls.gov/",
        "ActualValue": 178000, "PreviousValue": 142000, "ForecastValue": 175000,
        "TEForecastValue": 180000, "DateSpan": "0", "Importance": 3,
        "LastUpdate": "2026-10-02T12:31:00", "Unit": "", "Ticker": "NFP TCH",
    }
    value.update(changes)
    return value


class Response:
    status = 200

    def __init__(self, payload, url):
        self.payload, self.url = payload, url

    def __enter__(self): return self
    def __exit__(self, *_): return False
    def geturl(self): return self.url
    def read(self, limit): return self.payload[:limit]


class MacroConsensusTests(unittest.TestCase):
    def test_numeric_consensus_record_preserves_actual_forecast_and_revision_fields(self):
        record = normalize_trading_economics([item()], retrieved_at=NOW)["records"][0]
        self.assertEqual(record["status"], "RELEASED_WITH_CONSENSUS")
        self.assertEqual(record["rawSurprise"], 3000)
        self.assertEqual(record["timingPrecision"], "exact")
        self.assertIsNone(record["standardizedSurprise"])

    def test_scheduled_and_missing_consensus_are_not_misrepresented_as_zero_surprise(self):
        scheduled = normalize_trading_economics([item(ActualValue=None)], retrieved_at=NOW)["records"][0]
        no_consensus = normalize_trading_economics([item(ForecastValue=None)], retrieved_at=NOW)["records"][0]
        self.assertEqual(scheduled["status"], "SCHEDULED")
        self.assertEqual(no_consensus["status"], "RELEASED_NO_CONSENSUS")
        self.assertIsNone(scheduled["rawSurprise"])
        self.assertIsNone(no_consensus["rawSurprise"])

    def test_low_importance_estimated_time_foreign_and_malformed_records_are_rejected(self):
        result = normalize_trading_economics([
            item(Importance=1), item(DateSpan="1"), item(Country="Canada"), {"bad": True}, item(),
        ], retrieved_at=NOW)
        self.assertEqual(len(result["records"]), 1)
        self.assertEqual(result["rejectedCount"], 4)
        self.assertEqual(result["status"], "partial")

    def test_standardization_uses_only_prior_same_series_observations(self):
        current = normalize_trading_economics([item()], retrieved_at=NOW)["records"][0]
        history = []
        for index in range(12):
            prior = dict(current)
            prior["scheduledAt"] = f"2025-{index + 1:02d}-01T12:30:00Z"
            prior["rawSurprise"] = (index - 6) * 1000
            history.append(prior)
        future = dict(current)
        future["scheduledAt"] = "2027-01-01T12:30:00Z"
        future["rawSurprise"] = 1_000_000
        other = dict(current)
        other["seriesKey"] = "other"
        other["rawSurprise"] = 1_000_000
        result = calculate_standardized_surprise(current, history + [future, other])
        self.assertEqual(result["sampleCount"], 12)
        self.assertIsNotNone(result["standardizedSurprise"])

    def test_insufficient_history_fails_closed(self):
        current = normalize_trading_economics([item()], retrieved_at=NOW)["records"][0]
        result = calculate_standardized_surprise(current, [])
        self.assertIsNone(result["standardizedSurprise"])
        self.assertEqual(result["reason"], "insufficient_prior_history")

    def test_fetcher_keeps_key_in_header_and_rejects_arbitrary_ranges(self):
        def opener(request, timeout):
            self.assertEqual(timeout, 10)
            self.assertNotIn("secret", request.full_url)
            self.assertEqual(request.headers["Authorization"], "secret")
            return Response(json.dumps([item()]).encode(), request.full_url)
        result = fetch_trading_economics(
            "2026-10-01", "2026-10-03", api_key="secret", retrieved_at=NOW, opener=opener
        )
        self.assertEqual(len(result["records"]), 1)
        with self.assertRaisesRegex(ValueError, "macro_consensus_date_range_invalid"):
            fetch_trading_economics(
                "2026-01-01", "2026-12-31", api_key="secret", retrieved_at=NOW, opener=opener
            )


if __name__ == "__main__":
    unittest.main()
