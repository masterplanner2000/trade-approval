"""Submit one verified full-position exit to an IBKR paper account."""
from __future__ import annotations

import json, re, sys, threading
from decimal import Decimal
from ibapi.client import EClient
from ibapi.contract import Contract
from ibapi.order import Order
from ibapi.wrapper import EWrapper

HOST, PAPER_PORT, CLIENT_ID = "127.0.0.1", 7497, 76
MAX_QUANTITY = 1000
EXIT_ADAPTER_RELEASE_READY = False
US_STOCK_SYMBOL = re.compile(r"^[A-Z][A-Z0-9.-]{0,9}$")

def valid_exit(symbol, action, quantity, limit_price):
    return (action == "SELL" and US_STOCK_SYMBOL.fullmatch(symbol) is not None
            and 1 <= quantity <= MAX_QUANTITY and Decimal(str(limit_price)) > 0)

class ExitSubmit(EWrapper, EClient):
    def __init__(self):
        EClient.__init__(self, self)
        self.ready, self.positions_done, self.orders_done, self.done = (threading.Event() for _ in range(4))
        self.next_order_id = None; self.accounts = []; self.positions = {}; self.open_orders = {}; self.result = None; self.errors = []
    def nextValidId(self, orderId): self.next_order_id = orderId; self.ready.set()
    def managedAccounts(self, accountsList): self.accounts = [x for x in accountsList.split(",") if x]
    def position(self, account, contract, position, avgCost): self.positions[contract.symbol] = float(position)
    def positionEnd(self): self.positions_done.set()
    def openOrder(self, orderId, contract, order, orderState): self.open_orders[orderId] = {"symbol": contract.symbol, "action": order.action, "status": orderState.status}
    def openOrderEnd(self): self.orders_done.set()
    def orderStatus(self, orderId, status, filled, remaining, avgFillPrice, permId, parentId, lastFillPrice, clientId, whyHeld, mktCapPrice):
        if orderId == self.next_order_id:
            self.result = {"orderId": orderId, "permanentId": permId or None, "status": status, "filled": float(filled), "remaining": float(remaining), "averageFillPrice": float(avgFillPrice)}; self.done.set()
    def error(self, reqId, *args):
        errorCode, errorString = (args[1], args[2]) if len(args) >= 4 else (args[0], args[1])
        if errorCode not in {2104,2106,2107,2108,2158,2176}: self.errors.append({"code": errorCode, "message": errorString})

def main():
    try:
        req = json.loads(sys.argv[1]); symbol = str(req["symbol"]).upper(); action = str(req["action"]).upper()
        quantity = int(req["quantity"]); limit_price = float(req["limitPrice"]); expected = str(req["account"]); ref = str(req["decisionId"])
        cancel_ids = [int(x) for x in req.get("cancelOrderIds", [])]
    except Exception:
        print(json.dumps({"ok":False,"error":"invalid_request"})); return 2
    if not valid_exit(symbol, action, quantity, limit_price):
        print(json.dumps({"ok":False,"error":"exit_blocked"})); return 2
    # Cancel-then-submit can strand a held position without its protective stop
    # if the replacement sale is rejected or the connection drops. This adapter
    # must fail closed until the replacement lifecycle is explicitly redesigned.
    if cancel_ids:
        print(json.dumps({"ok":False,"error":"unsafe_cancel_replace_not_supported"})); return 2
    # Defense in depth: direct invocation must not bypass the service release hold.
    # Enable only after the protected-order replacement lifecycle is verified.
    if not EXIT_ADAPTER_RELEASE_READY:
        print(json.dumps({"ok":False,"error":"protected_exit_lifecycle_not_ready"})); return 2
    app = ExitSubmit()
    try:
        app.connect(HOST, PAPER_PORT, clientId=CLIENT_ID); threading.Thread(target=app.run, daemon=True).start()
        if not app.ready.wait(8): print(json.dumps({"ok":False,"error":"tws_connection_timeout"})); return 1
        app.reqManagedAccts(); app.reqPositions(); app.reqOpenOrders(); app.positions_done.wait(8); app.orders_done.wait(8)
        if len(app.accounts) != 1 or not app.accounts[0].startswith("DU"):
            print(json.dumps({"ok":False,"error":"paper_account_required"})); return 1
        account = app.accounts[0]; masked = f"{account[:3]}…{account[-3:]}"
        if masked != expected or app.positions.get(symbol, 0) < quantity:
            print(json.dumps({"ok":False,"error":"account_or_position_mismatch"})); return 1
        for order_id in cancel_ids:
            observed = app.open_orders.get(order_id)
            if not observed or observed["symbol"] != symbol or observed["action"] != "SELL":
                print(json.dumps({"ok":False,"error":"protective_order_mismatch"})); return 1
        contract = Contract(); contract.symbol=symbol; contract.secType="STK"; contract.exchange="SMART"; contract.currency="USD"
        order = Order(); order.account=account; order.action="SELL"; order.orderType="LMT"; order.totalQuantity=Decimal(quantity)
        order.lmtPrice=limit_price; order.tif="DAY"; order.transmit=True; order.eTradeOnly=False; order.firmQuoteOnly=False
        order.orderRef=f"trade-approval-{ref[:12]}-exit"
        app.placeOrder(app.next_order_id, contract, order); app.done.wait(12)
        out={"ok":app.result is not None and not app.errors,"environment":"paper","account":masked,"symbol":symbol,"action":"SELL","quantity":quantity,"limitPrice":limit_price,"result":app.result,"cancelledOrderIds":cancel_ids,"errors":app.errors}
        print(json.dumps(out)); return 0 if out["ok"] else 1
    finally:
        if app.isConnected(): app.disconnect()

if __name__ == "__main__": raise SystemExit(main())
