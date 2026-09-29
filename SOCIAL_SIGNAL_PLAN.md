# Social Video and Market Commentary Research Plan

Status date: 2026-09-29

Scope: authorized Instagram video transcription and X account monitoring as a research-only discovery lane.

Current authority: none. Social content may not create a recommendation, change size, trigger a sale, bypass a market/risk/broker gate, or submit an order.

## Product hypothesis

Selected trading creators and fast market-news accounts may expose a theme, catalyst, ticker, or change in crowd attention earlier than the current completed-bar strategy. They may also be late, promotional, coordinated, wrong, or simply narrating a move that already occurred. The system must measure those possibilities independently.

The purpose of this lane is therefore not to copy trades. It is to create timestamped hypotheses that can be joined to contemporaneous price, spread, volume, volatility, sector and portfolio evidence and evaluated prospectively.

## Collection boundary

Do not build a browser bot that logs into Instagram, bypasses controls, or downloads arbitrary Reels. Meta's official API is limited, and general automated collection requires authorization. Use these acquisition paths in order:

1. **Official platform APIs:** Instagram professional-account media that the API and granted permissions actually expose; X Recent Search or Filtered Stream for approved account IDs and query rules.
2. **Creator-authorized delivery:** ask selected creators to connect a professional account, provide an RSS/webhook/export, upload original videos, or license a feed.
3. **Licensed social-listening provider:** evaluate only after its terms explicitly allow the intended analysis, storage and commercial use.
4. **Manual research inbox:** a user shares a permitted post or locally held video into the app for one-off transcription. This is not automated scraping and grants no redistribution right.

Private accounts, direct messages, disappearing content, access-control circumvention and credential sharing are out of scope. Store platform content only for the permitted retention period and process deletion/correction events.

## Architecture

`Source registry -> platform adapters -> immutable envelope -> authorized media worker -> transcription -> claim extraction -> entity resolution -> event clustering -> verification -> market confirmation -> shadow score -> outcome journal`

### 1. Source registry

Maintain a reviewed record for every account:

- Platform account ID, handle, canonical URL and account type.
- Acquisition method, permission basis, scopes and content-retention rules.
- Categories covered: breaking news, macro, sector, individual equities, technical commentary or promotion.
- First-seen date and reliability calibration version.
- Known conflicts, sponsorship/disclosure behavior and impersonation status.
- Enabled state and an emergency kill switch.

Handles are mutable; platform account IDs are identities. No new account enters the live collector merely because an AI model suggests it.

### 2. Platform adapters

**X adapter**

- Use the official API to follow exact author IDs plus narrowly defined market queries.
- Prefer Filtered Stream for low-latency capture and Recent Search for bounded recovery.
- Record post ID, author ID, creation/edit time, first-seen time, referenced posts, links, cashtags, language and permitted engagement metadata.
- Keep durable cursors, deduplicate reconnect overlap, expose gaps and honor deletion/compliance events.

**Instagram adapter**

- Ingest only media exposed through an approved API scope or delivered by an authorized creator/user.
- Record media ID, owner ID, caption, permalink, publish/update time, media type, duration, authorization class and content digest.
- Treat inaccessible audio/video as unavailable; do not fall back to scraping.

### 3. Media and transcription worker

- Queue only authorized media and verify MIME type, size and duration before processing.
- Download into encrypted temporary storage, extract an audio-only derivative and calculate a content hash.
- Transcribe with timestamps and language identification. Preserve uncertainty and never silently “correct” tickers or numbers.
- Run a second pass for finance vocabulary, cashtags, company names, percentages, price levels and time horizons while retaining the original transcript.
- Delete temporary media after processing unless the rights record explicitly permits retention. Store the transcript only when permitted; otherwise store derived claims and a digest.
- Make retries idempotent by `platform + media_id + content_version + transcript_model_version`.

### 4. Claim extraction

Normalize a post or transcript into explicit, reviewable claims:

- Mentioned symbol/entity and exact supporting excerpt/timestamp.
- Claim type: factual report, opinion, prediction, technical setup, rumor, promotion or retrospective commentary.
- Direction: bullish, bearish, mixed or neutral.
- Stated horizon, entry/target/stop levels and whether each was explicit or inferred.
- Event/theme, affected sector and exposure path.
- Source time, first-seen time and observed market state at that moment.
- Extraction confidence and unresolved ambiguity.

An LLM may extract candidate claims but cannot establish truth. Ambiguous symbols, missing time references and unsupported inferred positions remain unresolved.

