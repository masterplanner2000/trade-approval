import React, { useEffect, useState } from "react";
import Constants from "expo-constants";
import { ThemeProvider } from "@shopify/restyle";
import {
  Alert,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ActionButton } from "./src/components/ui";
import { AppText as Text, Box as View, palette, radius, spacing, theme } from "./src/design-system";

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

const SHADOW_UNIVERSE = ["SPY", "QQQ", "IWM", "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA"];

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
  const [uiPreview, setUiPreview] = useState(false);

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

  function previewActiveProposal() {
    setUiPreview(true);
    setBroker(null);
    setBrokerUnavailable(false);
    setProposal({ ...PAPER_PROPOSAL, id: "ui-preview", decision: "pending" });
  }

  function returnToScanner() {
    setUiPreview(false);
    setProposal(SHADOW_LOADING);
    void createShadowObservation().catch(() => setBrokerUnavailable(true));
  }

  return (
    <ThemeProvider theme={theme}>
    <SafeAreaProvider>
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Review</Text>
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

        {proposal.shadowMode && (
          <View style={styles.scannerCard}>
            <Text style={styles.scannerTitle}>Reviewing symbols</Text>
            <Text style={styles.scannerStatus}>
              {brokerUnavailable ? "The daily review could not be completed." : proposal.id === "shadow-loading" ? "Checking completed daily market data…" : "Daily review complete."}
            </Text>
            <View style={styles.symbolChips}>
              {SHADOW_UNIVERSE.map((symbol) => (
                <View key={symbol} style={styles.symbolChip}>
                  <Text style={styles.symbolChipText}>{symbol}</Text>
                </View>
              ))}
            </View>
            <Pressable onPress={previewActiveProposal} style={styles.previewProposalButton}>
              <Text style={styles.previewProposalButtonText}>Preview a proposed trade</Text>
            </Pressable>
          </View>
        )}

        {uiPreview && !proposal.shadowMode && (
          <Pressable onPress={returnToScanner} style={styles.backToScanner}>
            <Text style={styles.backToScannerText}>‹ Back to scanner</Text>
          </Pressable>
        )}

        {!proposal.shadowMode && <View style={styles.card}>
          <View style={styles.quoteHero}>
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

          </View>

          {proposal.shadowMode && (
            <View style={styles.observationBlock}>
              <Text style={styles.observationTitle}>No trade proposed</Text>
              <Text style={styles.observationText}>This is a research observation only.</Text>
            </View>
          )}

          {!proposal.shadowMode && <View style={styles.decisionSummary}>
            <View style={styles.spendBlock}>
              <Text style={styles.summaryLabel}>Total commitment</Text>
              <Text style={styles.spendValue}>{money(proposal.positionValue)}</Text>
              <Text style={styles.feeText}>{proposal.quantity} shares at a {money(proposal.limitPrice)} limit</Text>
            </View>
          </View>}
        </View>}

        {!proposal.shadowMode && (
          <>
            <View style={styles.infoCard}>
              <Text style={styles.infoCardTitle}>Why this trade</Text>
              <Text style={styles.infoCardBody}>{proposal.companyCatalyst}</Text>
              {proposal.rationale.slice(0, 2).map((reason) => (
                <View key={reason} style={styles.infoRow}>
                  <View style={styles.infoDot} />
                  <Text style={styles.infoRowText}>{reason}</Text>
                </View>
              ))}
            </View>

            <View style={styles.infoCard}>
              <Text style={styles.infoCardTitle}>Strategy</Text>
              <Text style={styles.strategyCardName}>{proposal.strategyName}</Text>
              <Text style={styles.infoCardBody}>{proposal.strategyContext}</Text>
            </View>

            <View style={styles.infoCard}>
              <Text style={styles.infoCardTitle}>Recent news</Text>
              <Text style={styles.infoCardMuted}>No verified news source is connected yet.</Text>
            </View>
          </>
        )}

      </ScrollView>

      {!proposal.shadowMode && <View style={styles.bottomBar}>
        {state === "pending" ? <View style={styles.actions}>
          <ActionButton
            label={proposal.shadowMode ? "No decision" : "Deny"}
            tone="secondary"
            disabled={uiPreview || !actionable || processing}
            onPress={() => decide("denied")}
          />
          <ActionButton
            label={proposal.shadowMode ? "Shadow only" : processing ? "Checking…" : "Approve"}
            tone="primary"
            flex={1.5}
            disabled={uiPreview || !actionable || processing}
            onPress={() => decide("approved")}
          />
        </View> : null}

        {state === "pending" && (uiPreview || !brokerReady || proposal.shadowMode) && (
          <Text style={styles.connectionRequired}>{uiPreview ? "Preview only—no order can be submitted." : proposal.shadowMode ? "Trading controls are intentionally disabled during research." : "IBKR Paper must be connected before you can decide."}</Text>
        )}

        {state !== "pending" && (
          <Pressable onPress={resetDemo} style={styles.reset}>
            <Text style={styles.resetText}>Next recommendation</Text>
          </Pressable>
        )}
      </View>}
    </SafeAreaView>
    </SafeAreaProvider>
    </ThemeProvider>
  );
}

