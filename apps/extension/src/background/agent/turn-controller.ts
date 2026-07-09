/**
 * Turn controller factory (RFC LP-16 Phase 3b — loop.ts landmine decomposition).
 *
 * `loop()` used to build the two-tier `EscalationTierController` inline and
 * declare the three working-memory closures (step-scoped action-memory reset,
 * escalation working-memory reset, and the executor→planner escalation-entry
 * primitive) as ~145 lines of setup before the turn loop. This factory owns that
 * construction so `loop()` reduces to a driver: it returns the `esc` controller
 * plus the three closures, bound to the session bag, the run-scoped accumulator
 * collections, and the host (AgentLoop). Behavior-preserving relocation via the
 * dispatch-host idiom.
 */

import type { logger, SessionScopedLogger } from "../../utils";
import type { ToolName } from "../../types";
import type { ContextManager } from "./context";
import type { TraceRecorder } from "./trace";
import type { RuntimeLimits } from "./constants";
import { ORIENTATION } from "./constants";
import type { LoopSession } from "./loop-scope";
import { EscalationTierController } from "./escalation-tier-controller";
import type { ServiceNowMissingFieldSearchEvidence } from "./servicenow/trusted-workflow-adapter";
import {
  buildHandoffBriefing,
  clearStepScopedActionMemory,
  type BlockedAction,
  type RecentAction,
  type RecentOutcome,
  type SubgoalAttempt,
} from "./loop-helpers";
import { DEESCALATION_REFLECTION, HANDOFF_REFLECTION } from "./loop-prompts";

export interface TurnControllerHost {
  readonly limits: RuntimeLimits;
  readonly preferredModelTier: string;
  readonly turnCount: number;
  readonly lastPlanIndex: number;
  readonly traceRecorder: TraceRecorder | null;
  readonly context: ContextManager;
  readonly log: typeof logger | SessionScopedLogger;
  readonly stagnation: { isStillStuck(): boolean; resetEscalation(): void };
  consecutiveZeroEffectTurns: number;
  escalationsOnCurrentStep: number;
  deescalateModel(tabId: number, prevElementCount: number): Promise<number>;
  escalateModel(): void;
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
  broadcast(message: unknown): void;
}

/** The run-scoped accumulator collections the closures mutate by reference. */
export interface TurnControllerCollections {
  recentToolCalls: Array<{ tool: ToolName; argsKey: string }>;
  recentSuccesses: RecentAction[];
  blockedActions: BlockedAction[];
  verifiedFinalClickBypassKeys: Set<string>;
  subgoalAttempts: SubgoalAttempt[];
  recentOutcomes: RecentOutcome[];
  serviceNowMissingFieldSearchEvidence: Map<
    string,
    ServiceNowMissingFieldSearchEvidence
  >;
}

export interface TurnController {
  esc: EscalationTierController;
  resetStepScopedActionMemory: () => void;
  resetEscalationWorkingMemory: (options?: {
    resetProgressSignals?: boolean;
    resetStepEscalation?: boolean;
    resetZeroEffectTurns?: boolean;
    clearStuckFlag?: boolean;
  }) => void;
  beginPlannerEscalation: (options: { bumpStepCounter: boolean }) => void;
}

