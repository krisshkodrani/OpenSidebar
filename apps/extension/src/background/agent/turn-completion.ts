import {
  AgentStatus,
  type AgentStep,
  type SessionMetrics,
  type ToolDefinition,
} from "../../types";
import type { logger } from "../../utils";
import type { LLMClient } from "../llm";
import type { CompletionResponse, LLMMessage } from "../llm/types";
import type { BroadcastMessage } from "./agent-broadcast";
import {
  buildHallucinationRetryMessage,
  buildTurnRetryStep,
  getTurnRetryBackoffMs,
  removeTurnRetryDiagnosticMessages,
} from "./turn-retry";
import {
  classifyTurnError,
  isHallucinatedToolCall,
  MAX_TURN_RETRIES,
  RETRYABLE_ERRORS,
  TURN_RETRY_BACKOFF_MS,
} from "./loop-helpers";
import { isEmptyCompletionResponse } from "./response-normalization";
import { formatProviderName, getProviderCreditsUrl } from "./provider-display";
import type { LoopResult } from "./loop-types";
import type { TraceRecorder } from "./trace";

type TurnCompletionLogger = Pick<typeof logger, "warn">;

export type TurnCompletionResult =
  | {
      kind: "response";
      response: CompletionResponse;
      messages: LLMMessage[];
      llmMs: number;
      retryCount: number;
      synthesizedFromHallucination: boolean;
    }
  | {
      kind: "early_result";
      result: LoopResult;
    };

