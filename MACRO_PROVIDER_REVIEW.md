# Macro Research Provider Review

Status date: 2026-09-20  
Scope: read-only personal prototype research; no recommendation or order authority

This is a technical access review, not a legal opinion. Distribution, display,
retention and redistribution terms require a separate review before an external
product uses any provider data.

| Need | Candidate | Current decision | Provenance and limitation |
|---|---|---|---|
| Intraday stock snapshot | Alpaca Market Data | Approved for bounded prototype adapter using existing credentials | The configured Basic feed is IEX and is labeled `single_venue`; it is not treated as consolidated U.S. market volume. SIP is supported by code only when the account is entitled and configured, and is labeled `consolidated`. Delayed SIP is rejected for forward capture. |
| Official CPI and Employment releases | U.S. Bureau of Labor Statistics | Approved primary source | Existing fixed-host RSS adapters are bounded and identify publications. The documented calendar endpoint returned HTTP 403 in the prior smoke check, so it is not an operational scheduler. |
| Official Federal Reserve decisions | Federal Reserve Board | Approved primary source | Existing fixed-host monetary-policy RSS adapter identifies publications. It does not supply market consensus. |
| Consensus and release history | Trading Economics | Provisional adapter only; disabled for real capture | The documented calendar schema fits the evidence contract, but no key is configured and access, storage, display and redistribution rights have not been approved. No subscription or terms were accepted. |
| Expected intraday volume, ATR and halt status | Not selected | Required dependency; fail closed | An Alpaca snapshot alone does not establish a time-of-day volume expectation, 14-day ATR and verified current halt state. The provider adapter requires a named, fresh context reader and refuses to invent these fields. |

## Documented provider semantics

- Alpaca's stock snapshot combines the latest trade, latest quote, minute bar,
  daily bar and previous daily bar. Provider timestamps, rather than task due
  times, become observation times.
- Alpaca documents Basic stock coverage as IEX and paid consolidated coverage
  as SIP. Rate limits and entitlements are plan-dependent; HTTP 429 is terminal
  for an individual scheduled capture and is recorded only as a sanitized error.
- Trading Economics documents `Forecast` as consensus and distinguishes it from
  its own `TEForecast`, but its commercial access, retention, display and
  redistribution terms are unresolved for this project.
- Official release records retain publisher URL, publication time, retrieval
  time and stable identity. A corrected item keeps its identity and receives a
  different content fingerprint.

Official references reviewed:

- https://docs.alpaca.markets/us/reference/stocksnapshotsingle
- https://docs.alpaca.markets/us/docs/market-data-faq
- https://docs.alpaca.markets/us/v1.4.2/docs/historical-stock-data-1
- https://docs.tradingeconomics.com/economic_calendar/schema/
- https://docs.tradingeconomics.com/economic_calendar/snapshot/

## Security and reliability controls

- Fixed HTTPS hosts and server-only header credentials.
- Redirects rejected before the default client follows them.
- Ten-second timeout and one-megabyte snapshot response limit.
- Explicit sanitized errors for rate limiting, transport failure, non-200 status,
  malformed JSON, oversized payloads and invalid/crossed quotes.
- Exact ticker propagation and explicit IEX/SIP volume scope.
- No upstream error body, secret, account identifier or raw payload is persisted by
  the capture worker.

## Decision needed before a forward pilot

Select and approve a historical/time-of-day volume, ATR and halt-status source.
Select a consensus provider only after access and data-use terms are reviewed.
Until then, the adapters are testable and deterministic but the live capture path
remains deliberately unconfigured.

## Live smoke evidence

On 2026-09-20, a read-only SPY snapshot request succeeded through the existing
account and returned feed `iex`, volume scope `single_venue`, and provider
observation time `2026-09-18T20:08:57.839910Z`. Because the check occurred on a
Sunday, that timestamp is expected to be historical and would fail a new task's
forward observation window rather than being represented as current market data.
