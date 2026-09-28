import assert from "node:assert/strict";
import test from "node:test";
import { GlobalNewsJournal } from "./global_news_journal.mjs";
import { captureNewsShadowSignals } from "./news_shadow_capture.mjs";
import { measureNewsShadowOutcomes, summarizeNewsShadowOutcomes } from "./news_shadow_outcomes.mjs";

test("measures fixed directional horizons once with explicit costs and provenance", async () => {
  const now = Date.parse("2026-09-25T14:40:00Z"), journal = new GlobalNewsJournal(":memory:", { clock: () => now });
  journal.append({ provider: "Alpaca", publisher: "Benzinga", sourceTier: "LICENSED_WIRE", sourceRecordId: "1",
    headline: "Analyst upgrades TEST after earnings beat", url: "https://www.benzinga.com/news/1", publishedAt: "2026-09-25T14:00:00Z",
    updatedAt: "2026-09-25T14:00:00Z", originalLanguage: "en", symbols: ["TEST"], verificationState: "DISCOVERED" });
  captureNewsShadowSignals(journal, { clock: () => now });
  const bars = { bars: { TEST: [{ t: "2026-09-25T14:00:00Z", o: 100, c: 100 }, { t: "2026-09-25T14:05:00Z", o: 101, c: 102 }, { t: "2026-09-25T14:30:00Z", o: 102, c: 110 }] } };
  const fetchImpl = async () => new Response(JSON.stringify(bars), { status: 200 });
  const options = { fetchImpl, clock: () => now, credentials: () => ({ key: "k", secret: "s" }) };
  const result = await measureNewsShadowOutcomes(journal, options);
  assert.equal(result.created, 4);
  const outcomes = journal.listShadowOutcomes(); assert.equal(outcomes.length, 4);
  assert.ok(Math.abs(outcomes.find(item => item.category === "ANALYST_ACTION" && item.horizonMinutes === 5).afterCostReturnPercent - 1.8) < 1e-9);
  assert.equal(summarizeNewsShadowOutcomes(outcomes)["ANALYST_ACTION:POSITIVE:30m"].count, 1);
  assert.equal((await measureNewsShadowOutcomes(journal, options)).created, 0);
  journal.close();
});
