import test from "node:test";
import assert from "node:assert/strict";
import { importPaperFlexReport, summarizePaperFlexEvidence } from "./paper_flex_evidence.mjs";

const csv = [
  "ClientAccountID,Symbol,TradeDate,Buy/Sell,Quantity,IBOrderID,IBExecID,OrderReference,IsAPIOrder,LevelOfDetail",
  "DUR973217,NVDA,20260824,BUY,5,123,e1,trade-approval-abc12345,Y,EXECUTION",
  "DUR973217,NVDA,20260901,SELL,-2,456,e2,trade-approval-def12345-stop,Y,EXECUTION",
].join("\n");

test("a 365-day Paper Flex report proves net app-referenced shares", () => {
  const record = importPaperFlexReport(csv, { observedOn: "2026-09-18", reportWindowDays: 365 });
  const summary = summarizePaperFlexEvidence(record).get("NVDA");
  assert.equal(summary.netQuantity, 3);
  assert.equal(summary.orderCount, 2);
  assert.equal(summary.legacySingleOrderCount, 1);
  assert.equal(summary.legacySingleOrderNetQuantity, 5);
  assert.equal(summary.bracketOrderCount, 1);
  assert.equal(summary.bracketNetQuantity, -2);
  assert.equal(summary.orderAttribution, "verified_application_reference");
  assert.equal(summary.account, "DUR…217");
});

test("a report with manual trades, duplicate executions, or short coverage cannot establish ownership", () => {
  assert.throws(() => importPaperFlexReport(csv.replace("trade-approval-abc12345", "manual"),
    { observedOn: "2026-09-18", reportWindowDays: 365 }));
  assert.throws(() => importPaperFlexReport(csv.replace("456,e2", "456,e1"),
    { observedOn: "2026-09-18", reportWindowDays: 365 }));
  assert.throws(() => importPaperFlexReport(csv, { observedOn: "2026-09-18", reportWindowDays: 30 }));
});
