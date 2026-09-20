# Paper proposal service

This local service is the boundary between the phone interface and a future user-owned trading agent.

## Durable trading ledger

`trading_ledger.mjs` defines the first version of the local SQLite lifecycle ledger. It stores immutable proposal terms, one decision per proposal, restart-safe submission idempotency keys, broker-order identities, and append-only lifecycle events. Run `npm run test:ledger` to verify persistence and duplicate protection.

The proposal-through-submission service path now writes to the ledger. On startup, unresolved proposals and their decisions are restored, successful preview and What-If gates are recovered, and a repeated submission uses its durable idempotency record instead of contacting IBKR again. If connectivity is lost after transmission begins, the attempt is marked `unknown` and another transmission is blocked until broker reconciliation determines what happened.

Read-only IBKR reconciliation collects balances, positions, open orders, and executions into a complete source snapshot. It runs every 5 seconds while orders are active, every 15 seconds while positions are open, and every 60 seconds while the account is quiet. Recognized application order references are linked back to the ledger; broker evidence resolves an otherwise unknown submission without retransmitting it. External/manual broker activity remains visible rather than being overwritten.

An optional, git-ignored `service/data/paper-transaction-history.json` holds manually reviewed historical Paper transaction movements for selected symbols. Its account value must use the same masked form returned by the read-only IBKR collector. The service checks that account label and shows whether the net share quantity agrees with the current broker position. A masked label alone is not unique account proof: the history never assigns app ownership or sale authority. A mismatch blocks otherwise exact ownership matching. Set `HISTORICAL_BROKER_EVIDENCE_PATH` for a different local file; do not commit personal statement data. Recheck the record after later broker trades, since it is a dated observation rather than an automatically refreshed feed.

For positions created before the SQLite ledger, generate an IBKR Paper Activity Flex Query with Trades → Execution, a 365-day window, `Include Audit Trail Fields: Yes`, and CSV output. It must cover the entire relevant trading period and contain the target symbols. Run `node service/import_paper_flex_report.mjs /path/to/report.csv` to validate the same-account executions, API-order flag, unique execution IDs and `trade-approval-…` order references, then store a minimal private summary at `service/data/paper-flex-attribution.json`. The service uses this only when its signed quantities exactly match the current broker position, broker average cost is present, and no observed external trade contradicts it. This bridge verifies legacy app origin, not original approval details or protective-stop coverage. Any later quantity change without fresh attribution fails closed; do not commit the CSV or private summary. Set `PAPER_FLEX_EVIDENCE_PATH` only if storing the summary elsewhere.

## Alpaca research cache and scanner

Alpaca supplies the active U.S.-equity asset master and adjusted daily bars. The cache uses IEX by default; SIP is used only when explicitly configured and available to the account. `npm run market:refresh` removes non-tradable, OTC and obvious non-common-stock instruments, ranks the survivors by the latest completed session's dollar volume, stores the top 500 and roughly 430 calendar days of history in `data/market-cache.sqlite3`, and never stores credentials. `npm run market:status` reports cache coverage; `npm run market:scan` evaluates the cached universe without contacting IBKR.

Set `APCA_API_KEY_ID` and `APCA_API_SECRET_KEY` in the ignored `.env.local` file. The cache fails closed when credentials or data are unavailable. The free Alpaca plan may provide historical SIP bars when the request ends outside the restricted recent-data window; current feed access remains account-dependent.

`POST /shadow/scan` evaluates the local cache and stores the selected observation and its checks in `data/shadow-signals.json`. Repeating the same ruleset, symbol, and signal date is idempotent. IBKR remains the authority for the final bid/ask, paper account, What-If validation and execution.

`GET /shadow/signals` returns the durable shadow ledger. Shadow records always include `orderSubmissionAllowed: false`; they are not accepted by the approval or paper-order routes.

## Stock news context

