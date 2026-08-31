"""Read completed IBKR daily bars and evaluate a deterministic shadow-only RSI study."""

from __future__ import annotations

import json
import sys
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone

from ibapi.client import EClient
from ibapi.contract import Contract
from ibapi.wrapper import EWrapper

from risk import calculate_equity_market_risk


HOST = "127.0.0.1"
PAPER_PORT = 7497
CLIENT_ID = 73
MINIMUM_BARS = 205
RULESET_VERSION = "daily-rsi-reversion-research-v1"

# Every number below is a proposed test variable, not a validated or source-supplied rule.
RSI_LENGTH = 14
RSI_ENTRY_MAX = 30.0
SMA_LENGTH = 200
MINIMUM_PRICE = 5.0
ADV_WINDOW = 20
MINIMUM_AVERAGE_DOLLAR_VOLUME = 20_000_000.0


@dataclass
class DailyBar:
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: float


class HistoricalScanner(EWrapper, EClient):
    def __init__(self) -> None:
        EClient.__init__(self, self)
        self.ready = threading.Event()
        self.done: dict[int, threading.Event] = {}
        self.bars: dict[int, list[DailyBar]] = {}
        self.errors: dict[int, list[dict[str, object]]] = {}

    def nextValidId(self, orderId: int) -> None:  # noqa: N802
        self.ready.set()

    def historicalData(self, reqId: int, bar) -> None:  # noqa: N802
        self.bars.setdefault(reqId, []).append(
            DailyBar(
                date=str(bar.date),
                open=float(bar.open),
                high=float(bar.high),
                low=float(bar.low),
                close=float(bar.close),
                volume=float(bar.volume),
            )
        )

    def historicalDataEnd(self, reqId: int, start: str, end: str) -> None:  # noqa: N802
        self.done.setdefault(reqId, threading.Event()).set()

    def error(self, reqId: int, *args) -> None:
        if len(args) >= 4:
            _, error_code, error_string, *_ = args
        else:
            error_code, error_string, *_ = args
        if error_code not in {2104, 2106, 2107, 2108, 2158}:
            self.errors.setdefault(reqId, []).append(
                {"code": int(error_code), "message": str(error_string)}
            )
            if reqId in self.done:
                self.done[reqId].set()


def stock(symbol: str) -> Contract:
    contract = Contract()
    contract.symbol = symbol
    contract.secType = "STK"
    contract.exchange = "SMART"
    contract.currency = "USD"
    return contract


def wilder_rsi(closes: list[float], length: int) -> float | None:
    if len(closes) <= length:
        return None
    changes = [closes[index] - closes[index - 1] for index in range(1, len(closes))]
    gains = [max(change, 0.0) for change in changes]
    losses = [max(-change, 0.0) for change in changes]
    average_gain = sum(gains[:length]) / length
    average_loss = sum(losses[:length]) / length
    for index in range(length, len(changes)):
        average_gain = ((average_gain * (length - 1)) + gains[index]) / length
        average_loss = ((average_loss * (length - 1)) + losses[index]) / length
    if average_loss == 0:
        return 100.0
    relative_strength = average_gain / average_loss
    return 100.0 - (100.0 / (1.0 + relative_strength))


