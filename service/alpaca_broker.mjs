const PAPER_BASE_URL = "https://paper-api.alpaca.markets";
const DATA_BASE_URL = "https://data.alpaca.markets";

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const maskAccount = (value) => {
  const account = String(value ?? "");
  return account.length >= 6 ? `${account.slice(0, 3)}…${account.slice(-3)}` : "***";
};

const credentials = () => ({
  key: process.env.APCA_API_KEY_ID,
  secret: process.env.APCA_API_SECRET_KEY,
});

function headers(extra = {}) {
  const { key, secret } = credentials();
  if (!key || !secret) throw new Error("alpaca_credentials_unavailable");
  return {
    "APCA-API-KEY-ID": key,
    "APCA-API-SECRET-KEY": secret,
    ...extra,
  };
}

async function request(path, { fetchImpl = fetch, method = "GET", body, data = false } = {}) {
  const base = data ? DATA_BASE_URL : (process.env.ALPACA_TRADING_BASE_URL ?? PAPER_BASE_URL);
  const response = await fetchImpl(`${base}${path}`, {
    method,
    headers: headers(body ? { "content-type": "application/json" } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message ?? `alpaca_http_${response.status}`);
    error.code = payload.code ?? `alpaca_http_${response.status}`;
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

const status = (value) => ({
  new: "Submitted", accepted: "Submitted", pending_new: "PendingSubmit", held: "PreSubmitted",
  accepted_for_bidding: "PreSubmitted", partially_filled: "PartiallyFilled",
  filled: "Filled", canceled: "Cancelled", cancelled: "Cancelled",
  expired: "Inactive", rejected: "Rejected", replaced: "Cancelled",
  pending_cancel: "Submitted", pending_replace: "Submitted", stopped: "Inactive",
}[String(value ?? "").toLowerCase()] ?? String(value ?? "Unknown"));

function orderType(value) {
  return ({ limit: "LMT", stop: "STP", stop_limit: "STP LMT", market: "MKT" }[value] ?? String(value ?? "").toUpperCase());
}

function roleFor(order) {
  if (/-target$/i.test(order.client_order_id ?? "")) return "target";
  if (/-stop$/i.test(order.client_order_id ?? "")) return "stop";
  if (!order.parent_order_id) return "entry";
  return order.type === "stop" || order.type === "stop_limit" ? "stop" : "target";
}

export function normalizeAlpacaOrder(order, account) {
  const role = roleFor(order);
  // Alpaca assigns its own UUID-like client_order_id to bracket/OCO child
  // legs. The application identity remains on the parent order. Prefer that
  // parent reference for every child so target/stop fills can be reconciled
  // to the originating decision after the parent has left the open-order
  // feed.
  const parentRef = order.parent_order_id
    ? order.parent_client_order_id || order.client_order_id || null
    : order.client_order_id || null;
  const reference = parentRef && role !== "entry" && /-(?:entry|target|stop)$/i.test(parentRef)
    ? parentRef.replace(/-(?:entry|target|stop)$/i, `-${role}`)
    : parentRef;
  return {
    orderId: order.id,
    permanentId: order.id,
    parentId: order.parent_order_id ?? null,
    account,
    symbol: order.symbol,
    securityType: "STK",
    action: String(order.side ?? "").toUpperCase(),
    side: String(order.side ?? "").toUpperCase(),
    orderType: orderType(order.type),
    quantity: number(order.qty),
    filled: number(order.filled_qty) ?? 0,
    remaining: Math.max(0, (number(order.qty) ?? 0) - (number(order.filled_qty) ?? 0)),
    limitPrice: number(order.limit_price),
    stopPrice: number(order.stop_price),
    averageFillPrice: number(order.filled_avg_price),
    timeInForce: String(order.time_in_force ?? "").toUpperCase(),
    orderRef: reference,
    status: status(order.status),
    submittedAt: order.submitted_at ?? null,
  };
}

function flattenOrders(orders) {
  const flattened = [];
  for (const order of orders ?? []) {
    flattened.push(order);
    for (const leg of order.legs ?? []) flattened.push({ ...leg, parent_order_id: leg.parent_order_id ?? order.id, parent_client_order_id: order.client_order_id });
  }
  return flattened;
}

export async function alpacaSnapshot(symbol = "NVDA", options = {}) {
  const normalized = String(symbol).toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized)) throw new Error("invalid_symbol");
  const [account, quote] = await Promise.all([
    request("/v2/account", options),
    request(`/v2/stocks/${encodeURIComponent(normalized)}/quotes/latest?feed=${encodeURIComponent(process.env.ALPACA_DATA_FEED ?? "iex")}`, { ...options, data: true }),
  ]);
  const latest = quote.quote ?? {};
  return {
    ok: account.status === "ACTIVE" && account.trading_blocked !== true,
    broker: "Alpaca",
    environment: "paper",
    readOnly: true,
    complete: true,
    account: maskAccount(account.account_number ?? account.id),
    capturedAt: Date.now(),
    summary: {
      NetLiquidation: { value: number(account.equity), currency: "USD" },
      TotalCashValue: { value: number(account.cash), currency: "USD" },
      SettledCash: { value: number(account.cash), currency: "USD" },
      AvailableFunds: { value: number(account.buying_power), currency: "USD" },
      BuyingPower: { value: number(account.buying_power), currency: "USD" },
      GrossPositionValue: { value: number(account.long_market_value), currency: "USD" },
      MaintMarginReq: { value: number(account.maintenance_margin) ?? 0, currency: "USD" },
      UnrealizedPnL: { value: null, currency: "USD" },
      RealizedPnL: { value: null, currency: "USD" },
    },
    quote: {
      symbol: normalized,
      bid: number(latest.bp), ask: number(latest.ap), last: null, close: null,
      dataType: `alpaca_${process.env.ALPACA_DATA_FEED ?? "iex"}`,
      receivedAt: latest.t ? Date.parse(latest.t) : null,
      bidReceivedAt: latest.t ? Date.parse(latest.t) : null,
      askReceivedAt: latest.t ? Date.parse(latest.t) : null,
    },
    warnings: [],
  };
}

export async function alpacaReconciliation(options = {}) {
  const [account, positions, orderPayload, fills] = await Promise.all([
    request("/v2/account", options),
    request("/v2/positions", options),
    request("/v2/orders?status=all&limit=500&nested=true&direction=desc", options),
    request("/v2/account/activities/FILL?direction=desc&page_size=100", options),
  ]);
  const accountId = maskAccount(account.account_number ?? account.id);
  const orders = flattenOrders(orderPayload).map((order) => normalizeAlpacaOrder(order, accountId));
  const ordersById = new Map(orders.map((order) => [String(order.orderId), order]));
  const openStatuses = new Set(["PendingSubmit", "PreSubmitted", "Submitted", "PartiallyFilled"]);
  return {
    ok: account.status === "ACTIVE" && account.trading_blocked !== true,
    broker: "Alpaca",
    environment: "paper",
    readOnly: true,
    account: accountId,
    capturedAt: Date.now(),
    complete: true,
    completed: { accountSummary: true, positions: true, openOrders: true, completedOrders: true, executions: true },
    summary: {
      NetLiquidation: { value: number(account.equity), currency: "USD" },
      TotalCashValue: { value: number(account.cash), currency: "USD" },
      SettledCash: { value: number(account.cash), currency: "USD" },
      AvailableFunds: { value: number(account.buying_power), currency: "USD" },
      BuyingPower: { value: number(account.buying_power), currency: "USD" },
      GrossPositionValue: { value: number(account.long_market_value), currency: "USD" },
      MaintMarginReq: { value: number(account.maintenance_margin) ?? 0, currency: "USD" },
      UnrealizedPnL: { value: positions.reduce((sum, item) => sum + (number(item.unrealized_pl) ?? 0), 0), currency: "USD" },
      RealizedPnL: { value: null, currency: "USD" },
    },
    positions: positions.map((item) => ({
      account: accountId, contractId: item.asset_id, symbol: item.symbol, securityType: "STK", currency: "USD",
      quantity: number(item.qty), averageCost: number(item.avg_entry_price), marketValue: number(item.market_value),
      dailyPnl: number(item.unrealized_intraday_pl), unrealizedPnl: number(item.unrealized_pl), realizedPnl: null,
      currentPrice: number(item.current_price),
    })),
    openOrders: orders.filter((order) => openStatuses.has(order.status)),
    completedOrders: orders.filter((order) => !openStatuses.has(order.status)),
    executions: (fills ?? []).map((fill) => ({
      executionId: fill.id, orderId: fill.order_id, permanentId: fill.order_id, account: accountId,
      symbol: fill.symbol, securityType: "STK", side: String(fill.side ?? "").toUpperCase(),
      quantity: number(fill.qty), price: number(fill.price), cumulativeQuantity: number(fill.cum_qty) ?? number(fill.qty),
      averagePrice: number(fill.price), time: fill.transaction_time,
      orderRef: ordersById.get(String(fill.order_id))?.orderRef ?? null,
    })),
    pnl: {}, warnings: [],
  };
}

export async function alpacaPreflight(receipt, options = {}) {
  const [account, asset] = await Promise.all([
    request("/v2/account", options),
    request(`/v2/assets/${encodeURIComponent(receipt.symbol)}`, options),
  ]);
  const buyingPower = number(account.buying_power) ?? 0;
  const notional = Number(receipt.quantity) * Number(receipt.limitPrice);
  const errors = [];
  if (account.status !== "ACTIVE" || account.trading_blocked) errors.push("account_not_tradable");
  if (!asset.tradable || asset.status !== "active") errors.push("asset_not_tradable");
  if (buyingPower < notional) errors.push("insufficient_buying_power");
  return { ok: errors.length === 0, broker: "Alpaca", environment: "paper",
    account: maskAccount(account.account_number ?? account.id), symbol: receipt.symbol,
    quantity: receipt.quantity, estimatedCommission: 0, buyingPower, warnings: [], errors };
}

export async function alpacaSubmitBracket(receipt, options = {}) {
  const clientOrderId = `trade-approval-${receipt.decisionId.slice(0, 12)}-entry`;
  try {
    const order = await request("/v2/orders", { ...options, method: "POST", body: {
      symbol: receipt.symbol, qty: String(receipt.quantity), side: "buy", type: "limit",
      time_in_force: "gtc", limit_price: String(receipt.limitPrice), order_class: "bracket",
      take_profit: { limit_price: String(receipt.targetPrice) },
      stop_loss: { stop_price: String(receipt.stopPrice) }, client_order_id: clientOrderId,
    } });
    const account = order.account_id ? maskAccount(order.account_id) : receipt.accountId;
    const normalized = normalizeAlpacaOrder(order, account);
    const legs = (order.legs ?? []).map((leg) => normalizeAlpacaOrder({ ...leg, parent_order_id: order.id, parent_client_order_id: clientOrderId }, account));
    const target = legs.find((item) => item.orderType === "LMT");
    const stop = legs.find((item) => item.orderType === "STP" || item.orderType === "STP LMT");
    return { ok: true, broker: "Alpaca", environment: "paper", account, symbol: receipt.symbol,
      action: "BUY", quantity: receipt.quantity, limitPrice: receipt.limitPrice, stopPrice: receipt.stopPrice,
      targetPrice: receipt.targetPrice, result: normalized, exitOrders: [target, stop].filter(Boolean), errors: [], warnings: [] };
  } catch (error) {
    return { ok: false, broker: "Alpaca", environment: "paper", error: error.code ?? "alpaca_submission_failed",
      errors: [{ code: error.code ?? "alpaca_submission_failed", message: error.message }], warnings: [] };
  }
}

export async function alpacaSubmitProtectionOco({ decisionId, accountId, symbol, quantity, targetPrice, stopPrice }, options = {}) {
  const clientOrderId = `trade-approval-${decisionId.slice(0, 12)}-target`;
  try {
    const order = await request("/v2/orders", { ...options, method: "POST", body: {
      symbol, qty: String(quantity), side: "sell", type: "limit", time_in_force: "gtc",
      order_class: "oco", take_profit: { limit_price: String(targetPrice) },
      stop_loss: { stop_price: String(stopPrice) }, client_order_id: clientOrderId,
    } });
    const account = order.account_id ? maskAccount(order.account_id) : accountId;
    const target = normalizeAlpacaOrder(order, account);
    const legs = (order.legs ?? []).map((leg) => normalizeAlpacaOrder({
      ...leg, parent_order_id: leg.parent_order_id ?? order.id, parent_client_order_id: clientOrderId,
    }, account));
    const stop = legs.find((item) => item.orderType === "STP" || item.orderType === "STP LMT");
    if (!stop) throw new Error("alpaca_oco_stop_missing");
    return { ok: true, broker: "Alpaca", environment: "paper", account, symbol,
      action: "SELL", quantity, targetPrice, stopPrice, target, stop, errors: [], warnings: [] };
  } catch (error) {
    return { ok: false, broker: "Alpaca", environment: "paper", error: error.code ?? "alpaca_protection_failed",
      errors: [{ code: error.code ?? "alpaca_protection_failed", message: error.message }], warnings: [] };
  }
}

export async function alpacaSubmitExit({ decisionId, accountId, symbol, quantity, limitPrice }, options = {}) {
  const clientOrderId = `trade-approval-${decisionId.slice(0, 12)}-exit`;
  try {
    const order = await request("/v2/orders", { ...options, method: "POST", body: {
      symbol, qty: String(quantity), side: "sell", type: "limit", time_in_force: "day",
      limit_price: String(limitPrice), client_order_id: clientOrderId,
    } });
    const account = order.account_id ? maskAccount(order.account_id) : accountId;
    return { ok: true, broker: "Alpaca", environment: "paper", account, symbol,
      action: "SELL", quantity, limitPrice, result: normalizeAlpacaOrder(order, account), errors: [], warnings: [] };
  } catch (error) {
    return { ok: false, broker: "Alpaca", environment: "paper", error: error.code ?? "alpaca_exit_failed",
      errors: [{ code: error.code ?? "alpaca_exit_failed", message: error.message }], warnings: [] };
  }
}

export async function alpacaReplaceOrder(orderId, limitPrice, options = {}) {
  const order = await request(`/v2/orders/${encodeURIComponent(orderId)}`, {
    ...options, method: "PATCH", body: { limit_price: String(limitPrice) },
  });
  return { ok: true, broker: "Alpaca", result: normalizeAlpacaOrder(order, null) };
}