The separate higher-volatility research lane runs with `npm run market:aggressive:refresh`, `npm run market:aggressive:scan`, and `npm run market:aggressive:status`. It uses `data/aggressive-market-cache.sqlite3` and the authenticated read-only `GET /shadow/aggressive` endpoint. Its top-1,500-plus-eligible-watchlist universe and volatility/relative-volume thresholds are experimental. Output is **not** an actionable recommendation: it has no verified catalyst, consolidated liquidity, live spread, portfolio sizing or broker validation. The existing 500-stock recommendation and IBKR submission paths are unchanged. Run `python -m unittest discover -s service -p test_aggressive_shadow_scanner.py -v` for isolated tests.

`intraday_shadow_evaluator.py` is a provider-free, research-only evaluator for immutable intraday observations. It checks observation/quote freshness, regular-session state, halts, coherent prices, day momentum, opening gaps, relative volume, session dollar volume and spread, returning all failures rather than stopping at the first one. It cannot fetch data, persist observations, create proposals, size trades or call a broker. All thresholds are proposed test variables. `test_intraday_shadow_evaluator.py` includes a BMNR-like move and fail-closed stale, future, crossed and incomplete snapshots.

`intraday_shadow_journal.py` adds append-only SQLite research evidence without connecting a provider. It requires data-source and consolidated/single-venue/unknown volume provenance, stores passing, failing and incomplete evaluations, deduplicates exact repeats and blocks row updates/deletes. Replay is chronological and refuses to reinterpret an unknown historical ruleset. The journal does not make the evaluator actionable and is not connected to the application API or broker.

`intraday_shadow_replay.py` imports newline-delimited recorded observations only after validating the complete file envelope and provenance. Reimports are idempotent through the journal. Its research report chooses the first eligible observation for each symbol and New York market-session date, then measures exact 5-minute and 30-minute observation windows, last-observed return, and favorable/adverse excursion. Missing windows remain incomplete; it never substitutes a distant price. These are reference-price observations—not fills—and exclude spread, slippage, fees, tax and market impact. The report cannot establish profitability and has no order authority.

`macro_event_bias.py` is the first pure component for a macro/news-and-volatility research lane. Caller-supplied evidence must identify a supported event type, timestamp, primary-source verification or two independent sources, surprise magnitude and confidence; it must also state the symbol's directional theme exposure. A fresh, non-halted quote then has to confirm direction, price movement, relative volume, an explicit ATR band and an acceptable spread. The result is a `LONG` or `AVOID_OR_EXIT` research bias with a versioned score, never a proposal or order. These thresholds are hypotheses for forward testing, not evidence of an edge.

`macro_event_journal.py` stores the exact event, source records, exposure-map version/rationale, market-data provenance, reaction snapshot and evaluation in append-only SQLite. Exact repeats are idempotent; source URLs/timestamps, event revisions, exposure provenance, market-data source and volume scope are mandatory. Corrections append a new revision instead of rewriting history. Database triggers prohibit updates and deletes, while replay refuses to reinterpret retired rulesets. It has no network or broker authority.

`macro_event_sources.py` provides a fixed allowlist and provider-neutral normalization contract for the Federal Reserve monetary-policy RSS feed, BLS Employment Situation RSS, BLS CPI RSS and the documented BLS release-calendar ICS. Responses are size/time bounded; redirected and item links must remain on the official host; unsafe/malformed XML and incomplete records are rejected. Stable source identity is separate from a content fingerprint so corrected feed entries can be detected without losing lineage. Feed items are explicitly `IDENTIFIED_NOT_SCORED`: official releases do not supply the market-consensus forecast needed to calculate surprise. A September 20 live read-only smoke check succeeded for all three RSS feeds. The BLS ICS endpoint returned HTTP 403 to an automated GET, so scheduling must remain unavailable until an approved reliable retrieval method exists.

`macro_consensus.py` defines a provider-neutral consensus record and a provisional Trading Economics calendar adapter. It accepts only exact-time, medium/high-importance U.S. events with stable IDs, update timestamps, official-source metadata and numeric value fields requested from the provider. Scheduled, released-without-consensus and released-with-consensus states remain distinct; missing actual or consensus values never become zero. Raw surprise retains the indicator's units. A bounded standardized surprise is calculated only from at least 12 strictly earlier observations of the same series, excluding future and cross-series records. The API key is header-only and date ranges are capped at 31 days. No subscription has been purchased, licensing has not been approved, and this adapter is not connected to the journal or recommendation queue.