export type TurnCompletionDeps = {
  llm: LLMClient;
  messages: LLMMessage[];
  tools: ToolDefinition[];
  maxTokens: number;
  turnCount: number;
  mainAbortSignal: AbortSignal;
  log: TurnCompletionLogger;
  traceRecorder: TraceRecorder | null;
  broadcast: (message: BroadcastMessage) => void;
  stepHandler: (step: AgentStep, replace: boolean) => void;
  finishStream: () => void;
  statusHandler: (status: AgentStatus, message: string) => void;
  getMetrics: () => SessionMetrics;
  invalidatePerceptionCache: () => void;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function completeTurnWithRetries(
  deps: TurnCompletionDeps,
): Promise<TurnCompletionResult> {
  const sleep = deps.sleep ?? defaultSleep;
  const llmStart = Date.now();
  let messages = deps.messages;
  let response: CompletionResponse;
  let turnRetryCount = 0;
  let synthesizedFromHallucination = false;

  // eslint-disable-next-line no-constant-condition
  retryLoop: while (true) {
    let streamedTextAccumulator = "";
    let hallucinationDetected = false;

    const turnAbortController = new AbortController();
    const onMainAbort = () => turnAbortController.abort();
    let listenerAttached = true;
    deps.mainAbortSignal.addEventListener("abort", onMainAbort);
    const cleanupAbortListener = () => {
      if (!listenerAttached) return;
      deps.mainAbortSignal.removeEventListener("abort", onMainAbort);
      listenerAttached = false;
    };

    const onTextDelta = (delta: string) => {
      deps.broadcast({
        type: "STREAM_CHUNK",
        payload: { delta, done: false },
      });
      streamedTextAccumulator += delta;
      if (
        !hallucinationDetected &&
        streamedTextAccumulator.length > 150 &&
        isHallucinatedToolCall(streamedTextAccumulator)
      ) {
        hallucinationDetected = true;
        deps.log.warn(
          "agent",
          "Hallucinated tool call detected, aborting stream",
          {
            turn: deps.turnCount,
            textLen: streamedTextAccumulator.length,
          },
        );
        turnAbortController.abort();
      }
    };

    try {
      response = await deps.llm.completeStream(
        {
          messages,
          tools: deps.tools,
          max_tokens: deps.maxTokens,
          stop: ["Observation:"],
          signal: turnAbortController.signal,
        },
        onTextDelta,
      );

      if (isEmptyCompletionResponse(response)) {
        const switchedToFallback =
          !deps.llm.isPlannerTier() &&
          deps.llm.activateExecutorFallback("empty_response");
        if (switchedToFallback) {
          turnRetryCount++;
          deps.log.warn(
            "agent",
            "Empty LLM response, switching to executor fallback model",
            {
              turn: deps.turnCount,
              retry: turnRetryCount,
              fallbackModel: deps.llm.getCurrentModel(),
            },
          );
          deps.broadcast({
            type: "STREAM_CHUNK",
            payload: { delta: "", done: false, replaceContent: "" },
          });
          deps.stepHandler(
            buildTurnRetryStep({
              retryCount: turnRetryCount,
              maxRetries: MAX_TURN_RETRIES,
              fallbackModel: deps.llm.getCurrentModel(),
            }),
            false,
          );
          deps.traceRecorder?.recordEvent("executor_empty_response_fallback", {
            turn: deps.turnCount,
            retry: turnRetryCount,
            model: deps.llm.getCurrentModel(),
          });
          const backoff = getTurnRetryBackoffMs(
            turnRetryCount,
            TURN_RETRY_BACKOFF_MS,
          );
          cleanupAbortListener();
          if (backoff > 0) await sleep(backoff);
          continue retryLoop;
        }

        if (
          turnRetryCount < MAX_TURN_RETRIES &&
          RETRYABLE_ERRORS.has("empty_response")
        ) {
          turnRetryCount++;
          deps.log.warn("agent", "Empty LLM response, retrying", {
            turn: deps.turnCount,
            retry: turnRetryCount,
          });
          deps.broadcast({
            type: "STREAM_CHUNK",
            payload: { delta: "", done: false, replaceContent: "" },
          });
          deps.stepHandler(
            buildTurnRetryStep({
              retryCount: turnRetryCount,
              maxRetries: MAX_TURN_RETRIES,
            }),
            false,
          );
          deps.traceRecorder?.recordEvent("turn_retry", {
            turn: deps.turnCount,
            retry: turnRetryCount,
            errorClass: "empty_response",
          });
          const backoff = getTurnRetryBackoffMs(
            turnRetryCount,
            TURN_RETRY_BACKOFF_MS,
          );
          cleanupAbortListener();
          if (backoff > 0) await sleep(backoff);
          continue retryLoop;
        }
      }

      cleanupAbortListener();
      deps.llm.resetExecutorFallback();
      break;
    } catch (llmError: unknown) {
      cleanupAbortListener();
      const errorClass = classifyTurnError(llmError, hallucinationDetected);

      if (errorClass === "user_abort" && !hallucinationDetected) {
        throw llmError;
      }

      if (errorClass === "credits_exhausted") {
        const providerId = deps.llm.getActiveProviderInfo().providerId;
        const providerName = formatProviderName(providerId);
        const creditsUrl = getProviderCreditsUrl(providerId);
        const msg =
          `Your ${providerName} account has insufficient credits.` +
          (creditsUrl
            ? ` Please add credits at ${creditsUrl} and try again.`
            : "");
        deps.broadcast({
          type: "STREAM_CHUNK",
          payload: { delta: msg, done: false },
        });
        deps.finishStream();
        deps.statusHandler(AgentStatus.ERROR, "Insufficient credits");
        return {
          kind: "early_result",
          result: {
            outcome: "error",
            turnCount: deps.turnCount,
            summary: `Insufficient ${providerName} credits`,
            failure: {
              category: "provider",
              code: "credits_exhausted",
              detail: `HTTP 402 from ${providerName}`,
            },
            metrics: deps.getMetrics(),
          },
        };
      }

      if (
        turnRetryCount < MAX_TURN_RETRIES &&
        RETRYABLE_ERRORS.has(errorClass)
      ) {
        turnRetryCount++;
        deps.log.warn("agent", `Turn error (${errorClass}), retrying`, {
          turn: deps.turnCount,
          retry: turnRetryCount,
        });
        deps.broadcast({
          type: "STREAM_CHUNK",
          payload: { delta: "", done: false, replaceContent: "" },
        });
        deps.stepHandler(
          buildTurnRetryStep({
            retryCount: turnRetryCount,
            maxRetries: MAX_TURN_RETRIES,
          }),
          false,
        );
        deps.traceRecorder?.recordEvent("turn_retry", {
          turn: deps.turnCount,
          retry: turnRetryCount,
          errorClass,
        });

        if (errorClass === "hallucination") {
          deps.traceRecorder?.recordEvent("hallucination_detected", {
            turn: deps.turnCount,
            textLen: streamedTextAccumulator.length,
          });
          messages = [...messages, buildHallucinationRetryMessage()];
        }

        deps.invalidatePerceptionCache();

        const backoff = getTurnRetryBackoffMs(
          turnRetryCount,
          TURN_RETRY_BACKOFF_MS,
        );
        if (backoff > 0) await sleep(backoff);
        continue retryLoop;
      }

      if (hallucinationDetected) {
        deps.traceRecorder?.recordEvent("hallucination_detected", {
          turn: deps.turnCount,
          textLen: streamedTextAccumulator.length,
        });
        deps.broadcast({
          type: "STREAM_CHUNK",
          payload: { delta: "", done: false, replaceContent: "" },
        });
        response = {
          role: "assistant",
          content: streamedTextAccumulator,
          tool_calls: undefined,
          finish_reason: "stop",
        };
        synthesizedFromHallucination = true;
        break;
      }

      throw llmError;
    } finally {
      cleanupAbortListener();
    }
  }

  if (turnRetryCount > 0) {
    messages = removeTurnRetryDiagnosticMessages(messages);
  }

  return {
    kind: "response",
    response,
    messages,
    llmMs: Date.now() - llmStart,
    retryCount: turnRetryCount,
    synthesizedFromHallucination,
  };
}
