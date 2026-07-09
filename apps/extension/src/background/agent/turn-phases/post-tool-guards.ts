/**
 * post_tool_guards phase (RFC LP-16 Phase 3, extending the LP-15 Phase 11 turn
 * machine).
 *
 * The guard chain that runs after tools dispatch on a non-completed turn:
 * observation-progress accounting, ServiceNow infeasibility, overlay-recovery
 * completion, the all-fail / deterministic / same-tool circuit breakers, the
 * exploration budget, redundant-action + dead-end detection, the post-escalation
 * pivot and step-duration watchdog, then the same-URL forced escalation, the
 * stale-element snapshot-refresh trigger, and last-tool-name bookkeeping.
 * Extracted verbatim from loop() via the dispatch-host idiom (loop() passes
 * `this`); the turn-local escalation/outcome state is threaded in as deps.
 *
 * Control results:
 *   - `end_task`  → a circuit breaker or ServiceNow infeasibility ended the run;
 *   - `end_turn`  → overlay-recovery completion (break to terminal result);
 *   - `next_turn` → a dead-end pivot/nudge consumed the turn (retry);
 *   - `continue`  → guards passed; proceed to the completion phase.
 */

import type { AgentStep, ToolCall } from "../../../types";
import { ToolName } from "../../../types";
import type { logger, SessionScopedLogger } from "../../../utils";
import type { ContextManager } from "../context";
import type { TraceRecorder } from "../trace";
import type { LoopResult } from "../loop-types";
import type { RuntimeLimits } from "../constants";
import type { LoopSession, TurnScope } from "../loop-scope";
import type { EscalationTierController } from "../escalation-tier-controller";
import type { TrustedCompletionCandidate } from "../completion-kernel";
import type { ServiceNowMissingFieldSearchEvidence } from "../servicenow/trusted-workflow-adapter";
import type { TurnToolOutcomeRecord } from "../turn-tool-outcomes";
import { collectTurnToolOutcomeRecords } from "../turn-tool-outcomes";
import type { ContextProgressSignal } from "../context-economy";
import {
  buildObservationProgressKey,
  detectObservationProgressSignals,
} from "../context-economy";
import {
  assessDeadEndPattern,
  assessSameUrlForcedEscalation,
  assessStepDurationWatchdog,
  buildOverlayRecoveryCompletionSummary,
  buildSubgoalAttempt,
  countTrailingToolResultOutcomes,
  extractAttemptSummary,
  getSnapshotFingerprint,
  recordRecentOutcome,
  recordRecentSuccessfulAction,
  updateConsecutiveAllFailTurns,
  updateExplorationBudget,
  updatePostEscalationPivot,
  updateSameToolFailureTracking,
  type BlockedAction,
  type RecentAction,
  type RecentOutcome,
  type SubgoalAttempt,
} from "../loop-helpers";
import { ESCALATION_RECOVERY, ESCALATION_REFLECTION } from "../loop-prompts";
import {
  EXPLORATION_BUDGET,
  EXPLORATION_ONLY_TOOLS,
  FAILED_ACTION_MEMORY,
  REDUNDANT_ACTION,
  STAGNATION_DETECTION,
} from "../constants";

/**
 * Whether a successful state-changing action (type/select/checkbox, or a
 * cart/checkout-style click) should defer the step-duration watchdog one turn.
 */
function shouldDeferStepWatchdogForOutcome(
  outcome: TurnToolOutcomeRecord,
): boolean {
  if (
    /^(?:error|failed|failure|not found|unable|cannot|could not)\b/i.test(
      outcome.resultContent,
    )
  ) {
    return false;
  }
  switch (outcome.toolName) {
    case ToolName.TYPE_TEXT:
    case ToolName.SELECT_OPTION:
    case ToolName.SET_CHECKBOX:
      return true;
    case ToolName.CLICK_ELEMENT:
      return /\b(?:add(?:ed)?\b.{0,80}\b(?:cart|basket|bag)|apply|applied|place\s+order|placed\s+order|checkout|submit|submitted|confirm|confirmed|save|saved)\b/i.test(
        outcome.resultContent,
      );
    default:
      return false;
  }
}

