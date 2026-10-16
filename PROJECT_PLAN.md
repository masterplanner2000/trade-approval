# Trade Approval — Project Plan

**Last updated:** 2026-09-30
**Current objective:** Establish a trustworthy paper-trading and learning loop—owned positions, protection, execution state, measured selections and measured missed opportunities—before promoting strategy changes or enabling automatic exits.

## 2026-09-30 operating review

- Reconciled the live IBKR Paper account: nine strategy-owned positions, with verified protective coverage and no automatic sell submitted.
- Added app-facing execution-quality reporting for proposal-to-fill slippage, dollar slippage, and time-to-fill. Positive slippage is explicitly defined as worse for a buy.
- Added a benchmark fallback that derives the current QQQ daily return from the reconciled strategy-owned QQQ position when the separate quote request is unavailable.
- Added an explicit missing-fee count. Net performance remains unavailable for the two closed trades until a current IBKR Paper Flex CSV supplies exact commissions; missing fees are never assumed to be zero.
- Completed the safe connection-recovery drill against the deterministic Paper simulator. Disconnect, reconnect, partial fill, rejection/cancellation, duplicate callback, and lost-acknowledgement protections passed without disturbing the live Paper session.
- Current evidence remains below the frozen review gate: 7 captured sessions, 6 usable one-session outcomes, 2 usable five-session outcomes, and 0 usable ten-session outcomes. No recommendation rule is promoted from these early results.

## Gateway migration — 2026-09-28

1. **Completed:** Centralized the local IBKR Paper socket configuration and made IB Gateway on localhost port 4002 the default. Retained an explicit TWS Paper fallback on port 7497.
2. **Pending on this Mac:** Install IB Gateway, sign into Paper, enable socket clients on port 4002 and configure daily auto-restart.
3. **Acceptance test:** Obtain a complete read-only Paper reconciliation through Gateway, verify the scanner and What-If path, restart the local service, and confirm TWS is not required.
4. **Next reliability milestone:** Add connection supervision and a phone alert for lost authentication, while failing closed for new orders and preserving broker-native protection.

## Forward-test week — 2026-09-28 through 2026-10-02

The strategy, intraday rules, frozen seven-symbol research universe and news classifier remain unchanged for the full week unless a reproducible implementation or evidence-integrity defect requires repair. The objective is a clean prospective dataset, not more recommendations or midweek threshold tuning.

1. **Monday — clean-session qualification:** require the pre-open profile refresh, five-minute intraday collection, complete Paper portfolio context, news-source health and post-close evidence archive. A qualified intraday session requires at least 90% slot coverage, 95% record completeness, complete portfolio context for all evaluable records and an intersecting completed forward-outcome session.
2. **Tuesday — discovery audit:** compare observed movers with the frozen universe, preserve every pass/rejection reason and record apparent missed opportunities without changing rules from individual examples.
3. **Wednesday — outcome comparison:** review pass versus rejected 5-/30-minute after-cost outcomes, score bands, adverse/favorable excursion, news-associated versus price/volume-only observations and matched market context. Conclusions remain insufficient until the predeclared session gates pass.
4. **Thursday — recovery exercise:** verify disconnect/reconnect, stale-quote failure, service restart, news backfill, duplicate-approval protection, failed background-submission recovery and broker reconciliation without fabricating success or blindly resubmitting uncertain orders.
5. **Friday — weekly scorecard:** report collection quality, candidate dispositions, measured outcomes, news health, proposal/decision/order lifecycle, Paper P/L, protection, execution quality and cash/QQQ comparisons. Any proposed strategy change must become a frozen forward experiment rather than an immediate production edit.

**Weekend readiness, 2026-09-27:** Full QA passes (TypeScript, 123 Node tests and 224 Python tests). The news collector is running with all three active sources healthy and no reported source error; the weekday intraday capture, 8:45 a.m. profile refresh and 4:30 p.m. evidence archive are loaded with last exit code 0. TWS Paper is not accepting API connections during this check, so Monday must obtain a fresh complete reconciliation before treating Friday's recorded stop/target coverage as current broker truth.

## Current work — performance feedback loop

1. **Completed:** Added an append-only counterfactual outcome ledger alongside the original forward evidence. It measures every eligible and filtered candidate at 1, 5 and 10 sessions using next-session-open entry, horizon-close exit, explicit round-trip costs and full-path favorable/adverse excursion.
2. **Completed:** Added a cohort report that separates lane, horizon, eligibility and exact rejection reason, and labels groups below both 20 observations and 20 distinct sessions as insufficient. The report is research-only and has no recommendation or broker authority.
3. **Completed:** Added an in-place schema-v1-to-v2 migration that preserves all existing frozen runs and outcomes. Invalidated runs remain excluded and all new outcome rows remain immutable.
4. **Completed:** Added immutable nominal-cash and QQQ outcomes aligned to each run's exact next-open/horizon-close window. Reports now show cost-adjusted excess return against both benchmarks and benchmark coverage explicitly.
5. **Completed:** Added append-only application-lifecycle observations linking proposals to evidence only by exact signal date, symbol and lane. Reports now separate proposal disposition, decision, submission, broker entry, entry slippage, commission coverage and incompleteness. Historical proposals that predate valid evidence remain explicitly unlinked.
6. **Completed:** Added a broker-grounded Paper portfolio report using strategy-owned fills and completed daily marks. It reports gross realized/unrealized P/L, equity, exposure, turnover, drawdown, open positions and same-window cash/QQQ alternatives; external and Live activity are excluded.
7. **In progress, automated:** The loaded weekday 4:30 p.m. collector refreshes both universes, captures immutable evidence, attaches available outcomes and lifecycle observations, archives a canonical strategy-performance report, then logs progress toward 20 distinct usable sessions. A separate matched-proposal session gate tracks execution evidence.
8. **In progress:** Exact commission importing and exposure-matched QQQ analysis are implemented. Net performance still requires the current Flex export; the risk-adjusted statistic remains gated until 20 observed sessions exist.
9. **Promotion gate:** Do not tune a filter from one day or one small cohort. A rule change requires a frozen hypothesis, adequate forward sample, holdout evaluation, costs, drawdown and an explicit decision-log promotion.

**Priority 3 update, 2026-09-23:** The broker-grounded report now produces a reproducible daily strategy scorecard, proposal-relative execution slippage, notional-weighted slippage, and explicit fee/mark/benchmark completeness. Gross results remain visible when fees are missing, but net results and net benchmark excess remain unavailable. Exposure-matched and risk-adjusted benchmark interpretation still requires an adequate forward sample.

**Priority 4 update, 2026-09-23:** Added a cost-aware exposure-matched QQQ alternative alongside the existing fully invested benchmark. The report shows daily matched-benchmark returns and gross excess but labels risk-adjusted comparison insufficient until 20 sessions are observed. This is descriptive and cannot promote a strategy.

**Priority 5 update, 2026-09-23:** Added an append-only performance-report archive to the weekday collector. Exact reruns are idempotent; revised reports caused by later fee evidence are retained as new versions. The first current report was archived as `COMPLETE_GROSS`; it remains fee-incomplete.

**Mobile workflow update, 2026-09-24:** Confirmed approvals now leave the review deck immediately while the complete Paper validation and submission workflow runs in the background. Success is tracked through Activity and reconciliation; only a failure interrupts review and restores the card for retry. No broker safety gate was removed.

## Bookmarked workstream — authorized social signal research

Plan: `SOCIAL_SIGNAL_PLAN.md`. Monitor X through official API access and transcribe Instagram media only through official scopes, creator authorization or explicit user-provided files. Social signals remain an isolated discovery/shadow lane with no recommendation, sizing, exit or order authority. First milestone: review five X accounts and one Instagram creator, document rights and access, then implement the source registry and immutable event envelope.

## Bookmarked workstream — in-app research assistant

Plan: `IN_APP_RESEARCH_ASSISTANT_PLAN.md`. Add an evidence-grounded chatbot that explains recommendations, scanner exclusions, positions/protection and performance through narrow read-only tools. A later governed workflow may draft and activate explicitly approved shadow experiments, but the model cannot modify production strategy, code, brokerage state or orders. First milestone: implement the mobile chat surface, server conversation endpoint and five read-only evidence tools.

## Bookmarked workstream — intraday volatility recommendations

Development branch: `feature/intraday-volatility-recommendations`

Goal: originate new recommendations from market movement developing during the session rather than repeatedly presenting a queue derived from the prior completed daily bar. Start from the existing research-only intraday evaluator. First connect and validate a consolidated real-time provider, then collect immutable forward observations, measure after-cost outcomes and surface shadow-only cards. Actionable Paper cards require a later explicit promotion decision; `main` remains the stable daily-bar workflow.

**Milestone 1 complete — provider contract:** Alpaca snapshots now expose the timestamps and session fields required by the evaluator. The join refuses a wrong symbol, stale/future context, fewer than 20 volume-profile sessions, unknown halt state or unlabeled feed. Live IEX access works; live SIP access is currently denied.

**Milestone 2 complete — minute-volume baseline:** A read-only job fetches Alpaca one-minute history and builds a 390-point median cumulative-volume curve from the latest 20–30 complete prior sessions. It excludes the current day, rejects duplicate/invalid bars, requires at least 380 observed minutes plus opening/closing minutes per admitted session, retains an exact input digest and writes a git-ignored research artifact atomically. A live IEX run produced 30-session profiles for BMNR, MU, NVDA and MSFT with no failures. Next select an approved halt-status source, then schedule labeled IEX observations into the append-only shadow journal.

**Milestone 3 complete — price movement diagnostics:** Historical profiles now include the median cumulative high/low range for every regular-session minute. The as-known signal layer calculates exact 5-, 15- and 60-minute returns, previous-five-minute momentum, five-minute acceleration, volume-weighted average price and distance, range expansion, pullback from the session high, recent close location and positive-bar share. It rejects future, stale, duplicate, cross-session and insufficient histories and grants no ranking, recommendation or order authority. A live IEX diagnostic completed for BMNR, MU, NVDA and MSFT. Next combine volume and price evidence in a versioned opportunity score after halt provenance is solved.

**Milestone 4 complete — transparent opportunity score:** A versioned 100-point long-direction shadow score now itemizes relative volume (25), multi-horizon momentum (25), acceleration (10), VWAP position (10), range expansion (15) and recent path quality (15). Each component exposes its inputs, points, maximum and plain-language explanation. The score blocks on any failed upstream hard gate, wrong symbol/time, missing feed provenance or missing metric; it cannot average away freshness, halt, spread or liquidity failures. Thresholds and weights are explicitly uncalibrated research hypotheses. Live scoring was kept blocked until the independent halt source in milestone 5 was implemented.