`macro_exposure_map.py` provides an append-only registry for reviewed theme-to-symbol relationships. Every entry requires a bounded direction and strength, effective interval, substantive rationale, and timestamped HTTPS evidence classified as a filing, company report, official dataset, index methodology or regulator publication. Drafts, duplicate pairs, future evidence, invalid intervals and changes under an existing version are rejected. New reviewed versions may explicitly supersede known versions; older maps remain available for deterministic replay. Resolution is always by an explicit map version and as-of timestamp. No real company mappings ship yet, and the registry never infers exposure from a ticker or headline.

`macro_event_joiner.py` assembles official releases, scored consensus records, reviewed event crosswalks, active exposure mappings and post-release market reactions into the exact evidence contract used by the macro journal. Identity, review, timestamp, standardized-surprise history, mapping and reaction gates all fail closed. Similar names or dates never create an inferred match. The joiner is pure and has no scheduler, provider, proposal or order authority.

`GET /research/news?symbol=AAPL` provides stock-specific Benzinga headlines through Alpaca using the existing server-side `APCA_API_KEY_ID` and `APCA_API_SECRET_KEY`. Up to ten normalized headlines are displayed from one page of up to 50 records covering seven days. Publication/update times and original links are preserved; full article bodies are not requested. Pagination or rejected records produce an explicit partial result, not a claim of complete coverage. Feed latency is unverified.

The route uses existing app authentication. A bounded 60-second in-memory cache, concurrent-request coalescing, an eight-request concurrency cap, time/size limits and Retry-After handling protect the service. API secrets and raw upstream errors never enter responses. Preview Mode makes no news requests. News cannot affect scan eligibility, proposal prices, approval or submission. Run `node --test service/stock_news.test.mjs` for fixture tests.

## SEC EDGAR research source

The service uses Alpaca for bulk historical research, IBKR for current quote/account/execution data, and the official SEC EDGAR APIs for recent 10-K, 10-Q and 8-K filing metadata plus standardized XBRL revenue and net-income facts. Set `SEC_USER_AGENT` to a descriptive application name and contact email before enabling requests. SEC research is cached for 15 minutes, attached to proposals as context, and is explicitly marked `researchOnly`; it does not affect eligibility, sizing, prices, approvals, or order submission.

`GET /research/sec?symbol=NVDA` returns the normalized research record for a supported U.S. company. ETFs in the scanner universe are intentionally excluded.

Risk calculations live under `service/risk/`. Components have no network or broker side effects and return a versioned structured result. `equity-observed-market-risk-v1` currently combines volatility, overnight-gap, and historical-liquidity components. Complete trade risk remains null until entry, stop, quantity, portfolio, current spread, and event data are available.

It deliberately cannot submit live orders. Approved proposals receive an HMAC-signed, single-use receipt that binds the approval to an exact paper account, symbol, buy direction, quantity, order type, maximum entry price, protective stop, profit target, automatic-exit policy, and short expiration.

## Run locally

```sh
APPROVAL_SIGNING_SECRET="replace-for-local-testing" node service/server.mjs
```

Endpoints:

