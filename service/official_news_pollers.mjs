const NASDAQ_URL = "https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts";
const SEC_URL = "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&output=atom&count=100";
const MAX_BYTES = 2_000_000;
const IMPORTANT_FORMS = new Set(["8-K", "8-K/A", "6-K", "6-K/A", "10-Q", "10-Q/A", "10-K", "10-K/A", "S-1", "S-1/A", "S-3", "S-3/A", "424B3", "424B4", "SC 13D", "SC 13D/A", "SC 13G", "SC 13G/A"]);

function decodeXml(value = "") { return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim(); }
function tag(block, name) { const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i")); return match ? decodeXml(match[1]) : ""; }
function attribute(block, tagName, name) { const match = block.match(new RegExp(`<${tagName}\\b[^>]*\\b${name}="([^"]*)"[^>]*>`, "i")); return match ? decodeXml(match[1]) : ""; }
function blocks(xml, name) { return [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "gi"))].map(match => match[1]); }
function easternInstant(day, time) {
  const dayMatch = String(day).match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if (!dayMatch || !time) return null;
  const tentative = new Date(`${dayMatch[3]}-${dayMatch[1]}-${dayMatch[2]}T${time.slice(0, 8)}-04:00`);
  return Number.isFinite(tentative.getTime()) ? tentative.toISOString() : null;
}

export function parseNasdaqHaltEvents(xml, observedAt) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("official_feed_xml_invalid");
  const observed = Date.parse(observedAt); if (!Number.isFinite(observed)) throw new Error("official_feed_observed_at_invalid");
  return blocks(xml, "item").flatMap(item => {
    const symbol = tag(item, "ndaq:IssueSymbol").toUpperCase();
    const haltDate = tag(item, "ndaq:HaltDate"), haltTime = tag(item, "ndaq:HaltTime");
    const publishedAt = easternInstant(haltDate, haltTime);
    if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol) || !publishedAt || observed - Date.parse(publishedAt) > 48 * 60 * 60 * 1000) return [];
    const reason = tag(item, "ndaq:ReasonCode") || "unknown reason";
    const name = tag(item, "ndaq:IssueName") || symbol;
    return [{ provider: "Nasdaq Trader", publisher: "Nasdaq Trader", sourceTier: "MARKET_SAFETY",
      sourceRecordId: `halt:${symbol}:${haltDate}:${haltTime}`, headline: `${symbol} trading halt (${reason}) — ${name}`,
      url: "https://www.nasdaqtrader.com/Trader.aspx?id=TradingHaltSearch", publishedAt, updatedAt: publishedAt,
      firstSeenAt: observedAt, originalLanguage: "en", country: "United States", symbols: [symbol], verificationState: "PRIMARY_VERIFIED" }];
  });
}

export function parseSecFilingEvents(xml, observedAt) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("official_feed_xml_invalid");
  return blocks(xml, "entry").flatMap(entry => {
    const form = attribute(entry, "category", "term");
    if (!IMPORTANT_FORMS.has(form)) return [];
    const sourceRecordId = tag(entry, "id"), title = tag(entry, "title"), publishedAt = tag(entry, "updated");
    const url = attribute(entry, "link", "href");
    if (!sourceRecordId || !title || !url || !Number.isFinite(Date.parse(publishedAt))) return [];
    return [{ provider: "SEC EDGAR", publisher: "SEC EDGAR", sourceTier: "PRIMARY",
      sourceRecordId, headline: title, url, publishedAt, updatedAt: publishedAt, firstSeenAt: observedAt,
      originalLanguage: "en", country: "United States", symbols: [], verificationState: "PRIMARY_VERIFIED" }];
  });
}

async function boundedText(url, { fetchImpl, headers = {} }) {
  const response = await fetchImpl(url, { headers, redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`official_feed_http_${response.status}`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BYTES) throw new Error("official_feed_response_too_large");
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("official_feed_response_too_large");
  return text;
}

export function createOfficialNewsPoller({ journal, fetchImpl = fetch, clock = () => Date.now(), secUserAgent = process.env.SEC_USER_AGENT ?? "TradeApprovalResearch/1.0" } = {}) {
  if (!journal) throw new Error("official_feed_journal_required");
  journal.registerSource({ sourceKey: "nasdaq-trading-halts-v1", provider: "Nasdaq Trader", publisher: "Nasdaq Trader", sourceTier: "MARKET_SAFETY", version: "rss-v1", configuration: { intervalSeconds: 60, researchOnly: true } });
  journal.registerSource({ sourceKey: "sec-current-filings-v1", provider: "SEC EDGAR", publisher: "SEC EDGAR", sourceTier: "PRIMARY", version: "atom-v1", configuration: { intervalSeconds: 60, forms: [...IMPORTANT_FORMS].sort(), researchOnly: true } });
  async function ingest(sourceKey, loader) {
    try {
      const events = await loader(), observedAt = new Date(clock()).toISOString(); let created = 0;
      for (const event of events) if (journal.append(event, observedAt).created) created++;
      journal.updateHealth(sourceKey, { status: "CONNECTED", lastMessageAt: events.length ? clock() : undefined });
      return { sourceKey, received: events.length, created };
    } catch (error) { journal.updateHealth(sourceKey, { status: "DEGRADED", lastError: error.message }); return { sourceKey, received: 0, created: 0, error: error.message }; }
  }
  return async function poll() {
    const observedAt = new Date(clock()).toISOString();
    const [halts, filings] = await Promise.all([
      ingest("nasdaq-trading-halts-v1", async () => parseNasdaqHaltEvents(await boundedText(NASDAQ_URL, { fetchImpl, headers: { accept: "application/rss+xml", "user-agent": "TradeApprovalResearch/1.0" } }), observedAt)),
      ingest("sec-current-filings-v1", async () => {
        return parseSecFilingEvents(await boundedText(SEC_URL, { fetchImpl, headers: { accept: "application/atom+xml", "user-agent": secUserAgent } }), observedAt);
      }),
    ]);
    return { observedAt, sources: [halts, filings] };
  };
}
