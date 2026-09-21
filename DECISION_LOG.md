# Trade Approval — Decision Log

**Log revision:** 2026-09-21.3 · **Corresponding architecture:** 4.6

This is the living record of product, design, trading-safety, data, and technical decisions for the Trade Approval app.

## How to use this log

- **Confirmed** means we have agreed to proceed this way.
- **Provisional** means it is the current direction but still needs testing or validation.
- **Open** means a decision is still required.
- When a decision changes, keep the original entry and mark it **Superseded**, then link to the replacement decision.
- Performance assumptions are hypotheses until supported by paper and live evidence.

## Decision index

| ID | Decision | Status | Last updated |
|---|---|---|---|
| D-001 | Human approval is required before every order | Superseded by D-017 | 2026-08-31 |
| D-002 | Use IBKR Paper as the first execution environment | Confirmed | 2026-08-31 |
| D-003 | Keep the trading service on the Mac, not in the phone app | Confirmed | 2026-08-31 |
| D-004 | Use Tailscale for private phone-to-Mac connectivity during prototyping | Confirmed | 2026-08-31 |
| D-005 | React Native with Expo is the cross-platform frontend foundation | Confirmed | 2026-08-31 |
| D-006 | The recommendation card prioritizes decision-critical information | Confirmed | 2026-08-31 |
| D-007 | Browsing cards does not approve, deny, or remove them | Confirmed | 2026-08-31 |
| D-008 | Treat no-trade days as a valid scanner outcome | Confirmed | 2026-08-31 |
| D-009 | Home separates stocks, options, portfolio actions, and market review | Superseded | 2026-08-31 |
| D-010 | Options use a separate review stack | Superseded | 2026-08-31 |
| D-011 | Initially limit options to defined-risk strategies | Provisional | 2026-08-31 |
| D-012 | Risk assessment must include trade size and portfolio impact | Confirmed | 2026-08-31 |
| D-013 | Paper testing measures both automation and strategy performance | Confirmed | 2026-08-31 |
| D-014 | Record approved, denied, expired, and unselected recommendations | Confirmed | 2026-08-31 |
| D-015 | Use one authoritative broker-readiness state in the UI | Confirmed | 2026-08-31 |
| D-016 | Keep a versioned architecture source of truth | Confirmed | 2026-08-31 |
| D-017 | Recommend buys only; require approval for ordinary profit-taking | Superseded by D-039 | 2026-09-15 |
| D-018 | Support an explicit in-app light/dark appearance control | Confirmed | 2026-08-31 |
| D-019 | Preload a bounded recommendation queue | Superseded by D-020 | 2026-09-06 |
| D-020 | Recommendation count is market- and portfolio-driven | Confirmed | 2026-09-06 |
| D-021 | Portfolio rotations are sequential and contingent on confirmed fills | Confirmed | 2026-09-06 |
| D-022 | Use a local SQLite trading ledger with immutable, idempotent lifecycle records | Confirmed | 2026-09-06 |
| D-023 | Position sizing must be deterministic, portfolio-aware, and explainable | Confirmed | 2026-09-06 |
| D-024 | Denial triggers recommendation recalculation without changing cash | Confirmed | 2026-09-06 |
| D-025 | Adaptive sizing operates only inside editable user limits | Confirmed | 2026-09-06 |
| D-026 | Treat go-to-market validation as a separate product workstream | Confirmed direction | 2026-09-06 |
| D-027 | Build portfolio state only from complete broker reconciliation snapshots | Confirmed | 2026-09-06 |
| D-028 | Preview Mode mirrors the complete product structure | Confirmed | 2026-09-06 |
| D-029 | A missing recommendation must have an explicit scanner state | Confirmed | 2026-09-06 |
| D-030 | Separate paper-only crypto scope and design-before-code gate | Confirmed user constraint | 2026-09-07 |
| D-031 | Crypto sandbox feeds, simulated authorities and isolated storage | Proposed for review | 2026-09-07 |
| D-032 | Bounded crypto session approval and durable safety controls | Required model; detailed semantics proposed | 2026-09-07 |
| D-033 | Crypto uses exchange APIs and separate broad token discovery, with no IBKR dependency | No IBKR confirmed; catalog provider proposed | 2026-09-07 |
| D-034 | Exchange-first paper MVP; defer wallet signing and separately assess market economics | Recommendation for review | 2026-09-10 |
| D-035 | Stock news context through Alpaca/Benzinga | Implemented MVP; provider chosen for requested integration | 2026-09-11 |
| D-036 | Recycle strategy capital from broker-confirmed trade lifecycle and report profit conservatively | Confirmed and foundation implemented | 2026-09-11 |
| D-037 | Separate broker-free CI from explicitly gated IBKR Paper verification | Confirmed; CI foundation implemented | 2026-09-12 |
| D-038 | Full allocation triggers a portfolio review instead of an empty recommendation state | Confirmed; review layer implemented | 2026-09-14 |
| D-039 | Permit deterministic automatic ordinary exits in IBKR Paper only | Confirmed direction; operationally disabled pending safety verification | 2026-09-17 |
| D-040 | Test a separate broader, higher-volatility equity research lane | Provisional; shadow implementation | 2026-09-17 |
| D-041 | Defer news-event and thematic signals until current paper strategy is measured | Confirmed priority; signal design provisional | 2026-09-17 |
| D-042 | Prioritize position truth, execution reliability and measurement before expanding recommendations | Confirmed delivery sequence | 2026-09-17 |
| D-043 | Require explicit broker terminal-order evidence before releasing an unfilled order reservation | Confirmed; simulator-tested | 2026-09-18 |
| D-044 | Repair legacy Paper protection only from fresh broker evidence and a bounded stop policy | Confirmed safety gate; order placement pending | 2026-09-18 |
| D-045 | Continue scanning at full allocation and permit only profitable ordinary rotations | Confirmed; review policy implemented | 2026-09-20 |
| D-045 | Develop intraday discovery as a timestamped, research-only lane | Confirmed; evaluator and recorded-evidence pipeline implemented | 2026-09-19 |
| D-046 | Add macro/news events and volatility as a separately measured ranking bias | Confirmed; evaluator, journal and first official-source adapters implemented | 2026-09-19 |
| D-047 | Evaluate Trading Economics as the first consensus/forecast source | Provisional adapter implemented; access and licensing unapproved | 2026-09-20 |
| D-048 | Require reviewed, versioned evidence for theme-to-company exposure | Confirmed; immutable registry implemented, production mappings pending | 2026-09-20 |
| D-049 | Join macro records only through an explicit reviewed event crosswalk | Confirmed; pure fail-closed joiner implemented, scheduling pending | 2026-09-20 |
| D-050 | Pre-register durable forward macro capture windows | Confirmed; provider-neutral scheduler implemented, runtime worker pending | 2026-09-20 |
| D-051 | Execute forward capture through a supervised read-only worker | Confirmed; injected-adapter worker implemented, real providers pending | 2026-09-20 |
| D-052 | Bind capture identity and resolve uncertain claims without retry | Confirmed; stage 7 implemented with immutable supervised dispositions | 2026-09-20 |
| D-053 | Treat daily-bar session completion as explicit cached evidence | Confirmed; both daily caches repaired and audited | 2026-09-20 |
| D-054 | Imported discovery lists extend observation, never trading authority | Confirmed; Day 2 coverage lane implemented | 2026-09-21 |
| D-055 | Headline catalysts are classified context, not predictive evidence | Confirmed; Day 2 research classifier implemented | 2026-09-21 |
| D-056 | Options volatility requires licensed, point-in-time evidence | Confirmed; provider-neutral research contract implemented | 2026-09-21 |

---

## Detailed decisions

### D-056 — Options volatility remains research-only until its data is complete

**Status:** Confirmed; provider-neutral evaluator and deterministic tests implemented. A production data source and historical collection are not approved.

**Decision:** Evaluate options volatility only from a fresh consolidated OPRA snapshot with coherent contracts, two expiration slices, implied volatility and Greeks, quoted spreads, volume, open interest, the underlying's 20-session realized volatility, a known-event distance and at least 60 point-in-time underlying-IV observations. The evaluator reports ATM IV, IV percentile, IV-versus-realized spread, term structure, 25-delta skew and liquidity diagnostics.

**Current evidence:** A read-only entitlement check found that the current Alpaca account can request indicative option-chain quotes but cannot request OPRA. The sampled indicative response did not contain usable Greeks or implied volatility. Even current OPRA access would not by itself create the historical point-in-time IV series needed for a valid percentile.

**Boundary:** Incomplete, stale, future-dated or indicative data fails closed. Every evaluation is `research_only`, with ranking adjustment, proposal creation and order submission disabled. No subscription purchase is authorized, and the engine must not infer volatility edge or expected return from raw IV alone.

### D-055 — Headline-only catalyst classification remains separate from ranking

**Status:** Confirmed; implemented in the existing Alpaca/Benzinga research response with deterministic tests.

**Decision:** Classify recent normalized headlines into earnings/guidance, FDA/clinical, financing/dilution, M&A, contracts/partnerships, regulation/legal, analyst actions and macro/industry themes. Preserve the evidence URL, publication/update times, publisher source, affected symbols, freshness, lexical direction, classification confidence and novelty within the returned seven-day window.

**Boundary:** Benzinga through Alpaca is secondary evidence. Headline matching does not verify the underlying event, establish causation or estimate returns. Predictive confidence is explicitly null. Every result is `researchOnly`, `rankingAdjustmentAllowed: false` and `orderSubmissionAllowed: false`; it cannot rescue a failed liquidity or technical gate.

