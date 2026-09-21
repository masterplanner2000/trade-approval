# Macro shadow-ranking experiment

Status date: 2026-09-20

Stage 12 is a research-only fork of candidate ordering. It does not change the production recommendation queue, mobile cards, risk limits, sizing, approvals or broker execution.

## Entry gate

A real forward experiment can start only from a complete Stage 11 report whose conclusion is `PROCEED_TO_SHADOW_RANKING`, sample is adequate and digest is present. Recorded fixtures can exercise the machinery but receive no promotion authority and are excluded from forward conclusions. The current Stage 11 conclusion is `CONTINUE_COLLECTING`, so no real Stage 12 experiment is authorized.

## Ranking contract

Baseline and shadow ordering consume one canonical as-known-at-the-time input. Macro evidence must be an eligible, versioned research observation evaluated no later than the ranking timestamp. Future, unversioned or otherwise invalid evidence receives no adjustment.

The adjustment is capped at five ranking points in either direction. An eligible long observation can add up to five; an eligible avoid/exit observation can subtract up to five. It cannot change eligibility. A candidate that fails liquidity, spread, freshness, ownership, protection or portfolio gates is omitted from both rankings, regardless of macro evidence.

Every comparison records the input digest, baseline and shadow orders, per-symbol adjustment, rank movement and a stable comparison digest. `productionQueueChanged`, `recommendationAuthority` and `orderSubmissionAllowed` are always false.

## Forward comparison and rollback

Each chronological session must prove that baseline and shadow outcomes came from identical input digests. Missing, incomplete, synthetic or mismatched sessions remain visible but are excluded. The initial minimum is 30 eligible real forward sessions.

Predeclared rollback triggers are:

- mean paired shadow degradation worse than 5 basis points;
- shadow cumulative trough more than 100 basis points worse than baseline; or
- operational failure rate above 5%.

Any trigger yields `REJECT_ROLLBACK`. With no trigger and an adequate sample, a positive lower descriptive 95% bound for paired improvement yields `IMPROVED_PROCEED_TO_PROMOTION_REVIEW`; a non-positive upper bound yields `REJECT_NO_IMPROVEMENT`; otherwise the result is `CONTINUE_COLLECTING`.

These intervals are descriptive rather than causal. Thresholds are frozen before real forward collection and cannot be tuned on the forward set.

## Current result

Recorded fixtures demonstrate bounded reordering, hard-gate precedence, anti-look-ahead behavior, identical-input enforcement, chronological reporting and all rollback/conclusion paths. They are not evidence of strategy quality. There are zero authorized real forward sessions, so the current conclusion remains `CONTINUE_COLLECTING` and the Stage 12 exit gate is open.
