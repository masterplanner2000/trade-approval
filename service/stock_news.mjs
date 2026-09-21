import { classifyStockCatalysts } from "./stock_catalyst.mjs";

const ENDPOINT = "https://data.alpaca.markets/v1beta1/news";
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const TTL_MS = 60_000;

export function stockNewsSymbol(value) {
  const symbol = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) throw new Error("invalid_symbol");
  return symbol;
}

function plainText(value, limit) {
  return typeof value === "string"
    ? value.replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit)
    : "";
}

function articleUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    // This integration delivers Benzinga articles, not arbitrary provider links.
    if (url.hostname !== "benzinga.com" && !url.hostname.endsWith(".benzinga.com")) return null;
    url.hash = "";
    return url.href;
  } catch { return null; }
}

export function normalizeStockNews(symbolInput, payload, now = Date.now()) {
  const symbol = stockNewsSymbol(symbolInput);
  if (!payload || !Array.isArray(payload.news)) throw new Error("news_invalid_response");
  const articlesById = new Map();
  let rejectedCount = 0;
  for (const raw of payload.news.slice(0, 50)) {
    const published = typeof raw?.created_at === "string" ? Date.parse(raw.created_at) : NaN;
    const updated = raw?.updated_at == null ? published : Date.parse(raw.updated_at);
    const headline = plainText(raw?.headline, 600);
    const source = plainText(raw?.source, 100);
    const url = articleUrl(raw?.url);
    const symbols = Array.isArray(raw?.symbols) ? [...new Set(raw.symbols.filter(s => typeof s === "string")
      .map(s => s.trim().toUpperCase()).filter(s => /^[A-Z][A-Z0-9.-]{0,14}$/.test(s)))].slice(0, 25) : [];
    const id = typeof raw?.id === "string" || Number.isSafeInteger(raw?.id) ? String(raw.id) : "";
    if (!id || !headline || !source || !url || !symbols.includes(symbol)
      || !Number.isFinite(published) || !Number.isFinite(updated)
      || published > now || updated > now || updated < published || published < now - WINDOW_MS) {
      rejectedCount++;
      continue;
    }
    const article = { id, headline, source, url, symbols, publishedAt: new Date(published).toISOString(), updatedAt: new Date(updated).toISOString() };
    const previous = articlesById.get(id);
    if (!previous || previous.updatedAt < article.updatedAt) articlesById.set(id, article);
  }
  const seenUrls = new Set();
  const articles = [...articlesById.values()]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    .filter(article => { if (seenUrls.has(article.url)) return false; seenUrls.add(article.url); return true; });
  const partial = Boolean(payload.next_page_token) || rejectedCount > 0 || payload.news.length > 50;
  const result = {
    status: partial ? "partial" : articles.length ? "available" : "empty",
    provider: "Alpaca", publisher: "Benzinga", symbol, researchOnly: true,
    retrievedAt: new Date(now).toISOString(), windowStart: new Date(now - WINDOW_MS).toISOString(),
    latency: "unverified", partial, articles: articles.slice(0, 10),
  };
  return { ...result, catalystResearch: classifyStockCatalysts(result, now) };
}

// In-memory context cache only: no article bodies, secrets or trading-ledger writes.
export function createStockNewsService({ fetchImpl = fetch, clock = Date.now, credentials = () => ({
  key: process.env.APCA_API_KEY_ID, secret: process.env.APCA_API_SECRET_KEY,
}) } = {}) {
  const cache = new Map();
  const inFlight = new Map();
  let retryAfter = 0;
  const unavailable = (symbol, error) => {
    const result = { status: "unavailable", provider: "Alpaca", publisher: "Benzinga", symbol,
      researchOnly: true, retrievedAt: null, latency: "unverified", partial: false, articles: [], error };
    return { ...result, catalystResearch: classifyStockCatalysts(result, clock()) };
  };

  async function load(symbol) {
    const { key, secret } = credentials();
    if (!key || !secret) return unavailable(symbol, "news_credentials_missing");
    const url = new URL(ENDPOINT);
    url.search = new URLSearchParams({ symbols: symbol, start: new Date(clock() - WINDOW_MS).toISOString(),
      sort: "desc", limit: "50", include_content: "false" }).toString();
    try {
      const response = await fetchImpl(url, { headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret, accept: "application/json" },
        signal: AbortSignal.timeout(8000), redirect: "error" });
      if (!response.ok) {
        if (response.status === 429) {
          const header = response.headers.get("retry-after");
          const seconds = header == null ? NaN : Number(header);
          const wait = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - clock();
          retryAfter = clock() + Math.max(TTL_MS, Number.isFinite(wait) ? wait : TTL_MS);
        }
        return unavailable(symbol, response.status === 429 ? "news_rate_limited" : [401, 403].includes(response.status) ? "news_access_unavailable" : "news_provider_unavailable");
      }
      let bytes = 0;
      const chunks = [];
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 1_000_000) throw new Error("news_response_too_large");
        chunks.push(chunk);
      }
      return normalizeStockNews(symbol, JSON.parse(Buffer.concat(chunks).toString("utf8")), clock());
    } catch { return unavailable(symbol, "news_provider_unavailable"); }
  }

  return async function getStockNews(input) {
    const symbol = stockNewsSymbol(input);
    const cached = cache.get(symbol);
    if (cached && cached.expiresAt > clock()) return cached.value;
    if (inFlight.has(symbol)) return inFlight.get(symbol);
    if (clock() < retryAfter) return unavailable(symbol, "news_rate_limited");
    if (inFlight.size >= 8) return unavailable(symbol, "news_busy");
    const pending = load(symbol).then(value => {
      cache.delete(symbol);
      if (cache.size >= 500) cache.delete(cache.keys().next().value);
      cache.set(symbol, { value, expiresAt: clock() + TTL_MS });
      return value;
    }).finally(() => inFlight.delete(symbol));
    inFlight.set(symbol, pending);
    return pending;
  };
}

export const getStockNews = createStockNewsService();
