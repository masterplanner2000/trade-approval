const MODE_VERSION = "catalyst-sprint-shadow-v1";

export const CATALYST_SPRINT_MODE = Object.freeze({
  id: "catalyst_sprint",
  version: MODE_VERSION,
  name: "Catalyst Sprint",
  description: "Higher-risk, short-horizon research for liquid stocks making news- or event-confirmed moves.",
  riskTier: "VERY_HIGH",
  expectedHoldingPeriod: "minutes_to_two_sessions",
  environment: "paper_shadow",
  recommendationAllowed: false,
  orderSubmissionAllowed: false,
  automaticExitAllowed: false,
  selectionPrinciples: [
    "Price, participation and liquidity must confirm the direction of the move.",
    "Fresh news can strengthen a setup but an unverified headline cannot authorize a trade.",
    "Anticipatory setups must reference a known scheduled event and observable positioning.",
    "Riskier symbols receive smaller exposure and faster invalidation, not a larger loss budget.",
  ],
  proposedRiskEnvelope: {
    maximumConcurrentPositions: 3,
    maximumPositionPercentOfModeSleeve: 20,
    maximumRiskPercentOfModeSleevePerTrade: 0.35,
    maximumDailyLossPercentOfModeSleeve: 1,
    overnightHoldingDefault: false,
    entryRequiresProtectiveExitPlan: true,
  },
});

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value, low = 0, high = 100) => Math.max(low, Math.min(high, value));

function catalystAssessment(catalyst, observedAt) {
  if (!catalyst || typeof catalyst !== "object") {
    return { kind: "NONE", points: 0, authority: false, reason: "catalyst_missing" };
  }
  const publishedAt = Date.parse(catalyst.publishedAt ?? catalyst.evidence?.publishedAt ?? "");
  const observed = Date.parse(observedAt ?? "");
  if (!Number.isFinite(publishedAt) || !Number.isFinite(observed) || publishedAt > observed) {
    return { kind: "INVALID", points: 0, authority: false, reason: "catalyst_timing_invalid" };
  }
  const ageMinutes = (observed - publishedAt) / 60_000;
  const verified = new Set(["PRIMARY_SOURCE_VERIFIED", "LICENSED_WIRE_VERIFIED"])
    .has(catalyst.verificationStatus);
  const directional = new Set(["POSITIVE", "NEGATIVE"]).has(catalyst.direction);
  const freshness = ageMinutes <= 30 ? 20 : ageMinutes <= 120 ? 14 : ageMinutes <= 480 ? 7 : 0;
  return {
    kind: "NEWS",
    points: verified && directional ? freshness : Math.min(5, freshness),
    authority: verified && directional && ageMinutes <= 120,
    reason: verified ? directional ? "verified_directional_catalyst" : "direction_unclear" : "headline_unverified",
    ageMinutes: Math.round(ageMinutes),
    verificationStatus: catalyst.verificationStatus ?? "UNVERIFIED",
  };
}

function eventAssessment(event, observedAt) {
  if (!event || typeof event !== "object") {
    return { kind: "NONE", points: 0, authority: false, reason: "scheduled_event_missing" };
  }
  const eventAt = Date.parse(event.scheduledAt ?? "");
  const observed = Date.parse(observedAt ?? "");
  if (!Number.isFinite(eventAt) || !Number.isFinite(observed) || eventAt <= observed) {
    return { kind: "INVALID", points: 0, authority: false, reason: "scheduled_event_timing_invalid" };
  }
  const minutesUntil = (eventAt - observed) / 60_000;
  const verified = event.verificationStatus === "PRIMARY_SOURCE_VERIFIED";
  const inWindow = minutesUntil >= 15 && minutesUntil <= 1_440;
  return {
    kind: "SCHEDULED_EVENT",
    points: verified && inWindow ? 10 : 0,
    authority: verified && inWindow,
    reason: !verified ? "scheduled_event_unverified" : inWindow ? "verified_event_in_window" : "event_outside_window",
    minutesUntil: Math.round(minutesUntil),
    verificationStatus: event.verificationStatus ?? "UNVERIFIED",
  };
}

export function evaluateCatalystSprint({ technical, catalyst = null, scheduledEvent = null } = {}) {
  const symbol = typeof technical?.symbol === "string" ? technical.symbol.toUpperCase() : "";
  const observedAt = technical?.observedAt;
  const technicalScore = number(technical?.score);
  const failures = [];
  if (!symbol) failures.push("symbol_missing");
  if (technical?.status !== "COMPLETE") failures.push("technical_evidence_incomplete");
  if (technical?.direction !== "LONG") failures.push("unsupported_direction");
  if (technicalScore == null) failures.push("technical_score_missing");
  if (!Number.isFinite(Date.parse(observedAt ?? ""))) failures.push("observed_at_invalid");
  if (technical?.hardGatesPassed !== true) failures.push("hard_gates_not_passed");

  const news = catalystAssessment(catalyst, observedAt);
  const event = eventAssessment(scheduledEvent, observedAt);
  const hasAuthorityQualityContext = news.authority || event.authority;
  if (!hasAuthorityQualityContext) failures.push("verified_catalyst_or_event_required");

  const base = {
    mode: CATALYST_SPRINT_MODE.id,
    modeVersion: MODE_VERSION,
    symbol,
    observedAt: observedAt ?? null,
    classification: "research_only",
    recommendationAllowed: false,
    orderSubmissionAllowed: false,
    catalyst: news,
    scheduledEvent: event,
  };
  if (failures.length) {
    return { ...base, status: "BLOCKED", score: null, band: null, blockers: [...new Set(failures)] };
  }

  // Technical confirmation remains dominant. Catalyst points are deliberately
  // capped so a headline cannot rescue a weak price/volume setup.
  const technicalPoints = clamp(technicalScore) * 0.7;
  const contextPoints = Math.max(news.points, event.points);
  const score = Math.round((technicalPoints + contextPoints) * 10) / 10;
  const band = score >= 75 ? "SPRINT_CANDIDATE" : score >= 65 ? "WATCH_CLOSELY" : "NO_SETUP";
  return {
    ...base,
    status: "COMPLETE",
    score,
    maximumScore: 90,
    band,
    components: [
      { id: "technical_confirmation", points: Math.round(technicalPoints * 10) / 10, maximumPoints: 70 },
      { id: "catalyst_or_event", points: contextPoints, maximumPoints: 20 },
    ],
    proposedTradeControls: CATALYST_SPRINT_MODE.proposedRiskEnvelope,
    limitations: [
      "This first version is a shadow/paper research lane and cannot create or submit an order.",
      "The score has not been calibrated to expected returns or transaction costs.",
      "Short-direction, options and overnight-event-risk models are not included.",
    ],
  };
}