### 5. Verification and clustering

- Cluster reposts, quote-posts and videos discussing the same underlying event so repetition is not mistaken for independent confirmation.
- Separate the original reporter from amplifiers.
- Verify factual claims against company filings, investor relations, regulators, exchanges, official macro releases or licensed news.
- Label states `DISCOVERED`, `INDEPENDENTLY_CORROBORATED`, `PRIMARY_VERIFIED`, `CONFLICTED`, `CORRECTED` or `RETRACTED`.
- Detect sponsorship, affiliate language, pump-like coordination, sudden account creation/renaming and synchronized low-diversity posts as risk features.

## How it enters the recommendation engine

### Stage A — discovery only

Social events add symbols/themes to the intraday research universe. They do not make a symbol eligible. The normal tradability, halt, fresh quote, spread, liquidity, volatility, risk, position, protection and broker checks still decide whether the engine can act.

### Stage B — shadow features

For every as-known observation calculate:

- Account reliability based only on outcomes available before that observation.
- Independent-source breadth, excluding repost clusters.
- Mention velocity relative to the account/symbol baseline.
- Novelty and time since the originating claim.
- Verification strength and directness of the symbol exposure.
- Price/volume/volatility confirmation after publication.
- Whether the move was already extended before ingestion.
- Manipulation, ambiguity, correction and stale-content penalties.

Store these beside the existing baseline rank without changing it. Measure 5-minute, 30-minute, close, 1-day and strategy-horizon returns after realistic spread/slippage, including maximum favorable and adverse excursion.

### Stage C — bounded ranking experiment

Only after prospective evidence passes a predeclared gate may a social factor reorder candidates that already pass every hard gate. Start with a maximum adjustment of **plus or minus three points**, smaller than the existing macro experiment's five-point cap. It must never:

- Rescue an ineligible or illiquid stock.
- Turn rumor into a factual catalyst.
- Increase size or loosen a stop.
- Trigger an automatic buy or sell.
- Use engagement volume as a substitute for independent evidence.

Positive evidence can modestly improve rank when the event is timely and price/volume confirm it. Conflicted, promotional or rapidly deteriorating evidence can lower rank or mark a candidate `WATCH/AVOID`; it cannot independently liquidate a holding.

### Stage D — promotion review

Require chronological forward results, matched no-social controls, stable data rights, account-level concentration limits, operational monitoring and an explicit release decision. Evaluate by source class and claim class—not one pooled hit rate. A useful breaking-news account and a poor stock-picking influencer should not share a reliability score.

## Data model

Use the existing global event journal with a social extension rather than a parallel recommendation database:

- `social_source`: reviewed account, rights and reliability version.
- `social_record`: immutable platform metadata and lifecycle state.
- `media_artifact`: authorization, hashes, transient-storage status and transcription provenance.
- `transcript_segment`: timestamped text, language and confidence where retention is permitted.
- `social_claim`: entity, direction, horizon, evidence span and claim type.
- `event_cluster_link`: original versus amplifier and verification state.
- `social_market_observation`: exact contemporaneous price/volume/spread state.
- `social_outcome`: fixed-horizon forward outcomes and costs.

Corrections create a new version; they never rewrite what the engine knew at the original decision time.

## Sequential delivery

### Phase 1 — two-account feasibility pilot

- Choose one X market-news account and one creator who can authorize Instagram media access.
- Document access, storage and commercial-use rights.
- Implement the source registry and immutable raw envelope.
- Manually review 20 records for timestamp and identity accuracy.

Exit gate: collection is compliant, repeatable and does not miss or fabricate lifecycle state.

### Phase 2 — transcription and claim accuracy

- Process 25–50 authorized videos.
- Measure word/ticker/number accuracy and claim-extraction precision against human review.
- Reject rather than guess when audio, symbol or level is ambiguous.

Exit gate: predeclared precision targets pass, and temporary media deletion is proven.

### Phase 3 — research-only live capture

- Monitor a bounded list, initially no more than 10 X accounts and 3 authorized Instagram sources.
- Join observations to the existing intraday journal and market context.
- Keep the active recommendation queue unchanged.

Exit gate: four consecutive weeks of complete capture with visible outages and compliance handling.

### Phase 4 — outcome evaluation

- Compare each claim class with matched symbol/sector/volatility/time-of-day controls.
- Report latency, hit rate, after-cost excess return, drawdown, false positives and how often content arrived after the move.
- Require at least 30 independent eligible events per claim class and multiple distinct market sessions before drawing a conclusion.

