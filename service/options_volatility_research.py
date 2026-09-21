"""Provider-neutral, research-only options-volatility evaluation.

The first ruleset measures whether a snapshot contains the inputs needed for a
future shadow study. It never ranks an equity, proposes an option, sizes a
position, or calls a broker.
"""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import date, datetime, timezone
from statistics import median
from typing import Any


RULESET_VERSION = "options-volatility-input-v1"
MINIMUM_IV_HISTORY = 60
MAXIMUM_SNAPSHOT_AGE_SECONDS = 900


def _number(value: object) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _timestamp(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else None
    except ValueError:
        return None


def _average(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def evaluate_options_volatility(snapshot: dict[str, Any], *, evaluated_at: datetime | None = None) -> dict[str, object]:
    evaluated_at = (evaluated_at or datetime.now(timezone.utc)).astimezone(timezone.utc)
    symbol = str(snapshot.get("symbol") or "").strip().upper()
    observed_at = _timestamp(snapshot.get("observedAt"))
    underlying = _number(snapshot.get("underlyingPrice"))
    realized = _number(snapshot.get("realizedVolatilityPercent20"))
    feed = str(snapshot.get("feed") or "").strip().lower()
    source = str(snapshot.get("source") or "").strip()
    contracts = snapshot.get("contracts") if isinstance(snapshot.get("contracts"), list) else []
    history = [_number(value) for value in snapshot.get("underlyingIvHistoryPercent", [])]
    history = [value for value in history if value is not None and value > 0]
    missing: list[str] = []
    if not symbol:
        missing.append("symbol")
    if not source:
        missing.append("source")
    if observed_at is None:
        missing.append("observed_at")
    elif observed_at > evaluated_at or (evaluated_at - observed_at).total_seconds() > MAXIMUM_SNAPSHOT_AGE_SECONDS:
        missing.append("fresh_snapshot")
    if underlying is None or underlying <= 0:
        missing.append("underlying_price")
    if realized is None or realized <= 0:
        missing.append("realized_volatility_20d")
    if feed != "opra":
        missing.append("consolidated_opra_feed")

    normalized = []
    expiration_ivs: dict[str, list[float]] = defaultdict(list)
    spreads = []
    total_volume = 0.0
    total_open_interest = 0.0
    for raw in contracts:
        if not isinstance(raw, dict):
            continue
        strike = _number(raw.get("strike"))
        bid = _number(raw.get("bid"))
        ask = _number(raw.get("ask"))
        iv = _number(raw.get("impliedVolatilityPercent"))
        volume = _number(raw.get("volume"))
        open_interest = _number(raw.get("openInterest"))
        expiration = str(raw.get("expiration") or "")
        option_type = str(raw.get("type") or "").lower()
        delta = _number(raw.get("delta"))
        try:
            expiry_day = date.fromisoformat(expiration)
        except ValueError:
            continue
        if strike is None or strike <= 0 or option_type not in {"call", "put"}:
            continue
        midpoint = (bid + ask) / 2 if bid is not None and ask is not None and 0 <= bid <= ask and ask > 0 else None
        spread_percent = ((ask - bid) / midpoint * 100) if midpoint and midpoint > 0 else None
        if spread_percent is not None:
            spreads.append(spread_percent)
        if volume is not None and volume >= 0:
            total_volume += volume
        if open_interest is not None and open_interest >= 0:
            total_open_interest += open_interest
        if underlying and iv is not None and iv > 0 and abs(strike / underlying - 1) <= 0.05:
            expiration_ivs[expiration].append(iv)
        normalized.append({"expiration": expiration, "expirationDay": expiry_day, "type": option_type,
                           "strike": strike, "iv": iv, "delta": delta})

    surface = sorted((expiration, _average(values)) for expiration, values in expiration_ivs.items() if values)
    if len(surface) < 2:
        missing.append("two_expiration_atm_iv_surface")
    current_iv = surface[0][1] if surface else None
    if len(history) < MINIMUM_IV_HISTORY:
        missing.append("sixty_observation_iv_history")
    iv_percentile = None
    if current_iv is not None and len(history) >= MINIMUM_IV_HISTORY:
        iv_percentile = sum(value <= current_iv for value in history) / len(history) * 100

    nearest_expiration = surface[0][0] if surface else None
    nearest = [contract for contract in normalized if contract["expiration"] == nearest_expiration]
    call25 = min((item for item in nearest if item["type"] == "call" and item["iv"] and item["delta"] is not None),
                 key=lambda item: abs(abs(item["delta"]) - 0.25), default=None)
    put25 = min((item for item in nearest if item["type"] == "put" and item["iv"] and item["delta"] is not None),
                key=lambda item: abs(abs(item["delta"]) - 0.25), default=None)
    skew25 = put25["iv"] - call25["iv"] if put25 and call25 else None
    if skew25 is None:
        missing.append("twenty_five_delta_skew")
    if not spreads:
        missing.append("option_bid_ask_spreads")
    if total_open_interest <= 0:
        missing.append("option_open_interest")
    if total_volume <= 0:
        missing.append("option_volume")

    event_days = snapshot.get("daysToKnownEvent")
    if event_days is None:
        missing.append("known_event_distance")
    missing = list(dict.fromkeys(missing))
    status = "COMPLETE" if not missing else "INCOMPLETE"
    return {
        "symbol": symbol or None, "rulesetVersion": RULESET_VERSION,
        "status": status, "classification": "research_only",
        "rankingAdjustmentAllowed": False, "proposalAllowed": False, "orderSubmissionAllowed": False,
        "observedAt": observed_at.isoformat().replace("+00:00", "Z") if observed_at else None,
        "source": source or None, "feed": feed or None, "contractCount": len(normalized),
        "metrics": {
            "atmImpliedVolatilityPercent": round(current_iv, 4) if current_iv is not None else None,
            "ivPercentile": round(iv_percentile, 2) if iv_percentile is not None else None,
            "ivMinusRealizedVolatilityPoints": round(current_iv - realized, 4) if current_iv is not None and realized is not None else None,
            "nearFarTermStructurePoints": round(surface[-1][1] - surface[0][1], 4) if len(surface) >= 2 else None,
            "putCall25DeltaSkewPoints": round(skew25, 4) if skew25 is not None else None,
            "medianQuotedSpreadPercent": round(median(spreads), 4) if spreads else None,
            "totalObservedVolume": round(total_volume, 2),
            "totalOpenInterest": round(total_open_interest, 2),
            "daysToKnownEvent": event_days,
        },
        "missing": missing,
        "limitations": [
            "This validates research inputs; it does not predict direction or returns.",
            "A snapshot cannot establish an IV percentile without a point-in-time historical IV series.",
            "Indicative options quotes cannot satisfy the consolidated OPRA requirement.",
        ],
    }