**Initial observation:** A September 21 check of the three imported-list technical candidates found no returned CLDX articles, one unmatched TRAX article and three GRAL articles. Only the GRAL earnings-call transcript matched a category, with unclear direction and no predictive confidence. This is a pipeline check, not evidence that the catalyst has trading value.

### D-054 — External discovery lists extend the shadow universe without bypassing gates

**Status:** Confirmed; implemented for CSV symbol lists in volatile-growth shadow ruleset v2.

**Decision:** A supplied symbol list may add active, supported common stocks to the isolated aggressive cache after the ranked top-1,500 selection. The imported set is durable across ordinary refreshes and is replaced only by an explicit later import. Imported names receive the same completed-history, price, venue-liquidity, ATR, momentum and relative-volume evaluation as ranked names. Missing or unsupported symbols are stored with explicit reasons. Import status, failed checks and provenance are reportable.

**Research additions:** Shadow v2 reports 20-day realized volatility, 60-day maximum drawdown and latest opening gap. These fields are descriptive diagnostics and do not yet change eligibility or ranking. Raw implied volatility supplied by an external list remains unverified, directionless context.

**Boundary and evidence:** Imported symbols do not enter the core recommendation queue, portfolio sizing, approval cards, IBKR validation or order submission. In the September 21 audit, 248 of 250 supplied names were observed, RGC and WIMI were absent from Alpaca's active asset master, 3 names passed the shadow technical gates and 245 failed at least one gate. This establishes coverage and explainability, not predictive value or expected profit.

### D-053 — Daily scans require an explicit completed-session boundary

**Status:** Confirmed; implemented in both Alpaca daily caches with regression tests and a 250-symbol audit.

**Decision:** Filter daily bars before universe ranking and persistence. A bar dated before the current New York date is complete; a same-day weekday bar is accepted only at or after 16:15 ET. Malformed, future and same-day weekend bars fail closed. Rebuild stored bars atomically, record the latest actual `completedThrough` date and refuse a legacy cache that lacks this boundary.

**Reason:** The aggressive cache refreshed at 10:18 ET on September 17 and stored that partial session as a daily bar. A later weekend scan treated it as complete, corrupting relative volume, momentum and ATR. Cache freshness did not prove bar completeness.

**Boundary and evidence:** The conservative 16:15 rule may delay data on early-close sessions but will not prematurely accept it. Exchange-holiday awareness remains pending. A read-only SIP request on September 20 was denied by the provider, so the current account cannot replace IEX with consolidated volume; the application continues to label IEX as single-venue evidence. After repair, both caches completed through September 18; the aggressive lane produced 62 research-only candidates instead of zero. Of the supplied 250-symbol Robinhood list, 28 entered the 1,500-symbol IEX-volume universe, 2 qualified for research, 26 failed technical gates and 222 were outside the universe. Qualification grants no proposal or order authority.

### D-052 — Captures must bind to task identity; uncertain claims are never reopened

**Status:** Confirmed; stage 7 implementation and fault tests complete.

**Decision:** Market captures must match the claimed symbol. Release captures must match the scheduled official event. Every result must match the plan's pinned event-link and exposure-map versions. A claimed task left unfinished after process termination receives at most one immutable supervised disposition: confirmed failure, completion from durable in-window evidence or abandoned unknown.

**Boundary:** Resolution does not rewrite the original claim, return it to pending or authorize a second provider call. Completion from durable evidence requires an in-window timestamp and named source. Resolver identity, time, rationale and evidence are permanently audited. This hardening does not connect a real provider or affect recommendations or orders.

### D-051 — Forward capture workers are read-only, single-claim and fail visibly

**Status:** Confirmed; supervised worker and normalized evidence validation implemented with fixture adapters only.

**Decision:** A worker may claim due scheduler tasks and call only injected release-data or market-data readers. Release captures require identified primary-source and consensus records. Market captures require timestamped bid, ask, last, session and expected volume, prior close, ATR, halt status and explicit data/volume provenance. Valid results complete once; invalid results and provider exceptions become sanitized failures without storing raw error messages.

**Boundary:** The worker has no timer, credentials, production provider configuration, recommendation route or broker/order method. It catches ordinary provider failures but deliberately does not catch process termination; a crash after claim therefore remains visibly `CLAIMED` and cannot be silently retried by another worker. Real adapters, operational supervision, unresolved-claim handling and licensed forward collection remain pending.

### D-050 — Forward event research must be scheduled before the release

**Status:** Confirmed; durable provider-neutral schedule and audit trail implemented. No runtime worker or external data call is connected.

**Decision:** Register each macro study before its scheduled release with pinned event, event-link and exposure-map versions and an exact symbol set. Create one five-minute pre-release baseline, one release capture, and per-symbol 1-, 5- and 30-minute reaction windows. Tasks are claimed transactionally by one worker, survive restart and require observations inside their stated windows with named data provenance.

**Boundary:** A task that passes its tolerance becomes `MISSED`; the application must not backfill it later and call it forward evidence. Claimed work is not silently reissued after a crash, so an uncertain capture remains visibly unresolved until explicitly failed. The scheduler itself has no provider, recommendation, mobile or broker authority. A supervised worker, reviewed real plans, provider rights and forward sample remain pending.

### D-049 — Macro event joins require reviewed identity and timing evidence

**Status:** Confirmed; pure integration component implemented with no scheduler, proposal or order authority.

**Decision:** A normalized official release, consensus row and symbol exposure may become one research observation only through an explicitly reviewed event-link record. The link pins the exact official and consensus event identities, event type, theme, reviewer, review time, rationale and source evidence. Joining also requires compatible release/schedule timing, a released standardized surprise based on at least 12 prior same-series observations, an active reviewed exposure-map version and a post-release market observation.

**Boundary:** The joiner does not infer event equivalence from titles, categories or timestamps and does not infer a company relationship. Missing or conflicting identities, timing, consensus, exposure or reaction evidence fail closed. The output is accepted by the existing append-only research journal and evaluator but remains `orderSubmissionAllowed: false`. Real crosswalks, provider licensing, scheduled capture and forward outcomes are still pending.

### D-048 — Theme-to-company exposure is reviewed data, not generated narrative

**Status:** Confirmed; append-only registry implemented with synthetic tests only. No production company mappings are approved.

**Decision:** Store every theme-to-symbol relationship in a named reviewed map version. Each relationship must specify a nonzero direction, bounded strength, effective interval, substantive rationale, and at least one timestamped HTTPS source classified as a regulatory filing, company report, official dataset, index methodology or regulator publication. Resolution always names both a map version and an as-of time.

**Change policy:** Draft maps cannot resolve. A version is content-addressed and idempotent; changing it under the same version is a conflict. A later reviewed version may explicitly supersede a known earlier version, but database triggers preserve the old map and its entries for replay. Expired, absent, duplicate, future-dated or weakly sourced relationships fail closed.

**Boundary:** The registry does not infer exposure from company names, tickers, headlines or model output. Initial production mappings must be curated and reviewed from primary evidence. A resolved exposure remains research-only and cannot bypass technical, liquidity, portfolio, broker or forward-validation gates.

### D-047 — Consensus data is provisional and surprise must be standardized within series

**Status:** Provisional Trading Economics adapter implemented; no subscription, configured key, provider approval or strategy integration.

**Decision:** Use a provider-neutral calendar contract and evaluate Trading Economics first because its documented schema separates actual, consensus forecast, provider forecast, previous/revised values, exact versus estimated timing, importance, official source and update timestamp. Accept only exact-time, medium/high-importance U.S. records. Keep `SCHEDULED`, `RELEASED_NO_CONSENSUS` and `RELEASED_WITH_CONSENSUS` distinct. Never translate missing actual or forecast values into zero.

**Surprise policy:** Preserve `actual − consensus` in native units, but never compare raw differences across indicators. Calculate the bounded surprise used by the research evaluator only when at least 12 strictly earlier observations of the same series exist and historical variance is nonzero. Future releases and other series cannot enter the calculation. Provider corrections remain separate fingerprints/revisions.

**Boundary:** Trading Economics requires an API subscription and its access, retention and redistribution terms must be reviewed before a key is configured. No purchase is authorized by this decision. The adapter keeps the key in an authorization header, limits queries to 31 days, and remains disconnected from the journal, mobile application, ranking and order paths.

### D-046 — Macro/event bias requires sourced events and confirming market reaction

**Status:** Confirmed direction; pure shadow evaluator and append-only evidence journal implemented with no provider, proposal or order authority.

**Decision:** Add a modular macro/news-event bias alongside the technical scanner. Every event must be timestamped and supported by a verified primary source or at least two independent sources. The mapping from the event or economic theme to a company must state its direction and strength rather than relying on a generated narrative. A fresh market snapshot must confirm the expected direction with price movement, relative volume, an explicit volatility band, acceptable spread and no halt. Record both positive `LONG` and adverse `AVOID_OR_EXIT` observations.

**Boundary:** Event evidence cannot rescue a candidate that fails core liquidity, spread, freshness or portfolio controls. The initial thresholds and weighting are test hypotheses. The component returns `orderSubmissionAllowed: false` and is not connected to the actionable recommendation queue. Before promotion, add trusted event and economic-calendar adapters, revision/correction handling, immutable exposure-map provenance, no-event controls, forward outcomes and comparisons by volatility regime. News reaction can be fast and already priced in; this design does not establish predictive value.

**Evidence progress:** The macro journal now requires exact source URLs and publication/retrieval timestamps, an event key and revision, exposure-map version and rationale, and market-data source/volume scope. Exact duplicates are idempotent; corrected events append as later revisions; database triggers block changes and deletion. Deterministic replay refuses unknown rulesets. This provides auditability but does not yet provide source-conflict resolution, consensus forecasts, scheduled capture or a forward sample.

