import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { importPaperFlexReport, summarizePaperFlexEvidence } from "./paper_flex_evidence.mjs";

const source = process.argv[2];
if (!source) throw new Error("Usage: node service/import_paper_flex_report.mjs <365-day IBKR Paper CSV>");
const observedOn = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const report = importPaperFlexReport(readFileSync(source, "utf8"), { observedOn, reportWindowDays: 365 });
const summary = summarizePaperFlexEvidence(report);
const destination = join(fileURLToPath(new URL("./data/", import.meta.url)), "paper-flex-attribution.json");
const temporary = `${destination}.tmp`;
writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
renameSync(temporary, destination);
console.log(JSON.stringify({ imported: true, symbols: [...summary].map(([symbol, item]) => ({ symbol, netQuantity: item.netQuantity, orderCount: item.orderCount })), destination }));
