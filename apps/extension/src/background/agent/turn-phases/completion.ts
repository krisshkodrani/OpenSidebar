/**
 * completion phase (RFC LP-16 Phase 3, extending the LP-15 Phase 11 turn
 * machine).
 *
 * The post-tool completion pipeline for a DOM-modifying turn: refresh the page
 * snapshot, then run the completion + progress logic — explicit-success
 * auto-complete, retroactive screenshot attach, the nested plan_monitor phase,
 * action-effect / semantic-progress accounting, pending-async + submit-form
 * reset handling, structural / passive step advancement, the zero-effect
 * warn→escalate recovery, the stuck-signal fresh-start recovery and
 * stagnation escalate / progress-gated de-escalation. Extracted verbatim from
 * loop() via the dispatch-host idiom (loop() passes `this`); the turn-local
 * escalation/outcome state threads in as deps.
 *
 * Control results (no end_task — completion never terminates the run itself):
 *   - `end_turn`  → a completion was signalled (break to end-of-turn);
 *   - `next_turn` → a recovery (zero-effect / fresh-start) consumed the turn;
 *   - `continue`  → proceed to account_and_refresh.
 */

import type { AgentStep, DomSnapshot, ToolCall } from "../../../types";
import type { logger, SessionScopedLogger } from "../../../utils";
import type { ContextManager } from "../context";
import type { TraceRecorder } from "../trace";
import type { RuntimeLimits } from "../constants";
import type { LoopSession, TurnScope } from "../loop-scope";
import type { EscalationTierController } from "../escalation-tier-controller";
import type { TrustedCompletionCandidate } from "../completion-kernel";
import type { ActionEffect, StagnationSignal } from "../stagnation";
import {
  detectExplicitSuccessSignalInSnapshot,
  type ExplicitSuccessSignalHost,
} from "../explicit-success-signal";
import { runPlanMonitorPhase, type PlanMonitorPhaseHost } from "./plan-monitor";
import {
  refreshPostToolSnapshot,
  type PostToolSnapshotRefreshHost,
} from "../post-tool-snapshot-refresh";
import {
  advanceCompletedSubtasks,
  completeSingleSubtask,
  type AgentLoopPlanProgressHost,
} from "../loop-plan-progress";
import { buildTaskContract } from "../task-contract";
import { countExplicitSteps } from "../explicit-steps";
import { summarizeCausalChain } from "../context-formatting";
import {
  detectSemanticProgressSignals,
  type ContextProgressSignal,
} from "../context-economy";
import {
  buildFailureBrief,
  buildZeroEffectDecision,
  detectFormSubmissionResetSuccess,
  detectPendingAsyncChange,
  detectStructuralStepAdvance,
  extractAttemptSummary,
  isPendingAsyncChangeSatisfied,
  matchSuccessCriteria,
  shouldTrackFormSubmissionReset,
  type BlockedAction,
  type RecentAction,
  type RecentOutcome,
  type SubgoalAttempt,
} from "../loop-helpers";
import { ESCALATION_RECOVERY, ESCALATION_REFLECTION } from "../loop-prompts";
import { ACTION_EFFECT, FRESH_START, ROLLING_DISTILL } from "../constants";

