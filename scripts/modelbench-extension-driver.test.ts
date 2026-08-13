import assert from "node:assert/strict";
import test from "node:test";
import { extractModelBenchOutcome } from "./modelbench-extension-driver.js";

test("clarification is a structured terminal outcome", () => {
  const outcome = extractModelBenchOutcome([
    { type: "AGENT_STATUS", status: "RUNNING" },
    { type: "CLARIFICATION_REQUEST", clarificationId: "c1", question: "Which record?" },
  ]);
  assert.equal(outcome?.kind, "clarification");
});

test("task completion is detected without interpreting its narration", () => {
  const event = { type: "TASK_COMPLETION", status: "completed", payload: { summary: "Done" } };
  const outcome = extractModelBenchOutcome([event]);
  assert.equal(outcome?.kind, "completion");
  assert.equal(outcome?.event, event);
});
