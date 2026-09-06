# Trade Approval — Project Plan

**Last updated:** 2026-09-06
**Current objective:** Graduate the local paper prototype from recommendation submission to trustworthy portfolio-aware trade lifecycle management.

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
- **Next:** preserve unselected recommendations and expose ledger-backed Activity reads.
- **Next:** reconcile unknown attempts, current IBKR orders, fills, positions, and manual broker activity.

### 3. IBKR reconciliation

- Import current paper-account balances, positions, open orders, order statuses, and fills.
- Reconcile app records with manual activity performed in TWS or IBKR Mobile.
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

### 8. Position and exit lifecycle

- Add Activity and Positions views.
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