**Milestone 5 complete — safety and quality verdict:** A fixed-host Nasdaq Trader RSS adapter now supplies fresh current-halt evidence for Nasdaq- and other exchange-listed securities, fetching once per scan and resolving exact symbols and resumption times. The safety policy separately reports market blockers and portfolio blockers across evidence identity, upstream gates, halt freshness/status, spread, liquidity, profile depth, VWAP extension, extreme range, pullback, portfolio freshness, position capacity, projected symbol/sector exposure, daily loss and buying power. Single-venue IEX can support labeled shadow research but remains an actionable-promotion blocker, as does missing forward calibration. A live check returned fresh not-halted evidence for BMNR, MU, NVDA and MSFT. Next schedule the complete pipeline into immutable shadow capture; review Nasdaq feed terms before any commercial redistribution.

**Milestone 6 complete — scheduled immutable shadow capture:** A read-only orchestrator now runs the complete profile, snapshot, halt, gate, price-signal, score and safety pipeline every five minutes during regular weekday market hours. Every symbol is recorded atomically as `PASS`, `REJECTED` or `INCOMPLETE` in an append-only SQLite run envelope; exact retries are idempotent and conflicting retries fail. Valid observations also enter the existing replay journal. The installed macOS LaunchAgent completed successfully, and the manual plus scheduled live checks each recorded four legitimate rejections with no incomplete evidence and no orders. The collector performs no network work outside market hours. Next collect forward outcomes, automate daily profile refresh and connect fresh read-only portfolio context; IEX, calibration and data-rights limits still block actionable promotion.

**Milestone 7 complete — immutable forward outcomes:** Every scheduled capture now settles earlier 5- and 30-minute windows when an exact later observation exists within a two-minute tolerance. Each append-only outcome retains the source and target record identities, original pass/reject cohort, score and safety evidence, raw last-price return and a frozen bid/ask-plus-slippage-and-fee estimate. Mature missing windows become explicit `INCOMPLETE` evidence; horizons beyond the regular-session close are excluded. Reports separate cohort completeness, average raw and after-cost return, positive rate and distinct sessions, with review blocked below 20 sessions. The first live settlement produced four complete rejected-cohort five-minute outcomes and preserved eight older missing windows as incomplete. It also exposed and corrected a per-symbol evaluation-clock error that had made sequentially fetched quotes appear fractionally future-dated. Next automate daily profile refresh and connect fresh read-only portfolio context; do not tune thresholds from this one-session sample.

**Milestone 8 complete — automatic profile refresh:** A weekday 8:45 a.m. local LaunchAgent now rebuilds the frozen intraday symbol set before the open from completed prior sessions. The job preserves the current artifact's exact symbols and feed, requires every symbol to produce matching volume/range session histories, refuses any session regression and publishes only through an atomic replacement. A provider or validation failure leaves the previous byte-exact artifact available to the five-minute collector. The installed runner completed with exit code 0, refreshed BMNR, MSFT, MU and NVDA through September 23 on IEX, and cleaned its non-overlap lock. Next connect fresh read-only portfolio context; the IEX, calibration and data-rights promotion blockers remain.

**Milestone 9 complete — read-only Paper portfolio context:** Each five-minute cycle now obtains one complete IBKR TWS Paper snapshot before evaluating symbols and projects the configured research notional against position rows, symbol concentration, a conservative sector-exposure upper bound, daily P&L and available funds. Initial live verification returned six broker position rows, fresh balances and P&L, and produced four complete `REJECTED` records with no incomplete portfolio evidence. Milestone 10 subsequently corrected repeated-row counting and replaced the conservative sector proxy. This is research context only: it cannot create recommendations or orders.

**Milestone 10 complete — reviewed exposure buckets and broker-row aggregation:** The portfolio layer now aggregates repeated TWS position rows by symbol before counting holdings or measuring concentration and resolves every held/candidate symbol through a versioned, explicitly sourced exposure registry. Unknown symbols fail closed rather than inheriting a guessed sector. Live verification correctly reduced six broker rows to four distinct holdings. BMNR passed portfolio checks at a projected 7.5% digital-asset-treasury exposure, while MSFT/NVDA remained blocked by combined technology exposure and MU remained blocked by its existing symbol/technology concentration. All four records had complete portfolio evidence. Next continue the 20-session sample and evaluate consolidated-data options; this mapping does not promote the lane or grant order authority.

**Milestone 11 complete — reproducible market-data readiness gate:** A read-only diagnostic now probes the configured Alpaca credentials separately for IEX and SIP, verifies exact feed/scope provenance and sanitizes provider failures. Live verification found IEX available as single-venue research data and SIP unavailable under the current credentials. The report permits continued shadow collection but keeps `consolidated_market_data_unavailable` as a promotion blocker and grants no recommendation or order authority. Alpaca SIP is the lowest-integration consolidated path; IBKR remains a separate execution quote authority whose API entitlement is unresolved. No subscription was purchased. Next continue the 20-session sample and decide whether to authorize a SIP plan only after current price and commercial data rights are reviewed.

**Milestone 12 complete — collection quality and qualified-session gate:** A journal-only health report now measures expected versus observed five-minute slots, complete versus incomplete symbol records and fresh Paper portfolio coverage for every session. A day counts toward the 20-session review threshold only when it is closed, meets at least 90% capture coverage, at least 95% record completeness, has complete portfolio context for all evaluable records and intersects an actual completed forward-outcome session. The September 24 bootstrapping day is explicitly degraded: 32/77 observed slots, 91.89% record completeness and 57.35% portfolio completeness, so it contributes zero qualified sessions. This prevents partial setup-day evidence from satisfying the promotion gate. Next allow the fully installed collector to begin its first clean session at the next market open.

**Milestone 13 complete — bounded forward-universe expansion:** A tracked research-universe artifact now freezes the symbols and prior completed-session selection boundary before forward collection. An atomic expansion job requires every symbol to produce valid matching volume/range profiles and preserves the previous live artifact byte-for-byte on any failure. The proposed 12-name set exposed insufficient IEX minute coverage for GME, RKLB, RMBS, SHOP and TWLO, so they were excluded rather than weakened through lower quality thresholds. The validated live set expanded from four to seven symbols: BMNR, CRWV, IONQ, MSFT, MU, NVDA and RIOT. All seven have explicit exposure mappings and complete 30-session profiles through September 23. The expansion is shadow-only and begins prospective evaluation on September 25.

## Today's test plan — 2026-09-22

1. **Before the open — evidence integrity:** implement an append-only invalidation/supersession record for immutable daily evidence. Mark the first September 21 run invalid for comparative performance, preserve its payload, and prove automated reports exclude it without deleting or rewriting history.
2. **Before the open — runtime readiness:** start the local service and TWS in **Paper**, accept any simulated-account notice, and require a complete fresh reconciliation. Confirm the UI distinguishes connection, reconciliation, quote eligibility, protection and execution readiness.
3. **After 9:30 a.m. ET — market-data retest:** request fresh read-only Paper snapshots for MRK, NVDA, DE and MSFT. Record data type, bid/ask presence and callback times. Type 3, missing or stale quotes fail closed; do not repair stops or submit price-triggered exits from them.
4. **Portfolio safety:** verify MRK and DE retain exact stop/target coverage and NVDA/MSFT remain visibly unprotected unless broker evidence changes. Exercise the protection-repair and protected-exit preflights without transmitting orders.
5. **Recommendation behavior:** run the funded queue from the corrected September 21 completed bar and the volatile research lane separately. Verify full-allocation behavior, exit-review reasons, replacement contingency and that research-only candidates cannot become orders.
6. **Application smoke test:** in Simulator and Expo Go, verify current broker status, scanning/empty states, Positions and Activity, recommendation rationale, risk/expiry presentation and failure messaging. A connected indicator must not enable decisions when another readiness gate fails.
7. **Bounded Paper execution test only if every gate passes:** use one fresh, engine-produced, user-approved proposal; run preview and IBKR What-If before a small bracket order. Do not invent a symbol or order merely to create activity. Automatic selling remains disabled.
8. **After 4:15 p.m. ET:** refresh both daily caches, verify their exact session coverage and run the 4:30 evidence capture. The job must exit successfully, preserve isolated missing bars explicitly and create no recommendation or broker authority.

**Today succeeds if:** the known-bad run is machine-excluded, Paper state is fresh and accurately represented, quote/protection blockers are explicit, recommendation lanes are correctly separated, the app reflects the same truth, and the post-close evidence job completes. Trading profit is not a one-day acceptance criterion.

**Progress, 2:03 p.m. ET:** Step 1 is complete. The evidence store now supports immutable, idempotent invalidations; status and outcome collection exclude invalidated runs. The flawed September 21 run is preserved and machine-invalidated, with September 18 restored as the latest active run. Full QA passes: 109 Node and 146 Python tests plus TypeScript typecheck. Next execute steps 2–5 during market hours.

**Progress, market-hours verification:** Steps 2–5 have been exercised without transmitting an order. TWS is logged into Paper account `DUR…217`, port 7497 is listening, the local service is running, and broker reconciliation completed successfully. Holdings remain MRK 5, NVDA 25, DE 1 and MSFT 2; ownership is complete. MRK and DE retain exact stop/target coverage, while NVDA and MSFT remain visibly unprotected. Fresh API snapshots now return bid/ask values for all four symbols, but every callback is delayed `dataType 3`, so price-sensitive protection repair, What-If and execution remain fail-closed. The funded queue produced no new buys because estimated exposure is $7,938.61 against the $5,000 sleeve; it marks MRK, NVDA and MSFT for exit review and does not recommend an ordinary loss-taking DE exit. The aggressive lane remains research-only; news is now optional context rather than a hard gate, while consolidated liquidity, current spread, sizing and fresh broker validation remain required. Next complete the app smoke test and post-close evidence capture; do not submit an order from delayed quotes or while protection is incomplete.

**Progress, application smoke test:** Step 6 passes in the iPhone 17 Simulator after switching the persisted workspace from Preview Mode to Paper. The Recommendations screen reports Paper monitoring, explicitly pauses for the protection review, shows MRK/NVDA/MSFT exit-review state and labels replacements as contingent on a confirmed sale. The Positions screen loads the reconciled four holdings, shows MRK/DE protection as verified and NVDA/MSFT protection as missing. No mock recommendation or enabled approval action is presented as live Paper state. Step 7 remains blocked by delayed quotes and incomplete protection; no order was previewed or transmitted. Step 8 remains scheduled for after the close buffer.

