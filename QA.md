# Trade Approval — Quality and Release Plan

**Version:** 1.3
**Last updated:** 2026-09-19

This is the source of truth for verification of the stock paper-trading application. A passing test suite reduces implementation risk; it does not establish that a strategy is profitable or that paper fills predict live execution.

**2026-09-17 paper audit blocker:** The scanner now returns explicit failed held-symbol evaluations, with a regression test and unchanged qualified-buy selection. Automatic paper selling remains disabled. Its unit tests do not prove the end-to-end scan-to-exit path. Verify strategy-owned quantities versus external shares, broker-visible protection, quote freshness, and fee-complete P/L before treating the current paper results as a valid strategy-performance sample. Keep order-submitting tests gated and paper-only.

**Priority-1 progress:** A pure ownership/protection reconciliation now checks same-account filled entries, exact broker quantity, observed external activity and linked active stops. A simulated HTTP scenario removes a stop and verifies Positions reports the gap and new-buy capacity is blocked. Historical completeness, manual-position provenance and full automatic-exit fault injection remain open; do not classify this milestone as complete.

**Automatic-exit release gate:** Cover acceptance-before-protection-cancellation, rejection, partial fill, broker stop/target race, reconnect and idempotent retry in a paper-only simulator before any feature-flag activation. Verify a current type-1 IBKR quote or fail closed. Two failed observations count only when they correspond to adjacent completed market bars. The current adapter does not meet the cancel/replace gate; keep automatic ordinary selling disabled.

**September 18 follow-through:** A fresh read-only IBKR Paper snapshot confirms 25 NVDA and 2 MSFT shares with no open orders for either symbol; their protection gap is real. The private broker trade report and original app code show the remaining net shares match the early single-order version that did not submit bracket stops. Completed-order callbacks now let reconciliation distinguish a broker-confirmed rejection/cancellation from an order that merely vanished from the open-order list. Simulator HTTP tests verify no phantom holding and release of reserved capital; an uncertain transmission can be resolved by a terminal broker order without inventing a fill. A separate read-only Paper connection confirmed the completed-order request and end callback, but returned no completed orders in that snapshot. Automatic sells remain disabled, and no Paper order was submitted or changed.

## Safety rules for tests

1. The default `npm test` command cannot contact a broker, use credentials, or place an order.
2. Fixtures and temporary databases are deterministic and isolated from runtime trading data.
3. Any real IBKR Paper test must be separately named, explicitly invoked, paper-account verified, and capped to disclosed symbols and quantities.
4. No automated test may target a live brokerage endpoint.
5. Missing, stale, partial, ambiguous, or wrong-environment broker evidence must fail closed.
6. Credentials must remain in ignored local environment files or an approved secret store and must never enter fixtures, logs, screenshots, mobile bundles, or Git history.

## Test layers

| Layer | Trigger | Current status | Required purpose |
|---|---|---|---|
| Static and unit | Every push and pull request | Implemented | Type safety, calculations, guards, persistence and pure lifecycle behavior |
| Service integration with broker simulator | Every pull request | Foundation implemented | Exercise API, ledger and asynchronous broker sequences without network access |
| Mobile end-to-end | Pull request smoke set; full release run | Next | Exercise review, approval, denial, accessibility, offline and recovery flows |
| IBKR Paper smoke | Manual/scheduled gated run | Next | Verify current TWS connectivity and harmless paper lifecycle behavior |
| Resilience and soak | Nightly/release candidate | Planned | Restarts, outages, retry safety, resource use and reconciliation stability |
| Production monitoring | After hosted pilot | Planned | Detect connection, reconciliation, execution and notification failures |

## Prioritized remaining verification

1. **P0 — Broker truth and protected Paper lifecycle:** resolve live API quote entitlement; verify missing/undersized protection, partial exit and sibling resizing, manual fills/cancellations, account isolation, and crash/restart behavior before a narrowly gated Paper smoke test. Automatic selling stays disabled.
2. **P1 — Strategy evidence:** preserve every eligible, rejected, unselected, denied, expired and executed observation as known at the time; add fee/slippage-complete outcomes, benchmark comparison, drawdown, walk-forward splits and negative/missed-opportunity review.
3. **P2 — Intraday discovery in shadow:** collect immutable timestamped snapshots, test provider coverage and consolidated volume, replay without look-ahead, and measure false positives and late entries. The evaluator, append-only persistence, recorded JSONL import and first-signal outcome report are implemented; live capture, a forward dataset, provider verification and promotion criteria are not.
   The macro/event bias evaluator and immutable evidence journal are implemented as isolated components. Revision preservation, mandatory source/exposure/market provenance, idempotency, immutability and deterministic replay are tested. Still test conflicting-source resolution, scheduled-release adapters, exposure-map changes, negative events, no-event controls and volatility-regime splits before connecting it to ranking.
