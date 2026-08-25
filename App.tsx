import React, { useEffect, useState } from "react";
import Constants from "expo-constants";
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";

type Decision = "pending" | "approved" | "denied" | "expired";

type Proposal = {
  id: string;
  symbol: string;
  company: string;
  side: "BUY" | "SELL";
  quantity: number;
  currentPrice: number;
  quoteAge: string;
  bid: number;
  ask: number;
  limitPrice: number;
  stopPrice: number;
  maxLoss: number;
  positionValue: number;
  portfolioPercent: number;
  estimatedFees: number;
  targetPrice: number;
  potentialUpside: number;
  potentialUpsidePercent: number;
  targetTimeframe: string;
  exitPlan: string;
  strategyName: string;
  strategyContext: string;
  industryContext: string;
  companyCatalyst: string;
  keyRisk: string;
  rationale: string[];
  agentName: string;
  accountLabel: string;
  expiresAt: number;
  decision: Decision;
  shadowMode?: boolean;
  signalEligible?: boolean;
  signalDate?: string;
  rulesetVersion?: string;
};

type ShadowCheck = { id: string; label: string; passed: boolean; actual: number | null };
type ShadowSelection = {
  symbol: string;
  eligible: boolean;
  signalDate: string;
  referenceClose: number;
  rsi: number;
  sma200: number;
  averageDollarVolume20: number;
  checks: ShadowCheck[];
};
type ShadowScan = {
  ok: boolean;
  mode: "shadow";
  rulesetVersion: string;
  qualifiedCount: number;
  selected: ShadowSelection | null;
  error: string | null;
};

type BrokerSnapshot = {
  ok: boolean;
  environment: "paper";
  readOnly: boolean;
  account: string | null;
  summary: Record<string, { value: number | null; currency: string }>;
  quote: {
    symbol: string;
    bid?: number;
    ask?: number;
    last?: number;
    close?: number;
    dataType: number | null;
    receivedAt: number;
  };
};

type ServiceProposal = {
  id: string;
  symbol: string;
  company: string;
  side: "buy" | "sell";
  currentPrice: number;
  bid: number;
  ask: number;
  limitPrice: number;
  stopPrice: number;
  targetPrice: number;
  maxLoss: number;
  quantity: number;
  expiresAt: number;
  quoteDataType: number | null;
  rationale: string[];
};

type StrategySummary = {
  id: string;
  name: string;
  status: "active" | "paused";
  capitalLimit: number;
  perTradeLimit: number;
  maxOpenPositions: number;
  currentExposure: number;
  remainingCapital: number;
  pendingRecommendations: number;
  completedCount: number;
  universe: string[];
};

type OrderPreview = {
  action: string;
  symbol: string;
  quantity: number;
  limitPrice: number;
  estimatedNotional: number;
  ready: boolean;
  submitted: false;
};

type WhatIfResult = {
  ok: boolean;
  result: {
    commission: number | null;
    minimumCommission: number | null;
    maximumCommission: number | null;
    initialMarginChange: number | null;
    maintenanceMarginChange: number | null;
    warning: string | null;
  } | null;
};

type PaperSubmission = {
  ok: boolean;
  result: {
    orderId: number;
    status: string;
    filled: number | null;
    remaining: number | null;
    averageFillPrice: number | null;
  } | null;
};

const developmentHost = Constants.expoConfig?.hostUri?.split(":")[0];
const API_BASE_URL = process.env.EXPO_PUBLIC_TRADE_API_URL
  ?? (developmentHost ? `http://${developmentHost}:8787` : "http://127.0.0.1:8787");
const APP_TOKEN = process.env.EXPO_PUBLIC_TRADE_APP_TOKEN ?? "";

const PAPER_PROPOSAL: Proposal = {
  id: "paper-001",
  symbol: "NVDA",
  company: "NVIDIA Corporation",
  side: "BUY",
  quantity: 5,
  currentPrice: 183.1,
  quoteAge: "Updated 8 sec ago",
  bid: 183.08,
  ask: 183.12,
  limitPrice: 183.2,
  stopPrice: 180.3,
  maxLoss: 14.5,
  positionValue: 916,
  portfolioPercent: 3.2,
  estimatedFees: 0,
  targetPrice: 190.5,
  potentialUpside: 36.5,
  potentialUpsidePercent: 4,
  targetTimeframe: "1–3 trading days",
  exitPlan:
    "Take partial profit near $190.50 within 1–3 days. Exit near $180.30 or sooner if momentum breaks.",
  strategyName: "Large-cap momentum continuation",
  strategyContext:
    "One of several small momentum positions; capped at 3.2% of the portfolio.",
  industryContext:
    "Large cloud providers continue to prioritize AI infrastructure spending, supporting demand for accelerated-computing chips. The sector remains strong, but expectations are elevated and price reactions can be sharp when growth forecasts change.",
  companyCatalyst:
    "NVIDIA is positioned to benefit from the current data-center upgrade cycle. This proposal is looking for short-term continuation while institutional demand remains visible—not assuming the long-term story guarantees this entry will work.",
  keyRisk:
    "A slowdown in cloud capital spending, export restrictions, supply improvements from competitors, or a broader technology selloff could reverse momentum quickly.",
  rationale: [
    "Opened 3.4% above yesterday’s close",
    "Trading above the 200-day moving average",
    "Relative volume is 1.8× its 20-day average",
  ],
  agentName: "Home Momentum Agent",
  accountLabel: "IBKR Paper ••••1842",
  expiresAt: Date.now() + 4 * 60 * 1000,
  decision: "pending",
};