**Live-only diagnostic:** The ordinary snapshot helper intentionally requests delayed fallback, so `dataType 3` alone was not treated as proof of a subscription failure. A separate strict `--live-only` request for NVDA returned IBKR warning 2186: real-time API market data requires an additional subscription, and no live bid/ask callback was delivered. This independently confirms that TWS screen quotes and API execution-grade quote authority differ. Keep price-sensitive protection repair and execution blocked until the API entitlement is changed or an explicitly approved execution-grade quote source is integrated and validated.

**Post-close result:** Step 8 completed successfully. The append-only evidence job captured September 22 with 100% baseline session coverage and 99.07% shadow coverage: 17 baseline and 105 research-only shadow candidates. A fresh broker reconciliation found the same four holdings and four MRK/DE protective orders. Delayed closing quotes estimate the existing Paper sleeve gained about $47.97, or 0.59%, for the session before fees; SPY was approximately flat and QQQ gained about 0.87% on the same delayed source. This is mark-to-market movement, not realized trading profit. The completed-bar portfolio review now recommends profitable exit review for MRK, NVDA and DE, retains MSFT because ordinary rotation would realize a loss, and lists TQQQ, MRVL, SMCI, TSM and HOOD only as contingent replacements. No order was created or transmitted. The local API process had stopped after the earlier supervised session and was restored successfully; TWS Paper remained connected.

**Paper allocation decision:** Increase the Paper strategy sleeve from $5,000 to $10,000 and align the service's default Paper risk-policy sleeve. The running strategy now reports $7,938.61 deployed, no longer over-allocated, but available capital remains fail-closed because NVDA/MSFT protection is incomplete. Automatic ordinary selling is the intended workflow, not a manual-timing requirement. Activation still requires execution-grade live API quotes, exact protection for every eligible holding, and a broker-verified protection-preserving target modification lifecycle. Continue implementation and Paper fault testing; do not lift the code release hold merely by setting an environment flag.

## Market-hours verification — 2026-09-21

- Restored the local service and TWS Paper session. The first reconciliation timed out because TWS was waiting for acknowledgement of its simulated-trading warning; after acknowledgement, the API handshake and complete broker reconciliation succeeded.
- Confirmed holdings of MRK 5, NVDA 25, DE 1 and MSFT 2. MRK and DE retain exact protective stops and targets. NVDA and MSFT remain broker-attributed legacy-app holdings without active protection.
- The funded recommendation queue created no new buys because estimated strategy exposure was $7,938.61 against the $5,000 sleeve. Its completed-bar review marked MRK and NVDA for exit review and treated replacements as contingent on confirmed exit fills.
- Fresh market-hours Paper API checks returned delayed type-3 quotes for NVDA and MSFT and no usable quote for MRK or DE. Therefore protection repair, order preview and automatic exits remained blocked. No order was submitted, modified or cancelled.
- The aggressive shadow lane returned 63 September 18 research candidates. They remain non-actionable until catalyst, consolidated-liquidity, current-spread, sizing and fresh broker checks are complete.
- The weekday 4:30 p.m. evidence scheduler is loaded and its last run exited successfully. Let it capture the September 21 completed session after the configured close buffer; do not treat an intraday bar as a completed daily signal.

**Immediate next work:** ingest and verify the September 21 post-close evidence, compare funded and shadow lanes without hindsight, then resolve the market-data entitlement and implement the Paper-only protected-exit adapter. Do not enable automatic selling until both live quote eligibility and broker-observed protection-preserving order modification pass.

**Post-close correction:** The 4:30 p.m. evidence job exposed an exclusive-end-date bug and duplicate same-day filtering in the baseline evaluator. The corrected caches now cover September 21 exactly (baseline 100%; shadow 99.48%), and focused tests pass. A corrected scan yields 19 baseline and 73 shadow candidates. The initial immutable September 21 snapshot recorded zero baseline candidates and is explicitly invalid for performance comparison; preserve it as audit evidence rather than rewriting it. Future captures require at least 80% exact-session coverage and record isolated missing bars as ineligible instead of aborting the market day. Next add a durable invalidation/supersession record so automated reports can exclude known-bad immutable runs without relying only on documentation.

## Today's work order — 2026-09-18

1. **Completed:** Verify current IBKR Paper holdings and open orders read-only; establish why NVDA/MSFT lack stops from broker trade evidence and historical app code. Keep these positions visibly unprotected and new buying capacity at zero.
2. **Completed:** Reconcile explicit broker terminal-order evidence; test rejection, cancellation, uncertain transmission, partial fills and an unfilled manual order in the broker simulator. Keep the service running with automatic sells off.
3. **Simulator and local durable-intent stages complete; broker adapter not started:** A pure Paper-only ordinary-exit state machine emits one target-replacement intent and waits for broker-observed terms. A separate SQLite outbox now stores the intent, claims it once before any simulated send, and recovers by read-only broker reconciliation rather than retransmitting after an uncertain crash. Tests cover rejection, partial sale with oversized stop, stop/target race, duplicate callback, unrelated sell order, stale preflight, lost acknowledgement and process restart. The old protective stop remains active while a replacement is pending or rejected. This is not wired to an IBKR order-modification adapter or the service worker; actual broker-side sibling resize is unverified. Automatic selling remains code-disabled. The legacy-stop repair preflight remains non-submitting.
4. **Market-data diagnosis:** After the user signed the Market Data API Acknowledgement, live Client Portal says API access is enabled and Non-Professional status is set. Paper sharing remains on; only fee-waived US non-consolidated streaming quotes are listed. Fresh live-only, read-only Paper TWS API requests still returned warning 2186 after a TWS restart. IBKR TWS API support ticket #496671 was submitted September 18 to ask which exact entitlement and settings are needed. Do not purchase a package or change declarations automatically. Keep the live-quote gate closed until IBKR responds and a fresh read-only API retest succeeds.
5. **Paper protection now authorized by user:** Proceed without per-step approvals if an exact, broker-verified and risk-bounded repair can be established. No price should be invented from the old entry records. Today the live-data and stop-policy gates are not met, so NVDA/MSFT remain explicitly unprotected and no stop or sale has been sent. Never touch live trading under this authorization.
6. **Then:** Run mobile status/Activity/Positions smoke checks and compile a broker-grounded daily performance report. A tiny Paper execution smoke test requires a separate, explicit scope and account/order limits. Defer strategy promotion, live trading and any profitability claim.

## Prioritized recovery and product roadmap — 2026-09-17

This is the working sequence for the user's current concerns. A passing code test is not proof of profitable recommendations or reliable broker execution. Keep the existing paper/live separation and do not place an order merely to exercise the app.

### September 19 priority reset

1. **Broker correctness and protection (release blocker):** obtain IBKR's answer to ticket #496671, retest read-only type-1 quotes, finish protected-exit/reconciliation fault coverage, and only then run a strictly bounded Paper adapter test. Never use a live account for this work.
2. **Measurement integrity:** store complete as-known-at-the-time decisions and non-decisions, calculate fee/slippage-aware results, and compare daily and intraday hypotheses with cash and a benchmark through walk-forward and forward Paper samples.
3. **Intraday opportunity research:** build capture, persistence and replay around the new pure intraday evaluator. Validate provider timestamps, expected-volume baselines, consolidated liquidity, spreads, halts and catalysts. It remains shadow-only until explicitly promoted after evidence review.
   **Macro/event work started:** a pure versioned evaluator now requires sourced, fresh event evidence, explicit symbol exposure and price/volume/volatility/spread confirmation before emitting a research-only long or avoid/exit bias. An append-only journal persists exact source records, event revisions and market reactions. Fixed-host adapters normalize official Federal Reserve and BLS releases; a provisional Trading Economics adapter preserves consensus/revision fields and standardizes surprise only from prior same-series history. An immutable exposure registry requires reviewed, effective-dated and source-backed theme-to-symbol mappings. A fail-closed joiner assembles journal-ready observations only through reviewed exact event links, compatible timing, scored consensus, active exposure and a post-release reaction. A durable forward scheduler pre-registers baseline, release and 1/5/30-minute reaction tasks and records missed windows. A supervised worker now claims tasks once, validates normalized read-only results and sanitizes failures. Next curate real mappings/crosswalks, review provider access/licensing, implement approved read-only adapters and define operational supervision for unresolved claims.
4. **Portfolio/sizing integration:** connect authoritative broker state and policy to the pure sizing engine, stale-approval invalidation and sequential rotations.
5. **Product quality and release:** mobile automation/accessibility, notifications, operational resilience, security, data rights and legal review.

**Work started:** `service/intraday_shadow_evaluator.py` evaluates snapshots with complete rejection reasons and no network, recommendation or order authority. `service/intraday_shadow_journal.py` stores exact passing, failing and incomplete observations in an append-only SQLite timeline, deduplicates exact repeats, survives restart, records source/volume provenance and supports chronological deterministic replay without reinterpreting unknown ruleset versions. `service/intraday_shadow_replay.py` now validates and idempotently imports recorded JSONL evidence before reporting the first eligible observation per symbol/session at fixed 5-minute and 30-minute windows, last observation and favorable/adverse excursion. Missing windows stay incomplete and reference prices are never labeled fills. Tests cover the BMNR-like move, malformed imports, duplicate imports, first-signal selection, absent horizons, stale/future observations, crossed quotes, simultaneous failures and storage immutability. Next: define and verify a provider contract, then implement scheduled capture of a forward dataset only after timestamp, consolidated-volume and licensing semantics pass review.

### Macro/event research delivery plan — September 20

This sequence turns the completed research components into a trustworthy forward study. It does **not** authorize recommendation cards, Paper orders or live trading. Each stage must pass its acceptance gate before the next stage can rely on its output.

