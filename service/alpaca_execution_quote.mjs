const ENDPOINT = "https://data.alpaca.markets/v2/stocks";

export function assessAlpacaExecutionQuote(payload, { symbol, now = Date.now(), maxAgeMs = 15_000, maxSpreadPercent = 0.25 } = {}) {
  const quote = payload?.quote;
  if (payload?.symbol !== symbol || !quote) return { ok: false, reason: "alpaca_quote_identity_mismatch" };
  const bid = Number(quote.bp);
  const ask = Number(quote.ap);
  const observedAt = Date.parse(quote.t);
  if (!(Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask >= bid)) return { ok: false, reason: "invalid_bid_ask" };
  if (!Number.isFinite(observedAt) || observedAt > now + 1_000 || now - observedAt > maxAgeMs) {
    return { ok: false, reason: "alpaca_quote_stale" };
  }
  const spreadPercent = ((ask - bid) / ((ask + bid) / 2)) * 100;
  if (spreadPercent > maxSpreadPercent) {
    return { ok: false, reason: "spread_too_wide", bid, ask, observedAt, spreadPercent, source: "alpaca_iex" };
  }
  return { ok: true, bid, ask, observedAt, spreadPercent, source: "alpaca_iex" };
}

// Paper-only escape hatch for an explicitly approved exit when IEX has a
// fresh bid but an incomplete/wide offer. The caller still submits a limit
// order, and the proposed limit must remain above cost by the requested floor.
export function assessProfitablePaperBidFallback(assessment, { averageCost, limitDiscountPercent = 0.2,
  minimumGrossProfitPercent = 0.2 } = {}) {
  if (assessment?.ok !== false || assessment.reason !== "spread_too_wide") {
    return { ok: false, reason: assessment?.reason ?? "quote_unavailable" };
  }
  const bid = Number(assessment.bid);
  const cost = Number(averageCost);
  if (!(Number.isFinite(bid) && bid > 0 && Number.isFinite(cost) && cost > 0)) {
    return { ok: false, reason: "paper_profit_floor_unavailable" };
  }
  const executableLimit = bid * (1 - limitDiscountPercent / 100);
  const minimumLimit = cost * (1 + minimumGrossProfitPercent / 100);
  if (executableLimit < minimumLimit) return { ok: false, reason: "paper_profit_floor_not_met" };
  return { ...assessment, ok: true, source: "alpaca_iex_bid_guarded", executableLimit, minimumLimit };
}

export async function getAlpacaExecutionQuote(symbol, { fetchImpl = fetch, key = process.env.APCA_API_KEY_ID,
  secret = process.env.APCA_API_SECRET_KEY, now = Date.now(), maxAgeMs = 15_000,
  maxSpreadPercent = 0.25 } = {}) {
  if (!key || !secret) return { ok: false, reason: "alpaca_credentials_unavailable" };
  const response = await fetchImpl(`${ENDPOINT}/${encodeURIComponent(symbol)}/quotes/latest?feed=iex`, {
    headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret, accept: "application/json" },
    redirect: "error",
  });
  if (!response.ok) return { ok: false, reason: `alpaca_quote_http_${response.status}` };
  return assessAlpacaExecutionQuote(await response.json(), { symbol, now, maxAgeMs, maxSpreadPercent });
}