const SHADOW_LOADING: Proposal = {
  ...PAPER_PROPOSAL,
  id: "shadow-loading",
  symbol: "—",
  company: "Waiting for completed daily data",
  quantity: 0,
  currentPrice: 0,
  quoteAge: "Not loaded",
  bid: 0,
  ask: 0,
  limitPrice: 0,
  stopPrice: 0,
  maxLoss: 0,
  positionValue: 0,
  portfolioPercent: 0,
  targetPrice: 0,
  potentialUpside: 0,
  potentialUpsidePercent: 0,
  targetTimeframe: "Not defined",
  exitPlan: "No order rules are active.",
  strategyName: "Daily RSI mean-reversion research candidate",
  strategyContext: "Loading a read-only scan from completed IBKR daily bars.",
  industryContext: "No research observation has loaded yet.",
  companyCatalyst: "Not available.",
  keyRisk: "Historical data must be available before any observation can be evaluated.",
  rationale: ["Waiting for deterministic rule checks"],
  agentName: "Deterministic daily scanner",
  accountLabel: "SHADOW MODE · no broker order",
  expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  shadowMode: true,
  signalEligible: false,
};

const money = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

function countdown(expiresAt: number) {
  const seconds = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

export default function App() {
  const [proposal, setProposal] = useState(SHADOW_LOADING);
  const [paused, setPaused] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [rationaleOpen, setRationaleOpen] = useState(false);
  const [, tick] = useState(0);
  const [broker, setBroker] = useState<BrokerSnapshot | null>(null);
  const [brokerUnavailable, setBrokerUnavailable] = useState(false);
  const [orderPreview, setOrderPreview] = useState<OrderPreview | null>(null);
  const [whatIfResult, setWhatIfResult] = useState<WhatIfResult | null>(null);
  const [paperSubmission, setPaperSubmission] = useState<PaperSubmission | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [strategy, setStrategy] = useState<StrategySummary | null>(null);

  function applyShadowScan(scan: ShadowScan) {
    if (!scan.selected) throw new Error(scan.error ?? "shadow_data_unavailable");
    const selected = scan.selected;
    setBroker(null);
    setBrokerUnavailable(false);
    setOrderPreview(null);
    setWhatIfResult(null);
    setPaperSubmission(null);
    setWorkflowError(null);
    setStrategy(null);
    setProposal({
      ...PAPER_PROPOSAL,
      id: `${scan.rulesetVersion}:${selected.signalDate}:${selected.symbol}`,
      symbol: selected.symbol,
      company: selected.symbol,
      side: "BUY",
      quantity: 0,
      currentPrice: selected.referenceClose,
      quoteAge: `Completed daily bar · ${selected.signalDate}`,
      bid: 0,
      ask: 0,
      limitPrice: 0,
      stopPrice: 0,
      maxLoss: 0,
      positionValue: 0,
      portfolioPercent: 0,
      estimatedFees: 0,
      targetPrice: 0,
      potentialUpside: 0,
      potentialUpsidePercent: 0,
      targetTimeframe: "Not defined—research only",
      exitPlan: "No entry, stop, target, sizing, or exit has been authorized. This observation cannot create an order.",
      strategyName: "Daily RSI mean-reversion research candidate",
      strategyContext: `${scan.qualifiedCount} symbol(s) passed all provisional checks in this scan. Parameters are proposed test variables, not validated rules.`,
      industryContext: "This first shadow milestone intentionally uses price and liquidity data only. Company and industry research will be added later and cannot override the deterministic checks.",
      companyCatalyst: `RSI ${selected.rsi.toFixed(1)} · 200-day average ${money(selected.sma200)} · 20-day average dollar volume ${money(selected.averageDollarVolume20)}.`,
      keyRisk: "Mean reversion can fail during persistent declines, gaps, earnings events, or regime changes. This candidate has not been historically validated in this product.",
      rationale: selected.checks.map((check) => `${check.passed ? "PASS" : "FAIL"} — ${check.label}`),
      agentName: "Deterministic daily scanner",
      accountLabel: "SHADOW MODE · no broker order",
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      decision: "pending",
      shadowMode: true,
      signalEligible: selected.eligible,
      signalDate: selected.signalDate,
      rulesetVersion: scan.rulesetVersion,
    });
  }

  async function createShadowObservation() {
    const response = await fetch(`${API_BASE_URL}/shadow/scan`, {
      method: "POST",
      headers: { "x-app-token": APP_TOKEN },
    });
    const result = await response.json() as { scan?: ShadowScan };
    if (!response.ok || !result.scan) throw new Error("shadow_scan_unavailable");
    applyShadowScan(result.scan);
  }

  function applyServiceProposal(serviceProposal: ServiceProposal, snapshot: BrokerSnapshot, strategySummary: StrategySummary) {
    const positionValue = serviceProposal.quantity * serviceProposal.limitPrice;
    const potentialUpside = serviceProposal.quantity * (serviceProposal.targetPrice - serviceProposal.limitPrice);
    setBroker(snapshot);
    setBrokerUnavailable(false);
    setOrderPreview(null);
    setWhatIfResult(null);
    setPaperSubmission(null);
    setWorkflowError(null);
    setProcessing(false);
    setStrategy(strategySummary);
    setProposal((current) => ({
      ...current,
      id: serviceProposal.id,
      symbol: serviceProposal.symbol,
      company: serviceProposal.company,
      side: serviceProposal.side.toUpperCase() as "BUY" | "SELL",
      quantity: serviceProposal.quantity,
      currentPrice: serviceProposal.currentPrice,
      bid: serviceProposal.bid,
      ask: serviceProposal.ask,
      limitPrice: serviceProposal.limitPrice,
      stopPrice: serviceProposal.stopPrice,
      targetPrice: serviceProposal.targetPrice,
      maxLoss: serviceProposal.maxLoss,
      positionValue,
      potentialUpside,
      potentialUpsidePercent: ((serviceProposal.targetPrice - serviceProposal.limitPrice) / serviceProposal.limitPrice) * 100,
      rationale: serviceProposal.rationale,
      strategyName: strategySummary.name,
      strategyContext: `${money(strategySummary.currentExposure)} currently allocated of a ${money(strategySummary.capitalLimit)} paper limit across up to ${strategySummary.maxOpenPositions} positions.`,
      accountLabel: `IBKR Paper ${snapshot.account ?? "connected"}`,
      quoteAge: serviceProposal.quoteDataType === 3 ? "Delayed IBKR reference" : "IBKR market data",
      expiresAt: serviceProposal.expiresAt,
      decision: "pending",
    }));
  }

  async function createPaperProposal() {
    const response = await fetch(`${API_BASE_URL}/recommendations/next`, {
      method: "POST",
      headers: { "x-app-token": APP_TOKEN },
    });
    if (!response.ok) throw new Error("proposal_unavailable");
    const result = await response.json() as { proposal: ServiceProposal; broker: BrokerSnapshot; strategy: StrategySummary };
    applyServiceProposal(result.proposal, result.broker, result.strategy);
  }

  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      for (let attempt = 0; attempt < 3 && mounted; attempt += 1) {
        try {
          await createShadowObservation();
          return;
        } catch {
          if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
        }
      }
      if (mounted) setBrokerUnavailable(true);
    };
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const expired = proposal.decision === "pending" && Date.now() >= proposal.expiresAt;
  const state: Decision = expired ? "expired" : proposal.decision;
  const brokerReady = broker !== null && !brokerUnavailable;
  const actionable = state === "pending" && !paused && brokerReady && !proposal.shadowMode;
  const timer = countdown(proposal.expiresAt);

  useEffect(() => {
    if (expired) setProposal((current) => ({ ...current, decision: "expired" }));
  }, [expired]);

  async function executeDecision(decision: "approved" | "denied") {
    setWorkflowError(null);
    setProcessing(true);
    try {
      const response = await fetch(`${API_BASE_URL}/proposals/${proposal.id}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-app-token": APP_TOKEN },
        body: JSON.stringify({ decision }),
      });
      if (!response.ok) throw new Error("decision_rejected");
      const result = await response.json() as { approval?: { token: string } };
      setProposal((current) => ({ ...current, decision }));
      if (decision === "denied") {
        setStrategy((current) => current ? { ...current, completedCount: current.completedCount + 1 } : current);
        return;
      }
      const token = result.approval?.token;
      if (!token) throw new Error("approval_missing");

      const previewResponse = await fetch(`${API_BASE_URL}/orders/preview`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-app-token": APP_TOKEN },
        body: JSON.stringify({ token }),
      });
      const previewResult = await previewResponse.json() as { preview?: OrderPreview };
      if (!previewResponse.ok || !previewResult.preview) throw new Error("preview_blocked");
      setOrderPreview(previewResult.preview);

      const whatIfResponse = await fetch(`${API_BASE_URL}/orders/what-if`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-app-token": APP_TOKEN },
        body: JSON.stringify({ token }),
      });
      const whatIfPayload = await whatIfResponse.json() as { whatIf?: WhatIfResult };
      if (!whatIfResponse.ok || !whatIfPayload.whatIf?.ok) throw new Error("what_if_blocked");
      setWhatIfResult(whatIfPayload.whatIf);
      const commission = whatIfPayload.whatIf.result?.commission;
      if (typeof commission === "number") {
        setProposal((current) => ({ ...current, estimatedFees: commission }));
      }

      const submitResponse = await fetch(`${API_BASE_URL}/orders/submit-paper`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-app-token": APP_TOKEN },
        body: JSON.stringify({ token }),
      });
      const submitPayload = await submitResponse.json() as { submission?: PaperSubmission };
      if (!submitResponse.ok || !submitPayload.submission?.ok) throw new Error("paper_submission_blocked");
      setPaperSubmission(submitPayload.submission);
      setStrategy((current) => current ? {
        ...current,
        currentExposure: Math.min(current.capitalLimit, current.currentExposure + proposal.positionValue),
        remainingCapital: Math.max(0, current.remainingCapital - proposal.positionValue),
        completedCount: current.completedCount + 1,
      } : current);
    } catch {
      setWorkflowError("The order was blocked or could not be confirmed. Check TWS before trying again.");
    } finally {
      setProcessing(false);
    }
  }

  function decide(decision: "approved" | "denied") {
    if (!actionable) return;
    if (decision === "denied") {
      void executeDecision("denied");
      return;
    }
    Alert.alert(
      "Approve and submit this PAPER trade?",
      `Send a simulated ${proposal.side} order for exactly ${proposal.quantity} shares of ${proposal.symbol}, spending no more than ${money(proposal.positionValue)} at a ${money(proposal.limitPrice)} limit.`,
      [
        { text: "Go back", style: "cancel" },
        {
          text: "Approve & submit",
          style: "default",
          onPress: () => void executeDecision("approved"),
        },
      ],
    );
  }

  async function resetDemo() {
    try {
      await createShadowObservation();
    } catch {
      Alert.alert("Unable to scan", "Completed daily history is unavailable. Confirm TWS paper is open and historical data is permitted.");
    }
    setPaused(false);
    setDetailsOpen(false);
    setRationaleOpen(false);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>SHADOW RESEARCH</Text>
            <Text style={styles.title}>Signal Review</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={paused ? "Resume proposals" : "Pause all proposals"}
            onPress={() => setPaused((value) => !value)}
            style={[styles.pauseButton, paused && styles.pauseButtonActive]}
          >
            <View style={[styles.statusDot, paused && styles.statusDotPaused]} />
            <Text style={[styles.pauseText, paused && styles.pauseTextActive]}>
              {paused ? "Paused" : "Active"}
            </Text>
          </Pressable>
        </View>

        <View style={[styles.brokerBar, brokerUnavailable && styles.brokerBarUnavailable]}>
          <View style={[styles.brokerDot, brokerUnavailable && styles.brokerDotUnavailable]} />
          <View style={styles.brokerCopy}>
            <Text style={styles.brokerTitle}>
              {proposal.shadowMode ? "Shadow mode · orders disabled" : broker ? "IBKR Paper connected" : brokerUnavailable ? "Daily history unavailable" : "Loading completed daily bars…"}
            </Text>
            {proposal.shadowMode ? (
              <Text style={styles.brokerDetail}>{proposal.rulesetVersion} · recorded for observation only</Text>
            ) : broker && (
              <Text style={styles.brokerDetail}>
                {broker.account} · {money(broker.summary.NetLiquidation?.value ?? 0)} account · {broker.quote.symbol} {money(broker.quote.last ?? broker.quote.close ?? 0)}{broker.quote.dataType === 3 ? " delayed" : ""}
              </Text>
            )}
          </View>
        </View>

        {proposal.shadowMode && (
          <View style={styles.previewBar}>
            <Text style={styles.previewTitle}>{proposal.signalEligible ? "Provisional checks passed" : "Watchlist observation · checks incomplete"}</Text>
            <Text style={styles.previewDetail}>No amount, entry, stop, target, or order will be created.</Text>
          </View>
        )}

        {strategy && (
          <View style={styles.strategyStatus}>
            <View style={styles.strategyStatusHeader}>
              <Text style={styles.strategyStatusName}>{strategy.name}</Text>
              <Text style={styles.strategyStatusCount}>{strategy.completedCount} reviewed</Text>
            </View>
            <Text style={styles.strategyStatusDetail}>
              {money(strategy.currentExposure)} allocated · {money(strategy.remainingCapital)} remaining · {strategy.universe.join(" · ")}
            </Text>
          </View>
        )}

        {orderPreview && !paperSubmission && !workflowError && (
          <View style={styles.previewBar}>
            <Text style={styles.previewTitle}>{whatIfResult ? "IBKR paper check passed" : "Paper order preview ready"} · Not submitted</Text>
            <Text style={styles.previewDetail}>
              {orderPreview.action} {orderPreview.quantity} {orderPreview.symbol} · up to {money(orderPreview.estimatedNotional)}
              {whatIfResult?.result && typeof whatIfResult.result.commission === "number" ? ` · ${money(whatIfResult.result.commission)} estimated fees` : ""}
            </Text>
          </View>
        )}

        {paperSubmission?.result && (
          <View style={styles.submittedBar}>
            <Text style={styles.submittedTitle}>IBKR PAPER order · {paperSubmission.result.status}</Text>
            <Text style={styles.submittedDetail}>
              {proposal.quantity} {proposal.symbol}{typeof paperSubmission.result.averageFillPrice === "number" && paperSubmission.result.averageFillPrice > 0 ? ` · average fill ${money(paperSubmission.result.averageFillPrice)}` : ""}
            </Text>
          </View>
        )}

        {workflowError && (
          <View style={styles.errorBar}>
            <Text style={styles.errorTitle}>Paper order not confirmed</Text>
            <Text style={styles.errorDetail}>{workflowError}</Text>
          </View>
        )}

        {paused && (
          <View style={styles.pauseBanner}>
            <Text style={styles.pauseBannerTitle}>All agents are paused</Text>
            <Text style={styles.pauseBannerText}>No proposal can be approved until you resume.</Text>
          </View>
        )}

        <View style={styles.card}>
          <View style={styles.cardTop}>
            <View style={styles.symbolBlock}>
              <Text style={styles.side}>{proposal.side}</Text>
              <Text style={styles.symbol}>{proposal.symbol}</Text>
              <Text style={styles.company}>{proposal.company}</Text>
              <View style={styles.currentPriceRow}>
                <Text style={styles.currentPrice}>{money(proposal.currentPrice)}</Text>
                <Text style={styles.quoteAge}>{proposal.quoteAge}</Text>
              </View>
            </View>
            <View style={[styles.timer, state !== "pending" && styles.timerClosed]}>
              <Text style={styles.timerLabel}>{state === "pending" ? "EXPIRES" : "STATUS"}</Text>
              <Text style={styles.timerValue}>{state === "pending" ? timer : state.toUpperCase()}</Text>
            </View>
          </View>

          <Text style={styles.account}>{proposal.agentName} · {proposal.accountLabel}</Text>

          {!proposal.shadowMode && <View style={styles.decisionSummary}>
            <View style={styles.spendBlock}>
              <Text style={styles.summaryLabel}>You’re committing</Text>
              <Text style={styles.spendValue}>{money(proposal.positionValue)}</Text>
              <Text style={styles.feeText}>
                Estimated broker fees: {money(proposal.estimatedFees)}
              </Text>
            </View>
            <View style={styles.upsideBlock}>
              <Text style={styles.upsideLabel}>MODELED UPSIDE</Text>
              <Text style={styles.upsideValue}>+{money(proposal.potentialUpside)}</Text>
              <Text style={styles.upsidePercent}>+{proposal.potentialUpsidePercent.toFixed(1)}% near {money(proposal.targetPrice)}</Text>
              <Text style={styles.timeframe}>Expected window: {proposal.targetTimeframe}</Text>
            </View>
          </View>}

          <View style={styles.planBlock}>
            <Text style={styles.planLabel}>Rough plan to sell</Text>
            <Text style={styles.planText}>{proposal.exitPlan}</Text>
          </View>

          <View style={styles.strategyBlock}>
            <Text style={styles.strategyEyebrow}>PART OF A LARGER STRATEGY</Text>
            <Text style={styles.strategyName}>{proposal.strategyName}</Text>
            <Text style={styles.strategyText}>{proposal.strategyContext}</Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: detailsOpen }}
            onPress={() => setDetailsOpen((value) => !value)}
            style={styles.accordionHeader}
          >
            <View>
              <Text style={styles.accordionTitle}>Trade details</Text>
              <Text style={styles.accordionHint}>Order, pricing and risk calculations</Text>
            </View>
            <Text style={styles.accordionIcon}>{detailsOpen ? "−" : "+"}</Text>
          </Pressable>

          {detailsOpen && (
            <View style={styles.accordionBody}>
              <View style={styles.metrics}>
                {proposal.shadowMode ? <>
                  <Metric label="Signal date" value={proposal.signalDate ?? "Unknown"} />
                  <Metric label="Reference close" value={money(proposal.currentPrice)} />
                  <Metric label="Order quantity" value="Not calculated" />
                  <Metric label="Entry / stop" value="Not defined" />
                  <Metric label="Maximum loss" value="Not defined" />
                  <Metric label="Order status" value="Disabled" />
                </> : <>
                  <Metric label="Quantity" value={`${proposal.quantity} shares`} />
                  <Metric label="Limit price" value={money(proposal.limitPrice)} />
                  <Metric label="Current bid / ask" value={`${money(proposal.bid)} / ${money(proposal.ask)}`} />
                  <Metric label="Protective stop" value={money(proposal.stopPrice)} />
                  <Metric label="Maximum planned loss" value={money(proposal.maxLoss)} />
                  <Metric label="Reward / planned risk" value={`${(proposal.potentialUpside / proposal.maxLoss).toFixed(1)} to 1`} />
                </>}
              </View>

              <View style={styles.riskRow}>
                <Text style={styles.riskLabel}>Portfolio after trade</Text>
                <Text style={styles.riskValue}>{proposal.portfolioPercent.toFixed(1)}%</Text>
              </View>
              <View style={styles.riskTrack}>
                <View style={[styles.riskFill, { width: `${Math.min(100, proposal.portfolioPercent * 8)}%` }]} />
              </View>
            </View>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: rationaleOpen }}
            onPress={() => setRationaleOpen((value) => !value)}
            style={styles.accordionHeader}
          >
            <View>
              <Text style={styles.accordionTitle}>Why this trade</Text>
              <Text style={styles.accordionHint}>Industry context, catalyst and risks</Text>
            </View>
            <Text style={styles.accordionIcon}>{rationaleOpen ? "−" : "+"}</Text>
          </Pressable>

          {rationaleOpen && (
            <View style={styles.rationaleBody}>
              <Text style={styles.contextText}>{proposal.industryContext}</Text>

              <View style={styles.contextBlock}>
                <Text style={styles.contextLabel}>Company catalyst</Text>
                <Text style={styles.contextBody}>{proposal.companyCatalyst}</Text>
              </View>

              <View style={[styles.contextBlock, styles.riskBlock]}>
                <Text style={[styles.contextLabel, styles.riskContextLabel]}>Key risk</Text>
                <Text style={styles.contextBody}>{proposal.keyRisk}</Text>
              </View>

              <Text style={styles.signalTitle}>Supporting signals</Text>
              {proposal.rationale.map((reason) => (
                <View key={reason} style={styles.reason}>
                  <View style={styles.check} />
                  <Text style={styles.reasonText}>{reason}</Text>
                </View>
              ))}

              <View style={styles.guardrail}>
                <Text style={styles.guardrailTitle}>Execution guardrail</Text>
                <Text style={styles.guardrailText}>
                  Refresh before ordering. Reject above {money(proposal.limitPrice)} or after expiration.
                </Text>
              </View>
            </View>
          )}
        </View>

      </ScrollView>

      <View style={styles.bottomBar}>
        {state === "pending" ? <View style={styles.actions}>
          <Pressable
            disabled={!actionable || processing}
            onPress={() => decide("denied")}
            style={({ pressed }) => [styles.deny, pressed && styles.pressed, (!actionable || processing) && styles.disabled]}
          >
            <Text style={styles.denyText}>{proposal.shadowMode ? "No decision" : "Deny"}</Text>
          </Pressable>
          <Pressable
            disabled={!actionable || processing}
            onPress={() => decide("approved")}
            style={({ pressed }) => [styles.approve, pressed && styles.pressed, (!actionable || processing) && styles.disabled]}
          >
            <Text style={styles.approveText}>{proposal.shadowMode ? "Shadow only" : processing ? "Checking…" : "Approve"}</Text>
          </Pressable>
        </View> : null}

        {state === "pending" && (!brokerReady || proposal.shadowMode) && (
          <Text style={styles.connectionRequired}>{proposal.shadowMode ? "Trading controls are intentionally disabled during research." : "IBKR Paper must be connected before you can decide."}</Text>
        )}

        {state !== "pending" && (
          <Pressable onPress={resetDemo} style={styles.reset}>
            <Text style={styles.resetText}>Next recommendation</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const ink = "#14251E";
const green = "#0F7A4F";
const cream = "#F4F1E8";

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: cream },
  page: { padding: 20, paddingBottom: 24, gap: 16 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
  eyebrow: { color: green, fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  title: { color: ink, fontSize: 28, fontWeight: "800", letterSpacing: -0.8, marginTop: 2 },
  pauseButton: { backgroundColor: "#E5EDE7", borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 7 },
  pauseButtonActive: { backgroundColor: "#F8DDDA" },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: green },
  statusDotPaused: { backgroundColor: "#B73A33" },
  pauseText: { color: green, fontSize: 13, fontWeight: "700" },
  pauseTextActive: { color: "#942B26" },
  pauseBanner: { backgroundColor: "#8F2F2A", borderRadius: 15, padding: 15 },
  pauseBannerTitle: { color: "white", fontWeight: "800", fontSize: 15 },
  pauseBannerText: { color: "#F8DEDC", marginTop: 3, fontSize: 13 },
  brokerBar: { backgroundColor: "#E5F2E9", borderRadius: 14, paddingHorizontal: 13, paddingVertical: 11, flexDirection: "row", alignItems: "center", gap: 9 },
  brokerBarUnavailable: { backgroundColor: "#F3E7E5" },
  brokerDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: green },
  brokerDotUnavailable: { backgroundColor: "#A94038" },
  brokerCopy: { flex: 1 },
  brokerTitle: { color: ink, fontSize: 12, fontWeight: "800" },
  brokerDetail: { color: "#5E6A62", fontSize: 10, marginTop: 2 },
  strategyStatus: { backgroundColor: "#172A22", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  strategyStatusHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  strategyStatusName: { color: "white", fontSize: 13, fontWeight: "800" },
  strategyStatusCount: { color: "#8ED0AD", fontSize: 10, fontWeight: "700" },
  strategyStatusDetail: { color: "#C8D7CF", fontSize: 10, marginTop: 5 },
  previewBar: { backgroundColor: "#FFF1C7", borderRadius: 14, paddingHorizontal: 13, paddingVertical: 11 },
  previewTitle: { color: "#6D5715", fontSize: 12, fontWeight: "800" },
  previewDetail: { color: "#6D6241", fontSize: 10, marginTop: 3 },
  submittedBar: { backgroundColor: "#DDF3E6", borderRadius: 14, paddingHorizontal: 13, paddingVertical: 11 },
  submittedTitle: { color: green, fontSize: 12, fontWeight: "800" },
  submittedDetail: { color: "#456454", fontSize: 10, marginTop: 3 },
  errorBar: { backgroundColor: "#F8DDDA", borderRadius: 14, paddingHorizontal: 13, paddingVertical: 11 },
  errorTitle: { color: "#942B26", fontSize: 12, fontWeight: "800" },
  errorDetail: { color: "#7C3A35", fontSize: 10, marginTop: 3 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 24, padding: 20, shadowColor: "#19251F", shadowOpacity: 0.08, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 4 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  symbolBlock: { flex: 1 },
  side: { color: green, fontSize: 12, fontWeight: "900", letterSpacing: 1.4 },
  symbol: { color: ink, fontSize: 38, lineHeight: 42, fontWeight: "900", letterSpacing: -1.2 },
  company: { color: "#6C776F", fontSize: 13 },
  currentPriceRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 7 },
  currentPrice: { color: ink, fontSize: 20, fontWeight: "800" },
  quoteAge: { color: "#7A857E", fontSize: 10 },
  timer: { backgroundColor: "#FFF1C7", paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, minWidth: 74, alignItems: "center" },
  timerClosed: { backgroundColor: "#E8ECE9" },
  timerLabel: { color: "#7D651D", fontSize: 9, fontWeight: "900", letterSpacing: 1.1 },
  timerValue: { color: ink, fontSize: 16, fontWeight: "800", marginTop: 2 },
  account: { color: "#5E6A62", fontSize: 12, marginTop: 14, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#DDE3DE" },
  decisionSummary: { flexDirection: "row", gap: 10, marginTop: 18 },
  spendBlock: { flex: 1.15, backgroundColor: "#F1F5F1", borderRadius: 15, padding: 14 },
  summaryLabel: { color: "#68756D", fontSize: 11, marginBottom: 3 },
  spendValue: { color: ink, fontSize: 25, fontWeight: "900", letterSpacing: -0.6 },
  feeText: { color: "#68756D", fontSize: 10, marginTop: 5 },
  upsideBlock: { flex: 1, backgroundColor: "#EAF5EE", borderRadius: 15, padding: 14 },
  upsideLabel: { color: green, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  upsideValue: { color: green, fontSize: 21, fontWeight: "900", marginTop: 4 },
  upsidePercent: { color: "#517060", fontSize: 10, lineHeight: 14, marginTop: 2 },
  timeframe: { color: ink, fontSize: 10, lineHeight: 14, fontWeight: "700", marginTop: 5 },
  planBlock: { borderWidth: 1, borderColor: "#DCE4DE", borderRadius: 15, padding: 14, marginTop: 12 },
  planLabel: { color: ink, fontSize: 12, fontWeight: "800", marginBottom: 6 },
  planText: { color: "#425148", fontSize: 13, lineHeight: 19 },
  strategyBlock: { backgroundColor: "#172A22", borderRadius: 15, padding: 15, marginTop: 12 },
  strategyEyebrow: { color: "#8ED0AD", fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  strategyName: { color: "white", fontSize: 15, fontWeight: "800", marginTop: 5 },
  strategyText: { color: "#C8D7CF", fontSize: 12, lineHeight: 17, marginTop: 5 },
  accordionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#DDE3DE", paddingVertical: 14, marginTop: 16 },
  accordionTitle: { color: ink, fontSize: 14, fontWeight: "800" },
  accordionHint: { color: "#77827B", fontSize: 10, marginTop: 2 },
  accordionIcon: { color: green, fontSize: 24, fontWeight: "500", lineHeight: 26 },
  accordionBody: { paddingTop: 8, paddingBottom: 4 },
  metrics: { flexDirection: "row", flexWrap: "wrap", marginTop: 16, marginHorizontal: -5 },
  metric: { width: "50%", padding: 5, marginBottom: 10 },
  metricLabel: { color: "#7A857E", fontSize: 11, marginBottom: 3 },
  metricValue: { color: ink, fontWeight: "700", fontSize: 14 },
  riskRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 3 },
  riskLabel: { color: "#637067", fontSize: 12 },
  riskValue: { color: ink, fontSize: 12, fontWeight: "800" },
  riskTrack: { height: 6, borderRadius: 3, backgroundColor: "#E7ECE8", marginTop: 7, overflow: "hidden" },
  riskFill: { height: "100%", borderRadius: 3, backgroundColor: green },
  rationaleBody: { paddingTop: 14 },
  contextText: { color: "#35463D", fontSize: 14, lineHeight: 21, marginBottom: 14 },
  contextBlock: { backgroundColor: "#F4F7F4", borderLeftWidth: 3, borderLeftColor: green, borderRadius: 10, padding: 13, marginBottom: 10 },
  riskBlock: { backgroundColor: "#FFF7ED", borderLeftColor: "#B66B1E" },
  contextLabel: { color: green, fontSize: 11, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 5 },
  riskContextLabel: { color: "#9A5514" },
  contextBody: { color: "#425148", fontSize: 13, lineHeight: 19 },
  signalTitle: { color: ink, fontSize: 13, fontWeight: "800", marginTop: 8, marginBottom: 11 },
  reason: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 10 },
  check: { width: 8, height: 8, borderRadius: 4, backgroundColor: green, marginTop: 5 },
  reasonText: { flex: 1, color: "#425148", fontSize: 13, lineHeight: 18 },
  guardrail: { backgroundColor: "#EFF5F0", borderRadius: 14, padding: 14, marginTop: 8 },
  guardrailTitle: { color: green, fontSize: 12, fontWeight: "800", marginBottom: 4 },
  guardrailText: { color: "#405048", fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: "row", gap: 12 },
  bottomBar: { backgroundColor: cream, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#D6D9D3", paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, shadowColor: "#17231D", shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: -6 }, elevation: 10 },
  deny: { flex: 1, height: 58, borderRadius: 17, borderWidth: 1.5, borderColor: "#A94038", alignItems: "center", justifyContent: "center", backgroundColor: "#FFFDFC" },
  approve: { flex: 1.5, height: 58, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: green },
  denyText: { color: "#A23730", fontSize: 17, fontWeight: "800" },
  approveText: { color: "white", fontSize: 17, fontWeight: "800" },
  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.35 },
  connectionRequired: { color: "#942B26", fontSize: 11, textAlign: "center", marginTop: 8 },
  reset: { alignSelf: "center", paddingVertical: 9, paddingHorizontal: 14 },
  resetText: { color: green, fontSize: 13, fontWeight: "700" },
});
