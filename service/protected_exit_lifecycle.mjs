import { assessProtectedExitEvidence } from "./protected_exit_evidence.mjs";

export const PROTECTED_EXIT_LIFECYCLE_VERSION = "paper-protected-exit-sim-v1";
const working = new Set(["PendingSubmit", "PreSubmitted", "Submitted", "PartiallyFilled"]);

const sameTerms = (state, terms) => state && state.version === PROTECTED_EXIT_LIFECYCLE_VERSION
  && ["requestId", "account", "symbol", "targetId", "stopId", "requestedLimitPrice"]
    .every((key) => state[key] === terms[key]);

// Pure, simulator-only transition. Its replace_target command is a description
// of intent, NOT an IBKR API call. Persist the returned state before acting on
// any command. After a restart, an unresolved intent is never retransmitted.
export function advanceProtectedExitLifecycle(previous, { snapshot, requestId, account, symbol, targetId, stopId, requestedLimitPrice, now = Date.now() } = {}) {
  const terms = { requestId, account, symbol, targetId, stopId, requestedLimitPrice };
  const output = (phase, reason, commands = []) => ({
    state: { version: PROTECTED_EXIT_LIFECYCLE_VERSION, ...terms, phase, reason }, commands,
  });
  if (!requestId || typeof requestId !== "string" || !account || !symbol || !targetId || !stopId
    || targetId === stopId || !Number.isFinite(requestedLimitPrice) || requestedLimitPrice <= 0) {
    return output("blocked", "invalid_exit_terms");
  }
  if (previous && !sameTerms(previous, terms)) return { state: previous, commands: [] };
  const assessed = assessProtectedExitEvidence(snapshot, { account, symbol, targetId, stopId, requestedLimitPrice, now });
  if (assessed.state === "unknown") return output("unknown", assessed.reason);

  // An unrelated working sell could oversell the same shares. Do not treat the
  // linked stop/target pair in isolation when there are other broker orders.
  const extraSell = (snapshot.openOrders ?? []).some((order) => order.account === account
    && order.symbol === symbol && order.action === "SELL" && working.has(order.status)
    && ![String(targetId), String(stopId)].includes(String(order.permanentId ?? order.orderId ?? "")));
  if (extraSell) return output("blocked", "other_working_sell_order");

  const rejected = (snapshot.replacementResults ?? []).some((item) => item.requestId === requestId
    && String(item.targetId) === String(targetId) && item.status === "Rejected");
  if (rejected && assessed.state !== "closed") return output("blocked", "replacement_rejected");
  if (assessed.state === "closed") return output("closed", null);
  if (assessed.state === "blocked") return output("blocked", assessed.reason);
  if (assessed.state === "replacement_working") return output("working", null);
  if (previous?.phase === "blocked") return output("blocked", previous.reason ?? "requires_manual_review");
  if (previous?.phase === "transmission_unknown" || previous?.phase === "unknown") {
    return output("unknown", "transport_outcome_unconfirmed");
  }
  if (previous?.phase === "working") return output("unknown", "replacement_no_longer_verified");
  if (previous) return output("awaiting_ack", "replacement_not_acknowledged");

  return output("awaiting_ack", "replacement_not_acknowledged", [{
    kind: "replace_target", requestId, account, symbol, targetId, limitPrice: requestedLimitPrice,
  }]);
}
