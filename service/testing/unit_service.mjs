import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

// Import pure service helpers without depending on private runtime state.
const directory = mkdtempSync(join(tmpdir(), "trade-unit-service-"));
copyFileSync(new URL("../data/strategy-state.example.json", import.meta.url), join(directory, "strategy.json"));
process.env.STRATEGY_STATE_PATH = join(directory, "strategy.json");
process.env.TRADE_APPROVAL_BROKER_MODE = "simulated";
process.env.RISK_POLICY_PATH = join(directory, "risk-policy.json");
process.env.TRADE_LEDGER_PATH = join(directory, "ledger.sqlite3");
after(() => rmSync(directory, { recursive: true, force: true }));
export const unitService = await import("../server.mjs");