| Stage | Deliverable | Acceptance gate |
|---|---|---|
| **7. Capture-contract hardening** | Bind every market result to the requested symbol, account-independent data source and exact task window. Bind every release result to the scheduled event, pinned event-link version and exposure-map version. Add an explicit supervised resolution path for tasks left claimed after a crash. | Wrong-symbol, wrong-event, stale, future, duplicate, crash and restart fixtures all fail closed; no unresolved task can be silently retried or counted as completed evidence. |
| **8. Read-only provider adapters** | Implement approved adapters for release/consensus data and market snapshots behind the existing worker interface. Keep credentials server-only; enforce fixed hosts, timeouts, response-size limits, rate limits and explicit consolidated/single-venue volume provenance. | Recorded provider samples normalize deterministically; secrets and raw upstream errors never enter storage or client responses; provider access and retention/redistribution rights are documented. |
| **9. Reviewed initial research universe** | **In progress:** frozen source-reviewed payrolls/JPM and CPI/Home Depot hypotheses, exact official series, filing evidence, liquidity provenance and limitations. Validator prevents pending consensus identities from becoming active. **Next:** approve a consensus source, bind exact series IDs and re-review the crosswalks. | Every scheduled symbol resolves through a reviewed, active mapping and exact event crosswalk; a second review finds no inferred or unsupported relationship; versions are pinned before release. Current active-study count: zero. |
| **10. Supervised forward-capture pilot** | **Machinery implemented:** active-study/provider/worker/clock/timing preflight, gated registration, complete task/latency/audit report, canonical replay check and deterministic digest. A recorded five-task rehearsal passes. **Blocked:** Stage 9 has zero active studies, so no real event is registered. | One real event completes baseline, release and 1/5/30-minute captures, joins/evaluates/journals successfully and replays byte-canonically. Partial events remain excluded. |
| **11. Outcome and control evaluation** | Compare macro-conditioned observations with matched no-event days and the existing daily/intraday technical signals. Include spreads, estimated slippage, missed signals, adverse/favorable excursion and performance by volatility regime. Use chronological walk-forward splits only. | A reproducible report includes every scheduled observation and non-observation, separates in-sample from forward results and makes no edge claim when sample size or costs are inadequate. |
| **12. Shadow ranking experiment** | If stage 11 supports it, add a capped macro adjustment to a shadow copy of ranking. Preserve all technical liquidity, freshness, spread, portfolio and risk gates. Keep `orderSubmissionAllowed: false`. | A written comparison shows whether the adjustment improves opportunity quality and risk-adjusted forward outcomes without unacceptable drawdown or reduced data completeness. |
| **13. Promotion review** | Decide whether to reject, revise or promote the macro feature. Promotion requires a versioned policy, rollback criteria and separate approval. | No actionable recommendation or order integration occurs without an explicit decision-log entry supported by forward evidence and all broker/risk release blockers remaining satisfied. |

**Immediate work package — stage 7:**

1. Require `symbol` in every market capture and match it exactly to the claimed task.
2. Require release captures to match the plan's event key and pinned link/map versions.
3. Record a safe operator disposition for unresolved claims: `FAILED_CONFIRMED`, `COMPLETED_FROM_DURABLE_EVIDENCE` or `ABANDONED_UNKNOWN`; never reopen them as ordinary pending work.
4. Preserve an immutable audit entry containing who resolved the claim, when, why and what durable evidence was used.
5. Add fault tests for cross-symbol contamination, cross-event contamination, stale/future observations, duplicate completion, worker death and restart.
6. Rerun the complete application test suite, update architecture/QA/decision records, then commit and push the isolated change.

**Dependencies and boundaries:** Stage 8 depends on approved provider access and licensing; stage 9 depends on human-reviewed primary evidence; stage 10 depends on a future scheduled release during a supported market session. Stages 7–12 remain research-only and cannot change the current actionable recommendation engine, position management or broker execution behavior.

**Stage 7 implementation update:** Exact market-symbol, official-event and pinned link/map-version matching is implemented. Claimed tasks interrupted by process death now support one immutable supervised disposition without reopening or retrying the capture; durable-evidence completion is accepted only inside the original task window with a named source. Cross-symbol, cross-event, version mismatch, duplicate resolution, mutation and restart tests pass. The comprehensive sequential plan is maintained in `MACRO_RESEARCH_PLAN.md`; stage 8 must not start until the full regression suite and stage-7 commit are complete.

| Priority | User concern and deliverable | Acceptance gate |
|---|---|---|
| 1. Position truth and safety | Reconcile each IBKR Paper holding and share quantity against strategy entries, fills, manual/external activity, open exits and stops. Separate `strategy-owned`, `external` and `unknown`; show protection gaps and correct the trading-sleeve budget without guessing ownership. Keep automatic paper sells off. | No unknown share can be included in an automatic exit or in strategy performance; every strategy position has a verifiable protection state; the $5,000 sleeve calculation is explainable share by share. |
| 2. Reliable paper lifecycle | Test proposed buy, user approval, fresh preflight, submission, broker acknowledgement, partial/full fill, rejection, cancellation, reconnect and exit using the simulated broker first. Then run a separately authorized, tiny IBKR Paper smoke test. Make the app distinguish `connected`, `ready to submit`, `submitted`, `working`, `filled`, `blocked` and `unknown outcome`. | The broker and app agree on the final state after restart/reconnect; retries do not duplicate orders; protection gaps block further automated action and surface clearly. |
| 3. Honest performance report | Attribute fills, fees, cash and mark-to-market only to strategy-owned shares. Record every eligible, rejected, unselected, denied and expired signal with its as-known-at-the-time data; compare with a simple benchmark and cash. Show gross/net returns, drawdown, exposure, turnover and execution slippage, with missing fees/data labeled incomplete. | A daily report can be reproduced from the ledger and broker evidence; paper strategy results are separated from unrelated account activity and from market-wide price moves. |
| 4. Better opportunities, tested separately | Compare the current large-cap momentum scan with the broader, higher-volatility shadow lane. Add source-linked news/theme evidence as a separate shadow feature, including company exposure and timing, not AI-generated trade authority. Evaluate liquidity, spreads, failed signals and out-of-sample/forward paper outcomes. Allow no-trade days. | A written comparison shows whether a candidate approach improves risk-adjusted outcomes and opportunity quality without look-ahead, cherry-picking or unacceptable drawdown; only then consider promoting it to approval cards. |
| 5. Daily-use product reliability | Add durable event-driven notifications, clear idle/scanning/market-closed states, actionable Positions and Activity, mobile recovery and accessibility tests. Validate phone access over Tailscale and then a TestFlight build independent of Expo Go. | The user can understand what needs attention, approve or deny a fully specified paper trade, and confirm its broker result from the phone without leaving a misleading status onscreen. |
| 6. External-user and live readiness | Only after the paper gates: multi-user isolation, secure broker onboarding, hosting and monitoring, account recovery, market-data rights, legal review and a deliberately small live pilot. | No live or public launch until technical, operational, regulatory and data-rights gates are documented and passed. |

**Next work package:** Resolve the missing protective stops for legacy-app NVDA and MSFT holdings using current broker evidence and a defined, risk-bounded stop policy; the user authorized Paper-only repair work without repeated approvals on September 18. The current API feed is delayed type 3, so do not submit price-triggered orders until a reliable quote source and exact broker state pass the repair preflight. Separately design and fault-test a protection-preserving automatic-exit lifecycle in the broker simulator. Automatic selling remains disabled. A same-day paper profitability conclusion is not possible from the current small, incomplete sample.

**Paper repair follow-through, 2026-09-18 11:56 a.m. ET:** A fresh read-only TWS snapshot again found NVDA 25 and MSFT 2, with no sell order for either. CVX, MRK and DE retained their respective stop and target orders. The TWS Paper API timed out once and subsequently recovered without intervention; fresh NVDA and MSFT API quotes were still market-data type 3 (delayed) during market hours. Added and tested `assessProtectionRepair`, a fail-closed preflight that requires a fresh complete Paper snapshot, exact attributed stock quantity, no working sell order, same-account live bid/ask, a specified stop below bid and a nominal bid-to-stop dollar budget (not a guaranteed maximum loss). Added a broker-evidence classifier for target replacement, rejection, partial sale, disconnect, duplicate evidence and stop/target race; it does not modify any broker order. Neither is an execution adapter; no stop or sale was placed. The full suite passes: 87 Node and 22 Python tests. Next: establish live quote entitlement/availability and a defined stop policy, then verify a Paper order and broker acknowledgement before calling the position protected.

**Live-only feed diagnosis, 2026-09-18:** TWS was signed into the Paper account and accepted two separate read-only API connections. Explicit live-only quote requests for NVDA and MSFT each returned IBKR warning 2186 that real-time data requires an additional API subscription and the user has elected delayed data; neither produced a live quote. This distinguishes the feed entitlement/provisioning problem from the application's delayed-fallback request. TWS's on-platform real-time/non-consolidated banner does not establish off-platform API entitlement. The browser Client Portal session was expired, so subscription and Paper-data-sharing settings could not be inspected there. No subscription was purchased and no broker order was placed or changed.

**Client Portal entitlement inspection, 2026-09-18:** After signing into the live Client Portal for account administration, the current subscription list showed fee-waived US Real-Time Non Consolidated Streaming Quotes, but no consolidated US equity/API package. The Market Data API Acknowledgement section said API access is not certified; subscriber status and non-commercial status are unset. The linked Paper Trading Account page has “Share real-time market data subscriptions with paper trading account?” already set to **Yes** for the live username. TWS was restored to the simulated account, but a chart warned that the associated live username was also running TWS, which may compete for shared data. These are separate possible entitlement/session issues; do not claim that completing any one form will by itself provide live SMART-stock API quotes. No subscription, declaration, sharing setting, or order was changed. Next: user reviews truthful status/API terms and account eligibility with IBKR, closes a competing live brokerage session if present, then rerun the live-only Paper API diagnostic before loosening any gate.

**Post-acknowledgement retest, 2026-09-18 12:43 p.m. ET:** Live Client Portal now says Market Data API access is enabled and the acknowledgement was signed today. Market Data Subscriber Status and Non-Commercial Form are still unset; the fee-waived non-consolidated feed remains the only US equity streaming quote listed, and Paper sharing was already on. New read-only, explicitly live-only Paper TWS API requests for NVDA and MSFT both returned IBKR warning 2186 and no quote. Signing the acknowledgement alone did not resolve the observed API feed. No account setting, subscription, or order was changed by this diagnostic. Keep live-data-dependent Paper repairs and automatic exits blocked; next verify any needed session refresh and have IBKR confirm the precise API/exchange entitlement before subscribing.

**Follow-up, 2026-09-18 12:47 p.m. ET:** Client Portal now displays Market Data Subscriber Status **Non-Professional**; its separate Non-Commercial Form section is no longer visible. Paper TWS is still logged into the simulated account. A fresh read-only live-only NVDA request still returned warning 2186 and no quote. The classification change has not yet yielded live API data in the current TWS session. No broker order or subscription was changed by the diagnostic.

