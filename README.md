# Trade Approval — Shadow Research Milestone

Personal prototype for reviewing deterministic stock research observations on a phone. The current default screen is shadow-only: it reads completed IBKR daily bars, evaluates provisional RSI mean-reversion checks, and never creates an order.

Project documentation:

- [Application architecture](./ARCHITECTURE.md)
- [Product and technical decision log](./DECISION_LOG.md)

## Safety boundary

This build contains no live-broker credentials and no live-order route. Shadow observations are isolated from the existing IBKR paper-order endpoints. Their quantity, entry, stop, target, and maximum loss remain undefined, and both decision buttons are disabled.

When the user explicitly requests a paper recommendation, the executable pilot is buy-only. Approval binds the exact entry, quantity, protective stop, and profit target. A successful paper submission uses an IBKR bracket so the attached stop and profit-taking sells can execute automatically after the buy fills. Dynamic and time-based exits are not implemented yet.

The scanner uses Alpaca's active U.S.-equity asset master and completed adjusted SIP daily bars to maintain a local SQLite cache of the 500 highest-dollar-volume eligible common-stock candidates. Its parameters—240 completed daily bars, $50 million minimum 20-day average dollar volume, close above its 50- and 200-day averages, 2–20% 20-day momentum, RSI from 50–72, ATR from 1–6%, and a maximum 0.25% final IBKR bid/ask spread—are **proposed test variables**, not validated trading rules. Share price is not used as a quality proxy. Verified market capitalization and sector classification remain future data requirements.

## Modular risk model

Each shadow observation includes a versioned observed-market-risk assessment assembled from independent pure modules:

- Price volatility: 0–40 points from ATR percentage and 20-day annualized volatility.
- Overnight gaps: 0–35 points from the recent 95th-percentile and maximum absolute gaps.
- Historical liquidity: 0–25 points from average dollar volume and price.

The thresholds are proposed test variables. This score does not predict success and deliberately excludes current spread, events, position size, stop, portfolio concentration, and account limits. The UI therefore presents complete trade risk as `INCOMPLETE`.

Run the deterministic risk tests with `npm run test:risk`.

## Run

1. Install dependencies with `npm install`.
2. Add Alpaca data credentials to `.env.local`, then run `npm run market:refresh` after the market close.
3. Open TWS in the IBKR paper account with the API enabled on port 7497.
4. Start the local service with `npm run service:phone` (or `npm run service` for localhost-only use).
5. In a second terminal, start with `npm start`.
6. Open the project with Expo Go, or press `w` for the browser preview.

If TWS or historical daily data is unavailable, the scanner fails closed and the app displays no fabricated recommendation.

## Current acceptance criteria

- Completed daily bars come from the read-only IBKR historical-data request.
- Every displayed observation contains deterministic pass/fail checks.
- The selected observation is written idempotently to `service/data/shadow-signals.json`.
- The interface clearly identifies shadow mode.
- Order controls remain disabled.
- Missing data never falls back to mock market signals.
