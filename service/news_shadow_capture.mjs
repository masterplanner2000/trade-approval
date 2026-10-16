import { classifyStockCatalysts } from "./stock_catalyst.mjs";

export function captureNewsShadowSignals(journal, { clock = () => Date.now(), lookbackHours = 24 } = {}) {
  const capturedAt = new Date(clock()).toISOString();
  const since = new Date(clock() - lookbackHours * 60 * 60 * 1000).toISOString();
  const events = journal.listRecent({ since, limit: 500 });
  let eligibleEvents = 0, created = 0;
  for (const event of events) {
    if (!event.symbols?.length) continue;
    let eventEligible = false;
    for (const symbol of event.symbols) {
      const article = { id: event.sourceRecordId, headline: event.headline, source: event.publisher, url: event.url,
        symbols: event.symbols, publishedAt: event.publishedAt, updatedAt: event.updatedAt };
      const result = classifyStockCatalysts({ symbol, articles: [article] }, clock());
      for (const catalyst of result.catalysts) {
        eventEligible = true;
        if (journal.appendShadowSignal(event, catalyst, capturedAt).created) created++;
      }
    }
    if (eventEligible) eligibleEvents++;
  }
  return { capturedAt, observedEvents: events.length, eligibleEvents, created,
    researchOnly: true, rankingAdjustmentAllowed: false, orderSubmissionAllowed: false };
}
