# Crypto MVP path assessment

2026-09-10 · Recommendation for review; no implementation or expanded data access approved.

## Recommendation

Build the first usable version around two simulated exchange accounts, Coinbase/Gemini market adapters, and bounded paper sessions. Exclude wallets, signatures, token approvals, transfers and on-chain execution. Assess 0x later as a separate observation experiment before considering a wallet product.

The MVP should answer two different questions: does the software handle failures correctly, and do sufficiently large price differences survive realistic costs? Sandbox/fixture testing answers the first. It cannot establish real-market profitability. For the second, propose public read-only production order books with simulated execution, or licensed historical production depth replay. This expands the original sandbox/recorded scope and remains pending review; no production credentials or orders are needed. Preserve separate provenance for each data mode and never merge their performance totals.

Coinbase Advanced's sandbox has static mocked accounts/orders. Coinbase Exchange has a separate dynamic sandbox with fake funds and a subset of books. Gemini's sandbox uses bots to simulate activity. Use these to test adapters and failure handling, not as evidence of a market edge. Advanced and Exchange are distinct integrations, not interchangeable base URLs. [Coinbase Advanced sandbox](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/sandbox), [Coinbase Exchange sandbox](https://docs.cdp.coinbase.com/exchange/introduction/sandbox), [Gemini sandbox](https://developer.gemini.com/get-started/sandbox).

## Options

| Option | What it proves | UX/security cost | Recommendation |
|---|---|---|---|
| Coinbase alone | Data ingestion and simulated trading | Lowest complexity | Useful development slice; cannot meet cross-exchange arbitrage goal alone |
| Coinbase + Gemini, local simulated accounts | Paired execution, inventories, reconciliation and costs | No wallet setup; manageable two-venue state | MVP core |
| Add 0x observation | Whether selected on-chain quotes add a plausible net edge | Chain/token identity, gas, quote validity, data rights and different settlement model | Separate follow-up experiment |
| Add external-wallet signing | Actual self-custody swaps | App switching, signatures, allowances, funding, recovery and pending transactions | Defer |
| Add embedded/server wallet automation | Unattended on-chain execution | Key custody/delegation, enforceable transaction policy and recovery | Defer; independent security design required |

This does not assert Coinbase/Gemini will be profitable. Taker fees, inventory restoration and latency may eliminate every gap. Zero qualified opportunities is a valid result. 0x aggregation seeks good swap routes; it does not itself arbitrage away all discrepancies or establish a profitable round trip. It may expose better prices, which must be measured. [0x routing and fees](https://docs.0x.org/docs/introduction/faq).

## Wallet UX and security

The relevant distinction is an exchange account versus self-custody, not the Coinbase brand. An exchange API avoids blockchain signing in the app; a self-custody wallet introduces signing even if supplied by the same company.

With an external wallet, the user may need to fund the correct chain, hold gas, approve token spending, review a swap, switch apps, and return to a pending/failed transaction. Manual review adds delay and makes frequent arbitrage impractical. Removing prompts requires delegated execution authority; approving a strategy in our database alone does not constrain what a wallet signer can do.

| Risk | Required future design, not MVP functionality |
|---|---|
| Malicious approval or misleading signature | Decode and explain recipient, spender, token, amount, chain and expiry; independently validate against policy; avoid blind signing and broad allowances |
| Compromised quote/API response | Independently validate chain-specific contract destinations, calldata effects, recipients, native value and minimum output; fail closed on unrecognized upgrades |
| Stolen delegated key or compromised server | Dedicated limited-capital wallet; isolated signing; enforceable token/contract/amount/time permissions; revocation and recovery; never collect seed phrases in the app |
| Replay or stale quote | Chain/domain-bound signatures, nonces, deadlines, transaction identities and reconciliation before resubmission |
| Pending/replaced/reverted transaction | Track broadcast separately from inclusion/finality, gas expenditure, nonce replacement and reorganization; never report a timeout as absence |
| Exchange leg fills but chain leg fails | Maintain prefunded inventories; expose unhedged exposure; independently approved risk response. A single atomic swap does not make a swap plus a centralized-exchange order atomic |
| Emergency Stop misunderstood | Stop can prevent new submissions; cannot promise to revoke an already broadcast transaction or recover lost funds |
| Lost device/account recovery | Explain custody and recovery owner; revocation must cover delegated authority and token allowances, not just wallet disconnection |

0x explicitly separates allowance targets from transaction destinations and warns against approving its Settler contract. These are financial permissions, not ordinary login prompts. [0x contract guidance](https://docs.0x.org/docs/core-concepts/contracts). Some RFQ routes have MEV protection; that does not establish protection for all AMM routes. Gasless execution also does not imply cost-free execution. [0x FAQ](https://docs.0x.org/docs/introduction/faq).

Exchange APIs retain security risks: a trade-capable key can lose funds through trading even without withdrawal permission. Any future live exchange integration needs server-only keys, the narrowest permissions, IP restrictions where supported, independent risk checks and revocation. This MVP needs no production account keys. [Coinbase key security](https://docs.cdp.coinbase.com/coinbase-app/authentication-authorization/api-key-authentication).

## MVP user journey

1. Choose Crypto in the existing app. Show persistent `Paper simulation` and the actual market-data source. No Connect Wallet or deposit step.
2. Review a proposed session: venues/pairs, simulated funds at each venue, all hard limits, fee assumptions, start/end, and response to one-leg fills. Approve once; do not ask on every pair.
3. Land on one dashboard with session status, conservative estimated opportunities, simulated realized results, remaining limits and both venue health states. Expand details for fills, balances, reconciliation and fee breakdowns rather than creating seven competing top-level destinations.
4. Show `No opportunities after costs`, `Data unavailable`, `Inventory limit reached` and `Session paused` as different states. Never fill an empty screen with synthetic opportunities unless explicitly in Preview.
5. Keep Pause and Emergency Stop reachable. Display server acknowledgement, persistent unresolved exposure and `Stop not confirmed` when offline. Toasts cannot be the sole safety signal.

Use existing design tokens and UI components; keep crypto numeric parsing, auth, risk and ledger independent. For remote access use authenticated private TLS, explicit origin checks and short-lived device authorization. Private network membership alone is insufficient. Never embed service secrets in Expo or browser builds. Test app switching, backgrounding, large text, screen readers, browser keyboard navigation and lost connectivity.

The current draft's 30-second client lease is suitable only for a disclosed supervised pilot: backgrounding the phone may pause new pairs. Market collection can continue while the service is healthy. Recommend supporting unattended paper execution only after server-side supervision, durable notification delivery, recovery and authenticated remote controls are tested. Then session execution can depend on server health and approved expiry rather than phone heartbeats. This lifecycle revision is proposed, not silently applied to D-032. A sleeping Mac cannot provide continuous operation; show last server contact honestly.

## Incremental validation

1. After design review, implement deterministic costs, simulator, ledger and reconciliation against fixtures; prove partial fills, unknown submissions, restarts and stops.
2. Connect both sandboxes and complete the supervised mobile/web session flow. Discover common spot products rather than assuming listings.
3. After data-source scope review, evaluate public production books or licensed historical depth with local fills. Disclose assumed fee tiers, latency and rebalancing costs; report profit relative to all prefunded capital, not just the buy leg.
4. Predefine evaluation duration/sample coverage and rejection criteria before results are known. Measure fresh feed coverage, gaps after all costs, partial/one-leg rates, reconciliation differences, inventory depletion and adverse-cost sensitivity. Paper success cannot prove queue priority, live fills or profitability.
5. If broader coverage remains worth testing, propose a small 0x observation study on one chain and a few precisely identified tokens. No signer or wallet connection. Record quote age, size, costs and validity evidence; an unfunded hypothetical address does not establish executability. Check API plan, rate limits, retention rights and New York/token eligibility before activation. 0x API credentials are data-service credentials, distinct from wallet private keys, and remain server-side. [0x API license](https://0x.org/legal/api-license-agreement).

Do not treat same ticker symbols, wrapped/native assets, different chains or USD/stablecoins as identical. 0x observations require their own contract and cost model, not fabricated order-book depth in the exchange adapter. Unavailable taker validation, balance, gas or token information stays explicitly unverified. Observation results remain separate from reconciled simulated exchange results.

No live trial is part of this recommendation. The existing CRYPTO_DESIGN.md acceptance requirements remain applicable. Wallet support would require a separately reviewed threat model and UX prototype, not a toggle on the paper engine.
