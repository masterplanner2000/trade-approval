import { assessAutomaticExitQuote } from "./automatic_exit_quote.mjs";

const working = new Set(["PendingSubmit", "PreSubmitted", "Submitted", "PartiallyFilled"]);

// A preflight for repairing a legacy paper position. It intentionally does not
// choose a stop price or submit an order: those are separate strategy and
// broker-lifecycle decisions. Every call needs fresh broker evidence.
export function assessProtectionRepair({ snapshot, ownership, quoteSnapshot, symbol, stopPrice, maxLossDollars, now = Date.now() }) {
  const blocked = (reason) => ({ ok: false, reason, symbol });
  if (snapshot?.environment !== "paper" || snapshot?.readOnly !== true || snapshot?.complete !== true || snapshot?.ok !== true) {
    return blocked("paper_snapshot_unavailable");
  }
  if (!Number.isFinite(snapshot.capturedAt) || snapshot.capturedAt > now + 1_000 || now - snapshot.capturedAt > 5_000) {
    return blocked("broker_snapshot_stale");
  }
  if (!snapshot.account || ownership?.account !== snapshot.account || quoteSnapshot?.account !== snapshot.account
    || quoteSnapshot?.readOnly !== true) {
    return blocked("account_mismatch");
  }
  const held = (snapshot.positions ?? []).filter((item) => item.symbol === symbol && item.account === snapshot.account);
  const item = (ownership?.items ?? []).filter((entry) => entry.symbol === symbol);
  if (held.length !== 1 || item.length !== 1 || held[0].securityType !== "STK"
    || item[0].ownership !== "strategy_owned" || item[0].protection !== "missing"
    || !Number.isSafeInteger(held[0].quantity) || held[0].quantity <= 0
    || item[0].strategyOwnedQuantity !== held[0].quantity) return blocked("position_not_verified_for_repair");
  if ((snapshot.openOrders ?? []).some((order) => order.account === snapshot.account && order.symbol === symbol
    && order.action === "SELL" && working.has(order.status))) return blocked("working_sell_order_exists");
  if (quoteSnapshot?.quote?.symbol !== symbol) return blocked("quote_symbol_mismatch");
  const quote = assessAutomaticExitQuote(quoteSnapshot, { now });
  if (!quote.ok) return blocked(quote.reason);
  if (!Number.isFinite(stopPrice) || stopPrice <= 0 || stopPrice >= quote.bid) return blocked("invalid_stop_price");
  if (!Number.isFinite(maxLossDollars) || maxLossDollars <= 0) return blocked("missing_risk_budget");
  // This is only the quoted bid-to-stop distance; a stop order can fill below
  // its trigger after a gap or in a fast market. It is not a loss guarantee.
  const riskAtBid = Math.round((quote.bid - stopPrice) * held[0].quantity * 100) / 100;
  if (riskAtBid > maxLossDollars) return blocked("risk_budget_exceeded");
  return { ok: true, environment: "paper", account: snapshot.account, symbol,
    quantity: held[0].quantity, stopPrice, riskAtBid, quoteBid: quote.bid,
    brokerSnapshotAt: snapshot.capturedAt, quoteReceivedAt: quoteSnapshot.quote.bidReceivedAt };
}
