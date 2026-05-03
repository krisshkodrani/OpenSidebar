import { describe, expect, test } from "vitest";
import {
  beginLaneOperation,
  buildLanePolicy,
  buildLaneTelemetrySnapshot,
  clearLaneSupervisorTimers,
  createLaneSupervisor,
  createWorkspaceLanePools,
  createWorkspaceLaneRuntime,
  createWorkspaceLaneSupervisors,
  enqueueLaneOperation,
  getNextLaneDrainDecision,
  recordLaneOperationFailure,
  recordLaneOperationSuccess,
  registerLaneOperation,
  releaseLaneOperation,
  releaseLaneOperationRegistration,
} from "../../src/background/orchestrator/lane-supervisor";

describe("orchestrator lane supervisor helpers", () => {
  test("builds lane policies with bounded overrides", () => {
    expect(
      buildLanePolicy({
        lane: "executor",
        maxWorkers: 3,
        overrides: {
          executor: {
            maxConcurrent: 99,
            maxFailuresBeforeIsolation: 0,
            isolationCooldownMs: 10,
            maxCallMs: 10,
          },
        },
      }),
    ).toEqual({
      maxConcurrent: 8,
      maxFailuresBeforeIsolation: 1,
      isolationCooldownMs: 1_000,
      maxCallMs: 1_000,
    });
  });

  test("initializes all lane runtime policies from one boundary", () => {
    const runtime = createWorkspaceLaneRuntime({
      maxWorkers: 2,
      overrides: {
        planner: { maxConcurrent: 1 },
        executor: { maxConcurrent: 2 },
        verifier: { maxConcurrent: 2 },
      },
    });

    expect(runtime.planner.policy.maxConcurrent).toBe(1);
    expect(runtime.executor.policy.maxConcurrent).toBe(2);
    expect(runtime.verifier.policy.maxConcurrent).toBe(2);
    expect(runtime.executor.activeCalls).toBe(0);
  });

  test("summarizes queue depth and circuit state for telemetry", () => {
    const supervisors = createWorkspaceLaneSupervisors();
    supervisors.executor.queue.push({
      operationId: "queued-1",
      taskId: "task-1",
      workspaceId: "ws-1",
      label: "executor call",
      enqueuedAt: 1,
      operation: async () => undefined,
      resolve: () => undefined,
      reject: () => undefined,
    });
    supervisors.executor.restartCount = 2;
    supervisors.executor.consecutiveCrashes = 1;
    supervisors.executor.circuitOpenUntilMs = 2_000;
    supervisors.executor.lastCrashError = "timeout";

    const snapshot = buildLaneTelemetrySnapshot({
      supervisors,
      now: 1_000,
    });

    expect(snapshot.lanes.executor).toMatchObject({
      activeCalls: 0,
      queueDepth: 1,
      restartCount: 2,
      consecutiveCrashes: 1,
      circuitOpenUntilMs: 2_000,
      lastCrashError: "timeout",
    });
  });

  test("clears supervisor resume timers", () => {
    const supervisor = createLaneSupervisor("planner");
    let fired = false;
    supervisor.resumeTimer = setTimeout(() => {
      fired = true;
    }, 10);

    clearLaneSupervisorTimers({ planner: supervisor });

    expect(supervisor.resumeTimer).not.toBeNull();
    expect(fired).toBe(false);
  });

  test("tracks active calls and decays failures after success", () => {
    const runtime = createWorkspaceLaneRuntime({ maxWorkers: 2 });
    const supervisor = createLaneSupervisor("executor");
    const state = runtime.executor;
    state.failures = 2;

    beginLaneOperation(state, supervisor);
    expect(supervisor.active).toBe(1);
    expect(state.activeCalls).toBe(1);
    expect(state.totalCalls).toBe(1);

    recordLaneOperationSuccess({ state, supervisor, durationMs: 25 });
    expect(state.totalDurationMs).toBe(25);
    expect(state.failures).toBe(1);
    expect(supervisor.consecutiveCrashes).toBe(0);

    releaseLaneOperation(state, supervisor);
    expect(supervisor.active).toBe(0);
    expect(state.activeCalls).toBe(0);
  });

  test("records failure backoff before lane isolation", () => {
    const runtime = createWorkspaceLaneRuntime({
      maxWorkers: 2,
      overrides: {
        executor: { maxFailuresBeforeIsolation: 2 },
      },
    });
    const supervisor = createLaneSupervisor("executor");
    const state = runtime.executor;

    const failure = recordLaneOperationFailure({
      state,
      supervisor,
      message: "transient",
      durationMs: 10,
      now: 1_000,
    });

    expect(failure).toMatchObject({
      message: "transient",
      backoffMs: 250,
      isolated: false,
    });
    expect(state.failures).toBe(1);
    expect(state.totalDurationMs).toBe(10);
    expect(supervisor.restartCount).toBe(1);
    expect(supervisor.circuitOpenUntilMs).toBe(1_250);
  });

  test("enqueues lane operation with metadata and promise wiring", () => {
    const runtime = createWorkspaceLaneRuntime({ maxWorkers: 1 });
    const supervisor = createLaneSupervisor("executor");

    const enqueued = enqueueLaneOperation({
      taskId: "task-1",
      workspaceId: "ws-1",
      lane: "executor",
      state: runtime.executor,
      supervisor,
      operation: async () => "done",
      metadata: { label: "executor node", nodeId: "node-1" },
      operationId: "executor-queued-1",
      now: 1_000,
    });

    expect(enqueued.operationId).toBe("executor-queued-1");
    expect(enqueued.queued).toBe(true);
    expect(enqueued.queueDepth).toBe(1);
    expect(supervisor.queue[0]).toMatchObject({
      operationId: "executor-queued-1",
      taskId: "task-1",
      workspaceId: "ws-1",
      label: "executor node",
      nodeId: "node-1",
      enqueuedAt: 1_000,
    });

    supervisor.queue[0].resolve("ok");
    return expect(enqueued.promise).resolves.toBe("ok");
  });

  test("rejects enqueue while lane is isolated without mutating queue", async () => {
    const runtime = createWorkspaceLaneRuntime({ maxWorkers: 1 });
    const supervisor = createLaneSupervisor("planner");
    const state = runtime.planner;
    state.isolatedUntilMs = 2_000;
    state.lastError = "planner down";

    const enqueued = enqueueLaneOperation({
      taskId: "task-1",
      workspaceId: "ws-1",
      lane: "planner",
      state,
      supervisor,
      operation: async () => "done",
      operationId: "planner-queued-1",
      now: 1_500,
    });

    expect(enqueued.queued).toBe(false);
    expect(enqueued.queueDepth).toBe(0);
    expect(supervisor.queue).toHaveLength(0);
    await expect(enqueued.promise).rejects.toMatchObject({
      name: "LaneIsolationError",
      lane: "planner",
      remainingMs: 500,
      lastError: "planner down",
    });
  });

  test("registers and releases non-executor lane operations", () => {
    const pools = createWorkspaceLanePools();
    const queued = {
      operationId: "planner-queued-1",
      taskId: "task-1",
      workspaceId: "ws-1",
      label: "planner call",
      enqueuedAt: 900,
      operation: async () => undefined,
      resolve: () => undefined,
      reject: () => undefined,
    };

    const registration = registerLaneOperation({
      pools,
      lane: "planner",
      queued,
      startedAt: 1_000,
      timeoutMs: 20_000,
      operationId: "planner-op-1",
    });

    expect(registration).toEqual({
      operationId: "planner-op-1",
      activeLaneOperations: 1,
      queueLatencyMs: 100,
    });
    expect(pools.planner.get("planner-op-1")).toMatchObject({
      operationId: "planner-op-1",
      lane: "planner",
      taskId: "task-1",
      timeoutMs: 20_000,
    });

    expect(
      releaseLaneOperationRegistration({
        pools,
        lane: "planner",
        operationId: "planner-op-1",
      }),
    ).toBe(0);
    expect(pools.planner.has("planner-op-1")).toBe(false);
  });

  test("skips executor lane operation registration", () => {
    const pools = createWorkspaceLanePools();
    const queued = {
      operationId: "executor-queued-1",
      taskId: "task-1",
      workspaceId: "ws-1",
      label: "executor call",
      enqueuedAt: 900,
      operation: async () => undefined,
      resolve: () => undefined,
      reject: () => undefined,
    };

    expect(
      registerLaneOperation({
        pools,
        lane: "executor",
        queued,
        startedAt: 1_000,
        timeoutMs: 20_000,
        operationId: "executor-op-1",
      }),
    ).toBeNull();
    expect(pools.executor.size).toBe(0);
  });

  test("records isolation when failure threshold is reached", () => {
    const runtime = createWorkspaceLaneRuntime({
      maxWorkers: 2,
      overrides: {
        verifier: {
          maxFailuresBeforeIsolation: 1,
          isolationCooldownMs: 3_000,
        },
      },
    });
    const supervisor = createLaneSupervisor("verifier");
    const state = runtime.verifier;

    const failure = recordLaneOperationFailure({
      state,
      supervisor,
      message: "fatal",
      durationMs: 15,
      now: 5_000,
    });

    expect(failure.isolated).toBe(true);
    expect(failure.isolatedUntilMs).toBe(8_000);
    expect(failure.detail).toContain("verifier lane entered cooldown");
    expect(state.isolatedUntilMs).toBe(8_000);
    expect(supervisor.lastCrashError).toBe("fatal");
  });

  test("drain decision rejects all queued work when lane is isolated", () => {
    const runtime = createWorkspaceLaneRuntime({ maxWorkers: 1 });
    const supervisor = createLaneSupervisor("planner");
    const state = runtime.planner;
    state.isolatedUntilMs = 2_000;
    state.lastError = "planner down";
    supervisor.queue.push({
      operationId: "queued-1",
      taskId: "task-1",
      workspaceId: "ws-1",
      label: "planner call",
      enqueuedAt: 1,
      operation: async () => undefined,
      resolve: () => undefined,
      reject: () => undefined,
    });

    const decision = getNextLaneDrainDecision({
      lane: "planner",
      state,
      supervisor,
      now: 1_500,
    });

    expect(decision.action).toBe("isolated");
    if (decision.action !== "isolated") throw new Error("expected isolation");
    expect(decision.pending).toHaveLength(1);
    expect(decision.error.remainingMs).toBe(500);
    expect(supervisor.queue).toHaveLength(0);
  });

  test("drain decision waits for backoff before executing queued work", () => {
    const runtime = createWorkspaceLaneRuntime({ maxWorkers: 1 });
    const supervisor = createLaneSupervisor("executor");
    supervisor.circuitOpenUntilMs = 2_500;

    expect(
      getNextLaneDrainDecision({
        lane: "executor",
        state: runtime.executor,
        supervisor,
        now: 2_000,
      }),
    ).toEqual({ action: "wait", waitMs: 500 });
  });

  test("drain decision returns executable queue item when capacity is available", () => {
    const runtime = createWorkspaceLaneRuntime({ maxWorkers: 1 });
    const supervisor = createLaneSupervisor("verifier");
    supervisor.queue.push({
      operationId: "queued-1",
      taskId: "task-1",
      workspaceId: "ws-1",
      label: "verifier call",
      enqueuedAt: 1,
      operation: async () => undefined,
      resolve: () => undefined,
      reject: () => undefined,
    });

    const decision = getNextLaneDrainDecision({
      lane: "verifier",
      state: runtime.verifier,
      supervisor,
      now: 1_000,
    });

    expect(decision.action).toBe("execute");
    if (decision.action !== "execute") throw new Error("expected execute");
    expect(decision.queued.operationId).toBe("queued-1");
    expect(supervisor.queue).toHaveLength(0);
  });
});
