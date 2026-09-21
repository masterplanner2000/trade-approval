# Macro/Event Research — Sequential Delivery Plan

Status date: 2026-09-20

Scope: research-only macro/event signal development

Non-goals: live trading, Paper order submission, automatic selling, recommendation-card authority, or claims of profitability

## Operating rules

1. Complete stages sequentially. A later stage may be designed in advance but cannot consume outputs that have not passed the preceding acceptance gate.
2. Preserve what was known at the time. Never backfill a missed forward observation and label it contemporaneous.
3. Pin rulesets, source records, crosswalks and exposure-map versions for deterministic replay.
4. Missing, stale, conflicting or unsupported evidence fails closed.
5. Keep research authority separate from portfolio sizing, approval and brokerage execution.
6. Record decisions, limitations, failed captures and rejected hypotheses—not only successful signals.

## Stage 7 — Capture-contract hardening

**Objective:** Ensure every stored capture is provably associated with the intended task and every uncertain claim receives one auditable disposition.

**Implementation:**

- Require market results to repeat the exact requested symbol.
- Require release results to repeat the scheduled official event identity.
- Require all results to repeat the pinned event-link and exposure-map versions.
- Continue enforcing due/late windows, named data source and volume provenance.
- Add one immutable resolution per claimed-but-unfinished task:
  - `FAILED_CONFIRMED`
  - `COMPLETED_FROM_DURABLE_EVIDENCE`
  - `ABANDONED_UNKNOWN`
- Require in-window timestamp and named source before accepting durable evidence as completed.
- Preserve original `CLAIMED` state and expose a separate effective disposition so history cannot be rewritten.

**Tests:** wrong symbol, wrong event, wrong versions, stale/future observation, duplicate completion, duplicate resolution, worker termination, database restart and resolution-table mutation.

**Exit gate:** Full suite passes; contamination is rejected; a crash cannot cause silent retry; a supervised disposition is immutable and attributable.

## Stage 8 — Approved read-only provider adapters

**Objective:** Replace fixtures with bounded adapters without changing the worker or downstream evidence contract.

**Work packages:**

1. Inventory candidate providers for official releases, consensus history and intraday market snapshots.
2. Document authentication, data latency, timestamp semantics, consolidation scope, rate limits, retention and redistribution rights.
3. Select providers explicitly; do not purchase a subscription or accept new commercial terms automatically.
4. Implement fixed-host clients with server-only credentials, redirect restrictions, timeouts, response-size limits and rate-limit handling.
5. Normalize provider payloads into existing release and market contracts.
6. Capture sanitized diagnostics without storing keys, account information or raw error bodies.
7. Freeze representative licensed/allowed fixtures for deterministic tests.

**Tests:** redirect attack, credential leakage, malformed/oversized response, rate limit, timeout, correction, stale timestamp, wrong ticker, non-consolidated volume, halt, crossed quote and provider outage.

**Exit gate:** Recorded provider samples normalize deterministically; provenance is explicit; rights are documented; no secret or raw upstream error escapes.

**Progress (2026-09-20):** Alpaca snapshot normalization and provider composition are implemented with fixed-host, redirect, timeout, size, rate-limit, secret-redaction and volume-scope controls. Official Fed/BLS adapters remain approved primary-source readers. Trading Economics remains provisional and disabled pending access/data-rights review. Expected intraday volume, ATR and verified halt status still require an approved context source, so the live forward-capture exit gate remains open. See `MACRO_PROVIDER_REVIEW.md`.

## Stage 9 — Reviewed initial research universe

**Objective:** Establish a narrow, defensible set of real economic-event and company-exposure relationships.

**Initial scope:** Prefer a small set of high-importance U.S. releases with exact times and repeatable consensus history, such as CPI, Employment Situation and Federal Reserve decisions. Select only a few economically distinct themes and liquid equities for the first study.

**Curation procedure:**

1. Identify the exact official series and consensus series.
2. Create a reviewed crosswalk with rationale and primary-source evidence.
3. Use filings, company reports, official datasets or index methodology to support each company exposure.
4. Record direction, strength, effective dates and limitations.
5. Perform a second-person or separately timed independent review.
6. Version and freeze the map before registering a forward event.

**Exit gate:** Every scheduled ticker resolves through an active reviewed map and exact crosswalk; no generated narrative is used as evidence; all reviewers and source timestamps are recorded.

**Progress (2026-09-20):** Version `macro-universe-2026-09-20-v1` freezes two source-reviewed hypotheses: BLS total nonfarm payrolls/JPM and BLS CPI-U all-items year-over-year/Home Depot. Exact official series, dates, filing evidence, IEX liquidity provenance, direction, strength and limitations are recorded and validated. A separately timed source-verification pass is recorded. Both studies remain `BLOCKED_CONSENSUS_PROVIDER`; validation returns zero active studies and makes it invalid to label a study active without an approved exact consensus series and reviewed crosswalk. The Stage 9 exit gate therefore remains open. See `MACRO_RESEARCH_UNIVERSE.md`.

