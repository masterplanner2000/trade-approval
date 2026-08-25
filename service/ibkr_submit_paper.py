"""Submit one tightly constrained limit order to an IBKR paper account."""

from __future__ import annotations

import json
import sys
import threading
from decimal import Decimal

from ibapi.client import EClient
from ibapi.contract import Contract
from ibapi.order import Order
from ibapi.wrapper import EWrapper


HOST = "127.0.0.1"
PAPER_PORT = 7497
CLIENT_ID = 74
ALLOWED_SYMBOLS = {"NVDA", "AAPL", "MSFT"}
MAX_QUANTITY = 5
MAX_NOTIONAL = Decimal("1500")


def safe_number(value):
    try:
        parsed = Decimal(str(value))
        return float(parsed) if parsed.is_finite() and abs(parsed) < Decimal("1e100") else None
    except Exception:
        return None


class PaperSubmit(EWrapper, EClient):
    def __init__(self) -> None:
        EClient.__init__(self, self)
        self.ready = threading.Event()
        self.done = threading.Event()
        self.next_order_id: int | None = None
        self.accounts: list[str] = []
        self.result: dict | None = None
        self.errors: list[dict[str, str | int]] = []

    def nextValidId(self, orderId: int) -> None:  # noqa: N802
        self.next_order_id = orderId
        self.ready.set()

    def managedAccounts(self, accountsList: str) -> None:  # noqa: N802
        self.accounts = [item for item in accountsList.split(",") if item]

    def orderStatus(  # noqa: N802
        self,
        orderId,
        status,
        filled,
        remaining,
        avgFillPrice,
        permId,
        parentId,
        lastFillPrice,
        clientId,
        whyHeld,
        mktCapPrice,
    ) -> None:
        if orderId != self.next_order_id:
            return
        self.result = {
            "orderId": orderId,
            "permanentId": permId or None,
            "status": status,
            "filled": safe_number(filled),
            "remaining": safe_number(remaining),
            "averageFillPrice": safe_number(avgFillPrice),
        }
        if status in {"PreSubmitted", "Submitted", "Filled", "Cancelled", "ApiCancelled", "Inactive"}:
            self.done.set()

    def error(self, reqId: int, *args) -> None:
        if len(args) >= 4:
            _, errorCode, errorString, *_ = args
        else:
            errorCode, errorString, *_ = args
        if errorCode in {2104, 2106, 2107, 2108, 2158, 2176}:
            return
        self.errors.append({"code": errorCode, "message": errorString})
        if reqId == self.next_order_id:
            self.done.set()


def main() -> int:
    try:
        request = json.loads(sys.argv[1])
        symbol = str(request["symbol"]).upper()
        action = str(request["action"]).upper()
        quantity = int(request["quantity"])
        limit_price = Decimal(str(request["limitPrice"]))
        expected_account = str(request["account"])
        decision_id = str(request["decisionId"])
    except Exception:
        print(json.dumps({"ok": False, "error": "invalid_request"}))
        return 2

    if symbol not in ALLOWED_SYMBOLS or action not in {"BUY", "SELL"}:
        print(json.dumps({"ok": False, "error": "instrument_or_action_blocked"}))
        return 2
    if quantity < 1 or quantity > MAX_QUANTITY or limit_price <= 0:
        print(json.dumps({"ok": False, "error": "size_blocked"}))
        return 2
    if Decimal(quantity) * limit_price > MAX_NOTIONAL:
        print(json.dumps({"ok": False, "error": "notional_blocked"}))
        return 2

    app = PaperSubmit()
    try:
        app.connect(HOST, PAPER_PORT, clientId=CLIENT_ID)
        threading.Thread(target=app.run, daemon=True).start()
        if not app.ready.wait(8):
            print(json.dumps({"ok": False, "error": "tws_connection_timeout"}))
            return 1
        app.reqManagedAccts()
        for _ in range(20):
            if app.accounts:
                break
            threading.Event().wait(0.1)
        if len(app.accounts) != 1 or not app.accounts[0].startswith("DU"):
            print(json.dumps({"ok": False, "error": "paper_account_required"}))
            return 1
        account = app.accounts[0]
        masked = f"{account[:3]}…{account[-3:]}"
        if masked != expected_account:
            print(json.dumps({"ok": False, "error": "account_mismatch"}))
            return 1

        contract = Contract()
        contract.symbol = symbol
        contract.secType = "STK"
        contract.exchange = "SMART"
        contract.currency = "USD"

        order = Order()
        order.account = account
        order.action = action
        order.orderType = "LMT"
        order.totalQuantity = Decimal(quantity)
        order.lmtPrice = float(limit_price)
        order.tif = "DAY"
        order.whatIf = False
        order.transmit = True
        order.orderRef = f"trade-approval-{decision_id[:12]}"

        app.placeOrder(app.next_order_id, contract, order)
        app.done.wait(12)
        output = {
            "ok": app.result is not None and not app.errors,
            "environment": "paper",
            "account": masked,
            "symbol": symbol,
            "action": action,
            "quantity": quantity,
            "limitPrice": float(limit_price),
            "result": app.result,
            "errors": app.errors,
        }
        print(json.dumps(output))
        return 0 if output["ok"] else 1
    finally:
        if app.isConnected():
            app.disconnect()


if __name__ == "__main__":
    raise SystemExit(main())