**Source-adapter progress, 2026-09-20:** Fixed-host, bounded adapters now normalize the Federal Reserve monetary-policy RSS feed and BLS Employment Situation and CPI RSS feeds into one identification contract. Stable event IDs are distinct from content fingerprints so a correction can be detected. Official feed evidence is primary-source verified but remains `IDENTIFIED_NOT_SCORED`: the feeds do not provide a market consensus, so the system cannot calculate surprise. A parser exists for the documented BLS calendar ICS, including Eastern-time conversion, but the live endpoint returned HTTP 403 to automated GET and is not treated as available. No adapter output is automatically journaled, ranked or traded.

### D-045 — Intraday discovery remains timestamped research until validated

**Status:** Confirmed direction; evaluator, append-only journal, recorded-data importer and observation-outcome report implemented with no data-provider or order authority.

**Decision:** Build intraday opportunity discovery separately from the existing completed-daily recommendation strategy. Every observation must preserve what was known at its timestamp and report every failed or missing gate. The initial evaluator checks session, snapshot and quote freshness, halt state, coherent prices, day movement, opening gap, relative volume, session dollar volume and spread. Thresholds and score are proposed test variables. A passing result is a research observation, not a trade recommendation.

**Promotion boundary:** Before this lane can influence approval cards, add immutable capture and replay, validate provider timestamps and consolidated-volume semantics, link sourced catalysts, test false positives and late entries out of sample and in forward Paper observation, connect portfolio sizing and fresh broker validation, and separately approve its risk policy. It cannot size, approve or submit orders. BMNR is the first diagnostic fixture, not proof that the rules are profitable.

**Persistence and measurement progress:** The local journal records the exact snapshot, evaluation time, source, volume scope, ruleset and result. Exact repeats are idempotent; database triggers block update and delete; passing, failed and incomplete evidence all survive restart. Replay is chronological and re-evaluates only the current known ruleset, reporting unsupported historical versions instead of silently applying new logic. Recorded JSONL is validated before import. Outcome reporting uses the first eligible observation per symbol and New York session, fixed 5-minute and 30-minute windows, last-observed return and favorable/adverse excursion. Missing horizons remain incomplete. Observations are not fills; costs and market impact are excluded; no profitability claim is permitted. No live data is collected yet.

### D-044 — Repair legacy Paper protection without guessing

**Status:** Confirmed safety gate; no repair order has been placed.

**Decision:** The user authorized proactive Paper-only protection work without repeated step approvals. NVDA 25 and MSFT 2 are broker-attributed legacy-app holdings with no active sell orders. A repair must use a fresh complete Paper position/order snapshot, exact share attribution, no conflicting sell order, live and recent bid/ask, an explicit stop policy and a bounded dollar loss. It must be observed as accepted and active at IBKR before the app calls the holding protected. Never infer a stop from the old buy order or label a delayed quote as live. This authority does not extend to live accounts.

**Current blocker:** On September 18 during market hours, IBKR's Paper API quoted NVDA and MSFT with market-data type 3 (delayed). Separate live-only API requests for both symbols then returned IBKR warning 2186: additional API market-data subscription is required and delayed data is elected. Neither produced a live quote. One earlier read-only Paper API connection timed out before recovering. A pure, tested repair preflight now enforces the gates, but no stop price has been selected and no order was sent. A separate simulator evidence classifier handles replacement acknowledgement, rejection, partial sale, disconnect and stop/target race without treating intent as broker fact; it is not an execution adapter. New buying capacity and automatic Paper sells remain blocked until protection and the ordinary-exit lifecycle are independently verified. No paid market-data change was made.

**Entitlement clarification:** Live Client Portal inspection found Paper sharing already enabled, fee-waived non-consolidated US streaming quotes, API acknowledgement not certified, and unset market-data subscriber/non-commercial status. The Paper TWS chart also warned about a simultaneous live-username TWS session. Completing legal/API acknowledgements or subscriber classifications is the user's decision; no form was signed and no paid feed was added. These observations do not prove which single condition causes warning 2186 or guarantee live API access after a change. Retest the exact Paper API quote before considering any safety-gate release.

**Retest after user action, 2026-09-18:** The user signed the API acknowledgement; Client Portal now reports API access enabled. Subscriber/non-commercial classifications remain unset. Separate live-only, read-only Paper TWS API requests for NVDA and MSFT still returned 2186 with no live quote at 12:43 p.m. ET. The acknowledgement was necessary account housekeeping but not sufficient to pass the quote gate. Preserve all safety holds; verify session refresh and the exact entitlement with IBKR before any paid subscription decision. The diagnostic made no broker order or account change.

**Later portal state:** At 12:47 p.m. ET, Client Portal displayed Market Data Subscriber Status as Non-Professional; the separate Non-Commercial Form section was no longer visible. The current Paper TWS session still returned 2186 for an explicitly live-only NVDA request. A TWS re-authentication may be needed to test refreshed rights, but is not proven to fix the missing entitlement. No safety gate was released.

**Post-restart result:** Paper TWS restarted and accepted fresh read-only connections, but live-only NVDA and MSFT API requests still returned 2186 with no quote. A stale TWS session is not sufficient to explain the problem. Ask IBKR for the precise API entitlement/provisioning requirement rather than selecting a paid package by guesswork. The live quote, repair and automatic-exit holds remain in place.

**Simulator exit lifecycle:** A Paper-only pure state machine issues at most one target-replacement intent for a request ID and waits for a changed broker order before calling the exit working. It never cancels the stop to make way for a new sale and never resubmits an uncertain intent merely because a process restarted. The simulator verifies rejection, disconnect, restart, partial fill with oversized sibling stop, extra sell order, stop/target race, duplicate callback and same-account full-quantity closure evidence. This is not a production outbox, IBKR modification adapter, or proof that IBKR will rebalance siblings on partial fills. Automatic selling remains disabled until those separate gates pass.

**Durable intent boundary:** A simulator-only SQLite outbox now persists the exact request before dispatch and commits a one-time claim before handing back a descriptive broker command. A crash after the claim may mean the broker did or did not receive it; the app must reconcile, not blindly retry. Fresh broker evidence is required again at claim time, and conflicting/stale evidence blocks it. Rejected or formerly working intents cannot silently rearm after evidence is lost. One unresolved intent per Paper account/symbol is allowed. The outbox is not connected to TWS or the service worker; the existing automatic-sell release hold remains. An IBKR support ticket still needs user login and authorization to send account-specific diagnostics.

**IBKR support follow-up, 2026-09-18:** After the user signed in and asked us to proceed, submitted TWS API ticket #496671 about warning 2186 on read-only Paper live-quote requests. It asks IBKR to identify the exact entitlement, whether the included non-consolidated feed is API-eligible, and any remaining settings; it explicitly asks them not to purchase or change subscriptions. The support flow said responses are typically within 48 hours. An automated self-help answer suggests a separate Level 1 off-platform subscription, but it did not identify the exact entitlement for this account, so the live-quote gate remains closed until a broker-confirmed answer and a successful read-only retest.

### D-043 — Reconcile terminal Paper orders without guessing from absence

**Status:** Confirmed; simulator-tested, with read-only IBKR callback verification.

**Decision:** A missing open order is not proof that an entry was rejected or cancelled. Request IBKR's completed-order feed and accept an explicit terminal status as evidence. Never infer an entry fill from a completed-order callback without execution evidence; preserve a previously observed partial fill if the remaining shares are later cancelled. Release reserved strategy capital only after the unfilled entry's terminal state is broker-confirmed. Show an aged reconciliation as stale rather than connected/current. An unfilled manual order remains visible in Activity but does not change share provenance; an observed external execution does.

**Safety boundary:** This improves observation, not order authority. It does not create protective stops for existing holdings or enable automatic selling. The September 18 read-only Paper snapshot confirmed NVDA 25/MSFT 2 and no open orders for either. The private trade report and historical app code show that the net shares match buys made by an early single-order version that had no bracket exits. A stop price must not be invented or placed silently; no broker order was placed or changed.

### D-042 — Sequence the paper product around trustworthy evidence

**Status:** Confirmed delivery sequence; individual strategy changes remain subject to their own review.

**Decision:** First establish strategy-owned share quantities, broker-visible protection and an explainable sleeve budget. Next prove the complete paper order lifecycle, then produce fee-aware, broker-grounded performance reports. Only then compare the current recommendation strategy with the broader shadow scanner and planned news/theme lane for promotion to actionable cards. Mobile notifications and daily-use polish follow reliable states; external-user and live trading require separate production, legal and data-rights gates. See the prioritized roadmap in `PROJECT_PLAN.md` for acceptance criteria.

**Safety boundary:** Automatic paper exits remain disabled during ownership and protection work. The roadmap does not authorize paper orders, order cancellation, or live trading. A small or incomplete paper sample cannot establish that the strategy makes money.

**Implementation progress:** Read-only broker/ledger ownership and linked-stop comparison is visible in Positions and strategy budget. Conflicts or missing protection block new strategy capacity. CVX, MRK and DE match current recorded fills and linked stops. On September 18, the IBKR Paper Transaction History netted to 25 NVDA and 2 MSFT shares. The source lacks stable order references; matching broker quantities do not prove application ownership. A private local historical-evidence record now surfaces this distinction and vetoes a mismatched quantity, while the two positions remain unverified for automatic sale. No paper sale was authorized by this work.

