const ENDPOINT = "https://data.alpaca.markets/v2/stocks/bars";
const HORIZONS = [5, 30];
const ROUND_TRIP_COST_PERCENT = 0.20;

function chunks(items, size) { const result = []; for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size)); return result; }

export async function measureNewsShadowOutcomes(journal, { fetchImpl = fetch, clock = () => Date.now(), credentials = () => ({
  key: process.env.APCA_API_KEY_ID, secret: process.env.APCA_API_SECRET_KEY,
}), feed = process.env.ALPACA_MARKET_DATA_FEED ?? "iex" } = {}) {
  const { key, secret } = credentials(); if (!key || !secret) throw new Error("news_outcome_credentials_missing");
  if (!new Set(["iex", "sip"]).has(feed)) throw new Error("news_outcome_feed_invalid");
  const now = clock(), measuredAt = new Date(now).toISOString();
  const existing = new Set(journal.listShadowOutcomes({ limit: 10_000 }).map(item => `${item.signalId}:${item.horizonMinutes}`));
  const signals = journal.listShadowSignals({ limit: 5_000 }).filter(signal => ["POSITIVE", "NEGATIVE"].includes(signal.direction)
    && HORIZONS.some(horizon => now >= Date.parse(signal.publishedAt) + horizon * 60_000 && !existing.has(`${signal.signalId}:${horizon}`)));
  if (!signals.length) return { measuredAt, eligibleSignals: 0, created: 0, missing: 0, feed, researchOnly: true };
  const bySymbol = new Map();
  for (const signal of signals) { const list = bySymbol.get(signal.symbol) ?? []; list.push(signal); bySymbol.set(signal.symbol, list); }
  const barsBySymbol = new Map();
  for (const batch of chunks([...bySymbol.keys()], 50)) {
    const batchSignals = batch.flatMap(symbol => bySymbol.get(symbol));
    const start = Math.min(...batchSignals.map(signal => Date.parse(signal.publishedAt))) - 60_000;
    const url = new URL(ENDPOINT); url.search = new URLSearchParams({ symbols: batch.join(","), timeframe: "1Min",
      start: new Date(start).toISOString(), end: measuredAt, limit: "10000", adjustment: "raw", feed }).toString();
    const response = await fetchImpl(url, { headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret, accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(response.status === 429 ? "news_outcome_rate_limited" : "news_outcome_provider_unavailable");
    const payload = await response.json(); if (!payload || typeof payload.bars !== "object") throw new Error("news_outcome_response_invalid");
    for (const symbol of batch) barsBySymbol.set(symbol, Array.isArray(payload.bars[symbol]) ? payload.bars[symbol] : []);
  }
  let created = 0, missing = 0;
  for (const signal of signals) {
    const bars = barsBySymbol.get(signal.symbol) ?? [];
    const published = Date.parse(signal.publishedAt);
    const entry = bars.find(bar => Number.isFinite(Date.parse(bar.t)) && Date.parse(bar.t) >= published && Number.isFinite(bar.o));
    if (!entry) { missing++; continue; }
    for (const horizonMinutes of HORIZONS) {
      if (existing.has(`${signal.signalId}:${horizonMinutes}`) || now < published + horizonMinutes * 60_000) continue;
      const exit = bars.find(bar => Date.parse(bar.t) >= Date.parse(entry.t) + horizonMinutes * 60_000 && Number.isFinite(bar.c));
      if (!exit) { missing++; continue; }
      const raw = ((Number(exit.c) / Number(entry.o)) - 1) * 100;
      const gross = signal.direction === "NEGATIVE" ? -raw : raw;
      if (journal.appendShadowOutcome(signal, { horizonMinutes, entryAt: entry.t, exitAt: exit.t, entryPrice: entry.o, exitPrice: exit.c,
        grossReturnPercent: gross, afterCostReturnPercent: gross - ROUND_TRIP_COST_PERCENT, measuredAt,
        marketDataSource: `Alpaca ${feed.toUpperCase()} minute bars`, volumeScope: feed === "sip" ? "consolidated" : "single_venue" }).created) created++;
    }
  }
  return { measuredAt, eligibleSignals: signals.length, created, missing, feed, roundTripCostPercent: ROUND_TRIP_COST_PERCENT, researchOnly: true };
}

export function summarizeNewsShadowOutcomes(outcomes) {
  const groups = {};
  for (const outcome of outcomes) {
    const key = `${outcome.category}:${outcome.direction}:${outcome.horizonMinutes}m`;
    const group = groups[key] ??= { count: 0, total: 0, wins: 0 };
    group.count++; group.total += outcome.afterCostReturnPercent; if (outcome.afterCostReturnPercent > 0) group.wins++;
  }
  return Object.fromEntries(Object.entries(groups).map(([key, group]) => [key, { count: group.count,
    averageAfterCostReturnPercent: group.total / group.count, positiveRatePercent: group.wins / group.count * 100 }]));
}
