import { WorkerInstance } from "./types";
import {
  DEFAULT_LANE_POLICIES,
  LaneBudgetPolicy,
  LaneIsolationError,
  LaneOperationInstance,
  LaneRuntimeState,
  LaneSupervisorState,
  QueuedLaneOperation,
  RuntimeLane,
  WorkspaceLanePools,
} from "./lane-types";
import type { LaneTopologyConfig } from "./lane-topology";
import { mergeLaneTopologyPolicies } from "./lane-topology";
import { clampInteger } from "./utils";

export type LanePolicyOverrides = Partial<
  Record<RuntimeLane, Partial<LaneBudgetPolicy>>
>;

export type WorkspaceLaneRuntime = Record<RuntimeLane, LaneRuntimeState>;
export type WorkspaceLaneSupervisors = Record<
  RuntimeLane,
  LaneSupervisorState
>;

export type LaneTelemetrySnapshot = {
  timestamp: number;
  lanes: Record<
    RuntimeLane,
    {
      activeCalls: number;
      queueDepth: number;
      restartCount: number;
      consecutiveCrashes: number;
      circuitOpenUntilMs: number;
      lastCrashError?: string;
    }
  >;
};

export type LaneFailureUpdate =
  | {
      message: string;
      backoffMs: number;
      isolated: false;
    }
  | {
      message: string;
      backoffMs: number;
      isolated: true;
      isolatedUntilMs: number;
      detail: string;
    };

export type LaneDrainDecision =
  | {
      action: "isolated";
      pending: QueuedLaneOperation[];
      error: LaneIsolationError;
    }
  | { action: "wait"; waitMs: number }
  | { action: "idle" }
  | { action: "capacity" }
  | { action: "execute"; queued: QueuedLaneOperation };

export type EnqueuedLaneOperation<T> = {
  operationId: string;
  queued: boolean;
  queueDepth: number;
  promise: Promise<T>;
};

export type LaneOperationRegistration = {
  operationId: string;
  activeLaneOperations: number;
  queueLatencyMs: number;
};

export function buildLanePolicy(args: {
  lane: RuntimeLane;
  maxWorkers?: number;
  overrides?: LanePolicyOverrides;
}): LaneBudgetPolicy {
  const { lane, maxWorkers, overrides } = args;
  const base = DEFAULT_LANE_POLICIES[lane];
  const override = overrides?.[lane] ?? {};
  const runtimeDefaultMaxConcurrent =
    lane === "executor" || lane === "verifier"
      ? maxWorkers || base.maxConcurrent
      : base.maxConcurrent;

  return {
    maxConcurrent: clampInteger(
      override.maxConcurrent ?? runtimeDefaultMaxConcurrent,
      1,
      8,
    ),
    maxFailuresBeforeIsolation: clampInteger(
      override.maxFailuresBeforeIsolation ?? base.maxFailuresBeforeIsolation,
      1,
    ),
    isolationCooldownMs: clampInteger(
      override.isolationCooldownMs ?? base.isolationCooldownMs,
      1_000,
    ),
    maxCallMs: clampInteger(override.maxCallMs ?? base.maxCallMs, 1_000),
  };
}

export function createWorkspaceLanePools(): WorkspaceLanePools {
  return {
    planner: new Map<string, LaneOperationInstance>(),
    executor: new Map<string, WorkerInstance>(),
    verifier: new Map<string, LaneOperationInstance>(),
  };
}

export function createLaneSupervisor(
  lane: RuntimeLane,
): LaneSupervisorState {
  return {
    lane,
    queue: [],
    active: 0,
    draining: false,
    restartCount: 0,
    consecutiveCrashes: 0,
    circuitOpenUntilMs: 0,
    resumeTimer: null,
  };
}

export function createWorkspaceLaneSupervisors(): WorkspaceLaneSupervisors {
  return {
    planner: createLaneSupervisor("planner"),
    executor: createLaneSupervisor("executor"),
    verifier: createLaneSupervisor("verifier"),
  };
}