**September 18 safety check:** Automatic paper sells remain disabled. The cancel-before-submit adapter was changed to reject any request that would cancel protective orders, before connecting to IBKR. The worker also refuses that path and records the reason. This is a fail-closed hold, not a completed replacement-sale workflow. A read-only CVX API quote returned delayed type 3 before the opening bell; live-quote availability and the partial-fill/rejection/reconnect lifecycle remain release blockers.

### D-041 — Measure the current paper strategy before news-driven recommendations

**Status:** Current work priority confirmed; news-event and theme design is a plan, not an implemented strategy.

**Decision:** First inspect today's recommendations, broker-reconciled positions, open orders, protection, fills, and remaining strategy capital without submitting trades. Record a future event/theme lane that distinguishes a macro narrative, a company's evidenced direct or indirect exposure, and an actual trade-timing catalyst. It must be source-linked, timestamped, correction-aware, and evaluated in shadow mode before it can affect ranking or proposals.

**Safety boundary:** Current news and filings remain research context. AI explanations cannot alone create orders. Unverified, stale or ambiguous events produce `WATCH`/`NO TRADE`, not forced activity. Existing paper approval and broker validation remain in force; no live authority is implied.

**Reason:** A thesis such as AI-related water demand can be meaningful without proving that a particular company's revenue benefits or that today is an appropriate entry. The existing strategy must be measured before introducing a second signal that would confound its performance.

### D-040 — Broader, higher-volatility equity research is shadow-only

**Status:** Provisional; initial scanner implemented, investment merit unvalidated.

**Decision:** Explore active, tradable U.S.-listed common equities beyond the existing top-500 universe, including eligible names from the user's thematic watchlist, in a separate read-only shadow lane. Do not treat watchlist symbols as holdings. Keep OTC and obvious non-common-stock instruments out. Completed daily momentum, volatility, and relative-volume thresholds are test variables; zero candidates is valid.

**Boundary:** The lane cannot create app proposals, approval receipts, paper or live orders. IEX volume is venue-specific, not consolidated liquidity. Every shadow result explicitly lacks verified catalyst, current bid/ask spread, portfolio sizing and fresh broker validation. Do not promote candidates to the actionable queue until those data, out-of-sample testing and a separately reviewed risk policy exist.

**BMNR diagnostic, 2026-09-18:** BMNR was not missed by universe discovery: it ranked 168th in the main top-500 cache. On the September 17 completed IEX daily signal, it failed the main strategy's $50 million 20-day average dollar-volume floor ($46.44 million), required close > 50-day average > 200-day average (the 50-day average was below the 200-day average), and 6% maximum ATR (7.75%). The separate shadow cache was last refreshed September 17 and failed five-day momentum (0.0% versus 2% minimum) and relative volume (0.17 versus 1.3 minimum). The user's roughly 10% September 18 intraday rise was not observable by either completed-daily scan at decision time. This is evidence for adding and evaluating an intraday discovery lane, not evidence that chasing an already-risen stock would be profitable or safe. Do not silently relax thresholds or promote the shadow lane.

**Reason:** The current top-500 liquid-momentum strategy often favors familiar large-cap stocks and cannot answer whether a carefully constrained, less conservative universe offers useful opportunities. Increased volatility is not evidence of higher expected return.

### D-039 — Deterministic automatic ordinary exits in IBKR Paper

**Status:** Confirmed direction; initial worker implemented but operationally disabled in the local paper service pending safety verification. Supersedes D-017 for paper ordinary exits only once the safety gate is met.

**Decision:** With an explicit local feature flag, a paper holding may be sold automatically only after it explicitly fails the same strategy scan on two distinct consecutive completed trading dates. Missing, stale, or absent scanner data cannot count as a failure. Replacement buys still require approval.

**Execution boundary:** The worker must verify the IBKR Paper account, reconciled held quantity, live bid/ask with bounded local callback age, acceptable spread, and ownership and state of protective sell orders. The previous cancel-then-submit implementation is explicitly blocked; no automatic replacement sale may be transmitted until a protection-preserving lifecycle is designed and fault-tested. Live accounts remain ineligible.

**2026-09-17 safety hold:** A read-only audit found that broker holdings can include shares not proven to belong to this strategy, while some held positions have no broker-visible stop. Although the scanner now reports explicit held-symbol pass/fail results, automatic paper selling stays off until ownership, protection and the end-to-end exit behavior are proven. Scanner repair alone is not permission to transmit an order.

**User preference and additional finding:** The user explicitly wants automatic ordinary selling in IBKR Paper. The present adapter cancels existing exit protection before a replacement sale is confirmed, which can leave shares unprotected on a failed submission. IBKR quotes currently fall back to delayed type 3. Do not enable this implementation merely by flipping the feature flag. Consecutive-session and live-quote checks have been tightened; redesign and fault-test the cancel/replace lifecycle, resolve share provenance and confirm data access before activation.

**2026-09-18 follow-through:** The adapter now rejects a request to cancel protection before connecting, and the worker records that path as blocked. A post-open read-only CVX quote still reported delayed type 3. Automatic exits additionally require bid and ask callbacks received within five seconds, but local callback arrival does not establish the exchange quote timestamp. Unit tests cover those failures; automatic selling remains off. The unresolved release gates are market-data access, historical ownership, and a protection-preserving exit workflow through rejection, partial fill, reconnect and restart.

**2026-09-18 release hardening:** A successful scan is insufficient if its held-symbol result is stale, errored or missing any required rule result. The exit policy now requires an exact prior-session signal date and a complete evaluation; a holiday without an authoritative calendar fails closed. The latest cached signal was September 17. Both the service worker and directly invoked paper-exit adapter have an explicit code-level release hold; setting the environment flag cannot bypass it. No automatic sale is permitted until the protection-preserving broker lifecycle and live quote access are verified. These holds do not affect existing broker-side stop/target orders.

**Runtime evidence:** The restarted service reports complete Paper reconciliation but incomplete ownership (NVDA/MSFT), and the 9:52 a.m. ET read-only CVX API quote remains delayed type 3. TWS's non-consolidated-data banner is insufficient to clear the API live-data gate. No order was placed, cancelled or modified.

**Later September 18 correction:** The initial Transaction History view could not show submitting-app identity. A separate 365-day Paper Activity Flex Query with audit-trail fields did: all 24 NVDA executions (15 broker orders, net 25 shares) and the one 2-share MSFT execution carry `trade-approval-…` references and `IsAPIOrder=Y`. A validated private import now establishes legacy application origin, repairs past `external` misclassification of such references, and distinguishes this evidence from current-ledger fills. Both holdings are now strategy-owned in the read-only Positions view. They still lack broker-visible protective stops, original decision records in the current ledger, and a safe automatic-exit lifecycle; available strategy capital is $0 and automatic sells stay disabled. The broker report was generated and imported without placing or changing any order. If future broker quantity or unrelated activity contradicts this dated report, attribution fails closed pending fresh evidence.

**Protection invariant:** A stop larger than the remaining strategy-owned position is not `verified`. This became visible in an adversarial simulated partial-target-fill scenario, which now labels `overcovered` and blocks capacity and unattended exits. It is a test of app behavior, not a claim about IBKR's normal bracket rebalancing. A protected-exit design may investigate modifying the existing linked target rather than canceling its stop, but adoption requires verified IBKR Paper order-state evidence and tests for partial fills, rejection, disconnect, restart and duplicate submission.

**Reason:** This allows the agreed unattended downside/thesis management to be tested without granting automatic buy authority or treating a single noisy daily signal as sufficient evidence.

### D-038 — Full allocation triggers a portfolio review

**Status:** Confirmed; review layer implemented.

**Decision:** When the configured trading sleeve has no capacity, the engine must evaluate reconciled holdings against the same current scan and visible broker protection. It labels supported, protected positions as holds; flags unsupported or unprotected positions for exit review; and identifies possible replacements without treating sale proceeds as available.

**Safety boundary:** Exit review is information, not execution authority. Each ordinary paper sale still requires a separate approval and confirmed broker fill. Only after reconciliation confirms that fill may the engine refresh prices, recalculate cash and create a replacement buy proposal.

**Reason:** “Allocation fully deployed” describes capacity but does not answer whether the existing allocation still fits the strategy. The portfolio review closes that product gap without pretending a two-leg rotation is atomic.

### D-045 — Continue scanning at full allocation and permit only profitable ordinary rotations

**Status:** Confirmed; portfolio-review screening implemented.

**Decision:** A fully allocated sleeve continues scanning the market. When a currently qualified candidate has a higher recommendation score than a strategy-owned holding, the review may identify the weakest qualifying holding as a possible rotation only when its completed-close estimate is at or above average cost. This is a preliminary screen, not executable profit evidence.

**Execution boundary:** Before an ordinary sale can be proposed, a fresh broker quote and estimated transaction costs must show expected net proceeds at or above cost basis. The sale is approved and filled first; only then may reconciled cash fund a newly generated replacement buy. A protective stop or independently approved emergency exit may still realize a loss and is never blocked by the ordinary-rotation profit preference.

**Reason:** Full allocation should not stop opportunity discovery, but rotating merely because another score is marginally higher can create churn, costs and stale two-leg assumptions. Separating profitable ordinary rotations from downside protection preserves both portfolio improvement and risk control.

### D-037 — Separate broker-free CI from IBKR Paper verification

**Status:** Confirmed; CI foundation implemented.

**Decision:** Every push and pull request runs a clean, deterministic, credential-free quality gate. Tests that connect to TWS or exercise real IBKR Paper behavior are separately named and gated and can never target a live account.

**Reason:** Routine verification must be repeatable and safe, while broker integration still needs direct evidence under tightly controlled conditions. Combining the two would make CI unreliable and could accidentally grant order authority to ordinary code checks.
**Evidence:** `npm test`, `.github/workflows/quality.yml`, and `QA.md`. Deterministic broker simulation, mobile automation, paper smoke testing and operational resilience remain subsequent milestones.

