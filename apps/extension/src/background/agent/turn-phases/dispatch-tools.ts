/**
 * dispatch_tools phase (RFC LP-16 Phase 3, extending the LP-15 Phase 11 turn
 * machine).
 *
 * The ACTION path of a turn: when the model returned tool calls, prepare the
 * batch (blind-tool bookkeeping, list/detail rewrite, all-blocked retry), apply
 * the exploration hard-block, then dispatch — parallel when independent, else
 * sequential — and write the resulting DOM/element/escalation state back onto
 * the session/turn bags. Delegates the actual execution to the existing
 * parallel/sequential dispatchers; this phase is the orchestration + state
 * plumbing that used to live inline in loop(). Extracted via the dispatch-host
 * idiom (loop() passes `this`).
 *
 * Control results:
 *   - `end_task`  → the ServiceNow missing-field admission completed the task;
 *   - `next_turn` → all calls were blocked / all exploration-only (retry turn);
 *   - `continue`  → tools dispatched; proceed to post_tool_guards.
 */

import type { AgentStatus, ToolCall } from "../../../types";
import type { logger, SessionScopedLogger } from "../../../utils";
import type { ContextManager } from "../context";
import type { TraceRecorder } from "../trace";
import type { LoopResult } from "../loop-types";
import type { LoopSession, TurnScope } from "../loop-scope";
import type { EscalationTierController } from "../escalation-tier-controller";
import type { TurnState } from "../turn-state";
import type { BlockedAction } from "../loop-helpers";
import type { TrustedCompletionCandidate } from "../completion-kernel";
import type { PreparedModelTurn } from "./prepare-model-turn";
import type { ParallelToolExecutionResult } from "../parallel-tool-execution";
import { prepareToolCallBranch } from "../tool-call-branch-setup";
import {
  executeParallelToolCalls,
  type ParallelToolDispatchHost,
} from "../parallel-tool-dispatch";
import {
  executeSequentialToolCalls,
  type SequentialToolDispatchOutput,
  type SequentialToolDispatchHost,
} from "../sequential-tool-dispatch";
import { EXPLORATION_BUDGET, EXPLORATION_ONLY_TOOLS } from "../constants";

/** Repeat-action detection window handed to the dispatchers. */
const REPEAT_ACTION_WINDOW = 20;

export interface DispatchToolsHost {
  readonly turnCount: number;
  readonly traceRecorder: TraceRecorder | null;
  readonly context: ContextManager;
  readonly log: typeof logger | SessionScopedLogger;
  readonly evidenceAccumulator: { toArray(): LoopResult["evidence"] };
  readonly completedResult: {
    completionEnvelope?: LoopResult["completionEnvelope"];
  } | null;
  readonly escalationRescue: {
    noteEscalation(turn: number, trigger: string): void;
  };
  lastDomStep: unknown;
  throwIfGracefulStopRequested(): void;
  getServiceNowMissingFieldAdmissionSummary(text: string | null): string | null;
  getMetrics(): LoopResult["metrics"];
  statusHandler(status: AgentStatus, detail: string): void;
  rewriteListDetailWorkflowToolCall(
    toolCall: ToolCall,
    mode: "parallel" | "sequential",
  ): boolean;
  finalizeParallelToolResults(results: ParallelToolExecutionResult[]): void;
}

export interface DispatchToolsDeps {
  session: LoopSession;
  turn: TurnScope;
  esc: EscalationTierController;
  turnState: TurnState;
  verifiedFinalClickBypassKeys: Set<string>;
  blockedActions: BlockedAction[];
  signalCompletedResult: (
    summary: string,
    options?: {
      saveCheckpoint?: boolean;
      completionCandidate?: TrustedCompletionCandidate;
    },
  ) => void;
  response: PreparedModelTurn["response"];
  cleanContent: PreparedModelTurn["cleanContent"];
  toolsRecoveredFromText: PreparedModelTurn["toolsRecoveredFromText"];
  llmIntention: PreparedModelTurn["llmIntention"];
  hadThinking: boolean;
}

export type DispatchToolsResult =
  | { kind: "continue" }
  | { kind: "next_turn" }
  | { kind: "end_task"; result: LoopResult };

