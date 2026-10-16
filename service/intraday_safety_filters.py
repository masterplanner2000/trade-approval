"""Fail-closed safety and quality verdict for intraday shadow candidates."""

from __future__ import annotations

from datetime import datetime, timezone
from math import isfinite
from typing import Mapping


POLICY_VERSION = "intraday-safety-quality-v1"
MAX_EVIDENCE_AGE_SECONDS = 120
MAX_PORTFOLIO_AGE_SECONDS = 60
MAX_SPREAD_PERCENT = 0.75
MIN_SESSION_DOLLAR_VOLUME = 5_000_000
MIN_PROFILE_SESSIONS = 20
MAX_VWAP_EXTENSION_PERCENT = 4.0
MAX_RANGE_EXPANSION_RATIO = 3.0
MAX_PULLBACK_FROM_HIGH_PERCENT = 3.0


def _instant(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else None


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    result = float(value)
    return result if isfinite(result) else None


def evaluate_intraday_safety(
    gate: Mapping[str, object], price: Mapping[str, object], score: Mapping[str, object],
    halt: Mapping[str, object], portfolio: Mapping[str, object], *, now: str,
) -> dict[str, object]:
    current = _instant(now)
    symbol = gate.get("symbol")
    checks: list[dict[str, object]] = []

    def check(identifier: str, passed: bool, actual: object, category: str = "market") -> None:
        checks.append({"id": identifier, "passed": bool(passed), "actual": actual, "category": category})

    identities = [gate.get("symbol"), price.get("symbol"), score.get("symbol"), halt.get("symbol")]
    check("evidence_identity", isinstance(symbol, str) and symbol and all(item == symbol for item in identities), identities)
    check("upstream_market_gates", gate.get("status") == "COMPLETE" and gate.get("eligible") is True,
          gate.get("failedChecks"))
    check("opportunity_score_complete", score.get("status") == "COMPLETE", score.get("failedEvidence"))

    halt_at = _instant(halt.get("observedAt"))
    halt_age = (current - halt_at).total_seconds() if current is not None and halt_at is not None else None
    check("halt_evidence_fresh", halt_age is not None and 0 <= halt_age <= MAX_EVIDENCE_AGE_SECONDS,
          round(halt_age, 3) if halt_age is not None else None)
    check("not_halted", halt.get("halted") is False, halt.get("activeHalts"))
    check("halt_source_named", isinstance(halt.get("dataSource"), str) and bool(str(halt.get("dataSource")).strip()),
          halt.get("dataSource"))

    gate_metrics = gate.get("metrics") if isinstance(gate.get("metrics"), Mapping) else {}
    price_metrics = price.get("metrics") if isinstance(price.get("metrics"), Mapping) else {}
    spread = _number(gate_metrics.get("spreadPercent"))
    liquidity = _number(gate_metrics.get("sessionDollarVolume"))
    sessions = gate.get("profileSessionCount")
    vwap = _number(price_metrics.get("priceVsVwapPercent"))
    expansion = _number(price_metrics.get("rangeExpansionRatio"))
    pullback = _number(price_metrics.get("pullbackFromSessionHighPercent"))
    check("spread_acceptable", spread is not None and 0 <= spread <= MAX_SPREAD_PERCENT, spread)
    check("liquidity_acceptable", liquidity is not None and liquidity >= MIN_SESSION_DOLLAR_VOLUME, liquidity)
    check("profile_complete", isinstance(sessions, int) and sessions >= MIN_PROFILE_SESSIONS, sessions)
    check("vwap_not_overextended", vwap is not None and vwap <= MAX_VWAP_EXTENSION_PERCENT, vwap)
    check("range_not_extreme", expansion is not None and 0 <= expansion <= MAX_RANGE_EXPANSION_RATIO, expansion)
    check("pullback_not_broken", pullback is not None and 0 <= pullback <= MAX_PULLBACK_FROM_HIGH_PERCENT, pullback)

    portfolio_at = _instant(portfolio.get("observedAt"))
    portfolio_age = ((current - portfolio_at).total_seconds()
                     if current is not None and portfolio_at is not None else None)
    check("portfolio_fresh", portfolio_age is not None and 0 <= portfolio_age <= MAX_PORTFOLIO_AGE_SECONDS,
          round(portfolio_age, 3) if portfolio_age is not None else None, "portfolio")
    required_numbers = {key: _number(portfolio.get(key)) for key in (
        "openPositionCount", "maxOpenPositions", "symbolExposurePercent", "maxSymbolExposurePercent",
        "sectorExposurePercent", "maxSectorExposurePercent", "dailyLossPercent", "maxDailyLossPercent",
        "availableBuyingPower", "proposedNotional",
    )}
    check("position_capacity", required_numbers["openPositionCount"] is not None
          and required_numbers["maxOpenPositions"] is not None
          and (portfolio.get("addingToExistingPosition") is True
               or required_numbers["openPositionCount"] < required_numbers["maxOpenPositions"]),
          {key: required_numbers[key] for key in ("openPositionCount", "maxOpenPositions")}, "portfolio")
    check("symbol_exposure", required_numbers["symbolExposurePercent"] is not None
          and required_numbers["maxSymbolExposurePercent"] is not None
          and required_numbers["symbolExposurePercent"] <= required_numbers["maxSymbolExposurePercent"],
          {key: required_numbers[key] for key in ("symbolExposurePercent", "maxSymbolExposurePercent")}, "portfolio")
    check("sector_exposure", required_numbers["sectorExposurePercent"] is not None
          and required_numbers["maxSectorExposurePercent"] is not None
          and required_numbers["sectorExposurePercent"] <= required_numbers["maxSectorExposurePercent"],
          {key: required_numbers[key] for key in ("sectorExposurePercent", "maxSectorExposurePercent")}, "portfolio")
    check("daily_loss_limit", required_numbers["dailyLossPercent"] is not None
          and required_numbers["maxDailyLossPercent"] is not None
          and required_numbers["dailyLossPercent"] < required_numbers["maxDailyLossPercent"],
          {key: required_numbers[key] for key in ("dailyLossPercent", "maxDailyLossPercent")}, "portfolio")
    check("buying_power", required_numbers["availableBuyingPower"] is not None
          and required_numbers["proposedNotional"] is not None
          and required_numbers["availableBuyingPower"] >= required_numbers["proposedNotional"] > 0,
          {key: required_numbers[key] for key in ("availableBuyingPower", "proposedNotional")}, "portfolio")

    failed_market = [item["id"] for item in checks if not item["passed"] and item["category"] == "market"]
    failed_portfolio = [item["id"] for item in checks if not item["passed"] and item["category"] == "portfolio"]
    promotion_blockers = ["uncalibrated_forward_performance"]
    if gate.get("volumeScope") != "consolidated":
        promotion_blockers.append("consolidated_market_data_unavailable")
    return {
        "policyVersion": POLICY_VERSION, "symbol": str(symbol or ""), "observedAt": now,
        "status": "COMPLETE" if current is not None else "INCOMPLETE",
        "shadowEligible": not failed_market,
        "portfolioEligible": not failed_market and not failed_portfolio,
        "actionableEligible": False,
        "failedMarketChecks": failed_market, "failedPortfolioChecks": failed_portfolio,
        "promotionBlockers": promotion_blockers, "checks": checks,
        "classification": "research_only", "recommendationAllowed": False,
        "orderSubmissionAllowed": False,
    }
