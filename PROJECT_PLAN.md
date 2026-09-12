# Trade Approval — Project Plan

**Last updated:** 2026-09-11
**Current objective:** Graduate the local paper prototype from recommendation submission to trustworthy portfolio-aware trade lifecycle management.

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

## Product direction

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
