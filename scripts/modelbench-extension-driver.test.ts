import assert from "node:assert/strict";
import test from "node:test";
import {
  extractModelBenchOutcome,
  extractStoredModelBenchOutcome,
  harnessFailureReason,
  modelBenchSettingsPatch,
  observedTabOpeningAction,
  providerFailureReason,
} from "./modelbench-extension-driver.js";

test("maps each benchmark seat into the extension settings contract", () => {
  assert.deepEqual(
    modelBenchSettingsPatch({
      attemptId: "attempt",
      repetition: 0,
      definition: {} as never,
      configuration: {
        label: "vision",
        provider: "openrouter",
        perceptionMode: "auto",
        seats: {
          executor: {
            provider: "openrouter",
            providerPin: "openai",
            model: "openai/gpt-5.6-sol",
          },
          planner: {
            provider: "openrouter",
            providerPin: "z-ai",
            model: "z-ai/glm-5.2",
          },
        },
      },
    }),
    {
      providerMode: "openrouter",
      executorModel: "openai/gpt-5.6-sol",
      plannerModel: "z-ai/glm-5.2",
      executorProviderPin: "openai",
      plannerProviderPin: "z-ai",
      perceptionMode: "auto",
    },
  );
});

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

test("task completion accepts the raw runtime envelope", () => {
  const event = {
    type: "TASK_COMPLETION",
    payload: { status: "completed", summary: "Done" },
  };
  const outcome = extractModelBenchOutcome([event]);
  assert.equal(outcome?.kind, "completion");
  assert.equal(outcome?.event, event);
});

test("recovers a missed terminal event from durable chat completion data", () => {
  const outcome = extractStoredModelBenchOutcome(
    [
      { role: "user", content: "Question" },
      {
        role: "assistant",
        timestamp: 123,
        completionData: {
          status: "completed",
          summary: "Operations Review 2025",
        },
      },
    ],
    "workspace-1",
  );

  assert.equal(outcome?.kind, "completion");
  assert.equal(outcome?.event?.workspaceId, "workspace-1");
  assert.equal(outcome?.event?.payload?.summary, "Operations Review 2025");
});

test("does not use an idle status in place of the persisted completion answer", () => {
  const outcome = extractModelBenchOutcome([
    {
      type: "AGENT_STATUS",
      status: "IDLE",
      completionStatus: "completed",
      detail: "Task complete",
    },
  ]);
  assert.equal(outcome, null);
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

test("classifies an unrecovered content bridge disconnect as harness failure", () => {
  const outcome = extractModelBenchOutcome([
    {
      type: "TASK_COMPLETION",
      status: "partial",
      payload: {
        summary:
          "The run stopped because the content script disconnected and reinjection failed.",
      },
    },
  ]);
  assert.match(outcome ? harnessFailureReason(outcome) ?? "" : "", /disconnected/);
});

test("does not discard a completed task that recovered from a bridge disconnect", () => {
  const outcome = extractModelBenchOutcome([
    {
      type: "TASK_COMPLETION",
      status: "completed",
      payload: {
        summary: "Recovered after content script disconnected; task completed.",
      },
    },
  ]);
  assert.equal(outcome && harnessFailureReason(outcome), undefined);
});
