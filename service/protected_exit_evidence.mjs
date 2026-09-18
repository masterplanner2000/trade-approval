const active = new Set(["PreSubmitted", "Submitted", "PartiallyFilled"]);
const terminal = new Set(["Filled", "Cancelled", "ApiCancelled", "Rejected", "Inactive"]);
const identity = (order) => String(order.permanentId ?? order.orderId ?? "");

// Classify broker evidence after an ordinary exit is requested. This does not
// modify an IBKR order. In particular, a requested target change is not proof
// that the broker accepted it or that the remaining shares are protected.
export function assessProtectedExitEvidence(snapshot, { account, symbol, targetId, stopId, requestedLimitPrice, now = Date.now() } = {}) {
  const result = (state, reason = null) => ({ state, reason, symbol });
  if (!snapshot?.ok || !snapshot.complete || snapshot.environment !== "paper" || snapshot.account !== account) {
    return result("unknown", "broker_evidence_unavailable");
  }
  if (!Number.isFinite(snapshot.capturedAt) || snapshot.capturedAt > now + 1_000 || now - snapshot.capturedAt > 5_000) {
    return result("unknown", "broker_evidence_stale");
  }
  const position = (snapshot.positions ?? []).filter((item) => item.symbol === symbol && item.account === account);
  if (position.length > 1) return result("blocked", "ambiguous_position");
  const held = Number(position[0]?.quantity ?? 0);
  if (!Number.isSafeInteger(held) || held < 0) return result("blocked", "invalid_position_quantity");
  const orders = [...(snapshot.openOrders ?? []), ...(snapshot.completedOrders ?? [])];
  const target = orders.find((order) => identity(order) === String(targetId));
  const stop = orders.find((order) => identity(order) === String(stopId));
  if (!target || !stop || target.account !== account || stop.account !== account
    || target.symbol !== symbol || stop.symbol !== symbol || target.action !== "SELL" || stop.action !== "SELL"
    || target.orderType !== "LMT" || stop.orderType !== "STP") return result("unknown", "linked_order_evidence_missing");
  if (held === 0) {
    if (active.has(target.status) || active.has(stop.status)) return result("blocked", "orphan_sell_order");
    const winner = target.status === "Filled" && terminal.has(stop.status) && stop.status !== "Filled" ? target
      : stop.status === "Filled" && terminal.has(target.status) && target.status !== "Filled" ? stop : null;
    const executed = winner && (snapshot.executions ?? []).some((execution) => identity(execution) === identity(winner)
      && execution.symbol === symbol && execution.side === "SLD" && Number(execution.cumulativeQuantity ?? execution.quantity) > 0);
    return executed ? result("closed") : result("unknown", "closure_not_confirmed");
  }
  if (!active.has(stop.status)) return result("blocked", "protective_stop_not_active");
  if (Number(stop.quantity) !== held) return result("blocked", "stop_quantity_mismatch");
  if (!Number.isFinite(requestedLimitPrice) || requestedLimitPrice <= 0) return result("blocked", "invalid_replacement_price");
  if (target.status === "Rejected" || target.status === "Inactive") return result("blocked", "replacement_rejected");
  if (!active.has(target.status)) return result("blocked", "target_not_active");
  if (Number(target.quantity) !== held) return result("blocked", "target_quantity_mismatch");
  if (Number(target.limitPrice) !== requestedLimitPrice) return result("protected", "replacement_not_acknowledged");
  return result("replacement_working");
}
