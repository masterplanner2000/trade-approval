const PROFILE_VERSION = "portfolio-exposure-v1";

const profiles = {
  AAPL: ["Information Technology", "Consumer devices"],
  AMZN: ["Consumer Discretionary", "Digital commerce"],
  AVGO: ["Information Technology", "Semiconductors"],
  CAT: ["Industrials", "Industrial machinery"],
  CSCO: ["Information Technology", "Networking"],
  CVX: ["Energy", "Oil and gas"],
  DE: ["Industrials", "Industrial machinery"],
  DELL: ["Information Technology", "AI infrastructure"],
  GOOG: ["Communication Services", "Digital advertising"],
  GOOGL: ["Communication Services", "Digital advertising"],
  INTC: ["Information Technology", "Semiconductors"],
  JNJ: ["Health Care", "Pharmaceuticals"],
  KLAC: ["Information Technology", "Semiconductor equipment"],
  LRCX: ["Information Technology", "Semiconductor equipment"],
  META: ["Communication Services", "Digital advertising"],
  MRK: ["Health Care", "Pharmaceuticals"],
  MRVL: ["Information Technology", "Semiconductors"],
  MSFT: ["Information Technology", "Cloud software"],
  MU: ["Information Technology", "Semiconductors"],
  NVDA: ["Information Technology", "AI infrastructure"],
  NOW: ["Information Technology", "Cloud software"],
  PLTR: ["Information Technology", "AI software"],
  QQQ: ["Diversified", "Nasdaq 100 index"],
  QCOM: ["Information Technology", "Semiconductors"],
  SMCI: ["Information Technology", "AI infrastructure"],
  TMO: ["Health Care", "Life sciences tools"],
  TQQQ: ["Diversified", "Leveraged Nasdaq 100"],
  TSLA: ["Consumer Discretionary", "Electric vehicles"],
  TSM: ["Information Technology", "Semiconductors"],
  VLO: ["Energy", "Oil refining"],
  XOM: ["Energy", "Oil and gas"],
};

export const canonicalExposureSymbol = (symbol = "") => {
  const normalized = String(symbol).trim().toUpperCase();
  return normalized === "GOOG" || normalized === "GOOGL" ? "ALPHABET" : normalized;
};

export function exposureProfile(symbol = "") {
  const normalized = String(symbol).trim().toUpperCase();
  const [sector, theme] = profiles[normalized] ?? [];
  return {
    version: PROFILE_VERSION,
    symbol: normalized,
    security: canonicalExposureSymbol(normalized),
    sector: sector ?? null,
    theme: theme ?? null,
    complete: Boolean(sector && theme),
  };
}

const round = (value) => Math.round(value * 100) / 100;

export function evaluatePortfolioAddition({
  symbol,
  notional,
  holdings = [],
  capitalLimit,
  maxPositionValue,
  maxSectorValue,
  maxThemeValue,
  maxOpenPositions,
  diversificationStartsAt = 5,
} = {}) {
  const candidate = exposureProfile(symbol);
  const amount = Number(notional ?? 0);
  const active = holdings.filter((holding) => Number(holding.notional ?? 0) > 0);
  const candidateHolding = active.find((holding) => canonicalExposureSymbol(holding.symbol) === candidate.security);
  const isNewPosition = !candidateHolding;
  const openPositionCount = new Set(active.map((holding) => canonicalExposureSymbol(holding.symbol))).size;
  const resultingPositionValue = round(Number(candidateHolding?.notional ?? 0) + amount);
  const deployed = round(active.reduce((sum, holding) => sum + Number(holding.notional ?? 0), 0));
  const sectorExposure = candidate.complete
    ? round(active.filter((holding) => exposureProfile(holding.symbol).sector === candidate.sector)
      .reduce((sum, holding) => sum + Number(holding.notional ?? 0), 0) + amount)
    : null;
  const themeExposure = candidate.complete
    ? round(active.filter((holding) => exposureProfile(holding.symbol).theme === candidate.theme)
      .reduce((sum, holding) => sum + Number(holding.notional ?? 0), 0) + amount)
    : null;
  const additionalSlot = isNewPosition && openPositionCount >= diversificationStartsAt;
  const diversificationKnown = candidate.complete;
  const diversifies = !additionalSlot || (diversificationKnown
    && !active.some((holding) => {
      const profile = exposureProfile(holding.symbol);
      return profile.sector === candidate.sector && profile.theme === candidate.theme;
    }));
  const checks = {
    validNotional: Number.isFinite(amount) && amount > 0,
    sleeveAllowed: deployed + amount <= capitalLimit,
    positionAllowed: resultingPositionValue <= maxPositionValue,
    positionSlotAllowed: !isNewPosition || openPositionCount < maxOpenPositions,
    securityExposureAllowed: resultingPositionValue <= maxPositionValue,
    classificationComplete: diversificationKnown,
    sectorAllowed: !candidate.complete || sectorExposure <= maxSectorValue,
    themeAllowed: !candidate.complete || themeExposure <= maxThemeValue,
    diversificationAllowed: diversifies,
  };
  return {
    allowed: Object.values(checks).every(Boolean),
    checks,
    candidate,
    additionalSlot,
    openPositionCount,
    resultingOpenPositionCount: openPositionCount + (isNewPosition ? 1 : 0),
    deployed,
    resultingDeployed: round(deployed + amount),
    resultingPositionValue,
    sectorExposure,
    themeExposure,
  };
}
