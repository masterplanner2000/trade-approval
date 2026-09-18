import { existsSync, readFileSync } from "node:fs";

// Transaction History confirms broker share movements, not the submitting app.
// The local evidence file is intentionally separate from the strategy ledger.
export function summarizeHistoricalEvidence(record) {
  if (!record || record.environment !== "paper" || typeof record.account !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(record.observedOn ?? "")
    || !Array.isArray(record.symbols)) throw new Error("invalid_historical_evidence");
  const result = new Map();
  for (const item of record.symbols) {
    if (!/^[A-Z.]{1,10}$/.test(item.symbol ?? "") || !Array.isArray(item.movements)
      || result.has(item.symbol)) throw new Error("invalid_historical_symbol");
    let netQuantity = 0;
    let rowCount = 0;
    for (const movement of item.movements) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(movement.date ?? "")
        || movement.date > record.observedOn
        || !["buy", "sell"].includes(movement.side)
        || !Number.isSafeInteger(movement.quantity) || movement.quantity <= 0
        || !Number.isSafeInteger(movement.rows) || movement.rows <= 0) {
        throw new Error("invalid_historical_movement");
      }
      netQuantity += (movement.side === "buy" ? 1 : -1) * movement.quantity;
      rowCount += movement.rows;
    }
    if (netQuantity < 0 || rowCount === 0) throw new Error("invalid_historical_balance");
    result.set(item.symbol, {
      account: record.account, environment: "paper", observedOn: record.observedOn,
      source: "IBKR Paper Transaction History", netQuantity, rowCount,
      orderAttribution: "unverified",
    });
  }
  return result;
}

export function loadHistoricalEvidence(path) {
  if (!existsSync(path)) return new Map();
  return summarizeHistoricalEvidence(JSON.parse(readFileSync(path, "utf8")));
}