export function createWorkspaceLaneRuntime(args: {
  maxWorkers: number;
  overrides?: LanePolicyOverrides;
  topology?: LaneTopologyConfig;
}): WorkspaceLaneRuntime {
  const overrides = args.topology
    ? mergeLaneTopologyPolicies({
        topology: args.topology,
        overrides: args.overrides,
      })
    : args.overrides;
  const build = (lane: RuntimeLane): LaneRuntimeState => ({
    lane,
    activeCalls: 0,
    totalCalls: 0,
    failures: 0,
    totalDurationMs: 0,
    isolatedUntilMs: 0,
    policy: buildLanePolicy({
      lane,
      maxWorkers: args.maxWorkers,
      overrides,
    }),
  });

  return {
    planner: build("planner"),
    executor: build("executor"),
    verifier: build("verifier"),
  };
}

export function clearLaneSupervisorTimers(
  supervisors?: Partial<WorkspaceLaneSupervisors>,
): void {
  for (const lane of ["planner", "executor", "verifier"] as const) {
    const supervisor = supervisors?.[lane];
    if (supervisor?.resumeTimer) clearTimeout(supervisor.resumeTimer);
  }
}

export function isLaneIsolated(state: LaneRuntimeState): boolean {
  return state.isolatedUntilMs > Date.now();
}

export function enqueueLaneOperation<T>(args: {
  taskId: string;
  workspaceId: string;
  lane: RuntimeLane;
  state: LaneRuntimeState;
  supervisor: LaneSupervisorState;
  operation: () => Promise<T>;
  metadata?: { label?: string; nodeId?: string };
  operationId: string;
  now?: number;
}): EnqueuedLaneOperation<T> {
  const {
    taskId,
    workspaceId,
    lane,
    state,
    supervisor,
    operation,
    metadata,
    operationId,
  } = args;
  const now = args.now ?? Date.now();
  if (state.isolatedUntilMs > now) {
    return {
      operationId,
      queued: false,
      queueDepth: supervisor.queue.length,
      promise: Promise.reject(
        new LaneIsolationError(
          lane,
          state.isolatedUntilMs - now,
          state.lastError,
        ),
      ),
    };
  }

  const promise = new Promise<T>((resolve, reject) => {
    supervisor.queue.push({
      operationId,
      taskId,
      workspaceId,
      label: metadata?.label || `${lane} lane call`,
      nodeId: metadata?.nodeId,
      enqueuedAt: now,
      operation: operation as () => Promise<unknown>,
      resolve: resolve as (value: unknown) => void,
      reject,
    });
  });

  return {
    operationId,
    queued: true,
    queueDepth: supervisor.queue.length,
    promise,
  };
}

export function registerLaneOperation(args: {
  pools: WorkspaceLanePools;
  lane: RuntimeLane;
  queued: QueuedLaneOperation;
  startedAt: number;
  timeoutMs: number;
  operationId: string;
}): LaneOperationRegistration | null {
  const { pools, lane, queued, startedAt, timeoutMs, operationId } = args;
  if (lane === "executor") return null;

  const op: LaneOperationInstance = {
    operationId,
    lane,
    taskId: queued.taskId,
    workspaceId: queued.workspaceId,
    startedAt,
    timeoutMs,
    label: queued.label,
    nodeId: queued.nodeId,
  };
  pools[lane].set(operationId, op);

  return {
    operationId,
    activeLaneOperations: pools[lane].size,
    queueLatencyMs: startedAt - queued.enqueuedAt,
  };
}

export function releaseLaneOperationRegistration(args: {
  pools: WorkspaceLanePools;
  lane: RuntimeLane;
  operationId: string | null;
}): number | null {
  const { pools, lane, operationId } = args;
  if (!operationId || lane === "executor") return null;
  pools[lane].delete(operationId);
  return pools[lane].size;
}

export function beginLaneOperation(
  state: LaneRuntimeState,
  supervisor: LaneSupervisorState,
): void {
  supervisor.active += 1;
  state.activeCalls = supervisor.active;
  state.totalCalls += 1;
}

