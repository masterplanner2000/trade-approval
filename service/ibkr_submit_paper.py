"""Submit one tightly constrained limit order to an IBKR paper account."""

from __future__ import annotations

import json
import re
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
MAX_QUANTITY = 5
MAX_NOTIONAL = Decimal("1500")
US_STOCK_SYMBOL = re.compile(r"^[A-Z][A-Z0-9.-]{0,9}$")


def valid_authorized_buy(symbol: str, action: str) -> bool:
    """Reject malformed instruments and every action except a server-approved buy."""
    return action == "BUY" and US_STOCK_SYMBOL.fullmatch(symbol) is not None


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
        self.results: dict[int, dict] = {}
        self.expected_order_ids: set[int] = set()
        self.errors: list[dict[str, str | int]] = []
        self.warnings: list[dict[str, str | int]] = []

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
        if orderId not in self.expected_order_ids:
            return
        self.results[orderId] = {
            "orderId": orderId,
            "permanentId": permId or None,
            "status": status,
            "filled": safe_number(filled),
            "remaining": safe_number(remaining),
            "averageFillPrice": safe_number(avgFillPrice),
        }
        if self.expected_order_ids.issubset(self.results):
            self.done.set()

    def openOrder(self, orderId, contract, order, orderState) -> None:  # noqa: N802
        if orderId not in self.expected_order_ids:
            return
        existing = self.results.get(orderId, {})
        self.results[orderId] = {
            **existing,
            "orderId": orderId,
            "status": existing.get("status") or orderState.status or "PendingSubmit",
            "action": order.action,
            "orderType": order.orderType,
            "parentId": order.parentId or None,
        }
        if self.expected_order_ids.issubset(self.results):
            self.done.set()

    def error(self, reqId: int, *args) -> None:
        if len(args) >= 4:
            _, errorCode, errorString, *_ = args
        else:
            errorCode, errorString, *_ = args
        if errorCode in {2104, 2106, 2107, 2108, 2158, 2176}:
            return
        if errorCode == 399 and "will not be placed at the exchange until" in errorString:
            self.warnings.append({"code": errorCode, "message": errorString})
            return
        self.errors.append({"code": errorCode, "message": errorString})
        if reqId in self.expected_order_ids:
            self.done.set()


def build_bracket_orders(parent_order_id: int, account: str, quantity: int, limit_price: float, target_price: float, stop_price: float, decision_id: str):
    parent = Order()
    parent.orderId = parent_order_id
    parent.account = account
    parent.action = "BUY"
    parent.orderType = "LMT"
    parent.totalQuantity = Decimal(quantity)
    parent.lmtPrice = limit_price
    parent.tif = "DAY"
    parent.transmit = False
    parent.eTradeOnly = False
    parent.firmQuoteOnly = False
    parent.orderRef = f"trade-approval-{decision_id[:12]}-entry"

    take_profit = Order()
    take_profit.orderId = parent_order_id + 1
    take_profit.account = account
    take_profit.action = "SELL"
    take_profit.orderType = "LMT"
    take_profit.totalQuantity = Decimal(quantity)
    take_profit.lmtPrice = target_price
    take_profit.parentId = parent_order_id
    take_profit.tif = "GTC"
    take_profit.transmit = False
    take_profit.eTradeOnly = False
    take_profit.firmQuoteOnly = False
    take_profit.orderRef = f"trade-approval-{decision_id[:12]}-target"

    stop_loss = Order()
    stop_loss.orderId = parent_order_id + 2
    stop_loss.account = account
    stop_loss.action = "SELL"
    stop_loss.orderType = "STP"
    stop_loss.totalQuantity = Decimal(quantity)
    stop_loss.auxPrice = stop_price
    stop_loss.parentId = parent_order_id
    stop_loss.tif = "GTC"
    stop_loss.transmit = True
    stop_loss.eTradeOnly = False
    stop_loss.firmQuoteOnly = False
    stop_loss.orderRef = f"trade-approval-{decision_id[:12]}-stop"

    return parent, take_profit, stop_loss


def main() -> int:
    try:
        request = json.loads(sys.argv[1])
        symbol = str(request["symbol"]).upper()
        action = str(request["action"]).upper()
        quantity = int(request["quantity"])
        limit_price = Decimal(str(request["limitPrice"]))
        stop_price = Decimal(str(request["stopPrice"]))
        target_price = Decimal(str(request["targetPrice"]))
        expected_account = str(request["account"])
        decision_id = str(request["decisionId"])
    except Exception:
        print(json.dumps({"ok": False, "error": "invalid_request"}))
        return 2

    if not valid_authorized_buy(symbol, action):
        print(json.dumps({"ok": False, "error": "instrument_or_action_blocked"}))
        return 2
    if quantity < 1 or quantity > MAX_QUANTITY or limit_price <= 0 or stop_price <= 0:
        print(json.dumps({"ok": False, "error": "size_blocked"}))
        return 2
    if not stop_price < limit_price < target_price:
        print(json.dumps({"ok": False, "error": "invalid_bracket_prices"}))
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

        parent, take_profit, stop_loss = build_bracket_orders(
            app.next_order_id,
            account,
            quantity,
            float(limit_price),
            float(target_price),
            float(stop_price),
            decision_id,
        )
        app.expected_order_ids = {parent.orderId, take_profit.orderId, stop_loss.orderId}
        app.placeOrder(parent.orderId, contract, parent)
        app.placeOrder(take_profit.orderId, contract, take_profit)
        app.placeOrder(stop_loss.orderId, contract, stop_loss)
        app.done.wait(12)
        parent_result = app.results.get(parent.orderId)
        exit_results = [app.results.get(take_profit.orderId), app.results.get(stop_loss.orderId)]
        output = {
            "ok": parent_result is not None and all(exit_results) and not app.errors,
            "environment": "paper",
            "account": masked,
            "symbol": symbol,
            "action": action,
            "quantity": quantity,
            "limitPrice": float(limit_price),
            "stopPrice": float(stop_price),
            "targetPrice": float(target_price),
            "result": parent_result,
            "exitOrders": exit_results,
            "errors": app.errors,
            "warnings": app.warnings,
        }
        print(json.dumps(output))
        return 0 if output["ok"] else 1
    finally:
        if app.isConnected():
            app.disconnect()


if __name__ == "__main__":
    raise SystemExit(main())
