/**
 * Durable turn-checkpoint types for service worker restart recovery.
 *
 * A TurnCheckpoint captures enough loop-local state that a fresh AgentLoop
 * instance can resume from roughly the same runtime position. The checkpoint
 * is written at the end of each turn and read on orchestrator recovery.
 */

import type { LLMMessage } from "../llm/types";
import type { LastActionOutcome, PlanStatus } from "./context-types";
import type { ToolName } from "../../types";
import type { CompletionEnvelope } from "./completion-kernel";

// ---------------------------------------------------------------------------
// Turn checkpoint
// ---------------------------------------------------------------------------

export const TURN_CHECKPOINT_VERSION = 1;

export interface TurnCheckpoint {
  version: typeof TURN_CHECKPOINT_VERSION;
  workspaceId: string;
  nodeId: string;
  savedAt: number;

  // Loop runtime counters
  turnCount: number;
  maxTurns: number;
  currentPlanIndex: number;
  turnsOnCurrentStep: number;
  escalationsOnCurrentStep: number;
  guardAfterDoneRejection: boolean;

  // Context / runtime prompt state
  history: CompressedHistory;
  planStatus: PlanStatus | null;
  workingNotes: string;
  lastActionOutcome: LastActionOutcome | null;
  modelTier: "executor" | "planner";
  isFirstTurn: boolean;

  // Resume validation
  snapshotFingerprint: string;
  pageUrl: string | null;

  // Phase 2 — step-scoped mutation ledger
  stepMutationLedger: MutationLedgerEntry[];

  // Phase 4 — side-effects log
  sideEffectsLog: SideEffectEntry[];
  completedResult?: CheckpointCompletedResult;
}

export interface CheckpointCompletedResult {
  outcome: "completed";
  summary: string;
  completionEnvelope?: CompletionEnvelope;
}

// ---------------------------------------------------------------------------
// Compressed history
// ---------------------------------------------------------------------------

export interface CompressedHistory {
  /** Full messages for the most recent turns (assistant + tool pairs). */
  recentMessages: LLMMessage[];
  /** One-line summaries for older turns: "T3: click_element({id:5}) → OK" */
  olderSummaries: string[];
  /** Total message count before compression (for metrics/logging). */
  originalCount: number;
}

// ---------------------------------------------------------------------------
// Step-scoped mutation ledger (Phase 2)
// ---------------------------------------------------------------------------

export interface MutationLedgerEntry {
  /** Canonical key: toolName + canonical args (for lookup). */
  key: string;
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  recordedAt: number;
  /** Plan step index at the time of recording. */
  planIndex: number;
  snapshotFingerprint: string;
}

// ---------------------------------------------------------------------------
// Side-effects log (Phase 4 — persisted but not yet surfaced)
// ---------------------------------------------------------------------------

export interface SideEffectEntry {
  id: string;
  turn: number;
  planIndex: number;
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  timestamp: number;
  snapshotFingerprint: string;
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

export function turnCheckpointKey(
  workspaceId: string,
  nodeId: string,
): string {
  return `opensidebar:turn-checkpoint:${workspaceId}:${nodeId}`;
}

/**
 * Build a canonical key for the mutation ledger.
 * Sorts object keys to avoid misses from key-order variation.
 */
export function buildMutationKey(
  toolName: ToolName | string,
  args: Record<string, unknown>,
): string {
  const sorted = Object.keys(args)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = args[k];
      return acc;
    }, {});
  return `${toolName}:${JSON.stringify(sorted)}`;
}

/**
 * Validate a raw object from storage as a TurnCheckpoint.
 * Returns the checkpoint if valid, null otherwise.
 */
export function sanitizeTurnCheckpoint(
  raw: unknown,
): TurnCheckpoint | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== TURN_CHECKPOINT_VERSION) return null;
  if (typeof obj.workspaceId !== "string") return null;
  if (typeof obj.nodeId !== "string") return null;
  if (typeof obj.turnCount !== "number") return null;
  if (
    obj.completedResult !== undefined &&
    !sanitizeCheckpointCompletedResult(obj.completedResult)
  ) {
    return null;
  }
  return obj as unknown as TurnCheckpoint;
}

function sanitizeCheckpointCompletedResult(
  raw: unknown,
): CheckpointCompletedResult | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.outcome !== "completed") return null;
  if (typeof obj.summary !== "string") return null;
  if (
    obj.completionEnvelope !== undefined &&
    !sanitizeCompletionEnvelope(obj.completionEnvelope)
  ) {
    return null;
  }
  return obj as unknown as CheckpointCompletedResult;
}

function sanitizeCompletionEnvelope(raw: unknown): CompletionEnvelope | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.status !== "completed") return null;
  if (typeof obj.resultId !== "string" || obj.resultId.length === 0) return null;
  if (obj.source !== "model_done" && obj.source !== "trusted_tool") return null;
  if (typeof obj.contractKind !== "string" || obj.contractKind.length === 0) {
    return null;
  }
  if (
    typeof obj.decisionReason !== "string" ||
    obj.decisionReason.length === 0
  ) {
    return null;
  }
  if (
    !Array.isArray(obj.evidenceKeys) ||
    obj.evidenceKeys.some((key) => typeof key !== "string")
  ) {
    return null;
  }
  if (
    typeof obj.evidenceEpoch !== "string" ||
    obj.evidenceEpoch.length === 0
  ) {
    return null;
  }
  return obj as unknown as CompletionEnvelope;
}
