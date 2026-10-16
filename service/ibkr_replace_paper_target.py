"""Replace an existing IBKR Paper profit target while preserving its sibling stop."""
from __future__ import annotations

import json, sys, threading
from decimal import Decimal
from ibapi.client import EClient
from ibapi.wrapper import EWrapper
from ibkr_connection import paper_connection

CONNECTION = paper_connection()
CLIENT_ID = 74  # The same client that creates this application's brackets.
ACTIVE = {"PendingSubmit", "PreSubmitted", "Submitted", "PartiallyFilled"}
IGNORED = {2104, 2106, 2107, 2108, 2158, 2176}


class TargetReplace(EWrapper, EClient):
    def __init__(self):
        EClient.__init__(self, self)
        self.ready = threading.Event(); self.orders_done = threading.Event(); self.ack = threading.Event()
        self.accounts = []; self.orders = {}; self.errors = []; self.result = None; self.expected_order_id = None
        self.expected_limit_price = None

    def nextValidId(self, orderId): self.ready.set()
    def managedAccounts(self, accountsList): self.accounts = [x for x in accountsList.split(",") if x]
    def openOrder(self, orderId, contract, order, orderState):
        record = {"orderId": orderId, "permanentId": int(order.permId or 0) or None,
                  "clientId": int(order.clientId or 0), "contract": contract, "order": order,
                  "status": orderState.status or "Unknown"}
        self.orders[orderId] = record
        observed_price = Decimal(str(order.lmtPrice))
        if orderId == self.expected_order_id and self.expected_limit_price is not None \
                and observed_price == self.expected_limit_price:
            self.result = {"orderId": orderId, "permanentId": record["permanentId"],
                           "status": record["status"], "limitPrice": float(order.lmtPrice)}
            self.ack.set()
    def openOrderEnd(self): self.orders_done.set()
    def orderStatus(self, orderId, status, filled, remaining, avgFillPrice, permId, parentId, lastFillPrice, clientId, whyHeld, mktCapPrice):
        if orderId == self.expected_order_id:
            current = self.result or {"orderId": orderId, "permanentId": int(permId or 0) or None}
            self.result = {**current, "status": status, "filled": float(filled), "remaining": float(remaining),
                           "averageFillPrice": float(avgFillPrice)}
            # IBKR commonly repeats the existing Submitted status before it
            # acknowledges modified terms. Only openOrder can prove that the
            # exact requested limit reached TWS. A terminal fill is handled by
            # the subsequent reconciliation snapshot, not guessed here.
    def error(self, reqId, *args):
        code, message = (args[1], args[2]) if len(args) >= 4 else (args[0], args[1])
        if code not in IGNORED:
            self.errors.append({"code": code, "message": message})
            if reqId == self.expected_order_id: self.ack.set()


def masked(account): return f"{account[:3]}…{account[-3:]}" if len(account) >= 6 else "***"


def main():
    try:
        req = json.loads(sys.argv[1]); expected_account = str(req["account"]); symbol = str(req["symbol"]).upper()
        target_id = str(req["targetId"]); stop_id = str(req["stopId"]); price = Decimal(str(req["limitPrice"]))
        request_id = str(req["requestId"])
    except Exception:
        print(json.dumps({"ok": False, "error": "invalid_request"})); return 2
    if not request_id or target_id == stop_id or price <= 0:
        print(json.dumps({"ok": False, "error": "invalid_exit_terms"})); return 2
    app = TargetReplace()
    try:
        app.connect(CONNECTION.host, CONNECTION.port, clientId=CLIENT_ID)
        threading.Thread(target=app.run, daemon=True).start()
        if not app.ready.wait(8): print(json.dumps({"ok": False, "error": "tws_connection_timeout"})); return 1
        app.reqManagedAccts(); app.reqOpenOrders()
        if not app.orders_done.wait(8) or len(app.accounts) != 1 or masked(app.accounts[0]) != expected_account:
            print(json.dumps({"ok": False, "error": "paper_account_or_orders_unavailable"})); return 1
        def identity(row): return str(row["permanentId"] or row["orderId"])
        targets = [row for row in app.orders.values() if identity(row) == target_id]
        stops = [row for row in app.orders.values() if identity(row) == stop_id]
        if len(targets) != 1 or len(stops) != 1:
            print(json.dumps({"ok": False, "error": "linked_order_evidence_missing"})); return 1
        target, stop = targets[0], stops[0]
        if target["clientId"] != CLIENT_ID or stop["clientId"] != CLIENT_ID:
            print(json.dumps({"ok": False, "error": "orders_owned_by_different_api_client"})); return 1
        if target["contract"].symbol != symbol or stop["contract"].symbol != symbol \
                or target["order"].action != "SELL" or target["order"].orderType != "LMT" \
                or stop["order"].action != "SELL" or stop["order"].orderType != "STP" \
                or target["status"] not in ACTIVE or stop["status"] not in ACTIVE \
                or Decimal(str(target["order"].totalQuantity)) != Decimal(str(stop["order"].totalQuantity)):
            print(json.dumps({"ok": False, "error": "protected_pair_mismatch"})); return 1
        replacement = target["order"]
        replacement.lmtPrice = float(price)
        replacement.orderRef = replacement.orderRef or f"trade-approval-{request_id[:12]}-exit"
        replacement.transmit = True; replacement.eTradeOnly = False; replacement.firmQuoteOnly = False
        app.expected_order_id = target["orderId"]
        app.expected_limit_price = price
        # Discard the pre-modification status captured while loading orders.
        # Success below requires a new openOrder callback with the exact price.
        app.result = None
        app.placeOrder(target["orderId"], target["contract"], replacement)
        app.ack.wait(12)
        acknowledged_price = Decimal(str(app.result.get("limitPrice"))) if app.result and app.result.get("limitPrice") is not None else None
        ok = app.result is not None and not app.errors and app.result.get("status") in ACTIVE \
            and acknowledged_price == price
        print(json.dumps({"ok": ok, "environment": "paper", "account": expected_account,
                          "symbol": symbol, "requestId": request_id, "result": app.result,
                          "preservedStopId": stop_id, "errors": app.errors}))
        return 0 if ok else 1
    finally:
        if app.isConnected(): app.disconnect()


if __name__ == "__main__": raise SystemExit(main())
