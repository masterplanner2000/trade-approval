const finite = (value) => typeof value === "number" && Number.isFinite(value);
const round = (value) => Math.round(value * 100) / 100;
const percent = (value) => Math.round(value * 10000) / 100;

function sameLocalDay(timestamp, now) {
  if (!finite(timestamp)) return false;
  const left = new Date(timestamp);
  const right = new Date(now);
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

export function buildCurrentPerformance({ snapshot, ownership, trades = [], benchmarkQuote = null, now = Date.now() }) {
  const brokerBySymbol = new Map((snapshot?.positions ?? []).map((item) => [item.symbol, item]));
  const positions = (ownership?.items ?? [])
    .filter((item) => item.ownership === "strategy_owned" && Number(item.strategyOwnedQuantity ?? 0) > 0)
    .map((item) => {
      const broker = brokerBySymbol.get(item.symbol) ?? {};
      const quantity = Number(item.strategyOwnedQuantity);
      const cost = finite(item.strategyCost) ? item.strategyCost : quantity * Number(item.brokerAverageCost ?? 0);
      const marketValue = finite(broker.marketValue) ? broker.marketValue : null;
      const unrealizedPnl = finite(broker.unrealizedPnl)
        ? broker.unrealizedPnl
        : marketValue == null ? null : marketValue - cost;
      const dailyPnl = finite(broker.dailyPnl) ? broker.dailyPnl : null;
      return {
        symbol: item.symbol,
        quantity,
        averageEntryPrice: quantity > 0 ? round(cost / quantity) : null,
        marketValue: marketValue == null ? null : round(marketValue),
        unrealizedPnl: unrealizedPnl == null ? null : round(unrealizedPnl),
        entryReturnPercent: unrealizedPnl == null || cost <= 0 ? null : percent(unrealizedPnl / cost),
        dailyPnl: dailyPnl == null ? null : round(dailyPnl),
        dailyReturnPercent: dailyPnl == null || marketValue == null || marketValue - dailyPnl <= 0
          ? null : percent(dailyPnl / (marketValue - dailyPnl)),
      };
    })
    .sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));

  const completeDaily = positions.length > 0 && positions.every((item) => item.dailyPnl != null && item.marketValue != null);
  const completeUnrealized = positions.length > 0 && positions.every((item) => item.unrealizedPnl != null);
  const dailyPnl = completeDaily ? round(positions.reduce((sum, item) => sum + item.dailyPnl, 0)) : null;
  const priorValue = completeDaily
    ? positions.reduce((sum, item) => sum + item.marketValue - item.dailyPnl, 0)
    : null;
  const unrealizedPnl = completeUnrealized ? round(positions.reduce((sum, item) => sum + item.unrealizedPnl, 0)) : null;
  const closed = trades.filter((trade) => trade.status === "closed");
  const closedToday = closed.filter((trade) => sameLocalDay(trade.closedAt, now));
  const realizedTodayGross = closedToday.every((trade) => finite(trade.grossProfit))
    ? round(closedToday.reduce((sum, trade) => sum + trade.grossProfit, 0)) : null;
  const knownFees = round(closed.reduce((sum, trade) => sum
    + (finite(trade.entryFee) ? trade.entryFee : 0)
    + (finite(trade.exitFee) ? trade.exitFee : 0), 0));
  const feesComplete = closed.every((trade) => trade.feesComplete === true);
  const wins = closed.filter((trade) => finite(trade.grossProfit) && trade.grossProfit > 0).length;
  const qqqPosition = positions.find((position) => position.symbol === "QQQ");
  const benchmarkLast = benchmarkQuote?.last;
  const benchmarkClose = benchmarkQuote?.close;
  const quotedBenchmarkReturn = finite(benchmarkLast) && finite(benchmarkClose) && benchmarkClose > 0
    ? percent((benchmarkLast - benchmarkClose) / benchmarkClose) : null;
  const benchmarkReturn = quotedBenchmarkReturn ?? qqqPosition?.dailyReturnPercent ?? null;
  const benchmarkDataType = quotedBenchmarkReturn != null
    ? benchmarkQuote?.dataType ?? "broker_quote"
    : qqqPosition?.dailyReturnPercent != null ? "broker_position_pnl" : null;
  const strategyReturn = dailyPnl == null || priorValue == null || priorValue <= 0 ? null : percent(dailyPnl / priorValue);
  const executionSamples = trades.filter((trade) => finite(trade.entrySlippageBps) && finite(trade.entryValue));
  const executionNotional = executionSamples.reduce((sum, trade) => sum + trade.entryValue, 0);
  const slippageDollars = executionSamples.every((trade) => finite(trade.entrySlippageDollars))
    ? round(executionSamples.reduce((sum, trade) => sum + trade.entrySlippageDollars, 0)) : null;
  const weightedSlippageBps = executionNotional > 0
    ? round(executionSamples.reduce((sum, trade) => sum + trade.entrySlippageBps * trade.entryValue, 0) / executionNotional)
    : null;
  const fillTimeSamples = trades.filter((trade) => finite(trade.timeToFillMs));
  const averageTimeToFillMs = fillTimeSamples.length
    ? Math.round(fillTimeSamples.reduce((sum, trade) => sum + trade.timeToFillMs, 0) / fillTimeSamples.length)
    : null;

  return {
    asOf: snapshot?.capturedAt ?? null,
    source: "IBKR Paper reconciliation",
    status: positions.length === 0 ? "EMPTY" : completeDaily && completeUnrealized ? "COMPLETE" : "INCOMPLETE",
    limitations: [
      ...(!completeDaily ? ["Daily P&L is unavailable for one or more open positions."] : []),
      ...(!completeUnrealized ? ["Unrealized P&L is unavailable for one or more open positions."] : []),
      ...(!feesComplete ? ["Net profit is unavailable until all broker fees and commissions are imported."] : []),
      ...(benchmarkReturn == null ? ["QQQ comparison is unavailable until a benchmark quote is received."] : []),
    ],
    today: {
      totalPnl: dailyPnl == null || realizedTodayGross == null ? null : round(dailyPnl + realizedTodayGross),
      openPositionPnl: dailyPnl,
      realizedGrossPnl: realizedTodayGross,
      strategyReturnPercent: strategyReturn,
      qqqReturnPercent: benchmarkReturn,
      versusQqqPercentagePoints: strategyReturn == null || benchmarkReturn == null ? null : round(strategyReturn - benchmarkReturn),
      benchmarkDataType,
    },
    openPositions: { count: positions.length, unrealizedPnl, items: positions },
    closedTrades: {
      count: closed.length,
      winRatePercent: closed.length ? percent(wins / closed.length) : null,
      sampleSize: closed.length,
      feesComplete,
      knownFees,
      missingFeeTradeCount: closed.filter((trade) => trade.feesComplete !== true).length,
    },
    executionQuality: {
      sampleSize: executionSamples.length,
      notionalWeightedSlippageBps: weightedSlippageBps,
      totalSlippageDollars: slippageDollars,
      averageTimeToFillMs,
      fillTimeSampleSize: fillTimeSamples.length,
      interpretation: "Positive slippage means the fill was worse than the proposed buy price.",
    },
  };
}
