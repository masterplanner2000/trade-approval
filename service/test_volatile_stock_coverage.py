from __future__ import annotations

import csv
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from volatile_stock_coverage import symbols_from_csv


class VolatileStockCoverageTests(unittest.TestCase):
    def test_csv_symbols_are_normalized_and_deduplicated(self) -> None:
        with TemporaryDirectory() as directory:
            path = Path(directory) / "stocks.csv"
            with path.open("w", newline="") as output:
                writer = csv.DictWriter(output, fieldnames=[
                    "Rank", "Symbol", "Company", "IV", "Price (USD)", "1D % Chg",
                    "Volume (shares)", "Market cap (USD)", "Watch",
                ])
                writer.writeheader()
                writer.writerow({"Rank": "1", "Symbol": " abc ", "Company": "ABC", "IV": "100%", "Price (USD)": "$5", "1D % Chg": "1%", "Volume (shares)": "1M", "Market cap (USD)": "1B"})
                writer.writerow({"Rank": "2", "Symbol": "ABC", "Company": "ABC", "IV": "99%", "Price (USD)": "$5", "1D % Chg": "2%", "Volume (shares)": "2M", "Market cap (USD)": "1B"})
            rows = symbols_from_csv(path)
        self.assertEqual([row["Symbol"] for row in rows], ["ABC"])


if __name__ == "__main__":
    unittest.main()
