# In-App Research Assistant and Engine Improvement Plan

Status date: 2026-09-29

Scope: an in-app conversational assistant that explains the system, answers questions from current evidence and proposes controlled improvements to the recommendation engine.

Current authority: read-only explanation plus draft experiment proposals. It has no brokerage, order, active-ruleset, deployment, credential or production-code authority.

## Product goal

The user should be able to ask:

- Why did this recommendation appear?
- Why was BMNR, TSLA or another mover excluded?
- What positions are open and protected?
- How has the strategy performed this week after fees?
- Which filter rejects the most eventual winners?
- Did social/news evidence arrive before or after the price move?
- What experiment should we run next?
- What would change if the relative-volume threshold moved from 1.3 to 1.2?

Answers must come from timestamped system evidence, not model memory. The assistant must distinguish fact, inference, missing data and hypothetical analysis.

## Meaning of “self-improve”

The assistant does not rewrite its own production code or silently tune the live strategy. It operates a governed learning loop:

`Question -> evidence retrieval -> diagnosis -> experiment proposal -> user acceptance -> shadow run -> forward outcomes -> comparison -> promotion review`

Every change begins as a versioned hypothesis. Only one declared factor changes at a time unless the experiment explicitly tests an interaction. The baseline stays frozen, rejected candidates remain observable and future data cannot alter an earlier decision.

## Architecture

`Mobile chat UI -> local assistant endpoint -> conversation orchestrator -> read-only tool gateway -> evidence stores`

`Assistant -> structured experiment draft -> experiment registry -> shadow evaluator -> outcome journal -> comparison report -> explicit promotion decision`

### Mobile chat UI

- Add `Assistant` to the side navigation.
- Stream responses into a simple native chat timeline.
- Show evidence citations as tappable chips: recommendation, scan, position, order, performance session, news/social event or experiment.
- Label portfolio and market data with an `as of` time and freshness state.
- Provide suggested prompts based on the current page, such as “Why this trade?” or “Why is this position unprotected?”
- Keep experimental actions visually distinct from questions. A confirmation sheet must describe what will be recorded and state that it has no trading authority.

### Conversation service

- Use the OpenAI Responses API from the server, never directly from Expo.
- Keep the OpenAI key and all provider credentials out of the mobile bundle.
- Initially use `store: false` and persist the minimum necessary conversation/audit state locally under the application's retention policy.
- Stream typed response events to the app.
- Use strict structured outputs for diagnoses and experiment proposals.
- Pin model, prompt, tool-contract and schema versions for reproducibility.

### Read-only tool gateway

The model receives narrow tools rather than direct filesystem, SQL, broker or shell access:

- `get_system_status`
- `get_current_recommendations`
- `explain_recommendation(proposal_id)`
- `diagnose_symbol(symbol, as_of)`
- `get_scanner_rejections(symbol_or_session)`
- `get_positions_and_protection`
- `get_order_and_reconciliation_status`
- `get_strategy_performance(date_range, benchmark)`
- `get_ruleset(version)`
- `get_news_social_evidence(symbol, as_of)`
- `get_experiment_status(experiment_id)`
- `compare_experiment(experiment_id)`

Each tool validates arguments, account/environment, date range and data freshness. It returns a bounded typed record with provenance. It cannot accept SQL, code, paths, URLs or arbitrary commands.

### Limited write tools

Only two assistant-initiated writes are allowed initially:

- `draft_shadow_experiment`
- `record_experiment_review`

The first creates a non-running draft. The user must approve its exact manifest before the experiment registry activates shadow collection. The second records the user's review outcome. Neither tool edits the active ruleset, deploys code or submits an order.

Broker tools such as submit, cancel, modify, transfer, credential entry and live-account switching are deliberately absent.

## Evidence-grounded response contract

Every substantive answer should return:

- Direct answer.
- `asKnownAt` timestamp.
- Evidence references and versions.
- Observed facts.
- Inferences, explicitly labeled.
- Missing or stale evidence.
- Confidence based on evidence completeness, not model confidence.
- Suggested next analysis, if any.

If the assistant cannot establish a claim from tools, it says so. It must not translate `no data` into `no risk`, or `paper connected` into `order ready`.

## Experiment proposal contract

A draft experiment contains:

- Immutable experiment ID and creation time.
- User question and diagnosed failure mode.
- Baseline ruleset and evidence cutoff.
- One exact proposed change.
- Economic hypothesis and expected direction.
- Affected universe and market sessions.
- Hard controls that remain unchanged.
- Required sample size and forward duration.
- Primary and guardrail metrics.
- Fee, spread and slippage assumptions.
- Baseline, matched-control and benchmark comparisons.
- Leakage and survivorship-bias checks.
- Promotion, continuation and rejection criteria.
- Automatic rollback conditions.
- Authority flags, all false except `shadowResearchAllowed` after user approval.

The assistant may explain or revise a draft conversationally. Activation requires a deterministic server validation plus an explicit user confirmation bound to the manifest digest.

## Improvement loop

### 1. Diagnose

Example: “Why did we miss BMNR?”

