# Global News and Event Intelligence Plan

Status date: 2026-09-24

Scope: worldwide, multilingual news and event context for research and shadow ranking

Current authority: research only. This work may not create a trade, change a position size, bypass a risk gate, or authorize an order.

## Current state

The application currently has three narrow inputs:

1. Alpaca's Benzinga endpoint supplies symbol-specific U.S. equity headlines. It is one publisher feed, headline-only, and explicitly partial.
2. SEC EDGAR supplies U.S. company filing research.
3. Federal Reserve and BLS adapters identify a small set of official U.S. macro publications.

The headline classifier recognizes eight catalyst categories, but its output is unverified, research-only context. It does not affect scan eligibility, ranking, sizing, recommendation cards, automatic exits, or submission. There is no global discovery feed, multilingual entity resolution, primary-source confirmation workflow, supply-chain/geographic exposure graph, or adequately sized forward outcome history.

## Target flow

`Sources -> immutable raw metadata -> normalization -> event clustering -> verification -> entity/exposure mapping -> market-reaction confirmation -> shadow rank -> outcome journal -> promotion review`

Every stage preserves the original publication time, first-seen time, update/correction time, source, language, region, provider rights, and the exact rules/model versions used. Missing or conflicting evidence remains visible and fails closed.

## Source strategy

## Frequency lanes

Source frequency and authority are separate. Run several lanes rather than forcing every source through one polling interval:

| Lane | Target latency | Sources | Intended use |
|---|---:|---|---|
| Fast market-moving | Seconds | Alpaca/Benzinga news WebSocket if currently entitled; later Reuters/LSEG or Dow Jones machine-readable news | Earnings/guidance, analyst actions, offerings, M&A, contracts and breaking company news |
| Market safety | 1 minute | Nasdaq Trader halt/pause RSS plus broker halt evidence | Immediately prevent a stale or halted security from becoming actionable |
| Regulatory filing | 1–3 minutes typical | SEC Latest Filings/RSS/submissions data; later equivalent national filing systems | 8-K/6-K, offerings, insider/ownership changes and material company disclosures |
| Scheduled event | Exact release time | Central banks, statistical agencies, economic calendar/consensus provider | CPI, employment, rates, energy inventories and other pre-registered releases |
| Primary event | 1–5 minutes where offered | Company IR, exchanges, FDA/health regulators, sanctions, recalls, energy/weather/shipping authorities | Verify facts first reported by a wire or discovery source |
| Global discovery | Approximately 15 minutes | GDELT and selected local-language sources | Regional themes, geopolitical developments, supply-chain disruptions and emerging narratives |
| Slow thematic | Hourly/daily | Filings, transcripts, official datasets and sector research | Maintain the exposure graph and longer-horizon context |

The server should maintain a durable cursor and health state per source. Streaming reconnects must resume from a known ID or backfill window, deduplicate overlap, and expose any gap. Pollers use jitter, conditional requests, provider rate limits and a single active lease. The mobile app receives durable event-state changes; it never polls every upstream source itself.

Do not add social-media streams to the first release. They are fast but easy to manipulate, difficult to license and hard to map reliably. Revisit them only as a separately labeled discovery input after the verified-news pipeline has measurable precision.

### Tier 1 — authoritative primary sources

Use these to verify facts, not necessarily to discover them first:

- Company investor-relations releases and exchange announcements.
- SEC EDGAR and equivalent national filing systems.
- Central banks, finance ministries, statistical agencies, energy/agriculture agencies, competition authorities, health regulators, and sanctions authorities.
- Official emergency, weather, shipping, aviation, power-grid, and commodity reports where a reviewed market exposure exists.

Initial geographic scope: United States, Canada, United Kingdom, euro area, Japan, China, Australia, and major commodity-producing regions. Add jurisdictions only after a source owner, parser, timestamp semantics, correction behavior, and data rights are documented.

### Tier 2 — licensed financial news wire

Select one commercial, machine-readable global provider for reliable breaking-news coverage and timestamps. Evaluate Reuters/LSEG and Dow Jones/Factiva first; retain Benzinga through Alpaca for U.S. stock context. Compare coverage, latency, company identifiers, relevance/novelty metadata, corrections, archive access, API limits, storage, redistribution, and cost. No purchase is authorized by this plan.

### Tier 3 — broad multilingual discovery

