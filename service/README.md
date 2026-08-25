# Paper proposal service

This local service is the boundary between the phone interface and a future user-owned trading agent.

## Shadow scanner (current app default)

`POST /shadow/scan` reads completed daily bars from the logged-in IBKR paper TWS session and evaluates a frozen research ruleset. It stores the selected observation and all passing/failing checks in `data/shadow-signals.json`. Repeating the same ruleset, symbol, and signal date is idempotent.

`GET /shadow/signals` returns the durable shadow ledger. Shadow records always include `orderSubmissionAllowed: false`; they are not accepted by the approval or paper-order routes.

It deliberately cannot submit live orders. Approved proposals receive an HMAC-signed, single-use receipt that binds the approval to an exact paper account, symbol, direction, quantity, order type, maximum price, stop, and short expiration.

## Run locally

```sh
APPROVAL_SIGNING_SECRET="replace-for-local-testing" node service/server.mjs
```

Endpoints:

- `GET /health`
- `GET /proposals`
- `GET /audit`
- `GET /shadow/signals`
- `POST /shadow/scan`
- `POST /proposals/demo`
- `POST /proposals/:id/decision` with `{ "decision": "approved" }` or `denied`
- `POST /orders/preview` with a signed approval token; validates and previews but cannot submit
- `POST /orders/what-if` runs IBKR's broker-side pre-trade check only when explicitly enabled; it forces `whatIf=true`. IBKR requires `transmit=true` for What-If validation, but does not execute What-If orders.
- `POST /orders/submit-paper` submits only after preview, What-If, a fresh quote/account check, and an unused approval. It accepts only the IBKR paper account, NVDA, 1–5 whole shares, a DAY limit order, and at most $1,500 notional.
- `POST /pause` with `{ "paused": true }`

The future IBKR adapter should accept only verified receipts whose `environment` is `paper`, refresh account and quote data, and reject altered, expired, duplicate, or over-limit orders.

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
