import { describe, expect, test, vi } from "vitest";
import type { AgentStep } from "../../src/types";
import { DEFAULT_RUNTIME_LIMITS } from "../../src/background/agent/constants";
import {
  bootstrapRuntimePlan,
  type RuntimePlanBootstrapState,
} from "../../src/background/agent/start-planner-bootstrap";
import type { TaskPlanner } from "../../src/background/agent/planner";

const baseState: RuntimePlanBootstrapState = {
  difficulty: "moderate",
  limits: { ...DEFAULT_RUNTIME_LIMITS },
  taskId: null,
  taskStartTime: 0,
  planSubtasks: [],
  planSteps: [],
  planRequiresTabManagement: false,
};

function makeContext() {
  const messages: unknown[] = [];
  const planStatuses: unknown[] = [];
  return {
    addMessage: (message: unknown) => messages.push(message),
    getSnapshot: () => ({ title: "Page", url: "https://example.test" }),
    setPlanStatus: (subtasks: unknown, currentIndex: number) =>
      planStatuses.push({ subtasks, currentIndex }),
    messages,
    planStatuses,
  };
}

describe("bootstrapRuntimePlan", () => {
  test("initializes runtime plan state for multi-step decompositions", async () => {
    const context = makeContext();
    const steps: AgentStep[] = [];
    const progress: unknown[] = [];
    const events: unknown[] = [];
    const planner = {
      decompose: vi.fn(async () => ({
        subtasks: ["Open the report tab", "Read the report"],
        steps: [
          {
            objective: "Open a new tab for the report",
            successCriteria: "Report tab visible",
            dependencies: [],
            assumptions: [],
            toolProfile: "navigate",
          },
          {
            objective: "Read the report",
            successCriteria: "Report contents visible",
            dependencies: [0],
            assumptions: [],
            toolProfile: "read_only",
          },
        ],
        difficulty: "complex",
        limitOverrides: { maxTurns: 9 },
      })),
    } as unknown as TaskPlanner;
    let id = 0;

    const result = await bootstrapRuntimePlan({
      initialUserText: "Read the report in a new tab",
      disableInternalPlanning: false,
      turnCount: 0,
      workspaceId: "ws-1",
      workerId: null,
      context: context as never,
      planner,
      abortSignal: new AbortController().signal,
      log: { info: vi.fn(), warn: vi.fn() },
      traceRecorder: {
        recordEvent: (name: string, data: unknown) => events.push({ name, data }),
        setDifficultyInfo: vi.fn(),
        setPlanDecomposition: vi.fn(),
      } as never,
      stepHandler: (step) => steps.push(step),
      broadcastTaskProgress: (currentIndex, totalTurnsUsed) =>
        progress.push({ currentIndex, totalTurnsUsed }),
      currentState: baseState,
      createId: () => `id-${++id}`,
      now: () => 1000 + id,
    });

    expect(result.difficulty).toBe("complex");
    expect(result.taskId).toBe("id-2");
    expect(result.planSubtasks.map((subtask) => subtask.status)).toEqual([
      "running",
      "pending",
    ]);
    expect(result.planRequiresTabManagement).toBe(true);
    expect(context.planStatuses).toHaveLength(1);
    expect(context.messages[0]).toMatchObject({
      role: "user",
      content: expect.stringContaining("1. Open the report tab"),
    });
    expect(steps.map((step) => step.label)).toEqual([
      "Analyzing task scope...",
      "Plan: 2 steps (complex)",
    ]);
    expect(progress).toEqual([{ currentIndex: 0, totalTurnsUsed: 0 }]);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "planner_decomposition_outcome" }),
        expect.objectContaining({ name: "runtime_plan_status_initialized" }),
      ]),
    );
  });

  test("leaves state unchanged when internal planning is disabled", async () => {
    const planner = { decompose: vi.fn() } as unknown as TaskPlanner;
    const log = { info: vi.fn(), warn: vi.fn() };

    const result = await bootstrapRuntimePlan({
      initialUserText: "Do it",
      disableInternalPlanning: true,
      turnCount: 0,
      workspaceId: "ws-1",
      workerId: "worker-1",
      context: makeContext() as never,
      planner,
      abortSignal: new AbortController().signal,
      log,
      traceRecorder: null,
      stepHandler: vi.fn(),
      broadcastTaskProgress: vi.fn(),
      currentState: baseState,
    });

    expect(result).toBe(baseState);
    expect(planner.decompose).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      "agent",
      "Internal planning disabled for this executor run",
      expect.objectContaining({ workerId: "worker-1" }),
    );
  });

  test("returns computed plan state if a later plan side effect fails", async () => {
    const context = {
      addMessage: vi.fn(),
      getSnapshot: () => ({ title: "Page", url: "https://example.test" }),
      setPlanStatus: vi.fn(() => {
        throw new Error("status failed");
      }),
    };
    const planner = {
      decompose: vi.fn(async () => ({
        subtasks: ["Open tab", "Read tab"],
        steps: [],
        difficulty: "moderate",
      })),
    } as unknown as TaskPlanner;
    let id = 0;

    const result = await bootstrapRuntimePlan({
      initialUserText: "Read in another tab",
      disableInternalPlanning: false,
      turnCount: 0,
      workspaceId: "ws-1",
      workerId: null,
      context: context as never,
      planner,
      abortSignal: new AbortController().signal,
      log: { info: vi.fn(), warn: vi.fn() },
      traceRecorder: null,
      stepHandler: vi.fn(),
      broadcastTaskProgress: vi.fn(),
      currentState: baseState,
      createId: () => `id-${++id}`,
      now: () => 1000 + id,
    });

    expect(result.taskId).toBe("id-2");
    expect(result.planSubtasks).toHaveLength(2);
    expect(context.addMessage).not.toHaveBeenCalled();
  });
});