### D-001 — Human approval is required before every order

**Status:** Superseded by D-017
**Decision:** The research and recommendation system may scan, calculate quantity, choose order parameters, and propose timing. It must not place an order until the user explicitly approves that specific trade.  
**Reason:** The product is a decision-and-execution assistant, not an autonomous trading bot.  
**Implications:**

- Approval must be tied to an immutable proposal and expire quickly.
- Approving one proposal cannot authorize a different symbol, quantity, price, side, or account.
- Denial and expiration must never place an order.
- Live trading will require additional safeguards beyond the paper prototype.

### D-002 — Use IBKR Paper as the first execution environment

**Status:** Confirmed  
**Decision:** Integrate and validate the complete workflow against the Interactive Brokers paper account before any live trading.  
**Reason:** IBKR provides API access, simulated order handling, mobile account access, and a path from testing to live execution.  
**Implications:** Paper fills are useful evidence but do not reproduce real liquidity, slippage, queue position, or every complex order behavior.

### D-003 — Keep the trading service on the Mac

**Status:** Confirmed  
**Decision:** The phone app is the review and approval interface. A local service on the Mac communicates with Trader Workstation and performs broker operations.  
**Reason:** TWS exposes its socket API locally; credentials and broker connectivity should not be embedded in the mobile client.  
**Implications:** TWS, the service, and the Mac must be available for paper execution. A production version will eventually need a more resilient hosted or dedicated runtime.

### D-004 — Use Tailscale during prototyping

**Status:** Confirmed  
**Decision:** Connect the iPhone to the local Mac service over a private Tailscale network rather than exposing the service publicly or relying only on local Wi-Fi.  
**Reason:** It supports private remote access while the prototype remains Mac-hosted.  
**Implications:** Both devices must be signed in and connected to the same tailnet.

### D-005 — React Native with Expo is the frontend foundation

**Status:** Confirmed  
**Decision:** Start with iOS while retaining a path to Android and web through React Native and Expo. Use Expo Go for rapid prototyping and TestFlight/development builds for realistic distribution testing.  
**Current UI foundation:**

- React Native
- Expo
- `@shopify/restyle` design tokens
- Phosphor icons
- Custom product components rather than a large prebuilt component library

### D-006 — Recommendation cards prioritize decision-critical information

**Status:** Confirmed  
**Decision:** A stock card should immediately communicate the action, amount, current price, quantity, limit price, risk score, decision expiration, rationale, and approval controls. Secondary details remain progressively disclosed.  
**Design direction:** Minimal iOS-like styling, subtle shadows, light-gray pills for compact statuses, and a sticky action area.

### D-007 — Browsing does not resolve cards

**Status:** Confirmed  
**Decision:** Swiping or tapping left/right navigates through the stack. A card leaves the active stack only after the user presses Approve or Deny.  
**Reason:** Navigation gestures must not accidentally become financial decisions.

### D-008 — No trade is a valid outcome

**Status:** Confirmed  
**Decision:** The scanner must not manufacture daily activity. Some days can produce no stock or options recommendations.  
**Reason:** Opportunity quality and rule compliance take priority over recommendation frequency.  
**Implications:** The home screen must still provide useful market and portfolio context on no-trade days.

### D-009 — Home has four primary destinations

**Status:** Superseded  
**Decision:** The home/scanner page provides separate entry points for:

1. Stock opportunities
2. Options opportunities
3. Portfolio actions
4. Market review

**Reason:** Opening opportunities, existing-position decisions, and informational research have different urgency and workflows.

### D-010 — Options use a separate review stack

**Status:** Superseded  
**Decision:** Do not mix stock and options approvals in the same default card stack.  
**Reason:** Options require contract expiration, strike, premium, multiplier, break-even, maximum loss, liquidity, and assignment information. The same approval gesture should not obscure fundamentally different exposure.  
**Implications:** An eventual combined opportunities page may link into the appropriate specialized stack.

### D-011 — Initially limit options to defined-risk strategies

**Status:** Provisional  
**Decision:** If options are added, begin with long calls/puts, covered calls against verified holdings, and later defined-risk vertical spreads. Exclude naked options, undefined-risk structures, and zero-days-to-expiration trades from the prototype.  
**Validation needed:** Options permissions, market-data quality, liquidity rules, paper-simulator behavior, and strategy evidence.

### D-012 — Risk includes position and portfolio impact

**Status:** Confirmed  
**Decision:** Risk cannot be based only on the security's volatility. The assessment must include the proposed amount, stop distance or maximum loss, concentration, existing correlated exposure, liquidity, event risk, and portfolio-level loss limits.  
**Architecture direction:** Keep risk inputs and scoring components modular and versioned. An incomplete assessment must be labeled incomplete rather than assigned false precision.

### D-013 — Paper testing has two scorecards

**Status:** Confirmed  
**Decision:** Evaluate paper trading across two independent dimensions:

**Automation confidence**

- Broker uptime and readiness
- Preview and What-If success
- Submission and fill tracking
- Correct symbol, side, quantity, account, and price
- Duplicate prevention and recovery behavior

**Strategy performance**

- Return and benchmark-relative return
- Win rate, average gain, and average loss
- Expectancy and profit factor
- Drawdown
- Maximum favorable and adverse excursion
- Results by signal, market regime, holding period, and risk bucket

**Caveat:** Simulated fills are not proof of equivalent live results.

### D-014 — Record every recommendation outcome

**Status:** Confirmed  
**Decision:** Persist approved, denied, expired, rejected, and unselected recommendations—not only executed trades.  
**Reason:** Measuring only approved trades introduces selection bias and prevents evaluation of the recommendation engine and the user's decision contribution.

### D-015 — Unify broker readiness

**Status:** Confirmed
**Decision:** Replace contradictory connection flags with one authoritative broker-readiness model. Scanner-data availability should be represented separately from TWS/API availability.  
**Reason:** The prototype can currently show a green “Paper connected” chip while disabling decisions because a separate scanner flag failed.  
**Implementation:** Decision controls now use the broker snapshot and broker-connection status only. Snapshot calls are serialized, background checks pause during order workflows, the scanner has a separate TWS client ID, and three consecutive health-check failures are required before showing Paper offline.
**Acceptance criteria:** The visible status, button availability, and error message must all describe the same execution state and identify the exact failed stage.

### D-016 — Keep a versioned architecture source of truth

**Status:** Confirmed

**Decision:** Maintain the current application diagram, component responsibilities, implementation status, and architecture history in `ARCHITECTURE.md`.

**Reason:** The system spans research, risk, approval, execution, reconciliation, user interfaces, and evaluation. A maintained source of truth prevents different conversations and implementation workstreams from developing incompatible mental models.

**Implications:** The Mermaid definition in the repository is authoritative; derived FigJam diagrams should be regenerated after material updates. Future project tasks are instructed through `AGENTS.md` to read and maintain both the architecture and decision log.

### D-017 — Recommend buys only; require approval for ordinary profit-taking

**Status:** Confirmed  
**Decision:** The recommendation engine may propose opening long stock positions only. The user must explicitly approve every buy. Buy approval authorizes the disclosed protective stop, but an ordinary profit-target sale requires a new user approval. Automatic profit-taking is permitted only as a predefined exception for an urgent, time-sensitive, or unusually volatile condition.
**Reason:** Protective selling prevents an open position from continuing to deteriorate when the user is unavailable. Ordinary profit-taking is less urgent and should preserve the user's control over whether and when to exit.
**Initial implementation:** Submit the approved paper buy with an attached GTC protective stop. Treat the displayed profit target as a monitoring threshold that creates a sell-approval request rather than an automatically transmitted sell. Define and test objective emergency-exit rules before allowing any automatic profit-taking exception.
**Implications:**

- The card and final confirmation must disclose the entry, stop, target, quantity, estimated loss, and fact that the exits are automatic.
- The approval token must bind the protective stop and entry terms. The target remains part of the recommendation and monitoring record but is not authorized for automatic sale.
- The engine cannot recommend a short position or an unapproved standalone sell.
- Exit orders may sell only the quantity filled by the associated strategy entry.
- Manual broker activity must be reconciled before modifying or replacing exits.
- A stop price limits trigger conditions but cannot guarantee the execution price during gaps or fast markets.
- Existing broker-held protective orders remain active during an app or Mac outage unless explicitly cancelled at the broker.
- “Urgent,” “time-sensitive,” and “volatile” must be expressed as deterministic, auditable thresholds; an AI-generated rationale alone cannot authorize an automatic profit sale.

### D-018 — Support an explicit in-app light/dark appearance control

**Status:** Confirmed
**Decision:** Place a compact Phosphor sun/moon toggle beside the broker-status pill. The selected appearance changes the full interface through shared semantic color tokens, including cards, sheets, controls, and the system status bar.
**Reason:** Appearance is a user preference and must not alter or obscure broker connectivity, risk, or order state. A separate icon control keeps that preference distinct from the execution-status pill.

### D-019 — Preload a bounded recommendation queue

**Status:** Superseded by D-020
**Decision:** The recommendation service returns up to three ranked, fully prepared proposals. Each proposal has its own exact order terms and expiration. Swiping or tapping only browses this queue; a proposal is removed only after its approval or denial is successfully recorded.
**Reason:** The next card should be immediately readable without a blank or loading flash, while financial decisions must remain explicit and recoverable. A bounded queue also limits stale quotes and unused approvals.
**Initial implementation:** Eligible cached Alpaca candidates are ranked, then checked one-by-one against a fresh IBKR quote and the 0.25% spread limit. Proposal lifetimes are 10 minutes below 3% ATR, 5 minutes from 3% to below 5% ATR, and 2 minutes at 5% ATR or above. Submission still rechecks price, account, receipt, bracket terms, notional, and remaining strategy capital.
**Prototype limitation:** The queue and decision state are held in service memory. A restart discards unresolved queue state; durable persistence and broker reconciliation remain required before production use.

