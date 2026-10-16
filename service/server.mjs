import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { getSecCompanyResearch, summarizeSecResearch } from "./sec_edgar.mjs";
import { getStockNews, stockNewsSymbol } from "./stock_news.mjs";
import { classifyStockCatalysts } from "./stock_catalyst.mjs";
import { GlobalNewsJournal } from "./global_news_journal.mjs";
import { authoritativePortfolio, BrokerReconciliationStore, reconcileSnapshotToLedger } from "./broker_reconciliation.mjs";
import { TradingLedger } from "./trading_ledger.mjs";
import { reconcilePositionOwnership } from "./position_ownership.mjs";
import { loadHistoricalEvidence } from "./historical_position_evidence.mjs";
import { loadPaperFlexEvidence } from "./paper_flex_evidence.mjs";
import { DeterministicBroker } from "./testing/deterministic_broker.mjs";
import { evaluateAutomaticExits } from "./automatic_exit_policy.mjs";
import { assessAutomaticExitQuote } from "./automatic_exit_quote.mjs";
import { resolveProposalEvidenceIdentity } from "./proposal_evidence_identity.mjs";
import { chooseActiveRecommendationVersions, createQueueSerialExecutor } from "./recommendation_queue.mjs";
import { effectivePortfolioLimits, portfolioBuyCapacity } from "./portfolio_policy.mjs";
import { canonicalExposureSymbol, evaluatePortfolioAddition, exposureProfile } from "./portfolio_exposure.mjs";
import { buildExitReviewCards } from "./exit_review_engine.mjs";
import { buildCurrentPerformance } from "./current_performance.mjs";
import { ConnectionSupervisor } from "./connection_supervisor.mjs";
import { ProtectedExitOutbox } from "./protected_exit_outbox.mjs";
import { assessProfitablePaperBidFallback, getAlpacaExecutionQuote } from "./alpaca_execution_quote.mjs";
import { CATALYST_SPRINT_MODE, evaluateCatalystSprint } from "./catalyst_sprint_mode.mjs";
import { alpacaPreflight, alpacaReconciliation, alpacaReplaceOrder, alpacaSnapshot, alpacaSubmitBracket, alpacaSubmitExit, alpacaSubmitProtectionOco } from "./alpaca_broker.mjs";

const port = Number(process.env.TRADE_APPROVAL_PORT ?? 8787);
const host = process.env.TRADE_APPROVAL_HOST ?? "127.0.0.1";
const appToken = process.env.TRADE_APPROVAL_APP_TOKEN ?? "";
const brokerMode = process.env.TRADE_APPROVAL_BROKER_MODE ?? "alpaca";
if (!new Set(["alpaca", "ibkr", "simulated"]).has(brokerMode)) throw new Error("invalid_broker_mode");
const brokerName = brokerMode === "alpaca" ? "Alpaca" : brokerMode === "ibkr" ? "IBKR" : "Simulated";
const whatIfEnabled = brokerMode === "alpaca" || process.env.IBKR_ENABLE_WHAT_IF === "true";
const paperSubmitEnabled = brokerMode === "alpaca"
  ? process.env.ALPACA_ENABLE_PAPER_SUBMIT !== "false"
  : process.env.IBKR_ENABLE_PAPER_SUBMIT === "true";
const automaticPaperSellsRequested = process.env.IBKR_ENABLE_AUTOMATIC_SELLS === "true";
// This code release has no broker-verified protection-preserving exit path.
// An environment toggle alone must never unlock the incomplete adapter.
const automaticExitReleaseReady = false;
const automaticPaperSellsEnabled = automaticPaperSellsRequested && automaticExitReleaseReady;
const reconciliationEnabled = brokerMode === "alpaca"
  ? process.env.ALPACA_ENABLE_RECONCILIATION !== "false"
  : process.env.IBKR_ENABLE_RECONCILIATION !== "false";
const maximumBidAskSpreadPercent = 0.25;
const signingSecret = process.env.APPROVAL_SIGNING_SECRET ?? "paper-development-only";
const proposals = new Map();
const proposalSnapshots = new Map();
const auditLog = [];
const previewPassed = new Set();
const whatIfPassed = new Set();
let paused = false;
let observedBrokerExecutionIds = null;
const execFileAsync = promisify(execFile);
const serviceDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = dirname(serviceDirectory);
const ibkrPython = join(projectDirectory, ".venv-ibkr-10.49", "bin", "python");
const ibkrSnapshotScript = join(serviceDirectory, "ibkr_snapshot.py");
const ibkrWhatIfScript = join(serviceDirectory, "ibkr_what_if.py");
const ibkrPaperSubmitScript = join(serviceDirectory, "ibkr_submit_paper.py");
const ibkrPaperExitScript = join(serviceDirectory, "ibkr_submit_paper_exit.py");
const ibkrReplacePaperTargetScript = join(serviceDirectory, "ibkr_replace_paper_target.py");
const ibkrReconciliationScript = join(serviceDirectory, "ibkr_reconciliation.py");
const alpacaMarketCacheScript = join(serviceDirectory, "alpaca_market_cache.py");
const aggressiveShadowScannerScript = join(serviceDirectory, "aggressive_shadow_scanner.py");
const strategyStatePath = process.env.STRATEGY_STATE_PATH ?? join(serviceDirectory, "data", "strategy-state.json");
const shadowLedgerPath = process.env.SHADOW_LEDGER_PATH ?? join(serviceDirectory, "data", "shadow-signals.json");
const tradingLedgerPath = process.env.TRADE_LEDGER_PATH ?? join(serviceDirectory, "data", "trading-ledger.sqlite3");
const riskPolicyPath = process.env.RISK_POLICY_PATH ?? join(serviceDirectory, "data", "risk-policy.json");
const historicalEvidencePath = process.env.HISTORICAL_BROKER_EVIDENCE_PATH ?? join(serviceDirectory, "data", "paper-transaction-history.json");
const paperFlexEvidencePath = process.env.PAPER_FLEX_EVIDENCE_PATH ?? join(serviceDirectory, "data", "paper-flex-attribution.json");
const dailyEvidencePath = process.env.DAILY_EVIDENCE_PATH ?? join(serviceDirectory, "data", "daily-forward-evidence.sqlite3");
const globalNewsPath = process.env.GLOBAL_NEWS_DB_PATH ?? join(serviceDirectory, "data", "global-news.sqlite3");
const protectedExitOutboxPath = process.env.PROTECTED_EXIT_OUTBOX_PATH ?? join(serviceDirectory, "data", "protected-exit-outbox.sqlite3");
const strategyComparisonPath = process.env.STRATEGY_COMPARISON_PATH ?? join(projectDirectory, "reports", "daily-shadow-comparison.json");
let tradingLedger = null;
let reconciliationStore = null;
let globalNewsJournal = null;
let protectedExitOutbox = null;
const serializeRecommendationQueue = createQueueSerialExecutor();
const connectionSupervisor = new ConnectionSupervisor({ failureThreshold: 3 });
const exitSubmissionsInFlight = new Set();
const strategy = JSON.parse(readFileSync(strategyStatePath, "utf8"));
const simulatedBroker = brokerMode === "simulated"
  ? new DeterministicBroker({ account: "SIM-PAPER", cash: 100_000, now: Date.now() })
  : null;
let simulatedDisconnectAfterSubmit = false;
const defaultRiskPolicy = {
  adaptive: true,
  sleeveValue: 10_000,
  normalRiskPercent: 0.25,
  hardRiskPercent: 0.5,
  dailyLossPercent: 0.75,
  totalOpenRiskPercent: 1.25,
  maximumPositionPercent: 15,
  maximumDeployedPercent: 100,
  minimumCashReservePercent: 0,
  maximumSectorPercent: 35,
  maximumCorrelatedPercent: 35,
  maximumPositions: 8,
};
const riskPolicyVersion = 2;
const companies = {
  NVDA: "NVIDIA Corporation",
  AAPL: "Apple Inc.",
  MSFT: "Microsoft Corporation",
};

function ledger() {
  if (!tradingLedger) tradingLedger = new TradingLedger(tradingLedgerPath);
  return tradingLedger;
}

function reconciliations() {
  if (!reconciliationStore) reconciliationStore = new BrokerReconciliationStore(tradingLedgerPath);
  return reconciliationStore;
}

function newsJournal() {
  if (!globalNewsJournal) globalNewsJournal = new GlobalNewsJournal(globalNewsPath);
  return globalNewsJournal;
}

function exitOutbox() {
  if (!protectedExitOutbox) protectedExitOutbox = new ProtectedExitOutbox(protectedExitOutboxPath);
  return protectedExitOutbox;
}

function durableNewsResearch(symbol, limit = 50) {
  const events = newsJournal().listRecent({ symbol, limit });
  const articles = events.map(event => ({ id: event.sourceRecordId, headline: event.headline,
    source: event.publisher, url: event.url, symbols: event.symbols, publishedAt: event.publishedAt, updatedAt: event.updatedAt }));
  return { status: events.length ? "available" : "empty", symbol, researchOnly: true, rankingAdjustmentAllowed: false,
    orderSubmissionAllowed: false, events, catalystResearch: classifyStockCatalysts({ symbol, articles }) };
}

function proposalLedgerRecord(proposal) {
  const { status, decisionId: _decisionId, ...terms } = proposal;
  return {
    id: proposal.id,
    createdAt: proposal.createdAt,
    expiresAt: proposal.expiresAt,
    status,
    environment: proposal.environment,
    broker: proposal.broker,
    accountId: proposal.accountId,
    symbol: proposal.symbol,
    side: proposal.side,
    terms,
    source: {
      agentId: proposal.agentId ?? null,
      category: proposal.category ?? null,
      signalDate: proposal.signalDate ?? null,
      universeSource: proposal.universeSource ?? null,
      lane: proposal.sourceLane ?? null,
      rulesetVersion: proposal.rulesetVersion ?? null,
      evidenceRunId: proposal.evidenceRunId ?? null,
      evidenceStatus: proposal.evidenceStatus ?? null,
    },
  };
}

function restoreLedgerState() {
  for (const row of ledger().listProposals()) {
    const decision = ledger().getDecisionForProposal(row.id);
    proposals.set(row.id, {
      ...row.terms,
      id: row.id,
      environment: row.environment,
      broker: row.broker,
      accountId: row.accountId,
      symbol: row.symbol,
      side: row.side,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      status: row.status,
      decisionId: decision?.id ?? null,
    });
    if (decision) {
      const eventTypes = new Set(ledger().listEvents(row.id).map((event) => event.eventType));
      if (eventTypes.has("order_preview_ready")) previewPassed.add(decision.id);
      if (eventTypes.has("ibkr_what_if_passed") || eventTypes.has("broker_preflight_passed")) whatIfPassed.add(decision.id);
    }
  }
}

function recordLedgerEvent(event) {
  ledger().appendEvent({
    eventKey: event.eventKey ?? null,
    proposalId: event.proposalId ?? null,
    decisionId: event.decisionId ?? null,
    submissionAttemptId: event.submissionAttemptId ?? null,
    eventType: event.event,
    occurredAt: event.at ?? now(),
    payload: event,
  });
}

function expireProposal(proposal) {
  if (proposal.status !== "pending") return;
  const decisionId = `expired:${proposal.id}`;
  ledger().recordDecision({
    id: decisionId,
    proposalId: proposal.id,
    decision: "expired",
    payload: { expiresAt: proposal.expiresAt },
  });
  proposal.status = "expired";
  proposal.decisionId = decisionId;
}

function recordSubmittedBrokerOrders(proposal, receipt, submissionAttempt, submission) {
  const orders = [
    { role: "entry", value: submission.result },
    { role: "profit_target", value: submission.exitOrders?.[0] },
    { role: "protective_stop", value: submission.exitOrders?.[1] },
  ];
  for (const { role, value } of orders) {
    if (!value?.orderId) continue;
    ledger().recordBrokerOrder({
      proposalId: proposal.id,
      submissionAttemptId: submissionAttempt.id,
      broker: receipt.broker,
      accountId: receipt.accountId,
      brokerOrderId: value.permanentId ?? value.orderId,
      parentBrokerOrderId: value.parentId ?? null,
      role,
      status: value.status ?? "Unknown",
      order: value,
    });
  }
}

function saveStrategy() {
  writeFileSync(strategyStatePath, `${JSON.stringify(strategy, null, 2)}\n`);
}

