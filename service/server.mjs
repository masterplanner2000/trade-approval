import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { getSecCompanyResearch, summarizeSecResearch } from "./sec_edgar.mjs";
import { getStockNews, stockNewsSymbol } from "./stock_news.mjs";
import { authoritativePortfolio, BrokerReconciliationStore, reconcileSnapshotToLedger } from "./broker_reconciliation.mjs";
import { TradingLedger } from "./trading_ledger.mjs";

const port = Number(process.env.TRADE_APPROVAL_PORT ?? 8787);
const host = process.env.TRADE_APPROVAL_HOST ?? "127.0.0.1";
const appToken = process.env.TRADE_APPROVAL_APP_TOKEN ?? "";
const whatIfEnabled = process.env.IBKR_ENABLE_WHAT_IF === "true";
const paperSubmitEnabled = process.env.IBKR_ENABLE_PAPER_SUBMIT === "true";
const reconciliationEnabled = process.env.IBKR_ENABLE_RECONCILIATION !== "false";
const maximumBidAskSpreadPercent = 0.25;
const signingSecret = process.env.APPROVAL_SIGNING_SECRET ?? "paper-development-only";
const proposals = new Map();
const proposalSnapshots = new Map();
const auditLog = [];
const previewPassed = new Set();
const whatIfPassed = new Set();
let paused = false;
const execFileAsync = promisify(execFile);
const serviceDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = dirname(serviceDirectory);
const ibkrPython = join(projectDirectory, ".venv-ibkr-10.49", "bin", "python");
const ibkrSnapshotScript = join(serviceDirectory, "ibkr_snapshot.py");
const ibkrWhatIfScript = join(serviceDirectory, "ibkr_what_if.py");
const ibkrPaperSubmitScript = join(serviceDirectory, "ibkr_submit_paper.py");
const ibkrReconciliationScript = join(serviceDirectory, "ibkr_reconciliation.py");
const alpacaMarketCacheScript = join(serviceDirectory, "alpaca_market_cache.py");
const strategyStatePath = join(serviceDirectory, "data", "strategy-state.json");
const shadowLedgerPath = join(serviceDirectory, "data", "shadow-signals.json");
const tradingLedgerPath = process.env.TRADE_LEDGER_PATH ?? join(serviceDirectory, "data", "trading-ledger.sqlite3");
const riskPolicyPath = join(serviceDirectory, "data", "risk-policy.json");
let tradingLedger = null;
let reconciliationStore = null;
const strategy = JSON.parse(readFileSync(strategyStatePath, "utf8"));
const defaultRiskPolicy = {
  adaptive: true,
  sleeveValue: 50_000,
  normalRiskPercent: 0.25,
  hardRiskPercent: 0.5,
  dailyLossPercent: 0.75,
  totalOpenRiskPercent: 1.25,
  maximumPositionPercent: 7.5,
  maximumDeployedPercent: 60,
  minimumCashReservePercent: 40,
  maximumSectorPercent: 20,
  maximumCorrelatedPercent: 25,
  maximumPositions: 5,
};
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
      if (eventTypes.has("ibkr_what_if_passed")) whatIfPassed.add(decision.id);
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
    return JSON.parse(readFileSync(riskPolicyPath, "utf8"));
  } catch {
    return { version: 1, updatedAt: null, policy: defaultRiskPolicy };
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
  const record = { version: 1, updatedAt: now(), policy };
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
      maxBuffer: 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) {
    const output = error.stdout?.trim();
    if (output) return JSON.parse(output);
    throw error;
  }
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
    currentExposure: budget.deployed,
    remainingCapital: budget.available,
    budget,
    pendingRecommendations: pending,
    completedCount: strategy.completed.length,
  };
}

const now = () => Date.now();

