import { logger } from "../../utils";
import type { OrchestratorTask } from "./types";
import {
  LaneIsolationError,
  LaneTimeoutError,
  type LaneRuntimeState,
  type LaneSupervisorState,
  type QueuedLaneOperation,
  type RuntimeLane,
  type WorkspaceLanePools,
} from "./lane-types";
import {
  beginLaneOperation,
  recordLaneOperationFailure,
  recordLaneOperationSuccess,
  registerLaneOperation,
  releaseLaneOperation,
  releaseLaneOperationRegistration,
} from "./lane-supervisor";
import { emitLaneIsolationStep } from "./status-emitters";

export interface LaneOperationRuntimeHost {
  getLaneRuntimeState(workspaceId: string, lane: RuntimeLane): LaneRuntimeState;
  getLaneSupervisorState(workspaceId: string, lane: RuntimeLane): LaneSupervisorState;
  getWorkspaceLanePools(workspaceId: string): WorkspaceLanePools;
  stopExecutorWorkerForNode(workspaceId: string, nodeId: string, reason: string): void;
  emitTraceEvent(
    task: Pick<OrchestratorTask, "id" | "workspaceId">,
    type: string,
    data: Record<string, unknown>,
    role: RuntimeLane,
  ): void;
  emitLaneSupervisorActivity(workspaceId: string): void;
  drainLaneQueue(workspaceId: string, lane: RuntimeLane): Promise<void>;
}

export async function executeLaneOperation<T>(
  host: LaneOperationRuntimeHost,
  task: Pick<OrchestratorTask, "id" | "workspaceId">,
  lane: RuntimeLane,
  queued: QueuedLaneOperation,
): Promise<T> {
  const state = host.getLaneRuntimeState(task.workspaceId, lane);
  const supervisor = host.getLaneSupervisorState(task.workspaceId, lane);
  beginLaneOperation(state, supervisor);
  const startedAt = Date.now();
  const laneOperationId =
    lane === "executor" ? null : `${lane}-op-${crypto.randomUUID()}`;
  const registration = laneOperationId
    ? registerLaneOperation({
        pools: host.getWorkspaceLanePools(task.workspaceId),
        lane,
        queued,
        startedAt,
        timeoutMs: state.policy.maxCallMs,
        operationId: laneOperationId,
      })
    : null;
  if (registration) {
    logger.debug("orchestrator", "Lane operation registered", {
      taskId: queued.taskId,
      workspaceId: queued.workspaceId,
      lane,
      operationId: registration.operationId,
      activeLaneOperations: registration.activeLaneOperations,
      queueLatencyMs: registration.queueLatencyMs,
    });
  }
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeout = new Promise<never>(
      (_, reject) =>
        (timeoutId = setTimeout(
          () => reject(new LaneTimeoutError(lane, state.policy.maxCallMs)),
          state.policy.maxCallMs,
        )),
    );
    const result = (await Promise.race([queued.operation(), timeout])) as T;
    recordLaneOperationSuccess({
      state,
      supervisor,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      error instanceof LaneTimeoutError &&
      lane === "executor" &&
      queued.nodeId
    ) {
      host.stopExecutorWorkerForNode(
        task.workspaceId,
        queued.nodeId,
        `Lane timeout after ${state.policy.maxCallMs}ms`,
      );
    }
    const failure = recordLaneOperationFailure({
      state,
      supervisor,
      message,
      durationMs: Date.now() - startedAt,
    });
    logger.warn("orchestrator", "Lane execution failed", {
      workspaceId: task.workspaceId,
      taskId: task.id,
      lane,
      failures: state.failures,
      maxFailuresBeforeIsolation: state.policy.maxFailuresBeforeIsolation,
      error: message,
      laneRestartCount: supervisor.restartCount,
      laneConsecutiveCrashes: supervisor.consecutiveCrashes,
      backoffMs: failure.backoffMs,
    });
    if (failure.isolated) {
      logger.warn("orchestrator", "Lane isolated", {
        workspaceId: task.workspaceId,
        taskId: task.id,
        lane,
        isolatedUntilMs: state.isolatedUntilMs,
        detail: failure.detail,
      });
      host.emitTraceEvent(
        task,
        "lane_isolated",
        {
          taskId: task.id,
          workspaceId: task.workspaceId,
          lane,
          failures: state.failures,
          isolatedUntilMs: state.isolatedUntilMs,
          detail: failure.detail,
        },
        lane,
      );
      emitLaneIsolationStep(task.workspaceId, state, failure.detail);
      throw new LaneIsolationError(
        lane,
        state.policy.isolationCooldownMs,
        message,
      );
    }

    logger.warn("orchestrator", "Lane supervisor backoff", {
      workspaceId: task.workspaceId,
      taskId: task.id,
      lane,
      backoffMs: failure.backoffMs,
      circuitOpenUntilMs: supervisor.circuitOpenUntilMs,
      restartCount: supervisor.restartCount,
      queueDepth: supervisor.queue.length,
    });
    host.emitLaneSupervisorActivity(task.workspaceId);
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (laneOperationId) {
      const activeLaneOperations = releaseLaneOperationRegistration({
        pools: host.getWorkspaceLanePools(task.workspaceId),
        lane,
        operationId: laneOperationId,
      });
      logger.debug("orchestrator", "Lane operation released", {
        taskId: task.id,
        workspaceId: task.workspaceId,
        lane,
        operationId: laneOperationId,
        activeLaneOperations,
      });
    }
    releaseLaneOperation(state, supervisor);
    host.emitLaneSupervisorActivity(task.workspaceId);
    void host.drainLaneQueue(task.workspaceId, lane);
  }
}