export async function runDispatchToolsPhase(
  host: DispatchToolsHost,
  deps: DispatchToolsDeps,
): Promise<DispatchToolsResult> {
  const {
    session,
    turn,
    esc,
    turnState,
    verifiedFinalClickBypassKeys,
    blockedActions,
    signalCompletedResult,
    response,
    cleanContent,
    toolsRecoveredFromText,
    llmIntention,
    hadThinking,
  } = deps;
  const {
    recentToolCalls,
    recentSuccesses,
    discoveredTagIds,
    resultPageProgress,
  } = turnState;
  // loop() only enters the ACTION path when tool_calls is present and non-empty.
  const toolCalls = response.tool_calls!;

  // ACTION REQUIRED
  session.consecutiveTextOnly = 0;
  host.throwIfGracefulStopRequested();

  // ServiceNow: a "missing field" admission in the model text completes the
  // record workflow immediately (no tool call needed).
  const missingFieldAdmissionSummary =
    host.getServiceNowMissingFieldAdmissionSummary(cleanContent);
  if (missingFieldAdmissionSummary) {
    signalCompletedResult(missingFieldAdmissionSummary);
    host.traceRecorder?.recordEvent(
      "servicenow_record_missing_field_admission_completed",
      {
        turn: host.turnCount,
        summary: missingFieldAdmissionSummary,
      },
    );
    await host.traceRecorder?.endTurn();
    return {
      kind: "end_task",
      result: {
        outcome: "completed",
        turnCount: host.turnCount,
        summary: missingFieldAdmissionSummary,
        failure: { category: "none", code: "none" },
        metrics: host.getMetrics(),
        evidence: host.evidenceAccumulator.toArray(),
        completionEnvelope: host.completedResult?.completionEnvelope,
      },
    };
  }
  host.lastDomStep = null;
  host.context.setLastActionOutcome(null);
  const toolCallSetup = prepareToolCallBranch({
    response,
    turnCount: host.turnCount,
    cleanContent,
    toolsRecoveredFromText,
    hadThinking,
    consecutiveBlindToolTurns: session.consecutiveBlindToolTurns,
    context: host.context,
    traceRecorder: host.traceRecorder,
    log: host.log,
    statusHandler: (status, message) => host.statusHandler(status, message),
    rewriteListDetailWorkflowToolCall: (toolCall, mode) =>
      host.rewriteListDetailWorkflowToolCall(toolCall, mode),
  });
  session.consecutiveBlindToolTurns = toolCallSetup.consecutiveBlindToolTurns;

  if (toolCallSetup.allCallsBlocked) {
    return { kind: "next_turn" }; // All tool calls blocked - retry
  }

  // Exploration hard block: after HARD_BLOCK consecutive exploration-only turns,
  // inject synthetic error results for blocked exploration calls and skip their
  // dispatch. Non-exploration calls in the same response proceed normally.
  let effectiveToolCalls = toolCalls;
  if (session.consecutiveExplorationTurns >= EXPLORATION_BUDGET.HARD_BLOCK) {
    const hardBlockedCalls = toolCalls.filter((tc) =>
      EXPLORATION_ONLY_TOOLS.has(tc.function.name),
    );
    if (hardBlockedCalls.length > 0) {
      for (const tc of hardBlockedCalls) {
        host.context.addMessage({
          role: "tool" as const,
          tool_call_id: tc.id,
          content:
            `Exploration blocked: ${session.consecutiveExplorationTurns} consecutive read-only turns. ` +
            `Take a concrete action (click, type, navigate, scroll) or call escalate() if stuck.`,
        });
      }
      host.log.warn(
        "agent",
        "Exploration hard block: blocked read-only calls",
        {
          turn: host.turnCount,
          consecutiveExplorationTurns: session.consecutiveExplorationTurns,
          blockedCount: hardBlockedCalls.length,
        },
      );
      host.traceRecorder?.recordEvent("exploration_hard_block", {
        consecutiveTurns: session.consecutiveExplorationTurns,
        blockedCount: hardBlockedCalls.length,
      } as Record<string, unknown>);
      effectiveToolCalls = toolCalls.filter(
        (tc) => !EXPLORATION_ONLY_TOOLS.has(tc.function.name),
      );
      if (effectiveToolCalls.length === 0) {
        // All calls were exploration — skip dispatch for this turn
        return { kind: "next_turn" };
      }
    }
  }

  const canParallelize = toolCallSetup.canParallelize;

  if (canParallelize) {
    host.throwIfGracefulStopRequested();
    // PARALLEL EXECUTION
    const parallelDispatch = await executeParallelToolCalls(
      host as unknown as ParallelToolDispatchHost,
      {
        toolCalls: effectiveToolCalls,
        tabId: session.tabId,
        repeatActionWindow: REPEAT_ACTION_WINDOW,
        llmIntention,
        state: {
          recentToolCalls,
          verifiedFinalClickBypassKeys,
          lastReadElementId: session.lastReadElementId,
          consecutiveReadElementSameId: session.consecutiveReadElementSameId,
          blockedActions,
          recentSuccesses,
          discoveredTagIds,
          orientationPhase: esc.orientationPhase,
          orientationToolsUsed: esc.orientationToolsUsed,
          domModified: turn.domModified,
          visuallyModified: turn.visuallyModified,
          lastDomAffectingToolName: turn.lastDomAffectingToolName,
        },
      },
    );
    session.lastReadElementId = parallelDispatch.state.lastReadElementId;
    session.consecutiveReadElementSameId =
      parallelDispatch.state.consecutiveReadElementSameId;
    turn.domModified = parallelDispatch.state.domModified;
    turn.visuallyModified = parallelDispatch.state.visuallyModified;
    turn.lastDomAffectingToolName =
      parallelDispatch.state.lastDomAffectingToolName;

    host.finalizeParallelToolResults(parallelDispatch.results);
  } else {
    // SEQUENTIAL EXECUTION (has sequential tools or single tool)
    const sequentialDispatch: SequentialToolDispatchOutput =
      await executeSequentialToolCalls.call(
        host as unknown as SequentialToolDispatchHost,
        {
          toolCalls: effectiveToolCalls,
          repeatActionWindow: REPEAT_ACTION_WINDOW,
          llmIntention,
          signalCompletedResult,
          state: {
            tabId: session.tabId,
            prevElementCount: session.prevElementCount,
            escalationTier: esc.tier,
            plannerModelStartTurn: esc.plannerModelStartTurn,
            orientationPhase: esc.orientationPhase,
            recentToolCalls,
            verifiedFinalClickBypassKeys,
            lastReadElementId: session.lastReadElementId,
            consecutiveReadElementSameId: session.consecutiveReadElementSameId,
            blockedActions,
            recentSuccesses,
            discoveredTagIds,
            orientationToolsUsed: esc.orientationToolsUsed,
            domModified: turn.domModified,
            visuallyModified: turn.visuallyModified,
            lastDomAffectingToolName: turn.lastDomAffectingToolName,
            doneSignaled: turn.doneSignaled,
            doneSummary: session.doneSummary,
            resultPageProgress,
          },
        },
      );
    session.tabId = sequentialDispatch.tabId;
    session.prevElementCount = sequentialDispatch.prevElementCount;
    if (sequentialDispatch.escalationTier > esc.tier) {
      // Voluntary escalate() tool call upgraded the tier this turn.
      host.escalationRescue.noteEscalation(host.turnCount, "voluntary");
    }
    esc.tier = sequentialDispatch.escalationTier;
    esc.plannerModelStartTurn = sequentialDispatch.plannerModelStartTurn;
    esc.orientationPhase = sequentialDispatch.orientationPhase;
    session.lastReadElementId = sequentialDispatch.lastReadElementId;
    session.consecutiveReadElementSameId =
      sequentialDispatch.consecutiveReadElementSameId;
    turn.domModified = sequentialDispatch.domModified;
    turn.visuallyModified = sequentialDispatch.visuallyModified;
    turn.lastDomAffectingToolName = sequentialDispatch.lastDomAffectingToolName;
    turn.doneSignaled = sequentialDispatch.doneSignaled;
    session.doneSummary = sequentialDispatch.doneSummary;
  }

  return { kind: "continue" };
}
