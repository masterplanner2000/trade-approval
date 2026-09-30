import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ThemeProvider } from "@shopify/restyle";
import { CheckCircleIcon, CircleIcon, ClockCounterClockwiseIcon, ClockIcon, ListIcon, MagnifyingGlassIcon, MoonIcon, SlidersHorizontalIcon, SunIcon, XIcon } from "phosphor-react-native";
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
  Switch,
  TextInput,
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
type BrokerConnectionHealth = { state: BrokerConnectionStatus; consecutiveFailures: number; failureThreshold: number;
  lastCheckedAt: number | null; lastConnectedAt: number | null; lastDisconnectedAt: number | null; lastError: string | null; newOrdersAllowed: boolean };
type AppToast = { tone: "info" | "success" | "danger"; title: string; message?: string };
type AppPage = "review" | "recommendationHistory" | "activity" | "positions" | "performance" | "research" | "settings";
type ActivityItem = {
  id: string; symbol: string; company?: string | null; side: string; status: string; occurredAt: number;
  quantity: number | null; limitPrice: number | null; environment: string; brokerOrderId: string | null;
  stopPrice?: number | null; targetPrice?: number | null; targetTimeframe?: string | null;
  researchContext?: string | null; rationale?: string[];
};
type TradeItem = {
  id: string; symbol: string; quantity: number; status: "open" | "closed";
  entryPrice: number; exitPrice: number | null; entryValue: number; exitValue: number | null;
  entryFee: number | null; exitFee: number | null; feesComplete: boolean;
  grossProfit: number | null; netProfit: number | null; exitReason: "profit_target" | "protective_stop" | "exit" | null;
  openedAt: number; closedAt: number | null; protectiveStopPrice: number | null; profitTargetPrice: number | null;
  proposedEntryPrice?: number | null; entrySlippageDollars?: number | null; entrySlippageBps?: number | null; timeToFillMs?: number | null;
};
type PositionItem = {
  id: string; symbol: string; quantity: number; averageEntryPrice: number; currentPrice: number | null;
  protectiveStopPrice: number | null; profitTargetPrice: number | null; updatedAt: number; dataState: "ledger_only" | "reconciled" | "preview";
  ownership?: "strategy_owned" | "conflict" | "unknown";
  ownershipSource?: "ledger_fills" | "broker_flex_legacy" | null;
  protection?: "verified" | "partial" | "missing" | "overcovered" | "unverified";
  strategyOwnedQuantity?: number; recordedQuantity?: number; reasons?: string[];
  brokerHistory?: { netQuantity: number; rowCount: number; observedOn: string; status: "matched" | "mismatch"; orderAttribution: "unverified" } | null;
  flexHistory?: { netQuantity: number; orderCount: number; observedOn: string; status: "matched" | "mismatch"; orderAttribution: "verified_application_reference" } | null;
};
type PerformanceReport = {
  asOf: number | null; source: string; status: "COMPLETE" | "INCOMPLETE" | "EMPTY"; limitations: string[];
  today: {
    totalPnl: number | null; openPositionPnl: number | null; realizedGrossPnl: number | null;
    strategyReturnPercent: number | null; qqqReturnPercent: number | null; versusQqqPercentagePoints: number | null;
    benchmarkDataType: number | string | null;
  };
  openPositions: { count: number; unrealizedPnl: number | null; items: Array<{
    symbol: string; quantity: number; averageEntryPrice: number | null; marketValue: number | null;
    unrealizedPnl: number | null; entryReturnPercent: number | null; dailyPnl: number | null; dailyReturnPercent: number | null;
  }> };
  closedTrades: { count: number; winRatePercent: number | null; sampleSize: number; feesComplete: boolean; knownFees: number; missingFeeTradeCount: number };
  executionQuality: {
    sampleSize: number; notionalWeightedSlippageBps: number | null; totalSlippageDollars: number | null;
    averageTimeToFillMs: number | null; fillTimeSampleSize: number; interpretation: string;
  };
};
type ComparisonSummary = { count: number; meanBps: number | null; medianBps: number | null; winRate: number | null; lower95Bps: number | null; upper95Bps: number | null };
type StrategyComparison = {
  generatedAt: string; classification: "research_only"; signalDateCount: number; forwardSessionCount: number;
  baselineUniverseSize: number; shadowUniverseSize: number; topK: number; roundTripCostBps: number;
  benchmarkSymbol: string; promotionEvidenceAllowed: boolean; recommendationAuthority: false; orderSubmissionAllowed: false;
  metrics: Record<string, { baseline: ComparisonSummary; shadow: ComparisonSummary; shadowMinusBaseline: ComparisonSummary;
    shadowMinusBenchmark: ComparisonSummary; baselineMaxDrawdownBps: number | null; shadowMaxDrawdownBps: number | null; missingForwardSessions: number }>;
  limitations: string[];
};

const PREVIEW_MODE_STORAGE_KEY = "trade-approval.preview-mode";
const CONNECTION_ALERTS_STORAGE_KEY = "trade-approval.connection-alerts";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});
type RiskPolicy = {
  adaptive: boolean;
  sleeveValue: number;
  normalRiskPercent: number;
  hardRiskPercent: number;
  dailyLossPercent: number;
  totalOpenRiskPercent: number;
  maximumPositionPercent: number;
  maximumDeployedPercent: number;
  minimumCashReservePercent: number;
  maximumSectorPercent: number;
  maximumCorrelatedPercent: number;
  maximumPositions: number;
};

