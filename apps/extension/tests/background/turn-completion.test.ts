import { describe, expect, test, vi } from "vitest";
import {
  AgentStatus,
  type SessionMetrics,
  type ToolDefinition,
} from "../../src/types";
import {
  completeTurnWithRetries,
  type TurnCompletionDeps,
} from "../../src/background/agent/turn-completion";
import type { BroadcastMessage } from "../../src/background/agent/agent-broadcast";
import type { LLMClient } from "../../src/background/llm";
import type {
  CompletionResponse,
  LLMMessage,
} from "../../src/background/llm/types";

const messages: LLMMessage[] = [{ role: "user", content: "Do it" }];
const tools: ToolDefinition[] = [];

function makeResponse(content: string | null): CompletionResponse {
  return {
    role: "assistant",
    content,
    finish_reason: "stop",
  };
}

function makeLlm(
  responses: Array<CompletionResponse | Error | { status: number }>,
): LLMClient {
  let index = 0;
  return {
    completeStream: vi.fn(async (_request, onTextDelta) => {
      const response = responses[index++];
      if (response instanceof Error || "status" in response) {
        throw response;
      }
      if (response.content) onTextDelta(response.content);
      return response;
    }),
    isPlannerTier: vi.fn(() => false),
    activateExecutorFallback: vi.fn(() => false),
    resetExecutorFallback: vi.fn(),
    getCurrentModel: vi.fn(() => "executor-model"),
    getActiveProviderInfo: vi.fn(() => ({
      providerId: "openrouter",
      model: "executor-model",
    })),
  } as unknown as LLMClient;
}

function makeDeps(
  overrides: Partial<TurnCompletionDeps> = {},
): TurnCompletionDeps & {
  broadcasts: BroadcastMessage[];
  steps: unknown[];
  statuses: Array<{ status: AgentStatus; message: string }>;
  events: Array<{ name: string; data: Record<string, unknown> }>;
} {
  const broadcasts: BroadcastMessage[] = [];
  const steps: unknown[] = [];
  const statuses: Array<{ status: AgentStatus; message: string }> = [];
  const events: Array<{ name: string; data: Record<string, unknown> }> = [];

  return {
    llm: makeLlm([makeResponse("done")]),
    messages,
    tools,
    maxTokens: 1000,
    turnCount: 1,
    mainAbortSignal: new AbortController().signal,
    log: { warn: vi.fn() },
    traceRecorder: {
      recordEvent: (name: string, data: Record<string, unknown>) => {
        events.push({ name, data });
      },
    } as unknown as TurnCompletionDeps["traceRecorder"],
    broadcast: (message) => broadcasts.push(message),
    stepHandler: (step) => steps.push(step),
    finishStream: vi.fn(),
    statusHandler: (status, message) => statuses.push({ status, message }),
    getMetrics: () => ({ turns: 1 }) as SessionMetrics,
    invalidatePerceptionCache: vi.fn(),
    sleep: vi.fn(async () => undefined),
    broadcasts,
    steps,
    statuses,
    events,
    ...overrides,
  };
}

describe("completeTurnWithRetries", () => {
  test("returns a successful streamed response", async () => {
    const recordPromptImageUsage = vi.fn();
    const deps = makeDeps({
      llm: makeLlm([makeResponse("done")]),
      recordPromptImageUsage,
    });

    const result = await completeTurnWithRetries(deps);

    expect(result.kind).toBe("response");
    if (result.kind !== "response") return;
    expect(result.response.content).toBe("done");
    expect(result.retryCount).toBe(0);
    expect(recordPromptImageUsage).toHaveBeenCalledTimes(1);
    expect(recordPromptImageUsage).toHaveBeenCalledWith(messages);
    expect(deps.broadcasts).toEqual([
      { type: "STREAM_CHUNK", payload: { delta: "done", done: false } },
    ]);
  });

  test("retries empty responses and removes retry diagnostics", async () => {
    const recordPromptImageUsage = vi.fn();
    const deps = makeDeps({
      llm: makeLlm([makeResponse(null), makeResponse("after retry")]),
      recordPromptImageUsage,
    });

    const result = await completeTurnWithRetries(deps);

    expect(deps.llm.completeStream).toHaveBeenCalledTimes(2);
    expect(deps.steps).toHaveLength(1);
    expect(deps.events.map((event) => event.name)).toContain("turn_retry");
    expect(result.kind).toBe("response");
    if (result.kind !== "response") return;
    expect(result.response.content).toBe("after retry");
    expect(result.messages).toEqual(messages);
    expect(recordPromptImageUsage).toHaveBeenCalledTimes(1);
    expect(recordPromptImageUsage).toHaveBeenCalledWith(messages);
  });

  test("returns an early error result for exhausted provider credits", async () => {
    const deps = makeDeps({
      llm: makeLlm([{ status: 402 }]),
    });

    const result = await completeTurnWithRetries(deps);

    expect(result.kind).toBe("early_result");
    if (result.kind !== "early_result") return;
    expect(result.result.outcome).toBe("error");
    expect(result.result.failure?.code).toBe("credits_exhausted");
    expect(deps.statuses).toEqual([
      { status: AgentStatus.ERROR, message: "Insufficient credits" },
    ]);
  });
});