4. **P3 — Portfolio sizing integration:** connect the pure sizing model to complete reconciled inputs; invalidate stale approvals when cash, exposure or price changes; test sectors, correlations and sequential rotations.
5. **P4 — Mobile behavior and accessibility:** automate primary states, gestures, offline/recovery, Dynamic Type, VoiceOver, themes and supported viewport screenshots.
6. **P5 — Operations and external release:** authentication, encrypted secrets, monitoring, backup/recovery, dependency/security review, data licensing and securities/legal review.

## Local quality gate

Run:

```sh
npm test
```

It performs TypeScript checking, every Node service test and every Python unit test. It is intentionally network- and credential-free. GitHub runs the same command on pushes to `main` and on pull requests, together with dependency review and secret scanning.

## Required financial lifecycle scenarios

These scenarios must be automated before live-trading consideration:

- [x] A proposal cannot receive conflicting decisions.
- [x] Submission idempotency survives a service restart.
- [x] An ambiguous broker reference is not guessed.
- [x] Unknown submission evidence blocks retransmission and can be resolved by broker evidence.
- [x] Missing or stale portfolio inputs prevent sizing.
- [x] Strategy capital is reserved on submission and released after a confirmed exit.
- [x] Net profit is shown only when both entry and exit fees are known.
- [x] A partial entry fill protects exactly the filled quantity in the deterministic broker and is represented as partial through HTTP reconciliation.
- [x] Broker-confirmed rejected and cancelled entries never create positions and release reserved capital in the simulator.
- [ ] A missing, cancelled, or undersized protective stop creates a blocking exception.
- [ ] A partial exit preserves the correct remaining position, protection and cost basis.
- [x] Manual broker orders are reconciled visibly in the HTTP integration foundation.
- [ ] Manual fills, cancellations and position changes are reconciled visibly.
- [ ] Changed cash, price or exposure invalidates stale sizing and requires renewed approval.
- [ ] Ordinary profit targets generate sell approval rather than automatic submission.
- [ ] Paper and live account identities cannot be confused at any service boundary.
- [ ] App, service, TWS and network restart sequences preserve one exact lifecycle.

## Mobile and accessibility scenarios

- [ ] The recommendation stack renders without blank or flickering successor cards.
- [ ] Approve and Deny are reachable by screen reader and expose busy/disabled state.
- [ ] Navigation swipes never count as financial decisions.
- [ ] Expired, offline, stale, blocked, partial-fill and unknown states have distinct copy.
- [ ] Dynamic Type does not hide price, amount, risk, expiration or decision controls.
- [ ] Light/dark themes meet WCAG AA; primary decision controls target AAA contrast.
- [ ] The complete critical flow works with VoiceOver.
- [ ] Screenshots are compared at supported iPhone viewport sizes.

## Release gates

A paper release candidate requires:

- All required GitHub checks passing from a clean install.
- No high-severity dependency finding or verified/unknown secret finding.
- No unresolved lifecycle correctness regression.
- Mobile smoke flow passing on a supported simulator and physical iPhone.
- A successful explicitly gated IBKR Paper connection/reconciliation smoke run.
- Documented known limitations and rollback instructions.

A live pilot additionally requires completed lifecycle/reconciliation scenarios, production authentication and secret storage, monitoring and alerts, backup/recovery testing, an agreed paper sample and reliability threshold, legal/data-rights review, and an intentionally small live sleeve. Live execution is not currently authorized or implemented.

## Planned implementation sequence

1. **CI foundation — implemented:** unified local command, clean-install GitHub checks, dependency review, secret scan and this matrix.
2. **Deterministic broker simulator — foundation implemented:** scripted fills, partial fills, rejects, cancels, disconnects, delayed evidence, duplicate callbacks and manual activity. Next connect full service routes and lifecycle exception handling.
3. **API integration harness — foundation implemented:** starts a real service process on isolated files and exercises approval, preview, What-If, submission, partial/full fills, closed trades, manual orders and uncertain-outcome recovery through HTTP. Cancellation/protection-gap and restart expansion remain next.
4. **Mobile automation:** Maestro flows and accessibility identifiers for primary states and decisions.
5. **Visual/accessibility checks:** screenshot baselines, Dynamic Type, themes, VoiceOver checklist and automated accessibility assertions where supported.
6. **Gated IBKR Paper smoke:** read-only health by default; order smoke requires an additional explicit flag and strict account/notional controls.
7. **Resilience and operations:** restart/fault injection, soak tests, monitoring, backups, recovery and release evidence.
