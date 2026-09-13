import type { CompletionEnvelope } from "../agent/completion-kernel";
import type { TokenUsage } from "../llm/types";
import {
  createHttpRunTraceWriter,
  logger,
  type RunManifest,
  RunTraceWriter,
} from "../../utils";
import { buildTabCoordinationTraceData } from "./tab-coordination-trace";
import type { OrchestratorTask, TaskNode } from "./types";

type TraceTask =
  | { runId?: string; id?: string; workspaceId?: string }
  | null
  | undefined;

export class OrchestratorTraceEmitter {
  private readonly writer = createHttpRunTraceWriter();
  private readonly fallbackWriter = new RunTraceWriter(async (record) => {
    if (record.kind === "manifest") {
      logger.debug("trace", "Run trace manifest", {
        runId: record.manifest.runId,
        source: record.manifest.source,
        environment: record.manifest.environment,
        promptCount: record.manifest.promptSet.length,
        taskId: record.manifest.taskId,
        workspaceId: record.manifest.workspaceId,
      });
      return;
    }
    logger.debug("trace", "Run trace event", {
      runId: record.event.runId,
      type: record.event.type,
      role: record.event.role,
      turn: record.event.turn,
    });
  });

  async emitManifest(manifest: RunManifest): Promise<void> {
    try {
      await this.writer.emitManifest(manifest);
    } catch (error) {
      logger.debug("trace", "Failed to emit orchestrator trace manifest", {
        error: error instanceof Error ? error.message : String(error),
      });
      await this.fallbackWriter.emitManifest(manifest);
    }
  }

  emitEvent(
    task: TraceTask,
    type: string,
    data?: Record<string, unknown>,
    role?: "planner" | "executor" | "verifier" | "system",
  ): void {
    if (!task?.runId) return;
    void this.writer
      .emitEvent({
        runId: task.runId,
        correlationId: task.runId,
        type,
        role,
        data,
      })
      .catch((error) => {
        logger.debug("trace", "Failed to emit orchestrator trace event", {
          runId: task.runId,
          type,
          error: error instanceof Error ? error.message : String(error),
        });
        void this.fallbackWriter.emitEvent({
          runId: task.runId!,
          correlationId: task.runId,
          type,
          role,
          data,
        });
      });
  }

  emitCompletionScopeTransition(
    task: (TraceTask & { nodes?: TaskNode[] }) | null | undefined,
    data: {
      scope: "lane" | "node" | "root";
      status: "completed" | "sibling_ignored";
      nodeId?: string;
      reason: string;
      envelope?: CompletionEnvelope;
      skippedNodeIds?: string[];
    },
  ): void {
    this.emitEvent(
      task,
      "completion_scope_transition",
      {
        taskId: task?.id,
        scope: data.scope,
        status: data.status,
        nodeId: data.nodeId,
        reason: data.reason,
        ...(data.envelope
          ? {
              resultId: data.envelope.resultId,
              source: data.envelope.source,
              contractKind: data.envelope.contractKind,
              evidenceKeys: data.envelope.evidenceKeys,
            }
          : {}),
        ...(data.skippedNodeIds ? { skippedNodeIds: data.skippedNodeIds } : {}),
        ...(task?.nodes
          ? {
              pendingNodes: task.nodes.filter((node) => node.status === "pending")
                .length,
              runningNodes: task.nodes.filter((node) => node.status === "running")
                .length,
              completedNodes: task.nodes.filter(
                (node) => node.status === "completed",
              ).length,
            }
          : {}),
      },
      "system",
    );
  }

  attachPlannerUsage(
    planner: unknown,
    task: TraceTask,
    phase: () => string,
  ): void {
    const maybePlanner = planner as {
      setUsageCallback?: (
        cb: ((usage: TokenUsage, llmMs: number, model: string) => void) | null,
      ) => void;
    };
    if (typeof maybePlanner.setUsageCallback !== "function") return;

    maybePlanner.setUsageCallback((usage, llmMs, model) => {
      this.emitEvent(
        task,
        "planner_llm_call",
        {
          phase: phase(),
          model,
          durationMs: llmMs,
          usage: {
            prompt_tokens: usage.prompt_tokens,
            completion_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens,
            cost: usage.cost,
            cached_tokens: usage.cached_tokens,
            cacheTelemetry: usage.cacheTelemetry,
          },
        },
        "planner",
      );
    });
  }

  emitNodeFailure(
    task: OrchestratorTask,
    node: TaskNode,
    reason: string,
    detail?: Record<string, unknown>,
  ): void {
    this.emitEvent(
      task,
      "node_failure_attribution",
      { taskId: task.id, nodeId: node.id, reason, ...(detail ?? {}) },
      "system",
    );
  }

  emitTabCoordinationState(
    task: OrchestratorTask,
    action: string,
    detail: Record<string, unknown> = {},
  ): void {
    this.emitEvent(
      task,
      "tab_coordination_state",
      buildTabCoordinationTraceData(task, { action, ...detail }),
      "system",
    );
  }
}
