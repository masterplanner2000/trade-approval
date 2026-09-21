# Volatile-stock coverage audit

Generated: 2026-09-20T22:21:24.301264-04:00
Source symbols: 250
Completed daily data through: 2026-09-18

## Coverage

- Qualified Research: 2
- Technical Reject: 26
- Insufficient History: 0
- Core Only Observed: 0
- Not Observed: 222

## Most common aggressive-lane rejections

- Five Day Momentum: 16
- Relative Volume: 15
- Twenty Day Momentum: 11
- Venue Liquidity: 2
- Volatility: 1

## Qualified research observations

| Symbol | Company | Listed IV | Failed checks |
|---|---|---:|---|
| CLDX | Celldex | 210.22% | None |
| GRAL | GRAIL, Inc | 120.48% | None |

## Limitations

- The source CSV has no as-of timestamp or catalyst field.
- Listed implied volatility is directionless and is not a buy signal.
- Alpaca IEX volume is single-venue rather than consolidated volume.
- Qualified research still lacks a verified catalyst, current spread, portfolio sizing and broker validation.

The JSON companion contains one classification and the failed scanner checks for every source symbol.
