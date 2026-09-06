# Trade Approval — Project Plan

**Last updated:** 2026-09-06
**Current objective:** Graduate the local paper prototype from recommendation submission to trustworthy portfolio-aware trade lifecycle management.

## Product direction

The scanner evaluates the eligible market and may return zero, one, or many opportunities. The number of recommendation cards is determined by current market qualification, fresh execution checks, and portfolio eligibility—not by a fixed UI quota. The user explicitly approves every buy and ordinary sale.

The trading sleeve is managed separately from long-term savings and automated-investing accounts. Cash is a valid allocation; the engine must never generate a trade merely to remain fully invested.

## Delivery sequence

### 1. Market-driven recommendation set — implemented in the local MVP

- Evaluate the full cached research universe.
- Rank every candidate that passes the deterministic strategy.
- Require a fresh IBKR bid/ask and acceptable spread for each actionable card.
- Return every candidate that passes; use pagination or incremental delivery only as a transport and UI optimization.
- Freeze the exact terms of a displayed proposal until it is decided or expires.

### 2. Durable trading ledger — in progress

- **Implemented foundation:** versioned SQLite schema for proposals, decisions, submission attempts, broker orders, and lifecycle events.
- **Implemented foundation:** immutable proposal replay checks, one decision per proposal, single idempotency key per submission, and restart persistence tests.
- **Next:** connect proposal creation, decisions, safety results, and submission results in `server.mjs` to the ledger.
- **Next:** preserve blocked, expired, and unselected recommendations and expose ledger-backed activity reads.
- **Next:** replace in-memory duplicate protection with ledger recovery for interrupted submissions.

### 3. IBKR reconciliation

- Import current paper-account balances, positions, open orders, order statuses, and fills.
- Reconcile app records with manual activity performed in TWS or IBKR Mobile.
- Treat IBKR as authoritative for broker state and the ledger as authoritative for application intent and history.

### 4. Authoritative portfolio snapshot

- Calculate settled cash, available funds, buying power, net liquidation value, open-position count, pending commitments, strategy exposure, sector exposure, correlated exposure, and daily realized/unrealized P&L.
- Keep trading-sleeve limits separate from unrelated brokerage holdings.
- Mark sizing unavailable when any required input is missing or stale.

### 5. Portfolio-aware sizing

- Size primarily from loss at the protective stop.
- Apply the most restrictive of available cash, broker buying power, per-trade risk, remaining daily risk, maximum position size, total strategy allocation, sector/correlation limits, liquidity, and open-position limits.
- Remove prototype share-count ceilings only after these controls and tests are in place.
- Recalculate immediately before submission and fail closed if capacity changed.

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
