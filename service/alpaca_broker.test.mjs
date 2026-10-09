import assert from "node:assert/strict";
import test from "node:test";
import { alpacaReconciliation, alpacaSubmitBracket, normalizeAlpacaOrder } from "./alpaca_broker.mjs";

const response = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
const env = { APCA_API_KEY_ID: process.env.APCA_API_KEY_ID, APCA_API_SECRET_KEY: process.env.APCA_API_SECRET_KEY };
test.before(() => { process.env.APCA_API_KEY_ID = "key"; process.env.APCA_API_SECRET_KEY = "secret"; });
test.after(() => { process.env.APCA_API_KEY_ID = env.APCA_API_KEY_ID; process.env.APCA_API_SECRET_KEY = env.APCA_API_SECRET_KEY; });

test("normalizes Alpaca orders into the broker-neutral snapshot contract", () => {
  const order = normalizeAlpacaOrder({ id: "order-1", symbol: "NVDA", side: "buy", type: "limit", qty: "2",
    filled_qty: "1", limit_price: "100", status: "partially_filled", client_order_id: "trade-approval-abc-entry" }, "PA…123");
  assert.equal(order.status, "PartiallyFilled");
  assert.equal(order.remaining, 1);
  assert.equal(order.orderRef, "trade-approval-abc-entry");
});

test("collects a complete normalized paper reconciliation snapshot", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/v2/account")) return response({ id: "account-123456", account_number: "PA123456", status: "ACTIVE", cash: "9000", equity: "10000", buying_power: "18000", long_market_value: "1000", maintenance_margin: "0" });
    if (url.endsWith("/v2/positions")) return response([{ asset_id: "asset-1", symbol: "NVDA", qty: "2", avg_entry_price: "100", market_value: "210", current_price: "105", unrealized_pl: "10", unrealized_intraday_pl: "2" }]);
    if (url.includes("/v2/orders?")) return response([{ id: "order-1", symbol: "NVDA", side: "sell", type: "stop", qty: "2", filled_qty: "0", stop_price: "90", status: "new" }]);
    if (url.includes("/activities/FILL")) return response([]);
    throw new Error(`unexpected ${url}`);
  };
  const snapshot = await alpacaReconciliation({ fetchImpl });
  assert.equal(snapshot.broker, "Alpaca");
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.positions[0].currentPrice, 105);
  assert.equal(snapshot.openOrders[0].status, "Submitted");
});

test("submits a Paper bracket with a deterministic client order id", async () => {
  let submitted;
  const fetchImpl = async (_url, options) => {
    submitted = JSON.parse(options.body);
    return response({ id: "parent", account_id: "account-123456", symbol: "NVDA", side: "buy", type: "limit", qty: "2", filled_qty: "0", limit_price: "100", status: "new", client_order_id: submitted.client_order_id,
      legs: [{ id: "target", symbol: "NVDA", side: "sell", type: "limit", qty: "2", filled_qty: "0", limit_price: "110", status: "held" }, { id: "stop", symbol: "NVDA", side: "sell", type: "stop", qty: "2", filled_qty: "0", stop_price: "95", status: "held" }] });
  };
  const result = await alpacaSubmitBracket({ decisionId: "1234567890abcdef", accountId: "PA…456", symbol: "NVDA", quantity: 2, limitPrice: 100, targetPrice: 110, stopPrice: 95 }, { fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(submitted.order_class, "bracket");
  assert.equal(submitted.time_in_force, "gtc");
  assert.equal(submitted.client_order_id, "trade-approval-1234567890ab-entry");
  assert.equal(result.exitOrders.length, 2);
});
