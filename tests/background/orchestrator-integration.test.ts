import { beforeEach, describe, expect, mock, test } from "bun:test";
import "../setup";
import { SessionMetrics, ToolName, UserSettings } from "../../src/types";
import { TaskNode } from "../../src/background/orchestrator/types";
import { Orchestrator, OrchestratorDeps } from "../../src/background/orchestrator/index";

type MockLoopConfig = {
  nodeId?: string;
};

const createdLoopNodeIds: string[] = [];
const capturedInstructions: Array<{ nodeId?: string; instruction: string }> = [];

let plannerBuildNodesImpl: (...args: unknown[]) => Promise<TaskNode[]>;
let plannerExpandNodeImpl: (...args: unknown[]) => Promise<TaskNode[] | null>;
let verifierDecisionImpl: (...args: unknown[]) => Promise<{
  decision: "accept" | "retry" | "reroute";
  reason: string;
  confidence?: number;
  failureType?:
    | "blocked"
    | "state_mismatch"
    | "insufficient_evidence"
    | "transient"
    | "unknown";
  rerouteObjective?: string;
}>;
let verifierCriticImpl:
  | ((...args: unknown[]) => Promise<{
      decision: "accept" | "retry" | "reroute";
      reason: string;
      confidence?: number;
      failureType?:
        | "blocked"
        | "state_mismatch"
        | "insufficient_evidence"
        | "transient"
        | "unknown";
      rerouteObjective?: string;
    }>)
  | undefined;
let loopStartImpl: (
  nodeId: string | undefined,
  instruction: string,
) => Promise<{ outcome: "completed" | "failed"; summary: string; metrics?: SessionMetrics }>;
let loopEmitStaleSignal = false;
let orchestratorDeps: OrchestratorDeps;
let activeOrchestrator: Orchestrator | null = null;
let autoEscalationDecision:
  | {
      optionId:
        | "approve_continue"
        | "reroute_with_option"
        | "skip_node"
        | "stop_task";
      rerouteObjective?: string;
    }
  | null = null;

const baseSettings: UserSettings = {
  openRouterApiKey: "test-openrouter",
  groqApiKey: "",
  cerebrasApiKey: "",
  maxTurns: 10,
  contextWindowSize: 16000,
  memoryEnabled: true,
  workspaceEnabled: true,
  theme: "system",
  showElementTags: false,
  visionModel: "qwen/qwen3-vl-235b-a22b-instruct",
  showSessionMetrics: false,
  disableScreenshot: false,
  disableNavigation: false,
  bypassApprovals: true,
  speechProvider: "browser",
  orchestratorMaxWorkers: 3,
};

function makeNode(
  id: string,
  description: string,
  dependencies: string[] = [],
  assumptions: string[] = [],
): TaskNode {
  return {
    id,
    role: "executor",
    description,
    successCriteria: `Success: ${description}`,
    allowedTools: [ToolName.READ_PAGE, ToolName.DONE],
    dependencies,
    assumptions,
    handoffArtifacts: [],
    handoffDepth: 0,
    status: "pending",
    retries: 0,
  };
}

function makeInput(query = "integration task") {
  return {
    query,
    tabId: 101,
    workspaceId: "ws-1",
    settings: baseSettings,
    openRouterApiKey: "test-openrouter",
  };
}

