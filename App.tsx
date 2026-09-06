import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { ThemeProvider } from "@shopify/restyle";
import { CheckCircleIcon, CircleIcon, ClockIcon, ListIcon, MoonIcon, SunIcon } from "phosphor-react-native";
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
  useWindowDimensions,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ActionButton, Toast } from "./src/components/ui";
import { AppText as Text, Box as View, darkPalette, darkTheme, palette, radius, spacing, theme, type AppPalette, typeRamp } from "./src/design-system";

type VisualThemeContextValue = {
  colors: AppPalette;
  styles: ReturnType<typeof createStyles>;
};

const VisualThemeContext = createContext<VisualThemeContextValue | null>(null);

function useVisualTheme() {
  const value = useContext(VisualThemeContext);
  if (!value) throw new Error("VisualThemeContext is unavailable");
  return value;
}

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
  automaticExits?: boolean;
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
  targetTimeframe: string;
  maxLoss: number;
  quantity: number;
  expiresAt: number;
  quoteDataType: number | null;
  rationale: string[];
  researchContext?: string | null;
  marketRisk?: MarketRiskAssessment;
  exitPolicy: {
    mode: "broker_bracket";
    protectiveStopPrice: number;
    profitTargetPrice: number;
    entryTimeInForce: "DAY";
    exitTimeInForce: "GTC";
    automatic: true;
  };
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
  universeSource: "alpaca-cache";
  universeLimit: number;
};