const ink = palette.ink;
const green = palette.accent;
const cream = palette.canvas;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: cream },
  page: { width: "100%", maxWidth: 680, alignSelf: "center", padding: spacing.large, paddingBottom: spacing.large, gap: spacing.medium },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
  eyebrow: { color: green, fontSize: 10, fontWeight: "800", letterSpacing: 1.6 },
  title: { color: ink, fontSize: 30, lineHeight: 38, fontWeight: "800", letterSpacing: -1 },
  pauseButton: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.pill, paddingHorizontal: 13, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 7 },
  pauseButtonActive: { backgroundColor: palette.dangerSoft, borderColor: "#F4C8D0" },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: green },
  statusDotPaused: { backgroundColor: palette.danger },
  pauseText: { color: green, fontSize: 13, fontWeight: "700" },
  pauseTextActive: { color: palette.danger },
  pauseBanner: { backgroundColor: palette.danger, borderRadius: radius.medium, padding: 15 },
  pauseBannerTitle: { color: "white", fontWeight: "800", fontSize: 15 },
  pauseBannerText: { color: "#F8DEDC", marginTop: 3, fontSize: 13 },
  brokerBar: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.medium, paddingHorizontal: 14, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  brokerBarUnavailable: { backgroundColor: palette.dangerSoft, borderColor: "#F4C8D0" },
  brokerDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: green },
  brokerDotUnavailable: { backgroundColor: palette.danger },
  brokerCopy: { flex: 1 },
  brokerTitle: { color: ink, fontSize: 12, fontWeight: "800" },
  brokerDetail: { color: palette.muted, fontSize: 10, marginTop: 2 },
  strategyStatus: { backgroundColor: palette.ink, borderRadius: radius.medium, paddingHorizontal: 14, paddingVertical: 12 },
  strategyStatusHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  strategyStatusName: { color: "white", fontSize: 13, fontWeight: "800" },
  strategyStatusCount: { color: "#B8B4FF", fontSize: 10, fontWeight: "700" },
  strategyStatusDetail: { color: "#C9D4DF", fontSize: 10, marginTop: 5 },
  previewBar: { backgroundColor: palette.warningSoft, borderRadius: radius.medium, paddingHorizontal: 13, paddingVertical: 11 },
  previewTitle: { color: "#6D5715", fontSize: 12, fontWeight: "800" },
  previewDetail: { color: "#6D6241", fontSize: 10, marginTop: 3 },
  submittedBar: { backgroundColor: "#DDF3E6", borderRadius: 14, paddingHorizontal: 13, paddingVertical: 11 },
  submittedTitle: { color: green, fontSize: 12, fontWeight: "800" },
  submittedDetail: { color: "#456454", fontSize: 10, marginTop: 3 },
  errorBar: { backgroundColor: "#F8DDDA", borderRadius: 14, paddingHorizontal: 13, paddingVertical: 11 },
  errorTitle: { color: "#942B26", fontSize: 12, fontWeight: "800" },
  errorDetail: { color: "#7C3A35", fontSize: 10, marginTop: 3 },
  scannerCard: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.large, padding: 20 },
  scannerTitle: { color: palette.ink, fontSize: 20, lineHeight: 26, fontWeight: "800" },
  scannerStatus: { color: palette.muted, fontSize: 13, lineHeight: 18, marginTop: 5 },
  symbolChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 18 },
  symbolChip: { backgroundColor: palette.surfaceMuted, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 8 },
  symbolChipText: { color: palette.ink, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  previewProposalButton: { alignItems: "center", justifyContent: "center", minHeight: 46, borderWidth: 1, borderColor: palette.border, borderRadius: radius.medium, marginTop: 20, paddingHorizontal: 14 },
  previewProposalButtonText: { color: palette.ink, fontSize: 14, lineHeight: 18, fontWeight: "700" },
  backToScanner: { alignSelf: "flex-start", paddingVertical: 4, paddingRight: 12 },
  backToScannerText: { color: palette.text, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  infoCard: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.large, padding: 20 },
  infoCardTitle: { color: palette.ink, fontSize: 16, lineHeight: 22, fontWeight: "800", marginBottom: 10 },
  infoCardBody: { color: palette.text, fontSize: 13, lineHeight: 19 },
  infoCardMuted: { color: palette.muted, fontSize: 13, lineHeight: 19 },
  strategyCardName: { color: palette.ink, fontSize: 14, lineHeight: 20, fontWeight: "700", marginBottom: 5 },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 9, marginTop: 10 },
  infoDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: palette.muted, marginTop: 7 },
  infoRowText: { flex: 1, color: palette.text, fontSize: 13, lineHeight: 19 },
  card: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.large, padding: 20, shadowColor: "#0A2540", shadowOpacity: 0.07, shadowRadius: 28, shadowOffset: { width: 0, height: 12 }, elevation: 4, overflow: "hidden" },
  cardEyebrowRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18 },
  signalBadge: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: palette.accentSoft, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 7 },
  signalBadgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.accent },
  signalBadgeText: { color: palette.accentDark, fontSize: 9, fontWeight: "900", letterSpacing: 0.9 },
  ruleset: { flexShrink: 1, color: palette.muted, fontSize: 9, textAlign: "right" },
  quoteHero: { backgroundColor: palette.surface, borderRadius: 0, paddingVertical: 6 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  symbolBlock: { flex: 1 },
  side: { color: palette.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1.4 },
  symbol: { color: palette.ink, fontSize: 42, lineHeight: 46, fontWeight: "800", letterSpacing: -1.5 },
  company: { color: palette.text, fontSize: 13 },
  currentPriceRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 7 },
  currentPrice: { color: palette.ink, fontSize: 22, fontWeight: "800" },
  quoteAge: { color: palette.muted, fontSize: 10 },
  timer: { backgroundColor: palette.surfaceMuted, paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.small, minWidth: 74, alignItems: "center" },
  timerClosed: { backgroundColor: palette.surfaceMuted },
  timerLabel: { color: palette.muted, fontSize: 9, fontWeight: "800", letterSpacing: 1.1 },
  timerValue: { color: palette.ink, fontSize: 16, fontWeight: "800", marginTop: 2 },
  account: { color: "#9FB3C8", fontSize: 11, marginTop: 16, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#314962" },
  observationBlock: { backgroundColor: palette.surfaceMuted, borderRadius: radius.medium, padding: 16, marginTop: 16 },
  observationLabel: { color: palette.accentDark, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  observationTitle: { color: palette.ink, fontSize: 17, lineHeight: 22, fontWeight: "800", marginTop: 7 },
  observationText: { color: palette.text, fontSize: 12, lineHeight: 18, marginTop: 5 },
  decisionSummary: { flexDirection: "row", gap: 10, marginTop: 18 },
  spendBlock: { flex: 1.15, backgroundColor: "#F1F5F1", borderRadius: 15, padding: 14 },
  summaryLabel: { color: "#68756D", fontSize: 11, marginBottom: 3 },
  spendValue: { color: ink, fontSize: 25, fontWeight: "900", letterSpacing: -0.6 },
  feeText: { color: palette.text, fontSize: 13, lineHeight: 18, fontWeight: "600", marginTop: 7 },
  upsideBlock: { flex: 1, backgroundColor: "#EAF5EE", borderRadius: 15, padding: 14 },
  upsideLabel: { color: green, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  upsideValue: { color: green, fontSize: 21, fontWeight: "900", marginTop: 4 },
  upsidePercent: { color: "#517060", fontSize: 10, lineHeight: 14, marginTop: 2 },
  timeframe: { color: ink, fontSize: 10, lineHeight: 14, fontWeight: "700", marginTop: 5 },
  planBlock: { borderWidth: 0, borderBottomWidth: 1, borderColor: palette.border, borderRadius: 0, paddingHorizontal: 2, paddingVertical: 16, marginTop: 2 },
  planLabel: { color: ink, fontSize: 12, fontWeight: "800", marginBottom: 6 },
  planText: { color: "#425148", fontSize: 13, lineHeight: 19 },
  strategyBlock: { backgroundColor: palette.surfaceMuted, borderRadius: radius.medium, padding: 16, marginTop: 14 },
  strategyEyebrow: { color: palette.accentDark, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  strategyName: { color: palette.ink, fontSize: 15, fontWeight: "800", marginTop: 5 },
  strategyText: { color: palette.text, fontSize: 12, lineHeight: 18, marginTop: 5 },
  accordionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.border, paddingVertical: 16, marginTop: 8 },
  accordionTitle: { color: ink, fontSize: 14, fontWeight: "800" },
  accordionHint: { color: palette.muted, fontSize: 10, marginTop: 2 },
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
  contextBlock: { backgroundColor: palette.surfaceMuted, borderLeftWidth: 3, borderLeftColor: green, borderRadius: 10, padding: 13, marginBottom: 10 },
  riskBlock: { backgroundColor: "#FFF7ED", borderLeftColor: "#B66B1E" },
  contextLabel: { color: green, fontSize: 11, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 5 },
  riskContextLabel: { color: "#9A5514" },
  contextBody: { color: "#425148", fontSize: 13, lineHeight: 19 },
  signalTitle: { color: ink, fontSize: 13, fontWeight: "800", marginTop: 8, marginBottom: 11 },
  reason: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 10 },
  check: { width: 8, height: 8, borderRadius: 4, backgroundColor: green, marginTop: 5 },
  reasonText: { flex: 1, color: "#425148", fontSize: 13, lineHeight: 18 },
  guardrail: { backgroundColor: palette.accentSoft, borderRadius: radius.medium, padding: 14, marginTop: 8 },
  guardrailTitle: { color: green, fontSize: 12, fontWeight: "800", marginBottom: 4 },
  guardrailText: { color: "#405048", fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: "row", gap: 12 },
  bottomBar: { width: "100%", maxWidth: 680, alignSelf: "center", backgroundColor: palette.canvas, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 10, shadowColor: "#0A2540", shadowOpacity: 0.07, shadowRadius: 18, shadowOffset: { width: 0, height: -6 }, elevation: 10 },
  deny: { flex: 1, height: 56, borderRadius: radius.medium, borderWidth: 1, borderColor: palette.border, alignItems: "center", justifyContent: "center", backgroundColor: palette.surface },
  approve: { flex: 1.5, height: 56, borderRadius: radius.medium, alignItems: "center", justifyContent: "center", backgroundColor: green },
  denyText: { color: palette.ink, fontSize: 16, fontWeight: "800" },
  approveText: { color: "white", fontSize: 17, fontWeight: "800" },
  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.35 },
  connectionRequired: { color: palette.muted, fontSize: 11, textAlign: "center", marginTop: 8 },
  reset: { alignSelf: "center", paddingVertical: 9, paddingHorizontal: 14 },
  resetText: { color: green, fontSize: 13, fontWeight: "700" },
});
