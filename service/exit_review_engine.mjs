const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

export function buildExitReviewCards({ holdings = [], thesisExits = [], openTrades = [], at = Date.now() } = {}) {
  const thesisBySymbol = new Map(thesisExits.map((item) => [item.symbol, item]));
  const tradeBySymbol = new Map(openTrades.filter((item) => item.status === "open").map((item) => [item.symbol, item]));
  return holdings.flatMap((holding) => {
    if (holding.ownership !== "strategy_owned") return [];
    const triggers = [];
    const thesis = thesisBySymbol.get(holding.symbol);
    if (thesis) triggers.push({
      id: "thesis_deterioration",
      label: thesis.reason,
      severity: "high",
    });
    const trade = tradeBySymbol.get(holding.symbol);
    if (trade?.openedAt && at - trade.openedAt >= THREE_DAYS_MS) triggers.push({
      id: "holding_horizon",
      label: "The position has reached the strategy's three-day review horizon",
      severity: "normal",
    });
    if (holding.recommendedForExit) triggers.push({
      id: "portfolio_policy",
      label: "A profitable exit may help return the portfolio to its allocation limits",
      severity: "normal",
    });
    if (!holding.protected) triggers.push({
      id: "protection_gap",
      label: "Broker protection is missing or could not be verified",
      severity: "high",
    });
    if (holding.protectiveStopBreached) triggers.unshift({
      id: "protective_stop_breached",
      label: "The current market price is at or below the recorded protective stop",
      severity: "high",
    });
    if (triggers.length === 0) return [];
    const directExitEligible = holding.protectiveStopBreached === true
      || (holding.recommendedForExit === true && holding.protected === false && holding.ordinaryRotationProfitEligible === true);
    const protectedExitEligible = holding.recommendedForExit === true
      && holding.protected === true
      && holding.exitPairVerified !== false
      && holding.ordinaryRotationProfitEligible === true;
    const approvalEligible = directExitEligible || protectedExitEligible;
    return [{
      id: `exit-review:${holding.symbol}`,
      symbol: holding.symbol,
      quantity: holding.quantity,
      estimatedValue: holding.estimatedValue,
      estimatedGrossPnl: holding.estimatedGrossPnl,
      recommendationScore: holding.recommendationScore,
      urgency: triggers.some((item) => item.severity === "high") ? "high" : "normal",
      triggers,
      reviewOnly: !approvalEligible,
      orderSubmissionAllowed: approvalEligible,
      exitMode: directExitEligible ? "direct_exit" : protectedExitEligible ? "replace_target" : null,
      approvalBlockedReason: approvalEligible ? null
        : !holding.recommendedForExit ? "No stronger replacement currently justifies this sale"
          : !holding.protected ? "Broker protection could not be verified"
            : holding.exitPairVerified === false ? "The exact broker target and stop pair could not be verified"
            : "The estimated sale would be below average cost",
      reviewedAt: at,
    }];
  }).sort((left, right) => Number(right.urgency === "high") - Number(left.urgency === "high")
    || (left.recommendationScore ?? -1) - (right.recommendationScore ?? -1));
}
