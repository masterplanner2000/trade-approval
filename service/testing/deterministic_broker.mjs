/**
 * Credential-free broker authority used only by automated tests.
 * It models asynchronous evidence; it never imports an IBKR adapter or opens a socket.
 */
export class DeterministicBroker {
  constructor({ account = "SIM-PAPER", cash = 100_000, now = 10_000 } = {}) {
    this.account = account;
    this.cash = cash;
    this.now = now;
    this.connected = true;
    this.nextOrderId = 1_000;
    this.nextExecutionId = 1;
    this.orders = new Map();
    this.executions = [];
    this.replacementRequests = new Map();
    this.replacementResults = [];
    this.positions = new Map();
    this.scheduled = [];
  }

  advance(milliseconds = 1) {
    this.now += milliseconds;
    const due = this.scheduled.filter((item) => item.at <= this.now);
    this.scheduled = this.scheduled.filter((item) => item.at > this.now);
    for (const item of due.sort((a, b) => a.at - b.at)) item.operation();
    return this.snapshot();
  }

  later(milliseconds, operation) {
    this.scheduled.push({ at: this.now + milliseconds, operation });
  }

  disconnect() { this.connected = false; }
  reconnect() { this.connected = true; }

  submitBracket({ symbol, quantity, limitPrice, stopPrice, targetPrice, decisionId }) {
    if (!this.connected) throw new Error("simulated_broker_disconnected");
    if (!(quantity > 0) || !(limitPrice > 0)) throw new Error("simulated_invalid_order");
    const entryId = this.nextOrderId++;
    const targetId = this.nextOrderId++;
    const stopId = this.nextOrderId++;
    const prefix = String(decisionId).slice(0, 12);
    const common = { account: this.account, symbol, quantity, filled: 0, remaining: quantity, status: "PendingSubmit" };
    this.orders.set(entryId, { ...common, orderId: entryId, permanentId: entryId + 50_000, role: "entry", action: "BUY", orderType: "LMT", limitPrice, orderRef: `trade-approval-${prefix}-entry`, parentId: null });
    this.orders.set(targetId, { ...common, orderId: targetId, permanentId: targetId + 50_000, role: "target", action: "SELL", orderType: "LMT", limitPrice: targetPrice, orderRef: `trade-approval-${prefix}-target`, parentId: entryId, held: true });
    this.orders.set(stopId, { ...common, orderId: stopId, permanentId: stopId + 50_000, role: "stop", action: "SELL", orderType: "STP", stopPrice, orderRef: `trade-approval-${prefix}-stop`, parentId: entryId, held: true });
    return { entryId, targetId, stopId };
  }

  accept(orderId) {
    const order = this.#order(orderId);
    if (!["PendingSubmit", "PreSubmitted"].includes(order.status)) throw new Error("simulated_invalid_transition");
    order.status = "Submitted";
  }

  reject(orderId, reason = "simulated_rejection") {
    const order = this.#order(orderId);
    if (order.filled > 0) throw new Error("simulated_cannot_reject_filled_order");
    order.status = "Rejected";
    order.reason = reason;
    this.#cancelChildren(orderId, "ParentRejected");
  }

  cancel(orderId, reason = "simulated_cancellation") {
    const order = this.#order(orderId);
    if (order.status === "Filled") throw new Error("simulated_cannot_cancel_filled_order");
    order.status = "Cancelled";
    order.reason = reason;
    if (order.role === "entry") this.#cancelChildren(orderId, "ParentCancelled");
  }

  requestTargetReplacement({ orderId, limitPrice, requestId }) {
    if (!this.connected) throw new Error("simulated_broker_disconnected");
    const order = this.#order(orderId);
    if (order.role !== "target" || !["Submitted", "PreSubmitted", "PartiallyFilled"].includes(order.status)
      || !(limitPrice > 0) || !requestId) throw new Error("simulated_invalid_replacement");
    const prior = this.replacementRequests.get(requestId);
    if (prior) {
      if (prior.orderId !== orderId || prior.limitPrice !== limitPrice) throw new Error("simulated_idempotency_conflict");
      return;
    }
    if ([...this.replacementRequests.values()].some((item) => item.orderId === orderId && item.status === "Pending")) {
      throw new Error("simulated_replacement_pending");
    }
    this.replacementRequests.set(requestId, { requestId, orderId, limitPrice, status: "Pending" });
  }

  resolveTargetReplacement(requestId, status) {
    if (!this.connected) throw new Error("simulated_broker_disconnected");
    const request = this.replacementRequests.get(requestId);
    if (!request || request.status !== "Pending" || !["Accepted", "Rejected"].includes(status)) {
      throw new Error("simulated_invalid_replacement_resolution");
    }
    const order = this.#order(request.orderId);
    if (status === "Accepted" && !["Submitted", "PreSubmitted", "PartiallyFilled"].includes(order.status)) {
      throw new Error("simulated_target_no_longer_active");
    }
    request.status = status;
    if (status === "Accepted") order.limitPrice = request.limitPrice;
    this.replacementResults.push({ requestId, targetId: order.permanentId, status, limitPrice: request.limitPrice });
  }

