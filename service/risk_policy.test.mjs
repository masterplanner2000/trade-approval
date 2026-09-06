import test from "node:test";
import assert from "node:assert/strict";
import { validateRiskPolicy } from "./server.mjs";

const policy = {
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

test("accepts the smart paper policy", () => {
  assert.equal(validateRiskPolicy(policy), true);
});

test("rejects risk and allocation conflicts", () => {
  assert.equal(validateRiskPolicy({ ...policy, normalRiskPercent: 1 }), false);
  assert.equal(validateRiskPolicy({ ...policy, minimumCashReservePercent: 50, maximumDeployedPercent: 60 }), false);
  assert.equal(validateRiskPolicy({ ...policy, maximumPositions: 0 }), false);
});