**Retest after TWS restart, 2026-09-18:** The Paper TWS process restarted at 12:49 p.m. ET and a fresh read-only connection to the simulated account succeeded. Separate live-only NVDA and MSFT requests still produced warning 2186 and no quote. Session refresh therefore did not solve the observed API problem. Keep the live-quote gate closed; ask IBKR which exact API entitlement covers NASDAQ.NMS/TOP/ALL for Paper TWS under this username, whether the included non-consolidated feed is API-eligible for these SMART-routed requests, and whether another step is needed before subscribing. No order or subscription was changed.

**Simulator ordinary-exit lifecycle, 2026-09-18:** Added a pure state transition that emits a single target-replacement intent only when current Paper evidence shows the linked target and stop active for the exact held quantity. A repeated observation, process restart or lost connection cannot emit a duplicate request. It calls the exit working only after the target's requested limit appears in broker order evidence; a rejected modification remains blocked with the old target and stop active. A partial target fill with an oversized stop is blocked, not relabelled protected. A flat position is closed only with terminal sibling evidence and same-account full-quantity exit execution. Extra working sells block the lifecycle. The deterministic broker models pending, accepted and rejected modifications; no IBKR order API is called. Full QA passes: 95 Node and 22 Python tests plus TypeScript typecheck. Next: design a durable production intent/outbox and broker acknowledgement protocol, then test actual Paper TWS order modification and sibling quantity behavior separately after live feed and risk policy are resolved. Do not lift the code-level automatic-sell release hold.

**Durable simulator outbox, 2026-09-18:** Added a separate SQLite protected-exit intent store with WAL and full synchronous commits. `prepare` requires current Paper broker evidence; `claimForDispatch` rechecks a fresh protected snapshot and atomically marks the request transmission-unknown before returning its descriptive command once. If the process dies before or after that claim, restart reads the saved intent; an uncertain request is not sent again. Broker-observed order terms, rejection, position quantity, sibling status and full-quantity execution drive later states. A rejection whose event disappears from later snapshots stays blocked; a formerly working replacement that disappears becomes unknown, never rearmed. One unresolved request per account/symbol is enforced. This outbox has no IBKR socket, order adapter or service-worker integration; its commands are exercised only by the deterministic broker tests. Full QA passes: 104 Node and 22 Python tests plus TypeScript typecheck. The user later signed in and the diagnostic TWS API support ticket #496671 was submitted. Next: get IBKR's answer about API data, then design/verify a Paper-only order-modification adapter with broker-side partial-fill and sibling-resize evidence before any release hold changes.

**Protection and terminal-order verification, 2026-09-18:** A fresh read-only IBKR Paper snapshot again showed 25 NVDA and 2 MSFT shares and **zero open orders** for those symbols. The missing stops are broker-confirmed, not a display-only issue. Reconciliation now requests IBKR completed orders as well as open orders and executions; only an explicit broker terminal status can mark an unfilled entry rejected/cancelled. In the simulator, those outcomes create no position and release reserved buying capacity. A cancelled remainder cannot erase a prior partial execution. Health now marks an aged reconciliation `STALE` rather than presenting an old `COMPLETE` as current. The new Paper completed-order request and end callback were verified read-only, but the returned list was empty at that moment. Full automatic-exit fault testing, live quote entitlement, and any separate decision about protecting existing NVDA/MSFT holdings remain open. No broker order was placed or changed.

**Legacy protection root cause, 2026-09-18:** The private one-year Paper trade report separates early `trade-approval-…` single-order buys from later `-entry`/`-stop` bracket orders. NVDA has five early single-order buys netting +25 shares; its later bracket entries (+22) and stop executions (−22) net to zero. MSFT has one early single-order buy for +2 shares. The original app code confirms that version submitted only a buy limit order; the later bracket code did not exist yet. Thus the current net holdings match unprotected legacy purchases, although shares are fungible and this is not an order-cancellation history. The app now surfaces this explanation from the validated private report. Existing holdings still need a separate protection or exit decision; software should not silently place a stop at an invented price.

**Order-level attribution resolved, 2026-09-18:** A Paper Activity Flex Query for NVDA and MSFT with a 365-day lookback and audit-trail fields returned 25 executions across 16 broker orders: 24 NVDA executions across 15 orders, net 25 shares, and one MSFT execution for 2 shares. Every row was an API order with a `trade-approval-…` order reference. A validated, private, git-ignored import stores the broker order references and net movements without the full account ID. The service now identifies both holdings as `strategy_owned` from the earlier app version, separately from modern ledger-linked fills. Old app-referenced reconciliation rows previously mislabelled `external` are relabelled `legacy_application_unlinked`; truly external activity still vetoes attribution. The running service confirms NVDA 25/MSFT 2 legacy-app shares, `ownershipComplete: true`, and **missing protection** for both. The $5,000 trading sleeve is over-allocated (~$9,008.51 invested at broker average cost), so available capital remains $0; automatic selling remains off. This broker report establishes app origin, not original decision details, stop coverage, or complete fee-aware performance. No broker order was placed, changed or cancelled.

**Historical broker evidence, 2026-09-18:** The signed-in IBKR Paper Transaction History showed 20 NVDA buys on August 24; on September 1, 20 buys and 15 sells; on September 8, 7 buys; and on September 14, 7 sells. Net 25 matches the current broker holding. It also showed a September 1 purchase of 2 MSFT shares, matching the current quantity. The page does not identify the submitting application or stable order references, so it cannot prove which fungible NVDA shares belong to this strategy; the submitted-intent file is not a fill ledger. A local, git-ignored paper evidence record now feeds an informational broker-history line in Positions and a quantity mismatch safety veto. It never converts shares to `strategy-owned` or overrides missing stop checks. Automatic sells remain off, and no broker order changed. Next: obtain order-level attribution if available; otherwise keep NVDA/MSFT excluded from automatic exits and strategy performance. Then fault-test the replacement-sale/protective-order lifecycle and verify current executable quotes.

**Safety verification, 2026-09-18:** The running service reports complete read-only reconciliation, `automaticPaperSellsEnabled: false`, and matched historical quantities for NVDA 25/MSFT 2 while both remain `conflict` ownership with unverified protection. The desktop TWS Paper API passed a separate read-only connection check. The current cancel-before-submit sale adapter now refuses any request carrying protective-order cancellations before opening a broker connection, and the worker records a blocked reason rather than calling it. This deliberately disables that exit path until a safe lifecycle is implemented and fault-tested; it does not solve automatic selling. A 9:07 a.m. ET CVX API quote was type 3 (delayed), so it cannot pass the unattended-exit live-quote gate. Recheck during regular trading hours and review account market-data entitlements if it remains delayed. No broker order was placed or changed.

**Market-hours follow-through, 2026-09-18:** Read-only CVX checks after the 9:30 a.m. ET open still returned IBKR type 3, not live type 1. The automatic-exit gate now also requires individually recent bid and ask callback times (within five seconds) and a valid spread, with tests for delayed/frozen/simulated data, stale/missing/future callbacks and crossed/wide quotes. Callback arrival time is **not** an exchange timestamp and cannot by itself prove feed freshness; live data type and subscription must also be confirmed. The paper service was restarted with automatic sells still disabled. The cancel-before-submit path is blocked; no safe replacement-sale lifecycle exists yet. Next: inspect IBKR market-data entitlements and implement a simulator-first exit state machine that preserves protection through rejection, partial fill, disconnect and restart. No broker order was placed or changed.

**Additional release hardening, 2026-09-18:** The scanner's latest completed signal date was September 17. Automatic exits now require a successful, complete held-symbol evaluation for the exact expected prior weekday session; a missing/errored/incomplete or older cached evaluation never counts as a failed strategy check. Exchange holidays are not modeled, so a holiday mismatch fails closed. An explicit code-level release hold prevents `IBKR_ENABLE_AUTOMATIC_SELLS=true` from activating the worker; direct invocation of the paper-exit adapter also refuses to connect to the broker. Health reports the release blocker. This is a safety hold, not a finished automatic-sell capability. Tests cover stale/incomplete evaluations and both activation paths.

**Runtime verification, 2026-09-18 9:52 a.m. ET:** After a service restart, authenticated health returned IBKR Paper mode, complete reconciliation, automatic sells disabled and `protected_exit_lifecycle_not_ready`. Positions still show CVX/MRK/DE strategy-owned with exact verified stops, and NVDA/MSFT as ownership conflicts with unverified protection. A fresh read-only CVX API snapshot at 9:52 a.m. ET returned market-data type 3 (delayed), despite receiving bid and ask callbacks. TWS displayed a non-consolidated real-time-data banner, but this does not establish that the API snapshot has live consolidated access. Confirm the relevant account/exchange/API entitlements; do not purchase a subscription or change orders as part of this diagnostic. No broker order was placed or changed.

**Partial-exit safety finding, 2026-09-18:** A simulated two-share target fill from a five-share position left a three-share holding with a five-share stop in the adversarial fixture. The app previously marked any stop quantity **at least** as large as the position as verified. It now requires an exact quantity match, labels an oversized stop `overcovered`, and blocks new strategy capacity/automatic exits. This fixture tests a failure mode; it is not a claim that IBKR will leave a bracket sibling oversized. Confirm IBKR's actual partial-fill handling in a separately authorized Paper test before selecting an exit design. Candidate approach: modify an existing linked target while retaining the stop, but do not assume the TWS API modification, sibling behavior or cross-client ownership is atomic without broker evidence. The service was restarted with automatic sells still off; no broker order was placed or changed.

**Progress on priority 1 (2026-09-17):** Implemented read-only per-position matching of broker shares to recorded filled entries and linked active stops. Positions now shows matched, conflicting and unattributed holdings plus verified, missing, partial or unverified protection. An ownership or protection conflict sets available strategy capital to zero instead of attributing all shares of a familiar ticker. Automatic exits remain off and now also fail closed if ownership/protection is unresolved or an unrelated sell order would be cancelled. Simulated HTTP testing confirms that removing a linked stop blocks new capacity. The local paper read shows CVX, MRK and DE matching app-recorded fills and stops, but NVDA (25 shares) and MSFT (2 shares) have no matched open strategy fill or verified stop. The evidence-backed invested amount is $2,488.76, but available capital remains $0 because ownership is incomplete; this is **not** a performance result. Next: investigate the two unmatched holdings in broker history and document their provenance without selling or retroactively assigning them to the strategy.

