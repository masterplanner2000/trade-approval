"""Collect an authoritative, read-only IBKR paper-account reconciliation snapshot."""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from decimal import Decimal, InvalidOperation

from ibapi.client import EClient
from ibapi.execution import ExecutionFilter
from ibapi.wrapper import EWrapper

from ibkr_connection import paper_connection


CONNECTION = paper_connection()
HOST = CONNECTION.host
PAPER_PORT = CONNECTION.port
CLIENT_ID = int(os.environ.get("IBKR_RECON_CLIENT_ID", "75"))
IGNORED_ERROR_CODES = {2104, 2106, 2107, 2108, 2158, 2176}


def number(value):
    try:
        parsed = Decimal(str(value))
        return float(parsed) if parsed.is_finite() and abs(parsed) < Decimal("1e100") else None
    except (InvalidOperation, ValueError, TypeError):
        return None


def mask_account(account: str) -> str:
    return f"{account[:3]}…{account[-3:]}" if len(account) >= 6 else "***"


class ReconciliationSnapshot(EWrapper, EClient):
    def __init__(self) -> None:
        EClient.__init__(self, self)
        self.ready = threading.Event()
        self.summary_done = threading.Event()
        self.positions_done = threading.Event()
        self.orders_done = threading.Event()
        self.completed_orders_done = threading.Event()
        self.executions_done = threading.Event()
        self.pnl_done = threading.Event()
        self.accounts: list[str] = []
        self.summary: dict[str, dict] = {}
        self.positions: list[dict] = []
        self.orders: dict[str, dict] = {}
        self.completed_orders: dict[str, dict] = {}
        self.executions: list[dict] = []
        self.commissions: dict[str, dict] = {}
        self.errors: list[dict] = []
        self.pnl_data: dict[str, float | None] = {}

    def nextValidId(self, orderId: int) -> None:  # noqa: N802
        self.ready.set()

    def managedAccounts(self, accountsList: str) -> None:  # noqa: N802
        self.accounts = [value for value in accountsList.split(",") if value]

    def accountSummary(self, reqId, account, tag, value, currency) -> None:  # noqa: N802
        self.summary[tag] = {"value": number(value), "currency": currency}

    def accountSummaryEnd(self, reqId: int) -> None:  # noqa: N802
        self.summary_done.set()

    def position(self, account, contract, position, avgCost) -> None:
        quantity = number(position)
        if quantity == 0:
            return
        self.positions.append({
            "account": mask_account(account),
            "contractId": contract.conId,
            "symbol": contract.symbol,
            "securityType": contract.secType,
            "currency": contract.currency,
            "quantity": quantity,
            "averageCost": number(avgCost),
        })

    def positionEnd(self) -> None:  # noqa: N802
        self.positions_done.set()

    def openOrder(self, orderId, contract, order, orderState) -> None:  # noqa: N802
        permanent_id = int(order.permId or 0)
        identity = str(permanent_id if permanent_id > 0 else orderId)
        self.orders[identity] = {
            "orderId": orderId,
            "permanentId": permanent_id or None,
            "parentId": int(order.parentId or 0) or None,
            "clientId": int(order.clientId or 0),
            "account": mask_account(order.account),
            "symbol": contract.symbol,
            "securityType": contract.secType,
            "action": order.action,
            "orderType": order.orderType,
            "quantity": number(order.totalQuantity),
            "limitPrice": number(order.lmtPrice),
            "stopPrice": number(order.auxPrice),
            "timeInForce": order.tif,
            "orderRef": order.orderRef or None,
            "status": orderState.status or "Unknown",
        }

    def openOrderEnd(self) -> None:  # noqa: N802
        self.orders_done.set()

    def completedOrder(self, contract, order, orderState) -> None:  # noqa: N802
        permanent_id = int(order.permId or 0)
        identity = str(permanent_id if permanent_id > 0 else order.orderId)
        self.completed_orders[identity] = {
            "orderId": int(order.orderId or 0),
            "permanentId": permanent_id or None,
            "parentId": int(order.parentId or 0) or None,
            "clientId": int(order.clientId or 0),
            "account": mask_account(order.account),
            "symbol": contract.symbol,
            "securityType": contract.secType,
            "action": order.action,
            "orderType": order.orderType,
            "quantity": number(order.totalQuantity),
            "orderRef": order.orderRef or None,
            "status": orderState.status or "Unknown",
        }

    def completedOrdersEnd(self) -> None:  # noqa: N802
        self.completed_orders_done.set()

    def execDetails(self, reqId, contract, execution) -> None:  # noqa: N802
        self.executions.append({
            "executionId": execution.execId,
            "orderId": execution.orderId,
            "permanentId": int(execution.permId or 0) or None,
            "clientId": execution.clientId,
            "account": mask_account(execution.acctNumber),
            "symbol": contract.symbol,
            "securityType": contract.secType,
            "side": execution.side,
            "quantity": number(execution.shares),
            "price": number(execution.price),
            "cumulativeQuantity": number(execution.cumQty),
            "averagePrice": number(execution.avgPrice),
            "time": execution.time,
            "orderRef": execution.orderRef or None,
        })

    def execDetailsEnd(self, reqId: int) -> None:  # noqa: N802
        self.executions_done.set()

    def commissionReport(self, report) -> None:  # noqa: N802
        commission = {
            "commission": number(report.commission),
            "commissionCurrency": report.currency or None,
            "realizedPnl": number(report.realizedPNL),
        }
        self.commissions[report.execId] = commission
        for execution in self.executions:
            if execution["executionId"] == report.execId:
                execution.update(commission)
                break

    def pnl(self, reqId, dailyPnL, unrealizedPnL, realizedPnL) -> None:
        self.pnl_data = {
            "dailyPnl": number(dailyPnL), "unrealizedPnl": number(unrealizedPnL),
            "realizedPnl": number(realizedPnL),
        }
        self.pnl_done.set()

    def error(self, reqId: int, *args) -> None:
        if len(args) >= 4:
            _, code, message, *_ = args
        else:
            code, message, *_ = args
        if code not in IGNORED_ERROR_CODES:
            self.errors.append({"code": code, "message": message})


