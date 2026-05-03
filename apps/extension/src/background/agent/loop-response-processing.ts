import { AgentStatus, type AgentStep, type SessionMetrics } from "../../types";
import type { logger } from "../../utils";
import type { CompletionResponse } from "../llm/types";
import type { BroadcastMessage } from "./agent-broadcast";
import type { ContextManager } from "./context";
import { STRING_LIMITS } from "./constants";
import type { LoopResult } from "./loop-types";
import {
  buildLlmResponseLogPayload,
  isEmptyCompletionResponse,
  normalizeResponseContent,
  recoverResponseToolCallsFromText,
  type NormalizedResponseContent,
} from "./response-normalization";
import type { TraceRecorder } from "./trace";

type LlmResponseProcessingLogger = Pick<
  typeof logger,
  "debug" | "error" | "info"
>;

type LlmResponseProcessingContext = Pick<
  ContextManager,
  "addMessage" | "getCurrentUrl" | "getIsFirstTurn" | "setFirstTurnDone"
>;

export type LlmTurnResponseProcessingDeps = {
  response: CompletionResponse;
  llmMs: number;
  turnCount: number;
  thinkingStep: AgentStep;
  context: LlmResponseProcessingContext;
  traceRecorder: TraceRecorder | null;
  log: LlmResponseProcessingLogger;
  recordUsage: (response: CompletionResponse, llmMs: number) => void;
  broadcastMetrics: () => void;
  broadcast: (message: BroadcastMessage) => void;
  finishStream: () => void;
  statusHandler: (status: AgentStatus, message: string) => void;
  stepHandler: (step: AgentStep, replace: boolean) => void;
  getMetrics: () => SessionMetrics;
  now?: () => number;
};

export type LlmTurnResponseProcessingResult =
  | {
      kind: "response";
      normalizedContent: NormalizedResponseContent;
      rawContent: string | null;
      cleanContent: string | null;
      toolsRecoveredFromText: boolean;
      llmIntention: string | null;
    }
  | {
      kind: "early_result";
      result: LoopResult;
    };

export async function processLlmTurnResponse(
  deps: LlmTurnResponseProcessingDeps,
): Promise<LlmTurnResponseProcessingResult> {
  const now = deps.now ?? Date.now;

  // Accumulate token usage and broadcast metrics.
  deps.recordUsage(deps.response, deps.llmMs);
  deps.broadcastMetrics();

  deps.traceRecorder?.recordLLMResponse(
    deps.response.content,
    deps.response.tool_calls || [],
    deps.response.finish_reason,
    deps.response.usage ?? null,
    deps.llmMs,
    deps.response.actualProviderId,
    deps.response.actualModel,
  );

  const normalizedContent = normalizeResponseContent(deps.response);
  const rawContent = normalizedContent.rawContent;
  let cleanContent = normalizedContent.cleanContent;

  if (isEmptyCompletionResponse(deps.response)) {
    deps.log.error("agent", "Empty response after retries exhausted", {
      turn: deps.turnCount,
    });
    deps.traceRecorder?.recordEvent("empty_response_circuit_breaker", {
      turn: deps.turnCount,
    });
    const errorMsg = "AI provider returned an empty response. Try again.";
    deps.broadcast({
      type: "STREAM_CHUNK",
      payload: { delta: errorMsg, done: false },
    });
    deps.finishStream();
    deps.statusHandler(AgentStatus.ERROR, "Empty response from provider");
    await deps.traceRecorder?.endTurn();
    return {
      kind: "early_result",
      result: {
        outcome: "error" as const,
        turnCount: deps.turnCount,
        summary: "AI provider returned an empty response",
        failure: {
          category: "provider" as const,
          code: "empty_response",
          detail: `Turn ${deps.turnCount}: no content and no tool_calls after retry loop`,
        },
        metrics: deps.getMetrics(),
      },
    };
  }

  if (normalizedContent.thinkingContent) {
    deps.broadcast({
      type: "STREAM_CHUNK",
      payload: {
        delta: "",
        done: false,
        thinking: normalizedContent.thinkingContent,
      },
    });
  }

  deps.log.info(
    "agent",
    "LLM response",
    buildLlmResponseLogPayload({
      turn: deps.turnCount,
      llmMs: deps.llmMs,
      url: deps.context.getCurrentUrl(),
      cleanContent,
      toolCalls: deps.response.tool_calls,
      maxReasoningChars: STRING_LIMITS.REASONING_LOG,
      maxArgumentChars: STRING_LIMITS.TOOL_CALL_SNIPPET,
    }),
  );

  if (cleanContent) {
    deps.log.debug("agent", "LLM reasoning (full)", {
      turn: deps.turnCount,
      text: cleanContent,
    });
  }

  if (deps.context.getIsFirstTurn()) {
    deps.context.setFirstTurnDone();
  }

  let toolsRecoveredFromText = false;
  const recovery = recoverResponseToolCallsFromText(
    deps.response,
    cleanContent,
  );
  if (recovery.recovered) {
    deps.log.info("agent", "Recovered tool calls from text", {
      turn: deps.turnCount,
      count: recovery.recoveredToolCalls.length,
      tools: recovery.recoveredToolCalls.map((tc) => tc.function.name),
    });
    toolsRecoveredFromText = true;
    cleanContent = recovery.cleanContent;
    deps.broadcast({
      type: "STREAM_CHUNK",
      payload: { delta: "", done: false, replaceContent: "" },
    });
  }

  const llmIntention =
    cleanContent?.slice(0, STRING_LIMITS.REASONING_LOG) || null;

  if (!deps.response.tool_calls || deps.response.tool_calls.length === 0) {
    deps.context.addMessage({
      role: "assistant",
      content: deps.response.content,
    });
  }

  deps.stepHandler(
    {
      ...deps.thinkingStep,
      status: "done",
      durationMs: now() - deps.thinkingStep.timestamp,
    },
    true,
  );

  return {
    kind: "response",
    normalizedContent,
    rawContent,
    cleanContent,
    toolsRecoveredFromText,
    llmIntention,
  };
}