### D-020 — Recommendation count is market- and portfolio-driven

**Status:** Confirmed
**Decision:** Evaluate the full eligible universe and preserve every candidate that passes the current strategy and fresh execution checks. Zero, one, or many recommendations may be produced. A page size, preload window, or card batch may optimize delivery but must never determine investment eligibility.
**Reason:** A fixed card count can suppress legitimate opportunities or encourage the system to manufacture activity. Market quality, current broker conditions, portfolio capacity, and risk policy are the correct constraints.
**Implementation:** The local MVP no longer stops after three candidates. It returns all candidates that pass the completed-daily-data scan and fresh IBKR spread validation. Intraday signals and portfolio eligibility remain future milestones.
**Implications:** Once generated, a displayed proposal keeps immutable terms until decision or expiry. The engine must separately report qualified, actionable, and capacity-blocked counts.

### D-021 — Portfolio rotations are sequential and contingent on confirmed fills

**Status:** Confirmed
**Decision:** The engine may eventually propose replacing an existing position with a stronger opportunity, but it may not assume that approved sale proceeds are available. A rotation executes the sale first, confirms its fill, refreshes cash and portfolio risk, and only then regenerates and revalidates the buy.
**Reason:** Approvals, fills, settlement, prices, and portfolio exposure can change between the two legs. Treating a rotation as an atomic swap would create unfunded or stale orders and obscure two distinct investment decisions.
**Prerequisites:** Durable ledger, IBKR reconciliation, authoritative portfolio snapshot, portfolio-aware sizing, and explicit trading-sleeve policy.
**Initial UI categories:** Actionable with cash, qualified but capacity-blocked, and possible rotation.

### D-022 — Use a local SQLite trading ledger with immutable, idempotent lifecycle records

**Status:** Confirmed  
**Decision:** Store proposals, decisions, submission attempts, broker-order identities, and lifecycle events in a versioned local SQLite database. Proposal terms are immutable after creation, a proposal may have only one decision, and every broker submission uses a durable unique idempotency key.  
**Reason:** In-memory maps and sets lose intent and duplicate protection when the service restarts. The application needs durable evidence before it can reconcile broker state or report trustworthy performance.  
**Implementation status:** The schema and storage API are implemented and the proposal-through-submission service path now writes to the ledger. Startup restores unresolved proposal and decision state, validation results are recorded, and submission idempotency survives restarts. IBKR reconciliation, fill import, unselected recommendations, and Activity reads remain in progress.

### D-023 — Position sizing must be deterministic, portfolio-aware, and explainable

**Status:** Confirmed
**Decision:** Calculate whole-share quantity from the most restrictive current constraint, including loss at the stop, settled cash, available funds, buying power, configured cash reserve, daily and total open-risk budgets, position and total exposure, sector and correlated exposure, liquidity, pending buys, and open-position count.
**Reason:** Confidence scores and available cash alone cannot establish a safe amount. The user must be able to see which policy constraint determined the recommendation.
**Safety boundary:** Missing, invalid, future-dated, or stale portfolio data produces an `INCOMPLETE` result with no recommended amount. A possible rotation is classification only and cannot authorize either leg.
**Implementation status:** The pure calculation model and unit tests are implemented independently of broker and ledger code. Reconciled IBKR inputs and user-configured policy are required before it replaces prototype sizing.

### D-024 — Denial triggers recommendation recalculation without changing cash

**Status:** Confirmed
**Decision:** A successful denial records no order and reserves no cash. It invalidates the remaining displayed proposals and rebuilds them from the current strategy capacity and fresh execution quotes before showing the next card.
**Reason:** The next card should reflect current portfolio capacity rather than retain order terms calculated against an earlier snapshot. Displayed and denied proposals must never consume buying capacity.
**Recurrence rule:** The denied symbol remains excluded for the same completed-data signal date so continuous scanning does not immediately recreate the rejected idea. A later trading signal may qualify again.
**Future integration:** Once reconciliation is authoritative, the same refresh will use reconciled settled cash, pending commitments, positions, fills, and portfolio risk.

### D-025 — Adaptive sizing operates only inside editable user limits

**Status:** Confirmed
**Decision:** Provide smart paper defaults and an accessible Settings page, while preserving user-editable hard limits for the trading sleeve, risk, deployment, cash reserve, concentration, and simultaneous positions. Adaptive conditions may reduce effective operating limits but may never raise them above the saved limits.
**Reason:** Market-aware sizing is useful only when it cannot silently expand the amount the user has authorized. Separating hard boundaries from an adaptive multiplier keeps control understandable and auditable.
**Implementation:** The hamburger menu opens Settings. The authenticated Mac service persists and validates the policy. The page previews an operating level using available observed-risk and broker states.
**Safety boundary:** The adaptive preview does not yet control submitted amounts. It becomes authoritative only after reconciled portfolio inputs and a versioned market-regime model are connected and tested.

### D-026 — Treat go-to-market validation as a separate product workstream

**Status:** Confirmed direction; customer demand and pricing remain hypotheses to validate.
**Decision:** Develop a dedicated GTM workstream for inexperienced and intermediate self-directed investors who want researched, clearly explained, automatically sized trade proposals without building and operating their own AI system. Position the application around convenience, clarity, user control, risk discipline, and reliable broker execution—not promised profits.
**Primary hypothesis:** People with investable savings, limited active-trading experience, and limited time may pay for an approval inbox that combines market scanning, rationale, sizing, risk context, execution, monitoring, and an auditable history.
**Validation required:** Test brokerage-connection completion, repeated recommendation review, comprehension, approval/denial behavior, retention over four to eight weeks, willingness to pay, and trust after losing or rejected trades. Pricing discussed so far is only a hypothesis and is not yet a decision.
**Separate opportunity:** Explore a standalone educational product that teaches technically inclined customers how to build and operate their own recommendation engine and connect it through a documented interface. Keep this distinct from the hosted application in positioning, support, security boundaries, pricing, and legal review.
**Safety and compliance boundary:** User acceptance of investment risk and the absence of performance claims do not by themselves settle whether specific compensated recommendations constitute regulated investment advice. Obtain qualified securities counsel before offering personalized recommendations or live brokerage execution publicly.

### D-027 — Build portfolio state only from complete broker reconciliation snapshots

**Status:** Confirmed and foundation implemented.
**Decision:** Collect balances, positions, open orders, and executions together in a dedicated read-only IBKR Paper reconciliation request. Persist the source snapshot and broker activity before exposing the derived portfolio view.
**Reason:** Independently timed balance, position, and order requests can describe different account states. Sizing and safety checks require a traceable snapshot with an explicit capture time and completeness state.
**Manual activity:** Classify stable broker identities and order references as application-linked or external. External activity must be surfaced and incorporated rather than silently overwritten by the application ledger.
**Safety boundary:** Missing core balances, positions, orders, executions, partial callbacks, a non-paper environment, or stale data produce `INCOMPLETE`. Settled cash and account-level realized/unrealized P/L are optional reporting fields because IBKR Paper may omit them; their absence remains explicit and net trade P/L still requires execution-level fees. Broker evidence may resolve an unknown submission only when its application order reference matches a unique durable decision; reconciliation never retransmits an order. A colliding shortened reference is left unresolved rather than guessed, and permanent IBKR order identity is preferred when available.

### D-028 — Preview Mode mirrors the complete product structure

**Status:** Confirmed and implemented.
**Decision:** Maintain one explicit app-wide Preview Mode that renders the same recommendation, Activity, Positions, Settings, navigation, appearance, and interaction components as the operational app while substituting realistic fixture data at the data boundary.
**Reason:** Design review should cover complete and believable states without requiring TWS, market hours, accumulated trades, or one-off preview screens that can drift from production UI.
**Interaction:** Replace the hamburger's native alert modal with an animated left-side navigation panel that provides navigation and an explicit enter/exit Preview Mode action.
**Safety boundary:** Preview Mode replaces the broker-status pill label rather than adding a layout-shifting banner, performs no broker actions, does not fetch broker history, and saves setting changes only for the current preview session. Recommendation cards measure their remaining vertical space and show as many rationale lines as fit while keeping actions inside the viewport; tapping the adaptive truncation opens the complete text and key risks in the existing sheet.

### D-029 — A missing recommendation must have an explicit scanner state

**Status:** Confirmed and implemented for regular weekday hours and weekends.
**Decision:** When no card is visible, distinguish broker checking/offline, scanner paused, actively scanning, no qualifying setup, after-hours, and weekend standby in both the status pill and empty-state copy.
**Reason:** A connected broker does not imply that a recommendation is loading or that a qualifying opportunity exists. Users need to understand whether the system is working, intentionally waiting, or unavailable.
**Session boundary:** Do not request new recommendations outside regular U.S. market hours. Explain when scanning resumes. Exchange holidays and exceptional market schedules require an authoritative calendar before production use.

### D-036 — Recycle strategy capital and report closed-trade profit conservatively