def collect_snapshot(*, client_id: int = CLIENT_ID, timeout_seconds: float = 8) -> dict:
    """Collect one read-only snapshot without printing or granting order authority."""
    app = ReconciliationSnapshot()
    pnl_requested = False
    try:
        app.connect(HOST, PAPER_PORT, clientId=client_id)
        threading.Thread(target=app.run, daemon=True).start()
        if not app.ready.wait(timeout_seconds):
            return {"ok": False, "error": "tws_connection_timeout", "complete": False,
                    "environment": "paper", "readOnly": True}

        app.reqManagedAccts()
        for _ in range(20):
            if app.accounts:
                break
            time.sleep(0.1)
        account = app.accounts[0] if len(app.accounts) == 1 else None
        app.reqAccountSummary(
            9201,
            "All",
            "NetLiquidation,TotalCashValue,SettledCash,AvailableFunds,BuyingPower,"
            "GrossPositionValue,MaintMarginReq,UnrealizedPnL,RealizedPnL",
        )
        app.reqPositions()
        app.reqAllOpenOrders()
        app.reqCompletedOrders(False)
        app.reqExecutions(9202, ExecutionFilter())
        if account:
            app.reqPnL(9203, account, "")
            pnl_requested = True

        completed = {
            "accountSummary": app.summary_done.wait(timeout_seconds),
            "positions": app.positions_done.wait(timeout_seconds),
            "openOrders": app.orders_done.wait(timeout_seconds),
            "completedOrders": app.completed_orders_done.wait(timeout_seconds),
            "executions": app.executions_done.wait(timeout_seconds),
        }
        # Commission reports follow execution details and have no end callback.
        # Allow a short bounded window for them to attach to the executions.
        time.sleep(0.35)
        if account:
            app.pnl_done.wait(timeout_seconds)
        complete = all(completed.values()) and account is not None
        result = {
            "ok": complete,
            "environment": "paper",
            "readOnly": True,
            "account": mask_account(account) if account else None,
            "capturedAt": int(time.time() * 1000),
            "complete": complete,
            "completed": completed,
            "summary": app.summary,
            "positions": app.positions,
            "openOrders": list(app.orders.values()),
            "completedOrders": list(app.completed_orders.values()),
            "executions": app.executions,
            "pnl": app.pnl_data,
            "warnings": app.errors,
        }
        return result
    finally:
        if app.isConnected():
            if pnl_requested:
                app.cancelPnL(9203)
            app.cancelAccountSummary(9201)
            app.cancelPositions()
            app.disconnect()


def main() -> int:
    result = collect_snapshot()
    print(json.dumps(result))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
