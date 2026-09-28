import assert from "node:assert/strict";
import test from "node:test";
import { parseNasdaqHaltEvents, parseSecFilingEvents } from "./official_news_pollers.mjs";

test("normalizes recent Nasdaq halts as verified market-safety events", () => {
  const xml = `<rss><channel><item><ndaq:HaltDate>09/25/2026</ndaq:HaltDate><ndaq:HaltTime>09:30:00.000</ndaq:HaltTime><ndaq:IssueSymbol>TEST</ndaq:IssueSymbol><ndaq:IssueName>Test Corp</ndaq:IssueName><ndaq:ReasonCode>LUDP</ndaq:ReasonCode></item></channel></rss>`;
  const items = parseNasdaqHaltEvents(xml, "2026-09-25T13:31:00Z");
  assert.equal(items.length, 1); assert.equal(items[0].symbols[0], "TEST"); assert.equal(items[0].verificationState, "PRIMARY_VERIFIED");
});

test("keeps material SEC forms and excludes routine feed noise", () => {
  const xml = `<feed><entry><title>8-K - TEST CORP (Filer)</title><link rel="alternate" href="https://www.sec.gov/Archives/test"/><updated>2026-09-25T09:10:51-04:00</updated><category term="8-K"/><id>urn:test:1</id></entry><entry><title>424B2 - NOTE</title><link href="https://www.sec.gov/Archives/note"/><updated>2026-09-25T09:10:52-04:00</updated><category term="424B2"/><id>urn:test:2</id></entry></feed>`;
  const items = parseSecFilingEvents(xml, "2026-09-25T13:11:00Z");
  assert.equal(items.length, 1); assert.equal(items[0].sourceRecordId, "urn:test:1"); assert.equal(items[0].sourceTier, "PRIMARY");
});

test("rejects entity-bearing XML", () => {
  assert.throws(() => parseSecFilingEvents("<!DOCTYPE x [<!ENTITY y SYSTEM 'x'>]><feed/>", "2026-09-25T13:11:00Z"), /xml_invalid/);
});
