const activeOrder = (order) => ["Submitted", "PreSubmitted"].includes(order.status);
const orderIdentity = (order) => String(order.permanentId ?? order.orderId ?? "");
const round = (value) => Math.round(value * 100) / 100;

// Broker positions are fungible. A ticker or quantity match alone is not
// provenance; exact current-ledger fills or a complete same-account broker
// trade report with app order references can establish application origin.
export function reconcilePositionOwnership(snapshot, ledger, { historicalSymbols = [], externalSymbols = [], historicalEvidence = new Map(), flexEvidence = new Map() } = {}) {
  const account = snapshot.account;
  const ledgerPositions = ledger.listPositions().filter((item) => item.environment === "paper" && item.accountId === account);
  const bySymbol = new Map();
  for (const position of ledgerPositions) {
    const positions = bySymbol.get(position.symbol) ?? [];
    positions.push(position);
    bySymbol.set(position.symbol, positions);
  }
  const history = new Set(historicalSymbols);
  const external = new Set(externalSymbols);
  const brokerSymbols = new Set((snapshot.positions ?? []).map((item) => item.symbol));
  const items = (snapshot.positions ?? []).map((brokerPosition) => {
    const symbol = brokerPosition.symbol;
    const brokerQuantity = Number(brokerPosition.quantity ?? 0);
    const matched = bySymbol.get(symbol) ?? [];
    const recordedQuantity = matched.reduce((sum, item) => sum + item.quantity, 0);
    const evidence = historicalEvidence.get(symbol);
    const brokerHistory = evidence?.environment === "paper" && evidence.account === account
      ? { ...evidence, status: Math.abs(evidence.netQuantity - brokerQuantity) < 1e-8 ? "matched" : "mismatch" }
      : null;
    const flex = flexEvidence.get(symbol);
    const flexHistory = flex?.environment === "paper" && flex.account === account
      ? { ...flex, status: Math.abs(flex.netQuantity - brokerQuantity) < 1e-8 ? "matched" : "mismatch" }
      : null;
    const exact = brokerQuantity > 0 && matched.length > 0 && !external.has(symbol)
      && brokerHistory?.status !== "mismatch"
      && flexHistory?.status !== "mismatch"
      && Math.abs(brokerQuantity - recordedQuantity) < 1e-8;
    // A complete broker trade report can bridge a pre-ledger app version, but
    // only when every observed execution has an app order reference, all net
    // shares agree with today's broker position, and no later external activity
    // contradicts it. This never verifies a protective order by itself.
    const legacy = brokerQuantity > 0 && matched.length === 0 && !external.has(symbol)
      && flexHistory?.status === "matched" && brokerHistory?.status !== "mismatch"
      && Number.isFinite(Number(brokerPosition.averageCost)) && Number(brokerPosition.averageCost) > 0;
    const owned = exact || legacy;
    const ownership = owned ? "strategy_owned" : matched.length || history.has(symbol) || flexHistory ? "conflict" : "unknown";
    const matchingStops = new Map();
    if (exact) {
      const knownStops = new Set(matched.flatMap((item) => ledger.listBrokerOrders(item.id))
        .filter((order) => order.role === "protective_stop")
        .map((order) => String(order.brokerOrderId)));
      for (const order of snapshot.openOrders ?? []) {
        const identity = orderIdentity(order);
        if (order.account !== account || order.symbol !== symbol || order.action !== "SELL"
          || order.orderType !== "STP" || !activeOrder(order) || !knownStops.has(identity)) continue;
        matchingStops.set(identity, order);
      }
    }
    const protectedQuantity = [...matchingStops.values()].reduce((sum, order) => sum + Number(order.quantity ?? 0), 0);
    const unlinkedStop = (snapshot.openOrders ?? []).some((order) => order.account === account && order.symbol === symbol
      && order.action === "SELL" && order.orderType === "STP" && activeOrder(order));
    const protection = legacy ? unlinkedStop ? "unverified" : "missing"
      : !exact ? "unverified"
      : Math.abs(protectedQuantity - brokerQuantity) < 1e-8 ? "verified"
        : protectedQuantity > brokerQuantity ? "overcovered"
          : protectedQuantity > 0 ? "partial" : "missing";
    return {
      symbol, account, brokerQuantity, recordedQuantity,
      brokerHistory, flexHistory,
      strategyOwnedQuantity: owned ? brokerQuantity : 0,
      unknownQuantity: owned ? 0 : brokerQuantity,
      ownership, ownershipSource: legacy ? "broker_flex_legacy" : exact ? "ledger_fills" : null,
      protection, protectedQuantity,
      protectiveStopPrice: protection === "verified" && matchingStops.size === 1
        ? Number([...matchingStops.values()][0].stopPrice ?? 0) || null : null,
      strategyCost: exact ? round(matched.reduce((sum, item) => sum + item.quantity * item.averageEntryPrice, 0))
        : legacy ? round(brokerQuantity * Number(brokerPosition.averageCost)) : 0,
      brokerAverageCost: Number(brokerPosition.averageCost ?? 0),
      reasons: [
        ...(brokerHistory ? [brokerHistory.status === "matched"
          ? flexHistory?.status === "matched"
            ? `IBKR transaction history nets to ${brokerHistory.netQuantity} shares; the detailed trade report supplies app attribution`
            : `IBKR transaction history nets to ${brokerHistory.netQuantity} shares; submitting app is not identified`
          : `IBKR transaction history nets to ${brokerHistory.netQuantity} shares, different from the current broker position`] : []),
        ...(flexHistory ? [flexHistory.status === "matched"
          ? `IBKR's one-year trade report links ${flexHistory.netQuantity} net shares to app-referenced API orders`
          : `IBKR's app-referenced trade report nets to ${flexHistory.netQuantity} shares, different from the current holding`] : []),
        ...(legacy ? ["Legacy app trades are broker-attributed, but their original decisions are not in the current ledger"] : []),
        ...(legacy && flexHistory.legacySingleOrderCount > 0
          && Math.abs(flexHistory.legacySingleOrderNetQuantity - brokerQuantity) < 1e-8
          && Math.abs(flexHistory.bracketNetQuantity) < 1e-8
          ? [flexHistory.bracketOrderCount > 0
            ? "The remaining net shares match the app's earlier single-order buys; later bracket trades net to zero"
            : "The remaining net shares match the app's earlier single-order buys, which had no bracket exits"] : []),
        ...(exact ? ["Current broker quantity matches recorded strategy fills; no external activity is observed"]
          : legacy ? []
          : external.has(symbol) ? ["External broker activity exists for this symbol; share ownership cannot be proven"]
            : matched.length ? ["Broker quantity does not match recorded strategy fills"]
            : history.has(symbol) ? ["Previously traded by strategy, but current shares have no matched open fill"]
              : ["No application-owned entry is recorded for these shares"]),
        ...(legacy ? [unlinkedStop ? "An active stop exists but is not linked to a recorded app decision" : "No active protective stop is visible for this legacy holding"]
          : exact ? [protection === "verified" ? "Linked protective stop exactly covers the position at IBKR"
          : protection === "overcovered" ? "Linked stop exceeds the remaining position; broker order review required"
            : "Linked protective stop is missing or covers only part of the position"] : []),
      ],
    };
  });
  const missingBrokerPositions = [...bySymbol.entries()].filter(([symbol]) => !brokerSymbols.has(symbol))
    .map(([symbol, positions]) => ({ symbol, recordedQuantity: positions.reduce((sum, item) => sum + item.quantity, 0) }));
  const ownershipComplete = items.every((item) => item.ownership !== "conflict") && missingBrokerPositions.length === 0;
  const protectionComplete = items.every((item) => item.ownership !== "strategy_owned" || item.protection === "verified");
  return { account, asOf: snapshot.capturedAt ?? null, ownershipComplete, protectionComplete, items, missingBrokerPositions };
}
