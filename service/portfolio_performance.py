"""Broker-evidence portfolio performance, isolated from candidate counterfactuals."""

from __future__ import annotations

import json
import statistics
import sqlite3
from math import sqrt
from datetime import datetime
from pathlib import Path
from typing import Any

from ibkr_daily_scanner import DailyBar


FILLED = {"filled", "partiallyfilled"}
EXIT_ROLES = {"exit", "protective_stop", "profit_target"}


def _price(payload: dict[str, Any]) -> float:
    return float(payload.get("averagePrice") or payload.get("averageFillPrice")
                 or payload.get("price") or 0)


def _quantity(payload: dict[str, Any], fallback: float = 0) -> float:
    return float(payload.get("cumulativeQuantity") or payload.get("filled")
                 or payload.get("quantity") or fallback or 0)


def _execution_date(payload: dict[str, Any], observed_ms: int) -> str:
    value = payload.get("time")
    if isinstance(value, str) and len(value) >= 8 and value[:8].isdigit():
        return value[:8]
    return datetime.fromtimestamp(observed_ms / 1000).strftime("%Y%m%d")


def _slippage_bps(role: str, execution_price: float, proposed_price: float) -> float | None:
    """Return positive basis points when execution was worse than the proposal."""
    if execution_price <= 0 or proposed_price <= 0:
        return None
    if role == "entry":
        return ((execution_price / proposed_price) - 1) * 10_000
    if role in EXIT_ROLES:
        return ((proposed_price / execution_price) - 1) * 10_000
    return None


