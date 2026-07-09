/**
 * turn checkpoint persistence (RFC LP-16 Phase 3 — loop.ts landmine decomposition).
 *
 * Save / restore / clear the durable per-turn checkpoint the orchestrator injects
 * for service-worker restart recovery: serialize loop-runtime counters + context
 * history + ledger into a TurnCheckpoint, restore them back onto the loop, and
 * clear the record on teardown. Extracted verbatim from loop() via the
 * dispatch-host idiom (loop() passes `this`); behavior-preserving.
 */

import type { ContextManager } from "./context";
import type { LLMClient } from "../llm";
import type { CheckpointCoordinator } from "./checkpoint-coordinator";
import type { logger, SessionScopedLogger } from "../../utils";
import type { CompletionEnvelope } from "./completion-kernel";
import { TURN_CHECKPOINT_VERSION, type TurnCheckpoint } from "./checkpoint-types";
import { getSnapshotFingerprint } from "./loop-helpers";
import { applySkillTurnCap } from "./skill-turn-cap-policy";

type CompletedResult = {
  outcome: "completed";
  summary: string;
  completionEnvelope?: CompletionEnvelope;
} | null;

export interface TurnCheckpointHost {
  turnCount: number;
  maxTurns: number;
  lastPlanIndex: number;
  turnsOnCurrentStep: number;
  escalationsOnCurrentStep: number;
  guardAfterDoneRejection: boolean;
  completedResult: CompletedResult;
  readonly nodeId: string | null;
  readonly workspaceId: string | null;
  readonly selectedSkillId: string | null;
  readonly context: ContextManager;
  readonly llm: LLMClient;
  readonly checkpoints: CheckpointCoordinator;
  readonly log: typeof logger | SessionScopedLogger;
}

export async function saveTurnCheckpoint(
host: TurnCheckpointHost,
): Promise<void> {
  if (!host.nodeId || !host.workspaceId) return;
  try {
    const snapshot = host.context.getSnapshot?.() ?? null;
    const cp: TurnCheckpoint = {
      version: TURN_CHECKPOINT_VERSION,
      workspaceId: host.workspaceId,
      nodeId: host.nodeId,
      savedAt: Date.now(),

      // Loop runtime
      turnCount: host.turnCount,
      maxTurns: host.maxTurns,
      currentPlanIndex: host.lastPlanIndex,
      turnsOnCurrentStep: host.turnsOnCurrentStep,
      escalationsOnCurrentStep: host.escalationsOnCurrentStep,
      guardAfterDoneRejection: host.guardAfterDoneRejection,

      // Context / prompt state
      history: host.context.exportForCheckpoint(),
      planStatus: host.context.getPlanStatusRaw(),
      workingNotes: host.context.getWorkingNotes(),
      lastActionOutcome: host.context.getLastActionOutcome(),
      modelTier: host.llm.isPlannerTier() ? "planner" : "executor",
      isFirstTurn: host.context.getIsFirstTurn(),

      // Resume validation
      snapshotFingerprint: getSnapshotFingerprint(snapshot),
      pageUrl: snapshot?.url ?? null,

      // Phase 2
      stepMutationLedger: host.checkpoints.entries,

      // Phase 4
      sideEffectsLog: host.checkpoints.sideEffects,
      completedResult: host.completedResult
        ? {
            outcome: "completed",
            summary: host.completedResult.summary,
            ...(host.completedResult.completionEnvelope
              ? {
                  completionEnvelope:
                    host.completedResult.completionEnvelope,
                }
              : {}),
          }
        : undefined,
    };
    await host.checkpoints.persist(host.workspaceId, host.nodeId, cp);
  } catch (e) {
    host.log.warn("agent", "Failed to save turn checkpoint", { error: e });
  }
}

export function restoreFromTurnCheckpoint(
host: TurnCheckpointHost,
cp: TurnCheckpoint,
): boolean {
  try {
    // Runtime counters
    host.turnCount = cp.turnCount;
    host.maxTurns = applySkillTurnCap(
      host.selectedSkillId,
      Math.max(host.maxTurns, cp.maxTurns),
    );
    host.lastPlanIndex = cp.currentPlanIndex;
    host.turnsOnCurrentStep = cp.turnsOnCurrentStep;
    host.escalationsOnCurrentStep = cp.escalationsOnCurrentStep;
    host.guardAfterDoneRejection = cp.guardAfterDoneRejection;

    // Context / history
    host.context.restoreFromCheckpointHistory(cp.history, cp.isFirstTurn);
    if (cp.planStatus) {
      host.context.setPlanStatus(
        cp.planStatus.subtasks,
        cp.planStatus.currentIndex,
      );
    }
    if (cp.workingNotes) {
      host.context.setWorkingNotes(cp.workingNotes);
    }
    if (cp.lastActionOutcome) {
      host.context.setLastActionOutcome(cp.lastActionOutcome);
    }
    if (cp.modelTier === "planner") {
      host.llm.switchToPlanner();
    } else {
      host.llm.switchToExecutor();
    }

    host.checkpoints.restoreLedger(cp.stepMutationLedger, cp.sideEffectsLog);
    host.completedResult = cp.completedResult
      ? {
          outcome: "completed",
          summary: cp.completedResult.summary,
          ...(cp.completedResult.completionEnvelope
            ? { completionEnvelope: cp.completedResult.completionEnvelope }
            : {}),
        }
      : null;

    host.log.info("agent", "Restored from turn checkpoint", {
      turn: cp.turnCount,
      historyMessages: cp.history.originalCount,
      ledgerEntries: host.checkpoints.entries.length,
      sideEffects: host.checkpoints.sideEffects.length,
      completed: Boolean(host.completedResult),
    });
    return true;
  } catch (e) {
    host.log.warn("agent", "Failed to restore turn checkpoint", { error: e });
    return false;
  }
}

export async function clearTurnCheckpoint(
host: TurnCheckpointHost,
): Promise<void> {
  if (!host.nodeId || !host.workspaceId) return;
  try {
    await host.checkpoints.clear(host.workspaceId, host.nodeId);
  } catch {
    // Best-effort cleanup
  }
}
