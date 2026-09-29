export function createQueueSerialExecutor() {
  let tail = Promise.resolve();
  return function serialize(operation) {
    const run = tail.then(operation, operation);
    tail = run.catch(() => undefined);
    return run;
  };
}

export function chooseActiveRecommendationVersions(proposals, now = Date.now()) {
  const activeBySymbol = new Map();
  const duplicates = [];
  const eligible = [...proposals]
    .filter((proposal) => proposal.status === "pending" && proposal.expiresAt > now)
    .sort((left, right) => left.createdAt - right.createdAt);
  for (const proposal of eligible) {
    if (!activeBySymbol.has(proposal.symbol)) activeBySymbol.set(proposal.symbol, proposal);
    else duplicates.push(proposal);
  }
  return { active: [...activeBySymbol.values()], duplicates };
}
