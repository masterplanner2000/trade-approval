// The arrival times are local TWS callback times, not exchange timestamps.
// They only bound the app's own delay; IBKR must separately confirm live data.
export function assessAutomaticExitQuote(snapshot, { now = Date.now(), maxAgeMs = 5_000, maxSpreadPercent = 0.25 } = {}) {
  const quote = snapshot?.quote;
  if (snapshot?.ok !== true || snapshot.environment !== "paper" || quote?.dataType !== 1) return { ok: false, reason: "live_quote_unavailable" };
  const bid = quote.bid;
  const ask = quote.ask;
  if (!(Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask >= bid)) return { ok: false, reason: "invalid_bid_ask" };
  if (![quote.bidReceivedAt, quote.askReceivedAt].every((time) => Number.isFinite(time) && time <= now && now - time <= maxAgeMs)) {
    return { ok: false, reason: "quote_callback_stale" };
  }
  const spreadPercent = ((ask - bid) / ((ask + bid) / 2)) * 100;
  if (spreadPercent > maxSpreadPercent) return { ok: false, reason: "spread_too_wide" };
  return { ok: true, bid, ask, spreadPercent };
}