function readRiskPolicy() {
  try {
    const record = JSON.parse(readFileSync(riskPolicyPath, "utf8"));
    if (Number(record.version ?? 1) < riskPolicyVersion) {
      return {
        ...record,
        version: riskPolicyVersion,
        policy: {
          ...record.policy,
          maximumPositionPercent: 15,
          maximumDeployedPercent: 100,
          minimumCashReservePercent: 0,
          maximumSectorPercent: 35,
          maximumCorrelatedPercent: 35,
          maximumPositions: 8,
        },
      };
    }
    return record;
  } catch {
    return { version: riskPolicyVersion, updatedAt: null, policy: defaultRiskPolicy };
  }
}

export function validateRiskPolicy(policy) {
  const numericFields = Object.keys(defaultRiskPolicy).filter((field) => field !== "adaptive");
  if (!policy || typeof policy !== "object" || typeof policy.adaptive !== "boolean") return false;
  if (numericFields.some((field) => typeof policy[field] !== "number" || !Number.isFinite(policy[field]) || policy[field] < 0)) return false;
  const percentageFields = numericFields.filter((field) => field.endsWith("Percent"));
  return policy.sleeveValue > 0
    && Number.isInteger(policy.maximumPositions)
    && policy.maximumPositions >= 1
    && percentageFields.every((field) => policy[field] <= 100)
    && policy.normalRiskPercent <= policy.hardRiskPercent
    && policy.minimumCashReservePercent + policy.maximumDeployedPercent <= 100
    && policy.maximumPositionPercent <= policy.maximumDeployedPercent
    && policy.maximumSectorPercent <= policy.maximumDeployedPercent
    && policy.maximumCorrelatedPercent <= policy.maximumDeployedPercent;
}

