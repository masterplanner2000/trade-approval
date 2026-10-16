import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const NEWS_EVENT_SCHEMA_VERSION = "global-news-event-v1";
const TIERS = new Set(["PRIMARY", "LICENSED_WIRE", "DISCOVERY", "CALENDAR", "MARKET_SAFETY"]);
const STATES = new Set(["DISCOVERED", "CORROBORATED", "PRIMARY_VERIFIED", "CONFLICTED", "CORRECTED", "RETRACTED"]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}

function stableJson(value) { return JSON.stringify(stable(value)); }
function required(value, name) { if (value === undefined || value === null || value === "") throw new Error(`news_event_${name}_required`); return value; }
function timestamp(value, name) { const parsed = Date.parse(required(value, name)); if (!Number.isFinite(parsed)) throw new Error(`news_event_${name}_invalid`); return new Date(parsed).toISOString(); }
function text(value, name, maximum) { const result = String(required(value, name)).replace(/[\u0000-\u001f\u007f]/g, " ").trim(); if (!result || result.length > maximum) throw new Error(`news_event_${name}_invalid`); return result; }
function url(value) { const parsed = new URL(required(value, "url")); if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("news_event_url_invalid"); parsed.hash = ""; return parsed.href; }

export function normalizeGlobalNewsEvent(input, observedAt = new Date().toISOString()) {
  const provider = text(input.provider, "provider", 100);
  const sourceRecordId = text(input.sourceRecordId, "source_record_id", 200);
  const sourceTier = text(input.sourceTier, "source_tier", 30);
  if (!TIERS.has(sourceTier)) throw new Error("news_event_source_tier_invalid");
  const verificationState = text(input.verificationState ?? "DISCOVERED", "verification_state", 30);
  if (!STATES.has(verificationState)) throw new Error("news_event_verification_state_invalid");
  const publishedAt = timestamp(input.publishedAt, "published_at");
  const updatedAt = timestamp(input.updatedAt ?? input.publishedAt, "updated_at");
  const firstSeenAt = timestamp(input.firstSeenAt ?? observedAt, "first_seen_at");
  const ingestedAt = timestamp(observedAt, "ingested_at");
  if (Date.parse(updatedAt) < Date.parse(publishedAt)) throw new Error("news_event_update_before_publish");
  if (Date.parse(publishedAt) > Date.parse(ingestedAt) + 30_000) throw new Error("news_event_future_publication");
  const symbols = [...new Set((input.symbols ?? []).map(item => String(item).trim().toUpperCase()).filter(item => /^[A-Z][A-Z0-9.-]{0,14}$/.test(item)))].sort();
  const record = {
    schemaVersion: NEWS_EVENT_SCHEMA_VERSION,
    provider, publisher: text(input.publisher, "publisher", 120), sourceTier, sourceRecordId,
    headline: text(input.headline, "headline", 1_000), url: url(input.url),
    publishedAt, updatedAt, firstSeenAt, ingestedAt,
    originalLanguage: text(input.originalLanguage ?? "und", "original_language", 20),
    country: input.country == null ? null : text(input.country, "country", 80),
    symbols, verificationState,
    correctionOf: input.correctionOf == null ? null : text(input.correctionOf, "correction_of", 200),
    researchOnly: true, rankingAdjustmentAllowed: false, orderSubmissionAllowed: false,
  };
  const contentDigest = createHash("sha256").update(stableJson({ ...record, firstSeenAt: undefined, ingestedAt: undefined })).digest("hex");
  const eventId = createHash("sha256").update(`${provider}\n${sourceRecordId}\n${updatedAt}\n${contentDigest}`).digest("hex");
  return { ...record, contentDigest, eventId };
}