type OrderPreview = {
  action: string;
  symbol: string;
  quantity: number;
  limitPrice: number;
  estimatedNotional: number;
  protectiveStop: number;
  profitTarget: number;
  automatedExits: boolean;
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
  exitOrders?: Array<{
    orderId: number;
    status: string;
    action?: string;
    orderType?: string;
    parentId?: number | null;
  } | null>;
  warnings?: Array<{ code?: number; message?: string }>;
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
  automaticExits: true,
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
    id: "preview-tsla",
    symbol: "TSLA",
    company: "Tesla, Inc.",
    side: "BUY",
    quantity: 3,
    currentPrice: 342.15,
    bid: 342.08,
    ask: 342.22,
    limitPrice: 342.3,
    stopPrice: 334.8,
    maxLoss: 22.5,
    positionValue: 1026.9,
    targetPrice: 356,
    potentialUpside: 41.1,
    potentialUpsidePercent: 4,
    strategyName: "Large-cap momentum continuation",
    strategyContext: "A smaller position sized for Tesla's higher volatility.",
    companyCatalyst: "Tesla's price momentum is being evaluated with a smaller position and a predefined protective exit because volatility remains elevated.",
    rationale: ["Momentum remains positive", "Position size reflects higher volatility", "Protective exit is defined before entry"],
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
  const { styles } = useVisualTheme();
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

const qualitativeRisk = (risk?: MarketRiskAssessment) => {
  if (!risk || risk.status !== "COMPLETE" || !risk.level) return "Unavailable";
  if (risk.level === "LOWER") return "Low";
  if (risk.level === "VERY_HIGH") return "Very high";
  return risk.level.charAt(0) + risk.level.slice(1).toLowerCase();
};

function countdown(expiresAt: number) {
  const seconds = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function Metric({ label, value }: { label: string; value: string }) {
  const { styles } = useVisualTheme();
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function PreviewCardFace({ proposal }: { proposal: Proposal }) {
  const { colors, styles } = useVisualTheme();
  const previewState: Decision = proposal.decision === "expired" || Date.now() >= proposal.expiresAt ? "expired" : proposal.decision;
  const previewExpiringSoon = previewState === "pending" && proposal.expiresAt - Date.now() <= 60_000;
  return (
    <>
      <View style={styles.cardBody}>
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
            <Text style={styles.tradeTermLabel}>Risk</Text>
            <View style={styles.riskChip}>
              <Text style={styles.riskChipText}>{qualitativeRisk(proposal.marketRisk)}</Text>
            </View>
          </View>
          <View style={styles.tradeTermRow}>
            <Text style={styles.tradeTermLabel}>{previewState === "pending" ? "Expires in" : "Status"}</Text>
            <View style={[
              styles.timer,
              previewExpiringSoon && styles.timerWarning,
              previewState === "expired" && styles.timerExpired,
              previewState !== "pending" && previewState !== "expired" && styles.timerClosed,
            ]}>
              <ClockIcon size={15} color={previewState === "expired" ? "#B42318" : previewExpiringSoon ? "#854D0E" : colors.muted} weight="regular" />
              <Text style={[
                styles.timerValue,
                previewExpiringSoon && styles.timerWarningText,
                previewState === "expired" && styles.timerExpiredText,
                previewState !== "pending" && previewState !== "expired" && styles.timerClosedText,
              ]}>
                {previewState === "pending" ? countdown(proposal.expiresAt) : previewState.toUpperCase()}
              </Text>
            </View>
          </View>
          {proposal.automaticExits && (
            <>
              <View style={styles.tradeTermRow}>
                <Text style={styles.tradeTermLabel}>Profit target</Text>
                <Text style={styles.tradeTermValue}>Sell at {money(proposal.targetPrice)}</Text>
              </View>
              <View style={styles.tradeTermRow}>
                <Text style={styles.tradeTermLabel}>Total profit</Text>
                <Text style={styles.tradeTermValue}>+{money(proposal.potentialUpside)}</Text>
              </View>
              <View style={styles.tradeTermRow}>
                <Text style={styles.tradeTermLabel}>Time horizon</Text>
                <Text style={styles.tradeTermValue}>{proposal.targetTimeframe}</Text>
              </View>
              <View style={styles.tradeTermRow}>
                <Text style={styles.tradeTermLabel}>Protective stop</Text>
                <Text style={styles.tradeTermValue}>Trigger at {money(proposal.stopPrice)}</Text>
              </View>
            </>
          )}
        </View>
        <View style={styles.infoCard}>
          <Text style={styles.infoCardTitle}>Why this trade</Text>
          <Text style={styles.infoCardBody}>{firstTwoSentences(proposal.companyCatalyst)}</Text>
        </View>
      </View>
      <View style={styles.cardFooter}>
        <View style={styles.actions}>
          <ActionButton label="Deny" tone="secondary" onPress={() => {}} />
          <ActionButton label="Approve" tone="primary" onPress={() => {}} />
        </View>
      </View>
    </>
  );
}

export default function App() {
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const [darkMode, setDarkMode] = useState(false);
  const colors = darkMode ? darkPalette : palette;
  const activeTheme = darkMode ? darkTheme : theme;
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [proposal, setProposal] = useState(SHADOW_LOADING);
  const [paused, setPaused] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [rationaleOpen, setRationaleOpen] = useState(false);
  const [, tick] = useState(0);
  const [broker, setBroker] = useState<BrokerSnapshot | null>(null);
  const [brokerConnectionStatus, setBrokerConnectionStatus] = useState<BrokerConnectionStatus>("checking");
  const [brokerUnavailable, setBrokerUnavailable] = useState(false);
  const [noEligibleRecommendation, setNoEligibleRecommendation] = useState(false);
  const [orderPreview, setOrderPreview] = useState<OrderPreview | null>(null);
  const [whatIfResult, setWhatIfResult] = useState<WhatIfResult | null>(null);
  const [paperSubmission, setPaperSubmission] = useState<PaperSubmission | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [appToast, setAppToast] = useState<AppToast | null>(null);
  const [processing, setProcessing] = useState(false);
  const [showRecommendationSkeleton, setShowRecommendationSkeleton] = useState(false);
  const [decisionInFlight, setDecisionInFlight] = useState<"approved" | "denied" | null>(null);
  const [strategy, setStrategy] = useState<StrategySummary | null>(null);
  const [uiPreview, setUiPreview] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [reviewedExampleIds, setReviewedExampleIds] = useState<string[]>([]);
  const [sampleDeckComplete, setSampleDeckComplete] = useState(false);
  const [transitionCard, setTransitionCard] = useState<Proposal | null>(null);
  const [openSection, setOpenSection] = useState<"rationale" | "strategy" | "news" | null>(null);
  const [cardWidth, setCardWidth] = useState(0);
  const cardPosition = useRef(new Animated.ValueXY()).current;
  const cardEntryProgress = useRef(new Animated.Value(1)).current;
  const skeletonPulse = useRef(new Animated.Value(0.52)).current;
  const cardAnimating = useRef(false);
  const cardWasDragged = useRef(false);
  const suppressCardTapUntil = useRef(0);
  const brokerCheckInFlight = useRef(false);
  const brokerFailureCount = useRef(0);
  const orderWorkflowInFlight = useRef(false);
  const recommendationScanInFlight = useRef(false);
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
      targetTimeframe: serviceProposal.targetTimeframe,
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
      automaticExits: serviceProposal.exitPolicy.automatic,
      marketRisk: serviceProposal.marketRisk,
      exitPlan: `If the buy fills, IBKR Paper will automatically place a profit-taking sell at ${money(serviceProposal.exitPolicy.profitTargetPrice)} and a protective stop sell triggered at ${money(serviceProposal.exitPolicy.protectiveStopPrice)}.`,
    }));
  }

  async function createPaperProposal() {
    const response = await fetch(`${API_BASE_URL}/recommendations/next`, {
      method: "POST",
      headers: { "x-app-token": APP_TOKEN },
    });
    const result = await response.json() as { proposal: ServiceProposal; broker: BrokerSnapshot; strategy: StrategySummary; error?: string };
    if (!response.ok) throw new Error(result.error ?? "proposal_unavailable");
    applyServiceProposal(result.proposal, result.broker, result.strategy);
    setNoEligibleRecommendation(false);
    setBrokerConnectionStatus("connected");
    setUiPreview(false);
  }

  async function checkBrokerConnection() {
    if (brokerCheckInFlight.current || orderWorkflowInFlight.current) return;
    brokerCheckInFlight.current = true;
    try {
      const response = await fetch(`${API_BASE_URL}/broker/snapshot?symbol=NVDA`, {
        headers: { "x-app-token": APP_TOKEN },
      });
      const snapshot = await response.json() as BrokerSnapshot;
      const connected = response.ok && snapshot.ok && snapshot.environment === "paper";
      if (!connected) throw new Error("paper_snapshot_unavailable");
      brokerFailureCount.current = 0;
      setBrokerConnectionStatus("connected");
      setBroker(snapshot);
    } catch {
      brokerFailureCount.current += 1;
      if (brokerFailureCount.current >= 3) {
        setBrokerConnectionStatus("disconnected");
        setBroker(null);
      }
    } finally {
      brokerCheckInFlight.current = false;
    }
  }

  async function openPaperRecommendation() {
    if (recommendationScanInFlight.current) return;
    recommendationScanInFlight.current = true;
    setWorkflowError(null);
    setProcessing(true);
    try {
      await createPaperProposal();
    } catch {
      Alert.alert(
        "Paper recommendation unavailable",
        "Confirm TWS is open in Paper Trading, API access is enabled, and the local trade service is running.",
      );
    } finally {
      recommendationScanInFlight.current = false;
      setProcessing(false);
    }
  }

  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!processing || !proposal.shadowMode) {
      setShowRecommendationSkeleton(false);
      skeletonPulse.stopAnimation();
      skeletonPulse.setValue(0.52);
      return;
    }
    const delay = setTimeout(() => setShowRecommendationSkeleton(true), 250);
    return () => clearTimeout(delay);
  }, [processing, proposal.shadowMode, skeletonPulse]);

  useEffect(() => {
    if (!showRecommendationSkeleton) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(skeletonPulse, { toValue: 0.92, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(skeletonPulse, { toValue: 0.52, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [showRecommendationSkeleton, skeletonPulse]);

  useEffect(() => {
    void checkBrokerConnection();
    const connectionTimer = setInterval(() => void checkBrokerConnection(), 15000);
    return () => clearInterval(connectionTimer);
  }, []);

  useEffect(() => {
    if (brokerConnectionStatus !== "connected" || !proposal.shadowMode || paused) return;

    let active = true;
    const scan = async () => {
      if (!active || recommendationScanInFlight.current || orderWorkflowInFlight.current) return;
      recommendationScanInFlight.current = true;
      setProcessing(true);
      setBrokerUnavailable(false);
      try {
        await createPaperProposal();
      } catch (error) {
        if (!active) return;
        const code = error instanceof Error ? error.message : "proposal_unavailable";
        setNoEligibleRecommendation(code === "no_eligible_recommendation");
        setBrokerUnavailable(code !== "no_eligible_recommendation");
      } finally {
        recommendationScanInFlight.current = false;
        if (active) setProcessing(false);
      }
    };

    void scan();
    const scanTimer = setInterval(() => void scan(), 30_000);
    return () => {
      active = false;
      clearInterval(scanTimer);
    };
  }, [brokerConnectionStatus, paused, proposal.shadowMode]);

  const expired = proposal.decision === "pending" && Date.now() >= proposal.expiresAt;
  const state: Decision = expired ? "expired" : proposal.decision;
  const expiringSoon = state === "pending" && proposal.expiresAt - Date.now() <= 60_000;
  const brokerReady = broker !== null && brokerConnectionStatus === "connected";
  const actionable = state === "pending" && !paused && brokerReady && !proposal.shadowMode;
  const timer = countdown(proposal.expiresAt);

  useEffect(() => {
    if (expired) setProposal((current) => ({ ...current, decision: "expired" }));
  }, [expired]);

  async function executeDecision(decision: "approved" | "denied"): Promise<boolean> {
    orderWorkflowInFlight.current = true;
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

      setAppToast({ tone: "info", title: "Submitting paper bracket", message: "Waiting for IBKR to acknowledge the buy and both automatic exit orders." });

      const submitResponse = await fetch(`${API_BASE_URL}/orders/submit-paper`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-app-token": APP_TOKEN },
        body: JSON.stringify({ token }),
      });
      const submitPayload = await submitResponse.json() as {
        error?: string;
        submission?: PaperSubmission & { error?: string; errors?: Array<{ code?: number; message?: string }> };
      };
      if (!submitResponse.ok || !submitPayload.submission?.ok) {
        const brokerError = submitPayload.submission?.errors?.[0];
        throw new Error(
          submitPayload.error
          ?? submitPayload.submission?.error
          ?? (brokerError?.message ? `IBKR${brokerError.code ? ` ${brokerError.code}` : ""}: ${brokerError.message}` : undefined)
          ?? "paper_submission_blocked"
        );
      }
      setPaperSubmission(submitPayload.submission);
      const queuedForOpen = submitPayload.submission.result?.status === "PreSubmitted"
        && submitPayload.submission.warnings?.some((warning) => warning.code === 399);
      setAppToast({
        tone: "success",
        title: queuedForOpen ? "Paper order queued" : "Paper bracket submitted",
        message: queuedForOpen
          ? `${proposal.quantity} ${proposal.symbol} · accepted by IBKR and scheduled for the next regular market open.`
          : `${proposal.quantity} ${proposal.symbol} · buy plus protective stop and profit target acknowledged`,
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
      orderWorkflowInFlight.current = false;
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
      "Approve this PAPER buy and automatic exits?",
      `Buy exactly ${proposal.quantity} shares of ${proposal.symbol} at a ${money(proposal.limitPrice)} limit. If filled, IBKR Paper may automatically sell at the ${money(proposal.targetPrice)} profit target or the ${money(proposal.stopPrice)} protective stop. A stop does not guarantee the execution price.`,
      [
        { text: "Go back", style: "cancel" },
        {
          text: "Approve buy & exits",
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
    setTransitionCard(null);
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
    const preparedNext: Proposal = {
      ...next.item,
      decision: next.item.decision === "expired" ? "expired" : "pending",
      expiresAt: next.item.decision === "expired" ? Date.now() - 30 * 1000 : Date.now() + (next.index + 3) * 60 * 1000,
    };
    cardAnimating.current = true;
    setTransitionCard(preparedNext);
    requestAnimationFrame(() => {
      Animated.timing(cardPosition, {
        toValue: { x: exitDirection * viewportWidth * 1.5, y: 0 },
        duration: 300,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start(() => {
        cardEntryProgress.setValue(0);
        setPreviewIndex(next.index);
        setProposal(preparedNext);
        requestAnimationFrame(() => {
          cardPosition.setValue({ x: 0, y: 0 });
          cardEntryProgress.setValue(1);
          requestAnimationFrame(() => {
            setTransitionCard(null);
            cardAnimating.current = false;
          });
        });
      });
    });
  }

  const cardPanResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) =>
      uiPreview && Math.abs(gesture.dx) > 7 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.1,
    onMoveShouldSetPanResponderCapture: (_, gesture) =>
      uiPreview && Math.abs(gesture.dx) > 7 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.1,
    onPanResponderGrant: () => {
      cardWasDragged.current = false;
      cardPosition.stopAnimation();
    },
    onPanResponderMove: (_, gesture) => {
      if (Math.abs(gesture.dx) > 4) cardWasDragged.current = true;
      cardPosition.setValue({ x: gesture.dx, y: 0 });
    },
    onPanResponderRelease: (_, gesture) => {
      if (cardWasDragged.current) suppressCardTapUntil.current = Date.now() + 400;
      const swipeThreshold = Math.min(viewportWidth * 0.25, 110);
      const projectedDistance = gesture.dx + gesture.vx * 120;
      const intentionalFlick = Math.abs(gesture.vx) >= 0.35 && Math.abs(gesture.dx) >= 18;
      if (Math.abs(gesture.dx) >= swipeThreshold || intentionalFlick) {
        const direction: -1 | 1 = projectedDistance >= 0 ? 1 : -1;
        navigateSampleCard(direction, direction);
      } else {
        Animated.timing(cardPosition, {
          toValue: { x: 0, y: 0 },
          duration: 300,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }).start();
      }
    },
    onPanResponderTerminate: () => {
      if (cardWasDragged.current) suppressCardTapUntil.current = Date.now() + 400;
      Animated.timing(cardPosition, {
        toValue: { x: 0, y: 0 },
        duration: 300,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    },
    onPanResponderTerminationRequest: () => false,
  });

  const cardRotation = cardPosition.x.interpolate({
    inputRange: [-viewportWidth, 0, viewportWidth],
    outputRange: [`-${viewportWidth / 20}deg`, "0deg", `${viewportWidth / 20}deg`],
    extrapolate: "extend",
  });
  const nextCardOpacity = cardPosition.x.interpolate({
    inputRange: [-18, 0, 18],
    outputRange: [0, 1, 1],
    extrapolate: "clamp",
  });
  const previousCardOpacity = cardPosition.x.interpolate({
    inputRange: [-18, 0, 18],
    outputRange: [1, 0, 0],
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
  const availablePreviewCards = UI_PROPOSALS.filter((item) => !reviewedExampleIds.includes(item.id));
  const activePreviewPosition = availablePreviewCards.findIndex((item) => item.id === proposal.id);
  const nextPreviewCard = activePreviewPosition >= 0 && availablePreviewCards.length > 1
    ? availablePreviewCards[(activePreviewPosition + 1) % availablePreviewCards.length]
    : null;
  const previousPreviewCard = activePreviewPosition >= 0 && availablePreviewCards.length > 1
    ? availablePreviewCards[(activePreviewPosition - 1 + availablePreviewCards.length) % availablePreviewCards.length]
    : null;
  const backPreviewCard = activePreviewPosition >= 0 && availablePreviewCards.length > 2
    ? availablePreviewCards[(activePreviewPosition + 2) % availablePreviewCards.length]
    : null;

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
  }

  function openMenu() {
    const actions: Array<{ text: string; style?: "cancel"; onPress?: () => void }> = [];
    if (!proposal.shadowMode) {
      actions.push({ text: "Back to scanner", onPress: returnToScanner });
    }
    actions.push(
      { text: "Refresh recommendations", onPress: () => void openPaperRecommendation() },
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
    <VisualThemeContext.Provider value={{ colors, styles }}>
    <ThemeProvider theme={activeTheme}>
    <SafeAreaProvider>
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <StatusBar barStyle={darkMode ? "light-content" : "dark-content"} />
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <View style={styles.appHeader}>
          <Pressable accessibilityRole="button" accessibilityLabel="Open menu" onPress={openMenu} style={styles.menuButton}>
            <ListIcon size={23} color={colors.ink} weight="regular" />
          </Pressable>
          <View style={styles.headerActions}>
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
            <Pressable
              accessibilityRole="switch"
              accessibilityLabel={darkMode ? "Switch to light mode" : "Switch to dark mode"}
              accessibilityState={{ checked: darkMode }}
              hitSlop={6}
              onPress={() => setDarkMode((value) => !value)}
              style={({ pressed }) => [styles.themeToggle, pressed && styles.themeTogglePressed]}
            >
              {darkMode
                ? <SunIcon size={18} color={colors.ink} weight="regular" />
                : <MoonIcon size={18} color={colors.ink} weight="regular" />}
            </Pressable>
          </View>
        </View>

        {appToast && (
          <View style={styles.toastLayer}>
            <Toast {...appToast} loading={appToast.tone === "info" && processing} onDismiss={dismissToast} duration={appToast.tone === "info" && processing ? 0 : 5500} />
          </View>
        )}

        {paused && (
          <View style={styles.pauseBanner}>
            <Text style={styles.pauseBannerTitle}>All agents are paused</Text>
            <Text style={styles.pauseBannerText}>No proposal can be approved until you resume.</Text>
          </View>
        )}

        {proposal.shadowMode && showRecommendationSkeleton && (
          <View style={[styles.deckStage, { height: Math.max(420, viewportHeight - 150) }]}>
            <View pointerEvents="none" style={[styles.stackCard, styles.stackCardBack]} />
            <View pointerEvents="none" style={[styles.stackCard, styles.stackCardNext]} />
            <View style={styles.proposalCard}>
              <Animated.View style={[styles.cardBody, { opacity: skeletonPulse }]}>
                <View style={styles.skeletonIdentityRow}>
                  <View style={styles.skeletonLogo} />
                  <View style={[styles.skeletonLine, styles.skeletonCompany]} />
                </View>
                <View style={[styles.skeletonLine, styles.skeletonHeadline]} />
                <View style={[styles.skeletonLine, styles.skeletonPrice]} />
                <View style={styles.skeletonTerms}>
                  {[0, 1, 2, 3, 4].map((item) => (
                    <View key={item} style={styles.skeletonTermRow}>
                      <View style={[styles.skeletonLine, styles.skeletonTermLabel]} />
                      <View style={[styles.skeletonLine, styles.skeletonTermValue]} />
                    </View>
                  ))}
                </View>
                <View style={styles.skeletonInfoBlock}>
                  <View style={[styles.skeletonLine, styles.skeletonInfoTitle]} />
                  <View style={[styles.skeletonLine, styles.skeletonInfoLine]} />
                  <View style={[styles.skeletonLine, styles.skeletonInfoLineShort]} />
                </View>
              </Animated.View>
              <View style={styles.cardFooter}>
                <View style={styles.actions}>
                  <View style={styles.skeletonButton} />
                  <View style={styles.skeletonButton} />
                </View>
              </View>
            </View>
          </View>
        )}

        {proposal.shadowMode && !showRecommendationSkeleton && (
          <View style={styles.homeDashboard}>
            <Text style={styles.homeEyebrow}>{paused ? "SCANNER PAUSED" : "SCANNER ACTIVE"}</Text>
            <Text style={styles.homeTitle}>
              {brokerConnectionStatus === "disconnected" ? "Paper is offline" : "Finding your next setup"}
            </Text>
            <Text style={styles.homeSummary}>
              {brokerUnavailable
                ? "The scanner could not load a recommendation. You can try again when the connection is ready."
                : noEligibleRecommendation
                  ? "The scanner is active. Nothing in the pilot watchlist currently passes every momentum and risk rule."
                : brokerConnectionStatus === "disconnected"
                  ? "Open TWS Paper and the local service. Recommendations will appear automatically after they reconnect."
                  : "Reviewing your watchlist against the current buying and risk rules. A card will appear automatically when it is ready."}
            </Text>

            <View style={styles.homeScannerPanel}>
              <View style={styles.homeScannerRow}>
                <Text style={styles.homeScannerLabel}>Scan</Text>
                <Text style={styles.homeScannerValue}>Every 30 seconds</Text>
              </View>
              <View style={styles.homeScannerRow}>
                <Text style={styles.homeScannerLabel}>Recommendations</Text>
                <Text style={styles.homeScannerValue}>Buys only</Text>
              </View>
              <View style={styles.homeScannerRow}>
                <Text style={styles.homeScannerLabel}>Protection</Text>
                <Text style={styles.homeScannerValue}>Automatic exits</Text>
              </View>
            </View>

            {brokerUnavailable && brokerConnectionStatus === "connected" ? (
              <Pressable
                accessibilityRole="button"
                disabled={processing}
                onPress={() => void openPaperRecommendation()}
                style={({ pressed }) => [styles.homeAction, processing && styles.homeActionDisabled, pressed && styles.homeActionPressed]}
              >
                <Text style={styles.homeActionText}>{processing ? "Loading…" : "Try again"}</Text>
              </Pressable>
            ) : null}
          </View>
        )}

        {!proposal.shadowMode && sampleDeckComplete && (
          <View style={styles.deckComplete}>
            <View style={styles.deckCompleteIcon}>
              <CheckCircleIcon size={34} color={colors.actionApprove} weight="fill" />
            </View>
            <Text style={styles.deckCompleteEyebrow}>0 recommendations remaining</Text>
            <Text style={styles.deckCompleteTitle}>You’re all caught up</Text>
            <Text style={styles.deckCompleteBody}>
              You reviewed all {UI_PROPOSALS.length} suggested trades. New recommendations will appear when the scanner finds them.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Review sample trades again"
              onPress={previewActiveProposal}
              style={({ pressed }) => [styles.previewProposalButton, pressed && styles.homeActionPressed]}
            >
              <Text style={styles.previewProposalButtonText}>Review sample trades again</Text>
            </Pressable>
          </View>
        )}

        {!proposal.shadowMode && !sampleDeckComplete && (
          <View style={[styles.deckStage, { height: Math.max(420, viewportHeight - 150) }]}>
            {uiPreview && backPreviewCard && (
              <Animated.View pointerEvents="none" style={[styles.proposalCard, styles.stackCardLayer, styles.stackCardBack]}>
                <PreviewCardFace proposal={backPreviewCard} />
              </Animated.View>
            )}
            {uiPreview && nextPreviewCard && (
              <Animated.View pointerEvents="none" style={[styles.proposalCard, styles.stackCardLayer, styles.stackCardNext, { opacity: nextCardOpacity }]}>
                <PreviewCardFace proposal={nextPreviewCard} />
              </Animated.View>
            )}
            {uiPreview && previousPreviewCard && previousPreviewCard.id !== nextPreviewCard?.id && (
              <Animated.View pointerEvents="none" style={[styles.proposalCard, styles.stackCardLayer, styles.stackCardNext, { opacity: previousCardOpacity }]}>
                <PreviewCardFace proposal={previousPreviewCard} />
              </Animated.View>
            )}
            {uiPreview && transitionCard && (
              <Animated.View pointerEvents="none" style={[styles.proposalCard, styles.stackCardLayer, styles.stackCardTransition]}>
                <PreviewCardFace proposal={transitionCard} />
              </Animated.View>
            )}
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
                if (!uiPreview || cardWidth === 0 || Date.now() < suppressCardTapUntil.current) return;
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
                  <Text style={styles.tradeTermLabel}>Risk</Text>
                  <View style={styles.riskChip}>
                    <Text style={styles.riskChipText}>{qualitativeRisk(proposal.marketRisk)}</Text>
                  </View>
                </View>
                <View style={styles.tradeTermRow}>
                  <Text style={styles.tradeTermLabel}>{state === "pending" ? "Expires in" : "Status"}</Text>
                  <View style={[
                    styles.timer,
                    expiringSoon && styles.timerWarning,
                    state === "expired" && styles.timerExpired,
                    state !== "pending" && state !== "expired" && styles.timerClosed,
                  ]}>
                    <ClockIcon size={15} color={state === "expired" ? "#B42318" : expiringSoon ? "#854D0E" : colors.muted} weight="regular" />
                    <Text style={[
                      styles.timerValue,
                      expiringSoon && styles.timerWarningText,
                      state === "expired" && styles.timerExpiredText,
                      state !== "pending" && state !== "expired" && styles.timerClosedText,
                    ]}>{state === "pending" ? timer : state.toUpperCase()}</Text>
                  </View>
                </View>
                {proposal.automaticExits && (
                  <>
                    <View style={styles.tradeTermRow}>
                      <Text style={styles.tradeTermLabel}>Profit target</Text>
                      <Text style={styles.tradeTermValue}>Sell at {money(proposal.targetPrice)}</Text>
                    </View>
                    <View style={styles.tradeTermRow}>
                      <Text style={styles.tradeTermLabel}>Total profit</Text>
                      <Text style={styles.tradeTermValue}>+{money(proposal.potentialUpside)}</Text>
                    </View>
                    <View style={styles.tradeTermRow}>
                      <Text style={styles.tradeTermLabel}>Time horizon</Text>
                      <Text style={styles.tradeTermValue}>{proposal.targetTimeframe}</Text>
                    </View>
                    <View style={styles.tradeTermRow}>
                      <Text style={styles.tradeTermLabel}>Protective stop</Text>
                      <Text style={styles.tradeTermValue}>Trigger at {money(proposal.stopPrice)}</Text>
                    </View>
                  </>
                )}
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
                    <CheckCircleIcon size={17} color={colors.accent} weight="regular" />
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
    </VisualThemeContext.Provider>
  );
}

function createStyles(colors: AppPalette) {
const ink = colors.ink;
const green = colors.accent;
const cream = colors.canvas;

return StyleSheet.create({
  safe: { flex: 1, backgroundColor: cream },
  page: { flexGrow: 1, width: "100%", maxWidth: 680, alignSelf: "center", paddingHorizontal: spacing.large, paddingTop: spacing.small, paddingBottom: spacing.large },
  appHeader: { minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  toastLayer: { position: "absolute", top: 66, left: spacing.large, right: spacing.large, zIndex: 20 },
  menuButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 20 },
  marketPill: { height: 34, flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: colors.surfaceMuted, borderWidth: 0, borderRadius: radius.pill, paddingHorizontal: 12 },
  marketText: { color: colors.text, ...typeRamp.caption, fontWeight: "400" },
  themeToggle: { width: 34, height: 34, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceMuted, borderRadius: radius.pill },
  themeTogglePressed: { opacity: 0.68, transform: [{ scale: 0.96 }] },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
  eyebrow: { color: green, fontSize: 10, fontWeight: "800", letterSpacing: 1.6 },
  title: { color: ink, fontSize: 30, lineHeight: 38, fontWeight: "800", letterSpacing: -1 },
  pauseButton: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 13, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 7 },
  pauseButtonActive: { backgroundColor: colors.dangerSoft, borderColor: "#F4C8D0" },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: green },
  statusDotPaused: { backgroundColor: colors.danger },
  pauseText: { color: green, fontSize: 13, fontWeight: "700" },
  pauseTextActive: { color: colors.danger },
  pauseBanner: { backgroundColor: colors.danger, borderRadius: radius.medium, padding: 15 },
  pauseBannerTitle: { color: "white", fontWeight: "800", fontSize: 15 },
  pauseBannerText: { color: "#F8DEDC", marginTop: 3, fontSize: 13 },
  brokerBar: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.medium, paddingHorizontal: 14, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  brokerBarUnavailable: { backgroundColor: colors.dangerSoft, borderColor: "#F4C8D0" },
  brokerDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: green },
  brokerDotUnavailable: { backgroundColor: colors.danger },
  brokerCopy: { flex: 1 },
  brokerTitle: { color: ink, fontSize: 12, fontWeight: "800" },
  brokerDetail: { color: colors.muted, fontSize: 10, marginTop: 2 },
  strategyStatus: { backgroundColor: colors.surfaceMuted, borderRadius: radius.medium, paddingHorizontal: 14, paddingVertical: 12 },
  strategyStatusHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  strategyStatusName: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  strategyStatusCount: { color: colors.muted, fontSize: 10, fontWeight: "700" },
  strategyStatusDetail: { color: colors.text, fontSize: 10, marginTop: 5 },
  homeDashboard: { flex: 1, minHeight: 500, paddingTop: 52, paddingBottom: 20 },
  homeEyebrow: { color: colors.muted, ...typeRamp.caption, fontWeight: "400", letterSpacing: 1.1 },
  homeTitle: { color: colors.ink, fontSize: 30, lineHeight: 36, fontWeight: "800", letterSpacing: -0.8 },
  homeSummary: { color: colors.muted, ...typeRamp.body, marginTop: 8, maxWidth: 520 },
  homeScannerPanel: { backgroundColor: colors.surfaceMuted, borderRadius: 20, marginTop: 26, paddingHorizontal: 18, paddingVertical: 5 },
  homeScannerRow: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  homeScannerLabel: { color: colors.muted, ...typeRamp.body },
  homeScannerValue: { color: colors.ink, ...typeRamp.body, fontWeight: "400", textAlign: "right" },
  homeAction: { minHeight: 56, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent, borderRadius: radius.pill, marginTop: 28, paddingHorizontal: 20 },
  homeActionDisabled: { opacity: 0.35 },
  homeActionPressed: { opacity: 0.72 },
  homeActionText: { color: colors.surface, fontSize: 16, lineHeight: 22, fontWeight: "400" },
  scannerCard: { paddingVertical: 24 },
  scannerTitle: { color: colors.ink, ...typeRamp.title },
  scannerStatus: { color: colors.muted, ...typeRamp.body, marginTop: 5 },
  symbolChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 18 },
  symbolChip: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: colors.surfaceMuted, borderRadius: radius.pill, paddingLeft: 5, paddingRight: 12, paddingVertical: 5 },
  symbolChipText: { color: colors.ink, ...typeRamp.caption, fontWeight: "400" },
  logoFallback: { alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceMuted, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  logoFallbackText: { color: colors.ink, fontSize: 9, lineHeight: 12, fontWeight: "800" },
  previewProposalButton: { alignItems: "center", justifyContent: "center", minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: radius.medium, marginTop: 20, paddingHorizontal: 14 },
  previewProposalButtonText: { color: colors.ink, ...typeRamp.label, fontWeight: "700" },
  previewNavigation: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end" },
  nextExample: { paddingVertical: 4, paddingLeft: 12 },
  nextExampleText: { color: colors.text, ...typeRamp.caption, fontWeight: "600" },
  deckStage: { position: "relative", width: "100%", marginTop: 8, marginBottom: 12 },
  stackCard: { position: "absolute", overflow: "hidden", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 28, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowRadius: 8 },
  stackCardLayer: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0 },
  stackCardBack: { zIndex: 1 },
  stackCardNext: { zIndex: 2 },
  stackCardTransition: { zIndex: 2 },
  proposalCard: { flex: 1, zIndex: 3, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 28, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.055, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  skeletonIdentityRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  skeletonLogo: { width: 42, height: 42, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted },
  skeletonLine: { backgroundColor: colors.surfaceMuted, borderRadius: radius.pill },
  skeletonCompany: { width: "48%", height: 18 },
  skeletonHeadline: { width: "88%", height: 30, marginTop: 18 },
  skeletonPrice: { width: "45%", height: 16, marginTop: 8 },
  skeletonTerms: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: 22, paddingTop: 6 },
  skeletonTermRow: { minHeight: 39, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  skeletonTermLabel: { width: "28%", height: 14 },
  skeletonTermValue: { width: "34%", height: 14 },
  skeletonInfoBlock: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: 8, paddingTop: 16 },
  skeletonInfoTitle: { width: "32%", height: 17 },
  skeletonInfoLine: { width: "100%", height: 14, marginTop: 12 },
  skeletonInfoLineShort: { width: "68%", height: 14, marginTop: 8 },
  skeletonButton: { flex: 1, height: 56, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted },
  deckComplete: { minHeight: 420, alignItems: "center", justifyContent: "center", marginTop: 8, paddingHorizontal: 28, paddingVertical: 40 },
  deckCompleteIcon: { width: 64, height: 64, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceMuted, borderRadius: radius.pill, marginBottom: 18 },
  deckCompleteEyebrow: { color: colors.muted, ...typeRamp.caption, textAlign: "center", marginBottom: 7 },
  deckCompleteTitle: { color: colors.ink, ...typeRamp.title, textAlign: "center" },
  deckCompleteBody: { color: colors.muted, ...typeRamp.body, textAlign: "center", marginTop: 9, maxWidth: 340 },
  cardBody: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 4 },
  cardPosition: { alignItems: "center", marginBottom: 10 },
  cardPositionText: { color: colors.muted, ...typeRamp.caption },
  infoCard: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingVertical: 11 },
  infoCardHeadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 3 },
  infoCardTitle: { color: colors.ink, ...typeRamp.label, fontWeight: "600", marginBottom: 5 },
  infoCardBody: { color: colors.text, ...typeRamp.body },
  infoCardMuted: { color: colors.muted, ...typeRamp.body },
  riskHeadline: { color: colors.ink, fontSize: 18, lineHeight: 24, fontWeight: "800", marginBottom: 2 },
  strategyCardName: { color: colors.ink, ...typeRamp.label, fontWeight: "700", marginBottom: 5 },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 9, marginTop: 10 },
  infoDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.muted, marginTop: 7 },
  infoRowText: { flex: 1, color: colors.text, ...typeRamp.body },
  learnMoreButton: { paddingVertical: 5, paddingLeft: 12 },
  learnMoreText: { color: colors.ink, ...typeRamp.caption, fontWeight: "600", textDecorationLine: "underline" },
  connectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginBottom: 10 },
  connectionDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.ink },
  connectionDotOff: { backgroundColor: colors.muted },
  connectionText: { color: colors.text, fontSize: 11, lineHeight: 16, fontWeight: "600" },
  sheetSafe: { flex: 1, backgroundColor: colors.surface },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 58, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  sheetTitle: { color: colors.ink, ...typeRamp.title },
  sheetClose: { paddingHorizontal: 4, paddingVertical: 8 },
  sheetCloseText: { color: colors.ink, ...typeRamp.label, fontWeight: "700" },
  sheetContent: { padding: 20, paddingBottom: 40, gap: 24 },
  sheetSection: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingBottom: 24 },
  sheetSectionTitle: { color: colors.ink, ...typeRamp.heading, marginBottom: 10 },
  sheetBody: { color: colors.text, ...typeRamp.body },
  riskScoreHero: { backgroundColor: colors.warningSoft, borderRadius: radius.medium, padding: 18 },
  riskScoreEyebrow: { color: colors.warning, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  riskScoreValue: { color: colors.ink, fontSize: 34, lineHeight: 40, fontWeight: "800", marginTop: 5 },
  riskScoreLevel: { color: colors.warning, ...typeRamp.label, fontWeight: "700", marginTop: 2 },
  riskComponent: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingBottom: 18 },
  riskComponentHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  riskComponentLabel: { color: colors.ink, ...typeRamp.label, fontWeight: "800" },
  riskComponentPoints: { color: colors.text, ...typeRamp.label, fontWeight: "700" },
  riskComponentTrack: { height: 7, borderRadius: 4, backgroundColor: colors.surfaceMuted, marginTop: 10, overflow: "hidden" },
  riskComponentFill: { height: "100%", borderRadius: 4, backgroundColor: "#D99000" },
  riskComponentExplanation: { color: colors.text, ...typeRamp.body, marginTop: 8 },
  incompleteTradeRisk: { backgroundColor: colors.surfaceMuted, borderRadius: radius.medium, padding: 16 },
  incompleteTradeRiskTitle: { color: colors.ink, ...typeRamp.label, fontWeight: "800" },
  incompleteTradeRiskBody: { color: colors.text, ...typeRamp.body, marginTop: 5 },
  riskFootnote: { color: colors.muted, ...typeRamp.caption },
  card: { paddingTop: 24, paddingBottom: 22 },
  cardEyebrowRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18 },
  signalBadge: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: colors.accentSoft, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 7 },
  signalBadgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  signalBadgeText: { color: colors.accentDark, fontSize: 9, fontWeight: "900", letterSpacing: 0.9 },
  ruleset: { flexShrink: 1, color: colors.muted, fontSize: 9, textAlign: "right" },
  quoteHero: { backgroundColor: colors.surface, borderRadius: 0, paddingVertical: 6 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  symbolBlock: { flex: 1 },
  side: { color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1.4 },
  symbol: { color: colors.ink, fontSize: 42, lineHeight: 46, fontWeight: "800", letterSpacing: -1.5 },
  companyIdentity: { flexDirection: "row", alignItems: "center", gap: 12 },
  company: { flex: 1, color: colors.ink, ...typeRamp.label, fontWeight: "400" },
  tradeHeadline: { color: colors.ink, fontSize: 26, lineHeight: 32, fontWeight: "800", letterSpacing: -0.6, marginTop: 10 },
  tradePrice: { color: colors.muted, ...typeRamp.body, marginTop: 1 },
  tradeTerms: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: 14, paddingTop: 3 },
  tradeTermRow: { minHeight: 39, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  tradeTermLabel: { color: colors.muted, ...typeRamp.body, fontWeight: "400" },
  tradeTermValue: { color: colors.text, ...typeRamp.body, fontWeight: "400", textAlign: "right" },
  riskChip: { minHeight: 28, justifyContent: "center", backgroundColor: colors.surfaceMuted, borderRadius: radius.pill, paddingHorizontal: 11 },
  riskChipText: { color: colors.text, ...typeRamp.caption, fontWeight: "400" },
  currentPriceRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 7 },
  currentPrice: { color: colors.ink, fontSize: 22, fontWeight: "800" },
  quoteAge: { color: colors.muted, fontSize: 10 },
  timer: { height: 32, backgroundColor: colors.surfaceMuted, borderWidth: 0, paddingHorizontal: 10, borderRadius: radius.pill, minWidth: 70, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 5 },
  timerWarning: { backgroundColor: "#FEF3C7" },
  timerWarningText: { color: "#854D0E" },
  timerExpired: { backgroundColor: "#FEE4E2" },
  timerExpiredText: { color: "#B42318" },
  timerClosed: { backgroundColor: colors.surfaceMuted, borderColor: colors.surfaceMuted },
  timerLabel: { color: colors.muted, fontSize: 9, fontWeight: "800", letterSpacing: 1.1 },
  timerValue: { color: colors.text, ...typeRamp.caption, fontWeight: "400" },
  timerClosedText: { color: colors.muted },
  account: { color: "#9FB3C8", fontSize: 11, marginTop: 16, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#314962" },
  observationBlock: { backgroundColor: colors.surfaceMuted, borderRadius: radius.medium, padding: 16, marginTop: 16 },
  observationLabel: { color: colors.accentDark, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  observationTitle: { color: colors.ink, fontSize: 17, lineHeight: 22, fontWeight: "800", marginTop: 7 },
  observationText: { color: colors.text, fontSize: 12, lineHeight: 18, marginTop: 5 },
  decisionSummary: { flexDirection: "row", gap: 10, marginTop: 18 },
  spendBlock: { flex: 1.15, backgroundColor: colors.surfaceMuted, borderRadius: 15, padding: 14 },
  summaryLabel: { color: colors.muted, fontSize: 11, marginBottom: 3 },
  spendValue: { color: ink, fontSize: 25, fontWeight: "900", letterSpacing: -0.6 },
  feeText: { color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: "600", marginTop: 7 },
  upsideBlock: { flex: 1, backgroundColor: colors.successSoft, borderRadius: 15, padding: 14 },
  upsideLabel: { color: green, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  upsideValue: { color: green, fontSize: 21, fontWeight: "900", marginTop: 4 },
  upsidePercent: { color: colors.success, fontSize: 10, lineHeight: 14, marginTop: 2 },
  timeframe: { color: ink, fontSize: 10, lineHeight: 14, fontWeight: "700", marginTop: 5 },
  planBlock: { borderWidth: 0, borderBottomWidth: 1, borderColor: colors.border, borderRadius: 0, paddingHorizontal: 2, paddingVertical: 16, marginTop: 2 },
  planLabel: { color: ink, fontSize: 12, fontWeight: "800", marginBottom: 6 },
  planText: { color: colors.text, fontSize: 13, lineHeight: 19 },
  strategyBlock: { backgroundColor: colors.surfaceMuted, borderRadius: radius.medium, padding: 16, marginTop: 14 },
  strategyEyebrow: { color: colors.accentDark, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  strategyName: { color: colors.ink, fontSize: 15, fontWeight: "800", marginTop: 5 },
  strategyText: { color: colors.text, fontSize: 12, lineHeight: 18, marginTop: 5 },
  accordionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border, paddingVertical: 16, marginTop: 8 },
  accordionTitle: { color: ink, fontSize: 14, fontWeight: "800" },
  accordionHint: { color: colors.muted, fontSize: 10, marginTop: 2 },
  accordionIcon: { color: green, fontSize: 24, fontWeight: "500", lineHeight: 26 },
  accordionBody: { paddingTop: 8, paddingBottom: 4 },
  metrics: { flexDirection: "row", flexWrap: "wrap", marginTop: 16, marginHorizontal: -5 },
  metric: { width: "50%", padding: 5, marginBottom: 10 },
  metricLabel: { color: colors.muted, fontSize: 11, marginBottom: 3 },
  metricValue: { color: ink, fontWeight: "700", fontSize: 14 },
  riskRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 3 },
  riskLabel: { color: colors.muted, fontSize: 12 },
  riskValue: { color: ink, fontSize: 12, fontWeight: "800" },
  riskTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceMuted, marginTop: 7, overflow: "hidden" },
  riskFill: { height: "100%", borderRadius: 3, backgroundColor: green },
  rationaleBody: { paddingTop: 14 },
  contextText: { color: colors.text, fontSize: 14, lineHeight: 21, marginBottom: 14 },
  contextBlock: { backgroundColor: colors.surfaceMuted, borderLeftWidth: 3, borderLeftColor: green, borderRadius: 10, padding: 13, marginBottom: 10 },
  riskBlock: { backgroundColor: colors.warningSoft, borderLeftColor: colors.warning },
  contextLabel: { color: green, fontSize: 11, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 5 },
  riskContextLabel: { color: colors.warning },
  contextBody: { color: colors.text, fontSize: 13, lineHeight: 19 },
  signalTitle: { color: ink, fontSize: 13, fontWeight: "800", marginTop: 8, marginBottom: 11 },
  reason: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 10 },
  check: { width: 8, height: 8, borderRadius: 4, backgroundColor: green, marginTop: 5 },
  reasonText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18 },
  guardrail: { backgroundColor: colors.accentSoft, borderRadius: radius.medium, padding: 14, marginTop: 8 },
  guardrailTitle: { color: green, fontSize: 12, fontWeight: "800", marginBottom: 4 },
  guardrailText: { color: colors.text, fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: "row", gap: 12 },
  cardFooter: { backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14 },
  bottomBar: { width: "100%", maxWidth: 680, alignSelf: "center", backgroundColor: colors.canvas, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 10, shadowColor: "#0A2540", shadowOpacity: 0.07, shadowRadius: 18, shadowOffset: { width: 0, height: -6 }, elevation: 10 },
  deny: { flex: 1, height: 56, borderRadius: radius.medium, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  approve: { flex: 1.5, height: 56, borderRadius: radius.medium, alignItems: "center", justifyContent: "center", backgroundColor: green },
  denyText: { color: colors.ink, fontSize: 16, fontWeight: "800" },
  approveText: { color: colors.surface, fontSize: 17, fontWeight: "800" },
  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.35 },
  reset: { alignSelf: "center", paddingVertical: 9, paddingHorizontal: 14 },
  resetText: { color: green, fontSize: 13, fontWeight: "700" },
});
}
