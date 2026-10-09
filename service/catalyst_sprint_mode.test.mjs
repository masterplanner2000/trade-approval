import assert from "node:assert/strict";
import test from "node:test";
import { CATALYST_SPRINT_MODE, evaluateCatalystSprint } from "./catalyst_sprint_mode.mjs";

const technical = (changes = {}) => ({
  status: "COMPLETE", symbol: "BMNR", observedAt: "2026-10-02T14:00:00Z",
  direction: "LONG", score: 82, hardGatesPassed: true, ...changes,
});

const catalyst = (changes = {}) => ({
  publishedAt: "2026-10-02T13:40:00Z", direction: "POSITIVE",
  verificationStatus: "PRIMARY_SOURCE_VERIFIED", ...changes,
});

test("mode is isolated and cannot authorize recommendations or orders", () => {
  assert.equal(CATALYST_SPRINT_MODE.environment, "paper_shadow");
  assert.equal(CATALYST_SPRINT_MODE.recommendationAllowed, false);
  assert.equal(CATALYST_SPRINT_MODE.orderSubmissionAllowed, false);
  assert.equal(CATALYST_SPRINT_MODE.automaticExitAllowed, false);
});

test("strong technical evidence plus a fresh verified catalyst creates a shadow candidate", () => {
  const result = evaluateCatalystSprint({ technical: technical(), catalyst: catalyst() });
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.band, "SPRINT_CANDIDATE");
  assert.equal(result.catalyst.authority, true);
  assert.equal(result.recommendationAllowed, false);
  assert.equal(result.orderSubmissionAllowed, false);
});

test("an unverified headline cannot qualify the mode", () => {
  const result = evaluateCatalystSprint({ technical: technical(), catalyst: catalyst({
    verificationStatus: "UNVERIFIED_HEADLINE_ONLY",
  }) });
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("verified_catalyst_or_event_required"));
});

test("a verified scheduled event can qualify anticipatory research", () => {
  const result = evaluateCatalystSprint({
    technical: technical(),
    scheduledEvent: { scheduledAt: "2026-10-02T18:00:00Z", verificationStatus: "PRIMARY_SOURCE_VERIFIED" },
  });
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.scheduledEvent.authority, true);
  assert.equal(result.scheduledEvent.reason, "verified_event_in_window");
});

test("news cannot rescue failed technical gates or weak technical evidence", () => {
  const blocked = evaluateCatalystSprint({ technical: technical({ hardGatesPassed: false }), catalyst: catalyst() });
  assert.equal(blocked.status, "BLOCKED");
  assert.ok(blocked.blockers.includes("hard_gates_not_passed"));

  const weak = evaluateCatalystSprint({ technical: technical({ score: 40 }), catalyst: catalyst() });
  assert.equal(weak.status, "COMPLETE");
  assert.equal(weak.band, "NO_SETUP");
});

test("future-dated news and unsupported directions fail closed", () => {
  const result = evaluateCatalystSprint({
    technical: technical({ direction: "SHORT" }),
    catalyst: catalyst({ publishedAt: "2026-10-02T14:01:00Z" }),
  });
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("unsupported_direction"));
  assert.equal(result.catalyst.reason, "catalyst_timing_invalid");
});
