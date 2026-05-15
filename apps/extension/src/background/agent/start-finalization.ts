import type { SubtaskSummary } from "../../types";
import { summarizeHistory } from "./context";
import type { ContextManager } from "./context";
import type { EvidenceAccumulator } from "./evidence";
import type { LoopResult } from "./loop-types";
import type { MutationLedger } from "./mutation-ledger";
import type { ToolResultCache } from "./tool-cache";
import type { TraceRecorder } from "./trace";

export type FinalizeStartResultDeps = {
  result: LoopResult;
  taskId: string | null;
  planSubtasks: SubtaskSummary[];
  mutationLedger: MutationLedger;
  evidenceAccumulator: EvidenceAccumulator;
  context: Pick<ContextManager, "getMessages">;
  traceRecorder: TraceRecorder | null;
  toolCache: ToolResultCache;
  clearTurnCheckpoint: () => Promise<void>;
  broadcastPlanTermination: (
    outcome: "stopped" | "max_turns" | "error",
    summary: string,
  ) => void;
  setRunning: (isRunning: boolean) => void;
  clearTraceRecorder: () => void;
};

export async function finalizeStartResult(
  deps: FinalizeStartResultDeps,
): Promise<void> {
  const { result } = deps;

  result.sideEffectsLog = [...deps.mutationLedger.sideEffects];
  result.evidence = deps.evidenceAccumulator.toArray();

  if (
    result.outcome !== "awaiting_approval" &&
    result.outcome !== "awaiting_clarification"
  ) {
    deps.clearTurnCheckpoint().catch(() => {});
  }

  if (
    result.outcome !== "completed" &&
    result.outcome !== "awaiting_approval" &&
    result.outcome !== "awaiting_clarification" &&
    deps.taskId &&
    deps.planSubtasks.length > 0
  ) {
    deps.broadcastPlanTermination(
      result.outcome as "stopped" | "max_turns" | "error",
      result.summary,
    );
  }

  deps.setRunning(false);

  try {
    const trajectory = summarizeHistory(deps.context.getMessages(), 20);
    if (trajectory.length > 0) {
      result.trajectory = trajectory;
    }
  } catch {
    // Best-effort handoff context.
  }

  if (deps.traceRecorder) {
    deps.traceRecorder.recordEvent("tool_cache_stats", {
      ...deps.toolCache.getStats(),
    } as Record<string, unknown>);
    await deps.traceRecorder.finalize(
      result.outcome,
      result.summary,
      result.turnCount,
      result.failure ?? null,
      result.metrics ?? null,
    );
    deps.clearTraceRecorder();
  }
}