**Status:** Confirmed and foundation implemented.
**Decision:** Replace the permanently increasing allocation counter with a ledger-derived strategy budget. Submitted entries reserve approved notional, confirmed fills become invested capital, and confirmed target, stop, or ordinary exit fills release capital for new recommendations.
**Profit reporting:** Match buys and sells through immutable application proposals and broker order references. Show gross profit when an exit is confirmed. Label profit as net only when commissions for both entry and exit are present; missing fees must remain explicit rather than estimated or treated as zero.
**Interface:** Present one understandable trade lifecycle instead of exposing each bracket leg as a primary row. Use plain-language order states and separate open trades, closed trades, and unresolved/pending activity.
**Safety boundary:** Broker reconciliation remains authoritative. Ambiguous historical or external activity is never guessed into strategy performance. Incomplete broker snapshots continue to fail closed for portfolio-aware sizing, and paper results do not establish live profitability.

---

## Open decisions

### Crypto design review — D-030 through D-032

Review [CRYPTO_DESIGN.md](./CRYPTO_DESIGN.md): Coinbase Exchange/Gemini sandbox selection, USD spot scope, separate simulator authority and database, decimal-library choice, capped single-unwind response, cancel-only Emergency Stop, and client control lease. Actual sandbox capability and connectivity remain unverified. No session capital/time limits have been approved.

### O-001 — Recommendation strategy and evidence threshold

- Which stock strategies will graduate beyond research/shadow mode?
- What backtest, out-of-sample, and paper-trading evidence is required?
- What benchmark and minimum sample size will be used?

### O-002 — Market and research data providers

- Which source supplies real-time quotes, historical bars, fundamentals, filings, news, earnings dates, and options-chain data?
- Which information comes from IBKR versus independent providers?
- What are the licensing implications for a public App Store product?

### O-003 — Production service architecture

- Continue with a dedicated Mac, move to a secure hosted execution service, or support a user-operated agent?
- How are authentication, secrets, uptime, reconnects, and broker sessions handled?

### O-004 — Options recommendation frequency and strategy scope

- How often will underlying candidates trigger an options scan?
- Which liquidity, spread, open-interest, volatility, and expiration rules are mandatory?

### O-005 — Live-trading graduation criteria

- Required duration and number of paper observations
- Maximum tolerated system error rate
- Initial live position and daily-loss limits
- Conditions that automatically return the system to paper-only mode

### O-006 — GTM, customer segment, and willingness to pay

- Which novice-to-intermediate self-directed investor has the strongest problem and highest willingness to pay?
- Is the winning promise convenience, disciplined decision-making, research compression, execution reliability, or a combination?
- Which paper-only beta behaviors predict paid retention?
- What subscription price and trial structure convert without implying performance guarantees?
- Should the build-your-own-engine education product be a course, documentation package, community, or developer toolkit?
- What engine interface and certification rules protect the app when customers connect third-party or self-built agents?

---

## Change history

### 2026-09-17 (priority update)

- Added D-041: evaluate today's existing paper strategy and allocation first; defer source-linked news/theme event detection as an isolated, shadow-tested future lane.

### 2026-09-17

- Added D-040 and architecture 3.22 for the isolated higher-volatility shadow research lane; no order authority or strategy promotion.

### 2026-09-11

- Added D-035: stock-specific headline integration with existing Alpaca access; news remains independent research context rather than a trading signal.
- Added D-036: ledger-derived capital recycling, conservative closed-trade profit accounting, and trade-oriented activity presentation.

### 2026-09-10

- Added D-034 and the MVP assessment. Public read-only production data, later 0x observation and unattended operation remain proposals; original implementation review gate remains in force.

### 2026-09-07

- Clarified crypto has no IBKR dependency; proposed broad token discovery separately from sandbox executable pricing in architecture 3.13.
- Recorded the user's isolated paper crypto scope and explicit design review gate.
- Proposed separate sandbox market adapters, simulated account authority, crypto ledger/reconciliation and session control semantics without marking them implemented or approved.
- Added CRYPTO_DESIGN.md and architecture 3.12; preserved pre-existing stock code and documented exit-policy drift without changing it.

### 2026-08-31

- Created the decision log.
- Consolidated decisions made during prototype design, IBKR Paper integration, risk-model planning, card interaction design, home navigation, options separation, and performance measurement.
- Confirmed and implemented unified broker readiness and collision-resistant IBKR connection checks.
- Established `ARCHITECTURE.md` as the versioned architecture source of truth and added continuity instructions for future tasks.
- Reorganized architecture version 3.0 as a time-ordered lifecycle and reconciled the latest approved exit policy.
- Added a shared dark appearance and a Phosphor sun/moon toggle beside broker status.

### 2026-09-05

- Confirmed a bounded recommendation queue that preloads up to three complete cards.
- Kept browsing non-destructive and tied removal to a successfully recorded decision.
- Made proposal expiration volatility-tiered and documented the in-memory prototype limitation.

### 2026-09-06

- Superseded the fixed three-card queue with a market- and portfolio-driven recommendation-set policy.
- Confirmed that sell-to-buy rotations must wait for a confirmed sale fill and fresh portfolio revalidation.
- Added the implementation sequence and acceptance criteria to `PROJECT_PLAN.md`.
- Added the SQLite durable-ledger foundation and verified restart-safe proposal, decision, and submission idempotency behavior.
- Added the deterministic portfolio-sizing foundation with explicit binding constraints and fail-closed freshness checks.
- Made denial trigger a fresh recommendation calculation without changing or reserving cash.
- Added persisted, editable adaptive paper-policy settings with hard-limit enforcement.
- Connected the runtime proposal, decision, validation, submission, and acknowledged bracket-order path to the ledger; ambiguous submission outcomes now require reconciliation rather than retrying.
- Established GTM validation as a separate workstream focused on novice-to-intermediate investors paying for convenience, clarity, control, and reliable execution.
- Recorded a separate educational opportunity for teaching customers to build their own compatible recommendation engines.
- Added the read-only IBKR reconciliation collector, durable reconciliation records, manual-activity classification, and a freshness-gated authoritative portfolio foundation.
- Consolidated recommendation, Activity, Positions, and Settings fixtures into a visibly labeled app-wide Preview Mode and replaced hamburger alert navigation with an animated side panel.
- Added explicit scanning, no-setup, after-hours, weekend, paused, and disconnected empty states; recommendation scans now remain on standby outside regular market hours.
# 2026-09-04 — Replace the minimum share-price filter

**Decision:** Remove the arbitrary minimum share-price rule. Require at least 240 completed daily bars and $50 million in 20-day average dollar volume during scanning. Before creating a recommendation, require a current bid and ask with a spread no wider than 0.25%; try the next ranked eligible candidate when the highest-ranked candidate fails this execution check.

**Reason:** Nominal share price does not measure company quality and changes mechanically after stock splits. Trading history, dollar liquidity, and executable spread are more relevant to data quality and order execution.

**Known gap:** The current IBKR scanner does not provide a verified primary listing or market-cap field. The strategy universe remains curated as USD stock contracts routed through SMART until a reliable security-master/fundamentals source is added.

# 2026-09-05 — Expand research to a cached 500-stock universe

**Decision:** Use Alpaca as the research-data provider and IBKR as the current-quote, account-validation and execution broker. Refresh a local SQLite cache after market close from active, tradable U.S. equities; exclude OTC and obvious non-common-stock instruments; rank by completed-session dollar volume; and retain the top 500 for daily momentum evaluation.

**Reason:** Bulk historical research across hundreds of securities is a different workload from brokerage execution. A local cache makes repeated scans fast and reproducible while avoiding excessive TWS historical requests.

**Safety boundary:** Alpaca credentials are local secrets and never enter the mobile bundle or SQLite database. A cached technical candidate must still pass a fresh IBKR bid/ask spread check and the existing paper-order controls. Missing or stale cache data does not fall back to fabricated recommendations.

## D-030 — Separate paper-only crypto scope and design-before-code gate

**Status:** Confirmed user constraint, 2026-09-07.
**Decision:** Add inventory-based cross-exchange spot arbitrage as a separate module in the existing app. Preserve stock recommendations, approvals and IBKR architecture. No live orders, production credentials, leverage, borrowing, derivatives, on-chain activity or transfer-dependent execution. Missing/stale inputs fail closed and financial arithmetic is decimal-safe.
**Review gate:** The user explicitly requested a design and safe-sharing assessment before implementation or dependency installation. CRYPTO_DESIGN.md is the review artifact. This gate comes from the user and does not imply a new approval requirement for ordinary stock work.

## D-031 — Sandbox data with separate simulated account authority

**Status:** Proposed for review; no runtime implemented.
**Proposal:** Start with Coinbase Exchange Sandbox and Gemini Sandbox; discover supported common USD spot pairs. Normalize market observations using read-only network adapters. Execute paired IOC orders only in two durable simulated exchange accounts, keeping account evidence independent from strategy intent. Extend durable accounting in separate crypto SQLite stores and a separate crypto process/API so feed load and migrations do not affect stock operations.
**Reason:** Sandbox market data and simulated account evidence have distinct authorities. Reconciling locally simulated fills against actual exchange balances would be false reconciliation. Equity proposal schemas, whole-share sizing, trading hours and protective-order roles are unsuitable for this engine.
**Sharing:** Existing design tokens and visual primitives; SQLite durability/idempotency and reconciliation principles. No direct reuse of equity risk, receipts or broker logic.

## D-032 — Bounded session approval and persistent crypto controls

