# Initial Macro Research Universe

Version: `macro-universe-2026-09-20-v1`

Status: reviewed, blocked from scheduling

Scope: forward research only; no recommendation, sizing or order authority

The machine-readable source of truth is
`service/data/macro-research-universe-2026-09-20-v1.json`. Its validator returns
zero active studies until an approved consensus provider supplies exact series
identities and the crosswalk is reviewed again.

## Frozen studies

| Release | Next official time | Exact official measure | Symbol/theme | Hypothesis | State |
|---|---:|---|---|---|---|
| Employment Situation | 2026-10-02 08:30 ET | BLS `CES0000000001`, monthly change in seasonally adjusted total nonfarm payrolls | JPM / employment resilience | Positive payroll surprise is a low-strength positive exposure because JPMorgan's credit-loss framework uses unemployment and macro scenarios. Rate expectations and funding costs can reverse the response. | Blocked: no approved exact consensus series |
| Consumer Price Index | 2026-10-14 08:30 ET | BLS `CUUR0000SA0`, CPI-U all items, not seasonally adjusted, 12-month change | HD / inflation pressure | Upside inflation surprise is a negative exposure because Home Depot reports macro uncertainty and a persistent high-rate environment pressuring broader demand. CPI is not a direct revenue measure. | Blocked: no approved exact consensus series |

The BLS calendar currently lists those release dates and times. The research
universe intentionally omits the October FOMC meeting: the meeting date is
official, but the reviewed calendar does not provide the exact machine-readable
statement timestamp needed by this contract.

## Evidence and review

- Official release definitions and schedules: U.S. Bureau of Labor Statistics.
- Company relationships: JPMorgan Chase 2025 Form 10-K filed 2026-02-13 and
  Home Depot fiscal-2025 Form 10-K filed 2026-03-18.
- Liquidity check: 20 completed sessions in the local Alpaca IEX cache. IEX is
  explicitly single-venue. JPM averaged about $73.4 million and HD about $39.1
  million in observed daily dollar volume; this check supports research capture
  only and does not replace the recommendation scanner's separate threshold.
- The source-verification pass occurred after the initial curation pass and
  confirmed the official identities, filing relationships, timestamps and
  limitations. It also retained the consensus-provider blocker.

## Activation requirements

1. Approve a consensus provider and its data-use terms.
2. Retrieve the provider's exact stable series identity for each official
   measure; similar titles are insufficient.
3. Review and version a crosswalk from each official series to that exact
   consensus series.
4. Re-run universe validation and confirm every scheduled symbol resolves to
   the frozen exposure-map version.
5. Only then register the forward event before its baseline capture window.