Exit gate: a frozen analysis recommends reject, continue collecting or begin a bounded shadow-rank experiment.

### Phase 5 — optional bounded rank test

- Apply the capped social adjustment to a shadow ranking only.
- Compare identical baseline and social-adjusted inputs prospectively.
- Roll back automatically on feed gaps, abnormal failure rate or performance degradation.

No Paper or live trading authority is granted by completing this plan.

## Recommended first step

Create the reviewed source registry and select the first five X accounts plus one Instagram creator for whom an authorized acquisition path is realistic. Before writing an Instagram collector, verify each account's type and whether the creator will connect or deliver content. In parallel, price the X API tier needed for exact-author monitoring and bounded recovery.

## Initial implementation and hosting sequence

### Slice 1 — local contract and fixtures (approximately 3–5 focused development days)

- Implement the reviewed source-registry schema and provider-neutral `social_record_v1` envelope.
- Add fixture-only X, Instagram-authorized-media and manual-upload adapters.
- Add immutable SQLite persistence, cursor state, lifecycle versions and deterministic replay.
- Add a local file-to-audio-to-transcript worker with idempotent hashes and retention cleanup.
- Add claim extraction as a versioned derived record with no recommendation authority.

This slice makes no paid platform request and can be completed against fixtures plus a small set of explicitly supplied media.

### Slice 2 — paid X pilot and authorized Instagram input (approximately 1–2 weeks)

- Connect five exact X author IDs using Recent Search for recovery and the appropriate stream endpoint for new records.
- Add spending and record-count caps before enabling the API.
- Connect one authorized Instagram source or a manual share-to-research inbox.
- Human-review the first 20 posts and 25–50 transcripts.
- Join each accepted claim to the existing global event and intraday journals.

### Slice 3 — AWS shadow collector (start when uninterrupted capture matters)

- EventBridge schedules recovery and health checks.
- A small ECS Fargate task maintains any long-running stream connection; short polling and transformation jobs use Lambda.
- SQS separates collection, transcription and claim extraction.
- S3 stores encrypted temporary media with a one-day lifecycle deletion rule and durable permitted artifacts only.
- DynamoDB stores cursors, source registry and idempotency keys; immutable event records are exported to versioned S3. Reconsider PostgreSQL only when relational review/query needs justify it.
- Secrets Manager/KMS hold platform and transcription credentials; CloudWatch provides alarms, latency and spend metrics.
- The cloud output remains research evidence. The Mac service consumes signed/versioned observations and retains all portfolio, IBKR validation and execution authority.

Do not move IB Gateway credentials or unattended order execution to AWS in this phase.

## Cost envelope as of 2026-09-29

All provider prices are volatile and must be rechecked before activation.

| Scale | X reads | Transcription | AWS | Approximate monthly total |
|---|---:|---:|---:|---:|
| Local feasibility: 5 accounts, roughly 3,000 posts/month | about $15 | under $1 for a few hundred minutes | $0 | about $15–$30 |
| Small AWS shadow pilot: 10 accounts, 10,000–25,000 posts/month | about $50–$125 | about $1–$10 | about $10–$40 | about $60–$175 |
| Broader research: 50 accounts plus bounded queries, 50,000–150,000 posts/month | about $250–$750 | about $5–$30 | about $40–$150 | about $300–$930 |

The X estimate uses the published $0.005 per Post read. Deduplicate global account reads before personalizing results; reading the same post separately for every eventual user would destroy the economics. The transcription estimate uses `gpt-4o-mini-transcribe` at approximately $0.003 per audio minute. Text claim extraction, data transfer, alarms and backups add a smaller variable amount at pilot scale.

Set hard monthly budgets in X and AWS before enabling production credentials. Stop collection rather than silently exceeding the cap.

## AWS migration trigger

Begin the narrow AWS collector when all of these are true:

1. At least one official/authorized source path works end to end.
2. The event contract, idempotency and deletion lifecycle pass locally.
3. Missing overnight or away-from-home collection would damage the forward study.
4. Monthly API and AWS budgets are approved and alarmed.

Do not migrate the full recommendation engine merely because the collector moves. Consider the engine/API/mobile backend after four weeks of complete cloud capture, and consider multi-user production infrastructure only after predictive value, brokerage architecture, data rights, security and regulatory review have separate passing decisions.
