import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const port = Number(process.env.TRADE_APPROVAL_PORT ?? 8787);
const host = process.env.TRADE_APPROVAL_HOST ?? "127.0.0.1";
const appToken = process.env.TRADE_APPROVAL_APP_TOKEN ?? "";
const whatIfEnabled = process.env.IBKR_ENABLE_WHAT_IF === "true";
const paperSubmitEnabled = process.env.IBKR_ENABLE_PAPER_SUBMIT === "true";
const signingSecret = process.env.APPROVAL_SIGNING_SECRET ?? "paper-development-only";
const proposals = new Map();
const auditLog = [];
const previewPassed = new Set();
const whatIfPassed = new Set();
const consumedApprovals = new Set();
let paused = false;
const execFileAsync = promisify(execFile);
const serviceDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = dirname(serviceDirectory);
const ibkrPython = join(projectDirectory, ".venv-ibkr-10.49", "bin", "python");
const ibkrSnapshotScript = join(serviceDirectory, "ibkr_snapshot.py");
const ibkrWhatIfScript = join(serviceDirectory, "ibkr_what_if.py");
const ibkrPaperSubmitScript = join(serviceDirectory, "ibkr_submit_paper.py");
const ibkrDailyScannerScript = join(serviceDirectory, "ibkr_daily_scanner.py");
const strategyStatePath = join(serviceDirectory, "data", "strategy-state.json");
const shadowLedgerPath = join(serviceDirectory, "data", "shadow-signals.json");
const strategy = JSON.parse(readFileSync(strategyStatePath, "utf8"));
const companies = {
  NVDA: "NVIDIA Corporation",
  AAPL: "Apple Inc.",
  MSFT: "Microsoft Corporation",
};

