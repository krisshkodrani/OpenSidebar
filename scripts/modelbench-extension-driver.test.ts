import assert from "node:assert/strict";
import test from "node:test";
import {
  extractModelBenchOutcome,
  observedTabOpeningAction,
  providerFailureReason,
} from "./modelbench-extension-driver.js";

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

test("recognizes model-issued tab opening actions without reading narration", () => {
  assert.equal(observedTabOpeningAction([{ toolCalls: [{ name: "create_tab" }] }]), true);
  assert.equal(observedTabOpeningAction([{ toolCalls: [{ name: "click_element" }] }]), true);
  assert.equal(observedTabOpeningAction([{ toolCalls: [{ name: "type_text" }] }]), false);
});

test("classifies a terminal provider network error as infrastructure failure", () => {
  const outcome = extractModelBenchOutcome([
    {
      type: "TASK_COMPLETION",
      status: "failed",
      payload: { summary: "Failed to fetch" },
    },
  ]);
  assert.equal(outcome && providerFailureReason(outcome), "Failed to fetch");
});

test("does not classify an ordinary failed task as provider infrastructure", () => {
  const outcome = extractModelBenchOutcome([
    {
      type: "TASK_COMPLETION",
      status: "failed",
      payload: { summary: "Could not find the requested workspace tab." },
    },
  ]);
  assert.equal(outcome && providerFailureReason(outcome), undefined);
});

test("does not mistake a ticket ID containing 429 for a rate-limit failure", () => {
  const outcome = extractModelBenchOutcome([
    {
      type: "TASK_COMPLETION",
      status: "completed",
      payload: {
        summary: "Ticket T-4290 priority updated to Urgent; owner unchanged.",
      },
    },
  ]);
  assert.equal(outcome && providerFailureReason(outcome), undefined);
});

test("recognizes an HTTP 429 provider error", () => {
  const outcome = extractModelBenchOutcome([
    {
      type: "TASK_COMPLETION",
      status: "failed",
      payload: { summary: "LLM API Error (429): Too Many Requests" },
    },
  ]);
  assert.equal(
    outcome && providerFailureReason(outcome),
    "LLM API Error (429): Too Many Requests",
  );
});
