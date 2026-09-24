import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyPaperFlexCommissions, importPaperFlexReport } from "./paper_flex_evidence.mjs";
import { TradingLedger } from "./trading_ledger.mjs";

const [, , sourceArg, observedOnArg, ledgerArg] = process.argv;
if (!sourceArg) throw new Error("usage: node service/import_paper_flex_commissions.mjs REPORT.csv [YYYY-MM-DD] [LEDGER]");
const source = resolve(sourceArg);
const observedOn = observedOnArg ?? new Date().toISOString().slice(0, 10);
const ledgerPath = resolve(ledgerArg ?? "service/data/trading-ledger.sqlite3");
const report = importPaperFlexReport(readFileSync(source, "utf8"), {
  observedOn, reportWindowDays: 365,
});
const ledger = new TradingLedger(ledgerPath);
try {
  const result = applyPaperFlexCommissions(report, ledger);
  console.log(JSON.stringify({ ok: true, sourceSha256: report.sourceSha256, ...result }));
} finally {
  ledger.close();
}
