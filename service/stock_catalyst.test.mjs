import test from "node:test";
import assert from "node:assert/strict";
import { classifyStockCatalysts } from "./stock_catalyst.mjs";

const now = Date.parse("2026-09-21T14:00:00Z");
const article = (id, headline, publishedAt = "2026-09-21T13:00:00Z") => ({
  id: String(id), headline, source: "benzinga", url: `https://www.benzinga.com/news/${id}`,
  symbols: ["TEST"], publishedAt, updatedAt: publishedAt,
});

test("classifies multiple catalyst categories while granting no ranking or order authority", () => {
  const result = classifyStockCatalysts({ symbol: "TEST", articles: [
    article(1, "TEST raises guidance after quarterly earnings beat"),
    article(2, "FDA approves TEST clinical trial application"),
    article(3, "TEST announces registered direct offering with warrants"),
  ] }, now);
  assert.deepEqual(result.catalysts.map(item => item.category), ["EARNINGS_GUIDANCE", "FDA_CLINICAL", "FINANCING_DILUTION"]);
  assert.equal(result.catalysts[0].direction, "POSITIVE");
  assert.equal(result.catalysts[2].direction, "NEGATIVE");
  assert.equal(result.rankingAdjustmentAllowed, false);
  assert.equal(result.orderSubmissionAllowed, false);
  assert.ok(result.catalysts.every(item => item.verificationStatus === "UNVERIFIED_HEADLINE_ONLY"));
});

test("marks repeated themes and keeps confidence bounded for headline-only evidence", () => {
  const result = classifyStockCatalysts({ symbol: "TEST", articles: [
    article(1, "Analyst upgrades TEST price target"),
    article(2, "Another analyst reiterates price target"),
  ] }, now);
  assert.equal(result.catalysts[0].novelty, "NEW_CATEGORY_IN_WINDOW");
  assert.equal(result.catalysts[1].novelty, "REPEATED_THEME");
  assert.ok(result.catalysts.every(item => item.classificationConfidence <= 0.75));
  assert.ok(result.catalysts.every(item => item.predictiveConfidence === null));
});

test("ignores future evidence and does not invent catalysts from unmatched headlines", () => {
  const result = classifyStockCatalysts({ symbol: "TEST", articles: [
    article(1, "TEST announces routine corporate update"),
    article(2, "TEST raises guidance", "2026-09-22T13:00:00Z"),
  ] }, now);
  assert.equal(result.catalystCount, 0);
});
