/**
 * text_response phase (RFC LP-16 Phase 3, extending the LP-15 Phase 11 turn
 * machine).
 *
 * The no-tool-calls path of a turn: the model replied with text instead of
 * acting. Handles the think-only fast-track, the turn-1 soft nudge, text
 * admission (success/failure) detection with the evidence-gated step advance,
 * the progress-aware text-only escalation, the consecutive-text and planner-turn
 * give-up exits, and the regular nudge (snapshot + perception refresh). Extracted
 * verbatim from loop() via the dispatch-host idiom (loop() passes `this`).
 *
 * Every path ends the turn, so results are only:
 *   - `end_turn`  → a give-up limit was hit (break to terminal result);
 *   - `next_turn` → nudge/escalation issued; start the next turn.
 */

import { AgentStatus } from "../../../types";
import type { logger, SessionScopedLogger } from "../../../utils";
import type { ContextManager } from "../context";
import type { TraceRecorder } from "../trace";
import type { RuntimeLimits } from "../constants";
import type { LoopSession } from "../loop-scope";
import type { EscalationTierController } from "../escalation-tier-controller";
import type { ActionEffect } from "../stagnation";
import type { PreparedModelTurn } from "./prepare-model-turn";
import {
  evaluateTextAdmissionAdvanceGate,
  type TextAdmissionGateHost,
} from "../text-admission-gate";
import {
  completeSingleSubtask,
  type AgentLoopPlanProgressHost,
} from "../loop-plan-progress";
import {
  buildFirstTurnTextOnlyNudge,
  extractAttemptSummary,
  isFillerText,
  requiresGroundingReadBeforeDone,
  type RecentAction,
  type SubgoalAttempt,
} from "../loop-helpers";
import { detectAdmission } from "../verification";
import { ESCALATION_REFLECTION, TEXT_ONLY_CORRECTION } from "../loop-prompts";
import { ACTION_EFFECT } from "../constants";

export interface TextResponsePhaseHost {
  readonly turnCount: number;
  readonly originalQuery: string;
  readonly taskId: unknown;
  readonly limits: RuntimeLimits;
  readonly abortController: AbortController | null;
  readonly context: ContextManager;
  readonly log: typeof logger | SessionScopedLogger;
  readonly traceRecorder: TraceRecorder | null;
  readonly stagnation: {
    readonly lastActionEffect: ActionEffect | null;
    resetEscalation(): void;
  };
  readonly planSubtasks: ReadonlyArray<{ status: string; description: string }>;
  broadcast(message: unknown): void;
  finishStream(): void;
  forceGroundingRefresh(tabId: number, reason: string): Promise<void>;
  refreshSnapshot(tabId: number): Promise<number>;
  refreshPerceptionAndTriage(tabId: number): Promise<void>;
  replanOnEscalation(
    tabId: number,
    subgoalAttempts: SubgoalAttempt[],
    signal?: AbortSignal,
  ): Promise<boolean>;
  strategyPivot(tabId: number, attemptSummary?: string): Promise<void>;
  saveTurnCheckpoint(): Promise<void>;
  statusHandler(status: AgentStatus, detail: string): void;
  stepHandler(
    step: {
      id: string;
      type: string;
      label: string;
      status: string;
      timestamp: number;
    },
    update: boolean,
  ): void;
  syncPlanStatus(
    index: number,
    event: string,
    meta?: Record<string, unknown>,
  ): void;
}

export interface TextResponsePhaseDeps {
  session: LoopSession;
  esc: EscalationTierController;
  cleanContent: PreparedModelTurn["cleanContent"];
  rawContent: PreparedModelTurn["rawContent"];
  hallucinationDetected: boolean;
  subgoalAttempts: SubgoalAttempt[];
  recentSuccesses: RecentAction[];
  beginPlannerEscalation: (options: { bumpStepCounter: boolean }) => void;
  resetEscalationWorkingMemory: (options?: {
    resetProgressSignals?: boolean;
    resetStepEscalation?: boolean;
    resetZeroEffectTurns?: boolean;
    clearStuckFlag?: boolean;
  }) => void;
}

export type TextResponsePhaseResult =
  | { kind: "next_turn" }
  | { kind: "end_turn" };