export interface PostToolGuardsHost {
  readonly turnCount: number;
  readonly lastPlanIndex: number;
  readonly turnsOnCurrentStep: number;
  readonly escalationsOnCurrentStep: number;
  readonly doneRejections: number;
  readonly originalQuery: string;
  readonly selectedSkillId: string | null;
  readonly taskId: unknown;
  readonly limits: RuntimeLimits;
  readonly abortController: AbortController | null;
  readonly context: ContextManager;
  readonly log: typeof logger | SessionScopedLogger;
  readonly traceRecorder: TraceRecorder | null;
  readonly evidenceAccumulator: { toArray(): LoopResult["evidence"] };
  readonly escalationRescue: {
    noteEscalation(turn: number, trigger: string): void;
  };
  readonly stagnation: { sameUrlTurns: number; resetEscalation(): void };
  readonly telemetry: {
    recordContextProgress(
      turn: number,
      signals: ContextProgressSignal[],
    ): boolean;
  };
  readonly planSubtasks: ReadonlyArray<{ status: string }>;
  lastToolNameForPerception: string;
  pendingDoneRejectionEscalation: boolean;
  circuitBreakerExit(message: string): void;
  getMetrics(): LoopResult["metrics"];
  getCompletionRecoveryHintForCurrentState(): string | null;
  assessServiceNowMissingFieldInfeasibility(
    toolOutcomes: TurnToolOutcomeRecord[],
    evidence: Map<string, ServiceNowMissingFieldSearchEvidence>,
  ): string | null;
  replanOnEscalation(
    tabId: number,
    subgoalAttempts: SubgoalAttempt[],
    signal?: AbortSignal,
  ): Promise<boolean>;
  strategyPivot(tabId: number, attemptSummary?: string): Promise<void>;
  stepHandler(step: AgentStep, update: boolean): void;
}

export interface PostToolGuardsDeps {
  session: LoopSession;
  turn: TurnScope;
  esc: EscalationTierController;
  toolCalls: ToolCall[];
  signalCompletedResult: (
    summary: string,
    options?: {
      saveCheckpoint?: boolean;
      completionCandidate?: TrustedCompletionCandidate;
    },
  ) => void;
  beginPlannerEscalation: (options: { bumpStepCounter: boolean }) => void;
  resetEscalationWorkingMemory: (options?: {
    resetProgressSignals?: boolean;
    resetStepEscalation?: boolean;
    resetZeroEffectTurns?: boolean;
    clearStuckFlag?: boolean;
  }) => void;
  subgoalAttempts: SubgoalAttempt[];
  recentOutcomes: RecentOutcome[];
  recentObservationProgressKeys: string[];
  blockedActions: BlockedAction[];
  toolFailCounts: Map<string, number>;
  recentSuccesses: RecentAction[];
  serviceNowMissingFieldSearchEvidence: Map<
    string,
    ServiceNowMissingFieldSearchEvidence
  >;
}

export type PostToolGuardsResult =
  | { kind: "continue" }
  | { kind: "next_turn" }
  | { kind: "end_turn" }
  | { kind: "end_task"; result: LoopResult };