The older strategy-state file records submitted buy intents for 17 NVDA shares and 2 MSFT shares, but those records alone do not prove execution, remaining ownership or protection. The current reconciliation snapshot contains no execution history for them. Obtain authoritative historical IBKR fills/statements and any manual activity before classifying their present shares. The refreshed local service reports automatic sells off, five holdings and six open orders; no order was placed or cancelled during this work.

**Recommendation run, 2026-09-17:** The paper queue completed against the September 16 completed-day scan and current broker reconciliation. It generated zero actionable cards because ownership of NVDA and MSFT is incomplete; automatic selling remained disabled and broker open orders remained at six. CVX, MRK and DE qualified as protected holds. NVDA and MSFT failed the technical scan but were classified `OWNERSHIP_REVIEW`, not recommended exits. QCOM, NOW, TMO, NET and AAPL appeared only as contingent replacement research, not priced, sized or approved trades. Resolve ownership and verify fresh executable quotes before drawing any trade conclusion.

**Automatic-sell request and release blocker, 2026-09-17:** The user wants ordinary strategy exits automated in IBKR Paper. Keep the local feature flag off until the exit adapter no longer cancels broker protection before confirmed replacement-sale acceptance; until partial fills, rejection, reconnect and cancel/replace races are simulated and paper-tested; until NVDA/MSFT ownership is resolved; and until the API can obtain current executable quotes rather than delayed market-data type 3. The policy now checks that the two failures are on truly adjacent completed trading bars and refuses non-live quote types, but those are only partial safeguards. Existing broker target and stop orders for matched positions remain independent of this disabled strategy-exit worker.

For the September 16 completed bar, NVDA failed the 20-day momentum gate (−2.52% versus the required +2% to +20%) and RSI gate (46.9 versus 50–72). MSFT failed only the momentum gate (about +1.98%, just below +2%). These are entry-rule failures, not independently validated sale signals. A read-only CVX quote check returned IBKR market-data type 3 with bid/ask values, confirming the current API data is delayed. The service was restarted with automatic strategy selling explicitly off.

### Quality engineering — Step 1 implemented 2026-09-12

- Added a single broker-free `npm test` quality gate covering TypeScript, all Node tests and all Python tests.
- Added GitHub pull-request/main-branch checks using clean dependency installation, dependency review and full-history secret scanning.
- Added `QA.md` as the versioned test matrix and release-gate source of truth.
- Next: deterministic broker simulation and service integration tests for partial fills, cancellations, protection gaps, reconnects and manual activity.
- No CI job has broker credentials or permission to contact or submit to IBKR.

### Deterministic broker QA — foundation implemented 2026-09-12

- Added a credential-free, paper-only broker authority for tests with a controllable clock and scheduled evidence.
- Added scenarios for partial fills and exact child quantity, rejection, cancellation, disconnect/reconnect, delayed evidence, duplicate execution callbacks, manual orders, commissions and completed exits.
- Next: inject this authority through service routes and implement/test the production lifecycle responses for partial fills and protection gaps.

### Service integration QA — foundation implemented 2026-09-13

- Added an explicit simulated-broker service mode that has no IBKR socket or credentials and exposes test controls only in that mode.
- Added real HTTP lifecycle coverage from proposal through approval, preview, What-If, submission, partial/full fills, reconciliation, Positions, closed Trades and external Activity.
- Verified a disconnect after transmission becomes an unknown attempt, reconciliation proves the broker order exists, and a retry replays the result without retransmission.
- Corrected partial executions so they remain partial until cumulative quantity is complete; aggregate quantities and commissions across multiple executions for the same broker order.
- Next: production lifecycle exceptions for cancellations, partial exits, missing/undersized protection and service-process restart coverage.

## Product direction

### News-event and thematic evidence — planned, deferred 2026-09-17

- Preserve the existing price-based recommendation strategy while today's paper performance, positions, open orders, protections and available strategy capital are evaluated.
- Later, ingest timestamped, source-linked news and company filings; deduplicate corrections; map events to affected companies and themes; and distinguish direct revenue/customer evidence from indirect exposure or general narrative.
- Classify event type and materiality with auditable evidence. AI may explain sourced facts but cannot alone authorize a trade. Missing, stale, ambiguous or delayed event data stays research-only.
- Compare the post-publication price/volume response with normal behavior and current consolidated liquidity and spread. Apply the existing portfolio, sizing, expiry and broker validation gates before any proposal.
- Run the event/theme lane in shadow mode with as-known-at-the-time timestamps, no look-ahead, recorded non-events and negative outcomes. Compare it with the current scanner and a benchmark before considering approval-card integration.
- A thematic example is WTTR: distinguish broad AI/water demand from verified direct company exposure and from short-term entry timing. A compelling theme can remain `WATCH` or `NO TRADE`.
- Acceptance before promotion: source provenance and correction tests, freshness/coverage reporting, explanation of direct versus indirect exposure, historical and forward paper evaluation, slippage and drawdown reporting, and explicit risk-policy review. No automatic order authority is granted by this plan.

### Current paper-strategy audit — read-only findings, 2026-09-17

- The existing completed-daily scanner returned 14 qualified technical candidates for September 16; these are not fresh, portfolio-approved buy orders.
- IBKR Paper reconciliation showed five open symbols and a conservative strategy budget of about $9,007 deployed against the configured $5,000 sleeve, so the app has zero buy capacity. The budget presently attributes all broker shares of any symbol previously used by the strategy to that sleeve; external or historically unmatched shares can therefore distort the allocation.
- Broker-visible stop orders covered CVX, MRK and DE, but not the current NVDA or MSFT positions. Verify ownership and protection in TWS before any exit or replacement action.
- The scanner now returns explicit pass/fail evaluations for all 500 reviewed symbols, including held-symbol failures; the qualified buy count remains 14. Automatic paper selling is disabled in the local service and verified off through its health check. Do not enable it until strategy-owned quantities, broker protection and the exit workflow are independently verified.
- IBKR quote requests returned delayed market-data type 3, and the NVDA quote had no usable price. Closed-trade fee coverage and historical application-versus-external ownership remain incomplete; do not present the current ledger as a full net-performance result.
- Next priority: reconcile strategy-owned quantities and protective orders, test zero/partial-capacity buy decisions and safe sell workflows without automatic submission, then calculate a fee-aware performance and benchmark report.

### Higher-volatility research lane — experimental shadow foundation, 2026-09-17

- Separate Alpaca cache and deterministic scanner evaluate up to 1,500 active listed equities plus eligible thematic-watchlist names without changing the existing top-500 strategy.
- Results are research candidates only. They do not become cards or broker orders. The API identifies price/volume direction as the signal and labels consolidated liquidity, current spread, portfolio sizing and broker validation as the remaining proposal gates.
- News, macro themes and scheduled events are optional context, not eligibility requirements. Next: obtain consolidated volume and intraday prices; add current spread and sizing checks; test out-of-sample, then compare paper outcomes to the existing strategy and benchmark before considering user-facing proposals.
- BMNR is a concrete missed-intraday-move review, not a missing symbol: it was in the main top-500 cache but failed three September 17 daily gates (IEX 20-day dollar volume, moving-average order, ATR cap). The older shadow cache also failed five-day momentum and relative volume. Record this as an intraday-discovery experiment with as-known-at-the-time evidence, not as a reason to auto-recommend a stock after a roughly 10% rise.
- Avoid confusing the user's Robinhood watchlist with broker holdings or claiming that volatility improves returns.

The scanner evaluates the eligible market and may return zero, one, or many opportunities. The number of recommendation cards is determined by current market qualification, fresh execution checks, and portfolio eligibility—not by a fixed UI quota. The user explicitly approves every buy and ordinary sale.

The trading sleeve is managed separately from long-term savings and automated-investing accounts. Cash is a valid allocation; the engine must never generate a trade merely to remain fully invested.

## Go-to-market discovery — separate workstream

The initial customer hypothesis is an inexperienced or intermediate self-directed investor who is interested in active investing but does not want to spend hours assembling market data, AI research, sizing logic, broker integrations, monitoring, and operational safeguards. The proposed value is a clear approval inbox for researched and automatically sized trades, with the user retaining the final decision.

Do not market guaranteed returns or imply that the application removes investment risk. Validate the product around time saved, understandable rationale, disciplined risk controls, reliable brokerage connectivity, monitoring, and trustworthy records.

Before scaling development for a public launch:

1. Interview prospective customers and test the problem and language without pitching returns.
2. Run a paper-only cohort and measure connection completion, comprehension, repeat engagement, retention, and trust through negative outcomes.
3. Test willingness to pay with an actual checkout or refundable preorder rather than survey answers alone.
4. Define the initial broker and customer niche before attempting broad brokerage coverage.
5. Obtain securities and market-data counsel before personalized recommendations or public live execution.

Evaluate a second, separately packaged offering for technically inclined customers: instructions, reference architecture, and tools for building a compatible recommendation engine. It must have its own positioning, support model, security boundaries, legal review, and a versioned integration contract. It should not delay validation of the core approval application.

## Delivery sequence

### Stock news context — implemented 2026-09-11

- News collection remains an internal research input; the standalone and per-symbol news interfaces were removed from the mobile app to keep the approval workflow focused.
- Server-only credentials, 60-second bounded memory cache, deduplication and safe link validation; no article bodies, new dependencies or trading-rule changes.
- News-driven discovery and ranking, intraday movers, multi-publisher aggregation and verified news latency remain pending. These additions do not repair the existing delayed IBKR quotes or incomplete account reconciliation.
- Validate with `node --test service/stock_news.test.mjs` and `npm run typecheck`.

### 0. Complete-interface Preview Mode — implemented

- Use the production screen and component structure with a mock data source instead of separate preview screens.
- Populate recommendations, Activity, Positions, broker state, and Settings with realistic content.
- Identify Preview Mode in the existing broker-status pill, keep it incapable of broker requests or persistent policy changes, and preserve an in-viewport card footer by truncating secondary rationale when necessary.
- Navigate through an animated left-side panel instead of a native alert menu.

### 1. Market-driven recommendation set — implemented in the local MVP

- Evaluate the full cached research universe.
- Rank every candidate that passes the deterministic strategy.
- Require a fresh IBKR bid/ask and acceptable spread for each actionable card.
- Return every candidate that passes; use pagination or incremental delivery only as a transport and UI optimization.
- Freeze the exact terms of a displayed proposal until it is decided or expires.
- After a denial, keep cash unchanged but invalidate and recalculate the remaining recommendation set from current strategy capacity and fresh quotes.
- Do not show the denied symbol again for the same completed-data signal date.