export async function runTextResponsePhase(
  host: TextResponsePhaseHost,
  deps: TextResponsePhaseDeps,
): Promise<TextResponsePhaseResult> {
  const {
    session,
    esc,
    cleanContent,
    rawContent,
    hallucinationDetected,
    subgoalAttempts,
    recentSuccesses,
    beginPlannerEscalation,
    resetEscalationWorkingMemory,
  } = deps;
  // TEXT RESPONSE — no tool calls

  // Think-only output: model reasoned (rawContent has tokens) but produced
  // no visible text or tool calls after think-tag stripping. Fast-track the
  // text-only counter so escalation fires sooner — the generic nudge doesn't
  // help a model that's stuck in a think loop.
  if (
    !cleanContent &&
    rawContent &&
    rawContent.length > 50 &&
    session.consecutiveTextOnly < 2
  ) {
    session.consecutiveTextOnly = 2; // Next text-only turn triggers escalation
    host.log.warn(
      "agent",
      "Think-only output detected, fast-tracking escalation",
      {
        turn: host.turnCount,
        rawLen: rawContent.length,
      },
    );
    host.context.addMessage({
      role: "user",
      content:
        "Your response contained only internal reasoning with no output or tool calls. " +
        "You MUST include at least one tool call. Use read_page to inspect the page, " +
        "or done() if the task is already complete.",
    });
    host.finishStream();
    await host.traceRecorder?.endTurn();
    return { kind: "next_turn" };
  }

  // Soft nudge: turn 1, no plan, substantive text — likely an answer to a question
  if (
    host.turnCount === 1 &&
    !host.taskId &&
    cleanContent &&
    cleanContent.trim().length > 20
  ) {
    session.consecutiveTextOnly++;
    session.totalTextOnly++;
    const needsGroundingRead = requiresGroundingReadBeforeDone(
      host.originalQuery,
    );
    host.log.info("agent", "Soft nudge: turn 1 text response", {
      turn: host.turnCount,
      textLen: cleanContent.trim().length,
      requiresGroundingReadBeforeDone: needsGroundingRead,
    });
    if (needsGroundingRead) {
      await host.forceGroundingRefresh(
        session.tabId,
        "text_only_before_grounding_read",
      );
    }
    host.context.addMessage({
      role: "user",
      content: buildFirstTurnTextOnlyNudge(host.originalQuery),
    });
    host.finishStream();
    return { kind: "next_turn" };
  }

  // Text-admission detection: catch when the LLM states success/failure in text
  if (cleanContent) {
    const admission = detectAdmission(cleanContent);
    if (admission) {
      host.log.info("agent", "Text admission detected", {
        turn: host.turnCount,
        type: admission.type,
        match: admission.match,
      });
      host.traceRecorder?.recordEvent("text_admission_detected", {
        type: admission.type,
        match: admission.match,
      });

      // When the model admits success in text but won't call done(),
      // reuse the existing evidence gate shape instead of trusting the
      // narration alone.
      const nextTextOnlyCount = session.consecutiveTextOnly + 1;
      session.consecutiveTextOnly = nextTextOnlyCount;
      session.totalTextOnly++;

      if (admission.type === "success" && host.planSubtasks.length > 0) {
        const gate = evaluateTextAdmissionAdvanceGate(
          host as unknown as TextAdmissionGateHost,
          {
            summary: cleanContent,
            consecutiveTextOnly: nextTextOnlyCount,
          },
        );

        if (gate.passed) {
          if (gate.isLastStep) {
            host.log.info(
              "agent",
              "Text admission matched final step; nudging done()",
              {
                turn: host.turnCount,
                step: gate.runningIdx,
                text: cleanContent.slice(0, 100),
              },
            );
            host.context.addMessage({
              role: "user",
              content:
                `You stated: "${admission.match}". All step criteria are met. ` +
                `Call done({"summary": "..."}) now with the complete result ` +
                `including all requested data.`,
            });
            host.finishStream();
            return { kind: "next_turn" };
          }

          const newIdx = completeSingleSubtask(
            host as unknown as AgentLoopPlanProgressHost,
            gate.runningIdx,
          );
          const nextDesc =
            host.planSubtasks[newIdx]?.description || "Continue to next step";
          host.syncPlanStatus(newIdx, "text_admission_criteria_advance", {
            turn: host.turnCount,
            fromStep: gate.runningIdx,
          });
          host.log.info("agent", "Text admission criteria advanced step", {
            turn: host.turnCount,
            fromStep: gate.runningIdx,
            advancedTo: newIdx,
            nextObjective: nextDesc,
          });
          host.context.addMessage({
            role: "user",
            content:
              `Step verified complete (criteria matched, text confirms success). ` +
              `Advancing.\nYOUR NEW OBJECTIVE: ${nextDesc}`,
          });
          host.finishStream();
          return { kind: "next_turn" };
        }
      }

      const nudge =
        admission.type === "success"
          ? `You stated: "${admission.match}". Call done() to deliver the result.`
          : `You stated: "${admission.match}". Call done() to report inability, or call escalate() for help.`;
      host.context.addMessage({ role: "user", content: nudge });
      host.finishStream();
      return { kind: "next_turn" };
    }
  }

  // Text-only escalation: uniform counting, progress-aware
  const filler = cleanContent ? isFillerText(cleanContent) : true;
  // Hallucination fast-tracks: bypass nudge, go straight to escalation
  if (hallucinationDetected) {
    session.consecutiveTextOnly = Math.max(session.consecutiveTextOnly, 3);
  } else {
    session.consecutiveTextOnly += 1; // Uniform counting — no filler fast-track
  }

  // Progress immunity: if the last action changed the page, don't escalate yet
  const lastEffect = host.stagnation.lastActionEffect;
  const recentProgress =
    lastEffect &&
    (lastEffect.deltaPercent > ACTION_EFFECT.ZERO_THRESHOLD ||
      lastEffect.urlChanged);
  if (recentProgress) {
    session.consecutiveTextOnly = Math.max(0, session.consecutiveTextOnly - 1);
  }

  session.totalTextOnly++;
  host.log.warn("agent", "LLM emitted text instead of tools", {
    turn: host.turnCount,
    consecutiveTextOnly: session.consecutiveTextOnly,
    tier: esc.tier,
    filler,
    recentProgress: !!recentProgress,
    text: cleanContent?.slice(0, 80),
  });

  // S6: Record pathology for text-only responses
  if (session.consecutiveTextOnly >= 3) {
    host.traceRecorder?.recordEvent("multi_turn_pathology", {
      pathology: filler ? "verbosity" : "premature_generation",
      trigger: "text_only_response",
      turn: host.turnCount,
      details: `consecutiveTextOnly=${session.consecutiveTextOnly} filler=${filler}`,
    });
  }

  // Escalate to next tier on 3rd consecutive text-only (with minimum turn gate)
  if (
    session.consecutiveTextOnly >= 3 &&
    esc.tier < 1 &&
    esc.cooldownRemaining <= 0 &&
    host.turnCount >= 4
  ) {
    // Try replan-on-escalation first
    const textReplanOk = await host.replanOnEscalation(
      session.tabId,
      subgoalAttempts,
      host.abortController?.signal,
    );
    if (textReplanOk) {
      resetEscalationWorkingMemory();
      host.finishStream();
      return { kind: "next_turn" };
    }

    // Fallback: old escalation behavior
    const textOnlyAttemptSummary = extractAttemptSummary(
      host.context.getMessages(),
    );
    beginPlannerEscalation({ bumpStepCounter: false });
    await host.strategyPivot(session.tabId, textOnlyAttemptSummary);
    host.stagnation.resetEscalation();
    host.context.addMessage({
      role: "user",
      content: ESCALATION_REFLECTION(
        "consecutive text-only responses without tool calls",
      ),
    });
    session.consecutiveTextOnly = 0;
    recentSuccesses.length = 0;
    host.stepHandler(
      {
        id: crypto.randomUUID(),
        type: "info",
        label: "Switching to smarter model",
        status: "done",
        timestamp: Date.now(),
      },
      false,
    );
    host.statusHandler(AgentStatus.THINKING, "Escalating model...");
    host.finishStream();
    return { kind: "next_turn" };
  }

  // Give-up: 4 consecutive text-only at max tier
  if (session.consecutiveTextOnly >= 4) {
    host.log.warn("agent", "Loop ended: consecutive text-only limit", {
      turns: host.turnCount,
      consecutiveTextOnly: session.consecutiveTextOnly,
      totalTextOnly: session.totalTextOnly,
      tier: esc.tier,
    });
    const stuckMsg =
      cleanContent || "The agent appears stuck and cannot continue.";
    host.broadcast({
      type: "STREAM_CHUNK",
      payload: { delta: "", done: false, replaceContent: stuckMsg },
    });
    host.finishStream();
    host.statusHandler(
      AgentStatus.IDLE,
      "Stalled — send a follow-up to continue",
    );
    await host.traceRecorder?.endTurn();
    return { kind: "end_turn" };
  }

  // Planner model turn-based give-up
  const plannerTurns =
    esc.tier > 0 ? host.turnCount - esc.plannerModelStartTurn : 0;
  if (
    esc.tier > 0 &&
    plannerTurns >= host.limits.stuckGiveUpPlanner &&
    session.totalTextOnly >= 3
  ) {
    host.log.warn("agent", "Loop ended: planner model turn limit", {
      turns: host.turnCount,
      plannerTurns,
      totalTextOnly: session.totalTextOnly,
      tier: esc.tier,
    });
    const stuckMsg =
      "The agent is struggling to make progress. Send a follow-up with more specific instructions.";
    host.broadcast({
      type: "STREAM_CHUNK",
      payload: { delta: "", done: false, replaceContent: stuckMsg },
    });
    host.finishStream();
    host.statusHandler(
      AgentStatus.IDLE,
      "Stalled — send a follow-up to continue",
    );
    await host.traceRecorder?.endTurn();
    return { kind: "end_turn" };
  }

  // Regular nudge: refresh snapshot + perception + inject message
  const count = await host.refreshSnapshot(session.tabId);
  if (count >= 0) session.prevElementCount = count;
  await host.refreshPerceptionAndTriage(session.tabId);
  host.context.addMessage({
    role: "user",
    content: TEXT_ONLY_CORRECTION,
  });

  // Durable checkpoint: persist loop state for SW restart recovery
  host.saveTurnCheckpoint().catch(() => {});

  // Trace: flush turn
  await host.traceRecorder?.endTurn();
  host.finishStream();
  return { kind: "next_turn" };
  return { kind: "next_turn" };
}
