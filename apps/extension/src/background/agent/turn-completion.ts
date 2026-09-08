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
  recordPromptImageUsage?: (messages: LLMMessage[]) => void;
  sessionAffinityId?: string;
  multiTurnSessionId?: string;
  sleep?: (ms: number) => Promise<void>;
  /** Maximum wall time for one provider request, including streaming. */
  requestTimeoutMs?: number;
  /** Maximum cumulative provider time across retries for one agent turn. */
  turnTimeoutMs?: number;
  /** Minimum remaining turn budget required before starting a retry. */
  minRetryBudgetMs?: number;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export const EXECUTOR_REQUEST_TIMEOUT_MS = 120_000;
export const EXECUTOR_TURN_TIMEOUT_MS = 180_000;
export const EXECUTOR_MIN_RETRY_BUDGET_MS = 30_000;

export async function completeTurnWithRetries(
  deps: TurnCompletionDeps,
): Promise<TurnCompletionResult> {
  const sleep = deps.sleep ?? defaultSleep;
  const llmStart = Date.now();
  let messages = deps.messages;
  let response: CompletionResponse;
  let turnRetryCount = 0;
  let synthesizedFromHallucination = false;
  const requestTimeoutMs = Math.max(
    1,
    deps.requestTimeoutMs ?? EXECUTOR_REQUEST_TIMEOUT_MS,
  );
  const turnTimeoutMs = Math.max(
    requestTimeoutMs,
    deps.turnTimeoutMs ?? EXECUTOR_TURN_TIMEOUT_MS,
  );
  const minRetryBudgetMs = Math.max(
    0,
    deps.minRetryBudgetMs ?? EXECUTOR_MIN_RETRY_BUDGET_MS,
  );
  const remainingTurnBudgetMs = () =>
    Math.max(0, turnTimeoutMs - (Date.now() - llmStart));
  const hasRetryBudget = () => remainingTurnBudgetMs() >= minRetryBudgetMs;

  // eslint-disable-next-line no-constant-condition
  retryLoop: while (true) {
    let streamedTextAccumulator = "";
    let hallucinationDetected = false;

    const turnAbortController = new AbortController();
    const onMainAbort = () => turnAbortController.abort();
    let listenerAttached = true;
    deps.mainAbortSignal.addEventListener("abort", onMainAbort);
    if (deps.mainAbortSignal.aborted) turnAbortController.abort();
    let requestTimedOut = false;
    const attemptTimeoutMs = Math.max(
      1,
      Math.min(requestTimeoutMs, remainingTurnBudgetMs()),
    );
    let requestTimeoutId: ReturnType<typeof setTimeout>;
    const requestTimeout = new Promise<never>((_resolve, reject) => {
      requestTimeoutId = setTimeout(() => {
        requestTimedOut = true;
        turnAbortController.abort();
        reject(
          new Error(`LLM provider request timed out after ${attemptTimeoutMs}ms`),
        );
      }, attemptTimeoutMs);
    });
    const cleanupAttempt = () => {
      clearTimeout(requestTimeoutId);
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
      response = await Promise.race([
        deps.llm.completeStream(
          {
            messages,
            tools: deps.tools,
            max_tokens: deps.maxTokens,
            stop: ["Observation:"],
            signal: turnAbortController.signal,
            sessionAffinityId: deps.sessionAffinityId,
            multiTurnSessionId: deps.multiTurnSessionId,
          },
          onTextDelta,
        ),
        requestTimeout,
      ]);
      cleanupAttempt();

      if (isEmptyCompletionResponse(response)) {
        const switchedToFallback =
          hasRetryBudget() &&
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
          if (backoff > 0) await sleep(backoff);
          continue retryLoop;
        }

        if (
          turnRetryCount < MAX_TURN_RETRIES &&
          RETRYABLE_ERRORS.has("empty_response") &&
          hasRetryBudget()
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
          if (backoff > 0) await sleep(backoff);
          continue retryLoop;
        }
      }

      deps.llm.resetExecutorFallback();
      break;
    } catch (llmError: unknown) {
      cleanupAttempt();
      const effectiveError = requestTimedOut
        ? Object.assign(
            new Error(
              `LLM provider request timed out after ${attemptTimeoutMs}ms`,
            ),
            { name: "ExecutorRequestTimeoutError" },
          )
        : llmError;
      const errorClass = classifyTurnError(llmError, hallucinationDetected);
      const errorLabel = requestTimedOut ? "timeout" : errorClass;

      if (requestTimedOut) {
        deps.traceRecorder?.recordEvent("llm_call_timeout", {
          turn: deps.turnCount,
          retry: turnRetryCount,
          timeoutMs: attemptTimeoutMs,
          remainingTurnBudgetMs: remainingTurnBudgetMs(),
          model: deps.llm.getCurrentModel(),
        });
      }

      if (
        errorClass === "user_abort" &&
        !requestTimedOut &&
        !hallucinationDetected
      ) {
        throw effectiveError;
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
        (requestTimedOut || RETRYABLE_ERRORS.has(errorClass)) &&
        hasRetryBudget()
      ) {
        turnRetryCount++;
        deps.log.warn("agent", `Turn error (${errorLabel}), retrying`, {
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
          errorClass: errorLabel,
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

      throw effectiveError;
    } finally {
      cleanupAttempt();
    }
  }

  if (turnRetryCount > 0) {
    messages = removeTurnRetryDiagnosticMessages(messages);
  }
  // Session image metrics intentionally summarize the final completed turn,
  // not each retry attempt. Provider-reported token totals follow the same path.
  deps.recordPromptImageUsage?.(messages);

  return {
    kind: "response",
    response,
    messages,
    llmMs: Date.now() - llmStart,
    retryCount: turnRetryCount,
    synthesizedFromHallucination,
  };
}
