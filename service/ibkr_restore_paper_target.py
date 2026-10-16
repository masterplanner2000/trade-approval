"""Restore one cancelled IBKR Paper profit target into its surviving OCA pair.

The adapter is deliberately narrow: it never cancels or modifies the active
protective stop. It only recreates the exact missing limit target after
proving the stop and cancelled target share the same IBKR OCA group.
"""
from __future__ import annotations

import json
import sys
import threading
from decimal import Decimal

from ibapi.client import EClient
from ibapi.order import Order
from ibapi.wrapper import EWrapper

from ibkr_connection import paper_connection


CONNECTION = paper_connection()
CLIENT_ID = 74
ACTIVE = {"PendingSubmit", "PreSubmitted", "Submitted", "PartiallyFilled"}
IGNORED = {2104, 2106, 2107, 2108, 2158, 2176}


def identity(row):
    return str(row["permanentId"] or row["orderId"])


def masked(account):
    return f"{account[:3]}…{account[-3:]}" if len(account) >= 6 else "***"


def validate_pair(stop, cancelled_target, request):
    quantity = Decimal(str(request["quantity"]))
    price = Decimal(str(request["limitPrice"]))
    same_contract = stop["contract"].conId == cancelled_target["contract"].conId
    same_group = bool(stop["order"].ocaGroup) and stop["order"].ocaGroup == cancelled_target["order"].ocaGroup
    stop_ref = stop["order"].orderRef or ""
    target_ref = cancelled_target["order"].orderRef or ""
    same_strategy_ref = stop_ref.endswith("-stop") and target_ref == f"{stop_ref[:-5]}-target"
    return (
        stop["clientId"] == CLIENT_ID
        # IBKR completed-order callbacks can normalize the historical client
        # ID to zero. In that case the exact OCA group, contract and paired
        # strategy orderRef provide the ownership proof.
        and cancelled_target["clientId"] in {0, CLIENT_ID}
        and stop["contract"].symbol == request["symbol"]
        and cancelled_target["contract"].symbol == request["symbol"]
        and same_contract
        and stop["status"] in ACTIVE
        and stop["order"].action == "SELL"
        and stop["order"].orderType == "STP"
        and Decimal(str(stop["order"].totalQuantity)) == quantity
        and cancelled_target["status"] == "Cancelled"
        and cancelled_target["order"].action == "SELL"
        and cancelled_target["order"].orderType == "LMT"
        and Decimal(str(cancelled_target["order"].totalQuantity)) == quantity
        and Decimal(str(cancelled_target["order"].lmtPrice)) == price
        and same_group
        and same_strategy_ref
        and int(stop["order"].ocaType or 0) == int(cancelled_target["order"].ocaType or 0) == 3
    )


class TargetRestore(EWrapper, EClient):
    def __init__(self):
        EClient.__init__(self, self)
        self.ready = threading.Event()
        self.open_done = threading.Event()
        self.completed_done = threading.Event()
        self.ack = threading.Event()
        self.next_order_id = None
        self.accounts = []
        self.open_orders = {}
        self.completed_orders = {}
        self.expected_order_id = None
        self.expected_price = None
        self.result = None
        self.errors = []

    def nextValidId(self, orderId):  # noqa: N802
        self.next_order_id = orderId
        self.ready.set()

    def managedAccounts(self, accountsList):  # noqa: N802
        self.accounts = [value for value in accountsList.split(",") if value]

    @staticmethod
    def record(orderId, contract, order, status):
        return {
            "orderId": int(orderId or 0),
            "permanentId": int(order.permId or 0) or None,
            "clientId": int(order.clientId or 0),
            "contract": contract,
            "order": order,
            "status": status or "Unknown",
        }

    def openOrder(self, orderId, contract, order, orderState):  # noqa: N802
        row = self.record(orderId, contract, order, orderState.status)
        self.open_orders[identity(row)] = row
        if orderId == self.expected_order_id and Decimal(str(order.lmtPrice)) == self.expected_price:
            self.result = {
                "orderId": orderId,
                "permanentId": row["permanentId"],
                "status": row["status"],
                "limitPrice": float(order.lmtPrice),
                "ocaGroup": order.ocaGroup,
                "ocaType": int(order.ocaType or 0),
                "orderRef": order.orderRef,
            }
            self.ack.set()

    def openOrderEnd(self):  # noqa: N802
        self.open_done.set()

    def completedOrder(self, contract, order, orderState):  # noqa: N802
        row = self.record(order.orderId, contract, order, orderState.status)
        self.completed_orders[identity(row)] = row

    def completedOrdersEnd(self):  # noqa: N802
        self.completed_done.set()

    def error(self, reqId, *args):
        code, message = (args[1], args[2]) if len(args) >= 4 else (args[0], args[1])
        if code not in IGNORED:
            self.errors.append({"code": code, "message": message})
            if reqId == self.expected_order_id:
                self.ack.set()