export async function runPostToolGuardsPhase(
  host: PostToolGuardsHost,
  deps: PostToolGuardsDeps,
): Promise<PostToolGuardsResult> {
  const {
    session,
    turn,
    esc,
    toolCalls,
    signalCompletedResult,
    beginPlannerEscalation,
    resetEscalationWorkingMemory,
    subgoalAttempts,
    recentOutcomes,
    recentObservationProgressKeys,
    blockedActions,
    toolFailCounts,
    recentSuccesses,
    serviceNowMissingFieldSearchEvidence,
  } = deps;
  // --- Circuit Breaker: track tool failures ---
  if (!turn.doneSignaled) {
    const recentMessages = host.context.getMessages();
    const turnToolOutcomes = collectTurnToolOutcomeRecords({
      toolCalls: toolCalls,
      messages: recentMessages,
      snapshot: host.context.getSnapshot(),
    });
    const deferStepWatchdogForStateChangingAction = turnToolOutcomes.some(
      shouldDeferStepWatchdogForOutcome,
    );
    const observationSnapshot = host.context.getSnapshot();
    const observationSnapshotFingerprint = observationSnapshot
      ? getSnapshotFingerprint(observationSnapshot)
      : undefined;
    const observationProgressSignals: ContextProgressSignal[] = [];
    for (const outcome of turnToolOutcomes) {
      const observationKey = buildObservationProgressKey({
        toolName: outcome.toolName,
        resultContent: outcome.resultContent,
        snapshotFingerprint: observationSnapshotFingerprint,
      });
      const signals = detectObservationProgressSignals({
        toolName: outcome.toolName,
        resultContent: outcome.resultContent,
        alreadySeen: recentObservationProgressKeys.includes(observationKey),
      });
      if (signals.length === 0) continue;
      recentObservationProgressKeys.push(observationKey);
      if (recentObservationProgressKeys.length > 30) {
        recentObservationProgressKeys.shift();
      }
      observationProgressSignals.push(...signals);
    }
    if (observationProgressSignals.length > 0) {
      host.traceRecorder?.recordEvent("observation_progress_detected", {
        turn: host.turnCount,
        signals: observationProgressSignals.map((signal) => signal.label),
      });
      if (
        host.telemetry.recordContextProgress(
          host.turnCount,
          observationProgressSignals,
        )
      ) {
        host.traceRecorder?.recordEvent("context_spend_progress_reset", {
          turn: host.turnCount,
          signals: observationProgressSignals.map((signal) => signal.label),
        });
      }
    }
    const missingFieldInfeasibleSummary =
      host.assessServiceNowMissingFieldInfeasibility(
        turnToolOutcomes,
        serviceNowMissingFieldSearchEvidence,
      );
    if (missingFieldInfeasibleSummary) {
      signalCompletedResult(missingFieldInfeasibleSummary);
      host.traceRecorder?.recordEvent(
        "servicenow_record_missing_field_infeasible",
        {
          turn: host.turnCount,
          summary: missingFieldInfeasibleSummary,
        },
      );
      await host.traceRecorder?.endTurn();
      return {
        kind: "end_task",
        result: {
          outcome: "completed",
          turnCount: host.turnCount,
          summary: missingFieldInfeasibleSummary,
          failure: { category: "none", code: "none" },
          metrics: host.getMetrics(),
          evidence: host.evidenceAccumulator.toArray(),
        },
      };
    }
    const overlayRecoveryCompletion = buildOverlayRecoveryCompletionSummary({
      originalQuery: host.originalQuery,
      selectedSkillId: host.selectedSkillId,
      snapshot: host.context.getSnapshot(),
      toolOutcomes: turnToolOutcomes,
    });
    if (overlayRecoveryCompletion) {
      signalCompletedResult(overlayRecoveryCompletion);
      host.traceRecorder?.recordEvent("overlay_recovery_completed", {
        turn: host.turnCount,
        selectedSkillId: host.selectedSkillId,
      });
      await host.traceRecorder?.endTurn();
      return { kind: "end_turn" };
    }
    const { turnSuccesses, turnFailures } =
      countTrailingToolResultOutcomes(recentMessages);

    // A. Consecutive all-fail turns
    const failureResults = turnToolOutcomes.map((o) => o.resultContent);
    const allFailResult = updateConsecutiveAllFailTurns({
      previousCount: session.consecutiveAllFailTurns,
      previousDeterministicCount: session.consecutiveAllFailDeterministicTurns,
      turnSuccesses,
      turnFailures,
      failureResults,
    });
    session.consecutiveAllFailTurns = allFailResult.count;
    session.consecutiveAllFailDeterministicTurns =
      allFailResult.deterministicCount;

    // A1. Deterministic fast-path: circuit break one turn earlier when failures are
    //     guaranteed unrecoverable (element not found, access denied, etc.)
    const deterministicThreshold = Math.max(
      1,
      host.limits.maxConsecutiveAllFail - 1,
    );
    if (
      session.consecutiveAllFailDeterministicTurns >= deterministicThreshold &&
      session.consecutiveAllFailTurns < host.limits.maxConsecutiveAllFail
    ) {
      host.log.warn(
        "agent",
        "Circuit breaker: consecutive deterministic failures",
        {
          turn: host.turnCount,
          consecutiveAllFailDeterministicTurns:
            session.consecutiveAllFailDeterministicTurns,
          deterministicThreshold,
        },
      );
      host.traceRecorder?.recordEvent("deterministic_circuit_break", {
        consecutiveAllFailTurns: session.consecutiveAllFailTurns,
        consecutiveAllFailDeterministicTurns:
          session.consecutiveAllFailDeterministicTurns,
        deterministicThreshold,
      });
      host.circuitBreakerExit(
        `Deterministic errors prevented progress for ${session.consecutiveAllFailDeterministicTurns} consecutive turns. ` +
          `Try navigating to a different page or sending new instructions.`,
      );
      return {
        kind: "end_task",
        result: {
          outcome: "error" as const,
          turnCount: host.turnCount,
          summary: "Circuit breaker: deterministic tool failures",
          metrics: host.getMetrics(),
        },
      };
    }

    // A2. General all-fail circuit breaker
    if (session.consecutiveAllFailTurns >= host.limits.maxConsecutiveAllFail) {
      host.log.warn("agent", "Circuit breaker: consecutive all-fail turns", {
        turn: host.turnCount,
        consecutiveAllFailTurns: session.consecutiveAllFailTurns,
      });
      host.traceRecorder?.recordEvent("circuit_breaker", {
        reason: "consecutive_all_fail",
        consecutiveAllFailTurns: session.consecutiveAllFailTurns,
      });
      host.circuitBreakerExit(
        `All tool calls have failed for ${session.consecutiveAllFailTurns} consecutive turns. The agent cannot make progress. Send a follow-up with different instructions.`,
      );
      return {
        kind: "end_task",
        result: {
          outcome: "error" as const,
          turnCount: host.turnCount,
          summary: "Circuit breaker: consecutive tool failures",
          metrics: host.getMetrics(),
        },
      };
    }

    // B. Same-tool repeat failure tracking
    for (const { toolName, argsKey, resultContent } of turnToolOutcomes) {
      const failureTracking = updateSameToolFailureTracking({
        blockedActions,
        toolFailCounts,
        toolName,
        argsKey,
        resultContent,
        turn: host.turnCount,
        bufferSize: FAILED_ACTION_MEMORY.BUFFER_SIZE,
        warnThreshold: host.limits.toolFailureWarn,
        exitThreshold: host.limits.toolFailureExit,
      });

      if (failureTracking.kind === "exit") {
        host.log.warn("agent", "Circuit breaker: same-tool repeat failure", {
          turn: host.turnCount,
          tool: toolName,
          count: failureTracking.count,
        });
        host.traceRecorder?.recordEvent("circuit_breaker", {
          reason: "same_tool_repeat",
          tool: toolName,
          count: failureTracking.count,
        });
        host.circuitBreakerExit(failureTracking.message);
        return {
          kind: "end_task",
          result: {
            outcome: "error" as const,
            turnCount: host.turnCount,
            summary: "Circuit breaker: repeated tool failure",
            metrics: host.getMetrics(),
          },
        };
      }

      if (failureTracking.kind === "warn") {
        host.log.warn(
          "agent",
          "Circuit breaker warning: tool repeating failures",
          {
            turn: host.turnCount,
            tool: toolName,
            count: failureTracking.count,
          },
        );
        host.context.addMessage({
          role: "user",
          content: failureTracking.message,
        });
      }
    }

    // B1.5. Done-rejection escalation: if the mid-point threshold was crossed in a
    //        rejection handler this turn, escalate to planner mode now.
    if (host.pendingDoneRejectionEscalation) {
      host.pendingDoneRejectionEscalation = false;
      if (esc.tier === 0) {
        beginPlannerEscalation({ bumpStepCounter: false });
        host.escalationRescue.noteEscalation(host.turnCount, "done_rejection");
        host.log.info(
          "agent",
          "Escalated to planner after done() rejection mid-point",
          {
            turn: host.turnCount,
            doneRejections: host.doneRejections,
            maxDoneRejections: host.limits.maxDoneRejections,
          },
        );
      }
    }

    // B2. Exploration budget: nudge after N consecutive turns of only reading/inspecting
    {
      const explorationBudget = updateExplorationBudget({
        previousCount: session.consecutiveExplorationTurns,
        toolNames: turnToolOutcomes.map((outcome) => outcome.toolName),
        explorationOnlyTools: EXPLORATION_ONLY_TOOLS,
        maxConsecutive: EXPLORATION_BUDGET.MAX_CONSECUTIVE,
      });
      session.consecutiveExplorationTurns = explorationBudget.consecutiveTurns;
      if (explorationBudget.message) {
        host.context.addMessage({
          role: "user",
          content: explorationBudget.message,
        });
      }
    }

    // C. Redundant successful action detection
    for (const { toolName, argsKey, resultContent } of turnToolOutcomes) {
      const recentSuccessDecision = recordRecentSuccessfulAction({
        recentSuccesses,
        toolName,
        argsKey,
        resultContent,
        snapshot: host.context.getSnapshot(),
        windowSize: REDUNDANT_ACTION.WINDOW,
        infoThreshold: REDUNDANT_ACTION.INFO_THRESHOLD,
        toolNameInfoThreshold: REDUNDANT_ACTION.TOOL_NAME_INFO_THRESHOLD,
      });

      if (recentSuccessDecision.kind === "redundant_nudge") {
        host.log.info("agent", "Redundant action nudge", {
          turn: host.turnCount,
          tool: toolName,
          sameStateCount: recentSuccessDecision.sameStateCount,
          totalRepeats: recentSuccessDecision.totalRepeatCount,
        });
        host.traceRecorder?.recordEvent("redundant_action_nudge", {
          tool: toolName,
          count: recentSuccessDecision.sameStateCount,
        });
        host.traceRecorder?.recordEvent("multi_turn_pathology", {
          pathology: "anchoring",
          trigger: "redundant_action_nudge",
          turn: host.turnCount,
          details: `${toolName} x${recentSuccessDecision.sameStateCount} same state`,
        });
        host.context.addMessage({
          role: "user",
          content: recentSuccessDecision.message,
        });
      } else if (recentSuccessDecision.kind === "tool_name_pattern") {
        host.log.info("agent", "Tool-name pattern noted", {
          turn: host.turnCount,
          tool: toolName,
          count: recentSuccessDecision.toolNameCount,
        });
        host.traceRecorder?.recordEvent("tool_name_pattern", {
          tool: toolName,
          count: recentSuccessDecision.toolNameCount,
        });
        host.context.addMessage({
          role: "user",
          content: recentSuccessDecision.message,
        });
      }
    }

    // D2. Outcome-based dead-end detection: fingerprint tool results and detect patterns
    {
      const currentSnapshotFp = getSnapshotFingerprint(
        host.context.getSnapshot(),
      );
      for (const outcome of turnToolOutcomes) {
        recordRecentOutcome({
          recentOutcomes,
          resultContent: outcome.resultContent,
          snapshotFp: currentSnapshotFp,
          windowSize: STAGNATION_DETECTION.WINDOW,
        });

        subgoalAttempts.push(
          buildSubgoalAttempt({
            turn: host.turnCount,
            toolName: outcome.toolName,
            toolArguments: outcome.toolCall.function.arguments,
            resultContent: outcome.resultContent,
            snapshotFp: currentSnapshotFp,
          }),
        );
      }
    }
    // Check for dead-end pattern (all recent outcomes identical AND same page state)
    {
      const deadEnd = assessDeadEndPattern({
        recentOutcomes,
        reflectionThreshold: host.limits.stagnationReflection,
        pivotThreshold: host.limits.stagnationPivot,
      });
      if (deadEnd.kind === "pivot") {
        const completionHint = host.getCompletionRecoveryHintForCurrentState();
        if (completionHint) {
          host.log.info(
            "agent",
            "Dead-end pivot suppressed by completion evidence",
            {
              turn: host.turnCount,
              pattern: deadEnd.pattern.slice(0, 80),
            },
          );
          host.traceRecorder?.recordEvent("dead_end_completion_consult", {
            turn: host.turnCount,
            action: "suppress_pivot",
            pattern: deadEnd.pattern.slice(0, 80),
          });
          host.context.addMessage({
            role: "user",
            content: completionHint,
          });
          recentOutcomes.length = 0;
          return { kind: "next_turn" };
        }
        host.log.warn("agent", "Dead-end detected: forcing strategy pivot", {
          turn: host.turnCount,
          pattern: deadEnd.pattern.slice(0, 80),
          count: deadEnd.count,
        });
        host.traceRecorder?.recordEvent("dead_end_pivot", {
          pattern: deadEnd.pattern.slice(0, 80),
          count: deadEnd.count,
        });
        host.traceRecorder?.recordEvent("multi_turn_pathology", {
          pathology: "anchoring",
          trigger: "dead_end_pivot",
          turn: host.turnCount,
          details: `pattern: ${deadEnd.pattern.slice(0, 60)}`,
        });
        await host.strategyPivot(session.tabId);
        recentOutcomes.length = 0;
      } else if (deadEnd.kind === "nudge") {
        const completionHint = host.getCompletionRecoveryHintForCurrentState();
        if (completionHint) {
          host.log.info(
            "agent",
            "Dead-end nudge replaced by completion evidence",
            {
              turn: host.turnCount,
              pattern: deadEnd.pattern.slice(0, 80),
            },
          );
          host.traceRecorder?.recordEvent("dead_end_completion_consult", {
            turn: host.turnCount,
            action: "replace_nudge",
            pattern: deadEnd.pattern.slice(0, 80),
          });
          host.context.addMessage({
            role: "user",
            content: completionHint,
          });
          recentOutcomes.length = 0;
          return { kind: "next_turn" };
        }
        host.log.info("agent", "Dead-end nudge: repeated outcome pattern", {
          turn: host.turnCount,
          pattern: deadEnd.pattern.slice(0, 80),
          count: deadEnd.count,
        });
        host.traceRecorder?.recordEvent("dead_end_nudge", {
          pattern: deadEnd.pattern.slice(0, 80),
          count: deadEnd.count,
        });
        host.traceRecorder?.recordEvent("multi_turn_pathology", {
          pathology: "anchoring",
          trigger: "dead_end_nudge",
          turn: host.turnCount,
          details: `pattern: ${deadEnd.pattern.slice(0, 60)}`,
        });
        host.context.addMessage({
          role: "user",
          content: deadEnd.message,
        });
      }
    }

    // E-pre. Post-escalation forced pivot: if N turns passed since step watchdog escalation
    // without step advancement, force a strategy pivot and clear failed-action memory.
    {
      const postEscalationPivot = updatePostEscalationPivot({
        turnsSinceStepEscalation: session.turnsSinceStepEscalation,
        pivotTurns: FAILED_ACTION_MEMORY.POST_ESCALATION_PIVOT_TURNS,
      });
      session.turnsSinceStepEscalation =
        postEscalationPivot.turnsSinceStepEscalation;
      if (postEscalationPivot.kind === "pivot") {
        host.log.info("agent", "Post-escalation forced pivot", {
          turn: host.turnCount,
          turnsSinceStepEscalation: session.turnsSinceStepEscalation,
        });
        await host.strategyPivot(session.tabId);
        blockedActions.length = 0;
        session.turnsSinceStepEscalation = -1;
      }
    }

    // E. Step duration watchdog
    {
      const stepWatchdog = assessStepDurationWatchdog({
        hasTaskId: Boolean(host.taskId),
        planSubtaskCount: host.planSubtasks.length,
        turnsOnCurrentStep: host.turnsOnCurrentStep,
        escalationTier: esc.tier,
        cooldownRemaining: esc.cooldownRemaining,
        warnTurns: host.limits.stepWarnTurns,
        escalateTurns: host.limits.stepEscalateTurns,
        deferForStateChangingAction: deferStepWatchdogForStateChangingAction,
      });
      if (stepWatchdog.kind === "escalate") {
        host.log.warn("agent", "Step watchdog: force escalation", {
          turn: host.turnCount,
          turnsOnStep: host.turnsOnCurrentStep,
          stepIndex: host.lastPlanIndex,
          fromTier: esc.tier,
        });
        host.traceRecorder?.recordEvent("step_watchdog_escalate", {
          turnsOnStep: host.turnsOnCurrentStep,
          stepIndex: host.lastPlanIndex,
        });
        host.escalationRescue.noteEscalation(host.turnCount, "step_watchdog");

        // Try replan-on-escalation first: planner replans, executor continues
        const replanSucceeded = await host.replanOnEscalation(
          session.tabId,
          subgoalAttempts,
          host.abortController?.signal,
        );
        if (replanSucceeded) {
          resetEscalationWorkingMemory({ resetStepEscalation: true });
        } else {
          // Fallback: old escalation behavior
          const stepAttemptSummary = extractAttemptSummary(
            host.context.getMessages(),
          );
          beginPlannerEscalation({ bumpStepCounter: true });
          session.turnsSinceStepEscalation = 0; // Start tracking post-escalation pivot
          await host.strategyPivot(session.tabId, stepAttemptSummary);
          host.stagnation.resetEscalation();
          host.context.addMessage({
            role: "user",
            content:
              host.escalationsOnCurrentStep >= 2
                ? ESCALATION_RECOVERY(
                    host.escalationsOnCurrentStep,
                    `step ${host.lastPlanIndex + 1}`,
                  )
                : `STEP WATCHDOG: You spent ${host.turnsOnCurrentStep} turns on step ${host.lastPlanIndex + 1} without advancing. ${ESCALATION_REFLECTION("stuck on step " + (host.lastPlanIndex + 1) + " for " + host.turnsOnCurrentStep + " turns")}\nEither complete this step and move forward, or revise the plan if the step is impossible.`,
          });
          host.stepHandler(
            {
              id: crypto.randomUUID(),
              type: "info",
              label: `Stuck on step ${host.lastPlanIndex + 1} — escalating to planner model`,
              status: "done",
              timestamp: Date.now(),
            },
            false,
          );
        }
      } else if (stepWatchdog.kind === "defer") {
        host.log.info(
          "agent",
          "Step watchdog deferred after state-changing action",
          {
            turn: host.turnCount,
            turnsOnStep: host.turnsOnCurrentStep,
            stepIndex: host.lastPlanIndex,
            tool: turn.lastDomAffectingToolName,
          },
        );
        host.traceRecorder?.recordEvent("step_watchdog_deferred", {
          turnsOnStep: host.turnsOnCurrentStep,
          stepIndex: host.lastPlanIndex,
          tool: turn.lastDomAffectingToolName,
        });
      } else if (stepWatchdog.kind === "warn") {
        host.log.warn("agent", "Step watchdog: warn", {
          turn: host.turnCount,
          turnsOnStep: host.turnsOnCurrentStep,
          stepIndex: host.lastPlanIndex,
        });
        host.traceRecorder?.recordEvent("step_watchdog_warn", {
          turnsOnStep: host.turnsOnCurrentStep,
          stepIndex: host.lastPlanIndex,
        });
        host.context.addMessage({
          role: "user",
          content: `You have spent ${host.turnsOnCurrentStep} turns on this step. Either the step is ALREADY COMPLETE (advance) or your approach isn't working (try escalate or a different approach).`,
        });
      }
    }
  }

  // Trigger A: Same-URL forced escalation — fires even without a plan/subtask structure.
  // Catches the agent spinning on one page regardless of DOM changes (Fix 5A).
  const sameUrlEscalation = turn.doneSignaled
    ? { kind: "none" as const }
    : assessSameUrlForcedEscalation({
        escalationTier: esc.tier,
        cooldownRemaining: esc.cooldownRemaining,
        sameUrlTurns: host.stagnation.sameUrlTurns,
        sameUrlEscalate: host.limits.sameUrlEscalate,
      });
  if (sameUrlEscalation.kind === "escalate") {
    host.log.warn("agent", "Same-URL forced escalation", {
      turn: host.turnCount,
      sameUrlTurns: host.stagnation.sameUrlTurns,
      threshold: host.limits.sameUrlEscalate,
    });
    host.traceRecorder?.recordEvent("same_url_forced_escalation", {
      sameUrlTurns: host.stagnation.sameUrlTurns,
      threshold: host.limits.sameUrlEscalate,
    });
    host.escalationRescue.noteEscalation(host.turnCount, "same_url");

    // Try replan-on-escalation first
    const sameUrlReplanOk = await host.replanOnEscalation(
      session.tabId,
      subgoalAttempts,
      host.abortController?.signal,
    );
    if (sameUrlReplanOk) {
      resetEscalationWorkingMemory();
    } else {
      // Fallback: old escalation behavior
      const urlAttemptSummary = extractAttemptSummary(
        host.context.getMessages(),
      );
      beginPlannerEscalation({ bumpStepCounter: true });
      await host.strategyPivot(session.tabId, urlAttemptSummary);
      host.stagnation.resetEscalation();
      host.context.addMessage({
        role: "user",
        content:
          host.escalationsOnCurrentStep >= 2
            ? ESCALATION_RECOVERY(host.escalationsOnCurrentStep)
            : `SAME-URL ESCALATION: You spent ${host.stagnation.sameUrlTurns} turns on this page without navigating away. ${ESCALATION_REFLECTION("same URL for " + host.stagnation.sameUrlTurns + " turns without progress")}`,
      });
      session.consecutiveTextOnly = 0;
      recentSuccesses.length = 0;
      host.stepHandler(
        {
          id: crypto.randomUUID(),
          type: "info",
          label: `Stuck on same page — escalating`,
          status: "done",
          timestamp: Date.now(),
        },
        false,
      );
    }
  }

  // Force snapshot refresh when tools hit stale element IDs
  // Ensures the LLM's next turn sees fresh IDs without wasting a read_page call
  if (!turn.domModified && !turn.doneSignaled) {
    const recentMsgs = host.context.getMessages();
    for (let i = recentMsgs.length - 1; i >= 0; i--) {
      const msg = recentMsgs[i];
      if (msg.role !== "tool") break;
      if (
        typeof msg.content === "string" &&
        msg.content.includes("No element with tag")
      ) {
        turn.domModified = true;
        host.log.info(
          "agent",
          "Stale element ID detected, forcing snapshot refresh",
          {
            turn: host.turnCount,
          },
        );
        break;
      }
    }
  }

  // Track last tool name for perception stale threshold selection
  if (toolCalls.length > 0) {
    host.lastToolNameForPerception =
      toolCalls[toolCalls.length - 1].function.name;
  }
  return { kind: "continue" };
}
