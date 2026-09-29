const cents = (value) => Math.round(Number(value) * 100) / 100;

export function effectivePortfolioLimits(strategy, policy) {
  const strategyCapital = Number(strategy?.capitalLimit ?? 0);
  const policyCapital = Number(policy?.sleeveValue ?? 0)
    * Number(policy?.maximumDeployedPercent ?? 0) / 100;
  const strategyPositions = Number(strategy?.maxOpenPositions ?? 0);
  const policyPositions = Number(policy?.maximumPositions ?? 0);
  return {
    capitalLimit: cents(Math.min(strategyCapital, policyCapital)),
    maxOpenPositions: Math.min(strategyPositions, policyPositions),
  };
}

export function portfolioBuyCapacity({
  deployed,
  openPositionCount,
  ownershipComplete,
  protectionComplete,
  limits,
}) {
  const capitalExceeded = deployed > limits.capitalLimit;
  const positionLimitReached = openPositionCount >= limits.maxOpenPositions;
  const positionLimitExceeded = openPositionCount > limits.maxOpenPositions;
  const blockers = [
    ...(!ownershipComplete ? ["ownership_incomplete"] : []),
    ...(!protectionComplete ? ["protection_incomplete"] : []),
    ...(capitalExceeded ? ["deployment_limit_exceeded"] : deployed >= limits.capitalLimit ? ["deployment_limit_reached"] : []),
    ...(positionLimitExceeded ? ["position_limit_exceeded"] : positionLimitReached ? ["position_limit_reached"] : []),
  ];
  const availableBeforePositionLimit = Math.max(0, cents(limits.capitalLimit - deployed));
  return {
    available: blockers.length === 0 ? availableBeforePositionLimit : 0,
    availableBeforePositionLimit,
    buyAllowed: blockers.length === 0,
    blockers,
    capitalExceeded,
    positionLimitReached,
    positionLimitExceeded,
    overAllocated: capitalExceeded || positionLimitExceeded,
  };
}
