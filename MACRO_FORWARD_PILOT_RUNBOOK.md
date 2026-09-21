# Supervised Macro Forward Pilot Runbook

Version: `macro-forward-pilot-v1`

Status: machinery verified with recorded evidence; real pilot blocked

Scope: one forward, read-only research event. The pilot cannot create a
recommendation, size a position or submit an order.

## Current gate

The frozen research universe has zero active studies because its consensus
provider and exact consensus-series identities are unresolved. The preflight
therefore returns `study_not_active`, and registration is rejected. This is the
expected safe state; no October task has been scheduled.

## Preflight

Complete before the five-minute baseline window:

1. Load and validate the frozen universe and select one `REVIEWED_ACTIVE` study.
2. Verify the study contains its exact release event key, reviewed crosswalk
   version, exposure-map version, symbols and official release time.
3. Confirm all four read-only dependencies report `READY`:
   - official release;
   - consensus release/history;
   - market snapshot;
   - time-of-day volume, ATR and halt context.
4. Confirm the named supervised worker is available.
5. Confirm absolute clock offset is no more than 1,000 milliseconds.
6. Run preflight and registration before the baseline window starts.

The registration function accepts only the successful preflight object. Calling
the scheduler directly is not part of the pilot procedure.

## Event timeline

- T−5 minutes: capture the per-symbol baseline.
- T: capture exact official and consensus release evidence.
- T+1 minute: capture the first per-symbol reaction.
- T+5 minutes: capture the second reaction.
- T+30 minutes: capture the final reaction.

Each capture must fall within its predefined window. Late pending tasks become
`MISSED`; provider or validation failures become terminal `FAILED`. A process
death leaves a visible `CLAIMED` task. It receives exactly one supervised
resolution and is never blindly retried. Missing observations are never
backfilled and labeled contemporaneous.

## Completion report

The pilot report includes:

- every task, due/late/completion time and latency;
- original state, effective supervised disposition and complete audit timeline;
- named data source when a result exists;
- completed, pending, failed, missed and unresolved-claim counts;
- provider status;
- byte-canonical original-versus-replay evaluation comparison;
- deterministic report digest.

Only a plan in which every task is completed, every claim is resolved and every
evaluation replays byte-canonically is `performanceEligible`. Any partial plan is
retained but excluded from performance conclusions.

## Recorded rehearsal result

The automated rehearsal registered one fictional reviewed CPI/HD study and
completed five tasks: baseline, release, 1-minute, 5-minute and 30-minute
reaction. All five completed, replay matched and repeated report generation
produced the same digest. Fault tests proved that:

- the real blocked universe cannot be registered;
- missing worker identity, provider status, clock synchronization and advance
  timing are reported together;
- a partial timeline or replay mismatch is not performance eligible.

This rehearsal proves deterministic orchestration—not provider readiness,
strategy value or real-event completion. Stage 10 remains open until one real
event completes under the approved Stage 8 and Stage 9 dependencies.