function currentStrategyBudget() {
  const ledgerBudget = ledger().strategyBudget(strategy.capitalLimit);
  const latest = reconciliations().latest();
  if (latest) {
    const portfolio = authoritativePortfolio(latest.snapshot);
    if (portfolio.status === "COMPLETE") {
      const strategySymbols = new Set(strategy.completed.filter((item) => item.outcome === "submitted").map((item) => item.symbol));
      const invested = roundPrice(portfolio.positions
        .filter((position) => strategySymbols.has(position.symbol))
        .reduce((sum, position) => sum + Math.abs(Number(position.quantity ?? 0)) * Number(position.averageCost ?? 0), 0));
      const reserved = ledgerBudget.reserved;
      const deployed = roundPrice(invested + reserved);
      return {
        capitalLimit: strategy.capitalLimit,
        invested,
        reserved,
        deployed,
        available: Math.max(0, roundPrice(strategy.capitalLimit - deployed)),
        overAllocated: deployed > strategy.capitalLimit,
        status: "reconciled",
        asOf: portfolio.asOf,
      };
    }
  }
  const deployed = Math.max(Number(strategy.currentExposure ?? 0), ledgerBudget.deployed);
  return {
    ...ledgerBudget,
    deployed,
    available: Math.max(0, roundPrice(strategy.capitalLimit - deployed)),
    overAllocated: deployed > strategy.capitalLimit,
    status: "conservative_fallback",
    asOf: null,
  };
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

function seedProposal(snapshot = null, secResearch = null, candidate = null) {
  const referencePrice = snapshot?.quote?.last ?? snapshot?.quote?.close ?? 183.1;
  const bid = snapshot?.quote?.bid ?? referencePrice;
  const ask = snapshot?.quote?.ask ?? referencePrice;
  const limitPrice = roundPrice(Math.max(ask, referencePrice * 1.002));
  const availableCapital = Math.min(strategy.perTradeLimit, currentStrategyBudget().available);
  const quantity = Math.min(5, Math.floor(availableCapital / limitPrice));
  const stopDistancePercent = Math.min(8, Math.max(2, (candidate?.atrPercent14 ?? 2) * 1.5));
  const stopPrice = roundPrice(referencePrice * (1 - stopDistancePercent / 100));
  const targetPrice = roundPrice(limitPrice + (limitPrice - stopPrice) * 2);
  const riskQuantity = Math.floor((strategy.maxLossPerTrade ?? 75) / Math.max(limitPrice - stopPrice, 0.01));
  const finalQuantity = Math.min(quantity, riskQuantity);
  const proposal = {
    id: randomUUID(),
    environment: "paper",
    agentId: "home-momentum-agent",
    agentName: "Home Momentum Agent",
    broker: "IBKR",
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
    targetTimeframe: strategy.expectedHoldingPeriod,
    exitPolicy: {
      mode: "broker_bracket",
      protectiveStopPrice: stopPrice,
      profitTargetPrice: targetPrice,
      entryTimeInForce: "DAY",
      exitTimeInForce: "GTC",
      automatic: true,
    },
    maxLoss: roundPrice((limitPrice - stopPrice) * finalQuantity),
    quoteDataType: snapshot?.quote?.dataType ?? null,
    marketRisk: candidate?.marketRisk ?? null,
    category: candidate?.category ?? "MOMENTUM_CONTINUATION",
    recommendationScore: candidate?.recommendationScore ?? null,
    signalDate: candidate?.signalDate ?? null,
    universeSource: "alpaca-cache",
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

async function recommendationQueue({ additionalExcludedSymbols = [] } = {}) {
  if (strategy.status !== "active") throw new Error("strategy_paused");
  const strategyBudget = currentStrategyBudget();
  if (strategyBudget.available <= 0) throw new Error("strategy_capital_limit");

  const existing = [...proposals.values()]
    .filter((proposal) => proposal.status === "pending" && proposal.expiresAt > now())
    .sort((left, right) => left.createdAt - right.createdAt);

  const scan = await scanDailyShadowSignals();
  if (!scan.ok) throw new Error(scan.error ?? "scanner_unavailable");
  const excludedSymbols = new Set([
    ...existing.map((proposal) => proposal.symbol),
    ...strategy.completed.filter((item) => item.outcome === "submitted").map((item) => item.symbol),
    ...additionalExcludedSymbols,
  ]);
  const candidates = eligibleQueueCandidates(scan, excludedSymbols)
    .filter((candidate) => !wasDeniedForSignal(candidate, strategy.completed));
  const availableCapital = Math.min(strategy.perTradeLimit, strategyBudget.available);
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
    const candidate = {
      ...evaluated,
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

async function recalculateRecommendationQueue({ excludedSymbols = [] } = {}) {
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
  return recommendationQueue({ additionalExcludedSymbols: excludedSymbols });
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
  const { stdout } = await execFileAsync(ibkrPython, [ibkrSnapshotScript, normalized], {
    timeout: 20_000,
    maxBuffer: 128 * 1024,
  });
  return JSON.parse(stdout);
}

// The snapshot helper uses one dedicated TWS client ID. Serialize calls so a
// health poll cannot collide with an approval-time price/safety check.
let snapshotQueue = Promise.resolve();
function ibkrSnapshot(symbol = "NVDA") {
  const request = snapshotQueue.then(() => runIbkrSnapshot(symbol));
  snapshotQueue = request.catch(() => undefined);
  return request;
}

let reconciliationQueue = Promise.resolve();
function ibkrReconciliation() {
  const request = reconciliationQueue.then(async () => {
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
  const snapshot = await ibkrReconciliation();
  if (!snapshot.ok || !snapshot.complete) {
    const error = new Error(snapshot.error ?? "ibkr_reconciliation_incomplete");
    error.snapshot = snapshot;
    throw error;
  }
  const result = reconciliations().record(snapshot, { knownDecisionPrefixes: knownDecisionPrefixes() });
  const linkedOrders = reconcileSnapshotToLedger(snapshot, ledger());
  recordLedgerEvent({
    event: "ibkr_reconciliation_completed",
    eventKey: `reconciliation:${result.runId}`,
    portfolioStatus: result.portfolio.status,
    externalActivityCount: result.activity.filter((item) => item.ownership === "external").length,
    linkedOrderCount: linkedOrders.length,
  });
  return { snapshot, result, linkedOrders };
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
    return json(response, 200, { ok: true, environment: "paper", paused, reconciliation: {
      enabled: reconciliationEnabled, status: latest?.status ?? "not_started", capturedAt: latest?.capturedAt ?? null,
    } });
  }

  if (request.method === "GET" && url.pathname === "/research/news") {
    let symbol;
    try { symbol = stockNewsSymbol(url.searchParams.get("symbol")); }
    catch { return json(response, 400, { error: "invalid_symbol" }); }
    const news = await getStockNews(symbol);
    return json(response, news.status === "unavailable" ? 503 : 200, news);
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
      symbol: item.symbol ?? "—", side: item.payload?.action ?? item.payload?.side ?? "external",
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
        return json(response, 200, { items: portfolio.positions.map((position) => ({
          id: `ibkr:${position.contractId ?? position.symbol}`, symbol: position.symbol,
          quantity: position.quantity, averageEntryPrice: position.averageCost, currentPrice: null,
          protectiveStopPrice: null, profitTargetPrice: null, updatedAt: portfolio.asOf,
          dataState: "reconciled",
        })), reconciled: true, asOf: portfolio.asOf });
      }
    }
    return json(response, 200, {
      items: ledger().listPositions(),
      reconciled: false,
      message: "Positions reflect recorded fills only until IBKR reconciliation is connected.",
    });
  }

  if (request.method === "GET" && url.pathname === "/shadow/signals") {
    return json(response, 200, readShadowLedger());
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
        error: error.message === "invalid_symbol" ? error.message : "ibkr_unavailable",
      });
    }
  }

  if (request.method === "POST" && url.pathname === "/broker/reconcile") {
    try {
      const { result, linkedOrders } = await performReconciliation();
      return json(response, 200, { ok: true, ...result, linkedOrders });
    } catch (error) {
      return json(response, 503, { ok: false, error: "ibkr_reconciliation_unavailable", detail: error.message });
    }
  }

  if (request.method === "GET" && url.pathname === "/broker/portfolio") {
    const latest = reconciliations().latest();
    if (!latest) return json(response, 404, { ok: false, error: "no_reconciliation_snapshot" });
    const portfolio = authoritativePortfolio(latest.snapshot);
    return json(response, portfolio.status === "COMPLETE" ? 200 : 409, {
      ok: portfolio.status === "COMPLETE",
      reconciliationRunId: latest.id,
      portfolio,
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


  if (request.method === "POST" && url.pathname === "/recommendations/next") {
    try {
      return json(response, 201, await nextRecommendation());
    } catch (error) {
      return json(response, 503, { error: error.message ?? "recommendation_unavailable" });
    }
  }

  if (request.method === "POST" && url.pathname === "/recommendations/queue") {
    try {
      return json(response, 201, await recommendationQueue());
    } catch (error) {
      return json(response, 503, { error: error.message ?? "recommendation_queue_unavailable" });
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
        broker: "IBKR",
        account: snapshot.account,
        action: receipt.side.toUpperCase(),
        symbol: receipt.symbol,
        quantity: receipt.quantity,
        orderType: receipt.orderType.toUpperCase(),
        limitPrice: receipt.limitPrice,
        protectiveStop: receipt.stopPrice,
        profitTarget: receipt.targetPrice,
        automatedExits: true,
        timeInForce: "DAY",
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
      return json(response, 503, { error: "ibkr_unavailable" });
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
      event: result.ok ? "ibkr_what_if_passed" : "ibkr_what_if_blocked",
      proposalId: proposal.id,
      decisionId: receipt.decisionId,
    });
    recordLedgerEvent({
      at: now(),
      event: result.ok ? "ibkr_what_if_passed" : "ibkr_what_if_blocked",
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
      const safetyChecks = {
        paperEnvironment: receipt.environment === "paper" && snapshot.environment === "paper",
        accountMatch: snapshot.account === receipt.accountId,
        approvalFresh: receipt.expiresAt > now(),
        strategyUniverseApproved:
          proposal.universeSource === "alpaca-cache" && proposal.symbol === receipt.symbol,
        buyOnly: receipt.side === "buy",
        quantityAllowed: Number.isInteger(receipt.quantity) && receipt.quantity >= 1 && receipt.quantity <= 5,
        notionalAllowed: receipt.quantity * receipt.limitPrice <= 1500,
        strategyCapitalAllowed: currentStrategyBudget().available >= receipt.quantity * receipt.limitPrice,
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
        if (!safetyChecks.strategyCapitalAllowed) {
          try {
            const recalculated = await recalculateRecommendationQueue();
            return json(response, 409, {
              error: "strategy_capital_changed",
              checks: safetyChecks,
              ...recalculated,
              recalculated: true,
            });
          } catch {
            return json(response, 409, {
              error: "strategy_capital_changed",
              checks: safetyChecks,
              recommendations: [],
              strategy: strategySummary(),
              recalculated: true,
            });
          }
        }
        return json(response, 409, { error: "final_safety_check_blocked", checks: safetyChecks });
      }

      // Persist before contacting IBKR. Any retry or restart observes this row
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
        errorCode: submission.ok ? null : submission.error ?? submission.errors?.[0]?.code?.toString() ?? "ibkr_submission_failed",
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
        try {
          recalculated = await recalculateRecommendationQueue({ excludedSymbols: [receipt.symbol] });
        } catch {
          recalculated = { recommendations: [], strategy: strategySummary() };
        }
      }
      return json(response, submission.ok ? 200 : 409, { submission, ...recalculated });
    } catch (error) {
      if (submissionAttempt) {
        ledger().completeSubmission({
          id: submissionAttempt.id,
          status: "unknown",
          errorCode: "ibkr_unavailable",
          response: { message: error.message ?? "IBKR submission outcome is unknown" },
        });
      }
      return json(response, 503, {
        error: submissionAttempt
          ? "ibkr_unavailable_submission_outcome_unknown"
          : "ibkr_unavailable_before_submission",
      });
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
        const recalculated = await recalculateRecommendationQueue({ excludedSymbols: [proposal.symbol] });
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
