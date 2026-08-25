"""Read-only connectivity check for an IBKR TWS paper-trading session."""

from __future__ import annotations

import threading
from decimal import Decimal

from ibapi.client import EClient
from ibapi.wrapper import EWrapper


HOST = "127.0.0.1"
PAPER_PORT = 7497
CLIENT_ID = 71


def mask_account(account: str) -> str:
    if len(account) < 5:
        return "***"
    return f"{account[:3]}…{account[-3:]}"


class ReadOnlyCheck(EWrapper, EClient):
    def __init__(self) -> None:
        EClient.__init__(self, self)
        self.ready = threading.Event()
        self.finished = threading.Event()
        self.accounts: list[str] = []
        self.summary: dict[str, tuple[str, str]] = {}
        self.failure: str | None = None

    def nextValidId(self, orderId: int) -> None:  # noqa: N802 (IBKR callback name)
        print("Connected to TWS paper API.")
        self.ready.set()

    def managedAccounts(self, accountsList: str) -> None:  # noqa: N802
        self.accounts = [value for value in accountsList.split(",") if value]

    def accountSummary(  # noqa: N802
        self, reqId: int, account: str, tag: str, value: str, currency: str
    ) -> None:
        self.summary[tag] = (value, currency)

    def accountSummaryEnd(self, reqId: int) -> None:  # noqa: N802
        self.finished.set()

    def error(self, reqId: int, *args) -> None:
        if len(args) >= 4:  # API 10.49+: errorTime, errorCode, message, advanced JSON
            _, errorCode, errorString, *_ = args
        else:
            errorCode, errorString, *_ = args
        # These codes are informational connection/farm status messages.
        if errorCode in {2104, 2106, 2107, 2108, 2158}:
            return
        self.failure = f"IBKR error {errorCode}: {errorString}"
        print(self.failure)


def main() -> int:
    app = ReadOnlyCheck()
    app.connect(HOST, PAPER_PORT, clientId=CLIENT_ID)
    worker = threading.Thread(target=app.run, daemon=True)
    worker.start()

    if not app.ready.wait(timeout=8):
        print(app.failure or "TWS did not complete the API handshake within 8 seconds.")
        app.disconnect()
        return 1

    app.reqManagedAccts()
    app.reqAccountSummary(9001, "All", "NetLiquidation,TotalCashValue,BuyingPower")
    app.finished.wait(timeout=8)

    if app.accounts:
        print("Paper account:", ", ".join(mask_account(value) for value in app.accounts))
    for label in ("NetLiquidation", "TotalCashValue", "BuyingPower"):
        if label in app.summary:
            value, currency = app.summary[label]
            try:
                rendered = f"{Decimal(value):,.2f}"
            except Exception:
                rendered = value
            print(f"{label}: {rendered} {currency}".rstrip())

    app.cancelAccountSummary(9001)
    app.disconnect()
    return 0 if app.accounts and not app.failure else 1


if __name__ == "__main__":
    raise SystemExit(main())
