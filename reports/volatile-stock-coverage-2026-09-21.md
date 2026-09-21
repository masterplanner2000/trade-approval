# Volatile-stock coverage audit

Generated: 2026-09-21T10:28:00.761541-04:00
Source symbols: 250
Completed daily data through: 2026-09-18

## Coverage

- Qualified Research: 3
- Technical Reject: 245
- Insufficient History: 0
- Completed History Unavailable: 0
- Unsupported Or Non Common Instrument: 0
- Not In Active Asset Master: 2
- Core Only Observed: 0
- Not Observed: 0

## Most common aggressive-lane rejections

- Venue Liquidity: 200
- Relative Volume: 171
- Five Day Momentum: 167
- Price: 154
- Twenty Day Momentum: 99
- Volatility: 32

## Qualified research observations

| Symbol | Company | Listed IV | Failed checks |
|---|---|---:|---|
| CLDX | Celldex | 210.22% | None |
| TRAX | First Tracks Biotherapeutics | 132.80% | None |
| GRAL | GRAIL, Inc | 120.48% | None |

## Limitations

- The source CSV has no as-of timestamp or catalyst field.
- Listed implied volatility is directionless and is not a buy signal.
- Alpaca IEX volume is single-venue rather than consolidated volume.
- Qualified research still lacks a verified catalyst, current spread, portfolio sizing and broker validation.

The JSON companion contains one classification and the failed scanner checks for every source symbol.