The assistant retrieves the exact as-of scan, universe membership, completed bars, intraday observations, liquidity/spread status, catalyst/social events and portfolio constraints. It reports every failed rule and whether the move occurred before or after available evidence.

### 2. Propose

Example: test admitting candidates that fail only relative volume by a narrow amount. The assistant produces a draft with one changed threshold, fixed dates, costs, sample requirements and rollback limits.

### 3. Shadow test

The existing immutable journals run baseline and candidate rules on identical point-in-time evidence. No recommendation card or order behavior changes.

### 4. Evaluate

The assistant retrieves a deterministic comparison report. It may summarize but cannot calculate a different result privately. Reports include rejected candidates, missing sessions, drawdown, adverse excursion, after-cost returns and benchmark/control comparisons.

### 5. Decide

The user chooses reject, revise, continue collecting or submit for bounded promotion review. Promotion remains a separate server-side workflow with tests, decision log, manifest, rollback and release gates.

## Security and trust boundaries

- Treat news, transcripts, social posts and retrieved documents as untrusted data, never as assistant instructions.
- Separate system instructions, user requests, tool results and external content.
- Redact secrets, account identifiers and unnecessary personal data before model requests.
- Log every tool call, arguments digest, result digest, model/version, latency and response evidence IDs.
- Rate-limit per user and per tool; cap date ranges and output sizes.
- Never expose chain-of-thought. Store concise conclusions, cited evidence and structured decisions.
- Require the server to enforce permissions even if the model requests a forbidden tool or malformed action.
- Provide a global kill switch that disables assistant calls without affecting scanning, risk controls or broker reconciliation.

## Data model

- `assistant_thread`: local user/thread identity, title and retention state.
- `assistant_turn`: user text, response text, model/prompt version and timestamps.
- `assistant_tool_audit`: typed call, argument/result digests, evidence IDs and status.
- `assistant_evidence_ref`: source type, immutable ID, version and as-of time.
- `experiment_draft`: structured hypothesis, baseline, proposed change and manifest digest.
- `experiment_approval`: user, time, exact manifest digest and shadow-only scope.
- `experiment_run`: immutable baseline/candidate observations and health.
- `experiment_assessment`: deterministic results and gate conclusion.
- `promotion_decision`: separate signed reject/continue/revise/approve record.

## Sequential delivery

### Phase 1 — read-only explanations

- Build the assistant endpoint and mobile chat screen.
- Implement five read-only tools: system status, recommendations, symbol diagnosis, positions/protection and performance.
- Answer with citations and freshness labels.
- Add prompt-injection and secret-leakage fixtures.

Exit gate: a reviewed question set produces evidence-consistent answers, forbidden actions are impossible and no trading state changes.

### Phase 2 — deeper research questions

- Add scanner rejection, ruleset, news/social and reconciliation tools.
- Support cross-session comparisons and counterfactual questions using deterministic server reports.
- Add feedback controls for `helpful`, `incorrect`, `missing evidence` and `too vague`.

Exit gate: feedback is captured without becoming a strategy label or silently changing behavior.

### Phase 3 — experiment drafting

- Add the strict experiment schema and `draft_shadow_experiment` tool.
- Validate one-change discipline, evidence cutoff, sample gate, costs and authority flags.
- Add a confirmation sheet that displays the exact frozen manifest.

Exit gate: the assistant can create only valid inactive drafts; prompt injection and ambiguous approval cannot activate them.

### Phase 4 — shadow activation and monitoring

- Allow explicit user approval to activate validated shadow manifests.
- Connect to existing daily, intraday, macro and social journals.
- Surface capture health and insufficient-evidence states in chat.

Exit gate: baseline and experimental observations use identical point-in-time inputs and survive restart without drift.

### Phase 5 — assessment and governed promotion

- Add deterministic comparison reports and assistant summaries.
- Record reject, revise, continue or promotion-review decisions.
- Keep production activation outside the chat model and behind the existing tests/release controls.

Exit gate: no conversational wording can bypass the signed promotion manifest and deployment process.

## Recommended first implementation slice

Build a read-only assistant that answers five questions from local evidence:

1. What is the system doing now?
2. Why did this recommendation appear?
3. Why did this symbol fail the scan?
4. What positions are open, protected and available for rotation?
5. How has the strategy performed over a selected period?

Do not implement experiment writes in the first slice. The first milestone proves evidence retrieval, citations, freshness, mobile streaming, security and cost before adding self-improvement workflows.

## Initial effort and cost expectation

- Phase 1: approximately one focused week using the existing local service and data stores.
- Phase 2: approximately another week for deeper diagnostics and reviewed evaluation prompts.
- Experiment drafting/activation: approximately two additional weeks because manifests, confirmation, replay and adversarial tests must be deterministic.
- At personal pilot volume, model cost should be small relative to market/social data. Add explicit per-day token and request caps before enabling the endpoint.
- Keep this local initially. Move the conversation API and read-only evidence service to AWS with the social collector when remote availability and notifications are required; keep brokerage authority in the local connector.