def evaluate(symbol: str, bars: list[DailyBar], errors: list[dict[str, object]]) -> dict[str, object]:
    if len(bars) < MINIMUM_BARS:
        return {
            "symbol": symbol,
            "eligible": False,
            "error": "insufficient_completed_daily_bars",
            "barCount": len(bars),
            "warnings": errors,
        }

    completed = bars[:-1] if bars[-1].date == datetime.now().strftime("%Y%m%d") else bars
    if len(completed) < MINIMUM_BARS:
        return {
            "symbol": symbol,
            "eligible": False,
            "error": "insufficient_completed_daily_bars",
            "barCount": len(completed),
            "warnings": errors,
        }

    closes = [bar.close for bar in completed]
    latest = completed[-1]
    rsi = wilder_rsi(closes, RSI_LENGTH)
    sma = sum(closes[-SMA_LENGTH:]) / SMA_LENGTH
    average_dollar_volume = sum(
        bar.close * bar.volume for bar in completed[-ADV_WINDOW:]
    ) / ADV_WINDOW
    market_risk = calculate_equity_market_risk(completed)
    checks = [
        {"id": "price", "label": f"Close is at least ${MINIMUM_PRICE:.2f}", "passed": latest.close >= MINIMUM_PRICE, "actual": latest.close},
        {"id": "liquidity", "label": f"20-day average dollar volume is at least ${MINIMUM_AVERAGE_DOLLAR_VOLUME:,.0f}", "passed": average_dollar_volume >= MINIMUM_AVERAGE_DOLLAR_VOLUME, "actual": average_dollar_volume},
        {"id": "trend", "label": "Close is above the 200-day simple moving average", "passed": latest.close > sma, "actual": latest.close - sma},
        {"id": "rsi", "label": f"14-day RSI is at or below {RSI_ENTRY_MAX:.0f}", "passed": rsi is not None and rsi <= RSI_ENTRY_MAX, "actual": rsi},
    ]
    return {
        "symbol": symbol,
        "eligible": all(check["passed"] for check in checks),
        "signalDate": latest.date,
        "referenceClose": round(latest.close, 4),
        "rsi": round(rsi, 4) if rsi is not None else None,
        "sma200": round(sma, 4),
        "averageDollarVolume20": round(average_dollar_volume, 2),
        "marketRisk": market_risk,
        "barCount": len(completed),
        "checks": checks,
        "warnings": errors,
    }


def main() -> int:
    symbols = [item.upper() for item in sys.argv[1:] if item.isascii() and item.isalnum()]
    if not symbols:
        symbols = ["SPY", "QQQ", "IWM", "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA"]

    app = HistoricalScanner()
    try:
        app.connect(HOST, PAPER_PORT, clientId=CLIENT_ID)
        threading.Thread(target=app.run, daemon=True).start()
        if not app.ready.wait(8):
            print(json.dumps({"ok": False, "error": "tws_connection_timeout"}))
            return 1

        for index, symbol in enumerate(symbols, start=1):
            app.done[index] = threading.Event()
            app.bars[index] = []
            app.reqHistoricalData(
                index,
                stock(symbol),
                "",
                "1 Y",
                "1 day",
                "TRADES",
                1,
                1,
                False,
                [],
            )
            app.done[index].wait(15)
            time.sleep(0.15)

        evaluations = [
            evaluate(symbol, app.bars.get(index, []), app.errors.get(index, []))
            for index, symbol in enumerate(symbols, start=1)
        ]
        usable = [item for item in evaluations if item.get("rsi") is not None]
        qualified = [item for item in usable if item["eligible"]]
        ranked = sorted(qualified or usable, key=lambda item: float(item["rsi"]))
        print(json.dumps({
            "ok": bool(usable),
            "mode": "shadow",
            "rulesetVersion": RULESET_VERSION,
            "generatedAt": int(time.time() * 1000),
            "parameters": {
                "classification": "PROPOSED_TEST_VARIABLES",
                "rsiLength": RSI_LENGTH,
                "rsiEntryMaximum": RSI_ENTRY_MAX,
                "smaLength": SMA_LENGTH,
                "minimumPrice": MINIMUM_PRICE,
                "averageDollarVolumeWindow": ADV_WINDOW,
                "minimumAverageDollarVolume": MINIMUM_AVERAGE_DOLLAR_VOLUME,
            },
            "selected": ranked[0] if ranked else None,
            "qualifiedCount": len(qualified),
            "evaluations": evaluations,
            "error": None if usable else "historical_daily_data_unavailable",
        }))
        return 0 if usable else 1
    finally:
        if app.isConnected():
            app.disconnect()


if __name__ == "__main__":
    raise SystemExit(main())