export interface CompletionPhaseHost {
  readonly turnCount: number;
  readonly originalQuery: string;
  readonly nodeId: string | null;
  readonly taskId: unknown;
  escalationsOnCurrentStep: number;
  readonly limits: RuntimeLimits;
  readonly abortController: AbortController | null;
  readonly context: ContextManager;
  readonly log: typeof logger | SessionScopedLogger;
  readonly traceRecorder: TraceRecorder | null;
  readonly perception: {
    getLastScreenshot(): string | null;
    invalidateCache(): void;
  };
  readonly stagnation: {
    onSnapshotRefresh(snap: DomSnapshot): StagnationSignal | null;
    readonly lastActionEffect: ActionEffect | null;
    resetProgressCounters(): void;
    resetEscalation(): void;
    reset(): void;
  };
  readonly telemetry: {
    recordContextProgress(
      turn: number,
      signals: ContextProgressSignal[],
    ): boolean;
  };
  readonly toolCache: { clear(): void };
  readonly planSteps: ReadonlyArray<{ successCriteria?: string }>;
  readonly planSubtasks: ReadonlyArray<{ status: string; description: string }>;
  consecutiveAutoAdvances: number;
  consecutiveZeroEffectTurns: number;
  lastDomStep: unknown;
  pendingAsyncVerification: {
    stepIndex: number;
    expectedTokens: string[];
    baselineLoadingKeywords: string[];
    reason: string;
    startedTurn: number;
  } | null;
  pendingFormSubmissionReset: {
    stepIndex: number;
    stepDescription: string;
    successCriteria?: string;
    preActionSnapshot: DomSnapshot;
    toolName: string;
    toolArgs?: Record<string, unknown>;
    startedTurn: number;
  } | null;
  completeTaskUi(summary: string): void;
  broadcast(message: unknown): void;
  broadcastFinalMetrics(): void;
  broadcastTaskProgress(index: number): void;
  escalateModel(): void;
  syncPlanStatus(
    index: number,
    event: string,
    meta?: Record<string, unknown>,
  ): void;
  getActiveToolProfileForStep(index: number): string | undefined;
  completeSubmitFormReset(
    stepIndex: number,
    signal: unknown,
  ): { finalSummary: string; completionCandidate?: TrustedCompletionCandidate };
  waitForPendingAsyncChange(
    tabId: number,
    prevElementCount: number,
    pending: NonNullable<CompletionPhaseHost["pendingAsyncVerification"]>,
  ): Promise<DomSnapshot | null>;
  refreshSnapshot(tabId: number): Promise<number>;
  replanOnEscalation(
    tabId: number,
    subgoalAttempts: SubgoalAttempt[],
    signal?: AbortSignal,
  ): Promise<boolean>;
  strategyPivot(tabId: number, attemptSummary?: string): Promise<void>;
  saveTurnCheckpoint(): Promise<void>;
  stepHandler(step: AgentStep, update: boolean): void;
}

export interface CompletionPhaseDeps {
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
  recentSuccesses: RecentAction[];
  recentOutcomes: RecentOutcome[];
  blockedActions: BlockedAction[];
}

export type CompletionPhaseResult =
  | { kind: "continue" }
  | { kind: "next_turn" }
  | { kind: "end_turn" };

