# Paper proposal service

This local service is the boundary between the phone interface and a future user-owned trading agent.

## Durable trading ledger

`trading_ledger.mjs` defines the first version of the local SQLite lifecycle ledger. It stores immutable proposal terms, one decision per proposal, restart-safe submission idempotency keys, broker-order identities, and append-only lifecycle events. Run `npm run test:ledger` to verify persistence and duplicate protection.

The storage module is implemented, but `server.mjs` still uses its existing in-memory maps and sets. Connecting the service routes to the ledger is the next milestone; until that integration is complete, restarting the running service can still lose active runtime state.

## Alpaca research cache and scanner

Alpaca supplies the active U.S.-equity asset master and adjusted completed SIP daily bars. `npm run market:refresh` removes non-tradable, OTC and obvious non-common-stock instruments, ranks the survivors by the latest completed session's dollar volume, stores the top 500 and roughly 430 calendar days of history in `data/market-cache.sqlite3`, and never stores credentials. `npm run market:status` reports cache coverage; `npm run market:scan` evaluates the cached universe without contacting IBKR.

Set `APCA_API_KEY_ID` and `APCA_API_SECRET_KEY` in the ignored `.env.local` file. The cache fails closed when credentials or data are unavailable. The free Alpaca plan may provide historical SIP bars when the request ends outside the restricted recent-data window; current feed access remains account-dependent.

`POST /shadow/scan` evaluates the local cache and stores the selected observation and its checks in `data/shadow-signals.json`. Repeating the same ruleset, symbol, and signal date is idempotent. IBKR remains the authority for the final bid/ask, paper account, What-If validation and execution.

`GET /shadow/signals` returns the durable shadow ledger. Shadow records always include `orderSubmissionAllowed: false`; they are not accepted by the approval or paper-order routes.

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
- `POST /orders/submit-paper` submits only after preview, What-If, a fresh quote/account check, and an unused approval. It accepts only an allowed strategy symbol in the IBKR paper account, a BUY of 1–5 whole shares, and at most $1,500 notional. The adapter submits a coordinated bracket: DAY limit buy, attached GTC profit-taking limit sell, and attached GTC protective stop sell. No standalone or short sell recommendation is accepted.
- `POST /pause` with `{ "paused": true }`

The adapter accepts only verified receipts whose `environment` is `paper`, refreshes account and quote data, and rejects altered, expired, duplicate, over-limit, or invalid-bracket orders.

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
