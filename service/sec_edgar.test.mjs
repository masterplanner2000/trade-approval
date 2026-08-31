import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSecResearch, summarizeSecResearch } from "./sec_edgar.mjs";

test("normalizes recent filings and standardized facts", () => {
  const research = normalizeSecResearch("NVDA", {
    cik: 1045810,
    name: "NVIDIA CORP",
    filings: { recent: {
      accessionNumber: ["0001", "0002"],
      form: ["10-Q", "4"],
      filingDate: ["2026-05-20", "2026-05-21"],
      reportDate: ["2026-04-30", "2026-05-20"],
      primaryDocument: ["nvda-10q.htm", "form4.xml"],
    } },
  }, {
    facts: { "us-gaap": {
      Revenues: { units: { USD: [{ form: "10-Q", filed: "2026-05-20", val: 1000000000 }] } },
      NetIncomeLoss: { units: { USD: [{ form: "10-Q", filed: "2026-05-20", val: 250000000 }] } },
    } },
  });
  assert.equal(research.latestFiling.form, "10-Q");
  assert.equal(research.facts.revenue.val, 1000000000);
  assert.match(summarizeSecResearch(research), /informational/);
  assert.equal(research.researchOnly, true);
});
