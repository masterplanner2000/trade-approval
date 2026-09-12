# Trade Approval — Decision Log

**Log revision:** 2026-09-12.2 · **Corresponding architecture:** 3.18

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
| D-017 | Recommend buys only; require approval for ordinary profit-taking | Confirmed | 2026-08-31 |
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

---

## Detailed decisions

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