describe("Orchestrator integration join tests", () => {
  beforeEach(() => {
    createdLoopNodeIds.length = 0;
    capturedInstructions.length = 0;

    plannerBuildNodesImpl = async () => [makeNode("n1", "step one")];
    plannerExpandNodeImpl = async () => null;
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });
    verifierCriticImpl = undefined;
    loopEmitStaleSignal = false;
    loopStartImpl = async (nodeId) => ({
      outcome: "completed",
      summary: `completed ${nodeId || "unknown"}`,
      metrics: undefined,
    });

    const runtimeMessages: any[] = [];
    const checkpointStore: Record<string, unknown> = {};
    const chromeAny = chrome as any;

    chromeAny.runtime ??= {};
    chromeAny.storage ??= {};
    chromeAny.storage.local ??= {};
    chromeAny.storage.sync ??= {};
    chromeAny.tabs ??= {};
    chromeAny.scripting ??= {};
    chromeAny.scripting.executeScript ??= mock(async () => undefined);

    (globalThis as any).__OPENROUTER_API_KEY__ = "fallback-openrouter-key";

    (chrome.runtime as any).sendMessage = mock(async (msg: any) => {
      runtimeMessages.push(msg);
      if (msg?.type === "ESCALATION_REQUEST" && autoEscalationDecision && activeOrchestrator) {
        setTimeout(() => {
          activeOrchestrator?.resolveEscalationDecision({
            escalationId: msg.payload.escalationId,
            optionId: autoEscalationDecision!.optionId,
            rerouteObjective: autoEscalationDecision!.rerouteObjective,
          });
        }, 0);
      }
      return { ok: true };
    });
    (globalThis as any).__runtimeMessages = runtimeMessages;

    (chrome.storage.local as any).get = mock(async (key: string) => {
      if (key === "opensidebar:orchestrator:checkpoints") {
        return { [key]: checkpointStore };
      }
      return {};
    });
    (chrome.storage.local as any).set = mock(async (payload: Record<string, unknown>) => {
      const key = "opensidebar:orchestrator:checkpoints";
      if (payload[key]) {
        const value = payload[key] as Record<string, unknown>;
        for (const [k, v] of Object.entries(value)) checkpointStore[k] = v;
        for (const k of Object.keys(checkpointStore)) {
          if (!(k in value)) delete checkpointStore[k];
        }
      }
    });
    (globalThis as any).__checkpointStore = checkpointStore;

    (chrome.storage.sync as any).get = mock(async (_key: string) => ({
      userSettings: {
        ...baseSettings,
        openRouterApiKey: "resume-openrouter-key",
      },
    }));

    (chrome.tabs as any).get = mock(async (tabId: number) => ({
      id: tabId,
      url: "https://example.com/app",
      title: "Example App",
      groupId: 1,
    }));
    (chrome.tabs as any).create = mock(async () => ({ id: 202 }));
    (chrome.tabs as any).sendMessage = mock(async () => ({
      payload: {
        snapshot: {
          title: "Catalog Page",
          url: "https://example.com/catalog",
          viewportText: "product list and add to cart",
          elements: [],
          viewport: { width: 1200, height: 800 },
          scroll: { x: 0, y: 0, maxY: 5000 },
        },
      },
    }));
    (chrome.runtime as any).getManifest = () => ({ content_scripts: [] });

    orchestratorDeps = {
      createPlanner: () => ({
        buildNodes: async (...args: unknown[]) => plannerBuildNodesImpl(...args),
        expandNode: async (...args: unknown[]) => plannerExpandNodeImpl(...args),
      }),
      createVerifier: () => ({
        verifyNode: async (...args: unknown[]) => verifierDecisionImpl(...args),
        reflectDecision: verifierCriticImpl
          ? async (...args: unknown[]) => verifierCriticImpl!(...args)
          : undefined,
      }),
      createAgentLoop: (input) => {
        const cfg = (input.options as MockLoopConfig) || {};
        const callbacks = input.callbacks as
          | { onStep?: (step: any, update: boolean) => void }
          | undefined;
        createdLoopNodeIds.push(cfg.nodeId);
        return {
          async start(instruction: string) {
            capturedInstructions.push({ nodeId: cfg.nodeId, instruction });
            if (loopEmitStaleSignal && callbacks?.onStep) {
              callbacks.onStep(
                {
                  id: "step-stale-1",
                  type: "warning",
                  label: "Agent appears stuck",
                  detail: "No progress for several turns",
                  status: "done",
                  timestamp: Date.now(),
                },
                false,
              );
            }
            return loopStartImpl(cfg.nodeId, instruction);
          },
          stop() {},
          pause() {},
          resume() {},
          isPaused() {
            return false;
          },
          injectHint(_text: string) {},
        } as any;
      },
      createLlm: () => ({
        switchToSmart() {},
        async complete() {
          return { content: "Integration summary", usage: undefined };
        },
      }),
      workspaceManager: {
        async getWorkspaceById(_workspaceId: string) {
          return { id: "ws-1", tabIds: [101], tabGroupId: 1 };
        },
        async addTabToWorkspace(_tabId: number, _workspaceId: string) {},
      },
      waitForContentScriptReady: async (_tabId: number, _timeoutMs: number) => true,
    };
    autoEscalationDecision = null;
    activeOrchestrator = null;
  });

  test("executes dependency graph in correct order", async () => {
    plannerBuildNodesImpl = async () => [
      makeNode("n1", "collect data"),
      makeNode("n2", "summarize data", ["n1"]),
    ];

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("collect then summarize"));

    expect(createdLoopNodeIds).toEqual(["n1", "n2"]);
    expect(capturedInstructions[0].instruction).toContain("Objective: collect data");
    expect(capturedInstructions[1].instruction).toContain("Objective: summarize data");
  });

  test("creates and executes reroute handoff node", async () => {
    let verifyCalls = 0;
    plannerBuildNodesImpl = async () => [makeNode("n1", "primary route")];
    verifierDecisionImpl = async () => {
      verifyCalls += 1;
      if (verifyCalls === 1) {
        return {
          decision: "reroute",
          reason: "Primary route blocked",
          rerouteObjective: "alternate route",
        };
      }
      return { decision: "accept", reason: "Alternate route succeeded" };
    };

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("reroute flow"));

    expect(createdLoopNodeIds.length).toBe(2);
    expect(capturedInstructions[0].instruction).toContain("Objective: primary route");
    expect(capturedInstructions[1].instruction).toContain("Objective: alternate route");
  });

  test("restores checkpoints with dependency/assumption fields and resumes", async () => {
    const checkpointStore = (globalThis as any).__checkpointStore as Record<string, unknown>;
    checkpointStore["ws-1"] = {
      version: 1,
      savedAt: Date.now(),
      task: {
        id: "task-recover",
        workspaceId: "ws-1",
        rootTabId: 101,
        query: "resume task",
        status: "running",
        createdAt: Date.now() - 5000,
        startedAt: Date.now() - 4000,
        nodes: [
          {
            id: "n1",
            role: "executor",
            description: "resume step",
            successCriteria: "resume success",
            allowedTools: [ToolName.READ_PAGE, ToolName.DONE],
            dependencies: [],
            assumptions: ["checkout page visible"],
            handoffArtifacts: [],
            handoffDepth: 0,
            status: "pending",
            retries: 0,
          },
        ],
        maxWorkers: 1,
        currentIndex: 0,
      },
    };

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.restoreFromCheckpoints();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(createdLoopNodeIds).toContain("n1");
    expect(capturedInstructions.some((i) => i.instruction.includes("Planner assumptions"))).toBe(
      true,
    );

    const messages = (globalThis as any).__runtimeMessages as Array<{ type?: string; payload?: any }>;
    expect(messages.some((m) => m.type === "TASK_RECOVERY")).toBe(true);
    expect(messages.some((m) => m.type === "TASK_COMPLETION")).toBe(true);
  });

  test("fails blocked node when dependencies are unsatisfiable", async () => {
    plannerBuildNodesImpl = async () => [
      makeNode("n1", "blocked node", ["missing-dependency"]),
    ];

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("blocked dependency task"));

    expect(createdLoopNodeIds.length).toBe(0);
    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion).toBeDefined();
    expect(completion?.payload?.status).toBe("failed");
    expect(String(completion?.payload?.subtaskResults?.[0]?.result || "")).toContain(
      "Blocked by missing dependencies",
    );
  });

  test("replans node on drift + retry into replacement subgraph", async () => {
    plannerBuildNodesImpl = async () => [
      makeNode("n1", "fragile primary flow", [], ["checkout confirmation visible"]),
    ];
    plannerExpandNodeImpl = async (_node, _title, _url, _reason) => [
      makeNode("rp1", "replanned gather state"),
      makeNode("rp2", "replanned submit", ["rp1"]),
    ];
    verifierDecisionImpl = async ({ objective }: { objective: string }) => {
      if (objective === "fragile primary flow") {
        return { decision: "retry", reason: "State diverged from expected checkout flow" };
      }
      return { decision: "accept", reason: "ok" };
    };

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("drift recovery flow"));

    expect(createdLoopNodeIds).toEqual(["n1", "rp1", "rp2"]);
    expect(capturedInstructions.some((entry) => entry.instruction.includes("Potential plan-reality drift"))).toBe(true);
  });

  test("replans node on stale loop signal retry without drift", async () => {
    loopEmitStaleSignal = true;
    plannerBuildNodesImpl = async () => [makeNode("n1", "primary flow without assumptions")];
    plannerExpandNodeImpl = async () => [
      makeNode("sx1", "stale-replan gather"),
      makeNode("sx2", "stale-replan finalize", ["sx1"]),
    ];
    verifierDecisionImpl = async ({ objective }: { objective: string }) => {
      if (objective === "primary flow without assumptions") {
        return { decision: "retry", reason: "Execution loop made no progress" };
      }
      return { decision: "accept", reason: "ok" };
    };

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("stale recovery flow"));

    expect(createdLoopNodeIds).toEqual(["n1", "sx1", "sx2"]);
    expect(
      capturedInstructions.some((entry) =>
        entry.instruction.includes("No assumption drift evaluation available"),
      ),
    ).toBe(true);
  });

  test("fails explicitly when replan budget is exhausted", async () => {
    loopEmitStaleSignal = true;
    plannerBuildNodesImpl = async () => [makeNode("n1", "budget root")];
    let expandCounter = 0;
    plannerExpandNodeImpl = async () => {
      expandCounter += 1;
      return [makeNode(`rb${expandCounter}`, `budget replanned ${expandCounter}`)];
    };
    verifierDecisionImpl = async () => ({
      decision: "retry",
      reason: "Still not progressing",
    });

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("replan budget task"));

    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion).toBeDefined();
    expect(completion?.payload?.status).toBe("partial");
    const subtaskResults = completion?.payload?.subtaskResults || [];
    expect(
      subtaskResults.some((item: any) =>
        String(item.result || "").includes("Replan budget exhausted"),
      ),
    ).toBe(true);
  });

  test("fails fast when verifier retry reason is blocked", async () => {
    plannerBuildNodesImpl = async () => [makeNode("n1", "blocked flow")];
    verifierDecisionImpl = async () => ({
      decision: "retry",
      reason: "Access denied by captcha wall",
    });

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("blocked retry flow"));

    expect(createdLoopNodeIds).toEqual(["n1"]);
    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion).toBeDefined();
    expect(completion?.payload?.status).toBe("failed");
    const subtaskResults = completion?.payload?.subtaskResults || [];
    expect(subtaskResults.length).toBeGreaterThan(0);
    expect(String(subtaskResults[0]?.result || "")).toContain("class=blocked");
  });

  test("terminates task when global token budget is exceeded", async () => {
    plannerBuildNodesImpl = async () => [
      makeNode("n1", "high token step"),
      makeNode("n2", "should not run", ["n1"]),
    ];
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });
    loopStartImpl = async (nodeId) => ({
      outcome: "completed",
      summary: `completed ${nodeId || "unknown"}`,
      metrics: {
        totalPromptTokens: 80000,
        totalCompletionTokens: 1000,
        totalTokens: 81000,
        totalCost: 0.4,
        totalLlmTimeMs: 1000,
        totalSessionTimeMs: 3000,
        llmCallCount: 3,
        totalCachedTokens: 200,
        modelBreakdown: {
          "test/model": {
            promptTokens: 80000,
            completionTokens: 1000,
            cost: 0.4,
            calls: 3,
          },
        },
      },
    });

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("token budget overflow task"));

    expect(createdLoopNodeIds).toEqual(["n1"]);
    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion).toBeDefined();
    expect(completion?.payload?.status).toBe("partial");
    expect(String(completion?.payload?.terminationReason || "")).toContain(
      "Global token budget exceeded",
    );
    expect(completion?.payload?.metrics?.totalTokens).toBe(81000);
  });

  test("preflight defers excess nodes when plan exceeds budget envelope", async () => {
    plannerBuildNodesImpl = async () =>
      Array.from({ length: 8 }, (_, i) => makeNode(`p${i + 1}`, `plan step ${i + 1}`));
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("preflight budget fit task"));

    expect(createdLoopNodeIds).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion).toBeDefined();
    expect(completion?.payload?.status).toBe("partial");
    const subtaskResults = completion?.payload?.subtaskResults || [];
    expect(
      subtaskResults.some((item: any) =>
        String(item.result || "").includes("Deferred by budget preflight"),
      ),
    ).toBe(true);
  });

  test("isolates planner lane at runtime and fails node explicitly", async () => {
    loopEmitStaleSignal = true;
    plannerBuildNodesImpl = async () => [makeNode("n1", "planner isolate node")];
    plannerExpandNodeImpl = async () => {
      throw new Error("planner upstream unavailable");
    };
    verifierDecisionImpl = async () => ({
      decision: "retry",
      reason: "Execution loop made no progress",
    });
    orchestratorDeps.lanePolicies = {
      planner: { maxFailuresBeforeIsolation: 1, isolationCooldownMs: 60_000 },
    };

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("planner lane isolation"));

    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    expect(
      messages.some(
        (m) =>
          m.type === "AGENT_STEP" &&
          String(m.payload?.step?.label || "").includes("planner lane isolated"),
      ),
    ).toBe(true);
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion).toBeDefined();
    expect(completion?.payload?.status).toBe("failed");
    expect(
      String(completion?.payload?.subtaskResults?.[0]?.result || ""),
    ).toContain("Planner lane isolated during replan");
  });

  test("applies bounded verifier-critic reflection and can upgrade retry to accept", async () => {
    plannerBuildNodesImpl = async () => [makeNode("n1", "critic correction node")];
    verifierDecisionImpl = async () => ({
      decision: "retry",
      reason: "Not enough proof in summary",
      confidence: 0.35,
      failureType: "insufficient_evidence",
    });
    verifierCriticImpl = async () => ({
      decision: "accept",
      reason: "Evidence is sufficient for success criteria",
      confidence: 0.86,
    });

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("critic reflection upgrade"));

    expect(createdLoopNodeIds).toEqual(["n1"]);
    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    expect(
      messages.some(
        (m) =>
          m.type === "AGENT_STEP" &&
          String(m.payload?.step?.label || "").includes(
            "Critic: reviewed verifier decision",
          ),
      ),
    ).toBe(true);
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion).toBeDefined();
    expect(completion?.payload?.status).toBe("completed");
  });

  test("isolates verifier lane and stops cross-node contamination", async () => {
    plannerBuildNodesImpl = async () => [
      makeNode("n1", "verify lane node one"),
      makeNode("n2", "verify lane node two"),
    ];
    verifierDecisionImpl = async () => {
      throw new Error("verifier provider unavailable");
    };
    orchestratorDeps.lanePolicies = {
      verifier: { maxFailuresBeforeIsolation: 1, isolationCooldownMs: 60_000 },
      executor: { maxConcurrent: 1 },
    };

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("verifier lane isolation"));

    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    expect(
      messages.some(
        (m) =>
          m.type === "AGENT_STEP" &&
          String(m.payload?.step?.label || "").includes("verifier lane isolated"),
      ),
    ).toBe(true);
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion).toBeDefined();
    expect(completion?.payload?.status).toBe("failed");
    const subtaskResults = completion?.payload?.subtaskResults || [];
    expect(subtaskResults.length).toBeGreaterThan(0);
    expect(
      subtaskResults.some((item: any) =>
        String(item.result || "").includes("Critical lane isolation while executing node"),
      ),
    ).toBe(true);
  });

  test("enforces executor lane maxConcurrent override in scheduler", async () => {
    plannerBuildNodesImpl = async () => [
      makeNode("n1", "executor concurrency one"),
      makeNode("n2", "executor concurrency two"),
      makeNode("n3", "executor concurrency three"),
    ];
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });

    let activeExecutors = 0;
    let maxActiveExecutors = 0;
    loopStartImpl = async (nodeId) => {
      activeExecutors += 1;
      maxActiveExecutors = Math.max(maxActiveExecutors, activeExecutors);
      await new Promise((resolve) => setTimeout(resolve, 20));
      activeExecutors -= 1;
      return {
        outcome: "completed",
        summary: `completed ${nodeId || "unknown"}`,
        metrics: undefined,
      };
    };

    orchestratorDeps.lanePolicies = {
      executor: { maxConcurrent: 1 },
    };

    const orchestrator = new Orchestrator(orchestratorDeps);
    await orchestrator.startTask(makeInput("executor lane concurrency gate"));

    expect(maxActiveExecutors).toBe(1);
  });

  test("queues planner lane calls under supervisor instead of concurrency rejection", async () => {
    const orchestrator = new Orchestrator({
      ...orchestratorDeps,
      lanePolicies: {
        planner: { maxConcurrent: 1, maxCallMs: 2_000 },
      },
    });

    const laneTask = { id: "lane-queue-task", workspaceId: "ws-lane-queue" } as any;
    const order: string[] = [];
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const first = (orchestrator as any).runInLane(
      laneTask,
      "planner",
      async () => {
        order.push("start-1");
        await delay(25);
        order.push("end-1");
        return "one";
      },
      { label: "planner-first" },
    );

    const second = (orchestrator as any).runInLane(
      laneTask,
      "planner",
      async () => {
        order.push("start-2");
        await delay(5);
        order.push("end-2");
        return "two";
      },
      { label: "planner-second" },
    );

    const [one, two] = await Promise.all([first, second]);
    expect(one).toBe("one");
    expect(two).toBe("two");
    expect(order).toEqual(["start-1", "end-1", "start-2", "end-2"]);
  });

  test("tracks active workers in isolated executor lane pool", async () => {
    plannerBuildNodesImpl = async () => [makeNode("n1", "executor pool lane tracking")];
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });

    let releaseLoop: (() => void) | null = null;
    loopStartImpl = async (nodeId) => {
      await new Promise<void>((resolve) => {
        releaseLoop = resolve;
      });
      return {
        outcome: "completed",
        summary: `completed ${nodeId || "unknown"}`,
        metrics: undefined,
      };
    };

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    const runPromise = orchestrator.startTask(makeInput("executor lane pool tracking"));

    await new Promise((resolve) => setTimeout(resolve, 0));

    const lanePools = (orchestrator as any).workersByWorkspace.get("ws-1");
    expect(lanePools).toBeDefined();
    expect(lanePools.executor.size).toBe(1);
    expect(lanePools.planner.size).toBe(0);
    expect(lanePools.verifier.size).toBe(0);

    releaseLoop?.();
    await runPromise;
  });

  test("isolates executor lane and fails runnable nodes with containment", async () => {
    plannerBuildNodesImpl = async () => [
      makeNode("n1", "executor isolate one"),
      makeNode("n2", "executor isolate two"),
    ];
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });
    loopStartImpl = async () => {
      throw new Error("executor transport unavailable");
    };
    orchestratorDeps.lanePolicies = {
      executor: { maxFailuresBeforeIsolation: 1, isolationCooldownMs: 60_000 },
    };

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("executor lane isolation"));

    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    expect(
      messages.some(
        (m) =>
          m.type === "AGENT_STEP" &&
          String(m.payload?.step?.label || "").includes("executor lane isolated"),
      ),
    ).toBe(true);
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion).toBeDefined();
    expect(completion?.payload?.status).toBe("failed");
    const subtaskResults = completion?.payload?.subtaskResults || [];
    expect(subtaskResults.length).toBeGreaterThan(0);
    expect(
      subtaskResults.some((item: any) =>
        String(item.result || "").includes("Critical lane isolation while executing node"),
      ),
    ).toBe(true);
  });

  test("skipSubtask keeps node skipped when late worker result arrives", async () => {
    plannerBuildNodesImpl = async () => [makeNode("n1", "long-running step")];
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });

    let resolveLoop: ((value: {
      outcome: "completed" | "failed";
      summary: string;
      metrics?: SessionMetrics;
    }) => void) | null = null;
    loopStartImpl = async () =>
      await new Promise((resolve) => {
        resolveLoop = resolve;
      });

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    const runPromise = orchestrator.startTask(makeInput("skip running node"));

    await new Promise((resolve) => setTimeout(resolve, 0));
    const skipped = await orchestrator.skipSubtask("ws-1", undefined);
    expect(skipped).toBe(true);

    resolveLoop?.({
      outcome: "completed",
      summary: "worker completed late",
      metrics: undefined,
    });

    await runPromise;

    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion).toBeDefined();
    expect(completion?.payload?.status).toBe("partial");
    expect(completion?.payload?.subtaskResults?.[0]?.status).toBe("skipped");
    expect(String(completion?.payload?.subtaskResults?.[0]?.result || "")).toContain(
      "Skipped by user from Plan Board.",
    );

    const skippedStep = messages.find(
      (m) =>
        m.type === "AGENT_STEP" &&
        String(m.payload?.step?.label || "").includes("skipped subtask"),
    );
    expect(skippedStep).toBeDefined();
  });

  test("pauses on escalation and resumes with operator continue decision", async () => {
    plannerBuildNodesImpl = async () => [makeNode("n1", "needs operator review")];
    verifierDecisionImpl = async () => ({
      decision: "retry",
      reason: "High uncertainty, evidence incomplete",
      confidence: 0.2,
      failureType: "insufficient_evidence",
    });
    autoEscalationDecision = { optionId: "approve_continue" };

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("escalation continue path"));

    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    expect(messages.some((m) => m.type === "ESCALATION_REQUEST")).toBe(true);
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion).toBeDefined();
    expect(completion?.payload?.status).toBe("failed");
  });
});
