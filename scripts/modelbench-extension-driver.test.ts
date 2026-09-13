import assert from "node:assert/strict";
import test from "node:test";
import {
  extractModelBenchOutcome,
  extractStoredModelBenchOutcome,
  finalAnswer,
  harnessFailureReason,
  modelBenchSettingsPatch,
  observedTabOpeningAction,
  providerFailureReason,
  terminalInteractionEvidence,
} from "./modelbench-extension-driver.js";
import { MODEL_BENCH_CASES, scenarioEngine } from "@opensidebar/scenario-engine";

test("retains clarification evidence independently of trace files without unrelated event fields", () => {
  for (const nested of [false, true]) {
    const payload = { clarificationId: "question-1", question: "Which record should I update?", suggestions: ["First record", "Second record", 4], unrelated: "not evidence" };
    const outcome = extractModelBenchOutcome([{ type: "CLARIFICATION_REQUEST", ...(nested ? { payload } : payload) }]);
    assert.ok(outcome);
    assert.deepEqual(terminalInteractionEvidence(outcome), {
      type: "CLARIFICATION_REQUEST", status: "", clarificationId: "question-1",
      question: payload.question, suggestions: ["First record", "Second record"],
    });
  }
});

test("terminal evidence does not invent a question for an empty interaction", () => {
  const outcome = extractModelBenchOutcome([{ type: "CLARIFICATION_REQUEST", clarificationId: "question-1" }]);
  assert.ok(outcome);
  assert.equal(terminalInteractionEvidence(outcome)?.question, undefined);
});

test("only completed task summaries provide scoreable answers", () => {
  for (const status of ["failed", "partial", "stopped", "completed"]) {
    const outcome = extractModelBenchOutcome([{
      type: "TASK_COMPLETION",
      payload: { status, summary: "Aurora: $82" },
    }]);
    assert.ok(outcome);
    assert.equal(finalAnswer(outcome), status === "completed" ? "Aurora: $82" : undefined);
  }
});

test("verifier rejection quoting the expected answer cannot pass answer validation", () => {
  const definition = MODEL_BENCH_CASES.find(
    (candidate) => candidate.contract.id === "analytics.inspect-canvas-tooltip",
  )!;
  const initialState = scenarioEngine.initialize(definition.contract.id);
  for (const status of ["failed", "completed"]) {
    const outcome = extractStoredModelBenchOutcome([{
      completionData: {
        status,
        summary: status === "failed"
          ? "Verifier retry: The final answer 'Aurora: $82' is provided, but supporting evidence is absent."
          : "Aurora: $82",
      },
    }], "workspace-1");
    assert.ok(outcome);
    const validation = scenarioEngine.validate({
      definition, initialState, finalState: initialState,
      finalAnswer: finalAnswer(outcome),
    });
    assert.equal(validation.verdict, status === "completed" ? "pass" : "fail");
  }
});

test("error details and clarification questions are not final answers", () => {
  for (const event of [
    { type: "AGENT_STATUS", status: "ERROR", detail: "Expected Aurora: $82" },
    { type: "CLARIFICATION_REQUEST", clarificationId: "c1", summary: "Aurora: $82?" },
    { type: "TASK_COMPLETION", status: "completed", detail: "Aurora: $82" },
  ]) {
    const outcome = extractModelBenchOutcome([event]);
    assert.ok(outcome);
    assert.equal(finalAnswer(outcome), undefined);
  }
});

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
      strictModelRouting: true,
      useNitro: false,
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
