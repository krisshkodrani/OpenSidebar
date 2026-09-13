/**
 * prepare_model_turn phase (RFC LP-15, Phase 11).
 *
 * The first data-producing phase of a turn: build the LLM request, run the model
 * with retries, and process the response. It orchestrates the three already-
 * extracted turn helpers (prepareLlmTurnRequest → completeTurnWithRetries →
 * processLlmTurnResponse) with their two early-exit points, lifting ~90 lines of
 * dep assembly out of loop(). The host is a NARROW interface whose members are
 * all real AgentLoop fields/methods, so loop() passes `this` — the established
 * dispatch-host idiom.
 */

import { toolRegistry } from "../../tools";
import { LLM_CONFIG } from "../constants";
import { LLMClient } from "../../llm";
import { ContextManager } from "../context";
import { PageStateCoordinator, type ObservationBasis } from "../page-state";
import { TraceRecorder } from "../trace";
import type { TurnCarry } from "../turn-carry";
import { logger, SessionScopedLogger } from "../../../utils";
import type { AgentStep } from "../../../types";
import type { LoopResult } from "../loop-types";
import {
  prepareLlmTurnRequest,
  type LlmTurnPreparationDeps,
} from "../loop-turn-preparation";
import {
  completeTurnWithRetries,
  type TurnCompletionDeps,
  type TurnCompletionResult,
} from "../turn-completion";
import {
  processLlmTurnResponse,
  type LlmTurnResponseProcessingDeps,
  type LlmTurnResponseProcessingResult,
} from "../loop-response-processing";

type ToolDefs = LlmTurnPreparationDeps["allTools"];
type TurnCompletionResponse = Extract<TurnCompletionResult, { kind: "response" }>;
type ProcessedResponse = Extract<
  LlmTurnResponseProcessingResult,
  { kind: "response" }
>;

/** Narrow host for the prepare phase — every member is a real AgentLoop field/method. */
export interface PrepareModelTurnHost {
  readonly turnCount: number;
  readonly context: ContextManager;
  readonly llm: LLMClient;
  readonly perception: PageStateCoordinator;
  readonly log: typeof logger | SessionScopedLogger;
  readonly traceRecorder: TraceRecorder | null;
  readonly abortController: AbortController | null;
  readonly disabledTools: Parameters<typeof toolRegistry.getDefinitions>[0];
  readonly taskId: string | null;
  readonly runId: string | null;
  readonly telemetry: { readonly turnCarry: TurnCarry };
  activeToolNamesForTurn: string[];
  modelTurnObservationBasis: ObservationBasis | null;
  applyToolProfile(tools: ToolDefs): ToolDefs;
  applySkillToolSuppression(tools: ToolDefs): ToolDefs;
  applySkillToolRanking(tools: ToolDefs): ToolDefs;
  broadcast: TurnCompletionDeps["broadcast"];
  stepHandler: TurnCompletionDeps["stepHandler"];
  finishStream: TurnCompletionDeps["finishStream"];
  statusHandler: TurnCompletionDeps["statusHandler"];
  getMetrics: TurnCompletionDeps["getMetrics"];
  recordPromptImageUsage: NonNullable<TurnCompletionDeps["recordPromptImageUsage"]>;
  recordUsage: LlmTurnResponseProcessingDeps["recordUsage"];
  broadcastMetrics: LlmTurnResponseProcessingDeps["broadcastMetrics"];
}

export interface PreparedModelTurn {
  messages: TurnCompletionResponse["messages"];
  tools: ToolDefs;
  previousElementCount: number;
  response: TurnCompletionResponse["response"];
  hallucinationDetected: boolean;
  normalizedContent: ProcessedResponse["normalizedContent"];
  rawContent: ProcessedResponse["rawContent"];
  cleanContent: ProcessedResponse["cleanContent"];
  toolsRecoveredFromText: ProcessedResponse["toolsRecoveredFromText"];
  llmIntention: ProcessedResponse["llmIntention"];
}

export type PrepareModelTurnResult =
  | { kind: "end_task"; result: LoopResult }
  | { kind: "continue"; prepared: PreparedModelTurn };

/**
 * Run the prepare_model_turn phase. `previousElementCount` is the running
 * element count carried across turns; the phase returns its updated value.
 */