## Stage 10 — Supervised forward-capture pilot

**Objective:** Demonstrate one complete as-known-at-the-time event lifecycle with real read-only sources.

**Procedure:**

1. Pre-register the event before its release.
2. Verify worker health, provider access and clock synchronization before the baseline window.
3. Capture the five-minute baseline.
4. Capture official release and consensus evidence.
5. Capture 1-, 5- and 30-minute reactions.
6. Resolve failures without backfilling.
7. Join valid records, evaluate them and append the exact evidence to the journal.
8. Replay from storage and compare byte-canonical evaluations.

**Operational outputs:** task timeline, latency, missed/failed counts, provider status, immutable observation and replay result.

**Exit gate:** At least one complete real event is deterministic end to end. Any partial event remains incomplete and is excluded from performance conclusions.

**Progress (2026-09-20):** Preflight, gated registration and deterministic completion reporting are implemented in `macro_forward_pilot.py`. Preflight requires an active reviewed study, all four provider dependencies, a named worker, clock offset within one second and completion before the baseline window. The report includes the full task/audit timeline, latency, source, state counts, unresolved claims, replay equivalence and a stable digest; partial or non-replaying plans are not performance eligible. A five-task recorded rehearsal passed. The real frozen universe remains blocked and no October event was registered, so the Stage 10 exit gate remains open. See `MACRO_FORWARD_PILOT_RUNBOOK.md`.

## Stage 11 — Outcomes and controls

**Objective:** Determine whether macro-conditioned observations contain useful forward information after realistic costs and controls.

**Measurements:** 1-, 5-, 30-minute and later approved horizons; favorable/adverse excursion; spread; estimated slippage; volume; volatility regime; signal direction; failure rate and lateness.

**Controls:** matched no-event sessions, same symbols, similar time of day, comparable volatility, existing daily momentum score and cash/benchmark reference. Corrections and missing observations remain visible.

**Method:** chronological walk-forward splits; no random leakage across revisions; no threshold optimization on the forward set; report all scheduled events and no-trade outcomes.

**Exit gate:** Reproducible report with adequate sample accounting, cost assumptions, drawdown, uncertainty and an explicit conclusion of reject, continue collecting, or proceed to shadow ranking.

**Progress (2026-09-20):** The deterministic `macro-outcomes-v1` analyzer and fixed outcome contract are implemented. It reports every scheduled forward record, exclusions, failures, lateness, 1-/5-/30-minute after-cost outcomes, excursions, cumulative trough, volatility regimes, matched no-event excess, momentum context, and benchmark/cash excess. Rehearsals, incomplete or corrected observations, replay mismatches, mixed versions, duplicate identities and chronological split leakage cannot support promotion. The predeclared gate requires at least 30 eligible real forward events and 30 valid matched controls. There are currently zero because Stages 9 and 10 remain open, so the Stage 11 conclusion is `CONTINUE_COLLECTING` and its exit gate remains open. See `MACRO_OUTCOME_CONTROLS.md`.

## Stage 12 — Shadow-ranking experiment

**Objective:** Test whether validated macro evidence improves candidate ordering without creating trading authority.

**Design:**

- Fork the ranking calculation into a versioned shadow ruleset.
- Cap the macro adjustment so it cannot overcome failed liquidity, spread, freshness, ownership, protection or portfolio gates.
- Compare baseline and adjusted rankings on identical as-known-at-the-time inputs.
- Preserve `orderSubmissionAllowed: false` and keep the mobile approval queue unchanged.
- Define rollback thresholds before starting the forward comparison.

**Exit gate:** Written forward comparison demonstrates improved opportunity quality or rejects the adjustment. No promotion based only on in-sample results.

## Stage 13 — Promotion review

**Objective:** Make an explicit product and risk decision rather than allowing experimental code to drift into production.

**Decision options:** reject and archive; revise and repeat stages 9–12; continue observation; or approve a narrowly bounded ranking feature.

**Required evidence:** source/data-rights review, adequate forward sample, reproducible performance report, failure-rate report, security review, versioned strategy policy, monitoring, rollback criteria and confirmation that broker/reconciliation release blockers remain satisfied.

**If promoted:** create a new decision-log entry, feature flag, shadow-versus-active comparison, user-facing explanation and separate integration tests. Promotion never grants automatic order authority.

**Exit gate:** Signed-off recorded decision and complete rollback plan. Absence of approval means the feature remains research-only.

## Current sequence

- Stage 7: implemented; full regression and documentation completion in progress.
- Stages 8–11: foundations implemented; their real-data exit gates remain open.
- Stages 12–13: planned, not started.
