"""Run an IBKR paper-account What-If check. What-If orders are never executed."""

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
CLIENT_ID = 73
ALLOWED_SYMBOLS = {"NVDA", "AAPL", "MSFT"}
MAX_QUANTITY = 5
MAX_NOTIONAL = Decimal("1500")


def safe_number(value):
    try:
        parsed = Decimal(str(value))
        # IBKR uses the maximum double value as an "unset" placeholder.
        return float(parsed) if parsed.is_finite() and abs(parsed) < Decimal("1e100") else None
    except Exception:
        return None


class WhatIfCheck(EWrapper, EClient):
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

    def openOrder(self, orderId, contract, order, orderState) -> None:  # noqa: N802
        if orderId != self.next_order_id:
            return
        commission = getattr(
            orderState,
            "commissionAndFees",
            getattr(orderState, "commission", None),
        )
        minimum_commission = getattr(
            orderState,
            "minCommissionAndFees",
            getattr(orderState, "minCommission", None),
        )
        maximum_commission = getattr(
            orderState,
            "maxCommissionAndFees",
            getattr(orderState, "maxCommission", None),
        )
        commission_currency = getattr(
            orderState,
            "commissionAndFeesCurrency",
            getattr(orderState, "commissionCurrency", ""),
        )
        self.result = {
            "orderId": orderId,
            "returnedWhatIf": bool(getattr(order, "whatIf", False)),
            "status": orderState.status,
            "initialMarginChange": safe_number(orderState.initMarginChange),
            "maintenanceMarginChange": safe_number(orderState.maintMarginChange),
            "equityWithLoanChange": safe_number(orderState.equityWithLoanChange),
            "commission": safe_number(commission),
            "minimumCommission": safe_number(minimum_commission),
            "maximumCommission": safe_number(maximum_commission),
            "commissionCurrency": commission_currency or None,
            "warning": orderState.warningText or None,
        }
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

    app = WhatIfCheck()
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
        order.whatIf = True
        # IBKR requires transmit=True for validation; whatIf=True prevents execution.
        order.transmit = True
        # The PyPI API package retains legacy defaults rejected by current TWS.
        order.eTradeOnly = False
        order.firmQuoteOnly = False
        order.orderRef = "trade-approval-what-if"

        app.placeOrder(app.next_order_id, contract, order)
        app.done.wait(12)
        output = {
            "ok": app.result is not None and not app.errors,
            "environment": "paper",
            "whatIf": True,
            "transmit": True,
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