export async function runPrepareModelTurnPhase(
  host: PrepareModelTurnHost,
  previousElementCount: number,
): Promise<PrepareModelTurnResult> {
  host.modelTurnObservationBasis =
    host.perception.getCurrentObservation()?.basis ?? null;
  const allTools = toolRegistry.getDefinitions(host.disabledTools);
  const preparation = await prepareLlmTurnRequest({
    turnCount: host.turnCount,
    previousElementCount,
    context: host.context,
    allTools,
    // Apply plan/DOM filtering first, then skill-based ranking within the survivors.
    selectTools: (definitions) => {
      const selected = host.applySkillToolRanking(
        host.applySkillToolSuppression(host.applyToolProfile(definitions)),
      );
      host.activeToolNamesForTurn = selected.map(
        (definition) => definition.function.name,
      );
      return selected;
    },
    llm: host.llm,
    perception: host.perception,
    log: host.log,
    traceRecorder: host.traceRecorder,
    previousSnapshotForDelta: host.telemetry.turnCarry.previousSnapshotForDelta,
    previousPromptFingerprint: host.telemetry.turnCarry.previousPromptFingerprint,
  });
  host.telemetry.turnCarry.previousSnapshotForDelta = host.context.getSnapshot();
  host.telemetry.turnCarry.previousPromptFingerprint = preparation.promptFingerprint;

  const thinkingStep: AgentStep = {
    id: crypto.randomUUID(),
    type: "thinking",
    label: host.turnCount === 1 ? "Understanding request" : "Thinking...",
    status: "running",
    timestamp: Date.now(),
  };
  host.stepHandler(thinkingStep, false);

  const turnCompletion = await completeTurnWithRetries({
    llm: host.llm,
    messages: preparation.messages,
    tools: preparation.tools,
    maxTokens: LLM_CONFIG.MAX_TOKENS,
    turnCount: host.turnCount,
    mainAbortSignal: host.abortController!.signal,
    log: host.log,
    traceRecorder: host.traceRecorder,
    broadcast: (message) => host.broadcast(message),
    stepHandler: (step, replace) => host.stepHandler(step, replace),
    finishStream: () => host.finishStream(),
    statusHandler: (status, message) => host.statusHandler(status, message),
    getMetrics: () => host.getMetrics(),
    invalidatePerceptionCache: () => host.perception.invalidateCache(),
    recordPromptImageUsage: (promptMessages) =>
      host.recordPromptImageUsage(promptMessages),
    sessionAffinityId:
      host.taskId ?? host.runId ?? host.traceRecorder?.sessionId ?? undefined,
    multiTurnSessionId: host.traceRecorder?.sessionId ?? undefined,
  });
  if (turnCompletion.kind === "early_result") {
    return { kind: "end_task", result: turnCompletion.result };
  }

  const processed = await processLlmTurnResponse({
    response: turnCompletion.response,
    llmMs: turnCompletion.llmMs,
    turnCount: host.turnCount,
    thinkingStep,
    context: host.context,
    traceRecorder: host.traceRecorder,
    log: host.log,
    recordUsage: (completion, durationMs) =>
      host.recordUsage(completion, durationMs),
    broadcastMetrics: () => host.broadcastMetrics(),
    broadcast: (message) => host.broadcast(message),
    finishStream: () => host.finishStream(),
    statusHandler: (status, message) => host.statusHandler(status, message),
    stepHandler: (step, replace) => host.stepHandler(step, replace),
    getMetrics: () => host.getMetrics(),
  });
  if (processed.kind === "early_result") {
    return { kind: "end_task", result: processed.result };
  }

  return {
    kind: "continue",
    prepared: {
      messages: turnCompletion.messages,
      tools: preparation.tools,
      previousElementCount: preparation.previousElementCount,
      response: turnCompletion.response,
      hallucinationDetected: turnCompletion.synthesizedFromHallucination,
      normalizedContent: processed.normalizedContent,
      rawContent: processed.rawContent,
      cleanContent: processed.cleanContent,
      toolsRecoveredFromText: processed.toolsRecoveredFromText,
      llmIntention: processed.llmIntention,
    },
  };
}
