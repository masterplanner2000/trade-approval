/** Pure portfolio-aware position sizing. No broker, network, storage, or order side effects. */

export const SIZING_MODEL_VERSION = "portfolio-position-sizing-v1";

const requiredCandidateFields = ["symbol", "sector", "entryPrice", "stopPrice", "averageDollarVolume20"];
const requiredPortfolioFields = [
  "asOf",
  "sleeveValue",
  "settledCash",
  "availableFunds",
  "buyingPower",
  "currentExposure",
  "pendingBuyNotional",
  "currentOpenRisk",
  "dailyPnl",
  "openPositionCount",
  "symbolExposure",
  "sectorExposure",
  "correlatedExposure",
];
const requiredPolicyFields = [
  "riskPerTradePercent",
  "maxDailyLossPercent",
  "maxTotalOpenRiskPercent",
  "maxPositionPercent",
  "maxTotalExposurePercent",
  "maxSectorExposurePercent",
  "maxCorrelatedExposurePercent",
  "minimumCashReservePercent",
  "maxOpenPositions",
  "maxLiquidityParticipationPercent",
];

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function clampAtZero(value) {
  return Math.max(0, value);
}

function wholeShares(notional, entryPrice) {
  return Math.max(0, Math.floor(notional / entryPrice));
}

function incomplete(missing) {
  return {
    modelVersion: SIZING_MODEL_VERSION,
    status: "INCOMPLETE",
    classification: null,
    quantity: null,
    notional: null,
    estimatedLossAtStop: null,
    bindingConstraints: [],
    constraints: [],
    missing,
  };
}

export function calculatePortfolioPositionSize({ candidate = {}, portfolio = {}, policy = {}, rotation = null, now = Date.now(), maxSnapshotAgeMs = 30_000 } = {}) {
  const missing = [];
  for (const field of requiredCandidateFields) {
    if (field === "symbol" || field === "sector") {
      if (typeof candidate[field] !== "string" || candidate[field].trim() === "") missing.push(`candidate.${field}`);
    } else if (!finite(candidate[field])) missing.push(`candidate.${field}`);
  }
  for (const field of requiredPortfolioFields) {
    if (!finite(portfolio[field])) missing.push(`portfolio.${field}`);
  }
  for (const field of requiredPolicyFields) {
    if (!finite(policy[field])) missing.push(`policy.${field}`);
  }
  if (missing.length) return incomplete(missing);

  if (now - portfolio.asOf > maxSnapshotAgeMs || portfolio.asOf > now + 1_000) {
    return incomplete(["portfolio.freshSnapshot"]);
  }
  if (candidate.entryPrice <= 0 || candidate.stopPrice <= 0 || candidate.stopPrice >= candidate.entryPrice) {
    return incomplete(["candidate.validEntryAndStop"]);
  }
  if (portfolio.sleeveValue <= 0 || policy.maxOpenPositions < 1) {
    return incomplete(["portfolio.validSleevePolicy"]);
  }

  const percentageFields = requiredPolicyFields.filter((field) => field.endsWith("Percent"));
  if (percentageFields.some((field) => policy[field] < 0 || policy[field] > 1)) {
    return incomplete(["policy.percentagesBetweenZeroAndOne"]);
  }

  const entryPrice = candidate.entryPrice;
  const lossPerShare = entryPrice - candidate.stopPrice;
  const sleeveValue = portfolio.sleeveValue;
  const pending = clampAtZero(portfolio.pendingBuyNotional);
  const immediatelyAvailableCash = Math.min(portfolio.settledCash, portfolio.availableFunds, portfolio.buyingPower);
  const cashReserve = sleeveValue * policy.minimumCashReservePercent;
  const hasExistingPosition = portfolio.symbolExposure > 0;

  const remainingTradeRisk = sleeveValue * policy.riskPerTradePercent;
  const remainingDailyLoss = clampAtZero(sleeveValue * policy.maxDailyLossPercent - clampAtZero(-portfolio.dailyPnl));
  const remainingOpenRisk = clampAtZero(sleeveValue * policy.maxTotalOpenRiskPercent - portfolio.currentOpenRisk);

  const constraints = [
    { id: "trade_risk", label: "Per-trade loss limit", shares: Math.floor(remainingTradeRisk / lossPerShare) },
    { id: "daily_loss", label: "Remaining daily loss budget", shares: Math.floor(remainingDailyLoss / lossPerShare) },
    { id: "open_risk", label: "Remaining total open risk", shares: Math.floor(remainingOpenRisk / lossPerShare) },
    { id: "cash", label: "Settled cash after reserve and pending buys", shares: wholeShares(clampAtZero(immediatelyAvailableCash - cashReserve - pending), entryPrice) },
    { id: "position", label: "Maximum position exposure", shares: wholeShares(clampAtZero(sleeveValue * policy.maxPositionPercent - portfolio.symbolExposure), entryPrice) },
    { id: "total_exposure", label: "Maximum trading-sleeve exposure", shares: wholeShares(clampAtZero(sleeveValue * policy.maxTotalExposurePercent - portfolio.currentExposure - pending), entryPrice) },
    { id: "sector", label: "Maximum sector exposure", shares: wholeShares(clampAtZero(sleeveValue * policy.maxSectorExposurePercent - portfolio.sectorExposure - pending), entryPrice) },
    { id: "correlation", label: "Maximum correlated exposure", shares: wholeShares(clampAtZero(sleeveValue * policy.maxCorrelatedExposurePercent - portfolio.correlatedExposure - pending), entryPrice) },
    { id: "liquidity", label: "Maximum liquidity participation", shares: wholeShares(candidate.averageDollarVolume20 * policy.maxLiquidityParticipationPercent, entryPrice) },
    {
      id: "open_positions",
      label: "Maximum open positions",
      shares: hasExistingPosition || portfolio.openPositionCount < policy.maxOpenPositions ? Number.MAX_SAFE_INTEGER : 0,
    },
  ].map((constraint) => ({ ...constraint, shares: Math.max(0, constraint.shares) }));

  const quantity = Math.min(...constraints.map(({ shares }) => shares));
  const bindingConstraints = constraints.filter(({ shares }) => shares === quantity).map(({ id, label }) => ({ id, label }));
  const canRotate = quantity === 0
    && rotation?.eligible === true
    && typeof rotation.symbol === "string"
    && finite(rotation.estimatedNetProceeds)
    && rotation.estimatedNetProceeds >= entryPrice;
  const classification = quantity > 0
    ? "ACTIONABLE_WITH_CASH"
    : canRotate
      ? "POSSIBLE_ROTATION"
      : "QUALIFIED_CAPACITY_BLOCKED";

  return {
    modelVersion: SIZING_MODEL_VERSION,
    status: "COMPLETE",
    classification,
    quantity,
    notional: Math.round(quantity * entryPrice * 100) / 100,
    estimatedLossAtStop: Math.round(quantity * lossPerShare * 100) / 100,
    lossPerShare: Math.round(lossPerShare * 100) / 100,
    bindingConstraints,
    constraints: constraints.map((constraint) => ({
      ...constraint,
      shares: constraint.shares === Number.MAX_SAFE_INTEGER ? null : constraint.shares,
    })),
    portfolioAsOf: portfolio.asOf,
    rotation: canRotate ? {
      status: "REQUIRES_SEQUENTIAL_APPROVAL_AND_FILL",
      sellSymbol: rotation.symbol,
      estimatedNetProceeds: rotation.estimatedNetProceeds,
    } : null,
  };
}
