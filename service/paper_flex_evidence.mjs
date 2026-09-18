import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

function csvRows(content) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (character !== "\r") field += character;
  }
  if (quoted) throw new Error("flex_csv_unclosed_quote");
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const maskedAccount = (account) => `${account.slice(0, 3)}…${account.slice(-3)}`;
const appReference = (value) => /^trade-approval-[0-9a-f-]{8,36}(?:-(?:entry|target|stop))?$/i.test(value ?? "");

export function importPaperFlexReport(csv, { observedOn, reportWindowDays } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observedOn ?? "") || reportWindowDays < 365) {
    throw new Error("flex_report_coverage_unverified");
  }
  const rows = csvRows(csv.replace(/^\uFEFF/, ""));
  const [headers, ...values] = rows;
  const required = ["ClientAccountID", "Symbol", "TradeDate", "Buy/Sell", "Quantity", "IBOrderID", "IBExecID", "OrderReference", "IsAPIOrder", "LevelOfDetail"];
  if (!headers || required.some((field) => !headers.includes(field)) || !values.length) throw new Error("flex_report_missing_fields");
  const accountIndex = headers.indexOf("ClientAccountID");
  const accounts = new Set(values.map((row) => row[accountIndex]));
  if (accounts.size !== 1 || !/^DU[A-Z0-9]{5,}$/.test([...accounts][0])) throw new Error("flex_report_not_one_paper_account");
  const orders = new Map(), executionIds = new Set();
  for (const valuesRow of values) {
    if (valuesRow.length !== headers.length) throw new Error("flex_report_invalid_csv_row");
    const row = Object.fromEntries(headers.map((header, index) => [header, valuesRow[index]]));
    const symbol = row.Symbol;
    const quantity = Number(row.Quantity);
    const side = row["Buy/Sell"];
    if (!/^[A-Z.]{1,10}$/.test(symbol) || !/^\d{8}$/.test(row.TradeDate)
      || !Number.isSafeInteger(quantity) || quantity === 0
      || !((side === "BUY" && quantity > 0) || (side === "SELL" && quantity < 0))
      || row.LevelOfDetail !== "EXECUTION" || row.IsAPIOrder !== "Y"
      || !appReference(row.OrderReference)
      || !/^\d+$/.test(row.IBOrderID) || !row.IBExecID || executionIds.has(row.IBExecID)) {
      throw new Error("flex_report_unattributed_or_invalid_trade");
    }
    executionIds.add(row.IBExecID);
    const key = `${symbol}:${row.IBOrderID}`;
    const prior = orders.get(key);
    if (prior && (prior.orderReference !== row.OrderReference || prior.side !== side)) throw new Error("flex_report_order_conflict");
    orders.set(key, { symbol, date: row.TradeDate, side, quantity: (prior?.quantity ?? 0) + quantity,
      brokerOrderId: row.IBOrderID, orderReference: row.OrderReference, executions: (prior?.executions ?? 0) + 1 });
  }
  return {
    source: "IBKR Paper Activity Flex Query", environment: "paper", account: maskedAccount([...accounts][0]),
    observedOn, reportWindowDays, sourceSha256: createHash("sha256").update(csv).digest("hex"),
    orders: [...orders.values()],
  };
}

export function summarizePaperFlexEvidence(record) {
  if (record?.source !== "IBKR Paper Activity Flex Query" || record.environment !== "paper"
    || !/^DU[A-Z0-9]*…[A-Z0-9]{3}$/.test(record.account ?? "")
    || !/^\d{4}-\d{2}-\d{2}$/.test(record.observedOn ?? "")
    || record.reportWindowDays < 365 || !/^[a-f0-9]{64}$/.test(record.sourceSha256 ?? "")
    || !Array.isArray(record.orders) || record.orders.length === 0) throw new Error("invalid_flex_evidence");
  const result = new Map(), identities = new Set();
  for (const order of record.orders) {
    const key = `${order.symbol}:${order.brokerOrderId}`;
    if (!/^[A-Z.]{1,10}$/.test(order.symbol ?? "") || !/^\d+$/.test(order.brokerOrderId ?? "")
      || !appReference(order.orderReference)
      || !/^\d{8}$/.test(order.date ?? "") || !Number.isSafeInteger(order.quantity) || order.quantity === 0
      || !((order.side === "BUY" && order.quantity > 0) || (order.side === "SELL" && order.quantity < 0))
      || !Number.isSafeInteger(order.executions) || order.executions < 1 || identities.has(key)) throw new Error("invalid_flex_order");
    identities.add(key);
    const prior = result.get(order.symbol) ?? { netQuantity: 0, orderCount: 0, executionCount: 0,
      legacySingleOrderCount: 0, legacySingleOrderNetQuantity: 0, bracketOrderCount: 0, bracketNetQuantity: 0 };
    const legacySingleOrder = !/-(?:entry|target|stop)$/i.test(order.orderReference);
    result.set(order.symbol, { ...prior, netQuantity: prior.netQuantity + order.quantity,
      orderCount: prior.orderCount + 1, executionCount: prior.executionCount + order.executions,
      legacySingleOrderCount: prior.legacySingleOrderCount + Number(legacySingleOrder),
      legacySingleOrderNetQuantity: prior.legacySingleOrderNetQuantity + (legacySingleOrder ? order.quantity : 0),
      bracketOrderCount: prior.bracketOrderCount + Number(!legacySingleOrder),
      bracketNetQuantity: prior.bracketNetQuantity + (legacySingleOrder ? 0 : order.quantity),
      account: record.account, environment: "paper", observedOn: record.observedOn,
      orderAttribution: "verified_application_reference" });
  }
  return result;
}

export function loadPaperFlexEvidence(path) {
  try { return summarizePaperFlexEvidence(JSON.parse(readFileSync(path, "utf8"))); }
  catch (error) { if (error.code === "ENOENT") return new Map(); throw error; }
}