export async function runCompletionPhase(
  host: CompletionPhaseHost,
  deps: CompletionPhaseDeps,
): Promise<CompletionPhaseResult> {
  const {
    session,
    turn,
    esc,
    toolCalls,
    signalCompletedResult,
    beginPlannerEscalation,
    resetEscalationWorkingMemory,
    subgoalAttempts,
    recentSuccesses,
    recentOutcomes,
    blockedActions,
  } = deps;
  // Capture pre-action snapshot for diff-based loading detection.
  // Used to distinguish structural loading keywords (present before the
  // action) from transient ones (appeared due to the action).
  const preActionSnapshot = host.context.getSnapshot();
  const lastToolCall = toolCalls[toolCalls.length - 1];
  const lastToolName = lastToolCall?.function.name;
  let lastToolArgs: Record<string, unknown> | undefined;
  if (lastToolCall?.function.arguments) {
    try {
      lastToolArgs = JSON.parse(lastToolCall.function.arguments) as Record<
        string,
        unknown
      >;
    } catch {
      lastToolArgs = undefined;
    }
  }

  // Batch snapshot refresh: ONE refresh after all tools complete
  if (turn.domModified && !turn.doneSignaled) {
    try {
      const snapshotRefresh = await refreshPostToolSnapshot(
        host as unknown as PostToolSnapshotRefreshHost,
        {
          tabId: session.tabId,
          prevElementCount: session.prevElementCount,
          visuallyModified: turn.visuallyModified,
          recentSuccesses,
        },
      );
      let snap = snapshotRefresh.snap;
      session.prevElementCount = snapshotRefresh.prevElementCount;

      if (snap) {
        const explicitSuccessSignal = detectExplicitSuccessSignalInSnapshot(
          host as unknown as ExplicitSuccessSignalHost,
          snap,
        );
        // Suppress auto-complete for root agent (no nodeId) on multi-return
        // queries; detector is step-scoped (won't complete the wrong node).
        const taskContractMultiReturn = !host.nodeId
          ? (buildTaskContract(host.originalQuery).multiReturnCount ?? 0)
          : 0;
        const explicitStepCount = countExplicitSteps(host.originalQuery || "");
        if (
          explicitSuccessSignal &&
          taskContractMultiReturn < 2 &&
          explicitStepCount < 2
        ) {
          const summary = [
            `- Verified "${explicitSuccessSignal}" is visible on the page.`,
            `- URL: ${snap.url}`,
            `- The task completion state is present in the refreshed page content.`,
          ].join("\n");

          host.context.clearPlanStatus();
          host.log.info(
            "agent",
            "Auto-completing from explicit success signal",
            {
              turn: host.turnCount,
              signal: explicitSuccessSignal,
              url: snap.url,
            },
          );
          host.traceRecorder?.recordEvent("explicit_success_auto_completed", {
            turn: host.turnCount,
            signal: explicitSuccessSignal,
            url: snap.url,
          });
          host.context.addMessage({
            role: "tool",
            tool_call_id: crypto.randomUUID(),
            content: summary,
          });
          host.completeTaskUi(summary);
          session.doneSummary = summary;
          turn.doneSignaled = true;

          host.broadcastFinalMetrics();
        } else if (explicitSuccessSignal && explicitStepCount >= 2) {
          host.traceRecorder?.recordEvent(
            "explicit_success_auto_complete_blocked",
            {
              turn: host.turnCount,
              signal: explicitSuccessSignal,
              url: snap.url,
              reason: "multi_step_original_query",
              explicitStepCount,
            },
          );
        } else if (
          explicitSuccessSignal &&
          taskContractMultiReturn >= 2 &&
          host.planSubtasks.length > 0
        ) {
          // Multi-return query: auto-complete blocked because not all
          // returns are collected yet. But the current step IS done.
          // Advance to the next step instead of blocking the executor.
          const runningIdx = host.planSubtasks.findIndex(
            (s) => s.status === "running",
          );
          if (runningIdx >= 0 && runningIdx < host.planSubtasks.length - 1) {
            const newIdx = advanceCompletedSubtasks(
              host as unknown as AgentLoopPlanProgressHost,
            );
            const nextDesc =
              host.planSubtasks[newIdx]?.description || "Continue to next step";
            host.syncPlanStatus(newIdx, "multi_return_step_advanced", {
              signal: explicitSuccessSignal,
              advancedTo: newIdx,
            });
            host.context.addMessage({
              role: "user",
              content:
                `Current step verified ("${explicitSuccessSignal}" visible). ` +
                `But the task requires multiple results — advancing to next step.\n` +
                `YOUR NEW OBJECTIVE: ${nextDesc}`,
            });
            host.log.info(
              "agent",
              "Multi-return: auto-advanced step instead of auto-completing",
              {
                turn: host.turnCount,
                signal: explicitSuccessSignal,
                advancedTo: newIdx,
                nextObjective: nextDesc,
              },
            );
          }
        }

        // Retroactive screenshot attachment: update the last DOM-modifying step with the screenshot
        const lastScreenshot = host.perception.getLastScreenshot();
        const lastDomStep = host.lastDomStep as AgentStep | null;
        if (lastScreenshot && lastDomStep) {
          host.stepHandler(
            {
              ...lastDomStep,
              screenshotUrl: lastScreenshot,
            },
            true,
          );
          host.lastDomStep = null;
        }

        // Plan monitor: check alignment every 2 turns when plan is active
        await runPlanMonitorPhase(
          host as unknown as PlanMonitorPhaseHost,
          session.tabId,
        );

        // Progress tracking: detect stuck loops
        const progressSignal = host.stagnation.onSnapshotRefresh(snap);
        let suppressStuckSignal = false;

        // P0: Surface action effect — tell the agent whether its last action changed the page
        // Use visuallyModified (not domModified) so read_page doesn't produce misleading deltas
        const actionEffect = host.stagnation.lastActionEffect;
        if (
          host.pendingFormSubmissionReset &&
          host.taskId &&
          !turn.doneSignaled
        ) {
          const pending = host.pendingFormSubmissionReset;
          const delayedSubmitSignal = detectFormSubmissionResetSuccess({
            currentStepDescription: pending.stepDescription,
            currentStepSuccessCriteria: pending.successCriteria,
            preActionSnapshot: pending.preActionSnapshot,
            currentSnapshot: snap,
            actionEffect: {
              deltaPercent: 1,
              urlChanged: true,
              currentUrl: snap.url,
              elementsAdded: 0,
              elementsRemoved: 0,
              addedSignatures: [],
              prevCount: pending.preActionSnapshot.elements.length,
              currentCount: snap.elements.length,
            },
            toolName: pending.toolName,
            toolArgs: pending.toolArgs,
          });

          if (delayedSubmitSignal) {
            const { finalSummary, completionCandidate } =
              host.completeSubmitFormReset(
                pending.stepIndex,
                delayedSubmitSignal,
              );
            host.pendingFormSubmissionReset = null;
            signalCompletedResult(finalSummary, {
              completionCandidate,
            });
            await host.traceRecorder?.endTurn();
            return { kind: "end_turn" };
          }

          if (host.turnCount - pending.startedTurn > 5) {
            host.pendingFormSubmissionReset = null;
          }
        }
        if (actionEffect && turn.visuallyModified) {
          host.context.setLastActionOutcome({
            toolName: turn.lastDomAffectingToolName ?? "unknown",
            deltaPercent: actionEffect.deltaPercent,
            urlChanged: actionEffect.urlChanged,
            prevUrl: actionEffect.prevUrl,
            currentUrl: actionEffect.currentUrl,
            elementsAdded: actionEffect.elementsAdded,
            elementsRemoved: actionEffect.elementsRemoved,
          });
          host.traceRecorder?.recordEvent("action_effect", {
            toolName: turn.lastDomAffectingToolName ?? "unknown",
            deltaPercent: actionEffect.deltaPercent,
            urlChanged: actionEffect.urlChanged,
            elementsAdded: actionEffect.elementsAdded,
            elementsRemoved: actionEffect.elementsRemoved,
          });
          const semanticToolName =
            turn.lastDomAffectingToolName ?? lastToolName ?? null;
          const semanticToolArgs =
            lastToolName === semanticToolName ? lastToolArgs : undefined;
          const semanticProgressSignals = detectSemanticProgressSignals({
            toolName: semanticToolName,
            toolArgs: semanticToolArgs,
            previousSnapshot: preActionSnapshot,
            currentSnapshot: snap,
          });
          const strongSemanticProgress = semanticProgressSignals.some(
            (signal) => signal.observed && signal.strength === "strong",
          );
          const semanticProgressObserved = semanticProgressSignals.some(
            (signal) => signal.observed,
          );
          const resetBySemanticProgress =
            semanticProgressObserved &&
            (strongSemanticProgress ||
              actionEffect.deltaPercent > ACTION_EFFECT.ZERO_THRESHOLD ||
              actionEffect.urlChanged);
          const smallObservedActionProgress =
            actionEffect.deltaPercent > 0 &&
            Boolean(turn.lastDomAffectingToolName);
          if (semanticProgressSignals.length > 0) {
            host.traceRecorder?.recordEvent("semantic_progress_detected", {
              turn: host.turnCount,
              toolName: semanticToolName ?? "unknown",
              signals: semanticProgressSignals.map((signal) => signal.label),
            });
          }
          if (resetBySemanticProgress || smallObservedActionProgress) {
            suppressStuckSignal = true;
            host.stagnation.resetProgressCounters();
          }
          const spendProgressSignals: ContextProgressSignal[] = [
            ...semanticProgressSignals,
          ];
          if (actionEffect.deltaPercent >= 0.1) {
            spendProgressSignals.push({
              strength: "strong" as const,
              label: "action_effect_delta",
              observed: true,
            });
          } else if (actionEffect.deltaPercent > ACTION_EFFECT.ZERO_THRESHOLD) {
            spendProgressSignals.push({
              strength: "medium" as const,
              label: "action_effect_delta",
              observed: true,
            });
          }
          if (smallObservedActionProgress) {
            spendProgressSignals.push({
              strength: "weak" as const,
              label: "targeted_action_effect",
              observed: true,
            });
          }
          if (actionEffect.urlChanged) {
            spendProgressSignals.push({
              strength: "weak" as const,
              label: "url_changed",
              observed: true,
            });
          }
          if (
            host.telemetry.recordContextProgress(
              host.turnCount,
              spendProgressSignals,
            )
          ) {
            host.traceRecorder?.recordEvent("context_spend_progress_reset", {
              turn: host.turnCount,
              signals: spendProgressSignals.map((signal) => signal.label),
            });
          }

          const planAfterAction = host.context.getPlanStatusRaw();
          if (
            host.taskId &&
            planAfterAction &&
            !turn.doneSignaled &&
            planAfterAction.currentIndex < planAfterAction.subtasks.length
          ) {
            const currentSubtask =
              planAfterAction.subtasks[planAfterAction.currentIndex];

            if (currentSubtask && lastToolName) {
              const asyncSignal = detectPendingAsyncChange({
                currentStepDescription: currentSubtask.description,
                currentStepSuccessCriteria:
                  host.planSteps[planAfterAction.currentIndex]?.successCriteria,
                currentSnapshot: snap,
                preActionSnapshot,
                actionEffect,
                toolName: lastToolName,
              });

              if (asyncSignal) {
                host.pendingAsyncVerification = {
                  stepIndex: planAfterAction.currentIndex,
                  expectedTokens: asyncSignal.expectedTokens,
                  baselineLoadingKeywords: asyncSignal.baselineLoadingKeywords,
                  reason: asyncSignal.reason,
                  startedTurn: host.turnCount,
                };
                host.context.addMessage({
                  role: "user",
                  content:
                    `ASYNC CHECKPOINT: ${asyncSignal.reason} ` +
                    "Wait for the page update and verify the new content before continuing.",
                });
                host.traceRecorder?.recordEvent(
                  "pending_async_change_detected",
                  {
                    turn: host.turnCount,
                    stepIndex: planAfterAction.currentIndex,
                    expectedTokens: asyncSignal.expectedTokens,
                    loadingIndicator: asyncSignal.loadingIndicator,
                  },
                );

                const awaitedSnapshot = await host.waitForPendingAsyncChange(
                  session.tabId,
                  session.prevElementCount,
                  host.pendingAsyncVerification,
                );
                if (awaitedSnapshot) {
                  snap = awaitedSnapshot;
                  session.prevElementCount = awaitedSnapshot.elements.length;
                }
              } else if (
                host.pendingAsyncVerification &&
                host.pendingAsyncVerification.stepIndex ===
                  planAfterAction.currentIndex &&
                isPendingAsyncChangeSatisfied({
                  snapshot: snap,
                  expectedTokens: host.pendingAsyncVerification.expectedTokens,
                })
              ) {
                host.pendingAsyncVerification = null;
              }
            }

            if (
              currentSubtask &&
              lastToolName &&
              host.getActiveToolProfileForStep(planAfterAction.currentIndex) ===
                "submit_form"
            ) {
              const submitResetSignal = detectFormSubmissionResetSuccess({
                currentStepDescription: currentSubtask.description,
                currentStepSuccessCriteria:
                  host.planSteps[planAfterAction.currentIndex]?.successCriteria,
                preActionSnapshot,
                currentSnapshot: snap,
                actionEffect,
                toolName: lastToolName,
                toolArgs: lastToolArgs,
              });

              if (submitResetSignal) {
                host.consecutiveAutoAdvances = 0;
                const fromStep = planAfterAction.currentIndex;
                const { finalSummary, completionCandidate } =
                  host.completeSubmitFormReset(fromStep, submitResetSignal);
                signalCompletedResult(finalSummary, {
                  completionCandidate,
                });
                await host.traceRecorder?.endTurn();
                return { kind: "end_turn" };
              } else if (
                shouldTrackFormSubmissionReset({
                  currentStepDescription: currentSubtask.description,
                  currentStepSuccessCriteria:
                    host.planSteps[planAfterAction.currentIndex]
                      ?.successCriteria,
                  preActionSnapshot,
                  toolName: lastToolName,
                  toolArgs: lastToolArgs,
                })
              ) {
                host.pendingFormSubmissionReset = {
                  stepIndex: planAfterAction.currentIndex,
                  stepDescription: currentSubtask.description,
                  successCriteria:
                    host.planSteps[planAfterAction.currentIndex]
                      ?.successCriteria,
                  preActionSnapshot: preActionSnapshot!,
                  toolName: lastToolName,
                  toolArgs: lastToolArgs,
                  startedTurn: host.turnCount,
                };
                host.traceRecorder?.recordEvent("pending_submit_form_reset", {
                  stepIndex: planAfterAction.currentIndex,
                  turn: host.turnCount,
                });
              }
            }

            const nextSubtask =
              planAfterAction.subtasks[planAfterAction.currentIndex + 1];
            if (currentSubtask && nextSubtask && lastToolName) {
              const advanceSignal = detectStructuralStepAdvance({
                currentStepDescription: currentSubtask.description,
                currentStepSuccessCriteria:
                  host.planSteps[planAfterAction.currentIndex]?.successCriteria,
                nextStepDescription: nextSubtask.description,
                currentSnapshot: snap,
                actionEffect,
                toolName: lastToolName,
              });

              // Passive step advancement: if structural advance didn't fire,
              // check if the current step's success criteria are satisfied in DOM.
              // Advances silently so the agent continues acting instead of calling done().
              const passiveCriteria = !advanceSignal
                ? matchSuccessCriteria({
                    successCriteria:
                      host.planSteps[planAfterAction.currentIndex]
                        ?.successCriteria,
                    snapshot: snap,
                  })
                : null;
              const shouldPassiveAdvance =
                passiveCriteria?.satisfied &&
                passiveCriteria.totalTokens > 0 &&
                passiveCriteria.matchedTokens.length >= 2;

              if (advanceSignal || shouldPassiveAdvance) {
                host.consecutiveAutoAdvances = 0;
                const fromStep = planAfterAction.currentIndex;
                const newIdx = completeSingleSubtask(
                  host as unknown as AgentLoopPlanProgressHost,
                  fromStep,
                );
                const isStructural = !!advanceSignal;
                const reason = isStructural
                  ? advanceSignal!.reason
                  : `Step criteria satisfied (${passiveCriteria!.matchedTokens.join(", ")})`;
                const matchedTokens = isStructural
                  ? advanceSignal!.matchedTokens
                  : passiveCriteria!.matchedTokens;
                const traceEvent = isStructural
                  ? ("structural_step_advance" as const)
                  : ("passive_step_advance" as const);

                host.syncPlanStatus(newIdx, traceEvent, {
                  reason,
                  matchedTokens,
                  advancedTo: newIdx,
                });
                const completedAllSteps = newIdx >= host.planSubtasks.length;
                const nextStepDesc =
                  host.planSubtasks[newIdx]?.description ||
                  "Finish the remaining plan";
                if (!completedAllSteps) {
                  host.context.addMessage({
                    role: "user",
                    content:
                      `STEP COMPLETED: ${reason}. ` +
                      `Continue with the next step: ${nextStepDesc}. ` +
                      `Do NOT call done() - keep acting.`,
                  });
                }
                host.broadcastTaskProgress(newIdx);
                if (completedAllSteps) {
                  const finalSummary = `Completed final planned step: ${reason}.`;
                  signalCompletedResult(finalSummary, {
                    saveCheckpoint: false,
                  });
                }
                host.log.info("agent", `${traceEvent} triggered`, {
                  turn: host.turnCount,
                  fromStep,
                  toStep: newIdx,
                  matchedTokens,
                });
                host.traceRecorder?.recordEvent(traceEvent, {
                  fromStep,
                  toStep: newIdx,
                  matchedTokens,
                  reason,
                  completedAllSteps,
                });
                if (completedAllSteps) {
                  host.saveTurnCheckpoint().catch(() => {});
                  await host.traceRecorder?.endTurn();
                  return { kind: "end_turn" };
                }
              }
            }
          }

          // P1b: Track consecutive zero-effect turns with warn-then-escalate recovery
          if (
            actionEffect.deltaPercent < ACTION_EFFECT.ZERO_THRESHOLD &&
            !actionEffect.urlChanged &&
            !resetBySemanticProgress &&
            !smallObservedActionProgress
          ) {
            host.consecutiveZeroEffectTurns++;
            const failureBrief = buildFailureBrief(subgoalAttempts);
            const zeroEffectDecision = buildZeroEffectDecision({
              consecutiveTurns: host.consecutiveZeroEffectTurns,
              failureBrief,
              warningThreshold: ACTION_EFFECT.WARNING_THRESHOLD,
              escalateThreshold: ACTION_EFFECT.ESCALATE_THRESHOLD,
            });

            if (
              zeroEffectDecision.kind === "warn" &&
              zeroEffectDecision.message
            ) {
              host.context.addMessage({
                role: "user",
                content: zeroEffectDecision.message,
              });
              host.traceRecorder?.recordEvent("zero_effect_warning", {
                consecutiveTurns: host.consecutiveZeroEffectTurns,
                hasFailureBrief: !!failureBrief,
              });
            } else if (
              zeroEffectDecision.kind === "escalate" &&
              zeroEffectDecision.message &&
              esc.tier === 0 &&
              esc.cooldownRemaining <= 0
            ) {
              host.context.addMessage({
                role: "user",
                content: zeroEffectDecision.message,
              });
              host.traceRecorder?.recordEvent("zero_effect_escalation", {
                consecutiveTurns: host.consecutiveZeroEffectTurns,
                hasFailureBrief: !!failureBrief,
              });

              const zeroEffectReplanOk = await host.replanOnEscalation(
                session.tabId,
                subgoalAttempts,
                host.abortController?.signal,
              );
              if (zeroEffectReplanOk) {
                resetEscalationWorkingMemory({
                  resetProgressSignals: true,
                  resetZeroEffectTurns: true,
                  clearStuckFlag: true,
                });
                return { kind: "next_turn" };
              }

              host.perception.invalidateCache();
              const attemptSummary = extractAttemptSummary(
                host.context.getMessages(),
              );
              beginPlannerEscalation({ bumpStepCounter: true });
              await host.strategyPivot(session.tabId, attemptSummary);
              host.stagnation.resetEscalation();
              host.context.addMessage({
                role: "user",
                content:
                  host.escalationsOnCurrentStep >= 2
                    ? ESCALATION_RECOVERY(host.escalationsOnCurrentStep)
                    : ESCALATION_REFLECTION(
                        "repeated DOM actions had no observable effect",
                      ),
              });
              session.consecutiveTextOnly = 0;
              recentSuccesses.length = 0;
              esc.consecutiveProgressSignals = 0;
              host.consecutiveZeroEffectTurns = 0;
              subgoalAttempts.length = 0;
              host.stepHandler(
                {
                  id: crypto.randomUUID(),
                  type: "info",
                  label:
                    "Repeated no-effect actions - escalating to planner model",
                  status: "done",
                  timestamp: Date.now(),
                },
                false,
              );
              return { kind: "next_turn" };
            }
          } else {
            host.consecutiveZeroEffectTurns = 0;
            subgoalAttempts.length = 0; // reset on progress
          }
        }

        if (progressSignal && suppressStuckSignal) {
          host.traceRecorder?.recordEvent(
            "stuck_signal_suppressed_by_semantic_progress",
            {
              turn: host.turnCount,
              type: progressSignal.type,
              stagnantTurns: progressSignal.stagnantTurns,
            },
          );
        } else if (progressSignal) {
          host.traceRecorder?.recordProgress(
            progressSignal.stagnantTurns,
            progressSignal.type,
          );
          host.traceRecorder?.recordEvent("stuck_signal", {
            type: progressSignal.type,
            stagnantTurns: progressSignal.stagnantTurns,
          });
          host.log.warn("agent", "Progress stuck detected", {
            turn: host.turnCount,
            type: progressSignal.type,
            stagnantTurns: progressSignal.stagnantTurns,
            url: snap.url,
          });

          // Broadcast stagnation signal to side panel
          host.broadcast({
            type: "AGENT_STAGNATION",
            payload: {
              signal: "escalate",
              stagnantTurns: progressSignal.stagnantTurns,
              url: snap.url,
              message: progressSignal.message,
            },
          });
          esc.wasStuck = true;

          // S3: Fresh-start recovery — full context reset when escalation cycles exhaust
          if (
            esc.escalationCycles >= FRESH_START.TRIGGER_ESCALATION_CYCLE &&
            esc.freshStartCount < host.limits.maxFreshStarts &&
            host.turnCount >= FRESH_START.MIN_TURNS_BEFORE_RESET
          ) {
            esc.freshStartCount++;
            const causalSummary = summarizeCausalChain(
              host.context.getMessages(),
              ROLLING_DISTILL.MAX_SUMMARY_ENTRIES,
            );
            const planState =
              host.planSubtasks.length > 0
                ? `Plan: ${host.planSubtasks.map((s, i) => `${i + 1}.[${s.status}] ${s.description}`).join(", ")}`
                : "";
            const currentUrl = host.context.getCurrentUrl();
            const brief = [
              `FRESH START #${esc.freshStartCount} — previous approach exhausted after ${host.turnCount} turns.`,
              `Original task: "${host.originalQuery}"`,
              planState,
              causalSummary ? `What was tried:\n${causalSummary}` : "",
              currentUrl ? `Current page: ${currentUrl}` : "",
              "Start with a completely different strategy. Do NOT repeat previous approaches.",
            ]
              .filter(Boolean)
              .join("\n\n");

            // Record trace events
            host.traceRecorder?.recordEvent("fresh_start_recovery", {
              freshStartNumber: esc.freshStartCount,
              totalTurnsSoFar: host.turnCount,
              escalationCycles: esc.escalationCycles,
            });
            host.traceRecorder?.recordEvent("multi_turn_pathology", {
              pathology: "compound_degradation",
              trigger: "fresh_start",
              turn: host.turnCount,
              details: `esc.escalationCycles=${esc.escalationCycles} freshStart=${esc.freshStartCount}`,
            });

            // Reset context with the brief
            host.context.clearHistory();
            host.context.addMessage({ role: "user", content: brief });

            // Reset loop state
            host.stagnation.reset();
            host.toolCache.clear();
            blockedActions.length = 0;
            session.consecutiveTextOnly = 0;
            recentOutcomes.length = 0;
            recentSuccesses.length = 0;
            session.consecutiveAllFailTurns = 0;
            esc.escalationCycles = 0;
            esc.cooldownRemaining = 0;
            host.escalationsOnCurrentStep = 0;
            session.lastReadElementId = null;
            session.consecutiveReadElementSameId = 0;

            // Ensure planner tier
            if (esc.tier === 0) {
              host.escalateModel();
              esc.tier = 1;
            }
            esc.plannerModelStartTurn = host.turnCount;

            // Refresh snapshot
            try {
              await host.refreshSnapshot(session.tabId);
            } catch {
              /* non-critical */
            }

            host.stepHandler(
              {
                id: crypto.randomUUID(),
                type: "info",
                label: `Fresh start #${esc.freshStartCount} — resetting context`,
                status: "done",
                timestamp: Date.now(),
              },
              false,
            );

            host.log.info("agent", "Fresh-start recovery", {
              freshStartCount: esc.freshStartCount,
              turn: host.turnCount,
              escalationCycles: esc.escalationCycles,
            });
            esc.wasStuck = false;
            return { kind: "next_turn" };
          }

          // Escalate: executor → planner (try replan first)
          else if (esc.tier === 0 && esc.cooldownRemaining <= 0) {
            // Try replan-on-escalation first
            const stagnationReplanOk = await host.replanOnEscalation(
              session.tabId,
              subgoalAttempts,
              host.abortController?.signal,
            );
            if (stagnationReplanOk) {
              resetEscalationWorkingMemory({
                resetProgressSignals: true,
                clearStuckFlag: true,
              });
            } else {
              // Fallback: old escalation behavior
              // Invalidate perception cache so the planner model gets a fresh interpretation
              host.perception.invalidateCache();
              const attemptSummary = extractAttemptSummary(
                host.context.getMessages(),
              );
              beginPlannerEscalation({ bumpStepCounter: true });
              await host.strategyPivot(session.tabId, attemptSummary);
              host.stagnation.resetEscalation();
              host.context.addMessage({
                role: "user",
                content:
                  host.escalationsOnCurrentStep >= 2
                    ? ESCALATION_RECOVERY(host.escalationsOnCurrentStep)
                    : ESCALATION_REFLECTION(
                        "no DOM progress detected by stagnation monitor",
                      ),
              });
              session.consecutiveTextOnly = 0;
              recentSuccesses.length = 0;
              esc.consecutiveProgressSignals = 0;
              host.stepHandler(
                {
                  id: crypto.randomUUID(),
                  type: "info",
                  label: "Stuck — switching to smarter model",
                  status: "done",
                  timestamp: Date.now(),
                },
                false,
              );
            }
          }
        } else {
          // Progress-gated de-escalation (handles both the wasStuck
          // recovery path and the not-stuck gate reset).
          session.prevElementCount = await esc.recordProgressSignal({
            snapUrl: snap.url,
            tabId: session.tabId,
            prevElementCount: session.prevElementCount,
          });
        }
      }
    } catch {
      // Non-critical: snapshot refresh failed, continue with stale data
    }
  }
  return { kind: "continue" };
}