Evaluate GDELT as a discovery and corroboration feed. It offers broad global and multilingual coverage with approximately 15-minute dataset updates, but it is not authoritative financial verification and must never alone drive a recommendation. Use it to surface local events, regional themes, and emerging clusters that Tier 1 or Tier 2 can verify.

### Tier 4 — economic calendar and consensus

Official agencies provide actual releases; a separately licensed calendar/consensus provider is required to calculate a surprise relative to what the market expected. Evaluate LSEG, Bloomberg, Trading Economics, or Econoday under an explicit rights and point-in-time-history review. A later-revised consensus must not overwrite the value known before release.

### Tier 5 — market confirmation

News is context, not direction. Confirm a potential event with fresh price, spread, relative volume, volatility, sector/ETF behavior, and halt status from an approved market-data source. A headline cannot overcome liquidity, freshness, risk, protection, portfolio, or broker gates.

## Event model

Normalize all sources to one versioned event record:

- Stable event and source-record IDs; provider and source tier.
- Published, first-seen, updated, corrected, and ingested timestamps.
- Original language, normalized language, country and affected regions.
- Event type, entities, instruments, sectors, commodities, currencies, and supply-chain nodes.
- Direct versus inferred exposure, direction hypothesis, horizon, confidence, and supporting evidence.
- Verification state: `DISCOVERED`, `CORROBORATED`, `PRIMARY_VERIFIED`, `CONFLICTED`, `CORRECTED`, or `RETRACTED`.
- Novelty and duplicate-cluster identity.
- Data quality, latency, completeness, licensing/retention class, and immutable content digest.
- Research, ranking, and execution authority flags, all defaulting to false.

Do not store or redistribute full article text unless the provider agreement explicitly permits it. Metadata, permitted snippets, hashes, identifiers, and links are the default.

## Exposure graph

News becomes useful only when the system can explain why an event matters to a security. Build a reviewed, versioned graph covering:

- Company, parent/subsidiary, competitors, customers, and suppliers.
- Revenue and operating exposure by country.
- Commodity, currency, rate, policy, weather, infrastructure, and geopolitical sensitivities.
- Sector and thematic baskets, with liquid ETF proxies when individual-company evidence is weak.
- Effective dates, primary evidence, direction, strength, horizon, reviewer, and known limitations.

Generated narratives may propose a relationship but cannot activate one. Activation requires source evidence and review. An indirect mapping receives a lower confidence ceiling than a direct company announcement or filing.

## Sequential delivery

### Phase 1 — contracts and source registry

- Freeze the normalized event contract and provider adapter interface.
- Add a source registry containing geography, language, tier, authentication, timestamps, corrections, latency, rights, retention, and health.
- Extend the append-only journal to preserve discovered, corrected, conflicted, and retracted records.
- Add fixture tests for future timestamps, duplicates, corrections, retractions, wrong entities, malformed translations, outages, rate limits, and secret leakage.

**Exit gate:** deterministic replay produces the same event clusters and no source ambiguity is hidden.

**Progress (2026-09-25):** Implemented `global-news-event-v1`, an immutable SQLite event journal, versioned source registry, operational health, idempotent source-record deduplication and research/ranking/order authority defaults. The all-symbol Alpaca/Benzinga collector now performs a paginated 24-hour REST recovery before opening its authenticated WebSocket, reconnects with bounded backoff, and runs under a user LaunchAgent with local logs and restart supervision. Live market-hours capture has persisted hundreds of real records. A timestamp-normalization duplicate discovered during the first live run was fixed; the original journal is retained in an ignored audit archive and the active journal was cleanly rebuilt.

### Phase 2 — global discovery pilot

- Add GDELT metadata ingestion for a bounded topic/entity watchlist.
- Add official-source adapters for the initial regions and event categories.
- Poll or stream server-side; never put provider credentials in Expo or the browser.
- Show ingestion health, source latency, geographic coverage, and gaps.

**Exit gate:** seven consecutive days of stable capture with measured completeness and no effect on recommendations.

**Progress (2026-09-25):** Added one-minute official Nasdaq Trader halt polling and SEC EDGAR current-filing polling for important forms. Both are stored through the same event contract with `MARKET_SAFETY` or `PRIMARY` provenance. GDELT remains outside the active collector because the public endpoint returned rate limiting during implementation; commercial wire and global-discovery coverage are still provider decisions, not silently substituted.

### Phase 3 — verification and clustering

