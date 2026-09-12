# Crypto arbitrage — paper MVP design for review

Version 0.2 · 2026-09-07 · **Proposed; implementation blocked pending design review**

2026-09-10 review addendum: [CRYPTO_MVP_ASSESSMENT.md](./CRYPTO_MVP_ASSESSMENT.md) compares exchange and wallet paths, recommends deferring signing, and identifies proposed market-data and supervised/unattended UX revisions. These remain pending review and do not silently replace the sandbox baseline below.

This is a design deliverable, not an implemented engine or an approval to run a strategy. The user must separately approve each bounded paper session after implementation. The existing stock workflow remains unchanged. The authoritative component diagram is in `ARCHITECTURE.md`.

## 1. Repository findings and safe reuse

Reviewed the repository's first-party source, tests, configuration templates, both AGENTS.md files, architecture, project plan, decision log, READMEs, and dependency manifest/lock metadata. Excluded installed dependencies, virtual environments, generated caches, secret values in `.env.local`, and private runtime account/history databases from content review. No service was started, exchange account accessed, or dependency installed. Existing uncommitted changes in App.tsx, server, reconciliation, and architecture documents predate this design and must be preserved.

| Existing component | Finding | Crypto treatment |
|---|---|---|
| `src/design-system.ts` | Restyle themes, semantic colors, typography, radii, spacing | Share unchanged |
| `src/components/ui.tsx` | ActionButton, Toast, Badge, Disclosure | Share visual components; add accessibility announcements in crypto screen wrappers; the toast currently has no live-region announcement |
| `App.tsx` | One large Expo app; drawer, sheets, Preview Mode, loading/error states; USD number formatting and share labels | Preserve stock views and state; add a context boundary and separate crypto screens/data client; do not reuse stock DTOs or numeric inputs |
| `service/trading_ledger.mjs` | SQLite WAL/FULL, immediate transactions, immutable intent/idempotency patterns; proposal-specific schema and order roles | Reuse storage approach, not stock tables or lifecycle methods |
| `service/broker_reconciliation.mjs` | IBKR identity/reference matching, snapshots, external-activity classification; executions mapped to Filled | Reuse evidence-first approach only; crypto must aggregate partial fills and maintain distinct per-venue identities |
| `service/server.mjs` | Stock routes, HMAC receipts, auth, risk policy and scheduling are coupled; wildcard CORS and development signing fallback | Keep unchanged initially; independent crypto service and authenticated API; no importing server.mjs into crypto |
| `portfolio_sizing.mjs`, `risk/`, stock policy | Whole shares, protective stops, buying power, sectors, 252-day annualization | No reuse in crypto calculations |
| IBKR Python adapters, Alpaca cache, SEC research | Equity contracts, stock quote fallback, paper bracket orders and daily research | No dependency from crypto |
| Notifications | Durable events and foreground toasts exist; no notification delivery worker | New crypto outbox and in-app event delivery; background push remains explicitly incomplete |
| Web | Expo web script exists; dedicated web experience is listed as planned | Use cross-platform crypto components; verify browser behavior independently of iOS |

Stock documentation discrepancies are recorded, not repaired here: D-017 specifies separately approved ordinary profit taking, while server, submission adapter, tests and UI use an automatic profit-target bracket. Architecture status rows also lag the implemented reconciliation foundation. Crypto must not inherit either behavior or completion claims. Stock pause is partly UI/in-memory state; crypto pause and kill state must be durable server authority.

## 2. Scope, environments, and components

**Clarification from the user:** Crypto will not use IBKR. IBKR references in this package describe the existing stock system to preserve, not a crypto integration.

