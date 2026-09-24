"""Read-only IBKR Paper portfolio context for intraday shadow safety."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from math import isfinite
from pathlib import Path
from typing import Callable, Mapping

from ibkr_reconciliation import collect_snapshot


CONTEXT_VERSION = "intraday-paper-portfolio-context-v1"
MAX_SNAPSHOT_AGE_SECONDS = 60
DATA = Path(__file__).resolve().parent / "data"
RISK_PATH = DATA / "risk-policy.json"
RISK_FALLBACK_PATH = DATA / "risk-policy.example.json"
STRATEGY_PATH = DATA / "strategy-state.json"


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    result = float(value)
    return result if isfinite(result) else None


def _summary(snapshot: Mapping[str, object], key: str) -> float | None:
    summary = snapshot.get("summary")
    item = summary.get(key) if isinstance(summary, Mapping) else None
    return _number(item.get("value")) if isinstance(item, Mapping) else None


def _instant(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("portfolio_observed_at_timezone_required")
    return parsed.astimezone(timezone.utc)


def _load_json(path: Path) -> Mapping[str, object]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise ValueError("intraday_portfolio_configuration_unavailable") from None
    if not isinstance(payload, Mapping):
        raise ValueError("intraday_portfolio_configuration_invalid")
    return payload


def load_limits() -> dict[str, float]:
    risk_document = _load_json(RISK_PATH if RISK_PATH.exists() else RISK_FALLBACK_PATH)
    strategy = _load_json(STRATEGY_PATH)
    risk = risk_document.get("policy")
    if not isinstance(risk, Mapping):
        raise ValueError("intraday_portfolio_configuration_invalid")
    values = {
        "sleeveValue": _number(risk.get("sleeveValue")),
        "maxOpenPositions": _number(risk.get("maximumPositions")),
        "maxSymbolExposurePercent": _number(risk.get("maximumPositionPercent")),
        "maxSectorExposurePercent": _number(risk.get("maximumSectorPercent")),
        "maxDailyLossPercent": _number(risk.get("dailyLossPercent")),
        "perTradeLimit": _number(strategy.get("perTradeLimit")),
    }
    if any(value is None or value <= 0 for value in values.values()):
        raise ValueError("intraday_portfolio_configuration_invalid")
    return {key: float(value) for key, value in values.items()}


def build_portfolio_context(
    snapshot: Mapping[str, object], *, symbol: str, observed_at: str,
    market_price: float, limits: Mapping[str, float],
) -> dict[str, object]:
    observed = _instant(observed_at)
    captured_ms = _number(snapshot.get("capturedAt"))
    captured = (datetime.fromtimestamp(captured_ms / 1000, timezone.utc)
                if captured_ms is not None else None)
    age = (observed - captured).total_seconds() if captured is not None else None
    base = {
        "contextVersion": CONTEXT_VERSION, "symbol": symbol,
        "dataSource": "IBKR TWS Paper read-only reconciliation",
        "environment": snapshot.get("environment"), "account": snapshot.get("account"),
        "classification": "research_only", "recommendationAllowed": False,
        "orderSubmissionAllowed": False,
    }
    missing: list[str] = []
    if snapshot.get("ok") is not True or snapshot.get("complete") is not True:
        missing.append("complete_snapshot")
    if snapshot.get("environment") != "paper":
        missing.append("paper_environment")
    if snapshot.get("readOnly") is not True:
        missing.append("read_only_collection")
    if age is None or not -1 <= age <= MAX_SNAPSHOT_AGE_SECONDS:
        missing.append("fresh_snapshot")
    positions = snapshot.get("positions")
    if not isinstance(positions, list):
        missing.append("positions")
        positions = []
    buying_power = _summary(snapshot, "BuyingPower")
    available_funds = _summary(snapshot, "AvailableFunds")
    pnl = snapshot.get("pnl") if isinstance(snapshot.get("pnl"), Mapping) else {}
    daily_pnl = _number(pnl.get("dailyPnl"))
    realized = _number(pnl.get("realizedPnl"))
    unrealized = _number(pnl.get("unrealizedPnl"))
    if daily_pnl is None and realized is not None and unrealized is not None:
        daily_pnl = realized + unrealized
    if buying_power is None or available_funds is None:
        missing.append("buying_power")
    if daily_pnl is None:
        missing.append("daily_pnl")
    required_limits = ("sleeveValue", "maxOpenPositions", "maxSymbolExposurePercent",
                       "maxSectorExposurePercent", "maxDailyLossPercent", "perTradeLimit")
    if any(_number(limits.get(key)) is None for key in required_limits):
        missing.append("risk_limits")
    if missing:
        return {**base, "status": "INCOMPLETE", "observedAt": None,
                "missing": sorted(set(missing))}

    sleeve = float(limits["sleeveValue"])
    normalized_positions = [position for position in positions if isinstance(position, Mapping)
                            and position.get("securityType") == "STK"
                            and _number(position.get("quantity")) not in (None, 0)]
    symbol_position = next((position for position in normalized_positions
                            if position.get("symbol") == symbol), None)
    symbol_quantity = abs(float(symbol_position["quantity"])) if symbol_position else 0.0
    current_symbol_notional = symbol_quantity * market_price
    gross_estimate = 0.0
    for position in normalized_positions:
        quantity = abs(float(position["quantity"]))
        price = market_price if position.get("symbol") == symbol else _number(position.get("averageCost"))
        if price is None or price <= 0:
            return {**base, "status": "INCOMPLETE", "observedAt": None,
                    "missing": ["position_valuation"]}
        gross_estimate += quantity * price
    available = min(float(buying_power), float(available_funds))
    max_symbol_notional = sleeve * float(limits["maxSymbolExposurePercent"]) / 100
    proposed = max(0.0, min(float(limits["perTradeLimit"]), available,
                            max_symbol_notional - current_symbol_notional))
    total_pnl = float(daily_pnl)
    return {
        **base, "status": "COMPLETE", "observedAt": captured.isoformat().replace("+00:00", "Z"),
        "missing": [], "openPositionCount": len(normalized_positions),
        "maxOpenPositions": int(limits["maxOpenPositions"]),
        "addingToExistingPosition": symbol_position is not None,
        "symbolExposurePercent": round((current_symbol_notional + proposed) / sleeve * 100, 4),
        "maxSymbolExposurePercent": float(limits["maxSymbolExposurePercent"]),
        "sectorExposurePercent": round((gross_estimate + proposed) / sleeve * 100, 4),
        "maxSectorExposurePercent": float(limits["maxSectorExposurePercent"]),
        "sectorExposureMethod": "conservative_all_positions_same_sector_upper_bound",
        "dailyLossPercent": round(max(0.0, -total_pnl) / sleeve * 100, 4),
        "maxDailyLossPercent": float(limits["maxDailyLossPercent"]),
        "availableBuyingPower": round(available, 2),
        "proposedNotional": round(proposed, 2),
        "proposedNotionalMethod": "min_trade_limit_buying_power_remaining_symbol_cap",
        "grossPositionEstimate": round(gross_estimate, 2),
    }


class IbkrPaperPortfolioReader:
    """Fetch once per capture cycle, then derive symbol-specific contexts."""

    def __init__(self, *, snapshot_reader: Callable[[], Mapping[str, object]] | None = None,
                 limits: Mapping[str, float] | None = None):
        client_id = int(os.environ.get("IBKR_INTRADAY_CLIENT_ID", "81"))
        self.snapshot_reader = snapshot_reader or (lambda: collect_snapshot(client_id=client_id))
        self.limits = dict(limits or load_limits())
        self._snapshot: Mapping[str, object] | None = None

    def prime(self) -> None:
        if self._snapshot is not None:
            return
        try:
            self._snapshot = dict(self.snapshot_reader())
        except Exception:
            self._snapshot = {"ok": False, "complete": False, "environment": "paper",
                              "readOnly": True, "error": "portfolio_snapshot_unavailable"}

    def context(self, symbol: str, observed_at: str,
                market: Mapping[str, object]) -> dict[str, object]:
        self.prime()
        price = _number(market.get("last"))
        if price is None or price <= 0:
            return {"contextVersion": CONTEXT_VERSION, "symbol": symbol, "status": "INCOMPLETE",
                    "observedAt": None, "missing": ["market_price"],
                    "classification": "research_only", "recommendationAllowed": False,
                    "orderSubmissionAllowed": False}
        return build_portfolio_context(self._snapshot, symbol=symbol, observed_at=observed_at,
                                       market_price=price, limits=self.limits)