- `GET /health`
- `GET /proposals`
- `GET /audit`
- `GET /activity` returns application lifecycle records plus externally observed IBKR activity.
- `GET /positions` returns fresh reconciled IBKR Paper positions when available and clearly falls back to ledger-only filled entries otherwise.
- `POST /broker/reconcile` requests an immediate read-only reconciliation cycle.
- `GET /broker/portfolio` returns the latest freshness-gated authoritative portfolio snapshot.
- `GET /research/sec?symbol=NVDA`
- `GET /shadow/signals`
- `GET /risk-policy` returns the persisted paper sizing policy or safe smart defaults.
- `POST /risk-policy` validates and persists editable hard limits and the adaptive-mode preference.
- `POST /shadow/scan`
- `POST /recommendations/queue` returns every ranked candidate that currently passes the research scan and fresh IBKR spread check. The result count is market-driven rather than fixed. Each proposal expires independently; ATR volatility shortens the lifetime from 10 minutes to 5 or 2 minutes.
- `POST /proposals/demo`
- `POST /proposals/:id/decision` with `{ "decision": "approved" }` or `denied`
- `POST /orders/preview` with a signed approval token; validates and previews but cannot submit
- `POST /orders/what-if` runs IBKR's broker-side pre-trade check only when explicitly enabled; it forces `whatIf=true`. IBKR requires `transmit=true` for What-If validation, but does not execute What-If orders.
- `POST /orders/submit-paper` submits only after a signed recommendation approval, preview, What-If, a fresh quote/account check, and an unused approval. The symbol must match the current server-approved Alpaca-universe proposal. It accepts only a BUY of 1–5 whole shares and at most $1,500 notional in the IBKR paper account. The adapter submits a coordinated bracket: DAY limit buy, attached GTC profit-taking limit sell, and attached GTC protective stop sell. No standalone, arbitrary-symbol, or short sell order is accepted.
- `POST /pause` with `{ "paused": true }`

The adapter accepts only verified receipts whose `environment` is `paper`, refreshes account and quote data, and rejects altered, expired, duplicate, over-limit, or invalid-bracket orders.

Automatic Paper strategy exits are currently disabled by a code-level release hold in both the service worker and the direct paper-exit adapter; `IBKR_ENABLE_AUTOMATIC_SELLS=true` cannot bypass it. The former cancel-protective-order-then-submit-sale path is blocked before broker connection. Its quote gate requires IBKR live data type 1, valid bid/ask within the configured spread, and both local quote callbacks within five seconds. Callback arrival time is not an exchange timestamp. A successful scanner run must also contain a complete held-symbol evaluation for the exact expected prior weekday session; stale, missing and errored results fail closed (exchange holidays are not yet modeled). Delayed type 3 data observed after the 2026-09-18 market open and the missing production broker modification/acknowledgement lifecycle are independent blockers. Existing broker-side stops and targets are separate from this disabled worker.

`protected_exit_lifecycle.mjs` is a credential-free simulator stage for replacing an existing bracket target while leaving its stop in place. It emits one descriptive intent, waits for broker-observed order terms, and never retransmits an uncertain request after restart. Rejection, partial fill, oversize stop, competing sell, disconnect and ambiguous closure fail closed. The deterministic broker models modification acknowledgements for tests; there is no IBKR modification adapter, durable production outbox, confirmed sibling rebalancing or permission to enable automatic selling. The account's API quote still returns warning 2186 after acknowledgement, subscriber classification and TWS restart.

`protected_exit_outbox.mjs` adds local SQLite persistence for those simulator intents. It saves immutable terms, permits one unresolved request per account/symbol, and commits a one-time dispatch claim before returning a descriptive command. Claim requires a new complete Paper broker snapshot; a crash after claim has an unknown transport outcome and cannot be retried without broker evidence. A separate IBKR adapter and service-worker integration have **not** been implemented. Run `node --test service/protected_exit_outbox.test.mjs` to exercise crash windows and read-only recovery.

The read-only ownership check requires the total linked active stop quantity to equal the current strategy-owned position. Partial coverage is `partial`; excess coverage is `overcovered` rather than safe. Neither passes the exit gate or strategy-capacity check. Simulated partial-exit tests intentionally leave an oversized sibling stop to verify that the app detects the hazard; actual IBKR bracket rebalancing must be observed separately.

## Verify the local IBKR paper connection

Keep TWS open, logged into Paper Trading, with API socket clients enabled on port
`7497`. Read-Only API may stay enabled for connection testing and must be disabled
only when intentionally testing paper submission. Then run:

```sh
.venv-ibkr-10.49/bin/python service/ibkr_readonly_check.py
```

This checker connects only to localhost and contains no order-placement code.

To make the read-only broker snapshot available to Expo Go on the same trusted
Wi-Fi network, run `npm run service:phone`. The service remains paper-only and
the IBKR connection itself stays restricted to localhost. Network requests must
also provide the private token stored in the ignored `.env.local` file.