def portfolio_performance(
    ledger_path: Path,
    histories: dict[str, list[DailyBar]],
    *,
    capital: float = 10_000,
    environment: str = "paper",
    benchmark_symbol: str = "QQQ",
    benchmark_cost_bps: float = 20,
) -> dict[str, object]:
    if capital <= 0:
        raise ValueError("portfolio_performance_capital_invalid")
    if not ledger_path.exists():
        return {"ok": False, "status": "LEDGER_UNAVAILABLE"}
    with sqlite3.connect(f"file:{ledger_path}?mode=ro", uri=True) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            """SELECT p.id AS proposal_id,p.symbol,p.environment,p.terms_json,
                      o.role,o.status,o.order_json,o.last_seen_at
               FROM proposals p JOIN broker_orders o ON o.proposal_id=p.id
               WHERE p.environment=? ORDER BY o.last_seen_at,o.rowid""",
            (environment,),
        ).fetchall()
    events = []
    fees_complete = True
    for row in rows:
        if str(row["status"]).lower() not in FILLED:
            continue
        payload = json.loads(row["order_json"])
        terms = json.loads(row["terms_json"])
        quantity = _quantity(payload, terms.get("quantity", 0))
        price = _price(payload) or float(terms.get("limitPrice") or 0)
        if quantity <= 0 or price <= 0:
            continue
        commission = payload.get("commission")
        if not isinstance(commission, (int, float)):
            commission = None
            fees_complete = False
        events.append({
            "proposalId": row["proposal_id"], "symbol": row["symbol"],
            "role": row["role"], "date": _execution_date(payload, row["last_seen_at"]),
            "quantity": quantity, "price": price, "commission": commission,
            "proposedPrice": float((
                terms.get("limitPrice") if row["role"] == "entry"
                else terms.get("stopPrice") if row["role"] == "protective_stop"
                else terms.get("targetPrice") if row["role"] == "profit_target"
                else terms.get("limitPrice")
            ) or 0),
        })
    entries = [event for event in events if event["role"] == "entry"]
    if not entries:
        return {"ok": True, "status": "NO_STRATEGY_FILLS", "environment": environment,
                "capital": capital, "feesComplete": True, "equityCurve": []}
    events.sort(key=lambda event: (event["date"], event["role"] != "entry", event["proposalId"]))
    start_date = min(event["date"] for event in events)
    benchmark = histories.get(benchmark_symbol, [])
    end_date = benchmark[-1].date if benchmark else max(event["date"] for event in events)
    session_dates = [bar.date for bar in benchmark if start_date <= bar.date <= end_date]
    if not session_dates:
        return {"ok": False, "status": "BENCHMARK_WINDOW_UNAVAILABLE",
                "environment": environment, "capital": capital}
    closes = {symbol: {bar.date: bar.close for bar in bars} for symbol, bars in histories.items()}
    cash = float(capital)
    known_fees = 0.0
    positions: dict[str, dict[str, float]] = {}
    realized_gross = 0.0
    turnover = 0.0
    curve = []
    missing_marks: set[str] = set()
    slippage_observations: list[dict[str, object]] = []
    for session_date in session_dates:
        for event in (item for item in events if item["date"] == session_date):
            notional = event["quantity"] * event["price"]
            turnover += notional
            fee = float(event["commission"] or 0)
            known_fees += fee
            slippage = _slippage_bps(
                str(event["role"]), float(event["price"]), float(event["proposedPrice"])
            )
            if slippage is not None:
                slippage_observations.append({
                    "proposalId": event["proposalId"], "symbol": event["symbol"],
                    "role": event["role"], "date": event["date"],
                    "slippageBps": round(slippage, 6),
                    "notional": round(notional, 2),
                })
            position = positions.setdefault(event["proposalId"], {
                "symbol": event["symbol"], "quantity": 0.0, "entryPrice": 0.0,
            })
            if event["role"] == "entry":
                new_quantity = position["quantity"] + event["quantity"]
                position["entryPrice"] = (
                    (position["entryPrice"] * position["quantity"] + notional) / new_quantity
                )
                position["quantity"] = new_quantity
                cash -= notional
            elif event["role"] in EXIT_ROLES:
                sold = min(position["quantity"], event["quantity"])
                realized_gross += (event["price"] - position["entryPrice"]) * sold
                position["quantity"] -= sold
                cash += event["price"] * sold
        market_value = 0.0
        for position in positions.values():
            if position["quantity"] <= 0:
                continue
            mark = closes.get(str(position["symbol"]), {}).get(session_date)
            if mark is None:
                missing_marks.add(f"{position['symbol']}:{session_date}")
                continue
            market_value += position["quantity"] * mark
        equity = cash + market_value
        curve.append({
            "date": session_date, "grossEquity": round(equity, 2),
            "netEquity": round(equity - known_fees, 2) if fees_complete else None,
            "marketValue": round(market_value, 2), "cash": round(cash, 2),
            "exposurePercent": round((market_value / capital) * 100, 4),
        })
    peak = curve[0]["grossEquity"]
    maximum_drawdown = 0.0
    for point in curve:
        peak = max(peak, point["grossEquity"])
        drawdown = ((point["grossEquity"] / peak) - 1) * 100 if peak else 0
        maximum_drawdown = min(maximum_drawdown, drawdown)
    final_equity = curve[-1]["grossEquity"]
    current_positions = []
    unrealized_gross = 0.0
    for proposal_id, position in positions.items():
        if position["quantity"] <= 0:
            continue
        mark = closes.get(str(position["symbol"]), {}).get(session_dates[-1])
        if mark is None:
            continue
        unrealized = (mark - position["entryPrice"]) * position["quantity"]
        unrealized_gross += unrealized
        current_positions.append({
            "proposalId": proposal_id, "symbol": position["symbol"],
            "quantity": position["quantity"], "entryPrice": round(position["entryPrice"], 4),
            "currentClose": round(mark, 4), "unrealizedGrossPnl": round(unrealized, 2),
        })
    qqq_by_date = {bar.date: bar for bar in benchmark}
    first_benchmark = qqq_by_date[session_dates[0]]
    last_benchmark = qqq_by_date[session_dates[-1]]
    qqq_gross_bps = ((last_benchmark.close / first_benchmark.open) - 1) * 10_000
    strategy_return_bps = ((final_equity / capital) - 1) * 10_000
    net_return_bps = (((final_equity - known_fees) / capital) - 1) * 10_000
    daily_performance = []
    previous_gross = capital
    previous_net = capital
    exposure_matched_equity = float(capital)
    previous_exposure = 0.0
    daily_excess_returns: list[float] = []
    for point in curve:
        gross_change = point["grossEquity"] - previous_gross
        net_change = None if point["netEquity"] is None else point["netEquity"] - previous_net
        qqq_bar = qqq_by_date[point["date"]]
        exposure = float(point["exposurePercent"]) / 100
        qqq_session_return = (qqq_bar.close / qqq_bar.open) - 1
        allocation_cost = abs(exposure - previous_exposure) * (benchmark_cost_bps / 10_000)
        exposure_matched_return = exposure * qqq_session_return - allocation_cost
        exposure_matched_equity *= 1 + exposure_matched_return
        gross_daily_return = gross_change / previous_gross if previous_gross else 0
        daily_excess_returns.append(gross_daily_return - exposure_matched_return)
        daily_performance.append({
            "date": point["date"],
            "grossPnl": round(gross_change, 2),
            "grossReturnBps": round((gross_change / previous_gross) * 10_000, 6)
            if previous_gross else None,
            "netPnl": round(net_change, 2) if net_change is not None else None,
            "netReturnBps": round((net_change / previous_net) * 10_000, 6)
            if net_change is not None and previous_net else None,
            "endingExposurePercent": point["exposurePercent"],
            "exposureMatchedQqqReturnBps": round(exposure_matched_return * 10_000, 6),
        })
        previous_gross = point["grossEquity"]
        previous_exposure = exposure
        if point["netEquity"] is not None:
            previous_net = point["netEquity"]
    weighted_slippage = (
        sum(float(item["slippageBps"]) * float(item["notional"])
            for item in slippage_observations)
        / sum(float(item["notional"]) for item in slippage_observations)
        if slippage_observations else None
    )
    report_status = (
        "INCOMPLETE_MARKS" if missing_marks else
        "COMPLETE_NET" if fees_complete else
        "COMPLETE_GROSS"
    )
    exposure_matched_return_bps = ((exposure_matched_equity / capital) - 1) * 10_000
    risk_adjusted = {
        "status": "COMPLETE" if len(daily_excess_returns) >= 20 else "INSUFFICIENT_SAMPLE",
        "minimumSessionCount": 20,
        "observedSessionCount": len(daily_excess_returns),
        "annualizedInformationRatio": None,
    }
    if len(daily_excess_returns) >= 20:
        tracking_error = statistics.stdev(daily_excess_returns)
        risk_adjusted["annualizedInformationRatio"] = (
            round((statistics.fmean(daily_excess_returns) / tracking_error) * sqrt(252), 6)
            if tracking_error > 0 else None
        )
    return {
        "ok": True, "status": report_status,
        "environment": environment, "capital": capital,
        "window": {"startDate": session_dates[0], "endDate": session_dates[-1],
                   "sessionCount": len(session_dates)},
        "strategyOwnedEntryCount": len(entries),
        "strategyOwnedExecutionCount": len(events),
        "openPositionCount": len(current_positions),
        "grossRealizedPnl": round(realized_gross, 2),
        "grossUnrealizedPnl": round(unrealized_gross, 2),
        "grossEndingEquity": final_equity,
        "grossReturnBps": round(strategy_return_bps, 6),
        "netEndingEquity": round(final_equity - known_fees, 2) if fees_complete else None,
        "netReturnBps": round(net_return_bps, 6) if fees_complete else None,
        "feesComplete": fees_complete,
        "knownFees": round(known_fees, 2),
        "turnoverDollars": round(turnover, 2),
        "turnoverRatio": round(turnover / capital, 6),
        "maximumGrossDrawdownPercent": round(maximum_drawdown, 6),
        "endingExposurePercent": curve[-1]["exposurePercent"],
        "averageExposurePercent": round(
            sum(point["exposurePercent"] for point in curve) / len(curve), 6
        ),
        "cashBenchmarkReturnBps": 0.0,
        "qqqBenchmarkGrossReturnBps": round(qqq_gross_bps, 6),
        "qqqBenchmarkNetReturnBps": round(qqq_gross_bps - benchmark_cost_bps, 6),
        "grossExcessVsQqqBps": round(strategy_return_bps - (qqq_gross_bps - benchmark_cost_bps), 6),
        "netExcessVsQqqBps": round(net_return_bps - (qqq_gross_bps - benchmark_cost_bps), 6)
        if fees_complete else None,
        "exposureMatchedQqqNetReturnBps": round(exposure_matched_return_bps, 6),
        "grossExcessVsExposureMatchedQqqBps": round(
            strategy_return_bps - exposure_matched_return_bps, 6
        ),
        "exposureMatchedBenchmarkMethod": (
            "Daily QQQ open-to-close return scaled by strategy ending exposure; "
            "20 bps applied pro rata to absolute daily allocation changes."
        ),
        "riskAdjustedComparison": risk_adjusted,
        "executionSlippageSampleCount": len(slippage_observations),
        "notionalWeightedExecutionSlippageBps": round(weighted_slippage, 6)
        if weighted_slippage is not None else None,
        "executionSlippage": slippage_observations,
        "missingMarkCount": len(missing_marks),
        "dataQuality": {
            "fees": "COMPLETE" if fees_complete else "INCOMPLETE",
            "marks": "COMPLETE" if not missing_marks else "INCOMPLETE",
            "benchmark": "COMPLETE",
            "netPerformanceAvailable": fees_complete and not missing_marks,
        },
        "currentPositions": current_positions,
        "dailyPerformance": daily_performance,
        "equityCurve": curve,
    }
