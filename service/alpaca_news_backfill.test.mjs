import assert from "node:assert/strict";
import test from "node:test";
import { backfillAlpacaNews } from "./alpaca_news_backfill.mjs";
import { GlobalNewsJournal } from "./global_news_journal.mjs";

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

test("backfill paginates, persists and is idempotent", async () => {
  const journal = new GlobalNewsJournal(":memory:", { clock: () => Date.parse("2026-09-25T13:30:00Z") });
  journal.registerSource({ sourceKey: "alpaca-benzinga-news-stream-v1", provider: "Alpaca", publisher: "Benzinga", sourceTier: "LICENSED_WIRE", version: "v1beta1", configuration: { transport: "websocket", subscription: "all", contentStored: false, researchOnly: true } });
  const item = { id: 7, headline: "Issuer announces agreement", url: "https://www.benzinga.com/news/7", source: "Benzinga",
    created_at: "2026-09-25T13:29:00Z", updated_at: "2026-09-25T13:29:00Z", symbols: ["TEST"] };
  let calls = 0;
  const fetchImpl = async url => { calls++; return response(calls % 2 ? { news: [item], next_page_token: "next" } : { news: [], next_page_token: null }); };
  const options = { fetchImpl, clock: () => Date.parse("2026-09-25T13:30:00Z"), credentials: () => ({ key: "k", secret: "s" }) };
  const first = await backfillAlpacaNews(journal, options);
  assert.deepEqual({ pages: first.pages, received: first.received, created: first.created, complete: first.complete }, { pages: 2, received: 1, created: 1, complete: true });
  calls = 0;
  const second = await backfillAlpacaNews(journal, options);
  assert.equal(second.created, 0); assert.equal(journal.status().eventCount, 1);
  journal.close();
});

test("backfill fails closed on access denial", async () => {
  const journal = new GlobalNewsJournal(":memory:");
  journal.registerSource({ sourceKey: "alpaca-benzinga-news-stream-v1", provider: "Alpaca", publisher: "Benzinga", sourceTier: "LICENSED_WIRE", version: "v1beta1", configuration: { transport: "websocket", subscription: "all", contentStored: false, researchOnly: true } });
  await assert.rejects(backfillAlpacaNews(journal, { fetchImpl: async () => response({}, 403), credentials: () => ({ key: "k", secret: "s" }) }), /access_unavailable/);
  journal.close();
});
