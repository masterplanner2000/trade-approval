# Trade Approval — Decision Log

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

---

## Detailed decisions

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

---

## Open decisions

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

---

## Change history

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
# 2026-09-04 — Replace the minimum share-price filter

**Decision:** Remove the arbitrary minimum share-price rule. Require at least 240 completed daily bars and $50 million in 20-day average dollar volume during scanning. Before creating a recommendation, require a current bid and ask with a spread no wider than 0.25%; try the next ranked eligible candidate when the highest-ranked candidate fails this execution check.

**Reason:** Nominal share price does not measure company quality and changes mechanically after stock splits. Trading history, dollar liquidity, and executable spread are more relevant to data quality and order execution.

**Known gap:** The current IBKR scanner does not provide a verified primary listing or market-cap field. The strategy universe remains curated as USD stock contracts routed through SMART until a reliable security-master/fundamentals source is added.

# 2026-09-05 — Expand research to a cached 500-stock universe

**Decision:** Use Alpaca as the research-data provider and IBKR as the current-quote, account-validation and execution broker. Refresh a local SQLite cache after market close from active, tradable U.S. equities; exclude OTC and obvious non-common-stock instruments; rank by completed-session dollar volume; and retain the top 500 for daily momentum evaluation.

**Reason:** Bulk historical research across hundreds of securities is a different workload from brokerage execution. A local cache makes repeated scans fast and reproducible while avoiding excessive TWS historical requests.

**Safety boundary:** Alpaca credentials are local secrets and never enter the mobile bundle or SQLite database. A cached technical candidate must still pass a fresh IBKR bid/ask spread check and the existing paper-order controls. Missing or stale cache data does not fall back to fabricated recommendations.
