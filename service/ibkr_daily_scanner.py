"""Read completed IBKR daily bars and evaluate the large-cap momentum MVP."""

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
CLIENT_ID = 75
MINIMUM_BARS = 240
RULESET_VERSION = "liquid-growth-momentum-mvp-v2"

# Every number below is a proposed test variable, not a validated or source-supplied rule.
RSI_LENGTH = 14
RSI_ENTRY_MIN = 50.0
RSI_ENTRY_MAX = 72.0
FAST_SMA_LENGTH = 50
SLOW_SMA_LENGTH = 200
MOMENTUM_WINDOW = 20
MINIMUM_MOMENTUM_PERCENT = 2.0
MAXIMUM_MOMENTUM_PERCENT = 20.0
ADV_WINDOW = 20
MINIMUM_AVERAGE_DOLLAR_VOLUME = 50_000_000.0
MINIMUM_ATR_PERCENT = 1.0
MAXIMUM_ATR_PERCENT = 6.0


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


def average_true_range_percent(bars: list[DailyBar], length: int = 14) -> float | None:
    if len(bars) <= length or bars[-1].close <= 0:
        return None
    true_ranges = []
    for index in range(1, len(bars)):
        previous_close = bars[index - 1].close
        current = bars[index]
        true_ranges.append(max(current.high - current.low, abs(current.high - previous_close), abs(current.low - previous_close)))
    return (sum(true_ranges[-length:]) / length / bars[-1].close) * 100


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
    sma50 = sum(closes[-FAST_SMA_LENGTH:]) / FAST_SMA_LENGTH
    sma200 = sum(closes[-SLOW_SMA_LENGTH:]) / SLOW_SMA_LENGTH
    momentum20 = ((latest.close / closes[-(MOMENTUM_WINDOW + 1)]) - 1) * 100
    atr_percent = average_true_range_percent(completed)
    average_dollar_volume = sum(
        bar.close * bar.volume for bar in completed[-ADV_WINDOW:]
    ) / ADV_WINDOW
    market_risk = calculate_equity_market_risk(completed)
    checks = [
        {"id": "history", "label": f"At least {MINIMUM_BARS} completed daily bars are available", "passed": len(completed) >= MINIMUM_BARS, "actual": len(completed)},
        {"id": "liquidity", "label": f"20-day average dollar volume is at least ${MINIMUM_AVERAGE_DOLLAR_VOLUME:,.0f}", "passed": average_dollar_volume >= MINIMUM_AVERAGE_DOLLAR_VOLUME, "actual": average_dollar_volume},
        {"id": "trend", "label": "Close is above the 50- and 200-day averages", "passed": latest.close > sma50 > sma200, "actual": latest.close - sma50},
        {"id": "momentum", "label": f"20-day return is between {MINIMUM_MOMENTUM_PERCENT:.0f}% and {MAXIMUM_MOMENTUM_PERCENT:.0f}%", "passed": MINIMUM_MOMENTUM_PERCENT <= momentum20 <= MAXIMUM_MOMENTUM_PERCENT, "actual": momentum20},
        {"id": "rsi", "label": f"14-day RSI is between {RSI_ENTRY_MIN:.0f} and {RSI_ENTRY_MAX:.0f}", "passed": rsi is not None and RSI_ENTRY_MIN <= rsi <= RSI_ENTRY_MAX, "actual": rsi},
        {"id": "volatility", "label": f"14-day ATR is between {MINIMUM_ATR_PERCENT:.1f}% and {MAXIMUM_ATR_PERCENT:.1f}% of price", "passed": atr_percent is not None and MINIMUM_ATR_PERCENT <= atr_percent <= MAXIMUM_ATR_PERCENT, "actual": atr_percent},
    ]
    eligible = all(check["passed"] for check in checks)
    score = max(0.0, min(100.0,
        50.0
        + min(momentum20, 12.0) * 2.0
        + min(max((latest.close / sma50 - 1) * 100, 0.0), 10.0) * 2.0
        - abs((rsi or 61.0) - 61.0)
        - max((atr_percent or 0.0) - 3.0, 0.0) * 3.0
    ))
    return {
        "symbol": symbol,
        "eligible": eligible,
        "recommendationScore": round(score, 1) if eligible else None,
        "category": "MOMENTUM_CONTINUATION",
        "signalDate": latest.date,
        "referenceClose": round(latest.close, 4),
        "rsi": round(rsi, 4) if rsi is not None else None,
        "sma50": round(sma50, 4),
        "sma200": round(sma200, 4),
        "momentum20Percent": round(momentum20, 2),
        "atrPercent14": round(atr_percent, 2) if atr_percent is not None else None,
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
        ranked = sorted(qualified, key=lambda item: float(item["recommendationScore"]), reverse=True)
        print(json.dumps({
            "ok": bool(usable),
            "mode": "shadow",
            "rulesetVersion": RULESET_VERSION,
            "generatedAt": int(time.time() * 1000),
            "parameters": {
                "classification": "PROPOSED_TEST_VARIABLES",
                "rsiLength": RSI_LENGTH,
                "rsiEntryMinimum": RSI_ENTRY_MIN,
                "rsiEntryMaximum": RSI_ENTRY_MAX,
                "fastSmaLength": FAST_SMA_LENGTH,
                "slowSmaLength": SLOW_SMA_LENGTH,
                "momentumWindow": MOMENTUM_WINDOW,
                "minimumMomentumPercent": MINIMUM_MOMENTUM_PERCENT,
                "maximumMomentumPercent": MAXIMUM_MOMENTUM_PERCENT,
                "minimumCompletedDailyBars": MINIMUM_BARS,
                "averageDollarVolumeWindow": ADV_WINDOW,
                "minimumAverageDollarVolume": MINIMUM_AVERAGE_DOLLAR_VOLUME,
                "minimumAtrPercent": MINIMUM_ATR_PERCENT,
                "maximumAtrPercent": MAXIMUM_ATR_PERCENT,
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