- Deduplicate syndicated articles into a single event cluster.
- Corroborate across independent sources and prefer primary documents.
- Preserve disagreement, corrections, and retractions.
- Add machine translation only as a labeled derived field; preserve original text metadata and language.

**Exit gate:** a reviewed sample meets predeclared precision for entity linking, event type, time ordering, duplicate clustering, and verification state.

### Phase 4 — exposure mapping

- Build the initial reviewed graph for the actual trading universe, starting with rates, inflation, energy, semiconductors/AI infrastructure, water/power demand, defense, shipping, and critical materials.
- Produce a clear explanation chain: `event -> economic channel -> exposed company/basket -> confirming market behavior`.
- Expire or revise mappings when business exposure changes.

**Exit gate:** every shadow event-to-symbol link is reproducible and source-supported.

### Phase 5 — shadow event scoring

- Score freshness, novelty, source quality, verification, directness, surprise, breadth, and confirming price/volume behavior.
- Keep positive and negative hypotheses symmetric; include `AVOID_OR_EXIT` observations.
- Cap any shadow adjustment so it cannot rescue a candidate that fails hard controls.
- Record no-trade events and rejected hypotheses.

**Exit gate:** baseline and news-adjusted ranks are compared on identical point-in-time inputs with zero execution authority.

**Progress (2026-09-25):** Stored symbol events now pass through the existing deterministic catalyst classifier into immutable, research-only shadow signals. A separate outcome worker records signed 5- and 30-minute returns from Alpaca IEX minute bars with an explicit 20-basis-point round-trip cost assumption. These observations cannot affect eligibility, ranking, sizing, exits or orders. The app exposes collector health, recent events, signal count and measured-outcome summaries in a News Monitor screen.

### Phase 6 — forward evaluation

- Measure 5-minute, 30-minute, close, 1-day, 5-day, and strategy-horizon outcomes after spread and estimated slippage.
- Compare against the same symbol, sector, market, volatility regime, and no-news controls.
- Report event-class sample size, hit rate, average/median excess return, drawdown, tail loss, latency, false-positive rate, corrections, and provider outages.
- Use chronological walk-forward evaluation; never backfill a missed capture as contemporaneous evidence.

**Initial gate:** at least 30 eligible events per event class and adequate matched controls before drawing a class-level conclusion. A broader production decision needs more evidence and stability across regimes.

### Phase 7 — product integration and promotion review

- Add an optional card section: verified catalyst, affected channel, source/time, market confirmation, counter-evidence, and uncertainty.
- Notify only for new actionable decisions or material changes, not every headline.
- Require an explicit promotion record, rights/security review, reproducible results, monitoring, rollback, and unchanged broker/risk gates.
- Start with bounded ranking influence. Automatic trading from news remains a separate, later decision.

## Recommended first implementation slice

1. Verify whether the current Alpaca credentials include the real-time news stream and record its actual publisher coverage, latency and reconnect behavior.
2. Implement the source registry, provider-neutral event contract and durable per-source cursors.
3. Replace on-demand-only news retrieval with a server-side continuous Benzinga collector while keeping the existing read API and research-only boundary.
4. Add the one-minute Nasdaq halt feed and near-real-time SEC filing monitor as authoritative fast inputs.
5. Add GDELT as research-only global discovery for a bounded watchlist.
6. Add primary-source verification for the top three themes: AI infrastructure/power/water, energy/commodities, and geopolitical/shipping disruption.
7. Capture two weeks of immutable shadow evidence before changing any ranking.
8. In parallel, request pricing and rights details from one institutional global wire and one point-in-time economic consensus provider.

This slice tests whether broader discovery adds timely, correctly mapped events before the project incurs a large commercial data expense.

## Measures of success

- Coverage by geography, language, event class, source tier, and trading-universe symbol.
- Detection and verification latency, uptime, correction/retraction handling, and duplicate rate.
- Entity-link and event-class precision from reviewed samples.
- Percentage of events with a defensible exposure path and market confirmation.
- Forward after-cost excess returns and drawdowns versus baseline and matched controls.
- Operational cost per useful verified event.
- Zero instances where an unverified source directly creates or submits an order.

## Unresolved decisions

- Commercial wire and economic-consensus provider.
- Required latency: approximately 15-minute thematic discovery versus seconds-level breaking news.
- Initial countries, languages, asset classes, and event categories.
- Licensed storage, training, display, and redistribution rights for an eventual multi-user product.
- Whether news may ultimately reorder candidates only, create candidates, trigger exits, or remain explanation context.
