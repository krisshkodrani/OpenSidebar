import type {
  PartialHandoffReason,
  PartialProgressHandoff,
  SessionMetrics,
  SubtaskSummary,
  ToolName,
} from "../../types";
import { formatStepLabel, type ElementResolver } from "../../utils/step-labels";
import type { ContextManager } from "./context";
import {
  planTerminationMessage,
  type BroadcastMessage,
} from "./agent-broadcast";
import {
  buildPartialProgressHandoff,
  recordProgressLedgerToolResult,
  updateProgressLedgerState,
  type ProgressLedger,
} from "./partial-progress-handoff";
import { getActiveSubtaskDescription } from "./loop-queries";

export interface PartialProgressRuntimeHost {
  readonly progressLedger: ProgressLedger;
  readonly context: Pick<
    ContextManager,
    "getSnapshot" | "getCurrentUrl" | "getPlanStatusRaw"
  >;
  readonly planSubtasks: SubtaskSummary[];
  readonly lastPlanIndex: number;
  readonly elementResolver: ElementResolver | undefined;
  readonly originalQuery: string;
  readonly turnCount: number;
  readonly maxTurns: number;
  readonly taskId: string | null;
  readonly taskStartTime: number;
  readonly urlHistory: string[];
  getMetrics(): SessionMetrics;
  broadcast(message: BroadcastMessage): void;
}

/** Keep partial handoff receipts and terminal plan reporting together. */
export class PartialProgressRuntime {
  constructor(private readonly host: PartialProgressRuntimeHost) {}

  updatePartialProgressState(lastAction?: string): void {
    updateProgressLedgerState(
      this.host.progressLedger,
      this.host.context.getSnapshot?.() ?? null,
      getActiveSubtaskDescription(this.host),
      lastAction,
    );
  }

  recordPartialProgressToolResult(
    toolName: ToolName,
    args: Record<string, unknown>,
    result: string,
  ): void {
    const lastAction = formatStepLabel(
      toolName,
      args,
      this.host.elementResolver,
    );
    this.updatePartialProgressState(lastAction);
    recordProgressLedgerToolResult(this.host.progressLedger, {
      toolName,
      args,
      result,
      turn: this.host.turnCount,
      url:
        this.host.context.getCurrentUrl?.() ||
        this.host.context.getSnapshot()?.url,
    });
  }

  buildMaxTurnPartialHandoff(
    reason: PartialHandoffReason = "max_turns",
  ): PartialProgressHandoff {
    this.updatePartialProgressState();
    return buildPartialProgressHandoff({
      ledger: this.host.progressLedger,
      task: this.host.originalQuery,
      reason,
      turnsUsed: this.host.turnCount,
      maxTurns: this.host.maxTurns,
    });
  }

  broadcastPlanTermination(
    outcome: "stopped" | "max_turns" | "error",
    summary: string,
    partialHandoff?: PartialProgressHandoff,
  ): void {
    const message = planTerminationMessage({
      taskId: this.host.taskId,
      subtasks: this.host.planSubtasks,
      outcome,
      summary,
      turnCount: this.host.turnCount,
      maxTurns: this.host.maxTurns,
      totalTimeMs: Date.now() - this.host.taskStartTime,
      urlHistory: this.host.urlHistory,
      metrics: this.host.getMetrics(),
      partialHandoff,
    });
    if (message) this.host.broadcast(message);
  }
}
