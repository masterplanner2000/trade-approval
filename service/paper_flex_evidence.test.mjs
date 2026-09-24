import test from "node:test";
import assert from "node:assert/strict";
import { TradingLedger } from "./trading_ledger.mjs";
import { applyPaperFlexCommissions, importPaperFlexReport, summarizePaperFlexEvidence } from "./paper_flex_evidence.mjs";

const csv = [
  "ClientAccountID,Symbol,TradeDate,Buy/Sell,Quantity,TradePrice,IBCommission,IBCommissionCurrency,IBOrderID,IBExecID,OrderReference,IsAPIOrder,LevelOfDetail",
  "DUR973217,NVDA,20260824,BUY,5,200,-1.00,USD,123,e1,trade-approval-abc12345-entry,Y,EXECUTION",
  "DUR973217,NVDA,20260901,SELL,-2,220,-1.25,USD,456,e2,trade-approval-def12345-stop,Y,EXECUTION",
].join("\n");

test("a 365-day Paper Flex report proves net app-referenced shares", () => {
  const record = importPaperFlexReport(csv, { observedOn: "2026-09-18", reportWindowDays: 365 });
  const summary = summarizePaperFlexEvidence(record).get("NVDA");
  assert.equal(summary.netQuantity, 3);
  assert.equal(summary.orderCount, 2);
  assert.equal(summary.legacySingleOrderCount, 0);
  assert.equal(summary.legacySingleOrderNetQuantity, 0);
  assert.equal(summary.bracketOrderCount, 2);
  assert.equal(summary.bracketNetQuantity, 3);
  assert.equal(summary.orderAttribution, "verified_application_reference");
  assert.equal(summary.account, "DUR…217");
  assert.deepEqual(record.executions.map((item) => item.commission), [1, 1.25]);
});

test("verified Flex commissions enrich exact ledger executions idempotently", () => {
  const record = importPaperFlexReport(csv, { observedOn: "2026-09-18", reportWindowDays: 365 });
  const ledger = new TradingLedger(":memory:");
  ledger.recordProposal({ id: "p1", createdAt: 1, environment: "paper", broker: "IBKR",
    accountId: "DUR…217", symbol: "NVDA", side: "buy", terms: { quantity: 5 } });
  ledger.recordBrokerOrder({ proposalId: "p1", broker: "IBKR", accountId: "DUR…217",
    brokerOrderId: "9001", role: "entry", status: "Filled",
    order: { executionId: "e1", orderRef: "trade-approval-abc12345-entry", averagePrice: 200,
      cumulativeQuantity: 5 }, seenAt: 2 });
  assert.deepEqual(applyPaperFlexCommissions(record, ledger, { observedAt: 3 }),
    { updated: 1, idempotent: 0, unmatched: 1, matched: 1 });
  assert.equal(ledger.listBrokerOrders("p1")[0].order.commission, 1);
  assert.equal(ledger.listEvents("p1").filter((item) => item.eventType === "broker_commission_imported").length, 1);
  assert.deepEqual(applyPaperFlexCommissions(record, ledger, { observedAt: 4 }),
    { updated: 0, idempotent: 1, unmatched: 1, matched: 1 });
  ledger.close();
});

test("a report with manual trades, duplicate executions, or short coverage cannot establish ownership", () => {
  assert.throws(() => importPaperFlexReport(csv.replace("trade-approval-abc12345", "manual"),
    { observedOn: "2026-09-18", reportWindowDays: 365 }));
  assert.throws(() => importPaperFlexReport(csv.replace("456,e2", "456,e1"),
    { observedOn: "2026-09-18", reportWindowDays: 365 }));
  assert.throws(() => importPaperFlexReport(csv, { observedOn: "2026-09-18", reportWindowDays: 30 }));
});