Separate broad token discovery from arbitrage pricing. A catalog provider such as CoinGecko can supply supported token IDs, names, indicative prices, market capitalization, volume and exchange listings. It is a proposed discovery provider, not a brokerage or execution venue. Its API lists its supported assets, not every token in existence. [CoinGecko endpoint overview](https://docs.coingecko.com/reference/endpoint-overview).

Discovery flow: catalog/reference data → token identity mapping → browser/watchlist. Execution eligibility remains the intersection of spot products actually supported on both selected sandbox exchanges, complete fresh books, account inventory and approved session limits. Catalog listing does not imply availability on either venue; match stable asset IDs rather than ticker text alone. Aggregate prices never enter the executable opportunity calculation.

The broader catalog is a proposed addition for review. Under the original sandbox/simulation/recorded-data constraint, use explicitly labeled recorded catalog fixtures initially; enabling a current public catalog feed needs an agreed data-source scope, API plan and licensing review. No public production exchange pricing or account access is silently added. Sandbox coverage is smaller than a broad token catalog, so the browser may list tokens that the paper engine cannot trade.

Inventory-based cross-exchange **spot only**: buy using prefunded quote cash at A and sell already-owned base inventory at B. Reverse direction is a separate candidate. No transfer is part of either pair, and no sale proceeds from the other venue fund a leg. No leverage, margin, borrowing, derivatives, DeFi, bridges, smart contracts, on-chain arbitrage, or live orders. Crypto operates continuously while the local service is available, independent of U.S. stock market hours; execution is limited to the approved UTC interval.

Proposed venue pair:

| Venue | Sandbox endpoint allowlist | Initial data path |
|---|---|---|
| Coinbase Exchange Sandbox | REST `https://api-public.sandbox.exchange.coinbase.com`; WS `wss://ws-feed-public.sandbox.exchange.coinbase.com` | Product metadata, public `level2_batch`, heartbeat; derive bid/ask from validated depth |
| Gemini Sandbox | REST `https://api.sandbox.gemini.com`; WS `wss://ws.sandbox.gemini.com` | Spot instrument metadata, differential depth with initial snapshot, book ticker and liveness |

Coinbase Exchange Sandbox supplies test funds, separate keys, and a subset of books; transfer endpoints are unsupported. This is the Exchange sandbox, not the Advanced Trade mock API. [Coinbase sandbox documentation](https://docs.cdp.coinbase.com/exchange/introduction/sandbox).

Gemini documents test balances and simulated book activity in its sandbox. [Gemini sandbox documentation](https://developer.gemini.com/get-started/sandbox).

Coinbase's public batched depth channel supplies snapshots and updates; updates carry exchange time. [Coinbase channels](https://docs.cdp.coinbase.com/exchange/websocket-feed/channels). Gemini's differential stream includes update IDs and nanosecond event timestamps. Preserve these without JavaScript Number conversion. [Gemini streams](https://developer.gemini.com/websocket/streams).

BTC/USD and ETH/USD are candidate allowlist entries, not verified current sandbox listings. Discover the actual intersection of enabled spot instruments, fee capabilities and rules at startup. Missing intersection means an explicit unavailable state. Sandbox depth and access have not been smoke-tested in this design phase. No production fallback or regional restriction bypass is permitted.

Two independent axes identify every record:

- `marketSource`: `SANDBOX_STREAM`, `RECORDED_SANDBOX`, or `SYNTHETIC_FIXTURE`.
- `accountAuthority`: `SIMULATOR` for MVP; `SANDBOX_EXCHANGE` reserved for separately reviewed integration tests. These account namespaces cannot be blended.

Network adapters normalize real sandbox observations. Two durable simulated exchange accounts implement the account/execution portion of the same normalized boundary. They alone authorize their simulated orders, balances, fees and fills. An actual exchange is authoritative only for records from its own account; the strategy ledger never pretends simulated orders exist at a remote exchange. This avoids reconciling local fills against unrelated sandbox balances.

Proposed files after review: `service/crypto/{adapters,collector,opportunity,risk,sessions,execution,simulator,reconciliation,ledger,api,notifications,fixtures}` and `src/crypto/{api,types,screens,components}`. Use a separate process, explicit port and `CRYPTO_ENABLED=false` by default. No imports from IBKR, equity risk, stock proposal service, or stock state files. Bound queues, CPU work and disk growth so a crypto feed burst cannot stall stock operations.

The collector runs without execution authority. The pure engine produces time-limited candidates and rejection reasons. The session controller authorizes limits. Risk allocates both venue inventories atomically. The coordinator persists intent before invoking the simulator. Reconciliation derives trusted state from independent simulator account evidence. Read models and a durable outbox feed the UI. All mutations pass through one fenced crypto coordinator; multiple writers cannot consume the same funds.

## 3. Normalized adapter contract

The following is a proposed contract, not executable implementation. Prices, quantities, fees, rates and money are canonical decimal strings externally; timestamps use UTC epoch milliseconds plus original exchange timestamp strings/units, with monotonic local clocks for elapsed-time checks. IDs and large sequences are strings. Missing information is null with a reason, never zero or a fabricated default.

| Operation | Input | Required result |
|---|---|---|
| `describe()` | None | Venue, environment, account authority, protocol version, supported spot capabilities, rate budget |
| `listTradingRules()` | Pair allowlist | Native/canonical symbol mapping, base/quote identity, status, price tick, size step, min/max size and notional, allowed IOC limit semantics, version and observation time |
| `streamBooks()` | Validated pairs, cancellation signal | Snapshot/update/heartbeat/reset events, bid/ask depth, sequence/integrity evidence and all available timestamps |
| `getBookSnapshot()` | Pair | Ordered depth and scope (full or N levels), snapshot identity and integrity; unknown depth beyond scope stays unknown |
| `getFeeSchedule()` | Account alias, pair | Taker fee rate, charge asset, rounding/minimum fee, version, source, effective/as-of time and expiry |
| `getAccountSnapshot()` | Account alias, cursor | Free/locked/total by asset, open orders, terminal-order changes, fills, fees, external movements, source epoch, component capture times, pagination completeness and coverage cursor |
| `findOrder()` | Account + durable client reference | `FOUND(order)`, `ABSENT_CONFIRMED(coverageEvidence)`, or `UNKNOWN(reason)` |
| `submitPaperOrder()` | Session authorization, immutable order, idempotency key, client reference | `ACKNOWLEDGED(order)`, `REJECTED(reason)`, or `UNKNOWN(submissionEvidence)` |
| `cancelPaperOrder()` | Exact account/order identity, idempotency key | Cancel acknowledgement, terminal order evidence, or unknown outcome; cancellation is not assumed final |
| `health()` | None | Connected/degraded/disconnected, last event/heartbeat, clock skew, integrity, limiter status, reasons |
| `close()` | None | Close subscriptions and release resources; never imply outstanding orders were cancelled |

Normalized order: venue + environment + account alias + source epoch + exchange order ID, client reference, session/pair/leg IDs, pair, side, `LIMIT`, `IOC`, base size, limit, submitted/acknowledged times, filled/remaining quantities and raw status. Canonical status: `PENDING`, `OPEN`, `PARTIAL`, `FILLED`, `CANCEL_PENDING`, `CANCELLED`, `REJECTED`, `EXPIRED`, `UNKNOWN`. Preserve filled quantity even on cancelled/expired orders.

Normalized fill: stable venue/account/epoch fill ID, exact order reference, base quantity, quote price/notional, liquidity role, exchange event time, receipt time, fees as separate asset/amount entries. Missing fee means accounting incomplete. Balances carry authority and exactness, not an estimated spendable figure. Identical payload retries are idempotent; a reused ID with different terms is a conflict.

The deployed network adapters expose market reads only; `submitPaperOrder` and `cancelPaperOrder` dispatch solely to the simulator in MVP. No production hostname, arbitrary base URL, transfer method, or real-order implementation is shipped. Unsupported capabilities return a typed error. If a later sandbox-account harness is reviewed, it gets a separate namespace and sandbox-only transport, without changing this MVP execution binding.

Fee models may be explicit versioned simulation assumptions approved in the session; they must never be labeled an observed account fee tier. Initial supported fee charge asset is USD. Non-USD fee models/observations are retained, marked unsupported for new orders, and block accounting until modeled; do not assume a fee-token discount.

## 4. Collector and data validity

Construct each venue book using its own documented snapshot/update semantics. Buffer deltas during snapshot load; enforce sequence continuity where supported, reject malformed or negative levels, apply zero-size removals, and resynchronize after gaps. Where the feed lacks sequence/checksum evidence, use its documented ordered-delivery semantics with fresh independent snapshot validation; do not invent a sequence number. Bound buffers; overflow invalidates the book.

Persist source timestamp and unit, normalized UTC timestamp, local receipt UTC time, monotonic receipt, stream epoch, sequence where available, source mode, instrument/rules version and depth scope. Parse nanosecond numeric JSON fields losslessly before ordinary JSON conversion. A timestamp-less initial snapshot may initialize a book but cannot produce an executable candidate until timestamped validation evidence is available. Missing exchange time remains explicit.

Candidate validity requires both books complete for the size, uncrossed within each venue (bid < ask), fresh, time-aligned, connected, and using compatible base/quote identities. A higher bid on B than ask on A is the desired cross-venue condition, not a crossed-feed fault. Reject future times outside clock tolerance, mismatched epochs, symbol confusion, stale rules, fee data, or balance evidence. Heartbeats prove connectivity, not fresh prices. Book/ticker disagreement outside protocol ordering tolerance invalidates the candidate.

Proposed initial test settings: maximum book-event and receipt age 1 second, cross-venue event-time skew 250 ms, clock offset tolerance 250 ms, account snapshot age 2 seconds at allocation. These are deliberately configurable session-bound simulation parameters, not claims of optimal values. If a sandbox cannot satisfy them, show unavailable opportunities; do not silently relax limits.

Use independent per-venue token buckets for REST, subscriptions and reconnects, with reserved capacity for reconciliation/cancel work. Respect Retry-After and documented budgets; exponential backoff with capped jitter on reconnects, never on uncertain submissions. Rate-limit degradation blocks new pairs. Verify current endpoint-specific limits during adapter implementation, including sandbox exceptions. [Coinbase REST limits](https://docs.cdp.coinbase.com/exchange/rest-api/rate-limits). Record the corresponding Gemini limit source and tested settings before its adapter is accepted; no numeric rate budget is assumed here.

## 5. Deterministic opportunity calculation

Use a reviewed decimal arithmetic library after dependency review, or an equivalently tested fixed-point BigInt implementation; never binary floating-point for financial calculations or SQLite REAL for money. Suggested choice is a dedicated decimal library with isolated rounding configuration and precision/range limits. No dependency is installed by this proposal.

Initial same-quote USD spot pairs avoid inventing stablecoin parity or FX conversion. Both venues must report exactly the same asset identity. Generalized cross-quote comparisons are out of scope.

For a common executable base quantity q:

1. Quantize q down to a common multiple of both size steps using exact integer arithmetic. Enforce both venues' min/max quantities and notionals, and per-leg price ticks. Never round up size to satisfy a minimum.
2. Walk A's asks from cheapest upward: C(q) = sum(price × consumed size). Walk B's bids from highest downward: R(q) = sum(price × consumed size). Insufficient available depth rejects q.
3. Compute conservative taker fees FA(q), FB(q), rounding each fee/cost upward to the declared accounting quantum. Quote costs round upward; proceeds downward. Respect configured fee minima and charge asset.
4. Estimate additional latency slippage S(q) = C(q) × buyLatencyBps / 10000 + R(q) × sellLatencyBps / 10000. This is price movement beyond current depth impact. Bounds must agree with the simulator's per-leg limit prices.
5. Add versioned rebalancing allowance K(q) = fixedCost + q × perBaseCost, and uncertainty U(q) = C(q) × bufferBps / 10000. K represents future inventory restoration/withdrawal costs economically, without authorizing a transfer. Missing K is incomplete; an explicit simulated value is an assumption, not exchange data.
6. Net N(q) = R(q) − C(q) − FA(q) − FB(q) − S(q) − K(q) − U(q). Basis points = 10000 × N(q) / C(q); the denominator is buy notional and is disclosed, not a return on all prefunded capital.
7. Require strict N(q) > minimumUsd AND 10000 × N(q) > minimumBps × C(q), using unrounded exact comparisons. Rounded UI numbers never decide eligibility. Revalidate at dispatch.

Spread is already included by buying asks and selling bids. Current depth impact is already included by walking levels. Report both for explanation, but do not deduct either twice. Latency slippage is the additional adverse movement allowance. Buffer is a conservative estimate, not an actual fee.

Deterministic size search considers cumulative depth breakpoints from both books, rule/fee breakpoints and risk-cap endpoints, including adjacent valid common-step quantities. Sort candidates, reject every infeasible size and maximize conservative net dollars; tie-break by smaller size, then lexical direction. Version any nonlinear cost model with its own deterministic search. Do not assume larger size or maximum available capital is always best.

Illustrative synthetic unit vector (not current market data): q=1, A asks 0.4 at 100 and 0.6 at 101, B bids 0.5 at 103 and 0.5 at 102. C=100.6; R=102.5; each taker fee 10 bps gives FA=0.1006 and FB=0.1025; latency 5 bps each gives S=0.10155; K=0.10; buffer 2 bps gives U=0.02012. N=1.47523 USD, approximately 146.6431 bps. Passes thresholds 1 USD and 100 bps; fails either strict equality boundary. This vector assumes a USD simulation accounting quantum of 0.00001, separate from display cents.

Unit tests after review: this depth vector; negative net despite positive top-book spread; depth exhaustion; fee minima/rounding; strict USD/bps equality; small sizes with differing steps/ticks; malformed decimal, overflow and zero denominator; stale/future/gapped/crossed/disconnected feeds; symbol/quote mismatch; missing fee/rebalance cost; deterministic tie-break and replay; unsupported fee currency. Properties: costs cannot improve net, no depth reuse within a simulated arrival batch, and identical inputs/version/clock yield identical results.

## 6. Capital, session limits and control state

Use dedicated prefunded simulated accounts per venue. Funding is an explicit seed event with provenance, not a fallback when balances are unavailable. Funding additions/resets during an approved session are external movements, freeze new allocation, and require a new proposal. No automatic replenishment.

Risk checks exact fresh reconciled free balances, exchange locks and app reservations without double counting: subtract only reservations not already represented by authoritative exchange locks, matched by order reference. Atomically reserve buy quote plus worst-case fees, sell base, and the disclosed paper-risk response budget. Concurrent candidates share one serializable allocation transaction and coordinator fencing token.

Session proposal contains all of:

- Exchange/account aliases, spot pairs, source mode, strategy and simulation-model versions.
- Maximum allocated capital across cash AND marked base inventory; per-exchange and per-token USD caps; per-order USD cap, paired gross-notional cap, session cumulative turnover and UTC-day turnover caps.
- Minimum net USD and bps, fee schedule/model, slippage, rebalancing allowance and uncertainty buffer.
- Maximum daily loss, absolute per-venue inventory deviation from approved starting base quantities, aggregate unhedged base/USD cap, and maximum unhedged duration.
- Minimum free USD reserve per venue, maximum simultaneous open/pending/unknown orders, with slots and capital reserved for exception handling.
- Exact start/end UTC, proposal approval expiry, data freshness/skew tolerances, and predefined paper-risk response with adverse-price/loss caps.
- Expected cost disclosure and principal risks: one-leg exposure, inventory depletion, outages, uncertain status, artificial sandbox liquidity, price movement, fees and no guaranteed profit.

At every allocation, dispatch and fill: enforce venue/token/session/order/day caps, worst-case exposure of both possible one-leg fills, reserve floor, open-order count and daily loss. Valuation uses fresh executable USD marks; no mark means risk unavailable. Aggregate daily loss includes fees, realized execution losses and conservative mark-to-market deterioration relative to the day's opening inventory, adjusted for explicit external flows. Show arbitrage spread P&L separately from the market P&L of prefunded tokens. UTC-day counters persist across sessions and restarts; approving a new session never resets the day's losses.

Session states: `PROPOSED → APPROVED → RUNNING → PAUSING → PAUSED`; terminal control states `EXPIRED`, `STOPPED`, `BOUNDARY_STOP`, and `RECOVERY_REQUIRED`. Approving binds the canonical immutable proposal hash, identity, nonce and revision. Execution starts only after current health/risk checks, within the period, and with a valid worker lease. No client-supplied override or generic order endpoint exists.

Pause durably blocks new pairs immediately, cancels remaining strategy orders, and continues reconciliation and the approved bounded exception response. Resume requires an explicit user action with unchanged unexpired limits and fresh reconciled state. Emergency Stop latches a global **crypto** kill switch across all crypto sessions; no new pairs or new paper-response orders after the latch, cancel only and reconcile. Preserve the stock pause/approval behavior. A stopped or boundary-hit session cannot resume; clearing a kill latch cannot restart it. Changing any limit or renewing requires a new proposal and explicit approval.

Expiry and any hard boundary close the new-order gate atomically. Cancellation/reconciliation continue; no attempt to guarantee flattening when limits, data or connectivity prevent it. Unresolved exposure remains visible even after a control state is stopped. A process restart goes to recovery, reconciles all intent, and requires explicit resume or a new session as appropriate; never reset time limits or replay execution automatically.

## 7. Paired paper execution and uncertainty

Persist the opportunity input references, authorization hash, both reservations, pair intent and immutable leg client references in one transaction before dispatch. Mark per-leg submission intent durably before the simulator sees it. Schedule both IOC limit orders at the same simulated dispatch time with independent modeled outbound latency; simultaneous submission does not mean atomic fills.

Each simulated exchange has its own durable matching/account journal, separate from the application's expected ledger, injected clock and persisted seeded randomness. Record decision time, dispatch/arrival/ack/fill times and model version. Matching consumes the book available at arrival, adverse movement and a configurable depth-participation cap; account for liquidity already consumed by this simulation. No future-data lookahead or fill outside the limit. Feed outage or expired data cannot generate a fill. Synthetic adverse scenarios and recorded playback always keep their own labels.

Model zero, partial and full fills per leg; rejects; timeout before acceptance; acceptance or fill followed by lost acknowledgement; delayed fills; cancellation/fill races; delayed fees; and account/reset outages. Persist random draws or deterministic event sequence so crash recovery reproduces outcomes. Use fixed scenarios in tests and seeded stochastic scenarios in paper runs; neither guarantees realistic live profitability.

Pair states include `RESERVED`, `SUBMITTING`, `WORKING`, `PARTIAL`, `HEDGED`, `UNHEDGED`, `CANCELLED`, `RECONCILING`, `CLOSED`, and `EXCEPTION`. Track submission certainty and exposure separately. An unknown leg is not an unfilled leg. Any confirmed net base mismatch immediately starts UNHEDGED time, including unequal partial fills; two equal partial fills may be hedged while their order remainders still need cancellation. CLOSED requires terminal evidence for every leg, complete fills/fees and clean reconciliation.

Predefined response proposed for approval: freeze new pairs, cancel both residuals, reconcile until both outcomes are known; then make at most one paper IOC unwind of confirmed net excess at the venue where it arose. Sell only verified excess purchased inventory; buy back a sale only with verified USD reserved for that response. Enforce response size, adverse-price and loss caps and remaining unhedged time. Unknown submissions, degraded feeds, balance differences, kill, expiry or any hard boundary forbid the unwind. Failure or timeout retains unresolved exposure and latches a stop; never invent a fill or send an unlimited emergency market order.

Idempotency is scoped by account authority/environment/venue/account/source epoch plus session/pair/leg/action. Reference encoding must fit each venue without ambiguous truncation; store the full mapping. A timeout or crash after intent is UNKNOWN, including cancellation ambiguity. Do not retransmit until authoritative lookup/history with complete coverage proves existence or absence. Absence from open orders alone proves nothing. If absence cannot be proven, stop and retain the reservation. A proven-absent retry still needs fresh authorization/risk checks and an audited new attempt linked to the same logical order; a stopped session cannot retry.

Simulator tests: both fills; both rejects; equal/unequal partials; one-leg fill and capped unwind; insufficient response funds; partial unwind/dust below minimum; accepted-but-ack-lost; fill-after-timeout; cancel race; repeated submission with same/different body; crash at each persist/dispatch boundary; duplicate coordinator; kill/pause racing dispatch; maximum unhedged-duration expiry; zero network order calls in every path.

## 8. Durable ledger schema and migration plan

Extend the application's durable-ledger architecture with a separate `crypto-ledger.sqlite3` and namespaced schema. This intentionally avoids high-frequency writes, migrations or lock contention in the working stock database. `simulated-exchanges.sqlite3` stores authoritative simulated account evidence separately. Crypto read models join only crypto tables; optional combined navigation does not combine portfolio arithmetic.

All tables use STRICT types, foreign keys, explicit status checks and indexed UTC timestamps. Financial columns are validated canonical TEXT decimals; no SQLite SUM/CAST-to-REAL for accounting. Identity keys include environment/account authority/venue/account/epoch. Mutable projections have revision numbers; immutable intent, events and snapshots cannot be silently overwritten.

| Table | Key and principal fields / constraints |
|---|---|
| `crypto_schema_migrations` | Version PK, migration checksum, applied UTC time |
| `crypto_accounts` | Account PK; unique authority/environment/venue/alias/epoch; allowed spot assets |
| `crypto_session_proposals` | Proposal PK; canonical terms JSON + hash, model versions, creation/approval expiry; immutable |
| `crypto_session_decisions` | Decision PK, proposal FK UNIQUE, approver, approved/denied, nonce UNIQUE, timestamp, terms hash |
| `crypto_sessions` | Session PK, approved decision FK UNIQUE, runtime status/revision, start/end, fencing token; immutable limits referenced from proposal |
| `crypto_controls` | Scope PK, kill latch, revision, actor/reason/time; append corresponding control event |
| `crypto_rule_fee_versions` | Version PK, account/pair, kind, source, terms, effective/expiry times and source evidence |
| `crypto_book_evidence` | Book PK, account-independent venue/pair/source/epoch, timestamp metadata, depth scope, integrity and content hash/payload |
| `crypto_opportunities` | Opportunity PK, session nullable FK, buy/sell book FKs, rules/fees/model refs, size/cost breakdown, validity deadline, rejection reasons |
| `crypto_paired_orders` | Pair PK, session/opportunity FKs, authorization hash, state/revision, net exposure, first-unhedged time |
| `crypto_order_intents` | Intent PK, pair FK, account FK, leg/response role, canonical order hash, client reference; account/reference UNIQUE |
| `crypto_submission_attempts` | Attempt PK, intent FK, idempotency key UNIQUE, request hash, certainty, dispatch/response evidence and timestamps |
| `crypto_exchange_orders` | Account + exchange order ID UNIQUE, intent FK nullable for manual orders; status, filled/remaining, latest evidence revision |
| `crypto_fills` | Account + fill ID UNIQUE; order FK, price, base size, quote notional, exchange/receipt times; conflicting replay fails closed |
| `crypto_fees` | Fee PK and source identity UNIQUE, fill/order FK, currency, amount, model/evidence version, completeness; corrections via reversal records |
| `crypto_reservations` | Reservation PK, session/pair/intent/account/asset FKs, exact amount, purpose, state; release only on authoritative terminal evidence |
| `crypto_inventory_journal` | Entry PK, account/asset, quantity delta, fill/fee/funding source UNIQUE per posting role, balancing entry/batch ID; append only |
| `crypto_reconciliation_snapshots` | Snapshot PK, account FK, start/end UTC, component times, complete/partial/error, cursors/watermarks, sanitized source payload |
| `crypto_balance_observations` | Snapshot/account/asset PK, exact free/locked/total, authority, timestamps, missing reasons |
| `crypto_inventory_projections` | Account/asset PK, journal cursor, verified balance, reserved/available, starting baseline; rebuildable |
| `crypto_daily_usage` | UTC date + scope PK, turnover, losses, reservations, opening marks and source snapshot refs; persistent across sessions |
| `crypto_reconciliation_differences` | Difference PK, snapshot FK, expected/observed values, reason, unresolved/resolved and resolution evidence |
| `crypto_external_activity` | Account/source identity UNIQUE, order/fill/funding/reset type, payload reference; never inferred as strategy intent |
| `crypto_exception_events` | Event PK, pair/session nullable FKs, unique event key, occurred/recorded times, severity, evidence, prior-event hash |
| `crypto_notification_outbox` | Event FK + channel UNIQUE, delivery state/attempt/cursor, sanitized payload; no secret/source response blobs |

Every inventory transaction balances quantity postings per asset between available, locked and counterparty/fee accounts. USD proceeds and base asset changes are separate postings, linked by fill. Fee corrections reverse earlier postings, never erase history. Persist matched-pair realized spread after actual fees separately from estimated rebalance reserves and from inventory mark-to-market; missing fees leave realized net incomplete. A displayed conservative net may subtract the rebalance allowance, but identifies it as an estimate and never books an uncertainty buffer as an actual fee.

Migration sequence after review: create new database at v1 using one exclusive migration transaction; validate checksum/schema version, foreign keys and decimal formats before startup; seed no sessions or balances automatically. Refuse unknown newer schemas. Test migration twice, interrupted migration, backup/restore and projection rebuild on copied fixtures. Backups use SQLite's consistent backup facility, not copying a live WAL database file alone. Rollback disables crypto and preserves its database/audit; it does not run destructive down migrations or modify the stock database.

Record compressed raw market evidence with content hashes for all execution decisions plus sufficient surrounding replay windows; retain every intent/fill/fee/reconciliation/exception record. Define storage quotas and archive retention before long-running monitoring. Disk-full or failed durable write closes execution immediately. An event hash chain detects accidental change but is not tamper-proof against a compromised host; stronger external audit retention is a later requirement.

## 9. Reconciliation worker

For each account authority independently: collect complete paginated balances, open and recently terminal orders, fills, fees and movements; persist sanitized source evidence before advancing cursors. Snapshot means a bounded observation window, not an assumed atomic remote read. Use stream watermarks plus stable re-reads where needed to establish consistency; no consistent window means INCOMPLETE.

Match full client references and account identity to immutable intents; compare asset, side, quantity and limits as well as IDs. Unknown/manual activity stays separate, enters account inventory accounting and freezes new strategy allocation until understood. Never silently adopt an unmatched order as strategy-owned or cancel a manual order. Detect source epoch changes and sandbox resets explicitly.

Rebuild expected balances from funding, authoritative fills/fees and external movements, compare totals and locks in exact venue precision, and verify reservation ownership, open-order count, filled quantities and net exposure. Duplicate identical evidence is a no-op; contradictory evidence becomes an exception. Never overwrite a difference to make it disappear. Atomically write imports, differences, projections, events, outbox and cursor progress. On restart, recover unfinished runs and all uncertain intents before opening allocation.

Proposed cadence: account streams where available plus 1-second reconciliation with open/unknown orders or unhedged exposure; 15 seconds idle; on-demand complete reconciliation before allocating from an expired balance. A rate budget may force slower work, but it cannot extend freshness or unhedged limits. A heartbeat/watchdog checks hard deadlines independently of HTTP polling. Reconciliation continues after pause, expiry and stop until exposure is resolved or explicitly recorded as unresolved.

Fixture tests: clean snapshots; missing balance/fee/page; stale/future times; duplicate/out-of-order fills; identical IDs on different venues/accounts; conflicting IDs; terminal partial cancellation; manual order/fill/funding; reset epoch; unknown outcome proven found/absent/unresolved; balance/lock discrepancy; restart with reserved funds; cursor crash; rate-limit outage; different snapshots arriving out of order. Assertions include exact inventory conservation, no retry without proof, no premature reservation release and persistent stopped state.

## 10. Bounded-session approval interface

Keep the existing drawer, theme toggle and design tokens. Add an accessible Stocks/Crypto segmented context switch. Stocks remains default; switching context only changes presentation and never authorizes, pauses or renews a strategy. Use independent crypto query keys, timers, error boundary and state. An active crypto exception remains visible as a context-level indicator while viewing stocks.

Proposed screen contract:

| Screen | Content and controls |
|---|---|
| Session approval | Immutable proposal summary, every limit listed in section 6, exact venue/source labels, fee assumptions, UTC/local operating times, risk response and principal risks. `Approve paper session` and `Decline`; saving a draft is not approval |
| Opportunity monitor | Pair, buy/sell venue, executable depth quantity/VWAP, gross spread, cost breakdown, net USD/bps, book ages and reject reasons; no per-trade approval button |
| Paired executions | Each leg's order reference, requested/filled/remaining, certainty, fee and latency; unmatched base exposure and elapsed time |
| Balances and inventory | Per-venue free/locked/reserved/available, baseline/imbalance and reconciliation time; no combined spendable cash |
| Performance | Realized paired spread after known fees, estimated rebalance reserve, conservative net and separate inventory P&L; missing information stays incomplete |
| Exceptions | UNHEDGED timer, unknown-leg evidence, paper response attempt/result, unresolved amount, persistent stop controls |
| Reconciliation health | Venue-specific completeness, last successful cycle, source age, differences, manual activity, reconnect/reset and refresh action |

Approval page layout: existing header and context switch; `CRYPTO · PAPER SIMULATION` label; scrollable Exchanges & Pairs, Capital & Limits, Costs & Risks, Operating Period sections; visible footer with Decline / Approve paper session. After approval, show server acknowledgement and immutable session ID; if the response is lost, show `Approval outcome unknown — checking session`, never infer failure or create a new session. No sample dollar limits appear as real account data.

Use separate decimal-string fields instead of stock `PolicyField`/Number parsing. API proposal response includes canonical hash/revision, source versions and actionable blockers; approval sends that hash, nonce and idempotency key. Proposed API prefix `/crypto/v1`: health, opportunities, proposals, proposal decisions, sessions, session pause/resume, global emergency-stop, executions, balances, performance, exceptions, reconciliation and events. No public per-order submission endpoint. Each command validates identity, ownership, current revision and server state.

All screens distinguish `Sandbox market data · Simulated account`, `Recorded sandbox replay`, and `Synthetic preview`. Preview uses the same crypto screens with an inert data boundary and cannot call session-control endpoints. Missing data is `Unavailable`, never fixture fallback. Reuse skeleton/error/refresh styling, with accessible status announcements and persistent exception panels. Toasts confirm actions but never carry the only emergency warning. Avoid announcing every price tick.

Pause and Emergency Stop are always reachable in the Crypto context. Emergency Stop has no blocking confirmation dialog. Offline requests display `Stop not confirmed`; reconnect retries use the same idempotency key. A disclosed server control-lease watchdog pauses new pairs after a proposed 30-second loss of authenticated client heartbeat. Backgrounded phones may therefore pause the session; uninterrupted unattended operation is not assumed. Server limits remain authoritative even if the app closes. Test screen-reader labels/focus, large text, dark mode, small mobile layouts, keyboard/web navigation and network loss.

## 11. Threat model

Trust boundaries: mobile/browser → private crypto API → coordinator/ledger → simulator; sandbox internet feeds → parser/collector; host filesystem → secret provider/audit. Protect credentials, immutable authorization, accounting integrity, process availability and user visibility.

| Threat | Controls required in MVP | Evidence/test |
|---|---|---|
| API keys leaked into Expo, Git, logs or responses | Public market reads plus simulated accounts need no exchange keys. No credential fields in UI/DTOs. Any later sandbox read credential is server-only, least privilege, OS secret store, redacted structured logs and no raw auth headers | Fixture secret canaries; scan client build/output/logs; response allowlist tests |
| Production/unauthorized order or SSRF | Fixed sandbox host/path allowlists, TLS validation, reject redirects/user endpoints, network adapters read-only, execution exclusively simulator, no transfer or production capability | Deny non-allowlisted destinations and assert zero network order calls; reject altered account/pair/side/size and unsigned sessions |
| Forged/replayed approval, duplicate workers | Authenticated identity + one-use nonce, immutable proposal hash, revision CAS, durable idempotency, process fencing, stop latch checked in dispatch transaction | Concurrent approval, replay with changed payload, expired approval, crash/restart and stale-worker tests |
| Stale/manipulated/partial feed, clock jumps | Lossless parsing, sequence/snapshot validation, depth/freshness/skew gates, monotonic duration, conservative cost model; disconnect invalidation | Corrupt/out-of-order/replayed feed fixtures and clock rollback tests |
| One-leg fills and lost acknowledgements | Prefunding, reserves for worst case, separate certainty/exposure, immediate UNHEDGED, capped paper response, no uncertain retry | Lost ack, unequal fill, delayed cancel and duration-boundary fixtures |
| Exchange outage or rate exhaustion | Independent health gates, backoff and reserved reconciliation budget; fail closed; retain unknown orders and locked inventory | 429, timeout, reconnect/reset and partial account responses |
| Remote access/token theft | Separate crypto auth, deny missing auth even on loopback, no compiled long-lived app token, short-lived device session, explicit origin allowlist, bounded request bodies, TLS over private access, rate limiting and audit | Unauthorized origin/identity/session tests; offline command acknowledgement tests |
| Compromised market payload/resource exhaustion | Pair/field/decimal bounds, bounded buffers, request timeouts, process isolation, disk quotas; payloads are data, never commands | Oversize frames, parser errors, backlog and disk-full fixtures |
| Corrupt ledger/host or suppressed alert | Full-sync journal, backups/recovery, append-only history, difference stop, durable outbox, persistent UI exception and watchdog | Interrupted writes, checksum mismatch, restore and outbox replay tests |

The existing wildcard CORS, optional localhost token and default signing secret are not crypto security primitives. Provision crypto authentication locally after review; do not alter stock authentication in this workstream. Remote crypto session control remains disabled until authenticated private TLS and device-session handling are implemented and tested. Tailnet reachability alone is not application authorization. Compromise of the host administrator remains a residual risk; paper isolation prevents this module from holding live trading authority.

## 12. Incremental delivery and acceptance

| Stage | Deliverable and gate |
|---|---|
| D0 — current | Review this design and authoritative documentation; no implementation or installs until user review |
| D1 | Contract, decimal selection, deterministic book normalization/opportunity functions and unit tests; no network orders |
| D2 | Separate ledger migrations, durable simulated accounts, reservations/session authorization and paired simulator; crash/idempotency/partial/unknown tests |
| D3 | Reconciliation worker and evidence fixtures; daily/session/kill boundaries tested before auto-execution can run |
| D4 | Two sandbox data adapters, rate-limit settings and protocol smoke tests; unsupported pairs/fees remain unavailable |
| D5 | Stocks/Crypto switch, all crypto screens, private authenticated controls and outbox; accessibility/mobile/web/offline verification |
| D6 | Explicitly approved bounded paper sessions, deterministic replay, fault injection and soak evaluation; documented incomplete areas |

At each stage verify the existing stock Node/Python tests and TypeScript checks appropriate to touched surfaces, using existing dependencies. Do not run broker-submission integration tests or launch a paper strategy without separate session approval. Establish a baseline before code edits and distinguish pre-existing failures. Final isolation acceptance: crypto disabled preserves stock API payloads/navigation/workflow, crypto failure cannot mutate stock state, and no module path can submit a live order.

Current deliverable status: component/data-flow design, threat model, proposed contract, schema/migration plan, calculation specification, simulator/reconciliation test plans and approval interface specification are ready for review. Implemented calculation/tests, simulator/tests, worker/tests and interface are intentionally pending. No connectivity, profitability, latency calibration or operational readiness has been established.

## 13. Assumptions, unresolved work and any future live trial

Proposed assumptions for design approval: Coinbase Exchange + Gemini sandbox feeds; USD spot pairs only; fully simulated account authority; one active session initially; separate crypto process/database; taker USD fee model; capped single unwind; Emergency Stop cancels without new unwind orders; 30-second client control lease. Actual session amounts and times remain unset until a concrete proposal can be built from verified simulated account state.

Before MVP acceptance: verify current sandbox instruments/channel behavior, rate budgets, fee model evidence and terms; choose/test decimal and lossless JSON parsing dependencies; implement secret-free transport, device auth/TLS, bounded retention/backups, simulation calibration and all listed tests; complete mobile/web accessibility checks. Background push delivery and remote sandbox account execution are not implemented. No fixture may silently replace missing market/account information.

Before any future live trial, a separate design and explicit authorization are required: real exchange/account eligibility and terms review; independently assessed key isolation, permissions and order network boundary; authenticated remote controls; independent risk/reconciliation review; evidence for adverse latency, fees, outages and cancellation ambiguity; operational monitoring and incident response; backup/disaster recovery; realistic inventory/rebalance and fee-currency accounting; legal/tax/data-rights review; quantified paper duration/sample/reliability/loss gates; strictly smaller live limits and supervised rollback procedure. These requirements confer no live capability or authorization. Paper opportunities and profits are never guaranteed and are not evidence of equivalent live results.
