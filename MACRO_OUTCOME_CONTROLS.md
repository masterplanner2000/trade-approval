# Macro outcome controls

Status date: 2026-09-20

This is the Stage 11 research-only measurement contract. It does not create recommendations, alter ranking or sizing, or authorize Paper or live orders.

## Eligible evidence

An observation contributes to performance only when it is labeled `REAL_FORWARD`, belongs to the chronological `FORWARD` split, completed the Stage 10 pilot, replays byte-canonically, and has no pending correction. Recorded rehearsals, calibration observations, incomplete pilots and replay mismatches remain visible in the report but are excluded from performance metrics.

Every scheduled record includes a stable study/symbol/time identity, immutable ruleset/map/universe versions, signal direction, capture lateness and a predeclared matched-control key. Duplicate identities and overlapping calibration/forward time ranges fail closed.

## Measurements and controls

The fixed initial horizons are 1, 5 and 30 minutes. Each horizon retains gross return, observed spread, estimated slippage, favorable and adverse excursion, volume, volatility regime, daily momentum score, benchmark return and cash return. Net signed return is:

`signed gross return - observed spread - estimated slippage`

Event observations are compared with same-symbol matched no-event observations chosen under a separately reviewed comparable-time/volatility procedure. The report presents net event return, no-event return, matched-control excess, benchmark excess, cash excess, cumulative net trough, excursions, missing counts and volatility-regime counts. It never silently substitutes a control or fills a missing horizon.

## Fixed decision rule

- Fewer than 30 eligible real forward events or 30 eligible matched controls: `CONTINUE_COLLECTING`.
- Mixed ruleset, map or universe versions, or inadequate exact matches: `CONTINUE_COLLECTING`.
- With an adequate sample, a non-positive upper 95% descriptive bound for 30-minute matched-control excess: `REJECT`.
- With an adequate sample, a positive lower 95% descriptive bound: `PROCEED_TO_SHADOW_RANKING`.
- Otherwise: `CONTINUE_COLLECTING`.

The interval is a descriptive normal approximation, not a causal claim. These rules are frozen before the forward set; thresholds must not be tuned on that set. Any later approved horizon or method requires a new version and decision entry.

## Current result

Deterministic positive, adverse, incomplete, mixed-version, duplicate and split-leakage fixtures pass. The recorded Stage 10 rehearsal is explicitly excluded. There are zero eligible real forward event/control pairs because Stages 9 and 10 remain open. The only defensible current conclusion is `CONTINUE_COLLECTING`; no strategy-performance or profitability conclusion exists.
