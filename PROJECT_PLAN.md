# Trade Approval — Project Plan

**Last updated:** 2026-09-18
**Current objective:** Establish a trustworthy paper-trading loop—owned positions, protection, execution state and measurable results—before expanding the recommendation strategy or enabling automatic exits.

## Today's work order — 2026-09-18

1. **Completed:** Verify current IBKR Paper holdings and open orders read-only; establish why NVDA/MSFT lack stops from broker trade evidence and historical app code. Keep these positions visibly unprotected and new buying capacity at zero.
2. **Completed:** Reconcile explicit broker terminal-order evidence; test rejection, cancellation, uncertain transmission, partial fills and an unfilled manual order in the broker simulator. Keep the service running with automatic sells off.
3. **Simulator and local durable-intent stages complete; broker adapter not started:** A pure Paper-only ordinary-exit state machine emits one target-replacement intent and waits for broker-observed terms. A separate SQLite outbox now stores the intent, claims it once before any simulated send, and recovers by read-only broker reconciliation rather than retransmitting after an uncertain crash. Tests cover rejection, partial sale with oversized stop, stop/target race, duplicate callback, unrelated sell order, stale preflight, lost acknowledgement and process restart. The old protective stop remains active while a replacement is pending or rejected. This is not wired to an IBKR order-modification adapter or the service worker; actual broker-side sibling resize is unverified. Automatic selling remains code-disabled. The legacy-stop repair preflight remains non-submitting.
4. **Market-data diagnosis:** After the user signed the Market Data API Acknowledgement, live Client Portal says API access is enabled and Non-Professional status is set. Paper sharing remains on; only fee-waived US non-consolidated streaming quotes are listed. Fresh live-only, read-only Paper TWS API requests still returned warning 2186 after a TWS restart. IBKR TWS API support ticket #496671 was submitted September 18 to ask which exact entitlement and settings are needed. Do not purchase a package or change declarations automatically. Keep the live-quote gate closed until IBKR responds and a fresh read-only API retest succeeds.
5. **Paper protection now authorized by user:** Proceed without per-step approvals if an exact, broker-verified and risk-bounded repair can be established. No price should be invented from the old entry records. Today the live-data and stop-policy gates are not met, so NVDA/MSFT remain explicitly unprotected and no stop or sale has been sent. Never touch live trading under this authorization.
6. **Then:** Run mobile status/Activity/Positions smoke checks and compile a broker-grounded daily performance report. A tiny Paper execution smoke test requires a separate, explicit scope and account/order limits. Defer strategy promotion, live trading and any profitability claim.

## Prioritized recovery and product roadmap — 2026-09-17

This is the working sequence for the user's current concerns. A passing code test is not proof of profitable recommendations or reliable broker execution. Keep the existing paper/live separation and do not place an order merely to exercise the app.

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
- Results are research candidates only. They do not become cards or broker orders. The API labels missing catalyst, consolidated liquidity, current spread, portfolio sizing and broker validation.
- Next: obtain consolidated volume and intraday prices; add timestamped, source-linked catalyst verification and current spread checks; test out-of-sample, then compare paper outcomes to the existing strategy and benchmark before considering user-facing proposals.
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

- Alpaca/Benzinga headlines are available in the existing Recent news sheet, with ticker search, original links, publication/update times, polling while open and explicit empty/partial/unavailable states.
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

### Plan change history — 2026-09-07

- Clarified crypto has no IBKR dependency. Evaluate broad token catalog discovery separately from the subset executable on two sandbox exchanges; CoinGecko is proposed, with no connection or dependency added.
- Added the gated crypto design workstream without changing the stock delivery sequence.
- All crypto runtime, tests and frontend implementation remain pending design review.