### 2. Durable trading ledger — in progress

- **Implemented foundation:** versioned SQLite schema for proposals, decisions, submission attempts, broker orders, and lifecycle events.
- **Implemented foundation:** immutable proposal replay checks, one decision per proposal, single idempotency key per submission, and restart persistence tests.
- **Implemented:** generated proposals, approvals, denials, expirations, preview/What-If outcomes, final safety blocks, submission attempts, and acknowledged bracket-order identities are connected to the ledger.
- **Implemented:** service startup restores proposal and decision state; durable submission idempotency replaces the in-memory consumed-approval set.
- **Implemented:** a broker disconnect after transmission records an unknown outcome and blocks another transmission until reconciliation.
- **Implemented:** ledger-backed Activity and Positions read models and mobile views; positions fail closed until a filled entry is recorded.
- **Next:** preserve unselected recommendations and enrich Activity with reconciled broker events.
- **Next:** reconcile unknown attempts, current IBKR orders, fills, positions, and manual broker activity.

### 3. IBKR reconciliation

- **Implemented foundation:** collect a single complete, read-only paper-account snapshot containing balances, positions, open orders, order status, and executions.
- **Implemented foundation:** persist reconciliation runs and broker activity durably by stable broker identity.
- **Implemented foundation:** classify order and execution references as application-linked or external/manual.
- **Implemented safety boundary:** the portfolio view is `INCOMPLETE` when any required balance is absent, collection is partial, the environment is not paper, or the snapshot is stale.
- **Implemented:** link observed app orders to their exact ledger proposal, decision, and submission attempt through IBKR order references; resolve ambiguous submission outcomes when broker evidence proves the order exists.
- **Implemented safety boundary:** use permanent IBKR order identity when available, record idempotent lifecycle evidence, and refuse to guess when a shortened decision reference is not unique.
- **Implemented:** adaptive read-only reconciliation cadence—5 seconds with active orders, 15 seconds with positions, and 60 seconds while quiet—plus startup and manual refresh.
- **Next:** reconcile cancellations, partial fills, completed fills, missing protective orders, and manual activity into the full ledger lifecycle.
- Treat IBKR as authoritative for broker state and the ledger as authoritative for application intent and history.

### 4. Authoritative portfolio snapshot

- Calculate settled cash, available funds, buying power, net liquidation value, open-position count, pending commitments, strategy exposure, sector exposure, correlated exposure, and daily realized/unrealized P&L.
- Keep trading-sleeve limits separate from unrelated brokerage holdings.
- Mark sizing unavailable when any required input is missing or stale.

### 5. Portfolio-aware sizing — calculation foundation implemented

- **Implemented foundation:** pure, versioned whole-share sizing from loss at the protective stop.
- **Implemented foundation:** apply the most restrictive of settled cash, available funds, buying power, cash reserve, per-trade risk, remaining daily risk, total open risk, maximum position size, total strategy allocation, sector/correlation limits, liquidity, and open-position limits.
- **Implemented foundation:** return the binding constraint and classify the result as actionable with cash, capacity-blocked, or a possible rotation that still requires sequential approval and fill.
- **Implemented safety boundary:** stale or missing portfolio inputs return `INCOMPLETE` with no amount.
- **Next:** connect reconciled IBKR portfolio snapshots and user-configured trading-sleeve policy.
- Remove prototype share-count ceilings only after these controls and tests are in place.
- Recalculate immediately before submission and fail closed if capacity changed.

### 5a. Adaptive policy settings — interface and persistence implemented

- **Implemented:** accessible Settings page opened from the hamburger menu.
- **Implemented:** editable trading sleeve, cash reserve, deployment, loss, concentration, and position-count limits.
- **Implemented:** smart paper defaults, adaptive-mode control, operating-level explanation, conflict validation, and authenticated persistence on the Mac service.
- **Safety boundary:** adaptive behavior may reduce operating limits but cannot exceed saved hard limits.
- **Next:** derive the operating multiplier from reconciled portfolio state and versioned market-regime inputs, then pass the effective policy to the sizing engine.

### 6. Opportunity classification

Classify every qualified market setup as one of:

- **Actionable with cash:** may be presented for buy approval with an exact amount.
- **Qualified but capacity-blocked:** remains observable but cannot be approved.
- **Possible rotation:** potentially worth funding by exiting an existing position, but not yet executable as a combined operation.

### 7. Sequential portfolio rotations

- Present the sale and contingent purchase as one understandable plan, including rationale, portfolio impact, costs, and tax information when available.
- Require explicit approval for the ordinary sale and the proposed buy terms.
- Submit the sale first, wait for a confirmed fill, refresh settled cash and portfolio risk, then regenerate and revalidate the buy.
- Never assume sale proceeds or release the buy solely because the sale was approved.

### 8. Position and exit lifecycle — interface foundation implemented

- **Implemented foundation:** Activity and Positions views backed by durable application records.
- **Safety boundary:** unreconciled records are explicitly labeled and never presented as authoritative live broker state.
- Verify protective orders remain active after fills or partial fills.
- Treat ordinary profit targets as monitored thresholds that create sell-approval requests.
- Permit automatic profit-taking only for separately defined, deterministic emergency exceptions.

### 9. Notifications and paper evaluation

- Generate notifications from durable state transitions.
- Measure automation reliability separately from strategy performance.
- Compare executed, denied, expired, blocked, and unselected recommendations against a benchmark.

### 10. Production and live-trading graduation

- Add production authentication, encrypted secrets, resilient runtime, monitoring, backups, and recovery.
- Establish minimum paper duration, sample size, acceptable system-error rate, drawdown limits, and rollback conditions.
- Begin live testing only with a deliberately small trading sleeve and stricter limits than paper.

## Immediate milestone acceptance criteria

The durable-ledger and reconciliation milestone is complete only when:

1. Restarting the service cannot lose or duplicate a submitted decision.
2. Every IBKR order and fill is linked to one immutable proposal and decision.
3. Manual broker changes are detected and displayed.
4. The app can distinguish submitted, pending, partially filled, filled, cancelled, rejected, protected, and closed states.
5. Portfolio-aware sizing remains disabled until balances, positions, open orders, and fills are fresh and reconciled.

## Current strategy-evidence sequence — September 23

1. **Measure filtered opportunities — complete.** Every observed candidate receives immutable 1-, 5- and 10-session counterfactual measurement with explicit costs and path excursions.
2. **Join recommendations to broker lifecycle — complete.** Exact frozen signal date, symbol and source lane are required; unmatched history stays visible but unattributed.
3. **Report portfolio results — daily scorecard complete.** Strategy-owned Paper fills produce daily gross/net P/L when supported, exposure, turnover, drawdown, proposal-relative slippage and cash/QQQ comparisons with explicit evidence completeness. Net results still wait for complete commission evidence.
4. **Automate collection readiness — complete.** Review is blocked until 20 distinct usable sessions exist separately at every horizon, with matched lifecycle progress reported independently.
5. **Freeze one rule experiment — complete; collecting next-session evidence.** Relative volume is ranking context rather than a hard veto in one isolated treatment lane. Top-five paired results, costs, uncertainty and drawdown are evaluated under D-068. The control remains unchanged and active; treatment has no recommendation or order authority.
6. **Bind new proposals to frozen evidence — complete prospectively.** New proposals persist exact signal date, lane, ruleset, evidence-run ID and resolution state. Lifecycle capture independently verifies those claims and refuses mismatches. September 11 fills remain unlinked because no contemporaneous frozen run existed.
7. **Complete commission accounting — importer complete; source refresh pending.** New TWS commission callbacks are retained. Historical fees can now be attached only from exact same-account Flex execution IDs and application order references. The existing September 18 export predates the required ledger executions, so net performance remains unavailable until a current report is exported and imported.

**Next operational action:** Export a new 365-day IBKR Paper Activity Flex CSV through September 23 with execution audit fields and commissions, then run the verified commission importer and confirm `feesComplete: true`. During the next Paper recommendation cycle, also confirm the created proposal reports `evidenceStatus: MATCHED` and that lifecycle capture increases the matched-proposal count.

## Separate crypto paper MVP — proposed delivery sequence

The [MVP assessment](./CRYPTO_MVP_ASSESSMENT.md) recommends completing the exchange-only supervised paper loop first, then separately evaluating economics with approved public/recorded production depth. Wallet signing is deferred. Later 0x observation and unattended operation are optional proposed work, not additions to the authorized implementation scope. Sandbox economics must not be presented as evidence of live profitability.

See [CRYPTO_DESIGN.md](./CRYPTO_DESIGN.md) for the repository findings, contract, threat model, ledger schema, cost formula, risk/session semantics, UI specification and full acceptance matrix. Existing stock milestones above remain in place. Crypto may share presentation primitives and infrastructure patterns; it must not change the working stock/IBKR workflow.

1. **Design for review — prepared, awaiting review.** Proposed Coinbase Exchange and Gemini sandbox feeds with simulated account/execution authority; separate process/database/API. Do not implement or install dependencies before review.
2. **Contract and calculation — pending.** Decimal-safe normalized spot contract, depth and timestamp gates, all-cost net calculation, deterministic unit and boundary tests.
3. **Persistence and simulation — pending.** Additive independent ledger migration, exact inventory journals/reservations, immutable session approvals, paired simulator and partial/unknown/crash tests.
4. **Reconciliation and risk — pending.** Fixture-based authority, identity, manual activity, balances, fees, limits and restart tests; no automatic paired execution until these pass.
5. **Sandbox data integration — pending.** Verify both venues' current instrument intersection, channel integrity, fee-model provenance and rate limits; no production fallback.
6. **Mobile and web — pending.** Stocks/Crypto context switch, bounded session approval, opportunities, paired status, balances, P&L, exceptions and reconciliation health; authenticated private controls, persistent alerts and accessible offline states.
7. **Bounded paper evaluation — pending.** Explicit user approval of actual session limits, fault injection and soak testing. State assumptions and incomplete features before acceptance.

Crypto acceptance requires no production credentials or network orders; fresh exact balances for allocation; immutable approved periods/limits; persistent daily loss/turnover and crypto kill state; proof before retrying uncertain outcomes; explicit unresolved exposure; and unchanged stock behavior when crypto is disabled or unavailable. Design approval does not approve a strategy session. Changes or renewal of session limits require a new proposal and approval. Live trading remains outside this workstream.

### Plan change history — 2026-09-10

