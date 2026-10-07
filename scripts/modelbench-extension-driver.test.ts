import assert from "node:assert/strict";
import test from "node:test";
import {
  extractModelBenchOutcome,
  extractStoredModelBenchOutcome,
  harnessFailureReason,
  missingExecutorEvidenceReason,
  modelBenchSettingsPatch,
  observedTabOpeningAction,
  initializeModelBenchWorkspace,
  providerFailureReason,
  waitForOutcome,
  installModelBenchOutcomeObserver,
  readModelBenchOutcomeEvents,
} from "./modelbench-extension-driver.js";

test("runtime completion observer retains only background control messages and resets the requested workspace", () => {
  const scope = globalThis as any;
  const previous = scope.chrome;
  let listener: ((message: unknown) => void) | undefined;
  let subscriptions = 0;
  scope.chrome = { runtime: { onMessage: { addListener: (callback: typeof listener) => { listener = callback; subscriptions++; } } } };
  try {
    installModelBenchOutcomeObserver("one");
    const completion = { type: "TASK_COMPLETION", source: "background", workspaceId: "one", payload: { status: "completed", summary: "Result" } };
    listener!({ ...completion, source: "content" });
    listener!({ ...completion, type: "STREAM_CHUNK" });
    listener!(completion);
    listener!({ ...completion, workspaceId: "two" });
    assert.deepEqual(readModelBenchOutcomeEvents().map((event) => event.workspaceId), ["one", "two"]);
    installModelBenchOutcomeObserver("one");
    assert.equal(subscriptions, 1);
    assert.deepEqual(readModelBenchOutcomeEvents().map((event) => event.workspaceId), ["two"]);
  } finally {
    scope.chrome = previous;
    delete scope.__modelBenchOutcomeEvents;
    delete scope.__modelBenchOutcomeObserverInstalled;
  }
});

test("wire completion is observed without a working service-worker hook or persisted chat", async () => {
  const completion = { type: "TASK_COMPLETION", workspaceId: "workspace", payload: { status: "completed", summary: "Result" } };
  const worker = { evaluate: async () => { throw new Error("Worker detached"); } };
  const page = { evaluate: async () => [completion] };
  const outcome = await waitForOutcome(worker as never, "workspace", 0, page as never);
  assert.equal(outcome.kind, "completion");
  assert.equal(outcome.event?.payload.summary, "Result");
});

test("the final outcome poll recognizes completion even before chat persistence", async () => {
  const completion = { type: "TASK_COMPLETION", workspaceId: "workspace", payload: { status: "completed", summary: "Result" } };
  let reads = 0;
  const worker = { evaluate: async () => { reads++; return [completion]; } };
  const outcome = await waitForOutcome(worker as never, "workspace", 0);
  assert.equal(outcome.kind, "completion");
  assert.equal(reads, 1);
});

test("storage observation failures propagate instead of becoming model timeouts", async () => {
  let reads = 0;
  const worker = { evaluate: async () => {
    if (++reads === 1) return [];
    throw new Error("Execution context was destroyed");
  } };
  await assert.rejects(waitForOutcome(worker as never, "workspace", 0), /Execution context was destroyed/);
});

test("workspace setup uses the real panel-open handler and rejects tracking-only workspaces", async () => {
  const previous = globalThis.chrome;
  let groupId = -1;
  let createGroup = true;
  let markers: number[] = [99];
  const messages: unknown[] = [];
  globalThis.chrome = {
    tabs: { get: async () => ({ id: 7, windowId: 3, groupId }) },
    tabGroups: { TAB_GROUP_ID_NONE: -1 },
    storage: { session: {
      get: async () => ({ userOpenedPanel: markers }),
      set: async (value: { userOpenedPanel: number[] }) => { markers = value.userOpenedPanel; },
    } },
    runtime: { sendMessage: async (message: unknown) => {
      messages.push(message);
      if (createGroup) groupId = 42;
      return { workspaceId: "real-workspace" };
    } },
  } as unknown as typeof chrome;
  try {
    assert.equal(await initializeModelBenchWorkspace(7), "real-workspace");
    assert.deepEqual(markers, [99, 7]);
    assert.equal((messages[0] as { type: string }).type, "SIDE_PANEL_OPENED");
    createGroup = false;
    groupId = -1;
    await assert.rejects(initializeModelBenchWorkspace(7), /real grouped workspace/);
  } finally {
    globalThis.chrome = previous;
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

test("billing exhaustion is a provider failure, not a model failure", () => {
  // Scored as valid_model_failure before this, so a drained account read as the
  // model getting 13 straight answers wrong. It silently poisons pass@1.
  const outcome = {
    kind: "completion" as const,
    events: [],
    event: {
      type: "TASK_COMPLETION",
      status: "failed",
      payload: {
        summary:
          "Insufficient OpenRouter credits (class=unknown; retriesUsed=1; maxRetries=1; source=executor)",
      },
    },
  };
  assert.match(
    providerFailureReason(outcome) ?? "",
    /Insufficient OpenRouter credits/,
  );
  assert.equal(harnessFailureReason(outcome), undefined);
});

test("a genuine wrong answer is still a model failure", () => {
  const outcome = {
    kind: "completion" as const,
    events: [],
    event: {
      type: "TASK_COMPLETION",
      status: "completed",
      payload: { summary: "The inventory count is 214." },
    },
  };
  assert.equal(providerFailureReason(outcome), undefined);
});


test("a timeout before any observed executor work is inconclusive, not a model failure", () => {
  const evidence = {
    telemetry: { turns: 0 }, resolvedSeats: {}, usageByRole: {},
  } as Parameters<typeof missingExecutorEvidenceReason>[1];
  assert.match(missingExecutorEvidenceReason({ kind: "timeout", events: [] }, evidence)!, /cannot be attributed/);
  assert.match(missingExecutorEvidenceReason({ kind: "completion", events: [] }, evidence)!, /cannot be attributed/);
  assert.equal(missingExecutorEvidenceReason({ kind: "timeout", events: [] }, {
    ...evidence, telemetry: { ...evidence.telemetry, turns: 1 },
  }), undefined);
  assert.equal(missingExecutorEvidenceReason({ kind: "timeout", events: [] }, {
    ...evidence, usageByRole: { executor: { calls: 1 } as never },
  }), undefined);
});
