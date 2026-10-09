const cents = (value) => Math.round(Number(value) * 100) / 100;

export function effectivePortfolioLimits(strategy, policy = {}) {
  const strategyCapital = Number(strategy?.capitalLimit ?? 0);
  const strategyPositions = Number(strategy?.maxOpenPositions ?? 0);
  const configuredPositions = Number(policy?.maximumPositions ?? strategyPositions);
  const maximumPositionPercent = Number(policy?.maximumPositionPercent ?? 15);
  const maximumSectorPercent = Number(policy?.maximumSectorPercent ?? 35);
  const maximumThemePercent = Number(policy?.maximumCorrelatedPercent ?? maximumSectorPercent);
  return {
    capitalLimit: cents(strategyCapital),
    // The strategy remains the hard ceiling; Settings may make it more conservative.
    maxOpenPositions: Math.min(strategyPositions, configuredPositions),
    maximumPositionPercent,
    maximumSectorPercent,
    maximumThemePercent,
    maxPositionValue: cents(strategyCapital * maximumPositionPercent / 100),
    maxSectorValue: cents(strategyCapital * maximumSectorPercent / 100),
    maxThemeValue: cents(strategyCapital * maximumThemePercent / 100),
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
