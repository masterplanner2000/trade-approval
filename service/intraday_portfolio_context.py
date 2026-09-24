"""Read-only IBKR Paper portfolio context for intraday shadow safety."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from math import isfinite
from pathlib import Path
from typing import Callable, Mapping

from ibkr_reconciliation import collect_snapshot


CONTEXT_VERSION = "intraday-paper-portfolio-context-v2"
MAX_SNAPSHOT_AGE_SECONDS = 60
DATA = Path(__file__).resolve().parent / "data"
RISK_PATH = DATA / "risk-policy.json"
RISK_FALLBACK_PATH = DATA / "risk-policy.example.json"
STRATEGY_PATH = DATA / "strategy-state.json"
SECTOR_REGISTRY_PATH = DATA / "intraday-sector-registry.json"


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


def load_sector_registry(path: Path = SECTOR_REGISTRY_PATH) -> dict[str, object]:
    document = _load_json(path)
    version = document.get("version")
    entries = document.get("entries")
    if not isinstance(version, str) or not version or not isinstance(entries, Mapping):
        raise ValueError("intraday_sector_registry_invalid")
    normalized: dict[str, dict[str, str]] = {}
    for raw_symbol, raw_entry in entries.items():
        symbol = str(raw_symbol).strip().upper()
        if not symbol or not isinstance(raw_entry, Mapping):
            raise ValueError("intraday_sector_registry_invalid")
        sector = raw_entry.get("sector")
        effective = raw_entry.get("effectiveFrom")
        source = raw_entry.get("source")
        if (not isinstance(sector, str) or not sector or
                not isinstance(effective, str) or not effective or
                not isinstance(source, str) or not source.startswith("https://")):
            raise ValueError("intraday_sector_registry_invalid")
        normalized[symbol] = {
            "sector": sector, "effectiveFrom": effective, "source": source,
        }
    return {"version": version, "entries": normalized}


def _aggregate_stock_positions(positions: list[object]) -> list[dict[str, object]]:
    aggregated: dict[str, dict[str, float | str]] = {}
    for position in positions:
        if not isinstance(position, Mapping) or position.get("securityType") != "STK":
            continue
        symbol = str(position.get("symbol") or "").strip().upper()
        quantity = _number(position.get("quantity"))
        average_cost = _number(position.get("averageCost"))
        if not symbol or quantity in (None, 0) or average_cost is None or average_cost <= 0:
            continue
        current = aggregated.setdefault(symbol, {
            "symbol": symbol, "quantity": 0.0, "costNotional": 0.0,
        })
        current["quantity"] = float(current["quantity"]) + float(quantity)
        current["costNotional"] = (float(current["costNotional"]) +
                                   abs(float(quantity)) * float(average_cost))
    result = []
    for position in aggregated.values():
        quantity = float(position["quantity"])
        if quantity == 0:
            continue
        result.append({
            "symbol": position["symbol"], "quantity": quantity,
            "averageCost": float(position["costNotional"]) / abs(quantity),
        })
    return result


def build_portfolio_context(
    snapshot: Mapping[str, object], *, symbol: str, observed_at: str,
    market_price: float, limits: Mapping[str, float], sector_registry: Mapping[str, object],
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
    registry_version = sector_registry.get("version")
    sector_entries = sector_registry.get("entries")
    if not isinstance(registry_version, str) or not isinstance(sector_entries, Mapping):
        missing.append("sector_registry")
    if missing:
        return {**base, "status": "INCOMPLETE", "observedAt": None,
                "missing": sorted(set(missing))}

    sleeve = float(limits["sleeveValue"])
    normalized_positions = _aggregate_stock_positions(positions)
    required_symbols = {str(position["symbol"]) for position in normalized_positions} | {symbol}
    unknown_sectors = sorted(candidate for candidate in required_symbols
                             if candidate not in sector_entries)
    if unknown_sectors:
        return {**base, "status": "INCOMPLETE", "observedAt": None,
                "missing": ["sector_classification"], "unclassifiedSymbols": unknown_sectors,
                "sectorRegistryVersion": registry_version}
    candidate_sector = sector_entries[symbol]["sector"]
    symbol_position = next((position for position in normalized_positions
                            if position.get("symbol") == symbol), None)
    symbol_quantity = abs(float(symbol_position["quantity"])) if symbol_position else 0.0
    current_symbol_notional = symbol_quantity * market_price
    gross_estimate = 0.0
    sector_estimate = 0.0
    for position in normalized_positions:
        quantity = abs(float(position["quantity"]))
        price = market_price if position.get("symbol") == symbol else _number(position.get("averageCost"))
        if price is None or price <= 0:
            return {**base, "status": "INCOMPLETE", "observedAt": None,
                    "missing": ["position_valuation"]}
        notional = quantity * price
        gross_estimate += notional
        if sector_entries[str(position["symbol"])]["sector"] == candidate_sector:
            sector_estimate += notional
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
        "sector": candidate_sector,
        "sectorExposurePercent": round((sector_estimate + proposed) / sleeve * 100, 4),
        "maxSectorExposurePercent": float(limits["maxSectorExposurePercent"]),
        "sectorExposureMethod": "explicit_source_reviewed_exposure_bucket",
        "sectorRegistryVersion": registry_version,
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
                 limits: Mapping[str, float] | None = None,
                 sector_registry: Mapping[str, object] | None = None):
        client_id = int(os.environ.get("IBKR_INTRADAY_CLIENT_ID", "81"))
        self.snapshot_reader = snapshot_reader or (lambda: collect_snapshot(client_id=client_id))
        self.limits = dict(limits or load_limits())
        self.sector_registry = dict(sector_registry or load_sector_registry())
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
                                       market_price=price, limits=self.limits,
                                       sector_registry=self.sector_registry)
