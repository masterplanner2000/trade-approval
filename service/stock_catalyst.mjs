import { createHash } from "node:crypto";

const RULESET_VERSION = "headline-catalyst-research-v1";
const MAX_HEADLINE_CONFIDENCE = 0.75;

const RULES = [
  { category: "EARNINGS_GUIDANCE", pattern: /\b(earnings|quarterly results?|financial results?|revenue|eps|guidance|outlook|forecast)\b/i },
  { category: "FDA_CLINICAL", pattern: /\b(fda|clinical trial|phase (?:1|2|3|i|ii|iii)\b|topline|primary endpoint|drug approval|biologics license)\b/i },
  { category: "FINANCING_DILUTION", pattern: /\b(public offering|registered direct|at-the-market|\batm\b|shelf registration|convertible notes?|warrants?|private placement|share issuance)\b/i },
  { category: "MERGER_ACQUISITION", pattern: /\b(acquisition|acquire[sd]?|merger|takeover|strategic alternatives?|buyout)\b/i },
  { category: "CONTRACT_PARTNERSHIP", pattern: /\b(contract|purchase order|awarded?|partnership|collaboration|customer agreement|supply agreement)\b/i },
  { category: "REGULATORY_LEGAL", pattern: /\b(sec|doj|ftc|regulator|regulatory|investigation|subpoena|lawsuit|litigation|antitrust)\b/i },
  { category: "ANALYST_ACTION", pattern: /\b(upgrade[sd]?|downgrade[sd]?|price target|initiates? coverage|reiterate[sd]?)\b/i },
  { category: "MACRO_INDUSTRY_THEME", pattern: /\b(inflation|interest rates?|federal reserve|tariffs?|trade war|ai demand|artificial intelligence|data cent(?:er|re)|water demand|uranium|nuclear|commodity prices?|oil prices?)\b/i },
];

const POSITIVE = /\b(beat[sn]?|raises?|raised|increase[sd]?|growth|approval|approved|positive|successful|award(?:ed)?|wins?|upgrade[sd]?|expands?|record)\b/i;
const NEGATIVE = /\b(miss(?:es|ed)?|cuts?|lower(?:s|ed)?|decline[sd]?|rejection|rejected|fails?|failed|investigation|lawsuit|downgrade[sd]?|dilution|offering|warrants?|layoffs?|recall)\b/i;

function directionFor(headline, category) {
  const positive = POSITIVE.test(headline);
  const negative = NEGATIVE.test(headline) || category === "FINANCING_DILUTION";
  if (positive && negative) return "MIXED";
  if (positive) return "POSITIVE";
  if (negative) return "NEGATIVE";
  return "UNCLEAR";
}

function fingerprint(article, category) {
  return createHash("sha256").update(`${article.id}\n${category}\n${article.headline}`).digest("hex");
}

export function classifyStockCatalysts(news, now = Date.now()) {
  if (!news || !Array.isArray(news.articles)) throw new Error("catalyst_news_invalid");
  const symbol = String(news.symbol ?? "").toUpperCase();
  const seenCategories = new Set();
  const catalysts = [];
  for (const article of news.articles) {
    const published = Date.parse(article.publishedAt);
    if (!Number.isFinite(published) || published > now) continue;
    for (const rule of RULES) {
      if (!rule.pattern.test(article.headline)) continue;
      const direction = directionFor(article.headline, rule.category);
      const ageHours = (now - published) / 3_600_000;
      const novelty = seenCategories.has(rule.category) ? "REPEATED_THEME" : "NEW_CATEGORY_IN_WINDOW";
      seenCategories.add(rule.category);
      const specificDirection = direction !== "UNCLEAR";
      const confidence = Math.min(MAX_HEADLINE_CONFIDENCE, 0.5 + (specificDirection ? 0.1 : 0) + (ageHours <= 48 ? 0.05 : 0));
      catalysts.push({
        id: fingerprint(article, rule.category), rulesetVersion: RULESET_VERSION,
        symbol, category: rule.category, direction,
        classificationConfidence: confidence, predictiveConfidence: null,
        novelty, noveltyScope: "RETURNED_SEVEN_DAY_HEADLINE_WINDOW", freshWithin48Hours: ageHours <= 48,
        affectedSymbols: Array.isArray(article.symbols) ? article.symbols : [symbol],
        evidence: { articleId: article.id, headline: article.headline, source: article.source,
          url: article.url, publishedAt: article.publishedAt, updatedAt: article.updatedAt },
        sourceQuality: "SECONDARY_NEWS_AGGREGATOR",
        verificationStatus: "UNVERIFIED_HEADLINE_ONLY",
        researchOnly: true, rankingAdjustmentAllowed: false, orderSubmissionAllowed: false,
      });
    }
  }
  return {
    rulesetVersion: RULESET_VERSION, symbol, researchOnly: true,
    rankingAdjustmentAllowed: false, orderSubmissionAllowed: false,
    catalystCount: catalysts.length, catalysts,
    limitations: [
      "Classification uses headlines only and does not verify the underlying event.",
      "Direction is lexical context, not an expected-return forecast.",
      "No catalyst can change ranking or authorize an order.",
    ],
  };
}
