# Macro promotion review

Status date: 2026-09-20

Stage 13 prevents research code from drifting into the application without an explicit, attributable product-and-risk decision. The review machinery cannot enable a feature or grant order authority.

## Required dossier

A bounded-ranking approval requires all of the following:

- a valid Stage 12 report concluding `IMPROVED_PROCEED_TO_PROMOTION_REVIEW`, with adequate real forward observations and no rollback trigger;
- a timestamped source and data-rights approval;
- independently reproduced performance evidence;
- an identified acceptable failure-rate report at or below 5%;
- a timestamped security approval;
- a versioned strategy policy and user explanation;
- a versioned monitoring plan whose alerting was tested;
- a complete rollback plan whose disable mechanism was tested;
- a passing integration-test review; and
- an identified report showing broker and reconciliation release gates passed.

Reviews and the Stage 12 report must exist before the promotion assessment. Missing, future-dated or malformed evidence remains visible as a blocker.

## Decision and immutability

The permitted decisions are:

- `REJECT_AND_ARCHIVE`
- `REVISE_AND_REPEAT_9_12`
- `CONTINUE_OBSERVATION`
- `APPROVE_BOUNDED_RANKING`

Approval is invalid while any dossier blocker remains. Every recorded decision requires a named approver, timestamp, attestation, change-control identity and rationale. The SQLite journal permits one immutable decision per assessment; identical repetition is idempotent, while conflicting decisions, updates and deletions fail closed.

The deterministic digests detect accidental or post-record mutation; they are not cryptographic identity signatures. Production promotion would additionally require authenticated organizational change control rather than trusting a caller-supplied approver name.

## Default-off release boundary

Only an approved decision can produce a release manifest. The manifest names the feature flag `macroBoundedRankingEnabled`, but defaults it to false. It keeps the adjustment capped at five points, requires shadow-versus-active comparison, separate integration tests and a complete rollback plan, and grants neither automatic-order nor general order-submission authority.

Generating a manifest does not activate it. Activation would require a separately reviewed implementation change and the recorded decision-log entry specified by the plan.

## Current status

The review, journal and manifest machinery pass deterministic tests. No real Stage 12 evidence exists, source/rights and production-security reviews are not approved, and broker/reconciliation release gates are not complete. No Stage 13 product decision has been recorded and no manifest has been generated. The macro feature therefore remains research-only and disabled; the Stage 13 exit gate is open.