function saveRiskPolicy(policy) {
  const record = { version: riskPolicyVersion, updatedAt: now(), policy };
  mkdirSync(dirname(riskPolicyPath), { recursive: true });
  writeFileSync(riskPolicyPath, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

function readShadowLedger() {
  try {
    return JSON.parse(readFileSync(shadowLedgerPath, "utf8"));
  } catch {
    return { version: 1, signals: [] };
  }
}

function saveShadowLedger(ledger) {
  mkdirSync(dirname(shadowLedgerPath), { recursive: true });
  writeFileSync(shadowLedgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}

async function scanDailyShadowSignals() {
  try {
    const { stdout } = await execFileAsync(ibkrPython, [alpacaMarketCacheScript, "scan"], {
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) {
    const output = error.stdout?.trim();
    if (output) return JSON.parse(output);
    throw error;
  }
}

async function scanAggressiveDailySignals() {
  try {
    const { stdout } = await execFileAsync(ibkrPython, [aggressiveShadowScannerScript, "scan"], {
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return normalizeAggressiveScan(JSON.parse(stdout));
  } catch (error) {
    const output = error.stdout?.trim();
    if (output) return normalizeAggressiveScan(JSON.parse(output));
    throw error;
  }
}

export function normalizeAggressiveScan(scan = {}) {
  return {
    ...scan,
    mode: "aggressive_paper",
    evaluations: (scan.candidates ?? [])
      .filter((candidate) => /^[A-Z0-9]{1,10}$/.test(String(candidate.symbol ?? "")))
      .map((candidate) => ({
      ...candidate,
      category: "VOLATILE_MOMENTUM",
      recommendationScore: candidate.researchScore,
      sourceLane: "shadow",
      marketRisk: candidate.marketRisk ?? null,
      })),
  };
}

function recordShadowScan(scan) {
  if (!scan.selected) return null;
  const selected = scan.selected;
  const id = `${scan.rulesetVersion}:${selected.signalDate}:${selected.symbol}`;
  const ledger = readShadowLedger();
  let record = ledger.signals.find((item) => item.id === id);
  if (!record) {
    record = {
      id,
      recordedAt: now(),
      mode: "shadow",
      orderSubmissionAllowed: false,
      rulesetVersion: scan.rulesetVersion,
      parameters: scan.parameters,
      ...selected,
    };
    ledger.signals.push(record);
    saveShadowLedger(ledger);
  }
  return record;
}

function strategySummary() {
  const budget = currentStrategyBudget();
  const pending = [...proposals.values()].filter((proposal) => proposal.status === "pending" && proposal.expiresAt > now()).length;
  return {
    ...strategy,
    capitalLimit: budget.capitalLimit,
    maxOpenPositions: budget.maxOpenPositions,
    currentExposure: budget.deployed,
    remainingCapital: budget.available,
    budget,
    pendingRecommendations: pending,
    completedCount: strategy.completed.length,
  };
}

const now = () => Date.now();

function positionOwnership(snapshot) {
  return reconcilePositionOwnership(snapshot, ledger(), {
    historicalSymbols: strategy.completed.filter((item) => item.outcome === "submitted").map((item) => item.symbol),
    // Unfilled manual orders do not change share provenance. Only an observed
    // external execution can veto an exact app-origin quantity match.
    externalSymbols: reconciliations().listActivity()
      .filter((item) => item.type === "execution" && item.ownership === "external")
      .map((item) => item.symbol),
    historicalEvidence: loadHistoricalEvidence(historicalEvidencePath),
    flexEvidence: loadPaperFlexEvidence(paperFlexEvidencePath),
  });
}

function currentStrategyBudget() {
  const storedPolicy = readRiskPolicy().policy;
  const policy = validateRiskPolicy(storedPolicy) ? storedPolicy : defaultRiskPolicy;
  const limits = effectivePortfolioLimits(strategy, policy);
  const ledgerBudget = ledger().strategyBudget(limits.capitalLimit);
  const latest = reconciliations().latest();
  if (latest) {
    const portfolio = authoritativePortfolio(latest.snapshot);
    if (portfolio.status === "COMPLETE") {
      const ownership = positionOwnership(latest.snapshot);
      const invested = roundPrice(ownership.items.reduce((sum, position) => sum + position.strategyCost, 0));
      const reserved = ledgerBudget.reserved;
      const deployed = roundPrice(invested + reserved);
      const openPositionCount = ownership.items.filter((position) =>
        position.ownership === "strategy_owned" && Number(position.strategyOwnedQuantity ?? 0) > 0).length;
      const capacity = portfolioBuyCapacity({
        deployed,
        openPositionCount,
        ownershipComplete: ownership.ownershipComplete,
        protectionComplete: ownership.protectionComplete,
        limits,
      });
      return {
        ...limits,
        openPositionCount,
        invested,
        reserved,
        deployed,
        ...capacity,
        status: !ownership.ownershipComplete ? "ownership_incomplete"
          : !ownership.protectionComplete ? "protection_incomplete"
            : capacity.overAllocated ? "policy_exceeded"
              : capacity.buyAllowed ? "reconciled" : "policy_limit_reached",
        ownershipComplete: ownership.ownershipComplete,
        protectionComplete: ownership.protectionComplete,
        ownershipConflicts: ownership.items.filter((item) => item.ownership === "conflict").map((item) => item.symbol),
        protectionGaps: ownership.items.filter((item) => item.ownership === "strategy_owned" && item.protection !== "verified")
          .map((item) => item.symbol),
        asOf: portfolio.asOf,
      };
    }
  }
  const deployed = Math.max(Number(strategy.currentExposure ?? 0), ledgerBudget.deployed);
  const openPositionCount = ledger().listPositions().length;
  const capacity = portfolioBuyCapacity({
    deployed,
    openPositionCount,
    ownershipComplete: false,
    protectionComplete: false,
    limits,
  });
  return {
    ...ledgerBudget,
    ...limits,
    openPositionCount,
    deployed,
    ...capacity,
    status: "reconciliation_required",
    asOf: null,
  };
}

function currentPortfolioExposureHoldings() {
  const latest = reconciliations().latest();
  if (latest && authoritativePortfolio(latest.snapshot).status === "COMPLETE") {
    const ownership = positionOwnership(latest.snapshot);
    return ownership.items
      .filter((item) => item.ownership === "strategy_owned" && Number(item.strategyOwnedQuantity ?? 0) > 0)
      .map((item) => ({ symbol: item.symbol, notional: Number(item.strategyCost ?? 0) }));
  }
  return ledger().listPositions().map((item) => ({
    symbol: item.symbol,
    notional: roundPrice(Number(item.quantity ?? 0) * Number(item.averageEntryPrice ?? 0)),
  }));
}

function candidatePortfolioFit(symbol, notional) {
  const budget = currentStrategyBudget();
  return evaluatePortfolioAddition({
    symbol,
    notional,
    holdings: currentPortfolioExposureHoldings(),
    capitalLimit: budget.capitalLimit,
    maxPositionValue: budget.maxPositionValue,
    maxSectorValue: budget.maxSectorValue,
    maxThemeValue: budget.maxThemeValue,
    maxOpenPositions: budget.maxOpenPositions,
  });
}

function roundPrice(value) {
  return Math.round(value * 100) / 100;
}

export function recommendationTtlMs(candidate = {}) {
  const atrPercent = Number(candidate.atrPercent14 ?? 0);
  if (atrPercent >= 5) return 2 * 60 * 1000;
  if (atrPercent >= 3) return 5 * 60 * 1000;
  return 10 * 60 * 1000;
}

export function eligibleQueueCandidates(scan = {}, excludedSymbols = new Set()) {
  return (scan.evaluations ?? [])
    .filter((candidate) => candidate.eligible && !excludedSymbols.has(candidate.symbol))
    .sort((left, right) => right.recommendationScore - left.recommendationScore);
}

export function wasDeniedForSignal(candidate = {}, completed = []) {
  return completed.some((item) =>
    item.outcome === "denied"
    && item.symbol === candidate.symbol
    && Boolean(item.signalDate)
    && item.signalDate === candidate.signalDate
  );
}

export function buildPortfolioReview(scan = {}, snapshot = {}, budget = {}) {
  const evaluations = new Map((scan.evaluations ?? []).map((item) => [item.symbol, item]));
  const ownershipItems = new Map((budget.ownership?.items ?? []).map((item) => [item.symbol, item]));
  const openTradesBySymbol = new Map((budget.openTrades ?? []).filter((item) => item.status === "open").map((item) => [item.symbol, item]));
  const protectedQuantities = new Map();
  const targetQuantities = new Map();
  for (const order of snapshot.openOrders ?? []) {
    if (order.action !== "SELL" || !["Submitted", "PreSubmitted"].includes(order.status)) continue;
    if (order.orderType === "STP") {
      protectedQuantities.set(order.symbol, (protectedQuantities.get(order.symbol) ?? 0) + Number(order.quantity ?? 0));
    } else if (order.orderType === "LMT") {
      targetQuantities.set(order.symbol, (targetQuantities.get(order.symbol) ?? 0) + Number(order.quantity ?? 0));
    }
  }
  const holdings = (snapshot.positions ?? []).map((position) => {
    const signal = evaluations.get(position.symbol) ?? null;
    const ownership = ownershipItems.get(position.symbol) ?? null;
    const quantity = Math.abs(Number(position.quantity ?? 0));
    const evaluated = Boolean(signal);
    const qualified = signal?.eligible === true;
    const estimatedValue = roundPrice(quantity * Number(signal?.referenceClose ?? position.averageCost ?? 0));
    const estimatedCostBasis = roundPrice(quantity * Number(position.averageCost ?? 0));
    const estimatedGrossPnl = roundPrice(estimatedValue - estimatedCostBasis);
    const recordedStop = Number(openTradesBySymbol.get(position.symbol)?.protectiveStopPrice);
    const marketReference = Number(position.currentPrice ?? signal?.referenceClose ?? 0);
    const protectiveStopBreached = recordedStop > 0 && marketReference > 0 && marketReference <= recordedStop;
    // This is only a screening gate. An executable rotation still needs a
    // fresh quote and estimated costs before a sell can be proposed.
    const ordinaryRotationProfitEligible = evaluated
      && Number(signal.referenceClose ?? 0) >= Number(position.averageCost ?? 0);
    const protectedPosition = ownership ? ownership.protection === "verified"
      : Math.abs((protectedQuantities.get(position.symbol) ?? 0) - quantity) < 1e-8;
    const exitPairVerified = protectedPosition
      && Math.abs((targetQuantities.get(position.symbol) ?? 0) - quantity) < 1e-8;
    return {
      symbol: position.symbol,
      quantity,
      averageCost: Number(position.averageCost ?? 0),
      estimatedValue,
      estimatedCostBasis,
      estimatedGrossPnl,
      ordinaryRotationProfitEligible,
      protectiveStopBreached,
      recordedProtectiveStop: recordedStop > 0 ? recordedStop : null,
      qualified,
      recommendationScore: signal?.recommendationScore ?? null,
      marketRisk: signal?.marketRisk?.level ?? null,
      protected: protectedPosition,
      exitPairVerified,
      ownership: ownership?.ownership ?? "unknown",
      status: ownership && ownership.ownership !== "strategy_owned" ? "OWNERSHIP_REVIEW"
        : !evaluated ? "DATA_UNAVAILABLE" : qualified && protectedPosition ? "HOLD" : "EXIT_REVIEW",
      reasons: [
        ...(!evaluated ? ["No current scanner evaluation is available"] : qualified ? ["Still passes the current momentum scan"] : ["Does not pass the current momentum scan"]),
        ...(evaluated ? [ordinaryRotationProfitEligible
          ? "Completed-close estimate is at or above average cost"
          : "Ordinary rotation is blocked below average cost"] : []),
        ...(ownership?.reasons ?? []),
        ...(protectedPosition ? ["Protective stop is visible at the broker"] : ["No verified protective stop is visible at the broker"]),
      ],
    };
  });
  const reductionRequired = Math.max(0, roundPrice(Number(budget.deployed ?? 0) - Number(budget.capitalLimit ?? 0)));
  const positionReductionRequired = Math.max(0,
    Number(budget.openPositionCount ?? holdings.length) - Number(budget.maxOpenPositions ?? holdings.length));
  const heldSymbols = new Set(holdings.map((item) => item.symbol));
  const replacements = eligibleQueueCandidates(scan, heldSymbols).slice(0, 5).map((item) => ({
    symbol: item.symbol,
    company: item.company,
    recommendationScore: item.recommendationScore,
    referenceClose: item.referenceClose,
    marketRisk: item.marketRisk?.level ?? null,
    status: "AWAITING_EXIT_FILL_AND_FRESH_QUOTE",
  }));
  const strongestReplacementScore = replacements[0]?.recommendationScore ?? null;
  let plannedRelease = 0;
  let plannedExitCount = 0;
  const rankedExitSymbols = new Set(holdings
    .filter((item) => item.status !== "DATA_UNAVAILABLE"
      && item.status !== "OWNERSHIP_REVIEW"
      && item.ownership === "strategy_owned"
      && item.ordinaryRotationProfitEligible
      && strongestReplacementScore != null
      && (item.recommendationScore == null || strongestReplacementScore > item.recommendationScore))
    .sort((left, right) => Number(left.qualified) - Number(right.qualified)
      || Number(left.protected) - Number(right.protected)
      || (left.recommendationScore ?? -1) - (right.recommendationScore ?? -1))
    .filter((item) => {
      // When fully allocated, identify the weakest profitable holding that a
      // stronger current candidate could replace. When over-allocated, keep
      // selecting profitable ordinary exits until the excess is covered.
      if (reductionRequired <= 0 && positionReductionRequired <= 0) {
        if (plannedRelease > 0) return false;
        plannedRelease = item.estimatedValue;
        plannedExitCount = 1;
        return true;
      }
      if (plannedRelease >= reductionRequired && plannedExitCount >= positionReductionRequired) return false;
      plannedRelease = roundPrice(plannedRelease + item.estimatedValue);
      plannedExitCount += 1;
      return true;
    })
    .map((item) => item.symbol));
  const reviewedHoldings = holdings.map((item) => ({ ...item, recommendedForExit: rankedExitSymbols.has(item.symbol) }));
  return {
    asOf: snapshot.capturedAt ?? null,
    signalDate: scan.selected?.signalDate ?? scan.evaluations?.[0]?.signalDate ?? null,
    reductionRequired,
    positionReductionRequired,
    estimatedPlannedRelease: plannedRelease,
    holdings: reviewedHoldings,
    exitReviews: buildExitReviewCards({
      holdings: reviewedHoldings,
      thesisExits: budget.thesisExits ?? [],
      openTrades: budget.openTrades ?? [],
      at: budget.reviewedAt ?? now(),
    }),
    replacements,
    nextStep: holdings.some((item) => item.status === "OWNERSHIP_REVIEW")
      ? "MANUAL_REVIEW_REQUIRED"
      : rankedExitSymbols.size > 0
      ? "APPROVE_EXIT_SEQUENTIALLY"
      : reductionRequired > 0 || positionReductionRequired > 0
        ? "MANUAL_REVIEW_REQUIRED"
        : "MONITOR_HOLDINGS",
  };
}

function seedProposal(snapshot = null, secResearch = null, candidate = null) {
  const referencePrice = snapshot?.quote?.last ?? snapshot?.quote?.ask ?? snapshot?.quote?.bid ?? snapshot?.quote?.close ?? 183.1;
  const bid = snapshot?.quote?.bid ?? referencePrice;
  const ask = snapshot?.quote?.ask ?? referencePrice;
  const limitPrice = roundPrice(Math.max(ask, referencePrice * 1.002));
  const budget = currentStrategyBudget();
  const aggressivePaperLane = candidate?.sourceLane === "shadow";
  const lanePositionLimit = aggressivePaperLane
    ? Math.min(strategy.perTradeLimit * 0.5, budget.maxPositionValue * 0.5)
    : strategy.perTradeLimit;
  const availableCapital = Math.min(lanePositionLimit, budget.maxPositionValue, budget.available);
  const quantity = Math.min(5, Math.floor(availableCapital / limitPrice));
  const stopDistancePercent = Math.min(8, Math.max(2, (candidate?.atrPercent14 ?? 2) * 1.5));
  const stopPrice = roundPrice(referencePrice * (1 - stopDistancePercent / 100));
  const targetPrice = roundPrice(limitPrice + (limitPrice - stopPrice) * 2);
  const laneLossLimit = (strategy.maxLossPerTrade ?? 75) * (aggressivePaperLane ? 0.5 : 1);
  const riskQuantity = Math.floor(laneLossLimit / Math.max(limitPrice - stopPrice, 0.01));
  const finalQuantity = Math.min(quantity, riskQuantity);
  const proposal = {
    id: randomUUID(),
    environment: "paper",
    agentId: "home-momentum-agent",
    agentName: "Home Momentum Agent",
    broker: brokerName,
    accountId: snapshot?.account ?? "paper-demo",
    symbol: snapshot?.quote?.symbol ?? "NVDA",
    company: candidate?.company ?? companies[snapshot?.quote?.symbol] ?? snapshot?.quote?.symbol ?? "Unknown company",
    assetType: "equity",
    side: "buy",
    quantity: finalQuantity,
    orderType: "limit",
    currentPrice: referencePrice,
    bid,
    ask,
    limitPrice,
    stopPrice,
    targetPrice,
    targetTimeframe: aggressivePaperLane ? "Same day–2 trading days" : strategy.expectedHoldingPeriod,
    exitPolicy: {
      mode: "broker_bracket",
      protectiveStopPrice: stopPrice,
      profitTargetPrice: targetPrice,
      entryTimeInForce: "GTC",
      exitTimeInForce: "GTC",
      automatic: true,
    },
    maxLoss: roundPrice((limitPrice - stopPrice) * finalQuantity),
    quoteDataType: snapshot?.quote?.dataType ?? null,
    marketRisk: candidate?.marketRisk ?? null,
    exposure: exposureProfile(snapshot?.quote?.symbol ?? candidate?.symbol),
    category: candidate?.category ?? "MOMENTUM_CONTINUATION",
    recommendationScore: candidate?.recommendationScore ?? null,
    signalDate: candidate?.signalDate ?? null,
    universeSource: aggressivePaperLane ? "alpaca-aggressive-cache" : "alpaca-cache",
    sourceLane: candidate?.sourceLane ?? "baseline",
    rulesetVersion: candidate?.rulesetVersion ?? null,
    evidenceRunId: candidate?.evidenceRunId ?? null,
    evidenceStatus: candidate?.evidenceStatus ?? "IDENTITY_INCOMPLETE",
    secResearch,
    researchContext: summarizeSecResearch(secResearch),
    rationale: candidate?.checks?.filter((check) => check.passed).map((check) => check.label) ?? [],
    createdAt: now(),
    expiresAt: now() + recommendationTtlMs(candidate),
    status: "pending",
    decisionId: null
  };
  return proposal;
}

function withRecommendationQueueLock(operation) {
  return serializeRecommendationQueue(operation);
}

async function buildRecommendationQueue({ additionalExcludedSymbols = [], mode = "balanced" } = {}) {
  if (strategy.status !== "active") throw new Error("strategy_paused");
  if (!["conservative", "balanced", "growth", "risky"].includes(mode)) throw new Error("invalid_recommendation_mode");
  const requestedLane = mode === "risky" ? "shadow" : "baseline";
  let strategyBudget = currentStrategyBudget();

  // An elapsed quote window does not mean the user rejected the idea. Retire
  // that priced version and let the same still-qualified symbol receive a
  // freshly priced version in this queue build.
  for (const proposal of proposals.values()) {
    if (proposal.status !== "pending" || proposal.expiresAt > now()) continue;
    proposal.status = "replaced";
    ledger().setProposalStatus(proposal.id, "replaced");
    proposalSnapshots.delete(proposal.id);
    auditLog.push({ id: randomUUID(), at: now(), event: "recommendation_price_window_refreshed", proposalId: proposal.id, symbol: proposal.symbol });
  }

  const activeVersions = chooseActiveRecommendationVersions(proposals.values(), now());
  for (const proposal of activeVersions.duplicates) {
    proposal.status = "replaced";
    ledger().setProposalStatus(proposal.id, "replaced");
    proposalSnapshots.delete(proposal.id);
    auditLog.push({ id: randomUUID(), at: now(), event: "duplicate_recommendation_superseded", proposalId: proposal.id, symbol: proposal.symbol });
  }
  const existing = activeVersions.active.filter((proposal) => (proposal.sourceLane ?? "baseline") === requestedLane);

  const scan = requestedLane === "shadow" ? await scanAggressiveDailySignals() : await scanDailyShadowSignals();
  if (!scan.ok) throw new Error(scan.error ?? "scanner_unavailable");
  if (strategyBudget.available <= 0) {
    let snapshot = reconciliations().latest()?.snapshot ?? null;
    try {
      snapshot = (await performReconciliation()).snapshot;
    } catch {
      // Only a still-fresh complete snapshot may support a read-only review.
    }
    if (!snapshot || authoritativePortfolio(snapshot).status !== "COMPLETE") throw new Error("portfolio_review_unavailable");
    strategyBudget = currentStrategyBudget();
    if (strategyBudget.available <= 0) {
      for (const proposal of existing) {
        proposal.status = "blocked";
        ledger().setProposalStatus(proposal.id, "blocked");
        proposalSnapshots.delete(proposal.id);
        auditLog.push({
          id: randomUUID(), at: now(), event: "recommendation_blocked_by_portfolio_policy",
          proposalId: proposal.id, symbol: proposal.symbol, blockers: strategyBudget.blockers ?? [],
        });
      }
      const ownership = positionOwnership(snapshot);
      const evaluatedExits = evaluateAutomaticExits({
        scan,
        snapshot,
        prior: strategy.automaticExitState ?? {},
        requiredFailures: 2,
      });
      strategy.automaticExitState = evaluatedExits.state;
      saveStrategy();
      return {
        recommendations: [],
        strategy: strategySummary(),
        portfolioReview: buildPortfolioReview(scan, snapshot, {
          ...strategyBudget,
          ownership,
          thesisExits: evaluatedExits.exits,
          openTrades: ledger().listTrades(),
          reviewedAt: now(),
        }),
      };
    }
  }
  const excludedSymbols = new Set([
    ...existing.map((proposal) => proposal.symbol),
    ...strategy.completed.filter((item) => item.outcome === "submitted").map((item) => item.symbol),
    ...additionalExcludedSymbols,
  ]);
  const excludedExposures = new Set([
    ...excludedSymbols,
    ...currentPortfolioExposureHoldings().map((item) => item.symbol),
  ].map(canonicalExposureSymbol));
  const candidates = eligibleQueueCandidates(scan, excludedSymbols)
    .filter((candidate) => !excludedExposures.has(canonicalExposureSymbol(candidate.symbol)))
    .filter((candidate) => !wasDeniedForSignal(candidate, strategy.completed));
  const availableCapital = Math.min(strategy.perTradeLimit, strategyBudget.maxPositionValue, strategyBudget.available);
  const affordableCandidates = candidates.filter((candidate) =>
    typeof candidate.referenceClose === "number"
    && candidate.referenceClose > 0
    && candidate.referenceClose * 1.005 <= availableCapital
  );
  if (affordableCandidates.length === 0 && existing.length === 0) throw new Error("strategy_capital_limit");

  const created = [...existing];
  for (const evaluated of affordableCandidates) {
    const snapshot = await ibkrSnapshot(evaluated.symbol);
    const bid = snapshot?.quote?.bid;
    const ask = snapshot?.quote?.ask;
    if (!(typeof bid === "number" && typeof ask === "number" && bid > 0 && ask >= bid)) continue;
    const midpoint = (bid + ask) / 2;
    const spreadPercent = ((ask - bid) / midpoint) * 100;
    if (spreadPercent > maximumBidAskSpreadPercent) continue;
    const evidenceIdentity = resolveProposalEvidenceIdentity(dailyEvidencePath, {
      signalDate: evaluated.signalDate,
      lane: requestedLane,
      symbol: evaluated.symbol,
      rulesetVersion: scan.rulesetVersion,
    });
    const candidate = {
      ...evaluated,
      sourceLane: evidenceIdentity.lane,
      rulesetVersion: evidenceIdentity.rulesetVersion,
      evidenceRunId: evidenceIdentity.evidenceRunId,
      evidenceStatus: evidenceIdentity.evidenceStatus,
      checks: [
        ...evaluated.checks,
        {
          id: "spread",
          label: `Bid/ask spread is no more than ${maximumBidAskSpreadPercent.toFixed(2)}%`,
          passed: true,
          actual: spreadPercent,
        },
      ],
    };
    const secResearch = await getSecCompanyResearch(candidate.symbol).catch(() => null);
    const proposal = seedProposal(snapshot, secResearch, candidate);
    if (proposal.quantity < 1) {
      continue;
    }
    const fit = candidatePortfolioFit(proposal.symbol, proposal.quantity * proposal.limitPrice);
    if (!fit.allowed) {
      auditLog.push({
        id: randomUUID(), at: now(), event: "recommendation_blocked_by_concentration_policy",
        symbol: proposal.symbol, checks: fit.checks,
      });
      continue;
    }
    ledger().recordProposal(proposalLedgerRecord(proposal));
    proposals.set(proposal.id, proposal);
    proposalSnapshots.set(proposal.id, snapshot);
    auditLog.push({ id: randomUUID(), at: now(), event: "proposal_created", proposalId: proposal.id });
    created.push(proposal);
  }
  if (created.length === 0) throw new Error("no_candidate_with_acceptable_spread");
  const recommendations = await Promise.all(created.map(async (proposal) => {
    const broker = proposalSnapshots.get(proposal.id) ?? await ibkrSnapshot(proposal.symbol);
    proposalSnapshots.set(proposal.id, broker);
    return { proposal, broker };
  }));
  auditLog.push({
    id: randomUUID(),
    at: now(),
    event: "recommendation_queue_built",
    proposalIds: recommendations.map(({ proposal }) => proposal.id),
  });
  return {
    recommendations,
    strategy: strategySummary(),
  };
}

function recommendationQueue(options = {}) {
  return withRecommendationQueueLock(() => buildRecommendationQueue(options));
}

async function recalculateRecommendationQueue({ excludedSymbols = [], mode = "balanced" } = {}) {
  return withRecommendationQueueLock(async () => {
    const replacedProposalIds = [];
    for (const proposal of proposals.values()) {
      if (proposal.status !== "pending") continue;
      proposal.status = "replaced";
      ledger().setProposalStatus(proposal.id, "replaced");
      proposalSnapshots.delete(proposal.id);
      replacedProposalIds.push(proposal.id);
    }
    auditLog.push({
      id: randomUUID(),
      at: now(),
      event: "recommendations_recalculation_started",
      replacedProposalIds,
      excludedSymbols,
    });
    return buildRecommendationQueue({ additionalExcludedSymbols: excludedSymbols, mode });
  });
}

async function nextRecommendation() {
  const queue = await recommendationQueue();
  const first = queue.recommendations[0];
  return { proposal: first.proposal, broker: first.broker, strategy: queue.strategy };
}

function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type,x-app-token",
    "access-control-allow-methods": "GET,POST,OPTIONS"
  });
  response.end(JSON.stringify(body));
}

function authorized(request) {
  if (!appToken) return host === "127.0.0.1" || host === "::1";
  const provided = request.headers["x-app-token"];
  if (typeof provided !== "string") return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(appToken);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function runIbkrSnapshot(symbol = "NVDA") {
  const normalized = symbol.toUpperCase();
  if (!/^[A-Z0-9]{1,10}$/.test(normalized)) throw new Error("invalid_symbol");
  if (simulatedBroker) {
    return {
      ...simulatedBroker.snapshot(),
      quote: { symbol: normalized, bid: 99.9, ask: 100, last: 100, close: 100, dataType: "simulated" },
    };
  }
  if (brokerMode === "alpaca") return alpacaSnapshot(normalized);
  const { stdout } = await execFileAsync(ibkrPython, [ibkrSnapshotScript, normalized], {
    timeout: 20_000,
    maxBuffer: 128 * 1024,
  });
  return JSON.parse(stdout);
}

// Serialize broker reads so a health poll cannot collide with an
// approval-time price/safety check or overload the selected adapter.
let snapshotQueue = Promise.resolve();
let benchmarkCache = null;
function ibkrSnapshot(symbol = "NVDA") {
  const request = snapshotQueue.then(() => runIbkrSnapshot(symbol));
  snapshotQueue = request.catch(() => undefined);
  return request;
}

async function benchmarkQuote() {
  if (benchmarkCache && now() - benchmarkCache.capturedAt < 60_000) return benchmarkCache.quote;
  try {
    const snapshot = await ibkrSnapshot("QQQ");
    benchmarkCache = { capturedAt: now(), quote: snapshot.quote ?? null };
    return benchmarkCache.quote;
  } catch {
    return benchmarkCache?.quote ?? null;
  }
}

let reconciliationQueue = Promise.resolve();
function ibkrReconciliation() {
  const request = reconciliationQueue.then(async () => {
    if (simulatedBroker) return simulatedBroker.snapshot();
    if (brokerMode === "alpaca") return alpacaReconciliation();
    try {
      const { stdout } = await execFileAsync(ibkrPython, [ibkrReconciliationScript], {
        timeout: 35_000,
        maxBuffer: 1024 * 1024,
      });
      return JSON.parse(stdout);
    } catch (error) {
      const output = error.stdout?.trim();
      if (output) return JSON.parse(output);
      throw error;
    }
  });
  reconciliationQueue = request.catch(() => undefined);
  return request;
}

function knownDecisionPrefixes() {
  return [...proposals.values()]
    .map((proposal) => proposal.decisionId?.slice(0, 12))
    .filter(Boolean);
}

async function performReconciliation() {
  try {
    const snapshot = await ibkrReconciliation();
    if (!snapshot.ok || !snapshot.complete) {
      const error = new Error(snapshot.error ?? "broker_reconciliation_incomplete");
      error.snapshot = snapshot;
      throw error;
    }
    const result = reconciliations().record(snapshot, { knownDecisionPrefixes: knownDecisionPrefixes() });
    const linkedOrders = reconcileSnapshotToLedger(snapshot, ledger());
    const transition = connectionSupervisor.success(snapshot.capturedAt ?? now());
    recordLedgerEvent({
      event: "broker_reconciliation_completed",
      eventKey: `reconciliation:${result.runId}`,
      portfolioStatus: result.portfolio.status,
      externalActivityCount: result.activity.filter((item) => item.ownership === "external").length,
      linkedOrderCount: linkedOrders.length,
    });
    if (transition) auditLog.push({ id: randomUUID(), event: "broker_connection_changed", ...transition });
    return { snapshot, result, linkedOrders };
  } catch (error) {
    const transition = connectionSupervisor.failure(error.message, now());
    if (transition) auditLog.push({ id: randomUUID(), event: "broker_connection_changed", ...transition });
    throw error;
  }
}

async function automaticPaperExitCycle(snapshot) {
  if (!automaticPaperSellsEnabled || brokerMode !== "ibkr" || snapshot.environment !== "paper" || snapshot.readOnly !== true) return [];
  const ownership = positionOwnership(snapshot);
  // The feature flag alone must not turn a ticker match into sale authority.
  if (!ownership.ownershipComplete || ownership.items.some((item) => item.ownership !== "strategy_owned" || item.protection !== "verified")) return [];
  const scan = await scanDailyShadowSignals();
  if (!scan.ok) return [];
  const evaluated = evaluateAutomaticExits({
    scan,
    snapshot,
    prior: strategy.automaticExitState ?? {},
    requiredFailures: 2,
  });
  strategy.automaticExitState = evaluated.state;
  saveStrategy();
  const submitted = [];
  for (const exit of evaluated.exits) {
    const owned = ownership.items.find((item) => item.symbol === exit.symbol);
    if (!owned || owned.strategyOwnedQuantity !== exit.quantity || owned.protection !== "verified") continue;
    const quote = await ibkrSnapshot(exit.symbol);
    const assessed = assessAutomaticExitQuote(quote, { maxSpreadPercent: maximumBidAskSpreadPercent });
    if (!assessed.ok) {
      auditLog.push({ id: randomUUID(), at: now(), event: "automatic_paper_exit_blocked", symbol: exit.symbol,
        signalDate: exit.signalDate, reason: assessed.reason });
      continue;
    }
    const { bid } = assessed;
    const decisionId = randomUUID();
    const sellOrders = (snapshot.openOrders ?? [])
      .filter((order) => order.symbol === exit.symbol && order.action === "SELL" && ["Submitted", "PreSubmitted"].includes(order.status))
    const linkedIds = new Set(ledger().listPositions().filter((item) => item.symbol === exit.symbol && item.accountId === snapshot.account)
      .flatMap((item) => ledger().listBrokerOrders(item.id))
      .filter((order) => ["protective_stop", "profit_target"].includes(order.role))
      .map((order) => String(order.brokerOrderId)));
    if (sellOrders.some((order) => !linkedIds.has(String(order.permanentId ?? order.orderId)))) continue;
    const cancelOrderIds = sellOrders.map((order) => order.orderId);
    // Do not remove a verified stop before a replacement sale is accepted.
    // The current adapter has no safe atomic cancel/replace lifecycle.
    if (cancelOrderIds.length > 0) {
      auditLog.push({ id: randomUUID(), at: now(), event: "automatic_paper_exit_blocked", symbol: exit.symbol,
        signalDate: exit.signalDate, reason: "unsafe_cancel_replace_not_supported" });
      continue;
    }
    const request = {
      account: snapshot.account,
      symbol: exit.symbol,
      action: "SELL",
      quantity: exit.quantity,
      limitPrice: roundPrice(bid * 0.998),
      decisionId,
      cancelOrderIds,
    };
    try {
      const { stdout } = await execFileAsync(ibkrPython, [ibkrPaperExitScript, JSON.stringify(request)], { timeout: 35_000, maxBuffer: 128 * 1024 });
      const result = JSON.parse(stdout);
      if (!result.ok) continue;
      strategy.automaticExitState.submitted[exit.symbol] = exit.signalDate;
      strategy.completed.push({ proposalId: `automatic-exit:${decisionId}`, symbol: exit.symbol, side: "sell", quantity: exit.quantity, limitPrice: request.limitPrice, signalDate: exit.signalDate, outcome: "submitted", reason: exit.reason, at: now() });
      saveStrategy();
      auditLog.push({ id: randomUUID(), at: now(), event: "automatic_paper_exit_submitted", symbol: exit.symbol, quantity: exit.quantity, signalDate: exit.signalDate, brokerOrderId: result.result?.orderId ?? null });
      submitted.push(result);
    } catch (error) {
      auditLog.push({ id: randomUUID(), at: now(), event: "automatic_paper_exit_failed", symbol: exit.symbol, signalDate: exit.signalDate, error: error.message });
    }
  }
  return submitted;
}

function reconciliationDelay(snapshot) {
  if ((snapshot?.openOrders?.length ?? 0) > 0) return 5_000;
  if ((snapshot?.positions?.length ?? 0) > 0) return 15_000;
  return 60_000;
}

function scheduleReconciliation(delay = 1_000) {
  if (!reconciliationEnabled) return;
  const timer = setTimeout(async () => {
    let nextDelay = 60_000;
    try {
      const { snapshot } = await performReconciliation();
      const executionIds = new Set((snapshot.executions ?? [])
        .map((execution) => String(execution.executionId ?? ""))
        .filter(Boolean));
      const newFillObserved = observedBrokerExecutionIds !== null
        && [...executionIds].some((identity) => !observedBrokerExecutionIds.has(identity));
      observedBrokerExecutionIds = executionIds;
      await automaticPaperExitCycle(snapshot);
      if (newFillObserved) {
        try {
          await recalculateRecommendationQueue();
          auditLog.push({ id: randomUUID(), at: now(), event: "recommendations_recalculated_after_fill" });
        } catch (error) {
          auditLog.push({ id: randomUUID(), at: now(), event: "post_fill_recalculation_failed", error: error.message });
        }
      }
      nextDelay = reconciliationDelay(snapshot);
    } catch {
      nextDelay = 60_000;
    }
    scheduleReconciliation(nextDelay);
  }, delay);
  timer.unref();
}

async function ibkrWhatIf(receipt) {
  const request = {
    account: receipt.accountId,
    symbol: receipt.symbol,
    action: receipt.side.toUpperCase(),
    quantity: receipt.quantity,
    limitPrice: receipt.limitPrice,
  };
  if (simulatedBroker) {
    return {
      ok: simulatedBroker.connected,
      environment: "paper",
      account: simulatedBroker.account,
      symbol: receipt.symbol,
      quantity: receipt.quantity,
      estimatedCommission: 1,
      warnings: [],
      errors: [],
    };
  }
  if (brokerMode === "alpaca") return alpacaPreflight(receipt);
  try {
    const { stdout } = await execFileAsync(ibkrPython, [ibkrWhatIfScript, JSON.stringify(request)], {
      timeout: 20_000,
      maxBuffer: 128 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) {
    const output = error.stdout?.trim();
    if (output) return JSON.parse(output);
    throw error;
  }
}

async function ibkrPaperSubmit(receipt) {
  const request = {
    account: receipt.accountId,
    symbol: receipt.symbol,
    action: receipt.side.toUpperCase(),
    quantity: receipt.quantity,
    limitPrice: receipt.limitPrice,
    stopPrice: receipt.stopPrice,
    targetPrice: receipt.targetPrice,
    decisionId: receipt.decisionId,
  };
  if (simulatedBroker) {
    const ids = simulatedBroker.submitBracket({
      symbol: receipt.symbol,
      quantity: receipt.quantity,
      limitPrice: receipt.limitPrice,
      stopPrice: receipt.stopPrice,
      targetPrice: receipt.targetPrice,
      decisionId: receipt.decisionId,
    });
    simulatedBroker.accept(ids.entryId);
    if (simulatedDisconnectAfterSubmit) {
      simulatedDisconnectAfterSubmit = false;
      simulatedBroker.disconnect();
      throw new Error("simulated_disconnect_after_transmission");
    }
    const values = [ids.entryId, ids.targetId, ids.stopId].map((id) => simulatedBroker.orders.get(id));
    const normalize = (order) => ({
      orderId: order.orderId,
      permanentId: order.permanentId,
      parentId: order.parentId,
      status: order.status,
      filled: order.filled,
      remaining: order.remaining,
      orderRef: order.orderRef,
      symbol: order.symbol,
    });
    return {
      ok: true,
      environment: "paper",
      account: simulatedBroker.account,
      symbol: receipt.symbol,
      action: "BUY",
      quantity: receipt.quantity,
      limitPrice: receipt.limitPrice,
      stopPrice: receipt.stopPrice,
      targetPrice: receipt.targetPrice,
      result: normalize(values[0]),
      exitOrders: [normalize(values[1]), normalize(values[2])],
      errors: [],
      warnings: [],
    };
  }
  if (brokerMode === "alpaca") return alpacaSubmitBracket(receipt);
  try {
    const { stdout } = await execFileAsync(ibkrPython, [ibkrPaperSubmitScript, JSON.stringify(request)], {
      timeout: 20_000,
      maxBuffer: 128 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) {
    const output = error.stdout?.trim();
    if (output) return JSON.parse(output);
    throw error;
  }
}

function approvalReceipt(proposal) {
  const receipt = {
    decisionId: randomUUID(),
    proposalId: proposal.id,
    environment: "paper",
    broker: proposal.broker,
    accountId: proposal.accountId,
    symbol: proposal.symbol,
    side: proposal.side,
    quantity: proposal.quantity,
    orderType: proposal.orderType,
    limitPrice: proposal.limitPrice,
    stopPrice: proposal.stopPrice,
    targetPrice: proposal.targetPrice,
    exitPolicy: proposal.exitPolicy,
    approvedAt: now(),
    expiresAt: Math.min(proposal.expiresAt, now() + 60_000)
  };
  const payload = Buffer.from(JSON.stringify(receipt)).toString("base64url");
  const signature = createHmac("sha256", signingSecret).update(payload).digest("base64url");
  return { receipt, token: `${payload}.${signature}` };
}

export function verifyApprovalToken(token) {
  const [payload, provided] = token.split(".");
  if (!payload || !provided) return null;
  const expected = createHmac("sha256", signingSecret).update(payload).digest("base64url");
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  const receipt = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  return receipt.environment === "paper" && receipt.expiresAt > now() ? receipt : null;
}

async function route(request, response) {
  if (request.method === "OPTIONS") return json(response, 204, {});
  if (!authorized(request)) return json(response, 401, { error: "unauthorized" });
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/health") {
    const latest = reconciliations().latest();
    const reconciliationStatus = latest?.status === "COMPLETE"
      ? authoritativePortfolio(latest.snapshot).status === "COMPLETE" ? "COMPLETE" : "STALE"
      : latest?.status ?? "not_started";
    return json(response, 200, { ok: true, environment: "paper", brokerMode, paused,
      brokerConnection: connectionSupervisor.snapshot(),
      automaticPaperSellsEnabled, automaticPaperSellsRequested,
      automaticPaperSellsBlocker: automaticExitReleaseReady ? null : "protected_exit_lifecycle_not_ready",
      reconciliation: {
      enabled: reconciliationEnabled, status: reconciliationStatus, capturedAt: latest?.capturedAt ?? null,
    } });
  }

  if (request.method === "GET" && url.pathname === "/research/news") {
    let symbol;
    try { symbol = stockNewsSymbol(url.searchParams.get("symbol")); }
    catch { return json(response, 400, { error: "invalid_symbol" }); }
    const news = await getStockNews(symbol);
    return json(response, news.status === "unavailable" ? 503 : 200, news);
  }

  if (request.method === "GET" && url.pathname === "/research/strategy-comparison") {
    try {
      const report = JSON.parse(readFileSync(strategyComparisonPath, "utf8"));
      return json(response, 200, report);
    } catch {
      return json(response, 503, {
        error: "strategy_comparison_unavailable", classification: "research_only",
        recommendationAuthority: false, orderSubmissionAllowed: false,
      });
    }
  }

  if (request.method === "GET" && url.pathname === "/research/news-health") {
    return json(response, 200, { researchOnly: true, rankingAdjustmentAllowed: false,
      orderSubmissionAllowed: false, ...newsJournal().status() });
  }

  if (request.method === "GET" && url.pathname === "/research/news-feed") {
    const rawSymbol = url.searchParams.get("symbol");
    let symbol = null;
    if (rawSymbol) {
      try { symbol = stockNewsSymbol(rawSymbol); }
      catch { return json(response, 400, { error: "invalid_symbol" }); }
    }
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 30));
    if (symbol) return json(response, 200, durableNewsResearch(symbol, limit));
    return json(response, 200, { status: "available", researchOnly: true, rankingAdjustmentAllowed: false,
      orderSubmissionAllowed: false, events: newsJournal().listRecent({ limit }) });
  }

  if (request.method === "GET" && url.pathname === "/proposals") {
    const items = [...proposals.values()].map((proposal) =>
      proposal.status === "pending" && proposal.expiresAt <= now()
        ? (() => {
            expireProposal(proposal);
            return proposal;
          })()
        : proposal
    );
    return json(response, 200, { paused, proposals: items });
  }

  if (request.method === "GET" && url.pathname === "/strategy") {
    return json(response, 200, { strategy: strategySummary() });
  }

  if (request.method === "GET" && url.pathname === "/strategy/modes") {
    return json(response, 200, {
      activeMode: "core_momentum",
      modes: [
        {
          id: "core_momentum", name: strategy.name, riskTier: "ELEVATED",
          expectedHoldingPeriod: strategy.expectedHoldingPeriod,
          environment: "paper", recommendationAllowed: true,
          orderSubmissionAllowed: paperSubmitEnabled,
        },
        CATALYST_SPRINT_MODE,
      ],
    });
  }

  if (request.method === "POST" && url.pathname === "/research/modes/catalyst-sprint/evaluate") {
    const input = await body(request);
    return json(response, 200, evaluateCatalystSprint(input));
  }

  if (request.method === "GET" && url.pathname === "/risk-policy") {
    return json(response, 200, readRiskPolicy());
  }

  if (request.method === "POST" && url.pathname === "/risk-policy") {
    const input = await body(request);
    if (!validateRiskPolicy(input.policy)) return json(response, 400, { error: "invalid_risk_policy" });
    const record = saveRiskPolicy(input.policy);
    auditLog.push({ id: randomUUID(), at: now(), event: "risk_policy_saved", version: record.version });
    return json(response, 200, record);
  }

  if (request.method === "GET" && url.pathname === "/audit") {
    return json(response, 200, { events: [...auditLog].reverse() });
  }

  if (request.method === "GET" && url.pathname === "/activity") {
    const applicationItems = ledger().listActivity({ limit: url.searchParams.get("limit") });
    const externalItems = reconciliations().listActivity().filter((item) => item.ownership === "external").map((item) => ({
      id: `external:${item.type}:${item.brokerIdentity}`,
      symbol: item.symbol ?? "—", company: item.symbol ?? "—", side: item.payload?.action ?? item.payload?.side ?? "external",
      status: item.type === "execution" ? "Filled outside app" : item.payload?.status ?? "External order",
      occurredAt: item.lastSeenAt, quantity: item.payload?.quantity ?? null,
      limitPrice: item.payload?.limitPrice ?? item.payload?.price ?? null,
      environment: "paper", brokerOrderId: item.brokerIdentity,
    }));
    return json(response, 200, { items: [...applicationItems, ...externalItems].sort((a, b) => b.occurredAt - a.occurredAt) });
  }

  if (request.method === "GET" && url.pathname === "/trades") {
    return json(response, 200, { items: ledger().listTrades() });
  }

  if (request.method === "GET" && url.pathname === "/positions") {
    const latest = reconciliations().latest();
    if (latest) {
      const portfolio = authoritativePortfolio(latest.snapshot);
      if (portfolio.status === "COMPLETE") {
        const ownership = positionOwnership(latest.snapshot);
        const ownershipBySymbol = new Map(ownership.items.map((item) => [item.symbol, item]));
        return json(response, 200, { items: portfolio.positions.map((position) => ({
          ...(ownershipBySymbol.get(position.symbol) ?? {}),
          id: `${brokerMode}:${position.contractId ?? position.symbol}`, symbol: position.symbol,
          quantity: position.quantity, averageEntryPrice: position.averageCost, currentPrice: null,
          protectiveStopPrice: ownershipBySymbol.get(position.symbol)?.protectiveStopPrice ?? null,
          profitTargetPrice: null, updatedAt: portfolio.asOf,
          dataState: "reconciled",
        })), reconciled: true, ownershipComplete: ownership.ownershipComplete,
          missingBrokerPositions: ownership.missingBrokerPositions, asOf: portfolio.asOf });
      }
    }
    return json(response, 200, {
      items: ledger().listPositions(),
      reconciled: false,
      message: `Positions reflect recorded fills only until ${brokerName} reconciliation is connected.`,
    });
  }

  if (request.method === "GET" && url.pathname === "/performance") {
    const latest = reconciliations().latest();
    if (!latest?.snapshot?.complete) {
      return json(response, 503, { error: "reconciliation_required" });
    }
    const ownership = positionOwnership(latest.snapshot);
    const performance = buildCurrentPerformance({
      snapshot: latest.snapshot,
      ownership,
      trades: ledger().listTrades(),
      benchmarkQuote: await benchmarkQuote(),
    });
    return json(response, 200, performance);
  }

  if (request.method === "GET" && url.pathname === "/shadow/signals") {
    return json(response, 200, readShadowLedger());
  }

  if (request.method === "GET" && url.pathname === "/shadow/aggressive") {
    try {
      const { stdout } = await execFileAsync(ibkrPython, [aggressiveShadowScannerScript, "scan"], {
        timeout: 180_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      const scan = JSON.parse(stdout);
      return json(response, scan.ok ? 200 : 503, scan);
    } catch (error) {
      return json(response, 503, { ok: false, mode: "aggressive_shadow", orderSubmissionAllowed: false,
        error: "aggressive_shadow_unavailable" });
    }
  }

  if (request.method === "POST" && url.pathname === "/shadow/scan") {
    try {
      const scan = await scanDailyShadowSignals();
      const signal = recordShadowScan(scan);
      auditLog.push({
        id: randomUUID(),
        at: now(),
        event: scan.ok ? "shadow_scan_completed" : "shadow_scan_unavailable",
        signalId: signal?.id ?? null,
        qualifiedCount: scan.qualifiedCount ?? 0,
      });
      return json(response, scan.ok ? 200 : 503, { scan, signal });
    } catch (error) {
      return json(response, 503, { error: "shadow_scan_unavailable", detail: error.message });
    }
  }

  if (request.method === "GET" && url.pathname === "/broker/snapshot") {
    try {
      return json(response, 200, await ibkrSnapshot(url.searchParams.get("symbol") ?? "NVDA"));
    } catch (error) {
      return json(response, 503, {
        ok: false,
        environment: "paper",
        readOnly: true,
        error: error.message === "invalid_symbol" ? error.message : "broker_unavailable",
      });
    }
  }

  if (request.method === "POST" && url.pathname === "/broker/reconcile") {
    try {
      const { result, linkedOrders } = await performReconciliation();
      return json(response, 200, { ok: true, ...result, linkedOrders });
    } catch (error) {
      return json(response, 503, { ok: false, error: "broker_reconciliation_unavailable", detail: error.message });
    }
  }

  if (request.method === "GET" && url.pathname === "/broker/portfolio") {
    const latest = reconciliations().latest();
    if (!latest) return json(response, 404, { ok: false, error: "no_reconciliation_snapshot" });
    const portfolio = authoritativePortfolio(latest.snapshot);
    const ownership = portfolio.status === "COMPLETE" ? positionOwnership(latest.snapshot) : null;
    return json(response, portfolio.status === "COMPLETE" ? 200 : 409, {
      ok: portfolio.status === "COMPLETE",
      reconciliationRunId: latest.id,
      portfolio,
      ownership,
      brokerActivity: reconciliations().listActivity(),
    });
  }

  if (request.method === "GET" && url.pathname === "/research/sec") {
    try {
      const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
      const research = await getSecCompanyResearch(symbol);
      if (!research) return json(response, 404, { error: "sec_symbol_unsupported" });
      return json(response, 200, { research });
    } catch (error) {
      return json(response, 503, { error: error.message ?? "sec_research_unavailable" });
    }
  }

  if (request.method === "POST" && url.pathname === "/proposals/demo") {
    try {
      return json(response, 201, await nextRecommendation());
    } catch (error) {
      return json(response, 503, { error: error.message ?? "recommendation_unavailable" });
    }
  }

  if (brokerMode === "simulated" && request.method === "POST" && url.pathname === "/__test/proposals") {
    const input = await body(request);
    const symbol = typeof input.symbol === "string" ? input.symbol.toUpperCase() : "NVDA";
    const snapshot = await ibkrSnapshot(symbol);
    const proposal = seedProposal(snapshot, null, {
      symbol,
      company: `${symbol} Test Company`,
      atrPercent14: 2,
      category: "TEST_SCENARIO",
      recommendationScore: 100,
      signalDate: "2099-01-01",
      checks: [{ id: "test", label: "Deterministic test candidate", passed: true }],
    });
    ledger().recordProposal(proposalLedgerRecord(proposal));
    proposals.set(proposal.id, proposal);
    proposalSnapshots.set(proposal.id, snapshot);
    return json(response, 201, { proposal, broker: snapshot });
  }

  if (brokerMode === "simulated" && request.method === "POST" && url.pathname === "/__test/broker-events") {
    const input = await body(request);
    try {
      if (input.type === "fill") simulatedBroker.fill(Number(input.orderId), Number(input.quantity), Number(input.price), { commission: Number(input.commission ?? 0) });
      else if (input.type === "reject") simulatedBroker.reject(Number(input.orderId), input.reason);
      else if (input.type === "cancel") simulatedBroker.cancel(Number(input.orderId), input.reason);
      else if (input.type === "disconnect") simulatedBroker.disconnect();
      else if (input.type === "reconnect") simulatedBroker.reconnect();
      else if (input.type === "disconnect_after_submit") simulatedDisconnectAfterSubmit = true;
      else if (input.type === "external_order") simulatedBroker.addExternalOrder(input);
      else if (input.type === "remove_order") simulatedBroker.removeOrder(Number(input.orderId));
      else if (input.type === "advance") simulatedBroker.advance(Number(input.milliseconds ?? 1));
      else return json(response, 400, { error: "invalid_simulated_event" });
      return json(response, 200, { ok: true, snapshot: simulatedBroker.snapshot() });
    } catch (error) {
      return json(response, 409, { error: error.message });
    }
  }


  if (request.method === "POST" && url.pathname === "/recommendations/next") {
    try {
      return json(response, 201, await nextRecommendation());
    } catch (error) {
      return json(response, 503, { error: error.message ?? "recommendation_unavailable" });
    }
  }

  if (request.method === "POST" && url.pathname === "/recommendations/queue") {
    try {
      const input = await body(request);
      return json(response, 201, await recommendationQueue({ mode: input.mode ?? "balanced" }));
    } catch (error) {
      return json(response, 503, { error: error.message ?? "recommendation_queue_unavailable" });
    }
  }

  if (request.method === "POST" && url.pathname === "/protection/repair-paper") {
    if (brokerMode !== "alpaca") return json(response, 409, { error: "alpaca_paper_required" });
    try {
      const snapshot = await alpacaReconciliation();
      reconcileSnapshotToLedger(snapshot, ledger());
      const ownership = reconcilePositionOwnership(snapshot, ledger(), { historicalEvidence: loadHistoricalEvidence(historicalEvidencePath) });
      const requested = await body(request);
      const requestedSymbols = Array.isArray(requested.symbols)
        ? new Set(requested.symbols.map((symbol) => String(symbol).toUpperCase())) : null;
      const results = [];
      for (const position of ledger().listPositions()) {
        if (requestedSymbols && !requestedSymbols.has(position.symbol)) continue;
        const evidence = ownership.items.find((item) => item.symbol === position.symbol);
        if (!evidence || evidence.ownership !== "strategy_owned" || evidence.protection !== "missing"
          || evidence.strategyOwnedQuantity !== position.quantity) {
          results.push({ symbol: position.symbol, ok: false, error: "position_not_verified_for_repair" });
          continue;
        }
        const proposal = ledger().getProposal(position.id);
        const decision = ledger().getDecisionForProposal(position.id);
        const targetPrice = Number(proposal?.terms?.targetPrice);
        const stopPrice = Number(proposal?.terms?.stopPrice);
        if (!decision || !(targetPrice > 0) || !(stopPrice > 0)) {
          results.push({ symbol: position.symbol, ok: false, error: "recorded_exit_terms_unavailable" });
          continue;
        }
        const quote = await alpacaSnapshot(position.symbol);
        const bid = Number(quote.quote?.bid);
        const ask = Number(quote.quote?.ask);
        if (!(stopPrice < bid && targetPrice > ask)) {
          results.push({ symbol: position.symbol, ok: false, error: "recorded_exit_terms_not_market_safe", bid, ask, stopPrice, targetPrice });
          continue;
        }
        const submission = await alpacaSubmitProtectionOco({
          decisionId: decision.id, accountId: snapshot.account, symbol: position.symbol,
          quantity: position.quantity, targetPrice, stopPrice,
        });
        if (submission.ok) {
          const attempt = ledger().listSubmissionAttemptsForDecision(decision.id)[0] ?? null;
          for (const [role, order] of [["profit_target", submission.target], ["protective_stop", submission.stop]]) {
            ledger().recordBrokerOrder({ proposalId: proposal.id, submissionAttemptId: attempt?.id ?? null,
              broker: "Alpaca", accountId: snapshot.account, brokerOrderId: order.permanentId ?? order.orderId,
              parentBrokerOrderId: order.parentId ?? null, role, status: order.status, order });
          }
        }
        results.push({ symbol: position.symbol, ok: submission.ok, error: submission.error ?? null,
          targetOrderId: submission.target?.orderId ?? null, stopOrderId: submission.stop?.orderId ?? null });
      }
      const refreshed = await alpacaReconciliation();
      reconcileSnapshotToLedger(refreshed, ledger());
      reconciliations().record(refreshed, { knownDecisionPrefixes: knownDecisionPrefixes() });
      const refreshedOwnership = reconcilePositionOwnership(refreshed, ledger(), { historicalEvidence: loadHistoricalEvidence(historicalEvidencePath) });
      return json(response, results.every((item) => item.ok) && refreshedOwnership.protectionComplete ? 200 : 409,
        { ok: results.every((item) => item.ok) && refreshedOwnership.protectionComplete, results,
          protectionComplete: refreshedOwnership.protectionComplete,
          gaps: refreshedOwnership.items.filter((item) => item.ownership === "strategy_owned" && item.protection !== "verified").map((item) => item.symbol) });
    } catch (error) {
      return json(response, 503, { ok: false, error: error.message ?? "protection_repair_failed" });
    }
  }

  if (request.method === "POST" && url.pathname === "/pause") {
    const input = await body(request);
    paused = Boolean(input.paused);
    auditLog.push({ id: randomUUID(), at: now(), event: paused ? "agents_paused" : "agents_resumed" });
    return json(response, 200, { paused });
  }

  if (request.method === "POST" && url.pathname === "/orders/preview") {
    const input = await body(request);
    const receipt = typeof input.token === "string" ? verifyApprovalToken(input.token) : null;
    if (!receipt) return json(response, 401, { error: "invalid_or_expired_approval" });

    const proposal = proposals.get(receipt.proposalId);
    if (!proposal || proposal.status !== "approved") {
      return json(response, 409, { error: "proposal_not_approved" });
    }
    if (proposal.decisionId !== receipt.decisionId) {
      return json(response, 409, { error: "approval_does_not_match_proposal" });
    }

    try {
      const snapshot = await ibkrSnapshot(receipt.symbol);
      const referencePrice = snapshot.quote.ask ?? snapshot.quote.last ?? snapshot.quote.close;
      const checks = {
        paperEnvironment: receipt.environment === "paper" && snapshot.environment === "paper",
        readOnlyConnection: snapshot.readOnly === true,
        accountMatch: snapshot.account === receipt.accountId,
        proposalMatch:
          proposal.symbol === receipt.symbol &&
          proposal.side === receipt.side &&
          proposal.quantity === receipt.quantity &&
          proposal.limitPrice === receipt.limitPrice &&
          proposal.stopPrice === receipt.stopPrice &&
          proposal.targetPrice === receipt.targetPrice,
        buyOnly: receipt.side === "buy",
        bracketValid:
          receipt.exitPolicy?.mode === "broker_bracket" &&
          receipt.exitPolicy?.automatic === true &&
          receipt.stopPrice > 0 &&
          receipt.stopPrice < receipt.limitPrice &&
          receipt.targetPrice > receipt.limitPrice,
        notExpired: receipt.expiresAt > now(),
        withinLimit:
          typeof referencePrice === "number" &&
          (receipt.side === "buy" ? referencePrice <= receipt.limitPrice : referencePrice >= receipt.limitPrice),
      };
      const ready = Object.values(checks).every(Boolean);
      if (ready) previewPassed.add(receipt.decisionId);
      const preview = {
        environment: "paper",
        broker: brokerName,
        account: snapshot.account,
        action: receipt.side.toUpperCase(),
        symbol: receipt.symbol,
        quantity: receipt.quantity,
        orderType: receipt.orderType.toUpperCase(),
        limitPrice: receipt.limitPrice,
        protectiveStop: receipt.stopPrice,
        profitTarget: receipt.targetPrice,
        automatedExits: true,
        timeInForce: "GTC",
        estimatedNotional: roundPrice(receipt.quantity * receipt.limitPrice),
        referencePrice,
        approvalExpiresAt: receipt.expiresAt,
        checks,
        ready,
        submitted: false,
      };
      auditLog.push({
        id: randomUUID(),
        at: now(),
        event: ready ? "order_preview_ready" : "order_preview_blocked",
        proposalId: proposal.id,
        decisionId: receipt.decisionId,
      });
      recordLedgerEvent({
        at: now(),
        event: ready ? "order_preview_ready" : "order_preview_blocked",
        eventKey: `preview:${receipt.decisionId}:${ready ? "ready" : "blocked"}`,
        proposalId: proposal.id,
        decisionId: receipt.decisionId,
        checks,
      });
      return json(response, ready ? 200 : 409, { preview });
    } catch {
      return json(response, 503, { error: "broker_unavailable" });
    }
  }

  if (request.method === "POST" && url.pathname === "/orders/what-if") {
    if (!whatIfEnabled) return json(response, 503, { error: "what_if_disabled" });
    const input = await body(request);
    const receipt = typeof input.token === "string" ? verifyApprovalToken(input.token) : null;
    if (!receipt) return json(response, 401, { error: "invalid_or_expired_approval" });
    const proposal = proposals.get(receipt.proposalId);
    if (!proposal || proposal.status !== "approved" || proposal.decisionId !== receipt.decisionId) {
      return json(response, 409, { error: "approval_does_not_match_proposal" });
    }
    const result = await ibkrWhatIf(receipt);
    if (result.ok) whatIfPassed.add(receipt.decisionId);
    auditLog.push({
      id: randomUUID(),
      at: now(),
      event: result.ok ? "broker_preflight_passed" : "broker_preflight_blocked",
      proposalId: proposal.id,
      decisionId: receipt.decisionId,
    });
    recordLedgerEvent({
      at: now(),
      event: result.ok ? "broker_preflight_passed" : "broker_preflight_blocked",
      eventKey: `what-if:${receipt.decisionId}:${result.ok ? "passed" : "blocked"}`,
      proposalId: proposal.id,
      decisionId: receipt.decisionId,
      result,
    });
    return json(response, result.ok ? 200 : 409, { whatIf: result });
  }

  if (request.method === "POST" && url.pathname === "/orders/submit-paper") {
    if (!paperSubmitEnabled) return json(response, 503, { error: "paper_submit_disabled" });
    if (paused) return json(response, 409, { error: "agents_paused" });
    const input = await body(request);
    const receipt = typeof input.token === "string" ? verifyApprovalToken(input.token) : null;
    if (!receipt) return json(response, 401, { error: "invalid_or_expired_approval" });
    const proposal = proposals.get(receipt.proposalId);
    if (!proposal || proposal.decisionId !== receipt.decisionId) {
      return json(response, 409, { error: "approval_does_not_match_proposal" });
    }
    const idempotencyKey = `paper:${receipt.decisionId}`;
    const existingAttempt = ledger().getSubmissionByIdempotencyKey(idempotencyKey);
    if (existingAttempt) {
      if (existingAttempt.status === "submitted") {
        return json(response, 200, {
          submission: existingAttempt.response?.submission ?? existingAttempt.response,
          replayed: true,
        });
      }
      return json(response, 409, {
        error: existingAttempt.status === "unknown"
          ? "submission_outcome_unknown_reconciliation_required"
          : "approval_already_used",
        attempt: existingAttempt,
      });
    }
    if (proposal.status !== "approved") {
      return json(response, 409, { error: "proposal_not_approved" });
    }
    if (!previewPassed.has(receipt.decisionId) || !whatIfPassed.has(receipt.decisionId)) {
      return json(response, 409, { error: "preview_and_what_if_required" });
    }
    let submissionAttempt = null;
    try {
      const snapshot = await ibkrSnapshot(receipt.symbol);
      const referencePrice = snapshot.quote.ask ?? snapshot.quote.last ?? snapshot.quote.close;
      const currentBudget = currentStrategyBudget();
      const portfolioFit = candidatePortfolioFit(receipt.symbol, receipt.quantity * receipt.limitPrice);
      const safetyChecks = {
        paperEnvironment: receipt.environment === "paper" && snapshot.environment === "paper",
        accountMatch: snapshot.account === receipt.accountId,
        approvalFresh: receipt.expiresAt > now(),
        strategyUniverseApproved:
          proposal.universeSource === "alpaca-cache" && proposal.symbol === receipt.symbol,
        buyOnly: receipt.side === "buy",
        quantityAllowed: Number.isInteger(receipt.quantity) && receipt.quantity >= 1 && receipt.quantity <= 5,
        notionalAllowed: receipt.quantity * receipt.limitPrice <= currentBudget.maxPositionValue,
        strategyCapitalAllowed: currentBudget.available >= receipt.quantity * receipt.limitPrice,
        securityExposureAllowed: portfolioFit.checks.securityExposureAllowed,
        positionSlotAllowed: portfolioFit.checks.positionSlotAllowed,
        sectorAllowed: portfolioFit.checks.sectorAllowed,
        themeAllowed: portfolioFit.checks.themeAllowed,
        diversificationAllowed: portfolioFit.checks.classificationComplete && portfolioFit.checks.diversificationAllowed,
        priceWithinLimit: typeof referencePrice === "number" && referencePrice <= receipt.limitPrice,
        bracketValid:
          receipt.exitPolicy?.mode === "broker_bracket" &&
          receipt.exitPolicy?.automatic === true &&
          receipt.stopPrice > 0 &&
          receipt.stopPrice < receipt.limitPrice &&
          receipt.targetPrice > receipt.limitPrice,
      };
      const safe = Object.values(safetyChecks).every(Boolean);
      if (!safe) {
        auditLog.push({
          id: randomUUID(),
          at: now(),
          event: "final_safety_check_blocked",
          proposalId: proposal.id,
          decisionId: receipt.decisionId,
          checks: safetyChecks,
        });
        recordLedgerEvent({
          at: now(),
          event: "final_safety_check_blocked",
          eventKey: `safety:${receipt.decisionId}:blocked`,
          proposalId: proposal.id,
          decisionId: receipt.decisionId,
          checks: safetyChecks,
        });
        const portfolioPolicyError = !safetyChecks.diversificationAllowed
          ? "portfolio_diversification_required"
          : !safetyChecks.sectorAllowed
            ? "portfolio_sector_limit_reached"
            : !safetyChecks.themeAllowed
              ? "portfolio_theme_limit_reached"
              : !safetyChecks.positionSlotAllowed
                ? "portfolio_position_limit_reached"
                : !safetyChecks.securityExposureAllowed || !safetyChecks.notionalAllowed
                  ? "portfolio_position_size_limit_reached"
                  : !safetyChecks.strategyCapitalAllowed
                    ? "strategy_capital_changed"
                    : null;
        if (portfolioPolicyError) {
          try {
            const recalculated = await recalculateRecommendationQueue({
              excludedSymbols: [receipt.symbol],
              mode: proposal.sourceLane === "shadow" ? "risky" : "balanced",
            });
            return json(response, 409, {
              error: portfolioPolicyError,
              checks: safetyChecks,
              ...recalculated,
              recalculated: true,
            });
          } catch {
            return json(response, 409, {
              error: portfolioPolicyError,
              checks: safetyChecks,
              recommendations: [],
              strategy: strategySummary(),
              recalculated: true,
            });
          }
        }
        return json(response, 409, { error: "final_safety_check_blocked", checks: safetyChecks });
      }

      // Persist before contacting the broker. Any retry or restart observes this row
      // and cannot unknowingly transmit a duplicate order.
      const begun = ledger().beginSubmission({
        decisionId: receipt.decisionId,
        idempotencyKey,
      });
      if (!begun.created) {
        return json(response, 409, { error: "approval_already_used", attempt: begun.attempt });
      }
      submissionAttempt = begun.attempt;
      const submission = await ibkrPaperSubmit(receipt);
      ledger().completeSubmission({
        id: submissionAttempt.id,
        status: submission.ok ? "submitted" : "failed",
        brokerOrderId: submission.result?.orderId == null ? null : String(submission.result.orderId),
        errorCode: submission.ok ? null : submission.error ?? submission.errors?.[0]?.code?.toString() ?? "broker_submission_failed",
        response: { submission },
      });
      if (submission.ok) recordSubmittedBrokerOrders(proposal, receipt, submissionAttempt, submission);
      if (submission.ok) {
        proposal.status = "submitted";
        const notional = roundPrice(receipt.quantity * receipt.limitPrice);
        strategy.currentExposure = currentStrategyBudget().deployed;
        strategy.completed.push({
          proposalId: proposal.id,
          symbol: receipt.symbol,
          side: receipt.side,
          quantity: receipt.quantity,
          limitPrice: receipt.limitPrice,
          signalDate: proposal.signalDate,
          outcome: "submitted",
          at: now(),
        });
        saveStrategy();
      }
      auditLog.push({
        id: randomUUID(),
        at: now(),
        event: submission.ok ? "paper_order_submitted" : "paper_order_submission_failed",
        proposalId: proposal.id,
        decisionId: receipt.decisionId,
        brokerOrderId: submission.result?.orderId ?? null,
        brokerStatus: submission.result?.status ?? null,
        brokerErrors: submission.errors ?? [],
        brokerWarnings: submission.warnings ?? [],
      });
      let recalculated = null;
      if (submission.ok) {
        if (simulatedBroker) recalculated = { recommendations: [], strategy: strategySummary() };
        else {
          try {
            recalculated = await recalculateRecommendationQueue({
              excludedSymbols: [receipt.symbol],
              mode: proposal.sourceLane === "shadow" ? "risky" : "balanced",
            });
          } catch {
            recalculated = { recommendations: [], strategy: strategySummary() };
          }
        }
      }
      return json(response, submission.ok ? 200 : 409, { submission, ...recalculated });
    } catch (error) {
      if (submissionAttempt) {
        ledger().completeSubmission({
          id: submissionAttempt.id,
          status: "unknown",
          errorCode: "broker_unavailable",
          response: { message: error.message ?? `${brokerName} submission outcome is unknown` },
        });
      }
      return json(response, 503, {
        error: submissionAttempt
          ? "broker_unavailable_submission_outcome_unknown"
          : "broker_unavailable_before_submission",
      });
    }
  }

  const exitApprovalMatch = url.pathname.match(/^\/exit-reviews\/([^/]+)\/approve-paper$/);
  if (request.method === "POST" && exitApprovalMatch) {
    if (!paperSubmitEnabled) return json(response, 503, { error: "paper_submit_disabled" });
    if (paused) return json(response, 409, { error: "agents_paused" });
    const approvalInput = await body(request);
    if (approvalInput.confirmed !== true) return json(response, 400, { error: "explicit_sell_confirmation_required" });
    const reviewId = decodeURIComponent(exitApprovalMatch[1]);
    const requestId = randomUUID();
    try {
      const { snapshot } = await performReconciliation();
      const scan = await scanDailyShadowSignals();
      if (!scan.ok) return json(response, 409, { error: "current_scan_required" });
      const budget = currentStrategyBudget();
      const ownership = positionOwnership(snapshot);
      const evaluatedExits = evaluateAutomaticExits({ scan, snapshot, prior: strategy.automaticExitState ?? {}, requiredFailures: 2 });
      const portfolioReview = buildPortfolioReview(scan, snapshot, {
        ...budget, ownership, thesisExits: evaluatedExits.exits,
        openTrades: ledger().listTrades(), reviewedAt: now(),
      });
      const review = portfolioReview.exitReviews.find((item) => item.id === reviewId);
      if (!review) return json(response, 404, { error: "exit_review_no_longer_available" });
      if (!review.orderSubmissionAllowed) {
        return json(response, 409, { error: "exit_not_eligible", reason: review.approvalBlockedReason });
      }
      const owned = ownership.items.find((item) => item.symbol === review.symbol);
      if (!owned || owned.ownership !== "strategy_owned"
        || Number(owned.strategyOwnedQuantity) !== Number(review.quantity)) {
        return json(response, 409, { error: "position_ownership_changed" });
      }
      const linkedPositions = ledger().listPositions().filter((item) => item.accountId === snapshot.account && item.symbol === review.symbol);
      const linked = linkedPositions
        .flatMap((item) => ledger().listBrokerOrders(item.id));
      const targetIds = new Set(linked.filter((item) => item.role === "profit_target").map((item) => String(item.brokerOrderId)));
      const stopIds = new Set(linked.filter((item) => item.role === "protective_stop").map((item) => String(item.brokerOrderId)));
      const active = new Set(["PendingSubmit", "PreSubmitted", "Submitted", "PartiallyFilled"]);
      const identity = (order) => String(order.permanentId ?? order.orderId ?? "");
      const targets = (snapshot.openOrders ?? []).filter((order) => order.account === snapshot.account
        && order.symbol === review.symbol && order.action === "SELL" && order.orderType === "LMT"
        && active.has(order.status) && targetIds.has(identity(order)));
      const stops = (snapshot.openOrders ?? []).filter((order) => order.account === snapshot.account
        && order.symbol === review.symbol && order.action === "SELL" && order.orderType === "STP"
        && active.has(order.status) && stopIds.has(identity(order)));
      const quote = await ibkrSnapshot(review.symbol);
      const ibkrAssessed = assessAutomaticExitQuote(quote, { maxSpreadPercent: maximumBidAskSpreadPercent });
      let assessed = ibkrAssessed.ok ? { ...ibkrAssessed, source: brokerMode === "alpaca" ? "alpaca_live" : "ibkr_live" }
        : await getAlpacaExecutionQuote(review.symbol, { maxAgeMs: 60_000 });
      if (!assessed.ok && assessed.reason === "spread_too_wide") {
        const position = (snapshot.positions ?? []).find((item) => item.symbol === review.symbol);
        assessed = assessProfitablePaperBidFallback(assessed, { averageCost: position?.averageCost });
      }
      if (!assessed.ok) return json(response, 409, { error: "execution_quote_unavailable",
        reason: ibkrAssessed.reason === "live_quote_unavailable"
          ? `${brokerName} live data unavailable; ${assessed.reason}` : ibkrAssessed.reason });
      const limitPrice = roundPrice(assessed.executableLimit ?? assessed.bid * 0.998);
      if (review.exitMode === "direct_exit") {
        if (brokerMode !== "alpaca") return json(response, 409, { error: "direct_exit_requires_alpaca_paper" });
        if (exitSubmissionsInFlight.has(review.symbol)) return json(response, 409, { error: "exit_submission_in_flight" });
        const competing = (snapshot.openOrders ?? []).filter((order) => order.account === snapshot.account
          && order.symbol === review.symbol && order.action === "SELL" && active.has(order.status));
        if (competing.length > 0) return json(response, 409, { error: "working_sell_order_exists" });
        const position = linkedPositions.length === 1 ? linkedPositions[0] : null;
        const proposal = position ? ledger().getProposal(position.id) : null;
        const decision = position ? ledger().getDecisionForProposal(position.id) : null;
        if (!position || !proposal || !decision) return json(response, 409, { error: "exit_ledger_identity_unavailable" });
        exitSubmissionsInFlight.add(review.symbol);
        try {
          const adapter = await alpacaSubmitExit({ decisionId: decision.id, accountId: snapshot.account,
            symbol: review.symbol, quantity: review.quantity, limitPrice });
          if (!adapter.ok || !adapter.result?.orderId) {
            return json(response, 409, { error: adapter.error ?? "approved_exit_rejected", adapter });
          }
          const attempt = ledger().listSubmissionAttemptsForDecision(decision.id)[0] ?? null;
          ledger().recordBrokerOrder({ proposalId: proposal.id, submissionAttemptId: attempt?.id ?? null,
            broker: "Alpaca", accountId: snapshot.account,
            brokerOrderId: adapter.result.permanentId ?? adapter.result.orderId,
            parentBrokerOrderId: null, role: "exit", status: adapter.result.status, order: adapter.result });
          recordLedgerEvent({ event: "approved_direct_exit_submitted",
            eventKey: `approved-direct-exit:${adapter.result.orderId}`,
            proposalId: proposal.id, decisionId: decision.id,
            payload: { requestId, symbol: review.symbol, quantity: review.quantity, limitPrice } });
          let confirmed = null;
          for (let attemptIndex = 0; attemptIndex < 4; attemptIndex += 1) {
            if (attemptIndex > 0) await new Promise((resolve) => setTimeout(resolve, 500));
            confirmed = (await performReconciliation()).snapshot;
            const observedOrder = [...(confirmed.openOrders ?? []), ...(confirmed.completedOrders ?? [])]
              .find((order) => String(order.permanentId ?? order.orderId) === String(adapter.result.permanentId ?? adapter.result.orderId));
            const observedExecution = (confirmed.executions ?? [])
              .find((execution) => String(execution.permanentId ?? execution.orderId) === String(adapter.result.permanentId ?? adapter.result.orderId));
            if (observedOrder || observedExecution) break;
          }
          return json(response, 200, { ok: true, requestId, symbol: review.symbol, quantity: review.quantity,
            limitPrice, quoteSource: assessed.source, phase: "submitted", adapter });
        } finally {
          exitSubmissionsInFlight.delete(review.symbol);
        }
      }
      if (owned.protection !== "verified") return json(response, 409, { error: "position_protection_changed" });
      if (targets.length !== 1 || stops.length !== 1
        || Number(targets[0].quantity) !== Number(review.quantity)
        || Number(stops[0].quantity) !== Number(review.quantity)) {
        return json(response, 409, { error: "exact_protected_order_pair_required" });
      }
      const terms = { requestId, account: snapshot.account, symbol: review.symbol,
        targetId: identity(targets[0]), stopId: identity(stops[0]), requestedLimitPrice: limitPrice };
      const prepared = exitOutbox().prepare({ snapshot, ...terms });
      if (!prepared.created) return json(response, 409, { error: prepared.reason ?? "exit_intent_not_prepared" });
      const claimed = exitOutbox().claimForDispatch(requestId, { snapshot });
      if (!claimed.claimed) return json(response, 409, { error: claimed.reason ?? "exit_intent_not_dispatchable" });
      let adapter;
      if (simulatedBroker) {
        const target = (snapshot.openOrders ?? []).find((order) => identity(order) === terms.targetId);
        simulatedBroker.requestTargetReplacement({ orderId: target.orderId, limitPrice, requestId });
        simulatedBroker.resolveTargetReplacement(requestId, "Accepted");
        adapter = { ok: true, result: { orderId: target.orderId, status: "Submitted", limitPrice } };
      } else if (brokerMode === "alpaca") {
        adapter = await alpacaReplaceOrder(terms.targetId, limitPrice);
      } else {
        const { stdout } = await execFileAsync(ibkrPython, [ibkrReplacePaperTargetScript, JSON.stringify({
          ...terms, limitPrice,
        })], { timeout: 35_000, maxBuffer: 128 * 1024 });
        adapter = JSON.parse(stdout);
      }
      let intent;
      if (simulatedBroker) {
        intent = exitOutbox().reconcile(requestId, simulatedBroker.snapshot());
      } else {
        // A marketable target replacement can fill before the first read-only
        // reconciliation cycle observes either the modified open order or its
        // execution. Treat that short broker-publication window as pending,
        // not as a failed sell. Poll only for bounded confirmation and never
        // retransmit the order.
        for (let attempt = 0; attempt < 4; attempt += 1) {
          if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 500));
          const confirmedSnapshot = (await performReconciliation()).snapshot;
          intent = exitOutbox().reconcile(requestId, confirmedSnapshot);
          if (["working", "closed", "blocked"].includes(intent.phase)) break;
        }
      }
      const accepted = adapter.ok && ["working", "closed"].includes(intent.phase);
      auditLog.push({ id: randomUUID(), at: now(), event: accepted ? "approved_paper_exit_accepted" : "approved_paper_exit_unconfirmed",
        requestId, symbol: review.symbol, limitPrice, quoteSource: assessed.source, phase: intent.phase });
      recordLedgerEvent({ event: accepted ? "approved_paper_exit_accepted" : "approved_paper_exit_unconfirmed",
        eventKey: `approved-exit:${requestId}:${intent.phase}`, payload: { requestId, symbol: review.symbol, limitPrice, phase: intent.phase } });
      return json(response, accepted ? 200 : 409, { ok: accepted, requestId, symbol: review.symbol,
        quantity: review.quantity, limitPrice, quoteSource: assessed.source, phase: intent.phase, adapter });
    } catch (error) {
      auditLog.push({ id: randomUUID(), at: now(), event: "approved_paper_exit_failed", requestId, error: error.message });
      return json(response, 503, { error: "approved_paper_exit_failed", detail: error.message, requestId });
    }
  }

  const decisionMatch = url.pathname.match(/^\/proposals\/([^/]+)\/decision$/);
  if (request.method === "POST" && decisionMatch) {
    const proposal = proposals.get(decisionMatch[1]);
    const input = await body(request);
    if (!proposal) return json(response, 404, { error: "proposal_not_found" });
    if (paused) return json(response, 409, { error: "agents_paused" });
    if (input.decision !== "approved" && input.decision !== "denied") {
      return json(response, 400, { error: "invalid_decision" });
    }
    if (proposal.status !== "pending") {
      const existingDecision = ledger().getDecisionForProposal(proposal.id);
      if (existingDecision?.decision === input.decision) {
        return json(response, 200, {
          proposal,
          approval: existingDecision.payload?.approval ?? null,
          replayed: true,
        });
      }
      return json(response, 409, { error: "proposal_already_decided" });
    }
    if (proposal.expiresAt <= now()) {
      expireProposal(proposal);
      return json(response, 410, { error: "proposal_expired" });
    }

    proposal.status = input.decision;
    if (input.decision === "denied") {
      proposal.decisionId = randomUUID();
      ledger().recordDecision({
        id: proposal.decisionId,
        proposalId: proposal.id,
        decision: "denied",
        payload: { symbol: proposal.symbol, signalDate: proposal.signalDate ?? null },
      });
      strategy.completed.push({
        proposalId: proposal.id,
        symbol: proposal.symbol,
        side: proposal.side,
        quantity: proposal.quantity,
        limitPrice: proposal.limitPrice,
        signalDate: proposal.signalDate,
        outcome: "denied",
        at: now(),
      });
      saveStrategy();
      auditLog.push({ id: randomUUID(), at: now(), event: "proposal_denied", proposalId: proposal.id, decisionId: proposal.decisionId });
      try {
        const recalculated = await recalculateRecommendationQueue({
          excludedSymbols: [proposal.symbol],
          mode: proposal.sourceLane === "shadow" ? "risky" : "balanced",
        });
        return json(response, 200, { proposal, ...recalculated, recalculated: true });
      } catch (error) {
        auditLog.push({
          id: randomUUID(),
          at: now(),
          event: "recommendations_recalculation_failed",
          proposalId: proposal.id,
          error: error.message ?? "recommendation_recalculation_unavailable",
        });
        return json(response, 200, {
          proposal,
          recommendations: [],
          strategy: strategySummary(),
          recalculated: false,
          recalculationError: error.message ?? "recommendation_recalculation_unavailable",
        });
      }
    }

    const approval = approvalReceipt(proposal);
    proposal.decisionId = approval.receipt.decisionId;
    ledger().recordDecision({
      id: proposal.decisionId,
      proposalId: proposal.id,
      decision: "approved",
      decidedAt: approval.receipt.approvedAt,
      approvalFingerprint: approval.token.split(".")[1],
      payload: { approval },
    });
    auditLog.push({ id: randomUUID(), at: now(), event: "proposal_approved", proposalId: proposal.id, decisionId: proposal.decisionId });
    return json(response, 200, { proposal, approval });
  }

  return json(response, 404, { error: "not_found" });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  if (host !== "127.0.0.1" && host !== "::1" && !appToken) {
    throw new Error("TRADE_APPROVAL_APP_TOKEN is required when listening beyond localhost");
  }
  restoreLedgerState();
  createServer((request, response) => {
    route(request, response).catch((error) => json(response, 500, { error: "internal_error", detail: error.message }));
  }).listen(port, host, () => {
    console.log(`Paper proposal service listening on http://${host}:${port}`);
    scheduleReconciliation();
  });
}
