const SEC_BASE_URL = "https://data.sec.gov";
const CACHE_TTL_MS = 15 * 60 * 1000;

export const SEC_CIK_BY_SYMBOL = Object.freeze({
  AAPL: "0000320193",
  AMZN: "0001018724",
  GOOGL: "0001652044",
  META: "0001326801",
  MSFT: "0000789019",
  NVDA: "0001045810",
  TSLA: "0001318605",
});

const cache = new Map();

function latestUsdFact(companyFacts, tags) {
  for (const tag of tags) {
    const units = companyFacts?.facts?.["us-gaap"]?.[tag]?.units?.USD;
    if (!Array.isArray(units)) continue;
    const facts = units
      .filter((fact) => ["10-Q", "10-K"].includes(fact.form) && Number.isFinite(fact.val))
      .sort((a, b) => String(b.filed).localeCompare(String(a.filed)));
    if (facts[0]) return { tag, ...facts[0] };
  }
  return null;
}

export function normalizeSecResearch(symbol, submissions, companyFacts) {
  const recent = submissions?.filings?.recent ?? {};
  const filings = (recent.accessionNumber ?? [])
    .map((accessionNumber, index) => ({
      accessionNumber,
      form: recent.form?.[index],
      filedAt: recent.filingDate?.[index],
      reportDate: recent.reportDate?.[index],
      primaryDocument: recent.primaryDocument?.[index],
    }))
    .filter((filing) => ["10-K", "10-Q", "8-K"].includes(filing.form))
    .slice(0, 5);

  const revenue = latestUsdFact(companyFacts, [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
  ]);
  const netIncome = latestUsdFact(companyFacts, ["NetIncomeLoss", "ProfitLoss"]);
  const latestFiling = filings[0] ?? null;

  return {
    source: "SEC EDGAR",
    symbol,
    cik: submissions?.cik ? String(submissions.cik).padStart(10, "0") : SEC_CIK_BY_SYMBOL[symbol] ?? null,
    companyName: submissions?.name ?? symbol,
    latestFiling,
    recentFilings: filings,
    facts: { revenue, netIncome },
    retrievedAt: Date.now(),
    researchOnly: true,
  };
}

export function summarizeSecResearch(research) {
  const filing = research?.latestFiling;
  if (!filing) return null;
  const facts = [];
  if (research.facts.revenue) facts.push(`reported revenue $${Math.round(research.facts.revenue.val / 1_000_000).toLocaleString()}M`);
  if (research.facts.netIncome) facts.push(`net income $${Math.round(research.facts.netIncome.val / 1_000_000).toLocaleString()}M`);
  const factText = facts.length ? ` The latest standardized facts include ${facts.join(" and ")}.` : "";
  return `Its latest SEC filing is a ${filing.form} filed ${filing.filedAt}.${factText} This filing context is informational and does not determine the trade.`;
}

async function secJson(path, userAgent) {
  const response = await fetch(`${SEC_BASE_URL}${path}`, {
    headers: { "user-agent": userAgent, accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`sec_http_${response.status}`);
  return response.json();
}

export async function getSecCompanyResearch(symbol, options = {}) {
  const normalized = String(symbol).toUpperCase();
  const cik = SEC_CIK_BY_SYMBOL[normalized];
  if (!cik) return null;
  const cached = cache.get(normalized);
  if (cached && Date.now() - cached.retrievedAt < CACHE_TTL_MS) return cached;

  const userAgent = options.userAgent ?? process.env.SEC_USER_AGENT;
  if (!userAgent) throw new Error("sec_user_agent_missing");
  const [submissions, companyFacts] = await Promise.all([
    secJson(`/submissions/CIK${cik}.json`, userAgent),
    secJson(`/api/xbrl/companyfacts/CIK${cik}.json`, userAgent),
  ]);
  const research = normalizeSecResearch(normalized, submissions, companyFacts);
  cache.set(normalized, research);
  return research;
}
