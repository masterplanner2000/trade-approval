# Trade Approval — Shadow Research Milestone

Personal prototype for reviewing deterministic stock research observations on a phone. The current default screen is shadow-only: it reads completed IBKR daily bars, evaluates provisional RSI mean-reversion checks, and never creates an order.

Product and technical decisions are tracked in [DECISION_LOG.md](./DECISION_LOG.md).

## Safety boundary

This build contains no live-broker credentials and no live-order route. Shadow observations are isolated from the existing IBKR paper-order endpoints. Their quantity, entry, stop, target, and maximum loss remain undefined, and both decision buttons are disabled.

When the user explicitly requests a paper recommendation, the executable pilot is buy-only. Approval binds the exact entry, quantity, protective stop, and profit target. A successful paper submission uses an IBKR bracket so the attached stop and profit-taking sells can execute automatically after the buy fills. Dynamic and time-based exits are not implemented yet.

The scanner parameters—14-day RSI at or below 30, close above its 200-day average, $5 minimum price, and $20 million minimum 20-day average dollar volume—are **proposed test variables**, not validated trading rules.

## Modular risk model

Each shadow observation includes a versioned observed-market-risk assessment assembled from independent pure modules:

- Price volatility: 0–40 points from ATR percentage and 20-day annualized volatility.
- Overnight gaps: 0–35 points from the recent 95th-percentile and maximum absolute gaps.
- Historical liquidity: 0–25 points from average dollar volume and price.

The thresholds are proposed test variables. This score does not predict success and deliberately excludes current spread, events, position size, stop, portfolio concentration, and account limits. The UI therefore presents complete trade risk as `INCOMPLETE`.

Run the deterministic risk tests with `npm run test:risk`.

## Run

1. Install dependencies with `npm install`.
2. Open TWS in the IBKR paper account with the API enabled on port 7497.
3. Start the local service with `npm run service:phone` (or `npm run service` for localhost-only use).
4. In a second terminal, start with `npm start`.
5. Open the project with Expo Go, or press `w` for the browser preview.

If TWS or historical daily data is unavailable, the scanner fails closed and the app displays no fabricated recommendation.

## Current acceptance criteria

- Completed daily bars come from the read-only IBKR historical-data request.
- Every displayed observation contains deterministic pass/fail checks.
- The selected observation is written idempotently to `service/data/shadow-signals.json`.
- The interface clearly identifies shadow mode.
- Order controls remain disabled.
- Missing data never falls back to mock market signals.
