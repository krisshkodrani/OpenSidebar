import { AgentStatus } from "../../types";
import type { logger } from "../../utils";
import type { BroadcastMessage } from "./agent-broadcast";
import type { LoopResult, PendingUserInteraction } from "./loop-types";

type StartResultLogger = Pick<typeof logger, "error" | "info">;

export class PendingInteractionYield extends Error {
  constructor(readonly pendingInteraction: PendingUserInteraction) {
    super(
      pendingInteraction.kind === "approval"
        ? "Awaiting approval"
        : "Awaiting clarification",
    );
    this.name = "PendingInteractionYield";
  }
}

export type RunStartExecutionDeps = {
  run: () => Promise<LoopResult>;
  getTurnCount: () => number;
  getCompletedResult?: () => Pick<
    LoopResult,
    "summary" | "completionEnvelope"
  > | null;
  nodeId: string | null;
  log: StartResultLogger;
  getMetrics: () => LoopResult["metrics"];
  broadcast: (message: BroadcastMessage) => void;
  finishStream: () => void;
  statusHandler: (status: AgentStatus, detail: string) => void;
};

export async function runStartExecution(
  deps: RunStartExecutionDeps,
): Promise<LoopResult> {
  try {
    return await deps.run();
  } catch (error: unknown) {
    const turnCount = deps.getTurnCount();
    const err = error as { name?: string; message?: string };
    if (err.name === "AbortError") {
      deps.log.info("agent", "Agent stopped by user");
      deps.statusHandler(AgentStatus.IDLE, "Stopped");
      return {
        outcome: "stopped",
        turnCount,
        summary: "Stopped by user",
        failure: {
          category: "user",
          code: "user_stopped",
          detail: "Stopped by user",
        },
        metrics: deps.getMetrics(),
      };
    }

    const completedResult = deps.getCompletedResult?.();
    if (completedResult) {
      deps.log.info(
        "agent",
        "Preserving terminal completion after late boundary event",
        {
          nodeId: deps.nodeId,
          turn: turnCount,
          error:
            error instanceof PendingInteractionYield
              ? error.name
              : (err.message ?? "Unknown error"),
          resultId: completedResult.completionEnvelope?.resultId,
          contractKind: completedResult.completionEnvelope?.contractKind,
        },
      );
      return {
        outcome: "completed",
        turnCount,
        summary: completedResult.summary,
        failure: { category: "none", code: "none" },
        metrics: deps.getMetrics(),
        completionEnvelope: completedResult.completionEnvelope,
      };
    }

    if (error instanceof PendingInteractionYield) {
      const awaitingSummary =
        error.pendingInteraction.kind === "approval"
          ? "Awaiting approval"
          : "Awaiting clarification";
      deps.log.info("agent", "Loop yielded for user interaction", {
        outcome:
          error.pendingInteraction.kind === "approval"
            ? "awaiting_approval"
            : "awaiting_clarification",
        nodeId: deps.nodeId,
        turn: turnCount,
      });
      return {
        outcome:
          error.pendingInteraction.kind === "approval"
            ? "awaiting_approval"
            : "awaiting_clarification",
        turnCount,
        summary: awaitingSummary,
        failure: { category: "none", code: "none" },
        metrics: deps.getMetrics(),
        pendingInteraction: error.pendingInteraction,
      };
    }

    const message = err.message ?? "Unknown error";
    deps.log.error("agent", "Loop Error", { error });
    const errorMsg = `Agent stopped: ${message}. Send a follow-up message to retry.`;
    deps.broadcast({
      type: "STREAM_CHUNK",
      payload: { delta: "", done: false, replaceContent: errorMsg },
    });
    deps.finishStream();
    deps.statusHandler(AgentStatus.ERROR, message);
    return {
      outcome: "error",
      turnCount,
      summary: message,
      failure: {
        category: "runtime",
        code: "runtime_error",
        detail: message,
      },
      metrics: deps.getMetrics(),
    };
  }
}
