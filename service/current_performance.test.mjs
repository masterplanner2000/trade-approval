import assert from "node:assert/strict";
import test from "node:test";
import { buildCurrentPerformance } from "./current_performance.mjs";

test("builds broker-reconciled position and benchmark performance", () => {
  const now = new Date(2026, 8, 29, 12).getTime();
  const result = buildCurrentPerformance({
    now,
    snapshot: { capturedAt: now, positions: [
      { symbol: "AAA", marketValue: 1100, dailyPnl: 20, unrealizedPnl: 100 },
      { symbol: "EXT", marketValue: 900, dailyPnl: 50, unrealizedPnl: 50 },
    ] },
    ownership: { items: [
      { symbol: "AAA", ownership: "strategy_owned", strategyOwnedQuantity: 10, strategyCost: 1000 },
      { symbol: "EXT", ownership: "unknown", strategyOwnedQuantity: 0, strategyCost: 0 },
    ] },
    trades: [{ status: "closed", closedAt: now, grossProfit: 5, entryFee: 1, exitFee: 1, feesComplete: true }],
    benchmarkQuote: { last: 510, close: 500, dataType: 3 },
  });
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.today.totalPnl, 25);
  assert.equal(result.today.realizedGrossPnl, 5);
  assert.equal(result.today.qqqReturnPercent, 2);
  assert.equal(result.openPositions.unrealizedPnl, 100);
  assert.equal(result.closedTrades.winRatePercent, 100);
  assert.equal(result.closedTrades.knownFees, 2);
  assert.deepEqual(result.openPositions.items.map((item) => item.symbol), ["AAA"]);
});

test("does not invent missing pnl or net results", () => {
  const result = buildCurrentPerformance({
    snapshot: { capturedAt: 1, positions: [{ symbol: "AAA" }] },
    ownership: { items: [{ symbol: "AAA", ownership: "strategy_owned", strategyOwnedQuantity: 1, strategyCost: 100 }] },
    trades: [{ status: "closed", closedAt: 1, grossProfit: -10, entryFee: null, exitFee: null, feesComplete: false }],
  });
  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.today.totalPnl, null);
  assert.equal(result.openPositions.unrealizedPnl, null);
  assert.equal(result.closedTrades.winRatePercent, 0);
  assert.equal(result.closedTrades.feesComplete, false);
  assert.ok(result.limitations.some((item) => item.includes("fees")));
});