function saveStrategy() {
  writeFileSync(strategyStatePath, `${JSON.stringify(strategy, null, 2)}\n`);
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
    const { stdout } = await execFileAsync(ibkrPython, [ibkrDailyScannerScript], {
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
  const pending = [...proposals.values()].filter((proposal) => proposal.status === "pending" && proposal.expiresAt > now()).length;
  return {
    ...strategy,
    remainingCapital: Math.max(0, strategy.capitalLimit - strategy.currentExposure),
    pendingRecommendations: pending,
    completedCount: strategy.completed.length,
  };
}

const now = () => Date.now();

function roundPrice(value) {
  return Math.round(value * 100) / 100;
}

function seedProposal(snapshot = null) {
  const referencePrice = snapshot?.quote?.last ?? snapshot?.quote?.close ?? 183.1;
  const bid = snapshot?.quote?.bid ?? referencePrice;
  const ask = snapshot?.quote?.ask ?? referencePrice;
  const limitPrice = roundPrice(Math.max(ask, referencePrice * 1.002));
  const availableCapital = Math.min(strategy.perTradeLimit, Math.max(0, strategy.capitalLimit - strategy.currentExposure));
  const quantity = Math.min(5, Math.floor(availableCapital / limitPrice));
  const stopPrice = roundPrice(referencePrice * 0.98);
  const targetPrice = roundPrice(referencePrice * 1.04);
  const proposal = {
    id: randomUUID(),
    environment: "paper",
    agentId: "home-momentum-agent",
    agentName: "Home Momentum Agent",
    broker: "IBKR",
    accountId: snapshot?.account ?? "paper-demo",
    symbol: snapshot?.quote?.symbol ?? "NVDA",
    company: companies[snapshot?.quote?.symbol] ?? snapshot?.quote?.symbol ?? "Unknown company",
    assetType: "equity",
    side: "buy",
    quantity,
    orderType: "limit",
    currentPrice: referencePrice,
    bid,
    ask,
    limitPrice,
    stopPrice,
    targetPrice,
    maxLoss: roundPrice((limitPrice - stopPrice) * quantity),
    quoteDataType: snapshot?.quote?.dataType ?? null,
    rationale: [
      "Included in the Phase 2 large-cap pilot universe",
      "Price and order limits were refreshed from IBKR",
      "Queue plumbing candidate—not yet a scanner-generated signal"
    ],
    createdAt: now(),
    expiresAt: now() + 5 * 60 * 1000,
    status: "pending",
    decisionId: null
  };
  proposals.set(proposal.id, proposal);
  auditLog.push({ id: randomUUID(), at: now(), event: "proposal_created", proposalId: proposal.id });
  return proposal;
}

async function nextRecommendation() {
  const existing = [...proposals.values()].find(
    (proposal) => proposal.status === "pending" && proposal.expiresAt > now(),
  );
  if (existing) {
    const snapshot = await ibkrSnapshot(existing.symbol);
    return { proposal: existing, broker: snapshot, strategy: strategySummary() };
  }
  if (strategy.status !== "active") throw new Error("strategy_paused");
  if (strategy.currentExposure >= strategy.capitalLimit) throw new Error("strategy_capital_limit");
  const symbol = strategy.universe[strategy.nextUniverseIndex % strategy.universe.length];
  const snapshot = await ibkrSnapshot(symbol);
  const proposal = seedProposal(snapshot);
  if (proposal.quantity < 1) {
    proposals.delete(proposal.id);
    throw new Error("insufficient_strategy_capital");
  }
  strategy.nextUniverseIndex = (strategy.nextUniverseIndex + 1) % strategy.universe.length;
  saveStrategy();
  return { proposal, broker: snapshot, strategy: strategySummary() };
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

async function ibkrSnapshot(symbol = "NVDA") {
  const normalized = symbol.toUpperCase();
  if (!/^[A-Z0-9]{1,10}$/.test(normalized)) throw new Error("invalid_symbol");
  const { stdout } = await execFileAsync(ibkrPython, [ibkrSnapshotScript, normalized], {
    timeout: 20_000,
    maxBuffer: 128 * 1024,
  });
  return JSON.parse(stdout);
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
    return json(response, 200, { ok: true, environment: "paper", paused });
  }

  if (request.method === "GET" && url.pathname === "/proposals") {
    const items = [...proposals.values()].map((proposal) =>
      proposal.status === "pending" && proposal.expiresAt <= now()
        ? { ...proposal, status: "expired" }
        : proposal
    );
    return json(response, 200, { paused, proposals: items });
  }

  if (request.method === "GET" && url.pathname === "/strategy") {
    return json(response, 200, { strategy: strategySummary() });
  }

  if (request.method === "GET" && url.pathname === "/audit") {
    return json(response, 200, { events: [...auditLog].reverse() });
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
          proposal.limitPrice === receipt.limitPrice,
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
    return json(response, result.ok ? 200 : 409, { whatIf: result });
  }

  if (request.method === "POST" && url.pathname === "/orders/submit-paper") {
    if (!paperSubmitEnabled) return json(response, 503, { error: "paper_submit_disabled" });
    if (paused) return json(response, 409, { error: "agents_paused" });
    const input = await body(request);
    const receipt = typeof input.token === "string" ? verifyApprovalToken(input.token) : null;
    if (!receipt) return json(response, 401, { error: "invalid_or_expired_approval" });
    const proposal = proposals.get(receipt.proposalId);
    if (!proposal || proposal.status !== "approved" || proposal.decisionId !== receipt.decisionId) {
      return json(response, 409, { error: "approval_does_not_match_proposal" });
    }
    if (!previewPassed.has(receipt.decisionId) || !whatIfPassed.has(receipt.decisionId)) {
      return json(response, 409, { error: "preview_and_what_if_required" });
    }
    if (consumedApprovals.has(receipt.decisionId)) {
      return json(response, 409, { error: "approval_already_used" });
    }
    try {
      const snapshot = await ibkrSnapshot(receipt.symbol);
      const referencePrice = snapshot.quote.ask ?? snapshot.quote.last ?? snapshot.quote.close;
      const safe =
        receipt.environment === "paper" &&
        snapshot.environment === "paper" &&
        snapshot.account === receipt.accountId &&
        receipt.expiresAt > now() &&
        strategy.universe.includes(receipt.symbol) &&
        Number.isInteger(receipt.quantity) &&
        receipt.quantity >= 1 &&
        receipt.quantity <= 5 &&
        receipt.quantity * receipt.limitPrice <= 1500 &&
        typeof referencePrice === "number" &&
        (receipt.side === "buy" ? referencePrice <= receipt.limitPrice : referencePrice >= receipt.limitPrice);
      if (!safe) return json(response, 409, { error: "final_safety_check_blocked" });

      // Consume before contacting IBKR so retries cannot create duplicate orders.
      consumedApprovals.add(receipt.decisionId);
      const submission = await ibkrPaperSubmit(receipt);
      if (submission.ok) {
        proposal.status = "submitted";
        const notional = roundPrice(receipt.quantity * receipt.limitPrice);
        strategy.currentExposure = roundPrice(Math.min(strategy.capitalLimit, strategy.currentExposure + notional));
        strategy.completed.push({
          proposalId: proposal.id,
          symbol: receipt.symbol,
          side: receipt.side,
          quantity: receipt.quantity,
          limitPrice: receipt.limitPrice,
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
      });
      return json(response, submission.ok ? 200 : 409, { submission });
    } catch {
      consumedApprovals.add(receipt.decisionId);
      return json(response, 503, { error: "ibkr_unavailable_approval_consumed" });
    }
  }

  const decisionMatch = url.pathname.match(/^\/proposals\/([^/]+)\/decision$/);
  if (request.method === "POST" && decisionMatch) {
    const proposal = proposals.get(decisionMatch[1]);
    const input = await body(request);
    if (!proposal) return json(response, 404, { error: "proposal_not_found" });
    if (paused) return json(response, 409, { error: "agents_paused" });
    if (proposal.status !== "pending") return json(response, 409, { error: "proposal_already_decided" });
    if (proposal.expiresAt <= now()) return json(response, 410, { error: "proposal_expired" });
    if (input.decision !== "approved" && input.decision !== "denied") {
      return json(response, 400, { error: "invalid_decision" });
    }

    proposal.status = input.decision;
    if (input.decision === "denied") {
      proposal.decisionId = randomUUID();
      strategy.completed.push({
        proposalId: proposal.id,
        symbol: proposal.symbol,
        side: proposal.side,
        quantity: proposal.quantity,
        limitPrice: proposal.limitPrice,
        outcome: "denied",
        at: now(),
      });
      saveStrategy();
      auditLog.push({ id: randomUUID(), at: now(), event: "proposal_denied", proposalId: proposal.id, decisionId: proposal.decisionId });
      return json(response, 200, { proposal });
    }

    const approval = approvalReceipt(proposal);
    proposal.decisionId = approval.receipt.decisionId;
    auditLog.push({ id: randomUUID(), at: now(), event: "proposal_approved", proposalId: proposal.id, decisionId: proposal.decisionId });
    return json(response, 200, { proposal, approval });
  }

  return json(response, 404, { error: "not_found" });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  if (host !== "127.0.0.1" && host !== "::1" && !appToken) {
    throw new Error("TRADE_APPROVAL_APP_TOKEN is required when listening beyond localhost");
  }
  createServer((request, response) => {
    route(request, response).catch((error) => json(response, 500, { error: "internal_error", detail: error.message }));
  }).listen(port, host, () => {
    console.log(`Paper proposal service listening on http://${host}:${port}`);
  });
}
