import { normalizeAlpacaNewsMessage } from "./alpaca_news_stream.mjs";

const ENDPOINT = "https://data.alpaca.markets/v1beta1/news";
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export async function backfillAlpacaNews(journal, { fetchImpl = fetch, clock = () => Date.now(), credentials = () => ({
  key: process.env.APCA_API_KEY_ID, secret: process.env.APCA_API_SECRET_KEY,
}), maximumPages = 20 } = {}) {
  const { key, secret } = credentials();
  if (!key || !secret) throw new Error("news_credentials_missing");
  const now = clock();
  const latest = journal.latestUpdatedAt("Alpaca");
  const start = latest ? Math.max(Date.parse(latest) - 60_000, now - 24 * 60 * 60 * 1000) : now - DEFAULT_LOOKBACK_MS;
  let pageToken = null, pages = 0, received = 0, created = 0;
  do {
    const url = new URL(ENDPOINT);
    url.search = new URLSearchParams({ start: new Date(start).toISOString(), end: new Date(now).toISOString(),
      sort: "asc", limit: "50", include_content: "false", ...(pageToken ? { page_token: pageToken } : {}) }).toString();
    const response = await fetchImpl(url, { headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret, accept: "application/json" },
      redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(response.status === 429 ? "news_rate_limited" : [401, 403].includes(response.status) ? "news_access_unavailable" : "news_provider_unavailable");
    const bytes = Number(response.headers.get("content-length") ?? 0);
    if (bytes > 2_000_000) throw new Error("news_response_too_large");
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.news)) throw new Error("news_invalid_response");
    const observedAt = new Date(clock()).toISOString();
    for (const item of payload.news) {
      received++;
      const normalized = normalizeAlpacaNewsMessage({ T: "n", ...item }, observedAt);
      if (journal.append(normalized, observedAt).created) created++;
    }
    pageToken = typeof payload.next_page_token === "string" && payload.next_page_token ? payload.next_page_token : null;
    pages++;
  } while (pageToken && pages < maximumPages);
  journal.updateHealth("alpaca-benzinga-news-stream-v1", { status: "BACKFILL_COMPLETE", lastMessageAt: created ? clock() : undefined });
  return { start: new Date(start).toISOString(), end: new Date(now).toISOString(), pages, received, created, complete: !pageToken };
}
