"""Return a read-only IBKR paper account and stock-quote snapshot as JSON."""

from __future__ import annotations

import json
import sys
import threading
import time
from decimal import Decimal, InvalidOperation

from ibapi.client import EClient
from ibapi.contract import Contract
from ibapi.ticktype import TickTypeEnum
from ibapi.wrapper import EWrapper

from ibkr_connection import paper_connection


CONNECTION = paper_connection()
HOST = CONNECTION.host
PAPER_PORT = CONNECTION.port
CLIENT_ID = 72


def number(value: str | float) -> float | None:
    try:
        parsed = Decimal(str(value))
        return float(parsed) if parsed.is_finite() else None
    except (InvalidOperation, ValueError):
        return None


def mask_account(account: str) -> str:
    return f"{account[:3]}…{account[-3:]}" if len(account) >= 6 else "***"


class Snapshot(EWrapper, EClient):
    def __init__(self) -> None:
        EClient.__init__(self, self)
        self.ready = threading.Event()
        self.summary_done = threading.Event()
        self.quote_done = threading.Event()
        self.accounts: list[str] = []
        self.summary: dict[str, dict[str, str | float | None]] = {}
        self.quote: dict[str, float] = {}
        self.quote_received_at: dict[str, int] = {}
        self.market_data_type: int | None = None
        self.errors: list[dict[str, str | int]] = []

    def nextValidId(self, orderId: int) -> None:  # noqa: N802
        self.ready.set()

    def managedAccounts(self, accountsList: str) -> None:  # noqa: N802
        self.accounts = [item for item in accountsList.split(",") if item]

    def accountSummary(  # noqa: N802
        self, reqId: int, account: str, tag: str, value: str, currency: str
    ) -> None:
        self.summary[tag] = {"value": number(value), "currency": currency}

    def accountSummaryEnd(self, reqId: int) -> None:  # noqa: N802
        self.summary_done.set()

    def marketDataType(self, reqId: int, marketDataType: int) -> None:  # noqa: N802
        self.market_data_type = marketDataType

    def tickPrice(self, reqId: int, tickType: int, price: float, attrib) -> None:  # noqa: N802
        names = {
            TickTypeEnum.BID: "bid",
            TickTypeEnum.ASK: "ask",
            TickTypeEnum.LAST: "last",
            TickTypeEnum.CLOSE: "close",
            TickTypeEnum.DELAYED_BID: "bid",
            TickTypeEnum.DELAYED_ASK: "ask",
            TickTypeEnum.DELAYED_LAST: "last",
            TickTypeEnum.DELAYED_CLOSE: "close",
        }
        name = names.get(tickType)
        if name and price > 0:
            self.quote[name] = price
            self.quote_received_at[name] = int(time.time() * 1000)

    def tickSnapshotEnd(self, reqId: int) -> None:  # noqa: N802
        self.quote_done.set()

    def error(self, reqId: int, *args) -> None:
        if len(args) >= 4:
            _, errorCode, errorString, *_ = args
        else:
            errorCode, errorString, *_ = args
        if errorCode not in {2104, 2106, 2107, 2108, 2158}:
            self.errors.append({"code": errorCode, "message": errorString})


def stock(symbol: str) -> Contract:
    contract = Contract()
    contract.symbol = symbol
    contract.secType = "STK"
    contract.exchange = "SMART"
    contract.currency = "USD"
    return contract


def main() -> int:
    args = sys.argv[1:]
    live_only = "--live-only" in args
    args = [arg for arg in args if arg != "--live-only"]
    symbol = (args[0] if args else "NVDA").upper()
    if not symbol.isascii() or not symbol.isalnum() or len(symbol) > 10:
        print(json.dumps({"ok": False, "error": "invalid_symbol"}))
        return 2

    app = Snapshot()
    try:
        app.connect(HOST, PAPER_PORT, clientId=CLIENT_ID)
        threading.Thread(target=app.run, daemon=True).start()
        if not app.ready.wait(8):
            print(json.dumps({"ok": False, "error": "tws_connection_timeout"}))
            return 1

        app.reqManagedAccts()
        app.reqAccountSummary(9101, "All", "NetLiquidation,TotalCashValue,BuyingPower")
        # The diagnostic mode must not silently fall back to delayed quotes.
        app.reqMarketDataType(1 if live_only else 3)
        app.reqMktData(9102, stock(symbol), "", True, False, [])
        app.summary_done.wait(6)
        app.quote_done.wait(6)
        if not app.quote:
            time.sleep(1)

        result = {
            "ok": True,
            "environment": "paper",
            "readOnly": True,
            "requestedData": "live_only" if live_only else "delayed_fallback",
            "account": mask_account(app.accounts[0]) if app.accounts else None,
            "summary": app.summary,
            "quote": {
                "symbol": symbol,
                **app.quote,
                "dataType": app.market_data_type,
                "receivedAt": max(app.quote_received_at.values(), default=None),
                "bidReceivedAt": app.quote_received_at.get("bid"),
                "askReceivedAt": app.quote_received_at.get("ask"),
            },
            "warnings": app.errors,
        }
        print(json.dumps(result))
        return 0
    finally:
        if app.isConnected():
            app.cancelAccountSummary(9101)
            app.disconnect()


if __name__ == "__main__":
    raise SystemExit(main())
