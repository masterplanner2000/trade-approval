import test from "node:test";
import assert from "node:assert/strict";
import { createStockNewsService, normalizeStockNews, stockNewsSymbol } from "./stock_news.mjs";

const now = Date.parse("2026-09-11T13:00:00Z");
const article = { id: 123, headline: "Company reports results", source: "benzinga", symbols: ["AAPL"],
  url: "https://www.benzinga.com/news/123", created_at: "2026-09-11T12:00:00Z", updated_at: "2026-09-11T12:00:00Z" };
const credentials = () => ({ key: "test-key", secret: "secret-canary" });
const response = payload => new Response(JSON.stringify(payload), { status: 200 });

test("keeps newest corrections, deduplicates links and excludes unrelated, unsafe and stale stories", () => {
  const news = normalizeStockNews("aapl", { news: [article,
    { ...article, headline: "Corrected results", updated_at: "2026-09-11T12:30:00Z" },
    { ...article, id: 124 },
    { ...article, id: 125, symbols: ["MSFT"] },
    { ...article, id: 126, url: "javascript:alert(1)" },
    { ...article, id: 127, created_at: "2026-08-01T12:00:00Z" },
    { ...article, id: 128, updated_at: "2026-09-12T12:00:00Z" },
    { ...article, id: 129, url: "https://benzinga.com.evil.test/news" },
  ] }, now);
  assert.equal(news.articles.length, 1);
  assert.equal(news.articles[0].headline, "Corrected results");
  assert.equal(news.status, "partial");
  assert.equal(news.researchOnly, true);
  assert.equal(news.latency, "unverified");
});

test("distinguishes empty, partial and malformed provider responses", () => {
  assert.equal(normalizeStockNews("AAPL", { news: [] }, now).status, "empty");
  assert.equal(normalizeStockNews("AAPL", { news: [], next_page_token: "more" }, now).status, "partial");
  assert.throws(() => normalizeStockNews("AAPL", {}, now));
  assert.throws(() => stockNewsSymbol("AAPL&symbols=MSFT"));
});

test("uses server-only credentials, fixed endpoint, no content and coalesced bounded cache", async () => {
  let calls = 0;
  let time = now;
  const get = createStockNewsService({ credentials, clock: () => time, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url.origin, "https://data.alpaca.markets");
    assert.equal(url.searchParams.get("symbols"), "AAPL");
    assert.equal(url.searchParams.get("include_content"), "false");
    assert.equal(options.headers["APCA-API-SECRET-KEY"], "secret-canary");
    assert.equal(options.redirect, "error");
    return response({ news: [article] });
  } });
  const values = await Promise.all([get("aapl"), get("AAPL")]);
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(values).includes("secret-canary"));
  await get("AAPL"); assert.equal(calls, 1);
  time += 61_000;
  await get("AAPL"); assert.equal(calls, 2);
});

test("expired success cannot appear fresh after provider failure; raw errors never escape", async () => {
  let time = now;
  let failing = false;
  const get = createStockNewsService({ credentials, clock: () => time, fetchImpl: async () => {
    if (failing) throw new Error("secret-canary");
    return response({ news: [article] });
  } });
  assert.equal((await get("AAPL")).status, "available");
  time += 61_000; failing = true;
  const result = await get("AAPL");
  assert.equal(result.status, "unavailable");
  assert.equal(result.retrievedAt, null);
  assert.deepEqual(result.articles, []);
  assert.ok(!JSON.stringify(result).includes("secret-canary"));
});

test("missing keys and denied access stay unavailable, not empty", async () => {
  const missing = createStockNewsService({ credentials: () => ({}), fetchImpl: () => { throw new Error("must not request"); } });
  assert.equal((await missing("AAPL")).error, "news_credentials_missing");
  const denied = createStockNewsService({ credentials, fetchImpl: async () => new Response("secret-canary", { status: 403 }) });
  assert.equal((await denied("AAPL")).error, "news_access_unavailable");
});

test("429 Retry-After suppresses other symbols until cooldown ends", async () => {
  let time = now;
  let calls = 0;
  const get = createStockNewsService({ credentials, clock: () => time, fetchImpl: async () => {
    calls++;
    return new Response("", { status: 429, headers: { "retry-after": "120" } });
  } });
  await get("AAPL");
  time += 61_000;
  assert.equal((await get("MSFT")).error, "news_rate_limited");
  assert.equal(calls, 1);
  time += 60_000;
  await get("MSFT"); assert.equal(calls, 2);
});

test("oversized and invalid JSON responses fail closed", async () => {
  for (const data of ["x".repeat(1_000_001), "not-json"]) {
    const get = createStockNewsService({ credentials, fetchImpl: async () => new Response(data) });
    assert.equal((await get("AAPL")).status, "unavailable");
  }
});