def main():
    try:
        request = json.loads(sys.argv[1])
        request = {
            "account": str(request["account"]),
            "symbol": str(request["symbol"]).upper(),
            "quantity": Decimal(str(request["quantity"])),
            "limitPrice": Decimal(str(request["limitPrice"])),
            "stopId": str(request["stopId"]),
            "cancelledTargetId": str(request["cancelledTargetId"]),
            "requestId": str(request["requestId"]),
        }
    except Exception:
        print(json.dumps({"ok": False, "error": "invalid_request"}))
        return 2
    if request["quantity"] <= 0 or request["limitPrice"] <= 0 or not request["requestId"]:
        print(json.dumps({"ok": False, "error": "invalid_exit_terms"}))
        return 2

    app = TargetRestore()
    try:
        app.connect(CONNECTION.host, CONNECTION.port, clientId=CLIENT_ID)
        threading.Thread(target=app.run, daemon=True).start()
        if not app.ready.wait(8):
            print(json.dumps({"ok": False, "error": "tws_connection_timeout"}))
            return 1
        app.reqManagedAccts()
        app.reqOpenOrders()
        app.reqCompletedOrders(True)
        if not app.open_done.wait(8) or not app.completed_done.wait(8):
            print(json.dumps({"ok": False, "error": "broker_order_evidence_unavailable"}))
            return 1
        if len(app.accounts) != 1 or masked(app.accounts[0]) != request["account"]:
            print(json.dumps({"ok": False, "error": "paper_account_mismatch"}))
            return 1
        stop = app.open_orders.get(request["stopId"])
        cancelled_target = app.completed_orders.get(request["cancelledTargetId"])
        active_targets = [row for row in app.open_orders.values()
                          if row["contract"].symbol == request["symbol"]
                          and row["order"].action == "SELL" and row["order"].orderType == "LMT"
                          and row["status"] in ACTIVE]
        if active_targets:
            print(json.dumps({"ok": False, "error": "active_target_already_exists"}))
            return 1
        if not stop or not cancelled_target or not validate_pair(stop, cancelled_target, request):
            print(json.dumps({"ok": False, "error": "protected_pair_evidence_mismatch", "evidence": {
                "stopFound": bool(stop), "cancelledTargetFound": bool(cancelled_target),
                "stopStatus": stop["status"] if stop else None,
                "stopQuantity": float(stop["order"].totalQuantity) if stop else None,
                "stopOcaGroup": stop["order"].ocaGroup if stop else None,
                "stopOcaType": int(stop["order"].ocaType or 0) if stop else None,
                "targetStatus": cancelled_target["status"] if cancelled_target else None,
                "targetQuantity": float(cancelled_target["order"].totalQuantity) if cancelled_target else None,
                "targetLimitPrice": float(cancelled_target["order"].lmtPrice) if cancelled_target else None,
                "targetOcaGroup": cancelled_target["order"].ocaGroup if cancelled_target else None,
                "targetOcaType": int(cancelled_target["order"].ocaType or 0) if cancelled_target else None,
            }}))
            return 1

        target = Order()
        target.account = app.accounts[0]
        target.action = "SELL"
        target.orderType = "LMT"
        target.totalQuantity = request["quantity"]
        target.lmtPrice = float(request["limitPrice"])
        target.tif = "GTC"
        target.ocaGroup = stop["order"].ocaGroup
        target.ocaType = int(stop["order"].ocaType)
        target.orderRef = cancelled_target["order"].orderRef
        target.transmit = True
        target.eTradeOnly = False
        target.firmQuoteOnly = False

        app.expected_order_id = app.next_order_id
        app.expected_price = request["limitPrice"]
        app.placeOrder(app.expected_order_id, stop["contract"], target)
        app.ack.wait(12)
        acknowledged_price = Decimal(str(app.result.get("limitPrice"))) if app.result else None
        ok = (app.result is not None and not app.errors and app.result.get("status") in ACTIVE
              and acknowledged_price == request["limitPrice"]
              and app.result.get("ocaGroup") == stop["order"].ocaGroup
              and app.result.get("ocaType") == int(stop["order"].ocaType))
        print(json.dumps({
            "ok": ok,
            "environment": "paper",
            "account": request["account"],
            "symbol": request["symbol"],
            "requestId": request["requestId"],
            "result": app.result,
            "preservedStopId": request["stopId"],
            "replacedCancelledTargetId": request["cancelledTargetId"],
            "errors": app.errors,
        }))
        return 0 if ok else 1
    finally:
        if app.isConnected():
            app.disconnect()


if __name__ == "__main__":
    raise SystemExit(main())
