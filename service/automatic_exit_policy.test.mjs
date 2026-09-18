import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAutomaticExits, expectedPriorSessionDate } from "./automatic_exit_policy.mjs";

const checks = ["history", "liquidity", "trend", "momentum", "rsi", "volatility"].map((id) => ({ id, passed: true }));
const scan = (date, eligible, previousSignalDate) => ({ ok: true, selected: { signalDate: date }, evaluations: [{ symbol: "NVDA", eligible, signalDate: date, previousSignalDate, checks }] });
const snapshot = { positions: [{ symbol: "NVDA", quantity: 5 }] };
const mondayObservation = Date.parse("2026-09-15T14:00:00Z");
const tuesdayObservation = Date.parse("2026-09-16T14:00:00Z");

test("automatic exit requires two distinct completed-day failures", () => {
  const first = evaluateAutomaticExits({ scan: scan("20260914", false, "20260911"), snapshot, at: mondayObservation });
  assert.equal(first.exits.length, 0);
  const duplicate = evaluateAutomaticExits({ scan: scan("20260914", false, "20260911"), snapshot, prior: first.state, at: mondayObservation });
  assert.equal(duplicate.exits.length, 0);
  const second = evaluateAutomaticExits({ scan: scan("20260915", false, "20260914"), snapshot, prior: duplicate.state, at: tuesdayObservation });
  assert.equal(second.exits[0].symbol, "NVDA");
});

test("a passing day resets the consecutive-failure history", () => {
  const first = evaluateAutomaticExits({ scan: scan("20260914", false, "20260911"), snapshot, at: mondayObservation });
  const pass = evaluateAutomaticExits({ scan: scan("20260915", true, "20260914"), snapshot, prior: first.state, at: tuesdayObservation });
  assert.deepEqual(pass.state.observations.NVDA, []);
});

test("two observed failures separated by an unobserved completed session are not consecutive", () => {
  const first = evaluateAutomaticExits({ scan: scan("20260914", false, "20260911"), snapshot, at: mondayObservation });
  const later = evaluateAutomaticExits({ scan: scan("20260916", false, "20260915"), snapshot, prior: first.state, at: Date.parse("2026-09-17T14:00:00Z") });
  assert.equal(later.exits.length, 0);
  assert.deepEqual(later.state.observations.NVDA, ["20260916"]);
});

test("missing scanner data can never count as a failed day", () => {
  const result = evaluateAutomaticExits({
    scan: { ok: true, selected: { signalDate: "20260915" }, evaluations: [] },
    snapshot,
    prior: { observations: { NVDA: ["20260914"] }, submitted: {} },
    at: tuesdayObservation,
  });
  assert.equal(result.exits.length, 0);
  assert.deepEqual(result.state.observations.NVDA, ["20260914"]);
});

test("an old bar, incomplete checks, or scanner error never counts as a failure", () => {
  const prior = { observations: { NVDA: ["20260916"] }, submitted: {} };
  const stale = evaluateAutomaticExits({ scan: scan("20260916", false, "20260915"), snapshot, prior, at: Date.parse("2026-09-18T14:00:00Z") });
  assert.equal(stale.exits.length, 0);
  assert.deepEqual(stale.state.observations.NVDA, ["20260916"]);
  const incomplete = scan("20260917", false, "20260916");
  incomplete.evaluations[0].checks = [];
  assert.equal(evaluateAutomaticExits({ scan: incomplete, snapshot, prior, at: Date.parse("2026-09-18T14:00:00Z") }).exits.length, 0);
  const errored = scan("20260917", false, "20260916");
  errored.evaluations[0].error = "insufficient_completed_daily_bars";
  assert.equal(evaluateAutomaticExits({ scan: errored, snapshot, prior, at: Date.parse("2026-09-18T14:00:00Z") }).exits.length, 0);
});

test("the policy only evaluates during New York regular weekday hours", () => {
  assert.equal(expectedPriorSessionDate(Date.parse("2026-09-18T13:29:00Z")), null);
  assert.equal(expectedPriorSessionDate(Date.parse("2026-09-18T13:30:00Z")), "20260917");
  assert.equal(expectedPriorSessionDate(Date.parse("2026-09-18T20:00:00Z")), null);
  assert.equal(expectedPriorSessionDate(Date.parse("2026-09-21T14:00:00Z")), "20260918");
  assert.equal(expectedPriorSessionDate(Date.parse("2026-09-20T14:00:00Z")), null);
});
