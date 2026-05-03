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
  tabId: number;
  initialScrollY: number | null;
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
  scrollContentScript: (
    tabId: number,
    y: number,
    timeoutMs: number,
  ) => Promise<unknown>;
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

  if (deps.initialScrollY !== null && result.outcome === "completed") {
    try {
      await deps.scrollContentScript(deps.tabId, deps.initialScrollY, 1500);
    } catch (error) {
      deps.traceRecorder?.recordEvent("terminal_cleanup_timeout", {
        phase: "restore_scroll",
        tabId: deps.tabId,
        targetScrollY: deps.initialScrollY,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