export function createTurnController(
  host: TurnControllerHost,
  session: LoopSession,
  collections: TurnControllerCollections,
): TurnController {
  const {
    recentToolCalls,
    recentSuccesses,
    blockedActions,
    verifiedFinalClickBypassKeys,
    subgoalAttempts,
    recentOutcomes,
    serviceNowMissingFieldSearchEvidence,
  } = collections;

  // Two-tier escalation state machine (0=executor, 1=planner). plan-then-act:
  // start at tier 1 (planner) for orientation, then hand off to tier 0
  // (executor). Exception: preferredModelTier="executor" skips orientation.
  const esc = new EscalationTierController({
    startOnPlanner: host.preferredModelTier !== "executor",
    orientationPhaseTurns: ORIENTATION.PHASE_TURNS,
    host: {
      limits: host.limits,
      getTurn: () => host.turnCount,
      deescalateModel: (tabId, prevElementCount) =>
        host.deescalateModel(tabId, prevElementCount),
      addHandoffMessage: () => {
        const briefing = buildHandoffBriefing(
          host.context.getMessages(),
          host.context.getSnapshot(),
        );
        host.context.addMessage({
          role: "user",
          content: HANDOFF_REFLECTION(briefing),
        });
      },
      emitInfoStep: (label) =>
        host.stepHandler(
          {
            id: crypto.randomUUID(),
            type: "info",
            label,
            status: "done",
            timestamp: Date.now(),
          },
          false,
        ),
      logInfo: (message, data) => host.log.info("agent", message, data),
      isStillStuck: () => host.stagnation.isStillStuck(),
      broadcastProgressResolved: (url) =>
        host.broadcast({
          type: "AGENT_STAGNATION",
          payload: {
            signal: "resolved",
            stagnantTurns: 0,
            url,
            message: "Agent is making progress again.",
          },
        }),
      addDeescalationMessage: () =>
        host.context.addMessage({
          role: "user",
          content: DEESCALATION_REFLECTION,
        }),
      resetStagnationEscalation: () => host.stagnation.resetEscalation(),
    },
  });

  const resetStepScopedActionMemory = (): void => {
    if (host.lastPlanIndex === session.lastActionMemoryPlanIndex) return;
    const fromPlanIndex = session.lastActionMemoryPlanIndex;
    const toPlanIndex = host.lastPlanIndex;
    const reset = clearStepScopedActionMemory({
      recentToolCalls,
      recentSuccesses,
      blockedActions,
      verifiedFinalClickBypassKeys,
    });
    session.lastReadElementId = null;
    session.consecutiveReadElementSameId = 0;
    session.lastActionMemoryPlanIndex = toPlanIndex;
    host.traceRecorder?.recordEvent("step_action_memory_reset", {
      turn: host.turnCount,
      fromPlanIndex,
      toPlanIndex,
      ...reset,
    });
  };

  const resetEscalationWorkingMemory = (options?: {
    resetProgressSignals?: boolean;
    resetStepEscalation?: boolean;
    resetZeroEffectTurns?: boolean;
    clearStuckFlag?: boolean;
  }): void => {
    host.stagnation.resetEscalation();
    subgoalAttempts.length = 0;
    recentOutcomes.length = 0;
    serviceNowMissingFieldSearchEvidence.clear();
    session.consecutiveTextOnly = 0;
    recentSuccesses.length = 0;
    if (options?.resetProgressSignals) {
      esc.consecutiveProgressSignals = 0;
    }
    if (options?.resetStepEscalation) {
      session.turnsSinceStepEscalation = -1;
    }
    if (options?.resetZeroEffectTurns) {
      host.consecutiveZeroEffectTurns = 0;
    }
    if (options?.clearStuckFlag) {
      esc.wasStuck = false;
    }
  };

  // Escalation-entry primitive (RFC LP-15, Phase 6): the single invariant write
  // point for the two-tier machine's executor→planner flip. Every escalation
  // trigger routes its tier transition through here so the tier state has one
  // owner; the per-trigger tails stay at the call site. `bumpStepCounter` is
  // false for the two triggers (done-rejection, text-only) that do not count
  // against the per-step escalation budget.
  const beginPlannerEscalation = ({
    bumpStepCounter,
  }: {
    bumpStepCounter: boolean;
  }): void => {
    host.escalateModel();
    if (bumpStepCounter) host.escalationsOnCurrentStep++;
    esc.tier = 1;
    esc.orientationPhase = false;
    esc.plannerModelStartTurn = host.turnCount;
  };

  return {
    esc,
    resetStepScopedActionMemory,
    resetEscalationWorkingMemory,
    beginPlannerEscalation,
  };
}