  fill(orderId, quantity, price, { commission = 0, executionId } = {}) {
    if (!this.connected) throw new Error("simulated_broker_disconnected");
    const order = this.#order(orderId);
    if (["Cancelled", "Rejected", "Filled"].includes(order.status)) throw new Error("simulated_order_not_fillable");
    if (!(quantity > 0) || quantity > order.remaining || !(price > 0)) throw new Error("simulated_invalid_fill");
    order.filled += quantity;
    order.remaining -= quantity;
    order.averageFillPrice = price;
    order.status = order.remaining === 0 ? "Filled" : "PartiallyFilled";
    const signedQuantity = order.action === "BUY" ? quantity : -quantity;
    const previous = this.positions.get(order.symbol) ?? { quantity: 0, averageCost: 0 };
    const nextQuantity = previous.quantity + signedQuantity;
    const nextAverageCost = signedQuantity > 0
      ? ((previous.quantity * previous.averageCost) + (quantity * price)) / nextQuantity
      : previous.averageCost;
    if (nextQuantity === 0) this.positions.delete(order.symbol);
    else this.positions.set(order.symbol, { quantity: nextQuantity, averageCost: nextAverageCost });
    this.cash += order.action === "BUY" ? -(quantity * price + commission) : (quantity * price - commission);
    const execution = {
      executionId: executionId ?? `sim-exec-${this.nextExecutionId++}`,
      account: this.account,
      orderId: order.orderId,
      permanentId: order.permanentId,
      parentId: order.parentId,
      symbol: order.symbol,
      side: order.action === "BUY" ? "BOT" : "SLD",
      quantity,
      cumulativeQuantity: order.filled,
      averagePrice: price,
      commission,
      orderRef: order.orderRef,
    };
    this.executions.push(execution);
    if (order.role === "entry") {
      for (const child of this.orders.values()) {
        if (child.parentId === orderId) {
          child.held = false;
          child.quantity = order.filled;
          child.remaining = Math.max(0, order.filled - child.filled);
          child.status = "Submitted";
        }
      }
    } else if (order.status === "Filled" && order.parentId != null) {
      for (const sibling of this.orders.values()) {
        if (sibling.parentId === order.parentId && sibling.orderId !== order.orderId && sibling.status !== "Filled") {
          sibling.status = "Cancelled";
          sibling.reason = "SiblingFilled";
        }
      }
    }
    return execution;
  }

  repeatExecution(executionId) {
    const execution = this.executions.find((item) => item.executionId === executionId);
    if (!execution) throw new Error("simulated_execution_not_found");
    this.executions.push({ ...execution });
  }

  addExternalOrder({ symbol, action = "BUY", quantity = 1, status = "Submitted" }) {
    const orderId = this.nextOrderId++;
    this.orders.set(orderId, {
      account: this.account, orderId, permanentId: orderId + 50_000, symbol, action, quantity, filled: 0,
      remaining: quantity, status, role: "external", orderRef: null, parentId: null,
    });
    return orderId;
  }

  removeOrder(orderId) { this.orders.delete(orderId); }

  snapshot() {
    const grossPositionValue = [...this.positions.values()].reduce((total, position) => total + position.quantity * position.averageCost, 0);
    const summary = Object.fromEntries([
      ["NetLiquidation", this.cash + grossPositionValue], ["TotalCashValue", this.cash],
      ["SettledCash", this.cash], ["AvailableFunds", this.cash], ["BuyingPower", this.cash],
      ["GrossPositionValue", grossPositionValue], ["MaintMarginReq", 0],
      ["UnrealizedPnL", 0], ["RealizedPnL", 0],
    ].map(([key, value]) => [key, { value, currency: "USD" }]));
    return {
      ok: this.connected,
      complete: this.connected,
      environment: "paper",
      readOnly: true,
      account: this.account,
      capturedAt: this.now,
      summary,
      positions: [...this.positions].map(([symbol, value]) => ({ account: this.account, symbol, ...value })),
      openOrders: [...this.orders.values()].filter((order) => !["Filled", "Cancelled", "Rejected"].includes(order.status)).map((order) => ({ ...order })),
      completedOrders: [...this.orders.values()].filter((order) => ["Filled", "Cancelled", "Rejected"].includes(order.status)).map((order) => ({ ...order })),
      executions: this.executions.map((execution) => ({ ...execution })),
      replacementResults: this.replacementResults.map((item) => ({ ...item })),
      warnings: this.connected ? [] : [{ code: "simulated_disconnect" }],
    };
  }

  #order(orderId) {
    const order = this.orders.get(orderId);
    if (!order) throw new Error("simulated_order_not_found");
    return order;
  }

  #cancelChildren(parentId, reason) {
    for (const child of this.orders.values()) {
      if (child.parentId === parentId && child.status !== "Filled") {
        child.status = "Cancelled";
        child.reason = reason;
      }
    }
  }
}