export function recordLaneOperationSuccess(args: {
  state: LaneRuntimeState;
  supervisor: LaneSupervisorState;
  durationMs: number;
}): void {
  const { state, supervisor, durationMs } = args;
  state.totalDurationMs += durationMs;
  if (state.failures > 0) {
    state.failures = Math.max(0, state.failures - 1);
  }
  supervisor.consecutiveCrashes = 0;
}

export function recordLaneOperationFailure(args: {
  state: LaneRuntimeState;
  supervisor: LaneSupervisorState;
  message: string;
  durationMs: number;
  now?: number;
}): LaneFailureUpdate {
  const { state, supervisor, message, durationMs } = args;
  const now = args.now ?? Date.now();
  state.failures += 1;
  state.lastError = message;
  state.totalDurationMs += durationMs;
  supervisor.restartCount += 1;
  supervisor.consecutiveCrashes += 1;
  supervisor.lastCrashAtMs = now;
  supervisor.lastCrashError = message;

  const backoffMs = Math.min(
    250 * 2 ** Math.max(0, supervisor.consecutiveCrashes - 1),
    5_000,
  );

  if (state.failures >= state.policy.maxFailuresBeforeIsolation) {
    state.isolatedUntilMs = now + state.policy.isolationCooldownMs;
    const detail =
      `${state.lane} lane entered cooldown after ${state.failures} failure(s). ` +
      `Cooldown=${state.policy.isolationCooldownMs}ms. Last error: ${message}`;
    return {
      message,
      backoffMs,
      isolated: true,
      isolatedUntilMs: state.isolatedUntilMs,
      detail,
    };
  }

  supervisor.circuitOpenUntilMs = now + backoffMs;
  return {
    message,
    backoffMs,
    isolated: false,
  };
}

export function releaseLaneOperation(
  state: LaneRuntimeState,
  supervisor: LaneSupervisorState,
): void {
  supervisor.active = Math.max(0, supervisor.active - 1);
  state.activeCalls = supervisor.active;
}

export function getNextLaneDrainDecision(args: {
  lane: RuntimeLane;
  state: LaneRuntimeState;
  supervisor: LaneSupervisorState;
  now?: number;
}): LaneDrainDecision {
  const { lane, state, supervisor } = args;
  const now = args.now ?? Date.now();
  if (state.isolatedUntilMs > now) {
    const remainingMs = state.isolatedUntilMs - now;
    return {
      action: "isolated",
      pending: supervisor.queue.splice(0, supervisor.queue.length),
      error: new LaneIsolationError(lane, remainingMs, state.lastError),
    };
  }

  if (supervisor.circuitOpenUntilMs > now) {
    return {
      action: "wait",
      waitMs: supervisor.circuitOpenUntilMs - now,
    };
  }

  if (supervisor.queue.length === 0) {
    return { action: "idle" };
  }

  if (supervisor.active >= state.policy.maxConcurrent) {
    return { action: "capacity" };
  }

  const queued = supervisor.queue.shift();
  return queued ? { action: "execute", queued } : { action: "idle" };
}

export function buildLaneTelemetrySnapshot(args: {
  runtime?: WorkspaceLaneRuntime;
  supervisors?: WorkspaceLaneSupervisors;
  now?: number;
}): LaneTelemetrySnapshot {
  const { runtime, supervisors } = args;
  const now = args.now ?? Date.now();

  const buildLane = (lane: RuntimeLane) => {
    const activeCalls = runtime?.[lane]?.activeCalls ?? 0;
    const supervisor = supervisors?.[lane];
    return {
      activeCalls,
      queueDepth: supervisor?.queue.length ?? 0,
      restartCount: supervisor?.restartCount ?? 0,
      consecutiveCrashes: supervisor?.consecutiveCrashes ?? 0,
      circuitOpenUntilMs:
        (supervisor?.circuitOpenUntilMs ?? 0) > now
          ? (supervisor?.circuitOpenUntilMs ?? 0)
          : 0,
      lastCrashError: supervisor?.lastCrashError,
    };
  };

  return {
    timestamp: now,
    lanes: {
      planner: buildLane("planner"),
      executor: buildLane("executor"),
      verifier: buildLane("verifier"),
    },
  };
}