**Status:** Bounded approval is required by the user; detailed state machine and response policy are proposed for review.
**Decision constraint:** Approval covers immutable exchange/pair, capital, size, profit, loss, time and risk-response limits for one bounded paper session, without prompting on every trade. Any limit change or renewal needs a new approved proposal. Pause and Emergency Stop must be available in the app; hard boundaries stop activity automatically.
**Proposed semantics:** Durable crypto-only global kill latch, atomic reservations, persistent UTC-day counters, separate order certainty and exposure, immediate UNHEDGED on confirmed imbalance, and no uncertain submission retry until reconciliation proves its outcome. Normal exception handling permits at most one capped paper unwind after reconciliation; Emergency Stop permits cancellation/reconciliation only. No response may bypass stale-data, balance, time or hard-risk limits. Unresolved exposure remains visible after stop.
**Stock scope:** This crypto session model does not supersede stock D-017 or authorize changes to existing IBKR order behavior.

## D-033 — Crypto exchange APIs and broad token discovery

**Status:** No IBKR for crypto confirmed by user; provider selection remains proposed.
**Clarification:** Existing IBKR stock architecture is preserved. Crypto market/order capabilities come from separate exchange adapters. A broad catalog provider such as CoinGecko can serve token discovery and indicative market information, but its aggregate prices do not establish executable arbitrage.
**Scope:** Only pairs supported by both selected sandbox venues can qualify for the paper engine. No provider is assumed to cover every token. Public current catalog data is a proposed extension; retain recorded/sandbox sources until the data-source scope is agreed. No dependencies, account connections or credentials were added.

## D-034 — Exchange-first paper MVP and wallet assessment

**Status:** Recommendation for review, not approved implementation or scope expansion.
**Recommendation:** Keep Coinbase/Gemini simulated accounts and bounded paper sessions as the core. Defer wallet connections, signing, allowances, transfers and embedded/server wallets. Use sandbox/fixture data for correctness; propose public read-only production books or licensed historical depth for economics testing. Consider a separate small 0x observation study only after the core evaluation, with no signing authority and separate chain/token/cost semantics.
**UX finding:** D-032's proposed 30-second phone lease implies supervised sessions. Recommend testing that mode first and considering unattended execution only after durable alerts, server supervision, recovery and remote controls are complete. Do not promise background execution under the existing lease.
**Reason:** Manual wallet prompts conflict with frequent execution; delegated signing adds a distinct financial authority/security boundary. Aggregation alone proves neither profitable arbitrage nor that all gaps disappear. Sandbox profit is not evidence of production opportunity.
**Reference:** [CRYPTO_MVP_ASSESSMENT.md](./CRYPTO_MVP_ASSESSMENT.md). No stock behavior, dependencies or runtime changed.

## D-035 — Stock news context via Alpaca/Benzinga

**Scope:** User requested a stock news aggregator and a provider recommendation. Selected the already accessible Alpaca news endpoint, supplied by Benzinga, for the MVP integration. No new account, dependency or subscription purchased.
**Implementation:** Authenticated server endpoint, server-only Alpaca keys, bounded memory cache, exact symbol matching, deduplication/correction handling, publication and update timestamps, safe original-article links and explicit partial/unavailable states. Existing news sheet offers stock-symbol search and refresh; Preview Mode makes no news calls. Only headline metadata is displayed, not full articles or invented summaries.
**Boundary:** One publisher feed is not comprehensive multi-source aggregation. No verified real-time latency claim. News does not affect eligibility, ranking, position sizes, approval receipts or execution. News-based discovery, intraday movers, earnings/ratings datasets and broader publisher coverage require further work. Review data display/redistribution rights before distribution beyond the personal prototype.
**Evidence:** Fixture tests cover correction/deduplication, relevance, malformed/unsafe/stale records, credential redaction, cache behavior, rate limits and outages. Actual AAPL endpoint returned ten normalized Benzinga headlines with partial coverage.

## D-036 — Stage 8 macro provider boundaries

**Status:** Partially implemented; live capture remains unconfigured, 2026-09-20.
**Decision:** Use the existing Alpaca credentials only for bounded read-only prototype snapshots. Label IEX data `single_venue`; label SIP `consolidated` only when separately entitled and configured; reject delayed SIP for forward observation. Keep Federal Reserve and BLS as primary release sources. Keep Trading Economics disabled until access and data-use rights are reviewed.
**Fail-closed requirement:** A snapshot cannot supply a defensible expected time-of-day volume, ATR and current halt confirmation by itself. Require a named context source observed within 60 seconds and reject capture if it is missing, stale or future-dated. Do not substitute a daily-volume average or assume `halted=false`.
**Boundary:** These adapters produce research evidence only. They do not create recommendations, change sizing, submit orders or authorize automated selling.

## D-037 — Freeze a blocked two-study macro universe

**Status:** Source reviewed; activation blocked, 2026-09-20.
**Decision:** Freeze `macro-universe-2026-09-20-v1` with two initial hypotheses: BLS total nonfarm payrolls (`CES0000000001`) mapped at low strength to JPM employment resilience, and BLS CPI-U all-items year-over-year (`CUUR0000SA0`) mapped negatively to Home Depot inflation pressure. Company relationships use SEC filings; liquidity observations retain Alpaca IEX `single_venue` provenance. Omit the next FOMC study until an exact release time and consensus measure are reviewed.
**Independent check:** A separately timed source-verification pass reviewed identities, timestamps, evidence, direction and limitations. It confirmed that neither study has an approved exact consensus-series identity.
**Enforcement:** Both studies are `BLOCKED_CONSENSUS_PROVIDER`, and the validator returns zero active studies. A blocked study cannot contain a guessed ID; activation requires provider approval, an exact series ID and a reviewed crosswalk. Nothing can be registered, ranked or traded from this universe yet.

## D-038 — Build Stage 10 without bypassing Stage 9

**Status:** Pilot machinery and recorded rehearsal complete; real pilot blocked, 2026-09-20.
**Decision:** Add an explicit preflight and accept only its successful output for supervised pilot registration. Require an active reviewed study, named worker, all four read-only provider dependencies, absolute clock offset no greater than one second and registration before the five-minute baseline window. Preserve the scheduler's no-retry and supervised-resolution behavior.
**Reporting:** Generate a deterministic report containing the complete task/audit timeline, latency, source, state counts, unresolved claims, provider status and byte-canonical replay comparison. Mark performance eligible only when every task is completed or recovered from valid durable evidence and replay matches.
**Gate:** The current universe returns `study_not_active`, so no October event was registered. The successful recorded five-task rehearsal proves orchestration only; it is not a real-event result, a performance result or trading authorization.

## D-039 — Freeze Stage 11 outcome controls before real observations

**Status:** Reporting machinery implemented; evidence gate open, 2026-09-20.
**Decision:** Admit only complete, replay-matching `REAL_FORWARD` observations to performance metrics. Preserve all scheduled records, missing observations, corrections, failures and lateness. Compare fixed 1-, 5- and 30-minute signed returns after observed spread and estimated slippage against exact matched no-event sessions, the existing momentum context, a benchmark and cash.
**Method:** Enforce chronological calibration/forward separation, stable ruleset/map/universe versions, unique identities and predeclared match keys. Require at least 30 eligible forward events and 30 eligible matched controls. Use the 30-minute matched-control excess descriptive 95% interval for the frozen conclusion: reject if its upper bound is non-positive, proceed to shadow ranking if its lower bound is positive, otherwise continue collecting.
**Boundary:** The interval is descriptive, not causal. Thresholds cannot be optimized on the forward set. Recorded fixtures and the Stage 10 rehearsal validate machinery only and are always excluded. With zero real eligible pairs, the current conclusion is `CONTINUE_COLLECTING`; there is no performance claim or trading authority.

## D-040 — Isolate and bound the Stage 12 macro ranking fork

**Status:** Comparison machinery implemented; real experiment blocked, 2026-09-20.
**Decision:** Compare baseline and macro-adjusted ranks on one canonical as-known-at-the-time input. Cap the adjustment at five points in either direction. Macro evidence can reorder only candidates that already pass liquidity, spread, freshness, ownership, protection and portfolio gates; it cannot restore eligibility. Reject future-dated or unversioned macro evidence.
**Forward controls:** Require matching baseline/shadow input digests, chronological complete `REAL_FORWARD` sessions and at least 30 eligible sessions. Roll back if mean paired degradation is worse than 5 basis points, additional cumulative trough exceeds 100 basis points or operational failure rate exceeds 5%. Otherwise require a positive lower descriptive 95% bound before proceeding to Stage 13.
**Boundary:** Stage 11 must first conclude `PROCEED_TO_SHADOW_RANKING`. Recorded fixtures have no promotion value. The production queue, mobile cards, sizing, approval receipts and broker paths are unchanged, and all outputs deny recommendation and order authority. The current conclusion is `CONTINUE_COLLECTING` with zero real sessions.

## D-041 — Require an immutable Stage 13 promotion decision

**Status:** Review machinery implemented; no product decision recorded, 2026-09-20.
**Decision:** A macro ranking experiment cannot drift into production. Require a valid improved Stage 12 report, timestamped data-rights and security approvals, reproduced performance, an identified acceptable failure-rate report, versioned strategy and explanation, exercised monitoring/rollback/integration controls, and identified passing broker/reconciliation evidence before bounded-ranking approval is even valid.
**Record:** Permit reject/archive, revise/repeat, continue-observation or approve-bounded-ranking. Require a named approver, timestamp, attestation, change-control ID and rationale. Store one immutable, idempotent decision per assessment. A conflicting decision or database mutation fails closed.
**Release boundary:** Only a valid approval may generate the `macroBoundedRankingEnabled` manifest. It defaults off, remains capped at five ranking points, requires shadow-versus-active comparison and separate integration tests, and provides no automatic or general order authority. Manifest generation is not activation.
**Current outcome:** No real Stage 12 report or complete production dossier exists, and the user has not made a Stage 13 product decision. No decision record or manifest was created. The feature remains research-only and disabled.