const SMART_RISK_POLICY: RiskPolicy = {
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

type QueuedServiceRecommendation = {
  proposal: ServiceProposal;
  broker: BrokerSnapshot;
};

type PortfolioReview = {
  asOf: number | null;
  signalDate: string | null;
  reductionRequired: number;
  positionReductionRequired: number;
  estimatedPlannedRelease: number;
  exitReviews: Array<{
    id: string; symbol: string; quantity: number; estimatedValue: number; estimatedGrossPnl: number;
    recommendationScore: number | null; urgency: "high" | "normal"; reviewOnly: true;
    orderSubmissionAllowed: false; reviewedAt: number;
    triggers: Array<{ id: string; label: string; severity: "high" | "normal" }>;
  }>;
  holdings: Array<{
    symbol: string; quantity: number; estimatedValue: number; qualified: boolean;
    protected: boolean; ownership?: "strategy_owned" | "conflict" | "unknown";
    status: "HOLD" | "EXIT_REVIEW" | "DATA_UNAVAILABLE" | "OWNERSHIP_REVIEW"; recommendedForExit: boolean;
    recommendationScore: number | null; marketRisk: string | null; reasons: string[];
  }>;
  replacements: Array<{
    symbol: string; company: string; recommendationScore: number;
    referenceClose: number; marketRisk: string | null; status: "AWAITING_EXIT_FILL_AND_FRESH_QUOTE";
  }>;
  nextStep: "APPROVE_EXIT_SEQUENTIALLY" | "MANUAL_REVIEW_REQUIRED" | "MONITOR_HOLDINGS";
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
  budget?: {
    status: string; available: number; deployed?: number; capitalLimit?: number;
    openPositionCount?: number; maxOpenPositions?: number; blockers?: string[];
    ownershipConflicts?: string[]; protectionGaps?: string[];
  };
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

const PREVIEW_HISTORY_SYMBOLS = ["NVDA", "AAPL", "MSFT", "AMZN", "META", "GOOGL", "TSLA", "AMD", "AVGO", "CRM", "PLTR", "HOOD", "XOM", "CVX", "JPM", "V", "COST", "WMT", "LLY", "UNH"];
const PREVIEW_HISTORY_PRICES: Record<string, number> = {
  NVDA: 183.2, AAPL: 229.55, MSFT: 506.25, AMZN: 190, META: 548.4,
  GOOGL: 198.1, TSLA: 347.8, AMD: 164.2, AVGO: 328.6, CRM: 241.66,
  PLTR: 191.81, HOOD: 121.24, XOM: 118.5, CVX: 157.8, JPM: 302.4,
  V: 351.2, COST: 942.7, WMT: 104.6, LLY: 792.4, UNH: 361.9,
};
const PREVIEW_OPEN_STATUSES = ["Submitted", "PreSubmitted", "approved"];
const PREVIEW_HISTORY_STATUSES = ["Filled", "denied", "expired", "Filled", "denied", "Filled"];
const PREVIEW_HISTORY_NOW = Date.now();

function buildPreviewActivity(count = 240): ActivityItem[] {
  return Array.from({ length: count }, (_, index) => {
    const symbol = PREVIEW_HISTORY_SYMBOLS[index % PREVIEW_HISTORY_SYMBOLS.length]!;
    const status = index < 6
      ? PREVIEW_OPEN_STATUSES[index % PREVIEW_OPEN_STATUSES.length]!
      : PREVIEW_HISTORY_STATUSES[(index - 6) % PREVIEW_HISTORY_STATUSES.length]!;
    const brokerBacked = !["denied", "expired", "approved"].includes(status.toLowerCase());
    return {
      id: `preview-activity-${index + 1}`,
      symbol,
      side: index % 5 === 0 ? "sell" : "buy",
      status,
      occurredAt: PREVIEW_HISTORY_NOW - (index * 7 + 3) * 60 * 60 * 1000,
      quantity: (index % 5) + 1,
      limitPrice: Math.round((PREVIEW_HISTORY_PRICES[symbol]! * (0.97 + (index % 7) * 0.01)) * 100) / 100,
      environment: "preview",
      brokerOrderId: brokerBacked ? String(10490000 - index) : null,
      stopPrice: Math.round(PREVIEW_HISTORY_PRICES[symbol]! * 0.94 * 100) / 100,
      targetPrice: Math.round(PREVIEW_HISTORY_PRICES[symbol]! * 1.08 * 100) / 100,
      targetTimeframe: "1–3 trading days",
      researchContext: `${symbol} passed the preview momentum, liquidity, and portfolio-risk checks at the time this recommendation was created.`,
      rationale: ["Price trend passed the momentum rules", "Liquidity met the strategy minimum", "Proposed risk fit the preview allocation"],
    };
  });
}

const PREVIEW_ACTIVITY: ActivityItem[] = buildPreviewActivity();

const PREVIEW_POSITIONS: PositionItem[] = [
  { id: "position-1", symbol: "NVDA", quantity: 5, averageEntryPrice: 182.94, currentPrice: 185.36, protectiveStopPrice: 180.3, profitTargetPrice: 190.5, updatedAt: Date.now() - 12_000, dataState: "preview" },
  { id: "position-2", symbol: "AAPL", quantity: 4, averageEntryPrice: 228.8, currentPrice: 231.14, protectiveStopPrice: 224.9, profitTargetPrice: 238, updatedAt: Date.now() - 18_000, dataState: "preview" },
];
const PREVIEW_OPEN_TRADES: TradeItem[] = PREVIEW_POSITIONS.map((position) => ({
  id: position.id, symbol: position.symbol, quantity: position.quantity, status: "open",
  entryPrice: position.averageEntryPrice, exitPrice: null,
  entryValue: position.quantity * position.averageEntryPrice, exitValue: null,
  entryFee: null, exitFee: null, feesComplete: false, grossProfit: null, netProfit: null, exitReason: null,
  openedAt: position.updatedAt, closedAt: null,
  protectiveStopPrice: position.protectiveStopPrice, profitTargetPrice: position.profitTargetPrice,
}));
const PREVIEW_CLOSED_TRADES: TradeItem[] = Array.from({ length: 48 }, (_, index) => {
  const symbol = PREVIEW_HISTORY_SYMBOLS[index % PREVIEW_HISTORY_SYMBOLS.length]!;
  const entryPrice = PREVIEW_HISTORY_PRICES[symbol]! * (0.94 + (index % 5) * 0.01);
  const returnPercent = ((index % 9) - 3) / 100;
  const exitPrice = entryPrice * (1 + returnPercent);
  const quantity = (index % 5) + 1;
  const grossProfit = (exitPrice - entryPrice) * quantity;
  const entryFee = 0.35;
  const exitFee = 0.35;
  return {
    id: `preview-closed-trade-${index + 1}`, symbol, quantity, status: "closed",
    entryPrice, exitPrice, entryValue: entryPrice * quantity, exitValue: exitPrice * quantity,
    entryFee, exitFee, feesComplete: true, grossProfit, netProfit: grossProfit - entryFee - exitFee,
    exitReason: returnPercent >= 0 ? "profit_target" : "protective_stop",
    openedAt: PREVIEW_HISTORY_NOW - (index * 4 + 6) * 24 * 60 * 60 * 1000,
    closedAt: PREVIEW_HISTORY_NOW - (index * 4 + 4) * 24 * 60 * 60 * 1000,
    protectiveStopPrice: entryPrice * 0.96, profitTargetPrice: entryPrice * 1.04,
  };
});
const PREVIEW_TRADES: TradeItem[] = [...PREVIEW_OPEN_TRADES, ...PREVIEW_CLOSED_TRADES];
const PREVIEW_PERFORMANCE: PerformanceReport = {
  asOf: Date.now(), source: "Preview data", status: "COMPLETE", limitations: [],
  today: { totalPnl: 31.46, openPositionPnl: 31.46, realizedGrossPnl: 0, strategyReturnPercent: 1.73,
    qqqReturnPercent: 0.64, versusQqqPercentagePoints: 1.09, benchmarkDataType: "preview" },
  openPositions: { count: 2, unrealizedPnl: 21.46, items: [
    { symbol: "NVDA", quantity: 5, averageEntryPrice: 182.94, marketValue: 926.8, unrealizedPnl: 12.1, entryReturnPercent: 1.32, dailyPnl: 18.4, dailyReturnPercent: 2.03 },
    { symbol: "AAPL", quantity: 4, averageEntryPrice: 228.8, marketValue: 924.56, unrealizedPnl: 9.36, entryReturnPercent: 1.02, dailyPnl: 13.06, dailyReturnPercent: 1.43 },
  ] },
  closedTrades: { count: 48, winRatePercent: 54.17, sampleSize: 48, feesComplete: true, knownFees: 33.6, missingFeeTradeCount: 0 },
  executionQuality: { sampleSize: 48, notionalWeightedSlippageBps: 1.8, totalSlippageDollars: 8.42,
    averageTimeToFillMs: 2400, fillTimeSampleSize: 48, interpretation: "Positive slippage means the fill was worse than the proposed buy price." },
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

const COMPANY_NAMES: Record<string, string> = {
  AAPL: "Apple Inc.", AMD: "Advanced Micro Devices, Inc.", AMZN: "Amazon.com, Inc.",
  AVGO: "Broadcom Inc.", COST: "Costco Wholesale Corporation", CRM: "Salesforce, Inc.",
  CVX: "Chevron Corporation", GOOGL: "Alphabet Inc.", HOOD: "Robinhood Markets, Inc.",
  IWM: "iShares Russell 2000 ETF", JPM: "JPMorgan Chase & Co.", LLY: "Eli Lilly and Company", META: "Meta Platforms, Inc.",
  MSFT: "Microsoft Corporation", NVDA: "NVIDIA Corporation", PLTR: "Palantir Technologies Inc.",
  QQQ: "Invesco QQQ Trust", SPY: "SPDR S&P 500 ETF Trust", TSLA: "Tesla, Inc.",
  UNH: "UnitedHealth Group Incorporated", V: "Visa Inc.", WMT: "Walmart Inc.", XOM: "Exxon Mobil Corporation",
};

function companyName(item: Pick<ActivityItem, "symbol" | "company">) {
  return item.company && item.company !== item.symbol ? item.company : COMPANY_NAMES[item.symbol] ?? item.symbol;
}

function mergeRecommendationDeck(current: Proposal[], incoming: Proposal[]) {
  const incomingBySymbol = new Map<string, Proposal>();
  for (const item of incoming) incomingBySymbol.set(item.symbol, item);
  const merged: Proposal[] = [];
  const seen = new Set<string>();
  for (const item of current) {
    if (seen.has(item.symbol)) continue;
    const refreshed = incomingBySymbol.get(item.symbol);
    if (!refreshed) continue;
    merged.push(refreshed);
    seen.add(item.symbol);
    incomingBySymbol.delete(item.symbol);
  }
  for (const item of incomingBySymbol.values()) {
    if (seen.has(item.symbol)) continue;
    merged.push(item);
    seen.add(item.symbol);
  }
  return merged;
}

function CompanyMark({ symbol, size = 34 }: { symbol: string; size?: number }) {
  const { styles } = useVisualTheme();
  const [failed, setFailed] = useState(false);
  const domain = COMPANY_DOMAINS[symbol];
  const avatarColors = ["#1D4ED8", "#6D28D9", "#A23B10", "#047857", "#B4235A", "#0F6F71", "#4338CA"];
  const avatarColor = avatarColors[[...symbol].reduce((total, character) => total + character.charCodeAt(0), 0) % avatarColors.length];

  if (!domain || failed) {
    return (
      <View accessibilityLabel={`${symbol} stock avatar`} style={[styles.logoFallback, { width: size, height: size, borderRadius: size / 2, backgroundColor: avatarColor }]}>
        <Text style={[styles.logoFallbackText, { fontSize: Math.max(14, Math.round(size * 0.44)), lineHeight: Math.max(18, Math.round(size * 0.52)) }]}>{symbol.charAt(0).toUpperCase()}</Text>
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

type MarketWindow = { phase: "open" | "pre_market" | "after_hours" | "weekend"; resumes: string };

function marketSessionWindow(timestamp = Date.now()): MarketWindow {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = value("weekday");
  const minutes = Number(value("hour")) * 60 + Number(value("minute"));
  if (weekday === "Sat" || weekday === "Sun") return { phase: "weekend", resumes: "Monday at 9:30 AM ET" };
  if (minutes < 9 * 60 + 30) return { phase: "pre_market", resumes: "Today at 9:30 AM ET" };
  if (minutes >= 16 * 60) return { phase: "after_hours", resumes: weekday === "Fri" ? "Monday at 9:30 AM ET" : "The next trading day at 9:30 AM ET" };
  return { phase: "open", resumes: "Scanning continuously during market hours" };
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
          <Text style={styles.infoCardBody} numberOfLines={2} ellipsizeMode="tail">{firstTwoSentences(proposal.companyCatalyst)}</Text>
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

function PolicyField({ label, value, suffix, accessibilityLabel, onChange }: {
  label: string;
  value: number;
  suffix: string;
  accessibilityLabel: string;
  onChange: (value: number) => void;
}) {
  const { colors, styles } = useVisualTheme();
  return (
    <View style={styles.policyField}>
      <Text style={styles.policyFieldLabel}>{label}</Text>
      <View style={styles.policyInputWrap}>
        {suffix === "$" ? <Text style={styles.policySuffix}>$</Text> : null}
        <TextInput
          accessibilityLabel={accessibilityLabel}
          keyboardType="decimal-pad"
          value={String(value)}
          onChangeText={(text) => {
            const parsed = Number(text.replaceAll(",", ""));
            if (text.trim() !== "" && Number.isFinite(parsed) && parsed >= 0) onChange(parsed);
          }}
          selectionColor={colors.ink}
          style={styles.policyInput}
        />
        {suffix !== "$" ? <Text style={styles.policySuffix}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

function PerformancePage({ report, loading, error, onRefresh, previewMode }: {
  report: PerformanceReport | null; loading: boolean; error: string | null; onRefresh: () => void; previewMode: boolean;
}) {
  const { colors, styles } = useVisualTheme();
  const signedMoney = (value: number | null) => value == null ? "—" : `${value > 0 ? "+" : ""}${money(value)}`;
  const signedPercent = (value: number | null) => value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
  const tone = (value: number | null) => value == null ? styles.performanceNeutral : value >= 0 ? styles.performancePositive : styles.performanceNegative;
  return (
    <View style={styles.performancePage}>
      <Text accessibilityRole="header" style={styles.settingsTitle}>Performance</Text>
      <Text style={styles.settingsIntro}>{previewMode ? "Sample strategy results for exploring the page." : "Results for positions attributed to this strategy in IBKR Paper."}</Text>
      {loading ? <Text style={styles.historyMessage}>Updating from IBKR Paper…</Text> : null}
      {!loading && error ? (
        <View style={styles.historyEmpty}>
          <Text style={styles.historyEmptyTitle}>Performance unavailable</Text>
          <Text style={styles.historyMessage}>Reconnect IBKR Paper and try again.</Text>
          <Pressable accessibilityRole="button" onPress={onRefresh} style={styles.performanceRefresh}><Text style={styles.performanceRefreshText}>Try again</Text></Pressable>
        </View>
      ) : null}
      {!loading && !error && report ? <>
        <View style={styles.performanceHero}>
          <Text style={styles.performanceEyebrow}>TODAY</Text>
          <Text style={[styles.performanceHeroValue, tone(report.today.totalPnl)]}>{signedMoney(report.today.totalPnl)}</Text>
          <Text style={styles.performanceAsOf}>{report.asOf ? `Updated ${new Date(report.asOf).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Update time unavailable"}</Text>
        </View>
        <View style={styles.performanceSummaryGrid}>
          <View style={styles.performanceSummaryItem}><Text style={styles.performanceLabel}>Open positions today</Text><Text style={[styles.performanceValue, tone(report.today.openPositionPnl)]}>{signedMoney(report.today.openPositionPnl)}</Text></View>
          <View style={styles.performanceSummaryItem}><Text style={styles.performanceLabel}>Realized today</Text><Text style={[styles.performanceValue, tone(report.today.realizedGrossPnl)]}>{signedMoney(report.today.realizedGrossPnl)}</Text></View>
          <View style={styles.performanceSummaryItem}><Text style={styles.performanceLabel}>Strategy return</Text><Text style={[styles.performanceValue, tone(report.today.strategyReturnPercent)]}>{signedPercent(report.today.strategyReturnPercent)}</Text></View>
          <View style={styles.performanceSummaryItem}><Text style={styles.performanceLabel}>QQQ today</Text><Text style={[styles.performanceValue, tone(report.today.qqqReturnPercent)]}>{signedPercent(report.today.qqqReturnPercent)}</Text></View>
        </View>
        <View style={styles.performanceComparison}>
          <Text style={styles.performanceLabel}>Compared with QQQ today</Text>
          <Text style={[styles.performanceValue, tone(report.today.versusQqqPercentagePoints)]}>{report.today.versusQqqPercentagePoints == null ? "—" : `${report.today.versusQqqPercentagePoints > 0 ? "+" : ""}${report.today.versusQqqPercentagePoints.toFixed(2)} pts`}</Text>
          <Text style={styles.performanceFootnote}>{report.today.benchmarkDataType === 3 ? "Delayed benchmark quote" : report.today.benchmarkDataType === "broker_position_pnl" ? "Derived from the reconciled QQQ position" : "Broker benchmark quote"}</Text>
        </View>
        <Text style={styles.performanceSectionTitle}>Open positions ({report.openPositions.count})</Text>
        <View style={styles.performanceRows}>
          {report.openPositions.items.map((item) => <View key={item.symbol} style={styles.performanceRow}>
            <CompanyMark symbol={item.symbol} size={38} />
            <View style={styles.performanceRowCopy}><Text style={styles.performanceSymbol}>{item.symbol}</Text><Text style={styles.performanceFootnote}>{item.quantity} shares · {item.marketValue == null ? "value unavailable" : money(item.marketValue)}</Text></View>
            <View style={styles.performanceRowValue}><Text style={[styles.performanceValue, tone(item.unrealizedPnl)]}>{signedMoney(item.unrealizedPnl)}</Text><Text style={styles.performanceFootnote}>{signedPercent(item.entryReturnPercent)} since entry</Text></View>
          </View>)}
        </View>
        <View style={styles.performanceStats}>
          <View><Text style={styles.performanceLabel}>Open unrealized</Text><Text style={[styles.performanceValue, tone(report.openPositions.unrealizedPnl)]}>{signedMoney(report.openPositions.unrealizedPnl)}</Text></View>
          <View><Text style={styles.performanceLabel}>Closed-trade win rate</Text><Text style={styles.performanceValue}>{report.closedTrades.winRatePercent == null ? "Not enough data" : `${report.closedTrades.winRatePercent.toFixed(1)}%`}</Text><Text style={styles.performanceFootnote}>{report.closedTrades.sampleSize} closed trades</Text></View>
          <View><Text style={styles.performanceLabel}>Fees recorded</Text><Text style={styles.performanceValue}>{money(report.closedTrades.knownFees)}</Text><Text style={styles.performanceFootnote}>{report.closedTrades.feesComplete ? "Complete for closed trades" : "Incomplete — gross results shown"}</Text></View>
        </View>
        <Text style={styles.performanceSectionTitle}>Execution quality</Text>
        <View style={styles.performanceStats}>
          <View><Text style={styles.performanceLabel}>Fill vs proposed price</Text><Text style={[styles.performanceValue, tone(report.executionQuality.notionalWeightedSlippageBps == null ? null : -report.executionQuality.notionalWeightedSlippageBps)]}>{report.executionQuality.notionalWeightedSlippageBps == null ? "—" : `${report.executionQuality.notionalWeightedSlippageBps > 0 ? "+" : ""}${report.executionQuality.notionalWeightedSlippageBps.toFixed(2)} bps`}</Text><Text style={styles.performanceFootnote}>{report.executionQuality.sampleSize} filled entries</Text></View>
          <View><Text style={styles.performanceLabel}>Slippage cost</Text><Text style={[styles.performanceValue, tone(report.executionQuality.totalSlippageDollars == null ? null : -report.executionQuality.totalSlippageDollars)]}>{signedMoney(report.executionQuality.totalSlippageDollars)}</Text><Text style={styles.performanceFootnote}>Against the approved limit terms</Text></View>
          <View><Text style={styles.performanceLabel}>Average time to fill</Text><Text style={styles.performanceValue}>{report.executionQuality.averageTimeToFillMs == null ? "—" : `${(report.executionQuality.averageTimeToFillMs / 1000).toFixed(1)} sec`}</Text><Text style={styles.performanceFootnote}>{report.executionQuality.fillTimeSampleSize} timed fills</Text></View>
        </View>
        {!report.closedTrades.feesComplete ? <View style={styles.performanceNotice}><Text style={styles.performanceNoticeTitle}>Net results pending</Text><Text style={styles.performanceFootnote}>{report.closedTrades.missingFeeTradeCount} closed trades still need broker commission records. Gross performance remains visible; missing fees are never treated as zero.</Text></View> : null}
        {report.limitations.length ? <View style={styles.performanceNotice}><Text style={styles.performanceNoticeTitle}>Data notes</Text>{report.limitations.map((item) => <Text key={item} style={styles.performanceFootnote}>• {item}</Text>)}</View> : null}
      </> : null}
    </View>
  );
}

function ResearchPage({ report, loading, error, onRefresh }: {
  report: StrategyComparison | null; loading: boolean; error: string | null; onRefresh: () => void;
}) {
  const { styles } = useVisualTheme();
  const bps = (value: number | null) => value == null ? "—" : `${value > 0 ? "+" : ""}${(value / 100).toFixed(2)}%`;
  const rate = (value: number | null) => value == null ? "—" : `${(value * 100).toFixed(0)}%`;
  return <View style={styles.performancePage}>
    <Text accessibilityRole="header" style={styles.settingsTitle}>Strategy research</Text>
    <Text style={styles.settingsIntro}>A separate test of whether a broader, more volatile stock universe finds better opportunities than the current scanner.</Text>
    <View style={styles.researchBoundary}><Text style={styles.researchBoundaryTitle}>Research only</Text><Text style={styles.performanceFootnote}>These results cannot create recommendations, change position sizes, or submit orders.</Text></View>
    {loading ? <Text style={styles.historyMessage}>Loading the latest comparison…</Text> : null}
    {!loading && error ? <View style={styles.historyEmpty}><Text style={styles.historyEmptyTitle}>Comparison unavailable</Text><Text style={styles.historyMessage}>Run the comparison after both market caches have been refreshed.</Text><Pressable accessibilityRole="button" onPress={onRefresh} style={styles.performanceRefresh}><Text style={styles.performanceRefreshText}>Try again</Text></Pressable></View> : null}
    {!loading && !error && report ? <>
      <View style={styles.researchOverview}>
        <View><Text style={styles.performanceLabel}>Current scanner</Text><Text style={styles.researchUniverse}>{report.baselineUniverseSize.toLocaleString()} stocks</Text></View>
        <View><Text style={styles.performanceLabel}>Volatile shadow lane</Text><Text style={styles.researchUniverse}>{report.shadowUniverseSize.toLocaleString()} stocks</Text></View>
      </View>
      <Text style={styles.performanceFootnote}>{report.forwardSessionCount} held-out sessions · top {report.topK} per lane · {(report.roundTripCostBps / 100).toFixed(2)}% assumed round-trip cost</Text>
      <Text style={styles.performanceSectionTitle}>Outcome comparison</Text>
      {Object.entries(report.metrics).map(([horizon, metric]) => <View key={horizon} style={styles.researchHorizon}>
        <Text style={styles.researchHorizonTitle}>{horizon} session{horizon === "1" ? "" : "s"}</Text>
        <View style={styles.researchMetricRow}><Text style={styles.performanceLabel}>Current scanner average</Text><Text style={styles.performanceValue}>{bps(metric.baseline.meanBps)}</Text></View>
        <View style={styles.researchMetricRow}><Text style={styles.performanceLabel}>Volatile lane average</Text><Text style={styles.performanceValue}>{bps(metric.shadow.meanBps)}</Text></View>
        <View style={styles.researchMetricRow}><Text style={styles.performanceLabel}>Volatile lane win rate</Text><Text style={styles.performanceValue}>{rate(metric.shadow.winRate)}</Text></View>
        <View style={styles.researchMetricRow}><Text style={styles.performanceLabel}>Advantage over current</Text><Text style={styles.performanceValue}>{bps(metric.shadowMinusBaseline.meanBps)}</Text></View>
        <View style={styles.researchMetricRow}><Text style={styles.performanceLabel}>Advantage over {report.benchmarkSymbol}</Text><Text style={styles.performanceValue}>{bps(metric.shadowMinusBenchmark.meanBps)}</Text></View>
      </View>)}
      <View style={styles.performanceNotice}>
        <Text style={styles.performanceNoticeTitle}>Current conclusion</Text>
        <Text style={styles.performanceFootnote}>{report.promotionEvidenceAllowed ? "Eligible for formal promotion review; no automatic promotion occurs." : "Not eligible for promotion. The current symbol universe introduces selection bias, and the uncertainty ranges remain too wide."}</Text>
      </View>
      <View style={styles.performanceNotice}><Text style={styles.performanceNoticeTitle}>Limitations</Text>{report.limitations.map((item) => <Text key={item} style={styles.performanceFootnote}>• {item}</Text>)}</View>
      <Text style={styles.performanceAsOf}>Generated {new Date(report.generatedAt).toLocaleString()}</Text>
    </> : null}
  </View>;
}

function SettingsPage({ policy, operatingPercent, operatingReason, saving, connectionAlertsEnabled, onConnectionAlertsChange, onChange, onSave }: {
  policy: RiskPolicy;
  operatingPercent: number;
  operatingReason: string;
  saving: boolean;
  connectionAlertsEnabled: boolean;
  onConnectionAlertsChange: (enabled: boolean) => void;
  onChange: (policy: RiskPolicy) => void;
  onSave: () => void;
}) {
  const { colors, styles } = useVisualTheme();
  const set = (field: keyof RiskPolicy, value: number | boolean) => onChange({ ...policy, [field]: value });
  return (
    <View style={styles.settingsPage}>
      <Text style={styles.settingsEyebrow}>PAPER RISK POLICY</Text>
      <Text accessibilityRole="header" style={styles.settingsTitle}>Settings</Text>
      <Text style={styles.settingsIntro}>Set the boundaries. Adaptive mode may reduce risk as conditions worsen, but it can never exceed your limits.</Text>

      <View style={styles.policySection}>
        <View style={styles.adaptiveRow}>
          <View style={styles.adaptiveCopy}>
            <Text style={styles.policySectionTitle}>Connection alerts</Text>
            <Text style={styles.policyHelp}>Notify this phone when the running app observes that IBKR Paper has disconnected. A production background alert will require a development or TestFlight build and remote push delivery.</Text>
          </View>
          <Switch
            accessibilityLabel="Connection alerts"
            value={connectionAlertsEnabled}
            onValueChange={onConnectionAlertsChange}
            trackColor={{ false: colors.border, true: colors.actionApprove }}
            thumbColor="#FFFFFF"
          />
        </View>
      </View>

      <View style={styles.policySection}>
        <View style={styles.adaptiveRow}>
          <View style={styles.adaptiveCopy}>
            <Text style={styles.policySectionTitle}>Adaptive sizing</Text>
            <Text style={styles.policyHelp}>Automatically scale amounts within your limits.</Text>
          </View>
          <Switch
            accessibilityLabel="Adaptive sizing"
            accessibilityHint="Allows the paper sizing model to reduce operating risk based on market and portfolio conditions"
            value={policy.adaptive}
            onValueChange={(value) => set("adaptive", value)}
            trackColor={{ false: colors.border, true: colors.actionApprove }}
            thumbColor="#FFFFFF"
          />
        </View>
        <View style={styles.operatingCard}>
          <Text style={styles.operatingLabel}>Current operating level</Text>
          <Text style={styles.operatingValue}>{policy.adaptive ? `${operatingPercent}%` : "Fixed"}</Text>
          <Text style={styles.operatingReason}>{policy.adaptive ? operatingReason : "Using your normal limits without adaptive reduction."}</Text>
          <Text style={styles.operatingFootnote}>Paper preview · reconciled portfolio inputs are not connected yet.</Text>
        </View>
      </View>

      <View style={styles.policySection}>
        <Text style={styles.policySectionTitle}>Trading sleeve</Text>
        <Text style={styles.policyHelp}>Kept separate from long-term savings and investing accounts.</Text>
        <PolicyField label="Sleeve value" accessibilityLabel="Trading sleeve value in dollars" value={policy.sleeveValue} suffix="$" onChange={(value) => set("sleeveValue", value)} />
        <PolicyField label="Minimum cash reserve" accessibilityLabel="Minimum cash reserve percent" value={policy.minimumCashReservePercent} suffix="%" onChange={(value) => set("minimumCashReservePercent", value)} />
        <PolicyField label="Maximum deployed" accessibilityLabel="Maximum deployed capital percent" value={policy.maximumDeployedPercent} suffix="%" onChange={(value) => set("maximumDeployedPercent", value)} />
      </View>

      <View style={styles.policySection}>
        <Text style={styles.policySectionTitle}>Loss limits</Text>
        <PolicyField label="Normal risk per trade" accessibilityLabel="Normal risk per trade percent" value={policy.normalRiskPercent} suffix="%" onChange={(value) => set("normalRiskPercent", value)} />
        <PolicyField label="Hard maximum per trade" accessibilityLabel="Hard maximum risk per trade percent" value={policy.hardRiskPercent} suffix="%" onChange={(value) => set("hardRiskPercent", value)} />
        <PolicyField label="Maximum daily loss" accessibilityLabel="Maximum daily loss percent" value={policy.dailyLossPercent} suffix="%" onChange={(value) => set("dailyLossPercent", value)} />
        <PolicyField label="Maximum total open risk" accessibilityLabel="Maximum total open risk percent" value={policy.totalOpenRiskPercent} suffix="%" onChange={(value) => set("totalOpenRiskPercent", value)} />
      </View>

      <View style={styles.policySection}>
        <Text style={styles.policySectionTitle}>Concentration limits</Text>
        <PolicyField label="Maximum position" accessibilityLabel="Maximum single position percent" value={policy.maximumPositionPercent} suffix="%" onChange={(value) => set("maximumPositionPercent", value)} />
        <PolicyField label="Maximum sector" accessibilityLabel="Maximum sector exposure percent" value={policy.maximumSectorPercent} suffix="%" onChange={(value) => set("maximumSectorPercent", value)} />
        <PolicyField label="Maximum correlated" accessibilityLabel="Maximum correlated exposure percent" value={policy.maximumCorrelatedPercent} suffix="%" onChange={(value) => set("maximumCorrelatedPercent", value)} />
        <PolicyField label="Maximum positions" accessibilityLabel="Maximum simultaneous positions" value={policy.maximumPositions} suffix="" onChange={(value) => set("maximumPositions", Math.round(value))} />
      </View>

      <Pressable accessibilityRole="button" accessibilityLabel="Save paper risk policy" accessibilityState={{ disabled: saving, busy: saving }} disabled={saving} onPress={onSave} style={({ pressed }) => [styles.policySave, saving && styles.homeActionDisabled, pressed && styles.homeActionPressed]}>
        <Text style={styles.policySaveText}>{saving ? "Saving…" : "Save paper policy"}</Text>
      </Pressable>
    </View>
  );
}

function HistoryPage({ page, activity, positions, trades, loading, error, onRefresh, previewMode }: {
  page: "recommendationHistory" | "activity" | "positions"; activity: ActivityItem[]; positions: PositionItem[]; trades: TradeItem[];
  loading: boolean; error: string | null; onRefresh: () => void; previewMode: boolean;
}) {
  const { colors, styles } = useVisualTheme();
  const [activitySearch, setActivitySearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [draftTypeFilter, setDraftTypeFilter] = useState("All");
  const [draftStatusFilter, setDraftStatusFilter] = useState("All");
  const [selectedActivityDetail, setSelectedActivityDetail] = useState<{ kind: "activity"; item: ActivityItem } | { kind: "trade"; item: TradeItem } | null>(null);
  const [historyVisibleCount, setHistoryVisibleCount] = useState(50);
  const openStatuses = new Set(["presubmitted", "submitted", "pendingsubmit", "pendingcancel"]);
  const pendingStatuses = new Set(["approved", "started", "unknown"]);
  const decisionStatuses = new Set(["approved", "denied", "expired"]);
  const scannerOnlyStatuses = new Set(["pending", "replaced"]);
  const normalizeStatus = (status: string) => status.replaceAll("_", "").toLowerCase();
  const recommendationActivity = activity.filter((item) => decisionStatuses.has(normalizeStatus(item.status)));
  const brokerActivity = activity.filter((item) => item.brokerOrderId !== null && !decisionStatuses.has(normalizeStatus(item.status)));
  const activitySource = page === "recommendationHistory" ? recommendationActivity : brokerActivity;
  const empty = page === "recommendationHistory"
    ? recommendationActivity.length === 0
    : page === "activity"
      ? brokerActivity.length === 0 && trades.length === 0
      : positions.length === 0;
  const searchMatches = (symbol: string, ...values: string[]) => {
    const query = activitySearch.trim().toLowerCase();
    return !query || symbol.toLowerCase().includes(query) || values.some((value) => value.toLowerCase().includes(query));
  };
  const matchingActivity = activitySource.filter((item) => {
    const status = normalizeStatus(item.status);
    const typeMatches = typeFilter === "All"
      || (typeFilter === "Orders" && !decisionStatuses.has(status))
      || (typeFilter === "Decisions" && decisionStatuses.has(status));
    const statusMatches = statusFilter === "All"
      || (statusFilter === "Open" && (openStatuses.has(status) || pendingStatuses.has(status)))
      || status === statusFilter.toLowerCase();
    return typeFilter !== "Trades" && typeMatches && statusMatches
      && searchMatches(item.symbol, item.status, item.side);
  });
  const matchingTrades = trades.filter((trade) => {
    const typeMatches = typeFilter === "All" || typeFilter === "Trades";
    const statusMatches = statusFilter === "All"
      || (statusFilter === "Open" && trade.status === "open")
      || (statusFilter === "Closed" && trade.status === "closed");
    return typeMatches && statusMatches
      && searchMatches(trade.symbol, trade.status, trade.exitReason ?? "");
  });
  useEffect(() => setHistoryVisibleCount(50), [activitySearch, typeFilter, statusFilter]);
  const decisionActivity = matchingActivity.filter((item) =>
    item.side.toLowerCase() !== "sell" || !openStatuses.has(normalizeStatus(item.status))
  );
  const tradeIds = new Set(trades.map((trade) => trade.id));
  const openActivity = decisionActivity.filter((item) => !tradeIds.has(item.id)
    && item.brokerOrderId !== null && openStatuses.has(normalizeStatus(item.status)));
  const historicalActivity = decisionActivity.filter((item) => !tradeIds.has(item.id)
    && !openStatuses.has(normalizeStatus(item.status))
    && !scannerOnlyStatuses.has(normalizeStatus(item.status)));
  const openTrades = matchingTrades.filter((trade) => trade.status === "open");
  const closedTrades = matchingTrades.filter((trade) => trade.status === "closed");
  const visibleHistoricalActivity = historicalActivity.slice(0, historyVisibleCount);
  const visibleClosedTrades = closedTrades.slice(0, historyVisibleCount);
  const hasMoreHistory = historicalActivity.length > visibleHistoricalActivity.length || closedTrades.length > visibleClosedTrades.length;
  const openFilters = () => {
    setDraftTypeFilter(typeFilter);
    setDraftStatusFilter(statusFilter);
    setFilterSheetOpen(true);
  };
  const applyFilters = () => {
    setTypeFilter(draftTypeFilter);
    setStatusFilter(draftStatusFilter);
    setFilterSheetOpen(false);
  };
  const friendlyStatus = (status: string) => ({
    presubmitted: "Accepted · waiting",
    submitted: "Working",
    pendingsubmit: "Sending",
    pendingcancel: "Cancelling",
    filled: "Filled",
    approved: "Approved",
    denied: "Denied",
    expired: "Expired",
    replaced: "Updated",
  }[status.replaceAll("_", "").toLowerCase()] ?? status.replaceAll("_", " "));
  const selectedDetailTitle = selectedActivityDetail
    ? `${selectedActivityDetail.item.symbol} ${selectedActivityDetail.kind === "trade" ? "trade" : selectedActivityDetail.item.side.toLowerCase()}`
    : "Activity detail";
  const selectedDetailRows: Array<{ label: string; value: string }> = selectedActivityDetail?.kind === "activity"
    ? [
        { label: "Status", value: friendlyStatus(selectedActivityDetail.item.status) },
        { label: "Action", value: selectedActivityDetail.item.side.toUpperCase() },
        { label: "Quantity", value: selectedActivityDetail.item.quantity == null ? "—" : `${selectedActivityDetail.item.quantity} shares` },
        { label: "Limit price", value: selectedActivityDetail.item.limitPrice == null ? "—" : money(selectedActivityDetail.item.limitPrice) },
        { label: "Date", value: new Date(selectedActivityDetail.item.occurredAt).toLocaleString() },
        { label: "Broker order", value: selectedActivityDetail.item.brokerOrderId ?? (previewMode ? "Preview only" : "—") },
        { label: "Environment", value: selectedActivityDetail.item.environment },
      ]
    : selectedActivityDetail?.kind === "trade"
      ? [
          { label: "Status", value: selectedActivityDetail.item.status === "open" ? "Position open" : "Trade closed" },
          { label: "Quantity", value: `${selectedActivityDetail.item.quantity} shares` },
          { label: "Entry price", value: money(selectedActivityDetail.item.entryPrice) },
          { label: "Entry value", value: money(selectedActivityDetail.item.entryValue) },
          { label: "Opened", value: new Date(selectedActivityDetail.item.openedAt).toLocaleString() },
          ...(selectedActivityDetail.item.exitPrice == null ? [] : [{ label: "Exit price", value: money(selectedActivityDetail.item.exitPrice) }]),
          ...(selectedActivityDetail.item.closedAt == null ? [] : [{ label: "Closed", value: new Date(selectedActivityDetail.item.closedAt).toLocaleString() }]),
          ...(selectedActivityDetail.item.grossProfit == null ? [] : [{ label: selectedActivityDetail.item.feesComplete ? "Net profit/loss" : "Gross profit/loss", value: `${selectedActivityDetail.item.grossProfit >= 0 ? "+" : ""}${money(selectedActivityDetail.item.feesComplete && selectedActivityDetail.item.netProfit != null ? selectedActivityDetail.item.netProfit : selectedActivityDetail.item.grossProfit)}` }]),
          { label: "Protective stop", value: selectedActivityDetail.item.protectiveStopPrice == null ? "—" : money(selectedActivityDetail.item.protectiveStopPrice) },
          { label: "Profit target", value: selectedActivityDetail.item.profitTargetPrice == null ? "—" : money(selectedActivityDetail.item.profitTargetPrice) },
        ]
      : [];
  return (
    <View style={styles.historyPage}>
      <Text accessibilityRole="header" style={styles.settingsTitle}>{page === "recommendationHistory" ? "Recommendation history" : page === "activity" ? "Activity" : "Positions"}</Text>
      {page === "positions" ? <Text style={styles.settingsIntro}>
        {previewMode ? "Sample positions created while you explore the app." : "Current IBKR Paper positions and ownership checks."}
      </Text> : null}
      {page === "activity" || page === "recommendationHistory" ? (
        <>
          <View style={styles.activitySearch}>
            <MagnifyingGlassIcon size={19} color={colors.muted} weight="regular" />
            <TextInput
              accessibilityLabel={page === "recommendationHistory" ? "Search recommendation history" : "Search activity"}
              placeholder={page === "recommendationHistory" ? "Search recommendations" : "Search activity"}
              placeholderTextColor={colors.muted}
              value={activitySearch}
              onChangeText={setActivitySearch}
              style={styles.activitySearchInput}
            />
            {page === "activity" ? <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open activity filters${typeFilter !== "All" || statusFilter !== "All" ? ", filters active" : ""}`}
              onPress={openFilters}
              style={styles.activityFilterIcon}
            >
              <SlidersHorizontalIcon size={18} color={colors.ink} weight="regular" />
            </Pressable> : null}
          </View>
        </>
      ) : null}
      {loading ? <Text style={styles.historyMessage}>Loading…</Text> : error ? <Text style={styles.historyMessage}>Activity service is unavailable.</Text> : null}
      {!loading && !error && empty ? (
        <View style={styles.historyEmpty}>
          <Text style={styles.historyEmptyTitle}>{page === "recommendationHistory" ? "No completed recommendations" : page === "activity" ? "No activity yet" : "No recorded positions"}</Text>
          <Text style={styles.historyMessage}>{page === "recommendationHistory" ? "Recommendations appear here after they are approved, denied, or expire." : page === "activity" ? "Broker orders and completed trades will appear here." : "A position appears after the ledger observes a filled entry."}</Text>
        </View>
      ) : null}
      {!loading && !error && page === "activity" && openActivity.length > 0 ? (
        <View style={styles.activitySection}>
          <Text style={styles.activitySectionTitle}>Open orders ({openActivity.length})</Text>
          {openActivity.map((item) => (
            <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Open ${item.symbol} order details`} onPress={() => setSelectedActivityDetail({ kind: "activity", item })} style={({ pressed }) => [styles.activityRow, pressed && styles.activityRowPressed]}>
              <CompanyMark symbol={item.symbol} size={36} />
              <View style={styles.historyRowMain}>
                <Text style={styles.historySymbol}>{item.symbol} {item.side.toLowerCase()} order</Text>
                <Text style={styles.historyMeta}>{item.quantity ?? "—"} shares · {new Date(item.occurredAt).toLocaleDateString()}</Text>
              </View>
              <View style={styles.historyRowEnd}>
                <Text style={styles.historyStatus}>{friendlyStatus(item.status)}</Text>
                <Text style={styles.historyTime}>{item.limitPrice ? money(item.limitPrice) : previewMode ? "Preview" : "—"}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
      {!loading && !error && page === "activity" && openTrades.length > 0 ? (
        <View style={styles.activitySection}>
          <Text style={styles.activitySectionTitle}>Open positions ({openTrades.length})</Text>
          {openTrades.map((trade) => (
            <Pressable key={trade.id} accessibilityRole="button" accessibilityLabel={`Open ${trade.symbol} position details`} onPress={() => setSelectedActivityDetail({ kind: "trade", item: trade })} style={({ pressed }) => [styles.activityRow, pressed && styles.activityRowPressed]}>
              <CompanyMark symbol={trade.symbol} size={36} />
              <View style={styles.historyRowMain}>
                <Text style={styles.historySymbol}>{trade.symbol}</Text>
                <Text style={styles.historyMeta}>{trade.quantity} shares · entered at {money(trade.entryPrice)}</Text>
              </View>
              <View style={styles.historyRowEnd}>
                <Text style={styles.historyStatus}>Position open</Text>
                <Text style={styles.historyTime}>{money(trade.entryValue)} invested</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
      {!loading && !error && page === "recommendationHistory" && visibleHistoricalActivity.length > 0 ? (
        <View style={styles.activitySection}>
          <Text style={styles.activitySectionTitle}>History ({historicalActivity.length})</Text>
          {visibleHistoricalActivity.map((item) => (
            <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Open ${item.side} ${item.quantity ?? ""} ${item.symbol} details`} onPress={() => setSelectedActivityDetail({ kind: "activity", item })} style={({ pressed }) => [styles.activityRow, pressed && styles.activityRowPressed]}>
              <CompanyMark symbol={item.symbol} size={36} />
              <View style={styles.historyRowMain}>
                <Text numberOfLines={1} style={styles.historySymbol}>{item.side.charAt(0).toUpperCase()}{item.side.slice(1).toLowerCase()} {item.quantity ?? "—"} {item.symbol}</Text>
                <Text numberOfLines={1} style={styles.historyMeta}>{item.symbol} · {companyName(item)}</Text>
              </View>
              <View style={styles.historyRowEnd}>
                <Text numberOfLines={1} style={styles.historyStatus}>{friendlyStatus(item.status)}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
      {!loading && !error && page === "activity" && visibleHistoricalActivity.length > 0 ? (
        <View style={styles.activitySection}>
          <Text style={styles.activitySectionTitle}>Order history ({historicalActivity.length})</Text>
          {visibleHistoricalActivity.map((item) => (
            <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Open ${item.symbol} order details`} onPress={() => setSelectedActivityDetail({ kind: "activity", item })} style={({ pressed }) => [styles.activityRow, pressed && styles.activityRowPressed]}>
              <CompanyMark symbol={item.symbol} size={36} />
              <View style={styles.historyRowMain}>
                <Text style={styles.historySymbol}>{item.symbol} {item.side.toLowerCase()}</Text>
                <Text style={styles.historyMeta}>{item.quantity ?? "—"} shares · {new Date(item.occurredAt).toLocaleDateString()}</Text>
              </View>
              <View style={styles.historyRowEnd}>
                <Text style={styles.historyStatus}>{friendlyStatus(item.status)}</Text>
                <Text style={styles.historyTime}>{item.limitPrice ? money(item.limitPrice) : previewMode ? "Preview" : "—"}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
      {!loading && !error && page === "activity" && visibleClosedTrades.length > 0 ? (
        <View style={styles.activitySection}>
          <Text style={styles.activitySectionTitle}>Closed trades ({closedTrades.length})</Text>
          {visibleClosedTrades.map((trade) => {
            const profit = trade.feesComplete ? trade.netProfit : trade.grossProfit;
            return (
              <Pressable key={trade.id} accessibilityRole="button" accessibilityLabel={`Open ${trade.symbol} closed trade details`} onPress={() => setSelectedActivityDetail({ kind: "trade", item: trade })} style={({ pressed }) => [styles.activityRow, pressed && styles.activityRowPressed]}>
                <CompanyMark symbol={trade.symbol} size={36} />
                <View style={styles.historyRowMain}>
                  <Text style={styles.historySymbol}>{trade.symbol}</Text>
                  <Text style={styles.historyMeta}>{trade.quantity} shares · {trade.exitReason === "profit_target" ? "Target reached" : trade.exitReason === "protective_stop" ? "Protective stop" : "Sold"}</Text>
                </View>
                <View style={styles.historyRowEnd}>
                  <Text style={[styles.historyStatus, { color: (profit ?? 0) >= 0 ? colors.actionApprove : colors.danger }]}>{profit == null ? "—" : `${profit >= 0 ? "+" : ""}${money(profit)}`}</Text>
                  <Text style={styles.historyTime}>{trade.feesComplete ? "Net profit/loss" : "Gross · fees pending"}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {!loading && !error && (page === "activity" || page === "recommendationHistory") && hasMoreHistory ? (
        <Pressable accessibilityRole="button" onPress={() => setHistoryVisibleCount((count) => count + 50)} style={({ pressed }) => [styles.previewProposalButton, pressed && styles.homeActionPressed]}>
          <Text style={styles.previewProposalButtonText}>{page === "recommendationHistory" ? "Load older recommendations" : "Load older activity"}</Text>
        </Pressable>
      ) : null}
      {!loading && !error && (page === "activity" || page === "recommendationHistory") && !empty && matchingActivity.length === 0 && (page === "recommendationHistory" || matchingTrades.length === 0) ? (
        <Text style={styles.historyMessage}>{page === "recommendationHistory" ? "No recommendations match your search." : "No activity matches your search."}</Text>
      ) : null}
      {!loading && !error && page === "positions" && positions.map((item) => (
        <View key={item.id} style={styles.positionCard}>
          <View style={styles.historyRow}>
            <CompanyMark symbol={item.symbol} size={40} />
            <View style={styles.historyRowMain}><Text style={styles.historySymbol}>{item.symbol}</Text><Text style={styles.historyMeta}>{item.quantity} shares</Text></View>
            <Text style={styles.historyStatus}>{money(item.quantity * item.averageEntryPrice)}</Text>
          </View>
          <View style={styles.positionTerms}>
            <View style={styles.tradeTermRow}><Text style={styles.tradeTermLabel}>Average entry</Text><Text style={styles.tradeTermValue}>{money(item.averageEntryPrice)}</Text></View>
            {item.dataState === "reconciled" ? <View style={styles.tradeTermRow}><Text style={styles.tradeTermLabel}>Strategy ownership</Text><Text style={styles.tradeTermValue}>{item.ownership === "strategy_owned" ? item.ownershipSource === "broker_flex_legacy" ? `${item.strategyOwnedQuantity} legacy app shares` : `${item.strategyOwnedQuantity} shares matched` : item.ownership === "conflict" ? "Needs review" : "Unattributed"}</Text></View> : null}
            {item.dataState === "reconciled" && item.brokerHistory ? <View style={styles.tradeTermRow}><Text style={styles.tradeTermLabel}>Broker trade history</Text><Text style={styles.tradeTermValue}>{item.brokerHistory.status === "matched" ? `${item.brokerHistory.netQuantity} shares match` : "Quantity differs"}</Text></View> : null}
            {item.dataState === "reconciled" ? <View style={styles.tradeTermRow}><Text style={styles.tradeTermLabel}>Broker protection</Text><Text style={styles.tradeTermValue}>{item.protection === "verified" ? "Verified" : item.protection === "missing" ? "Missing" : item.protection === "partial" ? "Partial" : item.protection === "overcovered" ? "Overcovered" : "Unverified"}</Text></View> : null}
            <View style={styles.tradeTermRow}><Text style={styles.tradeTermLabel}>Protective stop</Text><Text style={styles.tradeTermValue}>{item.protectiveStopPrice ? money(item.protectiveStopPrice) : "—"}</Text></View>
            <View style={styles.tradeTermRow}><Text style={styles.tradeTermLabel}>Profit target</Text><Text style={styles.tradeTermValue}>{item.profitTargetPrice ? money(item.profitTargetPrice) : "—"}</Text></View>
          </View>
          <Text style={styles.positionNotice}>{item.dataState === "preview" ? "Preview data · no broker order" : item.dataState === "reconciled" ? item.reasons?.join(" · ") ?? "Broker quantity confirmed; ownership unverified" : "Awaiting IBKR Paper reconciliation"}</Text>
        </View>
      ))}
      {!previewMode ? <Pressable accessibilityRole="button" onPress={onRefresh} style={({ pressed }) => [styles.previewProposalButton, pressed && styles.homeActionPressed]}>
        <Text style={styles.previewProposalButtonText}>Refresh</Text>
      </Pressable> : null}
      <Modal visible={filterSheetOpen} transparent animationType="fade" onRequestClose={() => setFilterSheetOpen(false)}>
        <View style={styles.filterSheetLayer}>
          <Pressable accessibilityLabel="Close filters" onPress={() => setFilterSheetOpen(false)} style={styles.filterSheetBackdrop} />
          <SafeAreaView style={styles.filterSheet} edges={["bottom"]}>
            <View style={styles.filterSheetHandle} />
            <View style={styles.filterSheetHeader}>
              <Text style={styles.filterSheetTitle}>Filters</Text>
              <Pressable accessibilityRole="button" onPress={() => { setDraftTypeFilter("All"); setDraftStatusFilter("All"); }} hitSlop={8}>
                <Text style={styles.filterSheetClear}>Clear</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.filterSheetContent} showsVerticalScrollIndicator={false}>
              {([
                { label: "Type", options: ["All", "Orders", "Decisions", "Trades"], value: draftTypeFilter, setValue: setDraftTypeFilter },
                { label: "Status", options: ["All", "Open", "Filled", "Denied", "Expired", "Closed"], value: draftStatusFilter, setValue: setDraftStatusFilter },
              ] as const).map((section) => (
                <View key={section.label} style={styles.filterSheetSection}>
                  <Text style={styles.filterSheetSectionTitle}>{section.label}</Text>
                  <View style={styles.filterSheetChoices}>
                    {section.options.map((option) => {
                      const selected = section.value === option;
                      return <Pressable key={option} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => section.setValue(option)} style={[styles.filterSheetChoice, selected && styles.filterSheetChoiceSelected]}>
                        <Text style={[styles.filterSheetChoiceText, selected && styles.filterSheetChoiceTextSelected]}>{option}</Text>
                      </Pressable>;
                    })}
                  </View>
                </View>
              ))}
            </ScrollView>
            <Pressable accessibilityRole="button" onPress={applyFilters} style={({ pressed }) => [styles.filterSheetApply, pressed && styles.homeActionPressed]}>
              <Text style={styles.filterSheetApplyText}>Apply filters</Text>
            </Pressable>
          </SafeAreaView>
        </View>
      </Modal>
      <Modal visible={selectedActivityDetail !== null} transparent animationType="fade" onRequestClose={() => setSelectedActivityDetail(null)}>
        <View style={styles.filterSheetLayer}>
          <Pressable accessibilityLabel="Close activity details" onPress={() => setSelectedActivityDetail(null)} style={styles.filterSheetBackdrop} />
          <SafeAreaView style={styles.activityDetailSheet} edges={["bottom"]}>
            <View style={styles.filterSheetHandle} />
            <View style={styles.filterSheetHeader}>
              <View style={styles.activityDetailTitleRow}>
                {selectedActivityDetail ? <CompanyMark symbol={selectedActivityDetail.item.symbol} size={40} /> : null}
                <Text style={styles.filterSheetTitle}>{selectedDetailTitle}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close activity details" onPress={() => setSelectedActivityDetail(null)} style={styles.sheetClose}>
                <XIcon size={20} color={colors.ink} weight="regular" />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.activityDetailContent} showsVerticalScrollIndicator={false}>
              {selectedDetailRows.map((row) => (
                <View key={row.label} style={styles.activityDetailRow}>
                  <Text style={styles.tradeTermLabel}>{row.label}</Text>
                  <Text style={styles.activityDetailValue}>{row.value}</Text>
                </View>
              ))}
              {page === "recommendationHistory" && selectedActivityDetail?.kind === "activity" ? (
                <View style={styles.sheetSection}>
                  <Text style={styles.sheetSectionTitle}>Why this trade</Text>
                  <Text style={styles.sheetBody}>{selectedActivityDetail.item.researchContext ?? "Detailed rationale was not recorded for this recommendation."}</Text>
                  {(selectedActivityDetail.item.rationale ?? []).map((reason) => (
                    <View key={reason} style={styles.infoRow}>
                      <CheckCircleIcon size={17} color={colors.accent} weight="regular" />
                      <Text style={styles.infoRowText}>{reason}</Text>
                    </View>
                  ))}
                  <View style={styles.sheetSection}>
                    <Text style={styles.sheetSectionTitle}>Original trade plan</Text>
                    <View style={styles.activityDetailRow}>
                      <Text style={styles.tradeTermLabel}>Profit target</Text>
                      <Text style={styles.activityDetailValue}>{selectedActivityDetail.item.targetPrice == null ? "—" : money(selectedActivityDetail.item.targetPrice)}</Text>
                    </View>
                    <View style={styles.activityDetailRow}>
                      <Text style={styles.tradeTermLabel}>Protective stop</Text>
                      <Text style={styles.activityDetailValue}>{selectedActivityDetail.item.stopPrice == null ? "—" : money(selectedActivityDetail.item.stopPrice)}</Text>
                    </View>
                    <View style={styles.activityDetailRow}>
                      <Text style={styles.tradeTermLabel}>Time horizon</Text>
                      <Text style={styles.activityDetailValue}>{selectedActivityDetail.item.targetTimeframe ?? "—"}</Text>
                    </View>
                  </View>
                </View>
              ) : null}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

export default function App() {
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const [darkMode, setDarkMode] = useState(false);
  const [activePage, setActivePage] = useState<AppPage>("review");
  const [riskPolicy, setRiskPolicy] = useState<RiskPolicy>(SMART_RISK_POLICY);
  const [policySaving, setPolicySaving] = useState(false);
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const [positionItems, setPositionItems] = useState<PositionItem[]>([]);
  const [tradeItems, setTradeItems] = useState<TradeItem[]>([]);
  const [previewActivityItems, setPreviewActivityItems] = useState<ActivityItem[]>(PREVIEW_ACTIVITY);
  const [previewPositionItems, setPreviewPositionItems] = useState<PositionItem[]>(PREVIEW_POSITIONS);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [performanceReport, setPerformanceReport] = useState<PerformanceReport | null>(null);
  const [performanceLoading, setPerformanceLoading] = useState(false);
  const [performanceError, setPerformanceError] = useState<string | null>(null);
  const [strategyComparison, setStrategyComparison] = useState<StrategyComparison | null>(null);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const colors = darkMode ? darkPalette : palette;
  const activeTheme = darkMode ? darkTheme : theme;
  const styles = useMemo(() => createStyles(colors), [colors]);
  const marketWindow = marketSessionWindow();
  const [proposal, setProposal] = useState(SHADOW_LOADING);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [rationaleOpen, setRationaleOpen] = useState(false);
  const [, tick] = useState(0);
  const [broker, setBroker] = useState<BrokerSnapshot | null>(null);
  const [brokerConnectionStatus, setBrokerConnectionStatus] = useState<BrokerConnectionStatus>("checking");
  const [brokerConnectionHealth, setBrokerConnectionHealth] = useState<BrokerConnectionHealth | null>(null);
  const [connectionAlertsEnabled, setConnectionAlertsEnabled] = useState(false);
  const [brokerUnavailable, setBrokerUnavailable] = useState(false);
  const [noEligibleRecommendation, setNoEligibleRecommendation] = useState(false);
  const [strategyCapitalReached, setStrategyCapitalReached] = useState(false);
  const [portfolioReview, setPortfolioReview] = useState<PortfolioReview | null>(null);
  const [orderPreview, setOrderPreview] = useState<OrderPreview | null>(null);
  const [whatIfResult, setWhatIfResult] = useState<WhatIfResult | null>(null);
  const [paperSubmission, setPaperSubmission] = useState<PaperSubmission | null>(null);
  const [submittedProposalIds, setSubmittedProposalIds] = useState<string[]>([]);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [appToast, setAppToast] = useState<AppToast | null>(null);
  const [processing, setProcessing] = useState(false);
  const [showRecommendationSkeleton, setShowRecommendationSkeleton] = useState(false);
  const [decisionsInFlight, setDecisionsInFlight] = useState<Record<string, "approved" | "denied">>({});
  const [strategy, setStrategy] = useState<StrategySummary | null>(null);
  const [uiPreview, setUiPreview] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [reviewedExampleIds, setReviewedExampleIds] = useState<string[]>([]);
  const [sampleDeckComplete, setSampleDeckComplete] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [realRecommendations, setRealRecommendations] = useState<Proposal[]>([]);
  const recommendationDeckRef = useRef<Proposal[]>([]);
  const activeProposalRef = useRef<Proposal>(SHADOW_LOADING);
  const [realDeckComplete, setRealDeckComplete] = useState(false);
  const [transitionCard, setTransitionCard] = useState<Proposal | null>(null);
  const [cardWidth, setCardWidth] = useState(0);
  const [cardBodyHeight, setCardBodyHeight] = useState(0);
  const cardPosition = useRef(new Animated.ValueXY()).current;
  const cardEntryProgress = useRef(new Animated.Value(1)).current;
  const menuProgress = useRef(new Animated.Value(0)).current;
  const skeletonPulse = useRef(new Animated.Value(0.52)).current;
  const cardAnimating = useRef(false);
  const cardWasDragged = useRef(false);
  const suppressCardTapUntil = useRef(0);
  const brokerCheckInFlight = useRef(false);
  const brokerFailureCount = useRef(0);
  const previousBrokerStatus = useRef<BrokerConnectionStatus>("checking");
  const orderWorkflowsInFlight = useRef(0);
  const recommendationScanInFlight = useRef(false);
  const expiredRefreshInFlight = useRef(false);
  const uiPreviewRef = useRef(false);
  const dismissToast = useCallback(() => setAppToast(null), []);
  const adaptiveOperatingPercent = !riskPolicy.adaptive
    ? 100
    : brokerConnectionStatus === "disconnected"
      ? 0
      : proposal.marketRisk?.level === "VERY_HIGH"
        ? 35
        : proposal.marketRisk?.level === "HIGH"
          ? 60
          : proposal.marketRisk?.level === "MODERATE"
            ? 80
            : 100;
  const adaptiveOperatingReason = brokerConnectionStatus === "disconnected"
      ? "Paper broker data is unavailable, so new risk is paused."
      : proposal.marketRisk?.level === "VERY_HIGH"
        ? "Current observed volatility is very high."
        : proposal.marketRisk?.level === "HIGH"
          ? "Current observed volatility is elevated."
          : proposal.marketRisk?.level === "MODERATE"
            ? "Current observed volatility is moderate."
      : "Current observed volatility is within the normal range.";

  useEffect(() => {
    let active = true;
    fetch(`${API_BASE_URL}/risk-policy`, { headers: { "x-app-token": APP_TOKEN } })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("policy_unavailable")))
      .then((result: { policy?: RiskPolicy }) => {
        if (active && result.policy) setRiskPolicy(result.policy);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(CONNECTION_ALERTS_STORAGE_KEY)
      .then((value) => setConnectionAlertsEnabled(value === "true"))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const previous = previousBrokerStatus.current;
    previousBrokerStatus.current = brokerConnectionStatus;
    if (uiPreview || previous === brokerConnectionStatus) return;
    if (brokerConnectionStatus === "disconnected") {
      const disconnectedAt = brokerConnectionHealth?.lastDisconnectedAt ?? Date.now();
      void AsyncStorage.setItem("trade-approval.last-connection-alert", JSON.stringify({ status: "disconnected", at: disconnectedAt }));
      setAppToast({ tone: "danger", title: "IBKR Paper disconnected", message: "New orders are blocked. Existing broker-native orders remain at IBKR." });
      if (connectionAlertsEnabled) {
        void Notifications.scheduleNotificationAsync({
          content: { title: "IBKR Paper disconnected", body: "Trade Approval blocked new orders. Open the app to reconnect." },
          trigger: null,
        }).catch(() => undefined);
      }
    } else if (brokerConnectionStatus === "connected" && previous === "disconnected") {
      void AsyncStorage.setItem("trade-approval.last-connection-alert", JSON.stringify({ status: "recovered", at: Date.now() }));
      setAppToast({ tone: "success", title: "IBKR Paper reconnected", message: "Fresh broker checks are available again." });
    }
  }, [brokerConnectionStatus, brokerConnectionHealth?.lastDisconnectedAt, connectionAlertsEnabled, uiPreview]);

  async function changeConnectionAlerts(enabled: boolean) {
    if (!enabled) {
      setConnectionAlertsEnabled(false);
      await AsyncStorage.setItem(CONNECTION_ALERTS_STORAGE_KEY, "false");
      return;
    }
    const current = await Notifications.getPermissionsAsync();
    const allowed = current.granted || current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    const requested = allowed ? current : await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
    const granted = requested.granted || requested.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    setConnectionAlertsEnabled(granted);
    await AsyncStorage.setItem(CONNECTION_ALERTS_STORAGE_KEY, String(granted));
    setAppToast(granted
      ? { tone: "success", title: "Connection alerts enabled", message: "This device can alert you when the running app detects a broker disconnect." }
      : { tone: "danger", title: "Notifications not enabled", message: "Allow notifications in iPhone Settings to receive connection alerts." });
  }

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(PREVIEW_MODE_STORAGE_KEY)
      .then((value) => {
        if (!active || value !== "true") return;
        previewActiveProposal();
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function savePaperRiskPolicy() {
    const invalid = riskPolicy.normalRiskPercent > riskPolicy.hardRiskPercent
      || riskPolicy.minimumCashReservePercent + riskPolicy.maximumDeployedPercent > 100
      || riskPolicy.maximumPositionPercent > riskPolicy.maximumDeployedPercent
      || riskPolicy.maximumSectorPercent > riskPolicy.maximumDeployedPercent
      || riskPolicy.maximumCorrelatedPercent > riskPolicy.maximumDeployedPercent
      || riskPolicy.maximumPositions < 1;
    if (invalid) {
      setAppToast({ tone: "danger", title: "Policy needs attention", message: "Check that normal risk is below the hard maximum and that allocation limits do not conflict." });
      return;
    }
    if (uiPreview) {
      setAppToast({ tone: "success", title: "Preview settings updated", message: "Saved for this preview session only." });
      setActivePage("review");
      return;
    }
    setPolicySaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/risk-policy`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-app-token": APP_TOKEN },
        body: JSON.stringify({ policy: riskPolicy }),
      });
      if (!response.ok) throw new Error("policy_save_failed");
      setAppToast({ tone: "success", title: "Paper policy saved", message: "The policy is stored on your Mac. Adaptive amounts remain a preview until reconciled inputs are connected." });
      setActivePage("review");
    } catch {
      setAppToast({ tone: "danger", title: "Policy not saved", message: "Keep the local service running and try again." });
    } finally {
      setPolicySaving(false);
    }
  }

  async function loadHistory() {
    if (uiPreviewRef.current) {
      setHistoryError(null);
      setHistoryLoading(false);
      setActivityItems(previewActivityItems);
      setPositionItems(previewPositionItems);
      setTradeItems(PREVIEW_TRADES);
      return;
    }
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const headers = { "x-app-token": APP_TOKEN };
      if (brokerConnectionStatus === "connected") {
        await fetch(`${API_BASE_URL}/broker/reconcile`, { method: "POST", headers }).catch(() => undefined);
      }
      const [activityResponse, positionsResponse, tradesResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/activity`, { headers }),
        fetch(`${API_BASE_URL}/positions`, { headers }),
        fetch(`${API_BASE_URL}/trades`, { headers }),
      ]);
      if (!activityResponse.ok || !positionsResponse.ok || !tradesResponse.ok) throw new Error("history_unavailable");
      const activityResult = await activityResponse.json();
      const positionsResult = await positionsResponse.json();
      const tradesResult = await tradesResponse.json();
      setActivityItems(activityResult.items ?? []);
      setPositionItems(positionsResult.items ?? []);
      setTradeItems(tradesResult.items ?? []);
    } catch {
      setHistoryError("history_unavailable");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadPerformance() {
    if (uiPreviewRef.current) {
      setPerformanceReport(PREVIEW_PERFORMANCE);
      setPerformanceError(null);
      setPerformanceLoading(false);
      return;
    }
    setPerformanceLoading(true);
    setPerformanceError(null);
    try {
      const headers = { "x-app-token": APP_TOKEN };
      const reconciliation = await fetch(`${API_BASE_URL}/broker/reconcile`, { method: "POST", headers });
      if (!reconciliation.ok) throw new Error("reconciliation_unavailable");
      const response = await fetch(`${API_BASE_URL}/performance`, { headers });
      if (!response.ok) throw new Error("performance_unavailable");
      setPerformanceReport(await response.json());
    } catch {
      setPerformanceError("performance_unavailable");
    } finally {
      setPerformanceLoading(false);
    }
  }

  function openPerformance() {
    setActivePage("performance");
    void loadPerformance();
  }

  async function loadResearch() {
    setResearchLoading(true);
    setResearchError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/research/strategy-comparison`, { headers: { "x-app-token": APP_TOKEN } });
      if (!response.ok) throw new Error("strategy_comparison_unavailable");
      setStrategyComparison(await response.json());
    } catch {
      setResearchError("strategy_comparison_unavailable");
    } finally {
      setResearchLoading(false);
    }
  }

  function openResearch() {
    setActivePage("research");
    void loadResearch();
  }

  function openHistory(page: "recommendationHistory" | "activity" | "positions") {
    setActivePage(page);
    if (uiPreview) {
      setHistoryError(null);
      setHistoryLoading(false);
      setActivityItems(previewActivityItems);
      setPositionItems(previewPositionItems);
      setTradeItems(PREVIEW_TRADES);
    } else {
      void loadHistory();
    }
  }

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

  function serviceProposalToCard(serviceProposal: ServiceProposal, snapshot: BrokerSnapshot, strategySummary: StrategySummary): Proposal {
    const positionValue = serviceProposal.quantity * serviceProposal.limitPrice;
    const potentialUpside = serviceProposal.quantity * (serviceProposal.targetPrice - serviceProposal.limitPrice);
    return {
      ...PAPER_PROPOSAL,
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
      companyCatalyst: serviceProposal.researchContext ?? "This recommendation passed the current deterministic market, liquidity, and risk rules.",
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
    };
  }

  function applyServiceProposal(serviceProposal: ServiceProposal, snapshot: BrokerSnapshot, strategySummary: StrategySummary) {
    setBroker(snapshot);
    setBrokerUnavailable(false);
    setStrategyCapitalReached(false);
    setOrderPreview(null);
    setWhatIfResult(null);
    setPaperSubmission(null);
    setWorkflowError(null);
    setProcessing(false);
    setStrategy(strategySummary);
    setProposal(serviceProposalToCard(serviceProposal, snapshot, strategySummary));
  }

  async function createPaperProposal(preferredSymbol?: string) {
    const response = await fetch(`${API_BASE_URL}/recommendations/queue`, {
      method: "POST",
      headers: { "x-app-token": APP_TOKEN },
    });
    const result = await response.json() as { recommendations: QueuedServiceRecommendation[]; strategy: StrategySummary; portfolioReview?: PortfolioReview; error?: string };
    if (!response.ok) throw new Error(result.error ?? "proposal_unavailable");
    setStrategy(result.strategy);
    if (result.portfolioReview) {
      recommendationDeckRef.current = [];
      setRealRecommendations([]);
      setProposal(SHADOW_LOADING);
      setRealDeckComplete(false);
      setPortfolioReview(result.portfolioReview);
      setStrategyCapitalReached(true);
      setNoEligibleRecommendation(false);
      setBrokerUnavailable(false);
      setBrokerConnectionStatus("connected");
      return;
    }
    const cards = result.recommendations
      .filter((item) => item.broker?.ok)
      .map((item) => serviceProposalToCard(item.proposal, item.broker, result.strategy));
    if (cards.length === 0) throw new Error("recommendation_queue_empty");
    const mergedCards = mergeRecommendationDeck(recommendationDeckRef.current, cards);
    const activeCard = (preferredSymbol ? mergedCards.find((item) => item.symbol === preferredSymbol) : null)
      ?? mergedCards.find((item) => item.symbol === proposal.symbol)
      ?? mergedCards[0];
    const first = result.recommendations.find((item) => item.proposal.id === activeCard?.id);
    if (!first?.broker?.ok) throw new Error("recommendation_queue_empty");
    recommendationDeckRef.current = mergedCards;
    setRealRecommendations(mergedCards);
    setRealDeckComplete(false);
    setStrategyCapitalReached(false);
    setPortfolioReview(null);
    applyServiceProposal(first.proposal, first.broker, result.strategy);
    setNoEligibleRecommendation(false);
    setBrokerConnectionStatus("connected");
    setUiPreview(false);
  }

  async function checkBrokerConnection() {
    if (uiPreviewRef.current) {
      setBrokerConnectionStatus("connected");
      return;
    }
    if (brokerCheckInFlight.current || orderWorkflowsInFlight.current > 0) return;
    brokerCheckInFlight.current = true;
    try {
      const response = await fetch(`${API_BASE_URL}/health`, {
        headers: { "x-app-token": APP_TOKEN },
      });
      const result = await response.json() as { ok: boolean; environment: "paper"; brokerConnection?: BrokerConnectionHealth };
      const health = result.brokerConnection ?? null;
      if (!response.ok || !result.ok || result.environment !== "paper" || !health) throw new Error("paper_snapshot_unavailable");
      brokerFailureCount.current = 0;
      setBrokerConnectionHealth(health);
      setBrokerConnectionStatus(health.state);
      if (health.state === "disconnected") setBroker(null);
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
    if (marketWindow.phase !== "open") {
      setAppToast({ tone: "info", title: marketWindow.phase === "weekend" ? "Markets are closed for the weekend" : "Market is currently closed", message: `Recommendation scanning resumes ${marketWindow.resumes.toLowerCase()}.` });
      return;
    }
    recommendationScanInFlight.current = true;
    setWorkflowError(null);
    setProcessing(true);
    try {
      await createPaperProposal();
    } catch {
      Alert.alert(
        "Paper recommendation unavailable",
        "Confirm IB Gateway is open in Paper Trading, API access is enabled, and the local trade service is running.",
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
    uiPreviewRef.current = uiPreview;
  }, [uiPreview]);

  useEffect(() => {
    activeProposalRef.current = proposal;
  }, [proposal]);

  useEffect(() => {
    Animated.timing(menuProgress, {
      toValue: menuOpen ? 1 : 0,
      duration: menuOpen ? 230 : 180,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    }).start();
  }, [menuOpen, menuProgress]);

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
    if (brokerConnectionStatus !== "connected" || !proposal.shadowMode || marketWindow.phase !== "open") {
      if (marketWindow.phase !== "open") setProcessing(false);
      return;
    }

    let active = true;
    const scan = async () => {
      if (!active || recommendationScanInFlight.current || orderWorkflowsInFlight.current > 0) return;
      recommendationScanInFlight.current = true;
      setProcessing(true);
      setBrokerUnavailable(false);
      try {
        await createPaperProposal();
      } catch (error) {
        if (!active) return;
        const code = error instanceof Error ? error.message : "proposal_unavailable";
        setNoEligibleRecommendation(code === "no_eligible_recommendation");
        setStrategyCapitalReached(code === "strategy_capital_limit");
        setBrokerUnavailable(code !== "no_eligible_recommendation" && code !== "strategy_capital_limit");
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
  }, [brokerConnectionStatus, proposal.shadowMode, marketWindow.phase]);

  const expired = proposal.decision === "pending" && Date.now() >= proposal.expiresAt;
  const state: Decision = expired ? "expired" : proposal.decision;
  const expiringSoon = state === "pending" && proposal.expiresAt - Date.now() <= 60_000;
  const brokerReady = broker !== null && brokerConnectionStatus === "connected";
  const actionable = state === "pending" && brokerReady && !proposal.shadowMode;
  const activeDecisionInFlight = decisionsInFlight[proposal.id] ?? null;
  const timer = countdown(proposal.expiresAt);

  useEffect(() => {
    if (expired) setProposal((current) => ({ ...current, decision: "expired" }));
  }, [expired]);

  async function refreshExpiredRecommendation() {
    if (expiredRefreshInFlight.current) return;
    if (uiPreview) {
      setProposal((current) => ({ ...current, decision: "pending", expiresAt: Date.now() + 3 * 60_000 }));
      setAppToast({ tone: "success", title: "Recommendation refreshed", message: `${proposal.symbol} now uses a current preview window.` });
      return;
    }
    if (proposal.shadowMode || brokerConnectionStatus !== "connected") {
      setAppToast({ tone: "danger", title: "Recommendation not refreshed", message: "Reconnect IBKR Paper before refreshing this recommendation." });
      return;
    }
    let active = true;
    expiredRefreshInFlight.current = true;
    setProcessing(true);
    setAppToast({ tone: "info", title: "Refreshing recommendation", message: `Updating ${proposal.symbol} with a current price and trade plan.` });
    try {
      await createPaperProposal(proposal.symbol);
    } catch (error) {
      if (!active) return;
      const code = error instanceof Error ? error.message : "recommendation_refresh_unavailable";
      setAppToast({ tone: "danger", title: "Recommendation not refreshed", message: code === "no_eligible_recommendation" ? `${proposal.symbol} no longer qualifies.` : "The current recommendation could not be refreshed yet." });
    } finally {
      expiredRefreshInFlight.current = false;
      if (active) setProcessing(false);
    }
  }

  useEffect(() => {
    if (!expired || uiPreview || proposal.shadowMode || brokerConnectionStatus !== "connected" || expiredRefreshInFlight.current) return;
    void refreshExpiredRecommendation();
  }, [expired, proposal.id, proposal.shadowMode, proposal.symbol, uiPreview, brokerConnectionStatus]);

  async function executeDecision(
    decision: "approved" | "denied",
    targetProposal: Proposal = proposal,
    background = false,
  ): Promise<{ succeeded: boolean; replacementCards: Proposal[] | null }> {
    orderWorkflowsInFlight.current += 1;
    setWorkflowError(null);
    if (!background) setAppToast(decision === "approved"
      ? { tone: "info", title: "Checking paper order", message: "Validating the account, price, and order with IBKR Paper." }
      : null);
    if (!background) {
      setProcessing(true);
      setDecisionsInFlight((current) => ({ ...current, [targetProposal.id]: decision }));
    }
    try {
      const response = await fetch(`${API_BASE_URL}/proposals/${targetProposal.id}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-app-token": APP_TOKEN },
        body: JSON.stringify({ decision }),
      });
      if (!response.ok) throw new Error("decision_rejected");
      const result = await response.json() as {
        approval?: { token: string };
        recommendations?: QueuedServiceRecommendation[];
        strategy?: StrategySummary;
        recalculated?: boolean;
      };
      if (decision === "denied") {
        const refreshedCards = result.strategy
          ? (result.recommendations ?? [])
            .filter((item) => item.broker?.ok)
            .map((item) => serviceProposalToCard(item.proposal, item.broker, result.strategy!))
          : [];
        if (result.strategy) setStrategy(result.strategy);
        setAppToast({
          tone: "info",
          title: "Recommendation denied",
          message: result.recalculated
            ? "No order was sent. Remaining recommendations were recalculated."
            : "No order was sent. The scanner will continue looking for current recommendations.",
        });
        return { succeeded: true, replacementCards: refreshedCards };
      }
      const token = result.approval?.token;
      if (!token) throw new Error("approval_missing");

      const previewResponse = await fetch(`${API_BASE_URL}/orders/preview`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-app-token": APP_TOKEN },
        body: JSON.stringify({ token }),
      });
      const previewResult = await previewResponse.json() as { preview?: OrderPreview & { checks?: { notExpired?: boolean; withinLimit?: boolean } } };
      if (!previewResponse.ok || !previewResult.preview) {
        if (previewResult.preview?.checks?.notExpired === false) throw new Error("invalid_or_expired_approval");
        if (previewResult.preview?.checks?.withinLimit === false) throw new Error("price_above_approved_limit");
        throw new Error("preview_blocked");
      }
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
        const withCommission = recommendationDeckRef.current.map((item) =>
          item.id === targetProposal.id ? { ...item, estimatedFees: commission } : item);
        recommendationDeckRef.current = withCommission;
        setRealRecommendations(withCommission);
      }

      if (!background) setAppToast({ tone: "info", title: "Submitting paper bracket", message: "Waiting for IBKR to acknowledge the buy and both automatic exit orders." });

      const submitResponse = await fetch(`${API_BASE_URL}/orders/submit-paper`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-app-token": APP_TOKEN },
        body: JSON.stringify({ token }),
      });
      const submitPayload = await submitResponse.json() as {
        error?: string;
        checks?: { priceWithinLimit?: boolean; strategyCapitalAllowed?: boolean };
        submission?: PaperSubmission & { error?: string; errors?: Array<{ code?: number; message?: string }> };
        recommendations?: QueuedServiceRecommendation[];
        strategy?: StrategySummary;
      };
      if (!submitResponse.ok || !submitPayload.submission?.ok) {
        if (submitPayload.error === "strategy_capital_changed" && submitPayload.strategy) {
          const refreshedCards = (submitPayload.recommendations ?? [])
            .filter((item) => item.broker?.ok)
            .map((item) => serviceProposalToCard(item.proposal, item.broker, submitPayload.strategy!));
          setStrategy(submitPayload.strategy);
          const mergedCards = mergeRecommendationDeck(recommendationDeckRef.current, refreshedCards);
          recommendationDeckRef.current = mergedCards;
          setRealRecommendations(mergedCards);
          if (mergedCards[0]) setProposal(mergedCards[0]);
          else {
            setRealDeckComplete(true);
            setProposal(SHADOW_LOADING);
          }
        }
        if (submitPayload.checks?.priceWithinLimit === false) throw new Error("price_above_approved_limit");
        const brokerError = submitPayload.submission?.errors?.[0];
        throw new Error(
          submitPayload.error
          ?? submitPayload.submission?.error
          ?? (brokerError?.message ? `IBKR${brokerError.code ? ` ${brokerError.code}` : ""}: ${brokerError.message}` : undefined)
          ?? "paper_submission_blocked"
        );
      }
      setPaperSubmission(submitPayload.submission);
      let refreshedCards: Proposal[] | null = null;
      if (submitPayload.strategy) {
        refreshedCards = (submitPayload.recommendations ?? [])
          .filter((item) => item.broker?.ok)
          .map((item) => serviceProposalToCard(item.proposal, item.broker, submitPayload.strategy!));
        setStrategy(submitPayload.strategy);
      }
      setSubmittedProposalIds((current) => current.includes(targetProposal.id)
        ? current : [...current, targetProposal.id]);
      const queuedForOpen = submitPayload.submission.result?.status === "PreSubmitted"
        && submitPayload.submission.warnings?.some((warning) => warning.code === 399);
      if (!background) setAppToast({
          tone: "info",
          title: queuedForOpen ? "Paper order queued" : "Paper order working",
          message: queuedForOpen
            ? `${targetProposal.quantity} ${targetProposal.symbol} · accepted by IBKR and scheduled for the next regular market open.`
            : `${targetProposal.quantity} ${targetProposal.symbol} · acknowledged by IBKR.`,
        });
      setStrategy((current) => current ? {
        ...current,
        currentExposure: Math.min(current.capitalLimit, current.currentExposure + targetProposal.positionValue),
        remainingCapital: Math.max(0, current.remainingCapital - targetProposal.positionValue),
        completedCount: current.completedCount + 1,
      } : current);
      return { succeeded: true, replacementCards: refreshedCards };
    } catch (error) {
      const code = error instanceof Error ? error.message : "paper_submission_blocked";
      const message = code === "invalid_or_expired_approval"
        ? "The approval expired before submission. Request a new recommendation."
        : code === "price_above_approved_limit"
          ? "The market price moved above the price you approved. Nothing was submitted; review a freshly priced recommendation."
        : code === "strategy_capital_changed"
          ? "Available strategy cash changed after another order. This recommendation has been resized; review it again before approving."
        : code === "final_safety_check_blocked"
          ? "The price, account, or order no longer matched the approved safety limits."
          : code === "ibkr_unavailable_approval_consumed"
            ? "IBKR became unavailable during submission. Check IB Gateway before requesting a new recommendation."
            : `The order was not sent. ${code.replaceAll("_", " ")}.`;
      setWorkflowError(message);
      setAppToast({ tone: "danger", title: "Paper order not submitted", message });
      if (background && code !== "strategy_capital_changed") {
        const retryable = { ...targetProposal, decision: "pending" as Decision };
        const retryDeck = [retryable, ...recommendationDeckRef.current.filter((item) => item.symbol !== retryable.symbol)];
        recommendationDeckRef.current = retryDeck;
        setRealRecommendations(retryDeck);
        setProposal(retryable);
        setRealDeckComplete(false);
      }
      return { succeeded: false, replacementCards: null };
    } finally {
      orderWorkflowsInFlight.current = Math.max(0, orderWorkflowsInFlight.current - 1);
      if (!background) {
        setProcessing(false);
        setDecisionsInFlight((current) => {
          const next = { ...current };
          delete next[targetProposal.id];
          return next;
        });
      }
    }
  }

  function removeResolvedLiveCard(
    targetProposal: Proposal,
    decision: "approved" | "denied",
    replacementCards: Proposal[] | null,
  ) {
    if (activeProposalRef.current.id === targetProposal.id) {
      dismissResolvedLiveCard(decision, replacementCards);
      return;
    }

    const refreshedDeck = replacementCards
      ? mergeRecommendationDeck(recommendationDeckRef.current, replacementCards)
      : recommendationDeckRef.current;
    const remaining = refreshedDeck.filter((item) => item.id !== targetProposal.id);
    recommendationDeckRef.current = remaining;
    setRealRecommendations(remaining);

    const visible = remaining.find((item) => item.id === activeProposalRef.current.id);
    if (visible) return;
    if (remaining[0]) setProposal(remaining[0]);
    else {
      setRealDeckComplete(true);
      setProposal(SHADOW_LOADING);
    }
  }

  function dismissResolvedLiveCard(decision: "approved" | "denied", replacementCards: Proposal[] | null = null) {
    if (cardAnimating.current) return;
    const remaining = replacementCards ?? recommendationDeckRef.current.filter((item) => item.id !== proposal.id);
    const next = remaining[0] ?? null;
    cardAnimating.current = true;
    setTransitionCard(next);
    Animated.timing(cardPosition, {
      toValue: { x: (decision === "approved" ? 1 : -1) * viewportWidth * 1.5, y: 0 },
      duration: 280,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: true,
    }).start(() => {
      cardEntryProgress.setValue(0);
      recommendationDeckRef.current = remaining;
      setRealRecommendations(remaining);
      if (next) setProposal(next);
      else {
        setRealDeckComplete(true);
        setProposal(SHADOW_LOADING);
      }
      requestAnimationFrame(() => {
        cardPosition.setValue({ x: 0, y: 0 });
        if (!next) {
          cardEntryProgress.setValue(1);
          setTransitionCard(null);
          cardAnimating.current = false;
          return;
        }
        Animated.timing(cardEntryProgress, {
          toValue: 1,
          duration: 160,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }).start(() => {
          setTransitionCard(null);
          cardAnimating.current = false;
        });
      });
    });
  }

  async function completeDecision(decision: "approved" | "denied", targetProposal: Proposal = proposal) {
    if (decision === "approved") {
      const result = await executeDecision("approved", targetProposal);
      if (result.succeeded) removeResolvedLiveCard(targetProposal, "approved", result.replacementCards);
      return;
    }
    const result = await executeDecision(decision, targetProposal);
    if (result.succeeded) removeResolvedLiveCard(targetProposal, decision, result.replacementCards);
  }

  useEffect(() => {
    if (submittedProposalIds.length === 0 || uiPreview) return;
    let active = true;
    let checking = false;
    const checkFill = async () => {
      if (!active || checking) return;
      checking = true;
      try {
        const headers = { "x-app-token": APP_TOKEN };
        await fetch(`${API_BASE_URL}/broker/reconcile`, { method: "POST", headers });
        const response = await fetch(`${API_BASE_URL}/activity`, { headers });
        if (!response.ok) return;
        const result = await response.json() as { items?: ActivityItem[] };
        const filled = (result.items ?? []).filter((item) =>
          submittedProposalIds.includes(item.id) && item.status.toLowerCase() === "filled");
        if (filled.length === 0) return;
        const filledIds = new Set(filled.map((item) => item.id));
        setSubmittedProposalIds((current) => current.filter((id) => !filledIds.has(id)));
        const entry = filled[0];
        if (!entry) return;
        setAppToast({ tone: "success", title: "Paper buy filled", message: `${entry.quantity ?? ""} ${entry.symbol} filled. The position is now tracked in the app.` });
      } catch {
        // Reconciliation will retry; a temporary connection failure must not dismiss the card.
      } finally {
        checking = false;
      }
    };
    void checkFill();
    const interval = setInterval(() => void checkFill(), 3_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [submittedProposalIds, uiPreview]);

  function decide(decision: "approved" | "denied") {
    const targetProposal = proposal;
    if (!actionable || decisionsInFlight[targetProposal.id]) return;
    if (decision === "denied") {
      void completeDecision("denied", targetProposal);
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
          onPress: () => void completeDecision("approved", targetProposal),
        },
      ],
    );
  }

  async function resetDemo() {
    try {
      await createShadowObservation();
    } catch {
      Alert.alert("Unable to scan", "Completed daily history is unavailable. Confirm IB Gateway Paper is open and historical data is permitted.");
    }
    setDetailsOpen(false);
    setRationaleOpen(false);
  }

  function previewActiveProposal(navigateToRecommendations = true) {
    uiPreviewRef.current = true;
    setUiPreview(true);
    if (navigateToRecommendations) setActivePage("review");
    setBrokerConnectionStatus("connected");
    setActivityItems(previewActivityItems);
    setPositionItems(previewPositionItems);
    setBroker(null);
    setBrokerUnavailable(false);
    setPreviewIndex(0);
    setReviewedExampleIds([]);
    setSampleDeckComplete(false);
    setRealDeckComplete(false);
    setTransitionCard(null);
    cardAnimating.current = false;
    cardPosition.setValue({ x: 0, y: 0 });
    cardEntryProgress.setValue(1);
    setProposal({ ...UI_PROPOSALS[0]!, expiresAt: Date.now() + 4 * 60 * 1000 });
  }

  function finishSampleDecision(decision: "approved" | "denied") {
    const occurredAt = Date.now();
    const activity: ActivityItem = {
      id: `preview-${proposal.id}-${occurredAt}`,
      symbol: proposal.symbol,
      company: proposal.company,
      side: proposal.side.toLowerCase(),
      status: decision === "approved" ? "Simulated fill" : "denied",
      occurredAt,
      quantity: proposal.quantity,
      limitPrice: proposal.limitPrice,
      stopPrice: proposal.stopPrice,
      targetPrice: proposal.targetPrice,
      targetTimeframe: proposal.targetTimeframe,
      researchContext: proposal.companyCatalyst,
      rationale: proposal.rationale,
      environment: "preview",
      brokerOrderId: null,
    };
    const nextActivity = [activity, ...previewActivityItems];
    setPreviewActivityItems(nextActivity);
    setActivityItems(nextActivity);
    if (decision === "approved") {
      const existing = previewPositionItems.find((item) => item.symbol === proposal.symbol);
      const nextPositions = existing
        ? previewPositionItems.map((item) => item.symbol === proposal.symbol ? {
            ...item,
            quantity: item.quantity + proposal.quantity,
            averageEntryPrice: ((item.averageEntryPrice * item.quantity) + (proposal.limitPrice * proposal.quantity)) / (item.quantity + proposal.quantity),
            currentPrice: proposal.currentPrice,
            protectiveStopPrice: proposal.stopPrice,
            profitTargetPrice: proposal.targetPrice,
            updatedAt: occurredAt,
            dataState: "preview" as const,
          } : item)
        : [{
            id: `preview-position-${proposal.symbol}`,
            symbol: proposal.symbol,
            quantity: proposal.quantity,
            averageEntryPrice: proposal.limitPrice,
            currentPrice: proposal.currentPrice,
            protectiveStopPrice: proposal.stopPrice,
            profitTargetPrice: proposal.targetPrice,
            updatedAt: occurredAt,
            dataState: "preview" as const,
          }, ...previewPositionItems];
      setPreviewPositionItems(nextPositions);
      setPositionItems(nextPositions);
    }
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
    const reviewed = [...reviewedExampleIds, proposal.id];
    const nextIndex = UI_PROPOSALS.findIndex((item) => !reviewed.includes(item.id));
    const next = nextIndex === -1 ? null : UI_PROPOSALS[nextIndex]!;
    const preparedNext = next ? {
      ...next,
      decision: next.decision === "expired" ? "expired" as const : "pending" as const,
      expiresAt: next.decision === "expired" ? Date.now() - 30 * 1000 : Date.now() + (nextIndex + 3) * 60 * 1000,
    } : null;
    cardAnimating.current = true;
    setTransitionCard(preparedNext);
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
        if (!preparedNext) {
          cardEntryProgress.setValue(1);
          setTransitionCard(null);
          cardAnimating.current = false;
          return;
        }
        Animated.timing(cardEntryProgress, {
          toValue: 1,
          duration: 160,
          easing: Easing.bezier(0.22, 1, 0.36, 1),
          useNativeDriver: true,
        }).start(() => {
          setTransitionCard(null);
          cardAnimating.current = false;
        });
      });
    });
  }

  function navigateSampleCard(step: -1 | 1, exitDirection: -1 | 1) {
    if (cardAnimating.current) return;
    const source = uiPreview ? UI_PROPOSALS : realRecommendations;
    const available = source
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !uiPreview || !reviewedExampleIds.includes(item.id));
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
    const preparedNext: Proposal = uiPreview ? {
        ...next.item,
        decision: next.item.decision === "expired" ? "expired" : "pending",
        expiresAt: next.item.decision === "expired" ? Date.now() - 30 * 1000 : Date.now() + (next.index + 3) * 60 * 1000,
      } : next.item;
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
        if (uiPreview) setPreviewIndex(next.index);
        setProposal(preparedNext);
        requestAnimationFrame(() => {
          cardPosition.setValue({ x: 0, y: 0 });
          Animated.timing(cardEntryProgress, {
            toValue: 1,
            duration: 160,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }).start(() => {
            setTransitionCard(null);
            cardAnimating.current = false;
          });
        });
      });
    });
  }

  const cardPanResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) =>
      (uiPreview || realRecommendations.length > 1) && Math.abs(gesture.dx) > 7 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.1,
    onMoveShouldSetPanResponderCapture: (_, gesture) =>
      (uiPreview || realRecommendations.length > 1) && Math.abs(gesture.dx) > 7 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.1,
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
  const availableDeckCards = uiPreview
    ? UI_PROPOSALS.filter((item) => !reviewedExampleIds.includes(item.id))
    : realRecommendations;
  const activePreviewPosition = availableDeckCards.findIndex((item) => item.id === proposal.id);
  const nextPreviewCard = activePreviewPosition >= 0 && availableDeckCards.length > 1
    ? availableDeckCards[(activePreviewPosition + 1) % availableDeckCards.length]
    : null;
  const previousPreviewCard = activePreviewPosition >= 0 && availableDeckCards.length > 1
    ? availableDeckCards[(activePreviewPosition - 1 + availableDeckCards.length) % availableDeckCards.length]
    : null;
  const backPreviewCard = activePreviewPosition >= 0 && availableDeckCards.length > 2
    ? availableDeckCards[(activePreviewPosition + 2) % availableDeckCards.length]
    : null;
  function returnToScanner() {
    setUiPreview(false);
    setWorkflowError(null);
    setOrderPreview(null);
    setWhatIfResult(null);
    setPaperSubmission(null);
    setProcessing(false);
    setDecisionsInFlight({});
    recommendationDeckRef.current = [];
    setRealRecommendations([]);
    setRealDeckComplete(false);
    setProposal(SHADOW_LOADING);
  }

  function exitPreviewMode(navigateToRecommendations = true) {
    uiPreviewRef.current = false;
    setUiPreview(false);
    setActivityItems([]);
    setPositionItems([]);
    setTradeItems([]);
    if (navigateToRecommendations) setActivePage("review");
    returnToScanner();
  }

  function setPreviewMode(enabled: boolean) {
    void AsyncStorage.setItem(PREVIEW_MODE_STORAGE_KEY, String(enabled));
    if (enabled) {
      previewActiveProposal(false);
      setAppToast({ tone: "success", title: "Preview mode on", message: "Sample data is now active throughout the app." });
    } else {
      exitPreviewMode(false);
      if (activePage === "recommendationHistory" || activePage === "activity" || activePage === "positions") void loadHistory();
      setAppToast({ tone: "info", title: "Preview mode off", message: "The app is using your paper workspace again." });
    }
  }

  const menuActions: Array<{ label: string; onPress: () => void; emphasized?: boolean }> = [
    ...(activePage !== "review" ? [{ label: "Recommendations", onPress: () => setActivePage("review") }] : []),
    ...(activePage !== "activity" ? [{ label: "Activity", onPress: () => openHistory("activity") }] : []),
    ...(activePage !== "positions" ? [{ label: "Positions", onPress: () => openHistory("positions") }] : []),
    ...(activePage !== "performance" ? [{ label: "Performance", onPress: openPerformance }] : []),
    ...(activePage !== "research" ? [{ label: "Strategy research", onPress: openResearch }] : []),
    ...(activePage !== "settings" ? [{ label: "Settings", onPress: () => setActivePage("settings") }] : []),
  ];
  const headerStatusLabel = uiPreview
    ? "Preview mode"
    : brokerConnectionStatus === "disconnected"
      ? "Paper offline"
      : brokerConnectionStatus === "checking"
        ? "Checking paper"
        : proposal.shadowMode && marketWindow.phase === "weekend"
            ? "Paper · weekend"
            : proposal.shadowMode && marketWindow.phase !== "open"
              ? "Paper · market closed"
              : proposal.shadowMode && processing
                ? "Paper · scanning"
                : proposal.shadowMode && noEligibleRecommendation
                  ? "Paper · no setups"
                  : proposal.shadowMode
                    ? "Paper · monitoring"
                    : "Paper link online";
  const headerStatusColor = uiPreview
    ? colors.accent
    : brokerConnectionStatus === "disconnected"
      ? "#D64545"
      : brokerConnectionStatus === "checking" || (proposal.shadowMode && processing)
        ? "#D99000"
        : proposal.shadowMode && marketWindow.phase !== "open"
          ? colors.muted
          : "#22A447";

  return (
    <VisualThemeContext.Provider value={{ colors, styles }}>
    <ThemeProvider theme={activeTheme}>
    <SafeAreaProvider>
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <StatusBar barStyle={darkMode ? "light-content" : "dark-content"} />
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <View style={styles.appHeader}>
          <Pressable accessibilityRole="button" accessibilityLabel="Open menu" accessibilityState={{ expanded: menuOpen }} onPress={() => setMenuOpen((value) => !value)} style={styles.menuButton}>
            <ListIcon size={23} color={colors.ink} weight="regular" />
          </Pressable>
          <View style={styles.headerActions}>
            {activePage === "review" ? <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open recommendation history"
              hitSlop={6}
              onPress={() => openHistory("recommendationHistory")}
              style={({ pressed }) => [styles.themeToggle, pressed && styles.themeTogglePressed]}
            >
              <ClockCounterClockwiseIcon size={18} color={colors.ink} weight="regular" />
            </Pressable> : null}
            <View style={styles.marketPill}>
              <CircleIcon
                size={8}
                weight="fill"
                color={headerStatusColor}
              />
              <Text style={styles.marketText}>{headerStatusLabel}</Text>
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
            <Toast {...appToast} compact loading={appToast.tone === "info" && processing} onDismiss={dismissToast} duration={appToast.tone === "info" && processing ? 0 : 5500} />
          </View>
        )}
        {!uiPreview && brokerConnectionStatus === "disconnected" ? (
          <View accessibilityRole="alert" style={styles.connectionBanner}>
            <View style={styles.connectionBannerCopy}>
              <Text style={styles.connectionBannerTitle}>IBKR Paper is offline</Text>
              <Text style={styles.connectionBannerBody}>New orders are blocked. Existing stop and target orders remain at IBKR.</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Retry broker connection" onPress={() => void checkBrokerConnection()} style={styles.connectionBannerAction}>
              <Text style={styles.connectionBannerActionText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {activePage === "settings" ? (
          <SettingsPage
            policy={riskPolicy}
            operatingPercent={adaptiveOperatingPercent}
            operatingReason={adaptiveOperatingReason}
            saving={policySaving}
            connectionAlertsEnabled={connectionAlertsEnabled}
            onConnectionAlertsChange={(enabled) => void changeConnectionAlerts(enabled)}
            onChange={setRiskPolicy}
            onSave={() => void savePaperRiskPolicy()}
          />
        ) : activePage === "performance" ? (
          <PerformancePage report={performanceReport} loading={performanceLoading} error={performanceError} onRefresh={() => void loadPerformance()} previewMode={uiPreview} />
        ) : activePage === "research" ? (
          <ResearchPage report={strategyComparison} loading={researchLoading} error={researchError} onRefresh={() => void loadResearch()} />
        ) : activePage === "recommendationHistory" || activePage === "activity" || activePage === "positions" ? (
          <HistoryPage page={activePage} activity={activityItems} positions={positionItems} trades={tradeItems} loading={historyLoading} error={historyError} onRefresh={() => void loadHistory()} previewMode={uiPreview} />
        ) : (
        <>

        {proposal.shadowMode && showRecommendationSkeleton && !realDeckComplete && (
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

        {proposal.shadowMode && !showRecommendationSkeleton && !realDeckComplete && (
          <View style={styles.homeDashboard}>
            <Text style={styles.homeEyebrow}>{marketWindow.phase === "open" ? "SCANNER ACTIVE" : "SCANNER STANDBY"}</Text>
            <Text style={styles.homeTitle}>
              {brokerConnectionStatus === "disconnected"
                ? "Paper is offline"
                : marketWindow.phase === "weekend"
                  ? "Markets are closed for the weekend"
                  : marketWindow.phase !== "open"
                    ? "Market is currently closed"
                    : strategyCapitalReached
                      ? strategy?.budget?.status === "ownership_incomplete" ? "Position ownership needs review"
                        : strategy?.budget?.status === "protection_incomplete" ? "Position protection needs review"
                          : strategy?.budget?.status === "policy_exceeded" ? "Portfolio policy exceeded"
                            : "Allocation fully deployed"
                    : noEligibleRecommendation
                      ? "No recommendations right now"
                      : "Scanning the market"}
            </Text>
            <Text style={styles.homeSummary}>
              {brokerConnectionStatus === "connected" && marketWindow.phase !== "open"
                ? `No new recommendations will be created while the market is closed. Scanning resumes ${marketWindow.resumes}.`
                : strategyCapitalReached
                ? strategy?.budget?.status === "ownership_incomplete"
                  ? "Some broker shares cannot be attributed to this strategy. New buys and automatic sells are blocked until the records are reconciled."
                  : strategy?.budget?.status === "protection_incomplete"
                    ? "A strategy position has no verified broker stop. New buys and automatic sells are blocked until protection is reviewed."
                    : strategy?.budget?.status === "policy_exceeded"
                      ? `New buys are paused. ${strategy.budget.openPositionCount ?? 0} positions are open against a limit of ${strategy.budget.maxOpenPositions ?? strategy.maxOpenPositions}, with ${money(strategy.budget.deployed ?? strategy.currentExposure)} deployed against ${money(strategy.budget.capitalLimit ?? strategy.capitalLimit)}.`
                      : "The strategy has used its current allocation. Scanning continues and compares new candidates with current holdings for possible profitable rotations."
                : brokerUnavailable
                ? "The scanner could not load a recommendation. You can try again when the connection is ready."
                : noEligibleRecommendation
                  ? "Paper is connected and the scanner is still monitoring. Nothing currently passes every momentum, liquidity, and risk rule."
                : brokerConnectionStatus === "disconnected"
                  ? "Open IB Gateway Paper and the local service. Recommendations will appear automatically after they reconnect."
                  : "Paper is connected. The scanner is reviewing the market now; a card appears only when a setup passes every rule."}
            </Text>

            <View style={styles.homeScannerPanel}>
              <View style={styles.homeScannerRow}>
                <Text style={styles.homeScannerLabel}>Scan</Text>
                <Text style={styles.homeScannerValue}>{marketWindow.phase === "open" ? "Continuous · fresh quote checks" : `Resumes ${marketWindow.resumes}`}</Text>
              </View>
              <View style={styles.homeScannerRow}>
                <Text style={styles.homeScannerLabel}>Recommendations</Text>
                <Text style={styles.homeScannerValue}>{strategyCapitalReached ? strategy?.budget?.status === "reconciled" ? "Continuously ranked against holdings" : "Paused for safety review" : "All currently qualified buys"}</Text>
              </View>
              <View style={styles.homeScannerRow}>
                <Text style={styles.homeScannerLabel}>Protection</Text>
                <Text style={styles.homeScannerValue}>Check broker stops in Positions</Text>
              </View>
            </View>

            {strategyCapitalReached && portfolioReview && (
              <View style={styles.rotationPanel}>
                <Text style={styles.rotationTitle}>Portfolio review</Text>
                <Text style={styles.rotationSummary}>
                  {strategy?.budget?.status === "ownership_incomplete"
                    ? `Resolve ownership for ${strategy.budget.ownershipConflicts?.join(", ") || "unmatched holdings"} before considering an exit or new buy.`
                    : strategy?.budget?.status === "protection_incomplete"
                      ? `Review broker protection for ${strategy.budget.protectionGaps?.join(", ") || "held positions"} before considering another trade.`
                      : portfolioReview.reductionRequired > 0
                        ? `Reduce at least ${money(portfolioReview.reductionRequired)} and ${portfolioReview.positionReductionRequired > 0 ? `${portfolioReview.positionReductionRequired} positions` : "remain within the position limit"} before considering another buy.`
                        : portfolioReview.positionReductionRequired > 0
                          ? `Reduce at least ${portfolioReview.positionReductionRequired} positions before considering another buy.`
                        : "New candidates are continuously compared with current holdings. Ordinary rotations are considered only when a stronger candidate exists and the proposed sale is estimated at break-even or better."}
                </Text>
                {portfolioReview.exitReviews.length > 0 && (
                  <>
                    <Text style={styles.rotationSubhead}>Exit reviews</Text>
                    {portfolioReview.exitReviews.map((review) => (
                      <View key={review.id} style={styles.exitReviewCard}>
                        <View style={styles.exitReviewHeader}>
                          <View style={styles.exitReviewIdentity}>
                            <CompanyMark symbol={review.symbol} size={36} />
                            <View>
                              <Text style={styles.exitReviewTitle}>Review selling {review.quantity} {review.symbol}</Text>
                              <Text style={styles.exitReviewValue}>{money(review.estimatedValue)} position · {review.estimatedGrossPnl >= 0 ? "+" : ""}{money(review.estimatedGrossPnl)} estimated</Text>
                            </View>
                          </View>
                          <View style={[styles.rotationChip, review.urgency === "high" ? styles.rotationExitChip : styles.exitReviewChip]}>
                            <Text style={[styles.rotationChipText, review.urgency === "high" ? styles.rotationExitText : styles.exitReviewChipText]}>Review only</Text>
                          </View>
                        </View>
                        {review.triggers.map((trigger) => (
                          <Text key={trigger.id} style={styles.exitReviewReason}>• {trigger.label}</Text>
                        ))}
                        <Text style={styles.exitReviewSafety}>No sell order can be submitted from this review.</Text>
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => openHistory("positions")}
                          style={({ pressed }) => [styles.exitReviewAction, pressed && styles.homeActionPressed]}
                        >
                          <Text style={styles.exitReviewActionText}>Open position</Text>
                        </Pressable>
                      </View>
                    ))}
                  </>
                )}
                {portfolioReview.holdings.map((holding) => (
                  <View key={holding.symbol} style={styles.rotationRow}>
                    <View style={styles.rotationRowCopy}>
                      <Text style={styles.rotationSymbol}>{holding.symbol} · {holding.quantity} shares</Text>
                      <Text style={styles.rotationReason}>{holding.reasons.join(" · ")}</Text>
                    </View>
                    <View style={[styles.rotationChip, holding.recommendedForExit ? styles.rotationExitChip : styles.rotationHoldChip]}>
                      <Text style={[styles.rotationChipText, holding.recommendedForExit ? styles.rotationExitText : styles.rotationHoldText]}>
                        {holding.recommendedForExit ? "Exit review" : holding.status === "HOLD" ? "Hold" : "Review"}
                      </Text>
                    </View>
                  </View>
                ))}
                {portfolioReview.replacements.length > 0 && (
                  <>
                    <Text style={styles.rotationSubhead}>Possible replacements after a confirmed sale</Text>
                    <Text style={styles.rotationCandidates}>
                      {portfolioReview.replacements.slice(0, 5).map((item) => item.symbol).join(" · ")}
                    </Text>
                    <Text style={styles.rotationReason}>Replacement prices and sizes will be regenerated after the sale fills.</Text>
                  </>
                )}
              </View>
            )}

            {strategyCapitalReached ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => openHistory("positions")}
                style={({ pressed }) => [styles.homeAction, pressed && styles.homeActionPressed]}
              >
                <Text style={styles.homeActionText}>Review current positions</Text>
              </Pressable>
            ) : brokerUnavailable && brokerConnectionStatus === "connected" ? (
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

        {uiPreview && !proposal.shadowMode && sampleDeckComplete && (
          <View style={styles.deckComplete}>
            <View style={styles.deckCompleteIcon}>
              <CheckCircleIcon size={34} color={colors.actionApprove} weight="fill" />
            </View>
            <Text style={styles.deckCompleteEyebrow}>0 recommendations remaining</Text>
            <Text style={styles.deckCompleteTitle}>You’re all caught up</Text>
            <Text style={styles.deckCompleteBody}>{`You reviewed all ${UI_PROPOSALS.length} sample trades.`}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Review sample trades again"
              onPress={() => previewActiveProposal()}
              style={({ pressed }) => [styles.previewProposalButton, pressed && styles.homeActionPressed]}
            >
              <Text style={styles.previewProposalButtonText}>Review sample trades again</Text>
            </Pressable>
          </View>
        )}

        {!uiPreview && realDeckComplete && (
          <View style={styles.deckComplete}>
            <View style={styles.deckCompleteIcon}>
              <CheckCircleIcon size={34} color={colors.actionApprove} weight="fill" />
            </View>
            <Text style={styles.deckCompleteEyebrow}>0 recommendations remaining</Text>
            <Text style={styles.deckCompleteTitle}>You’re all caught up</Text>
            <Text style={styles.deckCompleteBody}>
              Every current recommendation has been completed. The scanner is still monitoring the market and will add a new card when another setup qualifies.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="View recommendation activity"
              onPress={() => openHistory("activity")}
              style={({ pressed }) => [styles.previewProposalButton, pressed && styles.homeActionPressed]}
            >
              <Text style={styles.previewProposalButtonText}>View activity</Text>
            </Pressable>
          </View>
        )}

        {!proposal.shadowMode && !sampleDeckComplete && !realDeckComplete && (
          <View style={[styles.deckStage, { height: Math.max(420, viewportHeight - 150) }]}>
            {!transitionCard && backPreviewCard && (
              <Animated.View pointerEvents="none" style={[styles.proposalCard, styles.stackCardLayer, styles.stackCardBack]}>
                <PreviewCardFace proposal={backPreviewCard} />
              </Animated.View>
            )}
            {!transitionCard && nextPreviewCard && (
              <Animated.View pointerEvents="none" style={[styles.proposalCard, styles.stackCardLayer, styles.stackCardNext, { opacity: nextCardOpacity }]}>
                <PreviewCardFace proposal={nextPreviewCard} />
              </Animated.View>
            )}
            {!transitionCard && previousPreviewCard && previousPreviewCard.id !== nextPreviewCard?.id && (
              <Animated.View pointerEvents="none" style={[styles.proposalCard, styles.stackCardLayer, styles.stackCardNext, { opacity: previousCardOpacity }]}>
                <PreviewCardFace proposal={previousPreviewCard} />
              </Animated.View>
            )}
            {transitionCard && (
              <Animated.View pointerEvents="none" style={[styles.proposalCard, styles.stackCardLayer, styles.stackCardTransition]}>
                <PreviewCardFace proposal={transitionCard} />
              </Animated.View>
            )}
            <Animated.View
            {...((uiPreview || realRecommendations.length > 1) ? cardPanResponder.panHandlers : {})}
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
              onLayout={(event) => {
                setCardWidth(event.nativeEvent.layout.width);
                setCardBodyHeight(event.nativeEvent.layout.height);
              }}
              onPress={(event) => {
                if ((!uiPreview && realRecommendations.length < 2) || cardWidth === 0 || Date.now() < suppressCardTapUntil.current) return;
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
                <Text style={styles.infoCardBody} numberOfLines={2} ellipsizeMode="tail">{proposal.companyCatalyst}</Text>
              </View>
            </Pressable>
            <View style={styles.cardFooter}>
              {state === "pending" ? <View style={styles.actions}>
                <ActionButton
                  label={activeDecisionInFlight === "denied" ? "Denying…" : "Deny"}
                  tone="secondary"
                  pending={activeDecisionInFlight === "denied"}
                  disabled={!uiPreview && (!actionable || activeDecisionInFlight !== null)}
                  onPress={() => uiPreview ? animateSampleDecision("denied") : decide("denied")}
                />
                <ActionButton
                  label={activeDecisionInFlight === "approved" ? "Submitting…" : "Approve"}
                  tone="primary"
                  pending={activeDecisionInFlight === "approved"}
                  disabled={!uiPreview && (!actionable || activeDecisionInFlight !== null)}
                  onPress={() => uiPreview ? animateSampleDecision("approved") : decide("approved")}
                />
              </View> : state === "expired" ? (
                <View style={styles.actions}>
                  <ActionButton
                    label={processing ? "Refreshing…" : "Refresh recommendation"}
                    tone="secondary"
                    pending={processing}
                    disabled={processing || (!uiPreview && brokerConnectionStatus !== "connected")}
                    onPress={() => void refreshExpiredRecommendation()}
                  />
                </View>
              ) : (
                submittedProposalIds.includes(proposal.id) ? <View style={styles.actions}>
                  <ActionButton label="Order working…" tone="secondary" pending disabled onPress={() => undefined} />
                </View> : uiPreview ? <View style={styles.actions}>
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

        </>
        )}

      </ScrollView>

      <View pointerEvents={menuOpen ? "auto" : "none"} style={styles.navigationDrawerLayer}>
        <Animated.View style={[styles.navigationDrawerBackdrop, { opacity: menuProgress }]}>
          <Pressable accessibilityLabel="Close navigation" onPress={() => setMenuOpen(false)} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View
          accessibilityRole="menu"
          style={[styles.navigationDrawer, { transform: [{ translateX: menuProgress.interpolate({ inputRange: [0, 1], outputRange: [-330, 0] }) }] }]}
        >
          <SafeAreaView style={styles.navigationDrawerSafe} edges={["top", "bottom", "left"]}>
            <View style={styles.navigationDrawerHeader}>
              <View>
                <Text style={styles.navigationDrawerTitle}>Trade Approval</Text>
                <Text style={styles.contextMenuStatusText}>{uiPreview ? "Preview workspace" : "Paper workspace"}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close navigation" onPress={() => setMenuOpen(false)} style={styles.drawerCloseButton}>
                <XIcon size={19} color={colors.ink} weight="regular" />
              </Pressable>
            </View>
            <View style={styles.contextMenuStatus}>
              <Text style={styles.contextMenuEyebrow}>{uiPreview ? "PREVIEW MODE" : "SCANNER RUNNING"}</Text>
              <Text style={styles.contextMenuStatusText}>{uiPreview ? "Realistic sample data · broker actions disabled" : `IBKR Paper · ${brokerConnectionStatus}`}</Text>
            </View>
            <View style={styles.navigationDrawerItems}>
            {menuActions.map((action) => (
              <Pressable
                key={action.label}
                accessibilityRole="menuitem"
                onPress={() => { setMenuOpen(false); action.onPress(); }}
                style={({ pressed }) => [styles.contextMenuItem, pressed && styles.contextMenuItemPressed]}
              >
                <Text style={[styles.contextMenuItemText, action.emphasized && styles.contextMenuItemEmphasized]}>{action.label}</Text>
              </Pressable>
            ))}
            <View style={styles.contextMenuToggle}>
              <View style={styles.contextMenuToggleCopy}>
                <Text style={styles.contextMenuItemText}>Preview mode</Text>
                <Text style={styles.contextMenuToggleHelp}>Use realistic sample data</Text>
              </View>
              <Switch
                accessibilityLabel="Preview mode"
                accessibilityHint="Replaces brokerage information throughout the app with simulated sample data"
                value={uiPreview}
                onValueChange={setPreviewMode}
                trackColor={{ false: colors.border, true: colors.actionApprove }}
                thumbColor="#FFFFFF"
              />
            </View>
            </View>
          </SafeAreaView>
        </Animated.View>
      </View>

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
  navigationDrawerLayer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 100, flexDirection: "row" },
  navigationDrawerBackdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.34)" },
  navigationDrawer: { width: "84%", maxWidth: 330, height: "100%", backgroundColor: colors.surface, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 22, shadowOffset: { width: 8, height: 0 }, elevation: 12 },
  navigationDrawerSafe: { flex: 1 },
  navigationDrawerHeader: { minHeight: 76, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, paddingHorizontal: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  navigationDrawerTitle: { color: colors.ink, ...typeRamp.heading, fontWeight: "700" },
  navigationDrawerItems: { paddingVertical: 8 },
  drawerCloseButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 18, backgroundColor: colors.surfaceMuted },
  contextMenuStatus: { paddingHorizontal: 15, paddingTop: 13, paddingBottom: 11, backgroundColor: colors.surfaceMuted, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  contextMenuEyebrow: { color: colors.muted, fontSize: 10, lineHeight: 14, fontWeight: "700", letterSpacing: 0.8 },
  contextMenuStatusText: { color: colors.text, ...typeRamp.caption, marginTop: 2, textTransform: "capitalize" },
  contextMenuItem: { minHeight: 46, justifyContent: "center", paddingHorizontal: 15, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  contextMenuItemPressed: { backgroundColor: colors.surfaceMuted },
  contextMenuItemText: { color: colors.text, ...typeRamp.body },
  contextMenuItemEmphasized: { color: colors.accentDark, fontWeight: "600" },
  contextMenuToggle: { minHeight: 64, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, paddingHorizontal: 15, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  contextMenuToggleCopy: { flex: 1 },
  contextMenuToggleHelp: { color: colors.muted, ...typeRamp.caption, marginTop: 2 },
  toastLayer: { position: "absolute", top: 62, left: spacing.small, right: spacing.small, zIndex: 20 },
  connectionBanner: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: colors.dangerSoft, borderRadius: radius.medium, padding: 14, marginTop: 14 },
  connectionBannerCopy: { flex: 1 },
  connectionBannerTitle: { color: colors.danger, ...typeRamp.label, fontWeight: "600" },
  connectionBannerBody: { color: colors.text, ...typeRamp.caption, marginTop: 2 },
  connectionBannerAction: { minWidth: 64, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.danger },
  connectionBannerActionText: { color: colors.danger, ...typeRamp.label, fontWeight: "500" },
  settingsPage: { paddingTop: 30, paddingBottom: 44 },
  settingsEyebrow: { color: colors.muted, ...typeRamp.caption, fontWeight: "400", letterSpacing: 1.1 },
  settingsTitle: { color: colors.ink, ...typeRamp.display, marginTop: 2 },
  settingsIntro: { color: colors.muted, ...typeRamp.body, marginTop: 8, marginBottom: 26, maxWidth: 540 },
  policySection: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 20, paddingBottom: 18 },
  policySectionTitle: { color: colors.ink, ...typeRamp.heading, fontWeight: "600" },
  policyHelp: { color: colors.muted, ...typeRamp.caption, marginTop: 3 },
  adaptiveRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 20 },
  adaptiveCopy: { flex: 1 },
  operatingCard: { backgroundColor: colors.surfaceMuted, borderRadius: radius.large, padding: 18, marginTop: 18 },
  operatingLabel: { color: colors.muted, ...typeRamp.caption },
  operatingValue: { color: colors.ink, fontSize: 30, lineHeight: 36, fontWeight: "800", marginTop: 3 },
  operatingReason: { color: colors.text, ...typeRamp.body, marginTop: 5 },
  operatingFootnote: { color: colors.muted, ...typeRamp.caption, marginTop: 10 },
  policyField: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  policyFieldLabel: { flex: 1, color: colors.muted, ...typeRamp.body },
  policyInputWrap: { minWidth: 112, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 5 },
  policyInput: { minWidth: 78, minHeight: 44, color: colors.ink, fontSize: 16, lineHeight: 22, fontWeight: "400", textAlign: "right", paddingHorizontal: 8, borderWidth: 1, borderColor: colors.border, borderRadius: radius.small, backgroundColor: colors.surface },
  policySuffix: { minWidth: 16, color: colors.muted, ...typeRamp.body },
  policySave: { minHeight: 56, alignItems: "center", justifyContent: "center", backgroundColor: colors.actionApprove, borderRadius: radius.pill, marginTop: 12, paddingHorizontal: 20 },
  policySaveText: { color: colors.actionApproveText, fontSize: 16, lineHeight: 22, fontWeight: "400" },
  historyPage: { flex: 1, paddingTop: 10, paddingBottom: 30 },
  activitySearch: { height: 50, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surfaceMuted, borderRadius: radius.pill, paddingLeft: 16, paddingRight: 4, marginTop: 18 },
  activitySearchInput: { flex: 1, height: 50, color: colors.ink, ...typeRamp.body, paddingTop: 0, paddingBottom: 0, textAlignVertical: "center" },
  activityFilterIcon: { width: 42, height: 42, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  filterSheetLayer: { flex: 1, justifyContent: "flex-end" },
  filterSheetBackdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(12, 18, 28, 0.38)" },
  filterSheet: { maxHeight: "64%", minHeight: "52%", backgroundColor: colors.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 20, paddingTop: 8 },
  filterSheetHandle: { width: 38, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: "center", marginBottom: 12 },
  filterSheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 42 },
  filterSheetTitle: { color: colors.ink, ...typeRamp.heading, fontWeight: "600" },
  filterSheetClear: { color: colors.accent, ...typeRamp.body, fontWeight: "500" },
  filterSheetContent: { paddingBottom: 14 },
  filterSheetSection: { paddingTop: 13 },
  filterSheetSectionTitle: { color: colors.muted, ...typeRamp.caption, marginBottom: 9 },
  filterSheetChoices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filterSheetChoice: { minHeight: 38, justifyContent: "center", paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  filterSheetChoiceSelected: { borderColor: colors.ink, backgroundColor: colors.ink },
  filterSheetChoiceText: { color: colors.text, ...typeRamp.caption, fontWeight: "500" },
  filterSheetChoiceTextSelected: { color: colors.surface },
  filterSheetApply: { minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.ink, marginTop: 6, marginBottom: 8 },
  filterSheetApplyText: { color: colors.surface, fontSize: 16, lineHeight: 22, fontWeight: "600" },
  activitySection: { marginTop: 22, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  activitySectionTitle: { color: colors.ink, ...typeRamp.heading, fontWeight: "600", marginBottom: 7 },
  activityRow: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 12 },
  activityRowPressed: { opacity: 0.62 },
  activityDetailSheet: { maxHeight: "72%", minHeight: "44%", backgroundColor: colors.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 20, paddingTop: 8 },
  activityDetailTitleRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  activityDetailContent: { paddingTop: 10, paddingBottom: 24 },
  activityDetailRow: { minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  activityDetailValue: { flex: 1, color: colors.ink, ...typeRamp.body, textAlign: "right" },
  historyMessage: { color: colors.muted, ...typeRamp.body, marginTop: 8 },
  historyEmpty: { backgroundColor: colors.surfaceMuted, borderRadius: radius.medium, padding: 20, marginTop: 24 },
  historyEmptyTitle: { color: colors.ink, ...typeRamp.heading, fontWeight: "600" },
  performancePage: { flex: 1, paddingTop: 10, paddingBottom: 40 },
  performanceHero: { paddingVertical: 18, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  performanceEyebrow: { color: colors.muted, ...typeRamp.caption, letterSpacing: 1.1 },
  performanceHeroValue: { fontSize: 40, lineHeight: 48, fontWeight: "800", letterSpacing: -1.1, marginTop: 3 },
  performanceAsOf: { color: colors.muted, ...typeRamp.caption, marginTop: 2 },
  performanceSummaryGrid: { flexDirection: "row", flexWrap: "wrap", borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  performanceSummaryItem: { width: "50%", minHeight: 88, justifyContent: "center", paddingVertical: 14, paddingRight: 12 },
  performanceLabel: { color: colors.muted, ...typeRamp.caption },
  performanceValue: { color: colors.ink, ...typeRamp.heading, fontWeight: "500", marginTop: 3 },
  performancePositive: { color: colors.success },
  performanceNegative: { color: colors.danger },
  performanceNeutral: { color: colors.ink },
  performanceComparison: { paddingVertical: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  performanceSectionTitle: { color: colors.ink, ...typeRamp.heading, fontWeight: "600", marginTop: 26, marginBottom: 5 },
  performanceRows: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  performanceRow: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  performanceRowCopy: { flex: 1 },
  performanceSymbol: { color: colors.ink, ...typeRamp.label, fontWeight: "600" },
  performanceRowValue: { alignItems: "flex-end" },
  performanceFootnote: { color: colors.muted, ...typeRamp.caption, marginTop: 2 },
  performanceStats: { gap: 18, paddingVertical: 24, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  performanceNotice: { backgroundColor: colors.surfaceMuted, borderRadius: radius.medium, padding: 16, gap: 6, marginTop: 20 },
  performanceNoticeTitle: { color: colors.ink, ...typeRamp.label, fontWeight: "600" },
  performanceRefresh: { minHeight: 48, alignItems: "center", justifyContent: "center", backgroundColor: colors.ink, borderRadius: radius.pill, marginTop: 16 },
  performanceRefreshText: { color: colors.surface, ...typeRamp.label, fontWeight: "500" },
  researchBoundary: { backgroundColor: colors.warningSoft, borderRadius: radius.medium, padding: 16, marginBottom: 20 },
  researchBoundaryTitle: { color: colors.warning, ...typeRamp.label, fontWeight: "600", marginBottom: 3 },
  researchOverview: { flexDirection: "row", justifyContent: "space-between", gap: 20, paddingVertical: 20, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  researchUniverse: { color: colors.ink, ...typeRamp.heading, fontWeight: "600", marginTop: 3 },
  researchHorizon: { paddingVertical: 18, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  researchHorizonTitle: { color: colors.ink, ...typeRamp.heading, fontWeight: "600", marginBottom: 7 },
  researchMetricRow: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  historyRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, minHeight: 72, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  historyRowMain: { flex: 1 },
  historyRowEnd: { maxWidth: "45%", alignItems: "flex-end" },
  historySymbol: { color: colors.ink, ...typeRamp.heading, fontWeight: "600" },
  historyMeta: { color: colors.muted, ...typeRamp.caption, marginTop: 3 },
  historyStatus: { color: colors.ink, ...typeRamp.body, fontWeight: "500", textTransform: "capitalize", textAlign: "right" },
  historyTime: { color: colors.muted, ...typeRamp.caption, marginTop: 3 },
  positionCard: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.medium, paddingHorizontal: 16, marginTop: 18, overflow: "hidden" },
  positionTerms: { paddingVertical: 8 },
  positionNotice: { color: colors.warning, ...typeRamp.caption, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingVertical: 12 },
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
  rotationPanel: { borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, marginTop: 18, padding: 18, gap: 12 },
  rotationTitle: { color: colors.ink, fontSize: 20, lineHeight: 26, fontWeight: "700" },
  rotationSummary: { color: colors.muted, fontSize: 15, lineHeight: 21, fontWeight: "400" },
  rotationRow: { flexDirection: "row", alignItems: "center", gap: 12, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
  rotationRowCopy: { flex: 1, gap: 2 },
  rotationSymbol: { color: colors.ink, fontSize: 16, lineHeight: 22, fontWeight: "600" },
  rotationReason: { color: colors.muted, fontSize: 13, lineHeight: 18, fontWeight: "400" },
  rotationChip: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6 },
  rotationExitChip: { backgroundColor: colors.dangerSoft },
  rotationHoldChip: { backgroundColor: colors.successSoft },
  rotationChipText: { fontSize: 12, lineHeight: 16, fontWeight: "600" },
  rotationExitText: { color: colors.danger },
  rotationHoldText: { color: colors.success },
  rotationSubhead: { color: colors.ink, fontSize: 15, lineHeight: 21, fontWeight: "600", marginTop: 2 },
  rotationCandidates: { color: colors.ink, fontSize: 16, lineHeight: 22, fontWeight: "600" },
  exitReviewCard: { borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 14, gap: 8 },
  exitReviewHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  exitReviewIdentity: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  exitReviewTitle: { color: colors.ink, fontSize: 16, lineHeight: 21, fontWeight: "600" },
  exitReviewValue: { color: colors.muted, fontSize: 13, lineHeight: 18, fontWeight: "400" },
  exitReviewChip: { backgroundColor: colors.surfaceMuted },
  exitReviewChipText: { color: colors.muted },
  exitReviewReason: { color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: "400" },
  exitReviewSafety: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: "400" },
  exitReviewAction: { minHeight: 44, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", marginTop: 2 },
  exitReviewActionText: { color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: "500" },
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
  logoFallback: { alignItems: "center", justifyContent: "center" },
  logoFallbackText: { color: "#FFFFFF", fontWeight: "800" },
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
  cardBody: { flex: 1, minHeight: 0, overflow: "hidden", paddingHorizontal: 18, paddingTop: 16, paddingBottom: 4 },
  cardPosition: { alignItems: "center", marginBottom: 10 },
  cardPositionText: { color: colors.muted, ...typeRamp.caption },
  infoCard: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingVertical: 11 },
  infoCardPressed: { opacity: 0.62 },
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
