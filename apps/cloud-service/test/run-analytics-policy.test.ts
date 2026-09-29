import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRunAnalyticsSnapshot } from "../src/run-analytics-policy.js";

const sample = () => ({
  schemaVersion: 1,
  runId: "40d3c2e7-c7c3-41d2-8c82-64f8b6cf53bf",
  sequence: 1,
  startedAt: "2026-09-29T10:00:00.000Z",
  observedAt: "2026-09-29T10:00:15.000Z",
  state: "running",
  source: "remote",
  promptTokens: 5,
  completionTokens: 2,
  spendUsd: null,
  spendProvenance: "unknown",
});

test("run analytics accepts unknown and measured zero separately", () => {
  assert.equal(parseRunAnalyticsSnapshot(sample()).spendUsd, null);
  assert.equal(parseRunAnalyticsSnapshot({ ...sample(), spendUsd: 0, spendProvenance: "provider_reported" }).spendUsd, 0);
});

test("run analytics rejects content, invalid amounts and terminal state without finish time", () => {
  for (const invalid of [
    { ...sample(), prompt: "private task" },
    { ...sample(), url: "https://example.com/private" },
    { ...sample(), spendUsd: -1, spendProvenance: "estimated" },
    { ...sample(), spendUsd: 0, spendProvenance: "unknown" },
    { ...sample(), state: "succeeded" },
    { ...sample(), model: "x".repeat(129) },
    { ...sample(), sequence: 1.5 },
  ]) assert.throws(() => parseRunAnalyticsSnapshot(invalid));
});
