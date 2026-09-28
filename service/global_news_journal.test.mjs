import assert from "node:assert/strict";
import test from "node:test";
import { GlobalNewsJournal, normalizeGlobalNewsEvent } from "./global_news_journal.mjs";

const article = { provider: "Alpaca", publisher: "Benzinga", sourceTier: "LICENSED_WIRE", sourceRecordId: "42",
  headline: "Example announces results", url: "https://www.benzinga.com/news/42", publishedAt: "2026-09-24T14:00:00Z",
  updatedAt: "2026-09-24T14:00:00Z", firstSeenAt: "2026-09-24T14:00:01Z", originalLanguage: "en", symbols: ["EXM"], verificationState: "DISCOVERED" };

test("normalizes a research-only event and rejects future publication", () => {
  const event = normalizeGlobalNewsEvent(article, "2026-09-24T14:00:02Z");
  assert.equal(event.researchOnly, true); assert.equal(event.rankingAdjustmentAllowed, false); assert.equal(event.orderSubmissionAllowed, false);
  assert.throws(() => normalizeGlobalNewsEvent({ ...article, publishedAt: "2026-09-25T14:00:00Z", updatedAt: "2026-09-25T14:00:00Z" }, "2026-09-24T14:00:02Z"), /future_publication/);
});

test("journal is idempotent, immutable and reports health", () => {
  const journal = new GlobalNewsJournal(":memory:", { clock: () => Date.parse("2026-09-24T14:00:02Z") });
  assert.equal(journal.registerSource({ sourceKey: "test-v1", provider: "Alpaca", publisher: "Benzinga", sourceTier: "LICENSED_WIRE", version: "1", configuration: {} }).created, true);
  assert.equal(journal.append(article).created, true); assert.equal(journal.append(article).created, false);
  assert.equal(journal.latestUpdatedAt("Alpaca"), "2026-09-24T14:00:00.000Z");
  assert.equal(journal.listRecent({ symbol: "EXM" }).length, 1);
  assert.equal(journal.listRecent({ symbol: "OTHER" }).length, 0);
  journal.updateHealth("test-v1", { status: "CONNECTED", connectedAt: 1, lastMessageAt: 2 });
  assert.equal(journal.status().eventCount, 1); assert.equal(journal.status().sources[0].status, "CONNECTED");
  assert.throws(() => journal.database.exec("DELETE FROM global_news_events"), /immutable/);
  assert.throws(() => journal.registerSource({ sourceKey: "test-v1", provider: "Other", publisher: "Benzinga", sourceTier: "LICENSED_WIRE", version: "1" }), /conflict/);
  journal.close();
});
