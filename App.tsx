import React, { useCallback, useEffect, useRef, useState } from "react";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { ThemeProvider } from "@shopify/restyle";
import { CheckCircleIcon, CircleIcon, ClockIcon, ListIcon } from "phosphor-react-native";
import {
  Alert,
  Animated,
  Easing,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ActionButton, Toast } from "./src/components/ui";
import { AppText as Text, Box as View, palette, radius, spacing, theme, typeRamp } from "./src/design-system";

type Decision = "pending" | "approved" | "denied" | "expired";
type BrokerConnectionStatus = "checking" | "connected" | "disconnected";
type AppToast = { tone: "info" | "success" | "danger"; title: string; message?: string };

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
  marketRisk?: MarketRiskAssessment;
};

type RiskComponent = {
  id: string;
  label: string;
  score: number;
  maximumPoints: number;
  status: "COMPLETE" | "INCOMPLETE";
  explanation: string;
};
type MarketRiskAssessment = {
  modelVersion: string;
  status: "COMPLETE" | "INCOMPLETE";
  score: number | null;
  level: "LOWER" | "MODERATE" | "HIGH" | "VERY_HIGH" | null;
  components: RiskComponent[];
  limitations?: string[];
  tradeRisk?: { status: "INCOMPLETE"; score: null; missing: string[] };
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
  marketRisk: MarketRiskAssessment;
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
  researchContext?: string | null;
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
const physicalDeviceApiUrl = process.env.EXPO_PUBLIC_TRADE_API_URL
  ?? (developmentHost ? `http://${developmentHost}:8787` : "http://127.0.0.1:8787");
const API_BASE_URL = Device.isDevice ? physicalDeviceApiUrl : "http://127.0.0.1:8787";
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

const UI_PROPOSALS: Proposal[] = [
  PAPER_PROPOSAL,
  {
    ...PAPER_PROPOSAL,
    id: "preview-aapl",
    symbol: "AAPL",
    company: "Apple Inc.",
    side: "BUY",
    quantity: 4,
    currentPrice: 229.42,
    bid: 229.38,
    ask: 229.46,
    limitPrice: 229.55,
    stopPrice: 224.9,
    maxLoss: 18.6,
    positionValue: 918.2,
    targetPrice: 238,
    potentialUpside: 33.8,
    potentialUpsidePercent: 3.7,
    strategyName: "Large-cap pullback recovery",
    strategyContext: "A measured entry within the strategy's large-cap technology allocation.",
    companyCatalyst: "Apple is recovering from a controlled pullback while services growth and the next device cycle support demand expectations.",
    rationale: ["Price reclaimed its 20-day average", "Selling volume eased during the pullback", "Position remains below the per-trade limit"],
    expiresAt: Date.now() + 8 * 60 * 1000,
  },
  {
    ...PAPER_PROPOSAL,
    id: "preview-amzn",
    symbol: "AMZN",
    company: "Amazon.com, Inc.",
    side: "BUY",
    quantity: 5,
    currentPrice: 181.76,
    bid: 181.72,
    ask: 181.8,
    limitPrice: 181.9,
    stopPrice: 177.8,
    maxLoss: 20.5,
    positionValue: 909.5,
    targetPrice: 190,
    potentialUpside: 40.5,
    potentialUpsidePercent: 4.5,
    strategyName: "Cloud-growth momentum",
    strategyContext: "Part of a diversified growth basket with a defined loss limit on every position.",
    companyCatalyst: "Amazon's cloud and advertising businesses provide the fundamental backdrop for a short-term continuation setup.",
    rationale: ["Trading above the 200-day average", "Relative strength improved this week", "Risk fits the strategy budget"],
    expiresAt: Date.now() + 3 * 60 * 1000,
  },
  {
    ...PAPER_PROPOSAL,
    id: "preview-tsla-sell",
    symbol: "TSLA",
    company: "Tesla, Inc.",
    side: "SELL",
    quantity: 3,
    currentPrice: 342.15,
    bid: 342.08,
    ask: 342.22,
    limitPrice: 341.9,
    stopPrice: 350.5,
    maxLoss: 25.8,
    positionValue: 1025.7,
    targetPrice: 325,
    potentialUpside: 50.7,
    potentialUpsidePercent: 5,
    strategyName: "Volatility risk reduction",
    strategyContext: "Reduces exposure after the position moved beyond the strategy's volatility tolerance.",
    companyCatalyst: "Tesla's recent price volatility has increased faster than the strategy's risk budget, prompting a proposed reduction rather than a directional short.",
    rationale: ["Position volatility exceeded its limit", "Portfolio exposure is above target", "Reduction restores available risk budget"],
    expiresAt: Date.now() + 6 * 60 * 1000,
    decision: "pending",
  },
  {
    ...PAPER_PROPOSAL,
    id: "preview-msft",
    symbol: "MSFT",
    company: "Microsoft Corporation",
    quantity: 2,
    currentPrice: 505.4,
    limitPrice: 505.7,
    positionValue: 1011.4,
    targetPrice: 526,
    potentialUpside: 40.6,
    companyCatalyst: "Microsoft's cloud and AI infrastructure businesses provide the backdrop for a measured continuation setup.",
    expiresAt: Date.now() + 7 * 60 * 1000,
  },
  {
    ...PAPER_PROPOSAL,
    id: "preview-meta",
    symbol: "META",
    company: "Meta Platforms, Inc.",
    quantity: 2,
    currentPrice: 612.25,
    limitPrice: 612.6,
    positionValue: 1225.2,
    targetPrice: 638,
    potentialUpside: 50.8,
    companyCatalyst: "Advertising demand and ongoing AI investment support the fundamental context for this short-term momentum proposal.",
    expiresAt: Date.now() + 8 * 60 * 1000,
  },
  {
    ...PAPER_PROPOSAL,
    id: "preview-googl",
    symbol: "GOOGL",
    company: "Alphabet Inc.",
    quantity: 5,
    currentPrice: 201.3,
    limitPrice: 201.5,
    positionValue: 1007.5,
    targetPrice: 210.4,
    potentialUpside: 44.5,
    companyCatalyst: "Search resilience and cloud growth provide the business context while the strategy evaluates a short-term continuation.",
    expiresAt: Date.now() + 9 * 60 * 1000,
  },
  {
    ...PAPER_PROPOSAL,
    id: "preview-spy",
    symbol: "SPY",
    company: "SPDR S&P 500 ETF Trust",
    quantity: 2,
    currentPrice: 654.2,
    limitPrice: 654.5,
    positionValue: 1309,
    targetPrice: 668,
    potentialUpside: 27,
    companyCatalyst: "Broad-market participation is being evaluated as a lower-concentration alternative to an individual growth-stock position.",
    expiresAt: Date.now() + 10 * 60 * 1000,
  },
  {
    ...PAPER_PROPOSAL,
    id: "preview-qqq",
    symbol: "QQQ",
    company: "Invesco QQQ Trust",
    quantity: 2,
    currentPrice: 579.6,
    limitPrice: 579.9,
    positionValue: 1159.8,
    targetPrice: 596,
    potentialUpside: 32.2,
    companyCatalyst: "Large-cap technology breadth provides diversified exposure to the same growth trend as the individual-stock candidates.",
    expiresAt: Date.now() + 11 * 60 * 1000,
  },
  {
    ...PAPER_PROPOSAL,
    id: "preview-iwm",
    symbol: "IWM",
    company: "iShares Russell 2000 ETF",
    quantity: 5,
    currentPrice: 231.8,
    limitPrice: 232,
    positionValue: 1160,
    targetPrice: 240.5,
    potentialUpside: 42.5,
    companyCatalyst: "Improving market breadth is being evaluated through diversified small-cap exposure rather than a single-company catalyst.",
    expiresAt: Date.now() + 12 * 60 * 1000,
  },
];

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

const COMPANY_DOMAINS: Record<string, string> = {
  SPY: "ssga.com",
  QQQ: "invesco.com",
  IWM: "ishares.com",
  AAPL: "apple.com",
  MSFT: "microsoft.com",
  NVDA: "nvidia.com",
  AMZN: "amazon.com",
  META: "meta.com",
  GOOGL: "google.com",
  TSLA: "tesla.com",
};

function CompanyMark({ symbol, size = 34 }: { symbol: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const domain = COMPANY_DOMAINS[symbol];

  if (!domain || failed) {
    return (
      <View style={[styles.logoFallback, { width: size, height: size, borderRadius: size / 2 }]}>
        <Text style={styles.logoFallbackText}>{symbol.slice(0, 2)}</Text>
      </View>
    );
  }

  return (
    <Image
      accessibilityLabel={`${symbol} company logo`}
      onError={() => setFailed(true)}
      source={{ uri: `https://www.google.com/s2/favicons?domain=${domain}&sz=128` }}
      style={{ width: size, height: size, borderRadius: size / 2 }}
    />
  );
}

const money = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

const firstTwoSentences = (value: string) => {
  const sentences = value.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [value];
  return sentences.slice(0, 2).join(" ").trim();
};

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
  const [brokerConnectionStatus, setBrokerConnectionStatus] = useState<BrokerConnectionStatus>("checking");
  const [brokerUnavailable, setBrokerUnavailable] = useState(false);
  const [orderPreview, setOrderPreview] = useState<OrderPreview | null>(null);
  const [whatIfResult, setWhatIfResult] = useState<WhatIfResult | null>(null);
  const [paperSubmission, setPaperSubmission] = useState<PaperSubmission | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [appToast, setAppToast] = useState<AppToast | null>(null);
  const [processing, setProcessing] = useState(false);
  const [decisionInFlight, setDecisionInFlight] = useState<"approved" | "denied" | null>(null);
  const [strategy, setStrategy] = useState<StrategySummary | null>(null);
  const [uiPreview, setUiPreview] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [reviewedExampleIds, setReviewedExampleIds] = useState<string[]>([]);
  const [sampleDeckComplete, setSampleDeckComplete] = useState(false);
  const [openSection, setOpenSection] = useState<"rationale" | "strategy" | "news" | null>(null);
  const [cardWidth, setCardWidth] = useState(0);
  const cardPosition = useRef(new Animated.ValueXY()).current;
  const cardEntryProgress = useRef(new Animated.Value(1)).current;
  const cardAnimating = useRef(false);
  const dismissToast = useCallback(() => setAppToast(null), []);

  function applyShadowScan(scan: ShadowScan) {
    if (!scan.selected) throw new Error(scan.error ?? "shadow_data_unavailable");
    const selected = scan.selected;
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
      marketRisk: selected.marketRisk,
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
      companyCatalyst: serviceProposal.researchContext ?? current.companyCatalyst,
      strategyName: strategySummary.name,
      strategyContext: `${money(strategySummary.currentExposure)} currently allocated of a ${money(strategySummary.capitalLimit)} paper limit across up to ${strategySummary.maxOpenPositions} positions.`,
      accountLabel: `IBKR Paper ${snapshot.account ?? "connected"}`,
      quoteAge: serviceProposal.quoteDataType === 3 ? "Delayed IBKR reference" : "IBKR market data",
      expiresAt: serviceProposal.expiresAt,
      decision: "pending",
      shadowMode: false,
      signalEligible: true,
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
    setBrokerConnectionStatus("connected");
    setUiPreview(false);
  }

  async function checkBrokerConnection() {
    try {
      const response = await fetch(`${API_BASE_URL}/broker/snapshot?symbol=NVDA`, {
        headers: { "x-app-token": APP_TOKEN },
      });
      const snapshot = await response.json() as BrokerSnapshot;
      const connected = response.ok && snapshot.ok && snapshot.environment === "paper";
      setBrokerConnectionStatus(connected ? "connected" : "disconnected");
      if (connected) {
        setBroker(snapshot);
        setBrokerUnavailable(false);
      } else {
        setBroker(null);
      }
    } catch {
      setBrokerConnectionStatus("disconnected");
      setBroker(null);
    }
  }

  async function openPaperRecommendation() {
    setWorkflowError(null);
    setProcessing(true);
    try {
      await createPaperProposal();
    } catch {
      setBrokerConnectionStatus("disconnected");
      Alert.alert(
        "Paper recommendation unavailable",
        "Confirm TWS is open in Paper Trading, API access is enabled, and the local trade service is running.",
      );
    } finally {
      setProcessing(false);
    }
  }

  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    void checkBrokerConnection();
    const connectionTimer = setInterval(() => void checkBrokerConnection(), 15000);
    return () => clearInterval(connectionTimer);
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

  async function executeDecision(decision: "approved" | "denied"): Promise<boolean> {
    setWorkflowError(null);
    setAppToast(decision === "approved"
      ? { tone: "info", title: "Checking paper order", message: "Validating the account, price, and order with IBKR Paper." }
      : null);
    setProcessing(true);
    setDecisionInFlight(decision);
    try {
      const response = await fetch(`${API_BASE_URL}/proposals/${proposal.id}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-app-token": APP_TOKEN },
        body: JSON.stringify({ decision }),
      });
      if (!response.ok) throw new Error("decision_rejected");
      const result = await response.json() as { approval?: { token: string } };
      if (decision === "denied") {
        setStrategy((current) => current ? { ...current, completedCount: current.completedCount + 1 } : current);
        setAppToast({ tone: "info", title: "Recommendation denied", message: "No order was sent." });
        return true;
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

      setAppToast({ tone: "info", title: "Submitting to IBKR Paper", message: "Waiting for the broker to acknowledge the simulated order." });

      const submitResponse = await fetch(`${API_BASE_URL}/orders/submit-paper`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-app-token": APP_TOKEN },
        body: JSON.stringify({ token }),
      });
      const submitPayload = await submitResponse.json() as {
        error?: string;
        submission?: PaperSubmission & { error?: string; errors?: Array<{ message?: string }> };
      };
      if (!submitResponse.ok || !submitPayload.submission?.ok) {
        throw new Error(
          submitPayload.error
          ?? submitPayload.submission?.error
          ?? submitPayload.submission?.errors?.[0]?.message
          ?? "paper_submission_blocked"
        );
      }
      setPaperSubmission(submitPayload.submission);
      setAppToast({
        tone: "success",
        title: "Paper order submitted",
        message: `${proposal.quantity} ${proposal.symbol} · ${submitPayload.submission.result?.status ?? "Acknowledged by IBKR"}`,
      });
      setStrategy((current) => current ? {
        ...current,
        currentExposure: Math.min(current.capitalLimit, current.currentExposure + proposal.positionValue),
        remainingCapital: Math.max(0, current.remainingCapital - proposal.positionValue),
        completedCount: current.completedCount + 1,
      } : current);
      return true;
    } catch (error) {
      const code = error instanceof Error ? error.message : "paper_submission_blocked";
      const message = code === "invalid_or_expired_approval"
        ? "The approval expired before submission. Request a new recommendation."
        : code === "final_safety_check_blocked"
          ? "The price, account, or order no longer matched the approved safety limits."
          : code === "ibkr_unavailable_approval_consumed"
            ? "IBKR became unavailable during submission. Check TWS before requesting a new recommendation."
            : `The order was not sent. ${code.replaceAll("_", " ")}.`;
      setWorkflowError(message);
      setAppToast({ tone: "danger", title: "Paper order not submitted", message });
      return false;
    } finally {
      setProcessing(false);
      setDecisionInFlight(null);
    }
  }

  function dismissResolvedLiveCard(decision: "approved" | "denied") {
    if (cardAnimating.current) return;
    cardAnimating.current = true;
    Animated.timing(cardPosition, {
      toValue: { x: decision === "approved" ? 520 : -520, y: 18 },
      duration: 280,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: true,
    }).start(() => {
      cardPosition.setValue({ x: 0, y: 0 });
      cardAnimating.current = false;
      returnToScanner();
    });
  }

  async function completeDecision(decision: "approved" | "denied") {
    const succeeded = await executeDecision(decision);
    if (succeeded) dismissResolvedLiveCard(decision);
  }

  function decide(decision: "approved" | "denied") {
    if (!actionable) return;
    if (decision === "denied") {
      void completeDecision("denied");
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
          onPress: () => void completeDecision("approved"),
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
    setPreviewIndex(0);
    setReviewedExampleIds([]);
    setSampleDeckComplete(false);
    cardAnimating.current = false;
    cardPosition.setValue({ x: 0, y: 0 });
    cardEntryProgress.setValue(1);
    setProposal({ ...UI_PROPOSALS[0]!, expiresAt: Date.now() + 4 * 60 * 1000 });
  }

  function finishSampleDecision(_decision: "approved" | "denied") {
    const reviewed = [...reviewedExampleIds, proposal.id];
    const nextIndex = UI_PROPOSALS.findIndex((item) => !reviewed.includes(item.id));
    setReviewedExampleIds(reviewed);
    if (nextIndex === -1) {
      setSampleDeckComplete(true);
      return;
    }
    const next = UI_PROPOSALS[nextIndex]!;
    setPreviewIndex(nextIndex);
    setProposal({
      ...next,
      decision: next.decision === "expired" ? "expired" : "pending",
      expiresAt: next.decision === "expired" ? Date.now() - 30 * 1000 : Date.now() + (nextIndex + 3) * 60 * 1000,
    });
  }

  function animateSampleDecision(decision: "approved" | "denied") {
    if (cardAnimating.current) return;
    cardAnimating.current = true;
    Animated.timing(cardPosition, {
      toValue: { x: decision === "approved" ? 520 : -520, y: 18 },
      duration: 280,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: true,
    }).start(() => {
      cardEntryProgress.setValue(0);
      cardPosition.setValue({ x: 0, y: 0 });
      finishSampleDecision(decision);
      requestAnimationFrame(() => {
        Animated.timing(cardEntryProgress, {
          toValue: 1,
          duration: 220,
          easing: Easing.bezier(0.22, 1, 0.36, 1),
          useNativeDriver: true,
        }).start(() => { cardAnimating.current = false; });
      });
    });
  }

  function navigateSampleCard(step: -1 | 1, exitDirection: -1 | 1) {
    if (cardAnimating.current) return;
    const available = UI_PROPOSALS
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !reviewedExampleIds.includes(item.id));
    const currentPosition = available.findIndex(({ item }) => item.id === proposal.id);
    if (available.length < 2 || currentPosition === -1) {
      Animated.spring(cardPosition, {
        toValue: { x: 0, y: 0 },
        useNativeDriver: true,
      }).start();
      return;
    }

    const nextPosition = (currentPosition + step + available.length) % available.length;
    const next = available[nextPosition]!;
    cardAnimating.current = true;
    Animated.timing(cardPosition, {
      toValue: { x: exitDirection * 520, y: 12 },
      duration: 280,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: true,
    }).start(() => {
      cardEntryProgress.setValue(0);
      setPreviewIndex(next.index);
      setProposal({
        ...next.item,
        decision: next.item.decision === "expired" ? "expired" : "pending",
        expiresAt: next.item.decision === "expired" ? Date.now() - 30 * 1000 : Date.now() + (next.index + 3) * 60 * 1000,
      });
      cardPosition.setValue({ x: 0, y: 0 });
      requestAnimationFrame(() => {
        Animated.timing(cardEntryProgress, {
          toValue: 1,
          duration: 220,
          easing: Easing.bezier(0.22, 1, 0.36, 1),
          useNativeDriver: true,
        }).start(() => { cardAnimating.current = false; });
      });
    });
  }

  const cardPanResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) =>
      uiPreview && Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderMove: (_, gesture) => {
      cardPosition.setValue({ x: gesture.dx, y: Math.abs(gesture.dx) * 0.025 });
    },
    onPanResponderRelease: (_, gesture) => {
      if (Math.abs(gesture.dx) >= 90) {
        if (gesture.dx > 0) navigateSampleCard(1, 1);
        else navigateSampleCard(1, -1);
      } else {
        Animated.spring(cardPosition, {
          toValue: { x: 0, y: 0 },
          useNativeDriver: true,
        }).start();
      }
    },
    onPanResponderTerminate: () => {
      Animated.spring(cardPosition, {
        toValue: { x: 0, y: 0 },
        useNativeDriver: true,
      }).start();
    },
  });

  const cardRotation = cardPosition.x.interpolate({
    inputRange: [-240, 0, 240],
    outputRange: ["-8deg", "0deg", "8deg"],
    extrapolate: "clamp",
  });
  const nextCardScale = cardPosition.x.interpolate({
    inputRange: [-520, 0, 520],
    outputRange: [1, 0.985, 1],
    extrapolate: "clamp",
  });
  const nextCardTranslateY = cardPosition.x.interpolate({
    inputRange: [-520, 0, 520],
    outputRange: [0, 10, 0],
    extrapolate: "clamp",
  });
  const backCardScale = cardPosition.x.interpolate({
    inputRange: [-520, 0, 520],
    outputRange: [0.985, 0.97, 0.985],
    extrapolate: "clamp",
  });
  const backCardTranslateY = cardPosition.x.interpolate({
    inputRange: [-520, 0, 520],
    outputRange: [10, 20, 10],
    extrapolate: "clamp",
  });
  const cardEntryOpacity = cardEntryProgress.interpolate({
    inputRange: [0, 0.45, 1],
    outputRange: [0, 0.75, 1],
  });
  const cardEntryScale = cardEntryProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.985, 1],
  });
  const cardEntryTranslateY = cardEntryProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 0],
  });

  function returnToScanner() {
    setOpenSection(null);
    setUiPreview(false);
    setWorkflowError(null);
    setOrderPreview(null);
    setWhatIfResult(null);
    setPaperSubmission(null);
    setProcessing(false);
    setDecisionInFlight(null);
    setProposal(SHADOW_LOADING);
    void createShadowObservation().catch(() => setBrokerUnavailable(true));
  }

  function openMenu() {
    const actions: Array<{ text: string; style?: "cancel"; onPress?: () => void }> = [];
    if (!proposal.shadowMode) {
      actions.push({ text: "Back to scanner", onPress: returnToScanner });
    }
    actions.push(
      { text: "Get paper recommendation", onPress: () => void openPaperRecommendation() },
      { text: "Preview examples", onPress: previewActiveProposal },
      { text: paused ? "Resume scanner" : "Pause scanner", onPress: () => setPaused((value) => !value) },
      { text: "Close", style: "cancel" },
    );
    Alert.alert(
      "Menu",
      `${paused ? "Scanner paused" : "Scanner running"}\nIBKR Paper: ${brokerConnectionStatus === "connected" ? "Connected" : brokerConnectionStatus === "checking" ? "Checking" : "Offline"}`,
      actions,
    );
  }

  return (
    <ThemeProvider theme={theme}>
    <SafeAreaProvider>
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <View style={styles.appHeader}>
          <Pressable accessibilityRole="button" accessibilityLabel="Open menu" onPress={openMenu} style={styles.menuButton}>
            <ListIcon size={23} color={palette.ink} weight="regular" />
          </Pressable>
          <View style={styles.marketPill}>
            <CircleIcon
              size={8}
              weight="fill"
              color={brokerConnectionStatus === "connected" ? "#22A447" : brokerConnectionStatus === "checking" ? "#D99000" : "#D64545"}
            />
            <Text style={styles.marketText}>
              {brokerConnectionStatus === "connected" ? "Paper connected" : brokerConnectionStatus === "checking" ? "Checking paper" : "Paper offline"}
            </Text>
          </View>
        </View>

        {appToast && (
          <View style={styles.toastLayer}>
            <Toast {...appToast} onDismiss={dismissToast} duration={appToast.tone === "info" && processing ? 0 : 5500} />
          </View>
        )}

        {paused && (
          <View style={styles.pauseBanner}>
            <Text style={styles.pauseBannerTitle}>All agents are paused</Text>
            <Text style={styles.pauseBannerText}>No proposal can be approved until you resume.</Text>
          </View>
        )}

        {proposal.shadowMode && (
          <View style={styles.homeDashboard}>
            <Text style={styles.homeTitle}>Trade recommendations</Text>
            <Text style={styles.homeSummary}>
              {brokerUnavailable
                ? "Recommendations are unavailable until the paper connection is restored."
                : proposal.id === "shadow-loading"
                  ? "Checking for trades that meet your current rules."
                  : proposal.signalEligible
                    ? "1 trade is ready for your review."
                    : "No trades currently meet your rules."}
            </Text>

            <Pressable
              accessibilityRole="button"
              disabled={processing || brokerConnectionStatus !== "connected"}
              onPress={() => void openPaperRecommendation()}
              style={({ pressed }) => [
                styles.homeAction,
                (processing || brokerConnectionStatus !== "connected") && styles.homeActionDisabled,
                pressed && styles.homeActionPressed,
              ]}
            >
              <Text style={styles.homeActionText}>
                {processing
                  ? "Checking…"
                  : proposal.signalEligible
                    ? "Review trade"
                    : "Check for recommendations"}
              </Text>
            </Pressable>
          </View>
        )}

        {!proposal.shadowMode && sampleDeckComplete && (
          <View style={styles.deckComplete}>
            <Text style={styles.deckCompleteTitle}>Review complete</Text>
            <Text style={styles.deckCompleteBody}>You approved or denied all {UI_PROPOSALS.length} sample proposals.</Text>
            <Pressable onPress={previewActiveProposal} style={styles.previewProposalButton}>
              <Text style={styles.previewProposalButtonText}>Review again</Text>
            </Pressable>
          </View>
        )}

        {!proposal.shadowMode && !sampleDeckComplete && (
          <View style={styles.deckStage}>
            {uiPreview && <Animated.View pointerEvents="none" style={[styles.stackCard, styles.stackCardBack, { transform: [{ translateY: backCardTranslateY }, { scale: backCardScale }] }]} />}
            {uiPreview && <Animated.View pointerEvents="none" style={[styles.stackCard, styles.stackCardNext, { transform: [{ translateY: nextCardTranslateY }, { scale: nextCardScale }] }]} />}
            <Animated.View
            {...(uiPreview ? cardPanResponder.panHandlers : {})}
            style={[
              styles.proposalCard,
              {
                opacity: cardEntryOpacity,
                transform: [
                  { translateX: cardPosition.x },
                  { translateY: Animated.add(cardPosition.y, cardEntryTranslateY) },
                  { rotate: cardRotation },
                  { scale: cardEntryScale },
                ],
              },
            ]}
          >
            <Pressable
              onLayout={(event) => setCardWidth(event.nativeEvent.layout.width)}
              onPress={(event) => {
                if (!uiPreview || cardWidth === 0) return;
                if (event.nativeEvent.locationX >= cardWidth / 2) navigateSampleCard(1, 1);
                else navigateSampleCard(1, -1);
              }}
              style={styles.cardBody}
            >
              <View style={styles.companyIdentity}>
                <CompanyMark symbol={proposal.symbol} size={42} />
                <Text style={styles.company} numberOfLines={1}>{proposal.company}</Text>
              </View>
              <Text style={styles.tradeHeadline}>
                {proposal.side === "BUY" ? "Buy" : "Sell"} {money(proposal.positionValue)} of {proposal.symbol}
              </Text>
              <Text style={styles.tradePrice}>at current price {money(proposal.currentPrice)}</Text>

              <View style={styles.tradeTerms}>
                <View style={styles.tradeTermRow}>
                  <Text style={styles.tradeTermLabel}>{proposal.side === "BUY" ? "Receive" : "Sell"}</Text>
                  <Text style={styles.tradeTermValue}>{proposal.quantity} shares</Text>
                </View>
                <View style={styles.tradeTermRow}>
                  <Text style={styles.tradeTermLabel}>Limit price</Text>
                  <Text style={styles.tradeTermValue}>{money(proposal.limitPrice)}</Text>
                </View>
                <View style={styles.tradeTermRow}>
                  <Text style={styles.tradeTermLabel}>Risk score</Text>
                  <View style={styles.riskTermValue}>
                    <Text style={styles.riskTermScore}>
                      {proposal.marketRisk?.score != null ? `${proposal.marketRisk.score.toFixed(0)}/100` : "Incomplete"}
                    </Text>
                    {proposal.marketRisk?.level && (
                      <Text style={styles.riskTermLevel}>{proposal.marketRisk.level.replace("_", " ")}</Text>
                    )}
                  </View>
                </View>
                <View style={styles.tradeTermRow}>
                  <Text style={styles.tradeTermLabel}>{state === "pending" ? "Expires in" : "Status"}</Text>
                  <View style={[styles.timer, state !== "pending" && styles.timerClosed]}>
                    <ClockIcon size={15} color={palette.muted} weight="regular" />
                    <Text style={[styles.timerValue, state !== "pending" && styles.timerClosedText]}>{state === "pending" ? timer : state.toUpperCase()}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.infoCard}>
                <Text style={styles.infoCardTitle}>Why this trade</Text>
                <Text style={styles.infoCardBody}>{firstTwoSentences(proposal.companyCatalyst)}</Text>
              </View>
            </Pressable>
            <View style={styles.cardFooter}>
              {state === "pending" ? <View style={styles.actions}>
                <ActionButton
                  label={decisionInFlight === "denied" ? "Denying…" : "Deny"}
                  tone="secondary"
                  pending={decisionInFlight === "denied"}
                  disabled={!uiPreview && (!actionable || processing)}
                  onPress={() => uiPreview ? animateSampleDecision("denied") : decide("denied")}
                />
                <ActionButton
                  label={decisionInFlight === "approved" ? "Submitting…" : "Approve"}
                  tone="primary"
                  pending={decisionInFlight === "approved"}
                  disabled={!uiPreview && (!actionable || processing)}
                  onPress={() => uiPreview ? animateSampleDecision("approved") : decide("approved")}
                />
              </View> : state === "expired" ? (
                <View style={styles.actions}>
                  <ActionButton
                    label="Dismiss"
                    tone="secondary"
                    onPress={() => uiPreview ? animateSampleDecision("denied") : dismissResolvedLiveCard("denied")}
                  />
                </View>
              ) : (
                uiPreview ? <View style={styles.actions}>
                  <ActionButton label="Deny" tone="secondary" onPress={() => animateSampleDecision("denied")} />
                  <ActionButton label="Approve" tone="primary" onPress={() => animateSampleDecision("approved")} />
                </View> : <Pressable onPress={resetDemo} style={styles.reset}>
                    <Text style={styles.resetText}>Next recommendation</Text>
                  </Pressable>
              )}
              {state === "pending" && !uiPreview && !brokerReady ? (
                <Text style={styles.connectionRequired}>IBKR Paper must be connected before you can decide.</Text>
              ) : null}
            </View>
            </Animated.View>
          </View>
        )}

      </ScrollView>

      <Modal
        visible={openSection !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpenSection(null)}
      >
        <SafeAreaView style={styles.sheetSafe} edges={["top", "bottom", "left", "right"]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>
              {openSection === "rationale" ? "Why this trade" : openSection === "strategy" ? "Strategy" : "Recent news"}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close details" onPress={() => setOpenSection(null)} style={styles.sheetClose}>
              <Text style={styles.sheetCloseText}>Done</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
            {openSection === "rationale" && (
              <>
                <Text style={styles.sheetBody}>{proposal.companyCatalyst}</Text>
                {proposal.rationale.map((reason) => (
                  <View key={reason} style={styles.infoRow}>
                    <CheckCircleIcon size={17} color={palette.accent} weight="regular" />
                    <Text style={styles.infoRowText}>{reason}</Text>
                  </View>
                ))}
                <View style={styles.sheetSection}>
                  <Text style={styles.sheetSectionTitle}>Key risk</Text>
                  <Text style={styles.sheetBody}>{proposal.keyRisk}</Text>
                </View>
              </>
            )}

            {openSection === "strategy" && (
              <>
                <Text style={styles.strategyCardName}>{proposal.strategyName}</Text>
                <Text style={styles.sheetBody}>{proposal.strategyContext}</Text>
                <View style={styles.sheetSection}>
                  <Text style={styles.sheetSectionTitle}>Trade parameters</Text>
                  <View style={styles.metrics}>
                    <Metric label="Total commitment" value={money(proposal.positionValue)} />
                    <Metric label="Shares" value={`${proposal.quantity}`} />
                    <Metric label="Protective stop" value={money(proposal.stopPrice)} />
                    <Metric label="Target timeframe" value={proposal.targetTimeframe} />
                  </View>
                </View>
              </>
            )}

            {openSection === "news" && (
              <View style={styles.sheetSection}>
                <Text style={styles.infoCardMuted}>No verified news source is connected yet. Articles will appear here with their source and publication time.</Text>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
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
  page: { flexGrow: 1, width: "100%", maxWidth: 680, alignSelf: "center", paddingHorizontal: spacing.large, paddingTop: spacing.small, paddingBottom: spacing.large },
  appHeader: { minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  toastLayer: { position: "absolute", top: 66, left: spacing.large, right: spacing.large, zIndex: 20 },
  menuButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center", backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 20 },
  marketPill: { height: 34, flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: palette.surfaceMuted, borderWidth: 0, borderRadius: radius.pill, paddingHorizontal: 12 },
  marketText: { color: palette.text, ...typeRamp.caption, fontWeight: "700" },
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
  homeDashboard: { flex: 1, minHeight: 500, paddingTop: 52, paddingBottom: 20 },
  homeTitle: { color: palette.ink, fontSize: 30, lineHeight: 36, fontWeight: "800", letterSpacing: -0.8 },
  homeSummary: { color: palette.muted, ...typeRamp.body, marginTop: 8, maxWidth: 520 },
  homeAction: { minHeight: 56, alignItems: "center", justifyContent: "center", backgroundColor: palette.accent, borderRadius: radius.pill, marginTop: 28, paddingHorizontal: 20 },
  homeActionDisabled: { opacity: 0.35 },
  homeActionPressed: { opacity: 0.72 },
  homeActionText: { color: palette.surface, fontSize: 16, lineHeight: 22, fontWeight: "800" },
  scannerCard: { paddingVertical: 24 },
  scannerTitle: { color: palette.ink, ...typeRamp.title },
  scannerStatus: { color: palette.muted, ...typeRamp.body, marginTop: 5 },
  symbolChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 18 },
  symbolChip: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: palette.surfaceMuted, borderRadius: radius.pill, paddingLeft: 5, paddingRight: 12, paddingVertical: 5 },
  symbolChipText: { color: palette.ink, ...typeRamp.caption, fontWeight: "700" },
  logoFallback: { alignItems: "center", justifyContent: "center", backgroundColor: palette.surfaceMuted, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border },
  logoFallbackText: { color: palette.ink, fontSize: 9, lineHeight: 12, fontWeight: "800" },
  previewProposalButton: { alignItems: "center", justifyContent: "center", minHeight: 46, borderWidth: 1, borderColor: palette.border, borderRadius: radius.medium, marginTop: 20, paddingHorizontal: 14 },
  previewProposalButtonText: { color: palette.ink, ...typeRamp.label, fontWeight: "700" },
  previewNavigation: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end" },
  nextExample: { paddingVertical: 4, paddingLeft: 12 },
  nextExampleText: { color: palette.text, ...typeRamp.caption, fontWeight: "600" },
  deckStage: { flex: 1, minHeight: 590, marginTop: 8, marginBottom: 12, paddingTop: 20 },
  stackCard: { position: "absolute", backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 28, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowRadius: 8 },
  stackCardBack: { top: 0, bottom: 20, left: 14, right: 14, zIndex: 1, shadowOpacity: 0.03 },
  stackCardNext: { top: 10, bottom: 10, left: 7, right: 7, zIndex: 2, shadowOpacity: 0.045 },
  proposalCard: { flex: 1, zIndex: 3, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 28, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.055, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  deckComplete: { minHeight: 420, alignItems: "center", justifyContent: "center", backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 28, marginTop: 8, padding: 28 },
  deckCompleteTitle: { color: palette.ink, ...typeRamp.title, textAlign: "center" },
  deckCompleteBody: { color: palette.muted, ...typeRamp.body, textAlign: "center", marginTop: 8 },
  cardBody: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 4 },
  cardPosition: { alignItems: "center", marginBottom: 10 },
  cardPositionText: { color: palette.muted, ...typeRamp.caption },
  infoCard: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border, paddingVertical: 11 },
  infoCardHeadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 3 },
  infoCardTitle: { color: palette.ink, ...typeRamp.label, fontWeight: "800", marginBottom: 3 },
  infoCardBody: { color: palette.text, ...typeRamp.body },
  infoCardMuted: { color: palette.muted, ...typeRamp.body },
  riskHeadline: { color: palette.ink, fontSize: 18, lineHeight: 24, fontWeight: "800", marginBottom: 2 },
  strategyCardName: { color: palette.ink, ...typeRamp.label, fontWeight: "700", marginBottom: 5 },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 9, marginTop: 10 },
  infoDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: palette.muted, marginTop: 7 },
  infoRowText: { flex: 1, color: palette.text, ...typeRamp.body },
  learnMoreButton: { paddingVertical: 5, paddingLeft: 12 },
  learnMoreText: { color: palette.ink, ...typeRamp.caption, fontWeight: "600", textDecorationLine: "underline" },
  connectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginBottom: 10 },
  connectionDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.ink },
  connectionDotOff: { backgroundColor: palette.muted },
  connectionText: { color: palette.text, fontSize: 11, lineHeight: 16, fontWeight: "600" },
  sheetSafe: { flex: 1, backgroundColor: palette.surface },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 58, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border },
  sheetTitle: { color: palette.ink, ...typeRamp.title },
  sheetClose: { paddingHorizontal: 4, paddingVertical: 8 },
  sheetCloseText: { color: palette.ink, ...typeRamp.label, fontWeight: "700" },
  sheetContent: { padding: 20, paddingBottom: 40, gap: 24 },
  sheetSection: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border, paddingBottom: 24 },
  sheetSectionTitle: { color: palette.ink, ...typeRamp.heading, marginBottom: 10 },
  sheetBody: { color: palette.text, ...typeRamp.body },
  riskScoreHero: { backgroundColor: palette.warningSoft, borderRadius: radius.medium, padding: 18 },
  riskScoreEyebrow: { color: "#8A5800", fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  riskScoreValue: { color: palette.ink, fontSize: 34, lineHeight: 40, fontWeight: "800", marginTop: 5 },
  riskScoreLevel: { color: "#72521B", ...typeRamp.label, fontWeight: "700", marginTop: 2 },
  riskComponent: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border, paddingBottom: 18 },
  riskComponentHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  riskComponentLabel: { color: palette.ink, ...typeRamp.label, fontWeight: "800" },
  riskComponentPoints: { color: palette.text, ...typeRamp.label, fontWeight: "700" },
  riskComponentTrack: { height: 7, borderRadius: 4, backgroundColor: palette.surfaceMuted, marginTop: 10, overflow: "hidden" },
  riskComponentFill: { height: "100%", borderRadius: 4, backgroundColor: "#D99000" },
  riskComponentExplanation: { color: palette.text, ...typeRamp.body, marginTop: 8 },
  incompleteTradeRisk: { backgroundColor: palette.surfaceMuted, borderRadius: radius.medium, padding: 16 },
  incompleteTradeRiskTitle: { color: palette.ink, ...typeRamp.label, fontWeight: "800" },
  incompleteTradeRiskBody: { color: palette.text, ...typeRamp.body, marginTop: 5 },
  riskFootnote: { color: palette.muted, ...typeRamp.caption },
  card: { paddingTop: 24, paddingBottom: 22 },
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
  companyIdentity: { flexDirection: "row", alignItems: "center", gap: 12 },
  company: { flex: 1, color: palette.ink, ...typeRamp.label, fontWeight: "700" },
  tradeHeadline: { color: palette.ink, fontSize: 26, lineHeight: 32, fontWeight: "800", letterSpacing: -0.6, marginTop: 10 },
  tradePrice: { color: palette.muted, ...typeRamp.body, marginTop: 1 },
  tradeTerms: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border, marginTop: 14, paddingTop: 3 },
  tradeTermRow: { minHeight: 39, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  tradeTermLabel: { color: palette.ink, ...typeRamp.body, fontWeight: "600" },
  tradeTermValue: { color: palette.text, ...typeRamp.body, fontWeight: "600", textAlign: "right" },
  riskTermValue: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6 },
  riskTermScore: { color: palette.text, ...typeRamp.body, fontWeight: "600", textAlign: "right" },
  riskTermLevel: { color: "#8A5800", fontSize: 9, lineHeight: 13, fontWeight: "800", letterSpacing: 0.5 },
  riskTermChevron: { color: palette.muted, fontSize: 20, lineHeight: 21 },
  currentPriceRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 7 },
  currentPrice: { color: palette.ink, fontSize: 22, fontWeight: "800" },
  quoteAge: { color: palette.muted, fontSize: 10 },
  timer: { height: 32, backgroundColor: palette.surfaceMuted, borderWidth: 0, paddingHorizontal: 10, borderRadius: radius.pill, minWidth: 70, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 5 },
  timerClosed: { backgroundColor: palette.surfaceMuted, borderColor: palette.surfaceMuted },
  timerLabel: { color: palette.muted, fontSize: 9, fontWeight: "800", letterSpacing: 1.1 },
  timerValue: { color: palette.text, ...typeRamp.caption, fontWeight: "700" },
  timerClosedText: { color: palette.muted, fontWeight: "600" },
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
  cardFooter: { backgroundColor: palette.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14 },
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
