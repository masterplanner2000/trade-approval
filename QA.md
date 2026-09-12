# Trade Approval — Quality and Release Plan

**Version:** 1.0
**Last updated:** 2026-09-12

This is the source of truth for verification of the stock paper-trading application. A passing test suite reduces implementation risk; it does not establish that a strategy is profitable or that paper fills predict live execution.

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
- [ ] A partial entry fill protects exactly the filled quantity.
- [ ] Rejected and cancelled entries never create positions.
- [ ] A missing, cancelled, or undersized protective stop creates a blocking exception.
- [ ] A partial exit preserves the correct remaining position, protection and cost basis.
- [ ] Manual broker orders, fills, cancellations and position changes are reconciled visibly.
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
3. **API integration harness:** start the service on an isolated database and exercise complete proposal-to-reconciliation flows.
4. **Mobile automation:** Maestro flows and accessibility identifiers for primary states and decisions.
5. **Visual/accessibility checks:** screenshot baselines, Dynamic Type, themes, VoiceOver checklist and automated accessibility assertions where supported.
6. **Gated IBKR Paper smoke:** read-only health by default; order smoke requires an additional explicit flag and strict account/notional controls.
7. **Resilience and operations:** restart/fault injection, soak tests, monitoring, backups, recovery and release evidence.