- Added the wallet UX/security assessment and staged correctness/economics recommendation; no implementation or data-source expansion approved.

### Plan change history — 2026-09-20

- Completed Day 1 data-integrity repair for both daily-bar caches: pre-storage completed-session filtering, explicit completion boundaries, atomic replacement and legacy-cache refusal.
- Rebuilt the 500- and 1,500-symbol caches through September 18 and added regression coverage for intraday, after-close, weekend, future-bar and historical-cutoff behavior.
- Added a reproducible audit of the supplied 250-symbol volatility list. Current result: 2 research-qualified, 26 technical rejects and 222 outside the IEX-volume universe. This is coverage evidence, not strategy-performance evidence.
- Confirmed that IEX remains single-venue volume. A read-only SIP request was denied by the current Alpaca entitlement, so consolidated volume needs a later data-source/subscription decision; no purchase or automatic volatility trade is authorized.
- Added the Stage 11 deterministic macro outcome report and frozen controls. Only complete real forward observations can enter performance metrics; rehearsals remain excluded.
- Fixed the initial decision gate at 30 eligible event observations and 30 exact matched no-event controls under one ruleset/map/universe version.
- Kept macro outcomes research-only and recorded the current result as `CONTINUE_COLLECTING` with zero eligible real pairs.
- Added the isolated Stage 12 shadow-ranking fork with a maximum five-point macro adjustment and hard-gate precedence.
- Froze identical-input, anti-look-ahead, 30-session minimum and rollback rules before any real forward comparison.
- Blocked real Stage 12 registration until Stage 11 explicitly proceeds; fixtures cannot become promotion evidence.
- Added the Stage 13 promotion dossier, attributable immutable sign-off journal and default-off release manifest.
- Required exercised monitoring, rollback and integration controls plus identified rights, security, reliability and broker/reconciliation evidence before bounded-ranking approval.
- Recorded that no real promotion decision or feature manifest exists; macro ranking remains research-only and disabled.

### Plan change history — 2026-09-07

- Clarified crypto has no IBKR dependency. Evaluate broad token catalog discovery separately from the subset executable on two sandbox exchanges; CoinGecko is proposed, with no connection or dependency added.
- Added the gated crypto design workstream without changing the stock delivery sequence.
- All crypto runtime, tests and frontend implementation remain pending design review.

### Plan change history — 2026-09-21

- Started Day 2 by extending the aggressive shadow cache with a source-list import that preserves all existing safety and technical gates.
- Re-audited all 250 supplied volatile stocks: 248 observed, 2 absent from the provider's active asset master, 3 research-qualified and 245 technical rejects.
- Added realized volatility, recent maximum drawdown and opening gap to shadow v2 as descriptive factors. They remain non-ranking until historical and forward comparisons justify a frozen rule change.
- Next Day 2 stages are catalyst provenance/classification, licensed options-volatility inputs and matched historical shadow comparisons. None is authorized to create an order.
- Implemented the first catalyst-classification layer on normalized Alpaca/Benzinga headlines with eight event categories, evidence links, timing, lexical direction, bounded classification confidence and window-relative novelty.
- Kept catalyst output separate from ranking and orders. Primary-source verification, correction handling, broader market-wide discovery and outcome testing remain required before any promotion decision.
- Implemented the provider-neutral options-volatility input evaluator with fail-closed freshness, OPRA, history, term-structure, skew and liquidity requirements.
- Verified that current Alpaca credentials permit indicative option-chain quotes but not OPRA; the sample contained no usable IV or Greeks. A licensed source and prospective point-in-time IV history remain prerequisites, so this layer cannot affect ranking or orders.
- Next Day 2 stage: run matched historical shadow comparisons using only contemporaneously available technical and catalyst evidence. Options-volatility comparisons remain deferred until the required licensed history exists.
- Implemented the matched daily lane comparator and ran 80 dates with 20 held-out forward dates. The shadow-minus-baseline uncertainty interval crossed zero at every 1-, 5- and 10-session horizon, while the shadow lane was materially negative at 10 sessions.
- Classified the run as a retrospective diagnostic rather than promotion evidence because both universes are selected from the current asset population and no immutable historical catalyst archive exists. Next collect point-in-time universe/catalyst observations prospectively and repeat the frozen comparison on a larger forward sample.
- Added the append-only daily forward-evidence collector. It freezes complete baseline and volatile universes plus every pass/fail evaluation, then appends 1-, 5- and 10-session outcomes only as future sessions become available.
- Captured the first completed-session snapshot for September 18: 500 baseline/22 eligible and 1,721 shadow/63 eligible, with all 255 candidate-horizon outcomes correctly pending. `npm run market:daily` now refreshes both caches and captures the session; host scheduling and market-wide catalyst capture remain next operational work.
- Installed and live-tested the macOS weekday 4:30 PM LaunchAgent. It sources the ignored local credentials, prevents overlapping runs and logs locally. The live test also verified that a changed refresh for an already frozen session preserves the original evidence, emits a warning and continues outcome processing instead of overwriting or falsely failing.

### Plan change history — 2026-09-24

- Added the sequential global news and event intelligence workstream in `GLOBAL_NEWS_PLAN.md`.
- Recorded the current boundary: Alpaca/Benzinga is one partial, headline-only U.S. feed; SEC, Fed and BLS coverage is narrow; catalyst classification remains research-only and cannot affect ranking or orders.
- Selected a layered source strategy: official primary sources for verification, one licensed global financial wire, GDELT as bounded multilingual discovery, a point-in-time consensus/calendar provider, and market data for reaction confirmation.
- Prioritized the first build slice: provider-neutral source registry and event contract, bounded GDELT discovery, primary verification for AI infrastructure/power/water, energy/commodities and geopolitical/shipping themes, then two weeks of immutable shadow capture.
- Kept all news-derived output outside recommendation, sizing, exit and execution authority until forward evaluation and an explicit promotion review pass.
- Split news ingestion into frequency lanes: seconds-level company news, one-minute market halts, near-real-time filings, exact-time scheduled releases, primary verification, 15-minute global discovery and slower thematic research.
- Made current Alpaca/Benzinga streaming entitlement and reconnect/gap behavior the first implementation check; durable continuous server-side collection follows before adding more providers.
- Implemented the immutable global-news event journal, versioned source registry, operational source health and continuous all-symbol Alpaca/Benzinga WebSocket collector.
- Verified the current credentials authenticate and subscribe to all available news; fixture tests cover authorization flow, persistence, deduplication, immutability and research-only authority, and all 116 Node service tests pass.
- Next: add REST backfill/gap recovery and supervision, observe real headline persistence during an active period, then connect stored events to classification without granting ranking authority.

### Plan change history — 2026-09-25

- Completed the first market-day global-news test slice: 24-hour paginated Alpaca/Benzinga recovery, continuous WebSocket capture, bounded reconnect and macOS LaunchAgent supervision.
- Added one-minute Nasdaq Trader halt and important SEC EDGAR filing monitors with explicit market-safety and primary-source provenance.
- Added immutable research-only catalyst signals and 5-/30-minute IEX-bar outcome measurement using a frozen 20-basis-point round-trip cost assumption.
- Added app-visible News Monitor and authenticated health/feed endpoints. None of these paths can modify candidate rank, sizing, exits or orders.
- Live validation captured more than 700 unique source events and produced the first measured outcomes. Initial broad-classifier aggregates are mixed/mostly negative after assumed costs, confirming that promotion would be premature.
- Fixed source-record duplication caused by REST second-level versus WebSocket millisecond timestamps, retained the original journal in a local audit archive and rebuilt the active journal from the recovery window.
- GDELT global discovery remains pending because its public endpoint rate-limited the implementation check. Licensed global wire, multilingual entity/exposure mapping, economic consensus and data-rights decisions remain future work.

### Plan change history — 2026-09-27

- Froze the daily strategy, intraday research rules, seven-symbol universe and news classifier for the September 28–October 2 forward-test week; only reproducible operational or evidence-integrity defects justify an in-week repair.
- Recorded daily acceptance goals for clean collection, discovery review, outcome comparison, recovery testing and the Friday scorecard.
- Re-ran full QA successfully: TypeScript, 123 Node tests and 224 Python tests.
- Verified the supervised news collector is running with Alpaca/Benzinga, Nasdaq Trader and SEC EDGAR healthy; weekday intraday/profile/evidence jobs are loaded with clean prior exits.
- Preserved the broker boundary: Sunday TWS API connection failed, so Monday requires a fresh complete Paper reconciliation before Friday's protection state may be treated as current.

### Plan change history — 2026-10-02

- Added the isolated `Catalyst Sprint` backend mode contract for very-high-risk, minutes-to-two-session opportunities.
- Added a fail-closed composite evaluator in which technical confirmation remains dominant and only fresh primary-source- or licensed-wire-verified news, or a verified scheduled event, can qualify catalyst context.
- Kept the initial mode research-only and Paper/shadow-only with no recommendation, order or automatic-exit authority.
- Next: connect immutable intraday and global-news journals to the evaluator, add a separate mode ledger and cost-aware outcomes, then run at least 20 usable market sessions before considering bounded Paper recommendations.

### Plan change history — 2026-10-07

- Expanded the funded Paper strategy from five to a configurable default of eight positions without changing the $10,000 sleeve.
- Added a $1,500/15% canonical-security cap, 35% sector/theme caps and GOOG/GOOGL exposure grouping.
- Required complete exposure metadata for funded positions and distinct diversification for slots six through eight rather than merely consuming unused capacity.
- Added queue recalculation after newly observed broker fills so every next recommendation uses current cash, exposure and slot availability.
# Protective-exit lifecycle completion

- [x] Diagnose expired DAY protection on current Alpaca Paper holdings.
- [x] Make future bracket protection persistent with GTC duration.
- [x] Add a guarded repair workflow using exact recorded exit terms.
- [x] Restore and verify safe GTC protection for CSCO, GOOGL, INTC, and PLTR.
- [x] Detect recorded protective-stop breaches without silently loosening risk.
- [x] Surface breached stops and profitable unprotected rotations as approvable sell cards.
- [x] Add an idempotent Alpaca Paper direct-exit path with reconciliation.
- [x] Preserve parent application identity on Alpaca-generated target/stop child legs and replay the INTC stop fill into the ledger.
- [x] Add focused regression tests and run type checking.
- [ ] Obtain explicit user approval before submitting the current SMCI or XOM sell.
- [ ] After any approved fill, reconcile positions, recalculate capacity, and refresh buy recommendations.
