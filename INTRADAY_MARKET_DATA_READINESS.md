# Intraday market-data readiness

**Last verified:** 2026-09-24 15:50 ET  
**Scope:** Read-only research and promotion data gate; no subscription or order authority

## Current result

`npm run market:intraday:data-readiness` checks both Alpaca feeds with the configured server-side credentials and returns only sanitized capability results.

| Feed | Live result | Scope | Permitted use |
|---|---|---|---|
| Alpaca IEX | Available | Single venue | Labeled shadow research only |
| Alpaca SIP | Unavailable under current credentials | Consolidated | Required before this provider can pass the promotion data gate |

The audit does not enable recommendations or orders even when SIP is available. Forward calibration, risk-policy review, execution validation and an explicit promotion decision remain separate requirements.

## Evaluated paths

1. **Continue IEX shadow collection now.** This costs no integration change and preserves the current forward sample, but IEX volume and quotes cannot be represented as consolidated market liquidity.
2. **Alpaca SIP entitlement.** This is the smallest engineering change because the existing snapshot, minute-bar, profile and provenance paths already support `feed=sip`. Alpaca documents that recent SIP snapshots require a market-data subscription. Subscription cost, retention and redistribution terms must be reviewed before purchase or external product use.
3. **IBKR consolidated subscriptions.** IBKR can provide exchange-network/NBBO data with the relevant username subscriptions, but the current Paper TWS live-only diagnostic returns warning 2186. Using IBKR for the full research pipeline would add historical-data pacing, session, entitlement and provider-consistency work. It remains useful as the independent pre-trade quote authority once its API entitlement is resolved.

## Decision boundary

Keep Alpaca IEX for research collection. Do not purchase or activate a data plan automatically. Before a paid choice, confirm personal-versus-commercial use, API display/non-display classification, retention/redistribution rights, current price and whether Paper credentials inherit the entitlement. After any authorized entitlement change, rerun the readiness command and rebuild all volume/range profiles on one consistent consolidated feed; do not mix IEX and SIP within a calibrated cohort.

Official references:

- https://docs.alpaca.markets/us/docs/market-data-faq
- https://www.interactivebrokers.com/en/pricing/market-data-pricing.php
- https://www.interactivebrokers.com/campus/ibkr-api-page/webapi-doc/
