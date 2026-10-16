import assert from "node:assert/strict";
import test from "node:test";
import { GlobalNewsJournal } from "./global_news_journal.mjs";
import { captureNewsShadowSignals } from "./news_shadow_capture.mjs";

test("captures matched catalysts once with no ranking or order authority", () => {
  const now = Date.parse("2026-09-25T14:00:00Z");
  const journal = new GlobalNewsJournal(":memory:", { clock: () => now });
  journal.append({ provider: "Alpaca", publisher: "Benzinga", sourceTier: "LICENSED_WIRE", sourceRecordId: "1",
    headline: "FDA approves TEST drug after successful phase 3 trial", url: "https://www.benzinga.com/news/1",
    publishedAt: "2026-09-25T13:59:00Z", updatedAt: "2026-09-25T13:59:00Z", originalLanguage: "en", symbols: ["TEST"], verificationState: "DISCOVERED" });
  const first = captureNewsShadowSignals(journal, { clock: () => now });
  const second = captureNewsShadowSignals(journal, { clock: () => now });
  assert.equal(first.eligibleEvents, 1); assert.equal(first.created, 1); assert.equal(second.created, 0);
  const signal = journal.listShadowSignals()[0];
  assert.equal(signal.category, "FDA_CLINICAL"); assert.equal(signal.orderSubmissionAllowed, false); assert.equal(signal.rankingAdjustmentAllowed, false);
  journal.close();
});
