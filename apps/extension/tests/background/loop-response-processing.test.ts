import { describe, expect, test, vi } from "vitest";
import {
  AgentStatus,
  type AgentStep,
  type SessionMetrics,
} from "../../src/types";
import {
  processLlmTurnResponse,
  type LlmTurnResponseProcessingDeps,
} from "../../src/background/agent/loop-response-processing";
import type { BroadcastMessage } from "../../src/background/agent/agent-broadcast";
import type { CompletionResponse } from "../../src/background/llm/types";

function makeResponse(content: string | null): CompletionResponse {
  return {
    role: "assistant",
    content,
    finish_reason: "stop",
  };
}

const thinkingStep: AgentStep = {
  id: "thinking-1",
  type: "thinking",
  label: "Thinking...",
  status: "running",
  timestamp: 100,
};

function makeDeps(
  overrides: Partial<LlmTurnResponseProcessingDeps> = {},
): LlmTurnResponseProcessingDeps & {
  broadcasts: BroadcastMessage[];
  statuses: Array<{ status: AgentStatus; message: string }>;
  messages: unknown[];
} {
  const broadcasts: BroadcastMessage[] = [];
  const statuses: Array<{ status: AgentStatus; message: string }> = [];
  const messages: unknown[] = [];

  return {
    response: makeResponse("Visible answer"),
    llmMs: 25,
    turnCount: 3,
    thinkingStep,
    context: {
      getCurrentUrl: vi.fn(() => "https://example.test"),
      getIsFirstTurn: vi.fn(() => true),
      setFirstTurnDone: vi.fn(),
      addMessage: vi.fn((message) => messages.push(message)),
    } as never,
    traceRecorder: {
      recordLLMResponse: vi.fn(),
      recordEvent: vi.fn(),
      endTurn: vi.fn(async () => {}),
    } as never,
    log: {
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    },
    recordUsage: vi.fn(),
    broadcastMetrics: vi.fn(),
    broadcast: (message) => broadcasts.push(message),
    finishStream: vi.fn(),
    statusHandler: (status, message) => statuses.push({ status, message }),
    stepHandler: vi.fn(),
    getMetrics: () => ({ turns: 3 }) as SessionMetrics,
    now: () => 160,
    broadcasts,
    statuses,
    messages,
    ...overrides,
  };
}

describe("processLlmTurnResponse", () => {
  test("records usage, trace, thinking content, history, and completes thinking step", async () => {
    const response = makeResponse("<think>private</think>Visible answer");
    const deps = makeDeps({ response });

    const result = await processLlmTurnResponse(deps);

    expect(result.kind).toBe("response");
    if (result.kind !== "response") return;
    expect(result.cleanContent).toBe("Visible answer");
    expect(result.rawContent).toBe("<think>private</think>Visible answer");
    expect(deps.recordUsage).toHaveBeenCalledWith(response, 25);
    expect(deps.broadcastMetrics).toHaveBeenCalledTimes(1);
    expect(deps.traceRecorder?.recordLLMResponse).toHaveBeenCalledWith(
      response.content,
      [],
      "stop",
      null,
      25,
      undefined,
      undefined,
    );
    expect(deps.broadcasts).toContainEqual({
      type: "STREAM_CHUNK",
      payload: { delta: "", done: false, thinking: "private" },
    });
    expect(deps.context.setFirstTurnDone).toHaveBeenCalledTimes(1);
    expect(deps.messages).toEqual([
      { role: "assistant", content: response.content },
    ]);
    expect(deps.stepHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "thinking-1",
        status: "done",
        durationMs: 60,
      }),
      true,
    );
  });

  test("returns an early provider error for exhausted empty responses", async () => {
    const deps = makeDeps({ response: makeResponse(null) });

    const result = await processLlmTurnResponse(deps);

    expect(result.kind).toBe("early_result");
    if (result.kind !== "early_result") return;
    expect(result.result.outcome).toBe("error");
    expect(result.result.failure?.code).toBe("empty_response");
    expect(deps.broadcasts).toEqual([
      {
        type: "STREAM_CHUNK",
        payload: {
          delta: "AI provider returned an empty response. Try again.",
          done: false,
        },
      },
    ]);
    expect(deps.statuses).toEqual([
      { status: AgentStatus.ERROR, message: "Empty response from provider" },
    ]);
    expect(deps.traceRecorder?.recordEvent).toHaveBeenCalledWith(
      "empty_response_circuit_breaker",
      { turn: 3 },
    );
    expect(deps.traceRecorder?.endTurn).toHaveBeenCalledTimes(1);
    expect(deps.stepHandler).not.toHaveBeenCalled();
  });

  test("recovers tool calls from JSON text and defers assistant history", async () => {
    const response = makeResponse('{"function":"read_page","arguments":{}}');
    const deps = makeDeps({ response });

    const result = await processLlmTurnResponse(deps);

    expect(result.kind).toBe("response");
    if (result.kind !== "response") return;
    expect(result.toolsRecoveredFromText).toBe(true);
    expect(result.cleanContent).toBeNull();
    expect(response.content).toBeNull();
    expect(response.tool_calls?.[0].function.name).toBe("read_page");
    expect(deps.messages).toEqual([]);
    expect(deps.broadcasts).toEqual([
      {
        type: "STREAM_CHUNK",
        payload: { delta: "", done: false, replaceContent: "" },
      },
    ]);
  });
});