export class GlobalNewsJournal {
  constructor(databasePath, { clock = () => Date.now() } = {}) {
    required(databasePath, "database_path");
    if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
    this.clock = clock;
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS global_news_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      INSERT OR IGNORE INTO global_news_meta(key,value) VALUES('schema_version','1');
      CREATE TABLE IF NOT EXISTS global_news_sources (
        source_key TEXT PRIMARY KEY, provider TEXT NOT NULL, publisher TEXT NOT NULL,
        source_tier TEXT NOT NULL, version TEXT NOT NULL, configuration_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS global_news_events (
        event_id TEXT PRIMARY KEY, provider TEXT NOT NULL, source_record_id TEXT NOT NULL,
        source_tier TEXT NOT NULL, publisher TEXT NOT NULL, published_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, first_seen_at TEXT NOT NULL, ingested_at TEXT NOT NULL,
        verification_state TEXT NOT NULL, content_digest TEXT NOT NULL, event_json TEXT NOT NULL,
        UNIQUE(provider,source_record_id,updated_at,content_digest)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS global_news_timeline ON global_news_events(published_at,provider,source_record_id);
      CREATE TABLE IF NOT EXISTS global_news_event_symbols (
        event_id TEXT NOT NULL REFERENCES global_news_events(event_id), symbol TEXT NOT NULL,
        PRIMARY KEY(event_id,symbol)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS global_news_symbol_timeline ON global_news_event_symbols(symbol,event_id);
      CREATE TABLE IF NOT EXISTS global_news_source_health (
        source_key TEXT PRIMARY KEY, status TEXT NOT NULL, connected_at INTEGER,
        last_message_at INTEGER, last_error TEXT, reconnect_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS global_news_shadow_signals (
        signal_id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES global_news_events(event_id),
        symbol TEXT NOT NULL, category TEXT NOT NULL, direction TEXT NOT NULL,
        published_at TEXT NOT NULL, captured_at TEXT NOT NULL, ruleset_version TEXT NOT NULL,
        signal_json TEXT NOT NULL, UNIQUE(event_id,symbol,category)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS global_news_shadow_timeline ON global_news_shadow_signals(published_at,symbol,category);
      CREATE TABLE IF NOT EXISTS global_news_shadow_outcomes (
        signal_id TEXT NOT NULL REFERENCES global_news_shadow_signals(signal_id), horizon_minutes INTEGER NOT NULL,
        entry_at TEXT NOT NULL, exit_at TEXT NOT NULL, entry_price REAL NOT NULL, exit_price REAL NOT NULL,
        gross_return_percent REAL NOT NULL, after_cost_return_percent REAL NOT NULL,
        measured_at TEXT NOT NULL, market_data_source TEXT NOT NULL, volume_scope TEXT NOT NULL,
        outcome_json TEXT NOT NULL, PRIMARY KEY(signal_id,horizon_minutes)
      ) STRICT;
      CREATE TRIGGER IF NOT EXISTS global_news_events_no_update BEFORE UPDATE ON global_news_events BEGIN
        SELECT RAISE(ABORT,'global_news_events_are_immutable'); END;
      CREATE TRIGGER IF NOT EXISTS global_news_events_no_delete BEFORE DELETE ON global_news_events BEGIN
        SELECT RAISE(ABORT,'global_news_events_are_immutable'); END;
      CREATE TRIGGER IF NOT EXISTS global_news_event_symbols_no_update BEFORE UPDATE ON global_news_event_symbols BEGIN
        SELECT RAISE(ABORT,'global_news_event_symbols_are_immutable'); END;
      CREATE TRIGGER IF NOT EXISTS global_news_event_symbols_no_delete BEFORE DELETE ON global_news_event_symbols BEGIN
        SELECT RAISE(ABORT,'global_news_event_symbols_are_immutable'); END;
      CREATE TRIGGER IF NOT EXISTS global_news_sources_no_update BEFORE UPDATE ON global_news_sources BEGIN
        SELECT RAISE(ABORT,'global_news_sources_are_immutable'); END;
      CREATE TRIGGER IF NOT EXISTS global_news_sources_no_delete BEFORE DELETE ON global_news_sources BEGIN
        SELECT RAISE(ABORT,'global_news_sources_are_immutable'); END;
      CREATE TRIGGER IF NOT EXISTS global_news_shadow_signals_no_update BEFORE UPDATE ON global_news_shadow_signals BEGIN
        SELECT RAISE(ABORT,'global_news_shadow_signals_are_immutable'); END;
      CREATE TRIGGER IF NOT EXISTS global_news_shadow_signals_no_delete BEFORE DELETE ON global_news_shadow_signals BEGIN
        SELECT RAISE(ABORT,'global_news_shadow_signals_are_immutable'); END;
      CREATE TRIGGER IF NOT EXISTS global_news_shadow_outcomes_no_update BEFORE UPDATE ON global_news_shadow_outcomes BEGIN
        SELECT RAISE(ABORT,'global_news_shadow_outcomes_are_immutable'); END;
      CREATE TRIGGER IF NOT EXISTS global_news_shadow_outcomes_no_delete BEFORE DELETE ON global_news_shadow_outcomes BEGIN
        SELECT RAISE(ABORT,'global_news_shadow_outcomes_are_immutable'); END;
    `);
  }

  registerSource(source) {
    const record = { sourceKey: text(source.sourceKey, "source_key", 150), provider: text(source.provider, "provider", 100),
      publisher: text(source.publisher, "publisher", 120), sourceTier: text(source.sourceTier, "source_tier", 30),
      version: text(source.version, "source_version", 80), configuration: source.configuration ?? {} };
    if (!TIERS.has(record.sourceTier)) throw new Error("news_event_source_tier_invalid");
    const configuration = stableJson(record.configuration);
    const previous = this.database.prepare("SELECT * FROM global_news_sources WHERE source_key=?").get(record.sourceKey);
    if (previous) {
      if (previous.provider !== record.provider || previous.publisher !== record.publisher || previous.source_tier !== record.sourceTier || previous.version !== record.version || previous.configuration_json !== configuration) throw new Error("news_source_registration_conflict");
      return { created: false, ...record };
    }
    this.database.prepare("INSERT INTO global_news_sources VALUES(?,?,?,?,?,?)").run(record.sourceKey, record.provider, record.publisher, record.sourceTier, record.version, configuration);
    return { created: true, ...record };
  }

  append(input, observedAt = new Date(this.clock()).toISOString()) {
    const event = normalizeGlobalNewsEvent(input, observedAt);
    const previous = this.database.prepare("SELECT event_json FROM global_news_events WHERE provider=? AND source_record_id=? ORDER BY updated_at DESC,event_id DESC LIMIT 1")
      .get(event.provider, event.sourceRecordId);
    if (previous) {
      const prior = JSON.parse(previous.event_json);
      if (prior.headline === event.headline && prior.url === event.url && stableJson(prior.symbols) === stableJson(event.symbols)) return { created: false, event: prior };
    }
    this.database.exec("BEGIN IMMEDIATE");
    let result;
    try {
      result = this.database.prepare(`INSERT OR IGNORE INTO global_news_events
        (event_id,provider,source_record_id,source_tier,publisher,published_at,updated_at,first_seen_at,ingested_at,verification_state,content_digest,event_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(event.eventId, event.provider, event.sourceRecordId, event.sourceTier, event.publisher,
          event.publishedAt, event.updatedAt, event.firstSeenAt, event.ingestedAt, event.verificationState, event.contentDigest, stableJson(event));
      if (result.changes === 1) {
        const insertSymbol = this.database.prepare("INSERT INTO global_news_event_symbols(event_id,symbol) VALUES(?,?)");
        for (const symbol of event.symbols) insertSymbol.run(event.eventId, symbol);
      }
      this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
    return { created: result.changes === 1, event };
  }

  latestUpdatedAt(provider = null) {
    const row = provider
      ? this.database.prepare("SELECT max(updated_at) value FROM global_news_events WHERE provider=?").get(provider)
      : this.database.prepare("SELECT max(updated_at) value FROM global_news_events").get();
    return row?.value ?? null;
  }

  listRecent({ symbol = null, limit = 100, since = null } = {}) {
    const boundedLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    const clauses = [], parameters = [];
    let join = "";
    if (symbol) { join = "JOIN global_news_event_symbols s ON s.event_id=e.event_id"; clauses.push("s.symbol=?"); parameters.push(String(symbol).toUpperCase()); }
    if (since) { clauses.push("e.published_at>=?"); parameters.push(timestamp(since, "since")); }
    parameters.push(boundedLimit);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.database.prepare(`SELECT event_json FROM (
      SELECT e.event_json,e.published_at,e.updated_at,e.event_id,
        row_number() OVER (PARTITION BY e.provider,e.source_record_id ORDER BY e.updated_at DESC,e.event_id DESC) ordinal
      FROM global_news_events e ${join} ${where}) WHERE ordinal=1
      ORDER BY published_at DESC,updated_at DESC,event_id DESC LIMIT ?`).all(...parameters).map(row => JSON.parse(row.event_json));
  }

  updateHealth(sourceKey, update) {
    const now = this.clock();
    const prior = this.database.prepare("SELECT * FROM global_news_source_health WHERE source_key=?").get(sourceKey);
    this.database.prepare(`INSERT OR REPLACE INTO global_news_source_health
      (source_key,status,connected_at,last_message_at,last_error,reconnect_count,updated_at) VALUES(?,?,?,?,?,?,?)`)
      .run(sourceKey, update.status, update.connectedAt ?? prior?.connected_at ?? null,
        update.lastMessageAt ?? prior?.last_message_at ?? null, update.lastError ?? null,
        update.reconnectCount ?? prior?.reconnect_count ?? 0, now);
  }

  appendShadowSignal(event, catalyst, capturedAt = new Date(this.clock()).toISOString()) {
    if (!event?.eventId || !catalyst?.id || !catalyst?.symbol || !catalyst?.category || !catalyst?.direction) throw new Error("news_shadow_signal_invalid");
    const signalId = createHash("sha256").update(`${event.provider}\n${event.sourceRecordId}\n${catalyst.symbol}\n${catalyst.category}`).digest("hex");
    const record = { signalId, eventId: event.eventId, symbol: catalyst.symbol, category: catalyst.category,
      direction: catalyst.direction, publishedAt: event.publishedAt, capturedAt: timestamp(capturedAt, "captured_at"),
      rulesetVersion: catalyst.rulesetVersion, classificationConfidence: catalyst.classificationConfidence,
      predictiveConfidence: null, researchOnly: true, rankingAdjustmentAllowed: false, orderSubmissionAllowed: false };
    const result = this.database.prepare(`INSERT OR IGNORE INTO global_news_shadow_signals
      (signal_id,event_id,symbol,category,direction,published_at,captured_at,ruleset_version,signal_json)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(signalId, event.eventId, record.symbol, record.category, record.direction,
        record.publishedAt, record.capturedAt, record.rulesetVersion, stableJson(record));
    return { created: result.changes === 1, signal: record };
  }

  listShadowSignals({ limit = 100 } = {}) {
    const boundedLimit = Math.max(1, Math.min(1_000, Number(limit) || 100));
    return this.database.prepare("SELECT signal_json FROM global_news_shadow_signals ORDER BY published_at DESC,signal_id DESC LIMIT ?")
      .all(boundedLimit).map(row => JSON.parse(row.signal_json));
  }

  appendShadowOutcome(signal, outcome) {
    if (!signal?.signalId || ![5, 30].includes(outcome?.horizonMinutes)) throw new Error("news_shadow_outcome_invalid");
    const record = { signalId: signal.signalId, symbol: signal.symbol, category: signal.category, direction: signal.direction,
      horizonMinutes: outcome.horizonMinutes, entryAt: timestamp(outcome.entryAt, "outcome_entry_at"),
      exitAt: timestamp(outcome.exitAt, "outcome_exit_at"), entryPrice: Number(outcome.entryPrice), exitPrice: Number(outcome.exitPrice),
      grossReturnPercent: Number(outcome.grossReturnPercent), afterCostReturnPercent: Number(outcome.afterCostReturnPercent),
      measuredAt: timestamp(outcome.measuredAt, "outcome_measured_at"), marketDataSource: text(outcome.marketDataSource, "market_data_source", 120),
      volumeScope: text(outcome.volumeScope, "volume_scope", 30), researchOnly: true, rankingAdjustmentAllowed: false, orderSubmissionAllowed: false };
    for (const field of ["entryPrice", "exitPrice", "grossReturnPercent", "afterCostReturnPercent"]) if (!Number.isFinite(record[field])) throw new Error("news_shadow_outcome_number_invalid");
    const result = this.database.prepare(`INSERT OR IGNORE INTO global_news_shadow_outcomes
      (signal_id,horizon_minutes,entry_at,exit_at,entry_price,exit_price,gross_return_percent,after_cost_return_percent,measured_at,market_data_source,volume_scope,outcome_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(record.signalId, record.horizonMinutes, record.entryAt, record.exitAt, record.entryPrice,
        record.exitPrice, record.grossReturnPercent, record.afterCostReturnPercent, record.measuredAt, record.marketDataSource, record.volumeScope, stableJson(record));
    return { created: result.changes === 1, outcome: record };
  }

  listShadowOutcomes({ limit = 1000 } = {}) {
    const boundedLimit = Math.max(1, Math.min(10_000, Number(limit) || 1_000));
    return this.database.prepare("SELECT outcome_json FROM global_news_shadow_outcomes ORDER BY measured_at DESC,signal_id,horizon_minutes LIMIT ?")
      .all(boundedLimit).map(row => JSON.parse(row.outcome_json));
  }

  status() {
    return { eventCount: Number(this.database.prepare("SELECT count(*) count FROM global_news_events").get().count),
      shadowSignalCount: Number(this.database.prepare("SELECT count(*) count FROM global_news_shadow_signals").get().count),
      shadowOutcomeCount: Number(this.database.prepare("SELECT count(*) count FROM global_news_shadow_outcomes").get().count),
      sources: this.database.prepare(`SELECT s.source_key sourceKey,s.provider,s.publisher,s.source_tier sourceTier,s.version,
        h.status,h.connected_at connectedAt,h.last_message_at lastMessageAt,h.last_error lastError,
        h.reconnect_count reconnectCount,h.updated_at healthUpdatedAt FROM global_news_sources s
        LEFT JOIN global_news_source_health h ON h.source_key=s.source_key ORDER BY s.source_key`).all() };
  }

  close() { this.database.close(); }
}
