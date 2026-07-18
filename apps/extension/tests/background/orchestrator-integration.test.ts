import { beforeEach, describe, expect, vi, test } from "vitest";
import "../setup";
import { SessionMetrics, ToolName, UserSettings } from "../../src/types";
import {
  TURN_CHECKPOINT_VERSION,
  TurnCheckpoint,
} from "../../src/background/agent/checkpoint-types";
import { getSnapshotFingerprint } from "../../src/background/agent/loop-helpers";
import { TaskNode } from "../../src/background/orchestrator/types";
import { Orchestrator, OrchestratorDeps } from "../../src/background/orchestrator/index";

type MockLoopConfig = {
  nodeId?: string;
  selectedSkillId?: string | null;
  turnCheckpoint?: {
    turnCount?: number;
    pageUrl?: string | null;
    snapshotFingerprint?: string;
  } | null;
  resumeInteraction?: {
    kind?: string;
    approvalId?: string;
    clarificationId?: string;
    approved?: boolean;
    answer?: string;
  } | null;
  completionDeterministicAcceptanceEnabled?: boolean;
};

type MockCompletedResult = {
  summary: string;
  completionEnvelope?: Record<string, unknown>;
};

const createdLoopNodeIds: string[] = [];
const createdLoopConfigs: MockLoopConfig[] = [];
const capturedInstructions: Array<{ nodeId?: string; instruction: string }> = [];
const stoppedLoopNodeIds: string[] = [];
const gracefulStopLoopNodeIds: string[] = [];
const mockLoopCompletedResults = new Map<string, MockCompletedResult>();
const plannerOverrideCalls: Array<Record<string, unknown> | undefined> = [];
const verifierOverrideCalls: Array<Record<string, unknown> | undefined> = [];
let plannerBuildNodeCalls = 0;
let verifierDecisionCalls = 0;

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
let loopStartImpl: (
  nodeId: string | undefined,
  instruction: string,
) => Promise<{
  outcome:
    | "completed"
    | "failed"
    | "error"
    | "stopped"
    | "awaiting_approval"
    | "awaiting_clarification";
  summary: string;
  metrics?: SessionMetrics;
  pendingInteraction?: Record<string, unknown>;
  sideEffectsLog?: Array<Record<string, unknown>>;
  completionEnvelope?: Record<string, unknown>;
}>;
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
  maxTurns: 10,
  theme: "system",
  showSessionMetrics: false,
  requireApprovals: false,
  allowNavigation: true,
  requirePlanConfirmation: false,
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
    reflexionLog: [],
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

function makeTurnCheckpoint(
  overrides: Partial<TurnCheckpoint> = {},
): TurnCheckpoint {
  const snapshot = {
    url: "https://example.com/catalog",
    visibleContent: "product list and add to cart",
    elements: [],
  };
  return {
    version: TURN_CHECKPOINT_VERSION,
    workspaceId: "ws-1",
    nodeId: "n1",
    savedAt: Date.now(),
    turnCount: 3,
    maxTurns: 10,
    currentPlanIndex: 0,
    turnsOnCurrentStep: 1,
    escalationsOnCurrentStep: 0,
    guardAfterDoneRejection: false,
    history: {
      recentMessages: [],
      olderSummaries: [],
      originalCount: 0,
    },
    planStatus: null,
    workingNotes: "",
    lastActionOutcome: null,
    modelTier: "executor",
    isFirstTurn: false,
    snapshotFingerprint: getSnapshotFingerprint(snapshot),
    pageUrl: snapshot.url,
    stepMutationLedger: [],
    sideEffectsLog: [],
    ...overrides,
  };
}

function makeRecoveryTaskCheckpoint(
  taskId: string,
  taskOverrides: Record<string, unknown> = {},
) {
  return {
    version: 1,
    savedAt: Date.now(),
    task: {
      id: taskId,
      query: "recover me",
      workspaceId: "ws-1",
      rootTabId: 101,
      status: "running" as const,
      nodes: [makeNode("n1", "recoverable step")].map((node) => ({
        ...node,
        status: "running" as const,
      })),
      createdAt: Date.now(),
      startedAt: Date.now(),
      maxWorkers: 1,
      currentIndex: 0,
      maxReplans: 2,
      replansUsed: 0,
      horizonExpansions: 0,
      budget: {
        maxSessionTimeMs: 60_000,
        maxTotalTokens: 100_000,
        maxTotalCostUsd: 10,
      },
      sessionMetrics: {
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        totalCost: 0,
        totalCostActual: 0,
        totalCostEstimated: 0,
        costMode: "none" as const,
        totalLlmTimeMs: 0,
        totalSessionTimeMs: 0,
        llmCallCount: 0,
        totalCachedTokens: 0,
        modelBreakdown: {},
      },
      ...taskOverrides,
    },
  };
}

describe("Orchestrator integration join tests", () => {
  beforeEach(() => {
    createdLoopNodeIds.length = 0;
    createdLoopConfigs.length = 0;
    capturedInstructions.length = 0;
    stoppedLoopNodeIds.length = 0;
    gracefulStopLoopNodeIds.length = 0;
    mockLoopCompletedResults.clear();
    plannerOverrideCalls.length = 0;
    verifierOverrideCalls.length = 0;
    plannerBuildNodeCalls = 0;
    verifierDecisionCalls = 0;

    plannerBuildNodesImpl = async () => [makeNode("n1", "step one")];
    plannerExpandNodeImpl = async () => null;
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });
    loopEmitStaleSignal = false;
    loopStartImpl = async (nodeId) => ({
      outcome: "completed",
      summary: `completed ${nodeId || "unknown"}`,
      metrics: undefined,
    });

    const runtimeMessages: any[] = [];
    const checkpointStore: Record<string, unknown> = {};
    const localStore: Record<string, unknown> = {};
    const runTraceEvents: any[] = [];
    const chromeAny = chrome as any;

    chromeAny.runtime ??= {};
    chromeAny.storage ??= {};
    chromeAny.storage.local ??= {};
    chromeAny.storage.sync ??= {};
    chromeAny.tabs ??= {};
    chromeAny.scripting ??= {};
    chromeAny.scripting.executeScript ??= vi.fn(async () => undefined);


    // Mock fetch so the router classifier returns "plan" (tests exercise the planner pipeline)
    const _origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (url.startsWith("http://127.0.0.1:7589/")) {
        try {
          const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
          if (url.endsWith("/run-traces") || url.endsWith("/run-traces/session")) {
            runTraceEvents.push({ url, body });
          }
        } catch {
          // ignore malformed trace payloads in tests
        }
        return new Response(null, { status: 204 });
      }
      // Router classifier calls — return "plan" so planner always runs
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"route":"plan","confidence":0.9,"reason":"test"}' } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    (chrome.runtime as any).sendMessage = vi.fn(async (msg: any) => {
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
    (globalThis as any).__runTraceEvents = runTraceEvents;

    (chrome.storage.local as any).get = vi.fn(async (key: string | string[] | null) => {
      if (key === null) {
        return {
          "opensidebar:orchestrator:checkpoints": checkpointStore,
          ...localStore,
        };
      }
      if (Array.isArray(key)) {
        return Object.fromEntries(
          key.map((entry) => [
            entry,
            entry === "opensidebar:orchestrator:checkpoints"
              ? checkpointStore
              : localStore[entry],
          ]),
        );
      }
      if (key === "opensidebar:orchestrator:checkpoints") {
        return { [key]: checkpointStore };
      }
      return { [key]: localStore[key] };
    });
    (chrome.storage.local as any).set = vi.fn(async (payload: Record<string, unknown>) => {
      const key = "opensidebar:orchestrator:checkpoints";
      for (const [entryKey, value] of Object.entries(payload)) {
        if (entryKey === key) {
          const checkpointValue = value as Record<string, unknown>;
          for (const [k, v] of Object.entries(checkpointValue)) checkpointStore[k] = v;
          for (const k of Object.keys(checkpointStore)) {
            if (!(k in checkpointValue)) delete checkpointStore[k];
          }
          continue;
        }
        localStore[entryKey] = value;
      }
    });
    (chrome.storage.local as any).remove = vi.fn(async (keys: string | string[]) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const entryKey of keyList) {
        if (entryKey === "opensidebar:orchestrator:checkpoints") {
          for (const k of Object.keys(checkpointStore)) delete checkpointStore[k];
          continue;
        }
        delete localStore[entryKey];
      }
    });
    (globalThis as any).__checkpointStore = checkpointStore;
    (globalThis as any).__localStore = localStore;

    (chrome.storage.sync as any).get = vi.fn(async (_key: string) => ({
      userSettings: baseSettings,
    }));
    (chrome.storage.session as any).get = vi.fn(async (_key: string) => ({
      openRouterApiKey: "resume-openrouter-key",
    }));

    (chrome.tabs as any).get = vi.fn(async (tabId: number) => ({
      id: tabId,
      url: "https://example.com/catalog",
      title: "Catalog Page",
      groupId: 1,
    }));
    (chrome.tabs as any).create = vi.fn(async () => ({ id: 202 }));
    (chrome.tabs as any).sendMessage = vi.fn(async () => ({
      payload: {
        snapshot: {
          title: "Catalog Page",
          url: "https://example.com/catalog",
          visibleContent: "product list and add to cart",
          elements: [],
          viewport: { width: 1200, height: 800 },
          scroll: { x: 0, y: 0, maxY: 5000 },
        },
      },
    }));
    (chrome.runtime as any).getManifest = () => ({ content_scripts: [] });

    orchestratorDeps = {
      createPlanner: (_apiKey, modelOverrides) => {
        plannerOverrideCalls.push(modelOverrides);
        return {
          buildNodes: async (...args: unknown[]) => {
            plannerBuildNodeCalls += 1;
            const nodes = await plannerBuildNodesImpl(...args);
            return { nodes, isSingleNode: false, difficulty: "moderate" as const };
          },
          expandNode: async (...args: unknown[]) => plannerExpandNodeImpl(...args),
        };
      },
      createVerifier: (_apiKey, modelOverrides) => {
        verifierOverrideCalls.push(modelOverrides);
        return {
          verifyNode: async (...args: unknown[]) => {
            verifierDecisionCalls += 1;
            return verifierDecisionImpl(...args);
          },
        };
      },
      createAgentLoop: (input) => {
        const cfg = (input.options as MockLoopConfig) || {};
        const callbacks = input.callbacks as
          | { onStep?: (step: any, update: boolean) => void }
          | undefined;
        createdLoopNodeIds.push(cfg.nodeId);
        createdLoopConfigs.push(cfg);
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
          stop() {
            if (cfg.nodeId) stoppedLoopNodeIds.push(cfg.nodeId);
          },
          requestStop() {
            if (cfg.nodeId) gracefulStopLoopNodeIds.push(cfg.nodeId);
          },
          pause() {},
          resume() {},
          isPaused() {
            return false;
          },
          injectFeedback(_text: string) {},
          get completedResult() {
            return cfg.nodeId
              ? (mockLoopCompletedResults.get(cfg.nodeId) ?? null)
              : null;
          },
        } as any;
      },
      workspaceManager: {
        async getWorkspaceById(_workspaceId: string) {
          return { id: "ws-1", tabIds: [101], tabGroupId: 1 };
        },
        async getWorkspaces() {
          return [{ id: "ws-1", tabIds: [101], tabGroupId: 1 }];
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
    await orchestrator.startTask(makeInput("collect the figures from each section, then summarize"));

    expect(createdLoopNodeIds).toEqual(["n1", "n2"]);
    expect(capturedInstructions[0].instruction).toContain("Objective: collect data");
    expect(capturedInstructions[1].instruction).toContain("Objective: summarize data");
  });

  test("simple lane topology skips planner decomposition and LLM verifier", async () => {
    plannerBuildNodesImpl = async () => {
      throw new Error("planner should not run");
    };
    verifierDecisionImpl = async () => {
      throw new Error("verifier should not run");
    };

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask({
      ...makeInput("Tell me what page I am on."),
      settings: {
        ...baseSettings,
        laneTopologyMode: "simple",
      },
    });

    expect(plannerBuildNodeCalls).toBe(0);
    expect(verifierDecisionCalls).toBe(0);
    expect(createdLoopNodeIds).toHaveLength(1);
    expect(capturedInstructions[0].instruction).toContain(
      "Objective: Tell me what page I am on.",
    );
  });

  test("passes deterministic completion rollback flag to executor loops", async () => {
    plannerBuildNodesImpl = async () => [makeNode("n1", "select answers")];

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask({
      ...makeInput("select the answers on each quiz page"),
      settings: {
        ...baseSettings,
        completionDeterministicAcceptanceEnabled: false,
      },
    });

    expect(createdLoopConfigs[0]).toMatchObject({
      nodeId: "n1",
      completionDeterministicAcceptanceEnabled: false,
    });
  });

  test("passes Fireworks provider settings to verifier and replanner", async () => {
    plannerBuildNodesImpl = async () => [makeNode("n1", "collect data")];

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask({
      ...makeInput("collect data"),
      openRouterApiKey: "fw-test-key",
      settings: {
        ...baseSettings,
        providerMode: "fireworks",
        fireworksApiKey: "fw-test-key",
        executorModel: "accounts/fireworks/routers/kimi-k2p5-turbo",
        plannerModel: "accounts/fireworks/routers/kimi-k2p5-turbo",
      },
    });

    expect(plannerOverrideCalls.length).toBeGreaterThanOrEqual(2);
    expect(verifierOverrideCalls).toHaveLength(1);
    for (const overrides of [...plannerOverrideCalls, ...verifierOverrideCalls]) {
      expect(overrides).toMatchObject({
        providerMode: "fireworks",
        fireworksApiKey: "fw-test-key",
        executorModel: "accounts/fireworks/routers/kimi-k2p5-turbo",
        plannerModel: "accounts/fireworks/routers/kimi-k2p5-turbo",
      });
    }
  });

  test("emits tab coordination state into run traces", async () => {
    plannerBuildNodesImpl = async () => [makeNode("n1", "collect data")];

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("collect data"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const runTraceEvents = (globalThis as any).__runTraceEvents as Array<{
      url: string;
      body: any;
    }>;
    const coordinationEvents = runTraceEvents.filter(
      (entry) =>
        entry.url.endsWith("/run-traces") &&
        entry.body?.type === "tab_coordination_state",
    );

    expect(coordinationEvents.length).toBeGreaterThan(0);
    expect(coordinationEvents[0].body.data).toMatchObject({
      action: "initialized",
      primaryTabId: 101,
      ownedTabCount: 1,
    });
    expect(
      coordinationEvents.some((entry) => entry.body.data?.action === "node_bound"),
    ).toBe(true);
  });

  test("does not skip remaining nodes when local success matches but root task contract is incomplete", async () => {
    const first = makeNode("n1", "Navigate to Warehouse Beta");
    first.successCriteria = "Page shows Warehouse Beta and page 2 of 3";
    const second = makeNode("n2", "Read Warehouse Gamma inventory");
    second.successCriteria = "Page shows Warehouse Beta and page 2 of 3";
    const third = makeNode("n3", "Return to Warehouse Alpha and report Alpha inventory");
    third.successCriteria = "Page shows Warehouse Beta and page 2 of 3";
    plannerBuildNodesImpl = async () => [first, second, third];
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });
    (chrome.tabs as any).sendMessage = vi.fn(async () => ({
      payload: {
        snapshot: {
          title: "Navigation Chain",
          url: "http://127.0.0.1:61549/go-back-chain?step=2",
          visibleContent: "Warehouse Beta page 2 of 3 inventory count hidden",
          pageContent: "Warehouse Beta page 2 of 3 inventory count hidden",
          elements: [],
          viewport: { width: 1200, height: 800 },
          scroll: { x: 0, y: 0, maxY: 2000 },
        },
      },
    }));

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(
      makeInput(
        "Go to Warehouse Beta, then Warehouse Gamma, then return to Warehouse Alpha and report both Gamma and Alpha inventory counts.",
      ),
    );

    expect(createdLoopNodeIds).toEqual(["n1", "n2", "n3"]);
    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion).toBeDefined();
    expect(completion?.payload?.status).toBe("partial");
    expect(String(completion?.payload?.terminationReason || "")).toContain(
      "Task contract incomplete",
    );
    expect(
      completion?.payload?.subtaskResults?.some(
        (item: any) =>
          String(item.result || "").includes("Skipped: global goal already achieved"),
      ),
    ).toBe(false);
  });

  test("treats global-goal shortcut skips as completed when root task contract is satisfied", async () => {
    const first = makeNode(
      "n1",
      "Read the Overview tab and gather the key metrics needed for a comparison.",
    );
    first.successCriteria =
      "The key Overview metrics are collected for the final comparison.";
    const second = makeNode(
      "n2",
      "Review the remaining dashboard context for the final comparison.",
      ["n1"],
    );
    second.successCriteria =
      "Final answer identifies traffic as the strongest area based on both tabs.";
    plannerBuildNodesImpl = async () => [first, second];
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });
    loopStartImpl = async () => ({
      outcome: "completed",
      summary:
        "Traffic is strongest based on both tabs: Google Search traffic is up 15%, users are up 12%, and revenue is up 8%.",
    });
    (chrome.tabs as any).sendMessage = vi.fn(async () => ({
      payload: {
        snapshot: {
          title: "Admin Dashboard",
          url: "http://127.0.0.1:61549/dashboard",
          visibleContent:
            "Overview: Users up 12%, Revenue up 8%, Google Search traffic up 15%. Reports: Monthly performance, engagement funnel, detailed traffic source analysis. Traffic is strongest based on both tabs.",
          pageContent:
            "Overview: Users up 12%, Revenue up 8%, Google Search traffic up 15%. Reports: Monthly performance, engagement funnel, detailed traffic source analysis. Traffic is strongest based on both tabs.",
          elements: [],
          viewport: { width: 1200, height: 800 },
          scroll: { x: 0, y: 0, maxY: 2000 },
        },
      },
    }));

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(
      makeInput(
        "Based on what you saw in both tabs, which area of the business looks strongest - user growth, revenue, or traffic? Give a brief answer referencing the data.",
      ),
    );

    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion).toBeDefined();
    expect(completion?.payload?.status).toBe("completed");
    expect(completion?.payload?.subtaskResults?.[1]?.status).toBe("skipped");
    expect(completion?.payload?.subtaskResults?.[1]?.result).toContain(
      "Skipped: global goal already achieved",
    );
    const runTraceEvents = (globalThis as any).__runTraceEvents as Array<{
      url: string;
      body: { type?: string; data?: Record<string, unknown> };
    }>;
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.body.type === "completion_scope_transition" &&
          entry.body.data?.scope === "root" &&
          entry.body.data?.status === "sibling_ignored" &&
          entry.body.data?.reason === "global_goal_already_achieved" &&
          Array.isArray(entry.body.data?.skippedNodeIds) &&
          (entry.body.data.skippedNodeIds as string[]).includes("n2"),
      ),
    ).toBe(true);
  });

  test("stops active global-goal siblings after root goal completion", async () => {
    const first = makeNode(
      "n1",
      "Read the Overview tab and gather the key metrics needed for a comparison.",
    );
    first.successCriteria =
      "The key Overview metrics are collected for the final comparison.";
    const second = makeNode(
      "n2",
      "Review the remaining dashboard context for the final comparison.",
    );
    second.successCriteria =
      "Final answer identifies traffic as the strongest area based on both tabs.";
    plannerBuildNodesImpl = async () => [first, second];
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });
    orchestratorDeps.lanePolicies = {
      executor: { maxConcurrent: 2 },
    };
    loopStartImpl = async (nodeId) => {
      if (nodeId === "n1") {
        return {
          outcome: "completed",
          summary:
            "Traffic is strongest based on both tabs: Google Search traffic is up 15%, users are up 12%, and revenue is up 8%.",
        };
      }
      return await new Promise((resolve) => {
        const startedAt = Date.now();
        const poll = () => {
          if (nodeId && gracefulStopLoopNodeIds.includes(nodeId)) {
            resolve({
              outcome: "stopped",
              summary: "Stopped after global root completion.",
            });
            return;
          }
          if (Date.now() - startedAt > 250) {
            resolve({
              outcome: "completed",
              summary: "Unexpectedly completed remaining dashboard review.",
            });
            return;
          }
          setTimeout(poll, 5);
        };
        poll();
      });
    };
    (chrome.tabs as any).sendMessage = vi.fn(async () => ({
      payload: {
        snapshot: {
          title: "Admin Dashboard",
          url: "http://127.0.0.1:61549/dashboard",
          visibleContent:
            "Overview: Users up 12%, Revenue up 8%, Google Search traffic up 15%. Reports: Monthly performance, engagement funnel, detailed traffic source analysis. Traffic is strongest based on both tabs.",
          pageContent:
            "Overview: Users up 12%, Revenue up 8%, Google Search traffic up 15%. Reports: Monthly performance, engagement funnel, detailed traffic source analysis. Traffic is strongest based on both tabs.",
          elements: [],
          viewport: { width: 1200, height: 800 },
          scroll: { x: 0, y: 0, maxY: 2000 },
        },
      },
    }));

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(
      makeInput(
        "Based on what you saw in both tabs, which area of the business looks strongest - user growth, revenue, or traffic? Give a brief answer referencing the data.",
      ),
    );

    expect(createdLoopNodeIds).toEqual(expect.arrayContaining(["n1", "n2"]));
    expect(gracefulStopLoopNodeIds).toContain("n2");
    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion?.payload?.status).toBe("completed");
    expect(completion?.payload?.subtaskResults?.[1]?.status).toBe("skipped");
    const runTraceEvents = (globalThis as any).__runTraceEvents as Array<{
      url: string;
      body: { type?: string; data?: Record<string, unknown> };
    }>;
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.body.type === "worker_cancelled" &&
          entry.body.data?.nodeId === "n2" &&
          entry.body.data?.reason === "global_goal_already_achieved",
      ),
    ).toBe(true);
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.body.type === "completion_scope_transition" &&
          entry.body.data?.scope === "root" &&
          entry.body.data?.status === "sibling_ignored" &&
          Array.isArray(entry.body.data?.skippedNodeIds) &&
          (entry.body.data.skippedNodeIds as string[]).includes("n2"),
      ),
    ).toBe(true);
  });

  test("ignores late completed sibling results after root goal completion", async () => {
    const first = makeNode(
      "n1",
      "Read the Overview tab and gather the key metrics needed for a comparison.",
    );
    first.successCriteria =
      "The key Overview metrics are collected for the final comparison.";
    const second = makeNode(
      "n2",
      "Review the remaining dashboard context for the final comparison.",
    );
    second.successCriteria =
      "Final answer identifies traffic as the strongest area based on both tabs.";
    plannerBuildNodesImpl = async () => [first, second];
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });
    orchestratorDeps.lanePolicies = {
      executor: { maxConcurrent: 2 },
    };
    loopStartImpl = async (nodeId) => {
      if (nodeId === "n1") {
        return {
          outcome: "completed",
          summary:
            "Traffic is strongest based on both tabs: Google Search traffic is up 15%, users are up 12%, and revenue is up 8%.",
        };
      }
      return await new Promise((resolve) => {
        const startedAt = Date.now();
        const poll = () => {
          if (
            nodeId &&
            gracefulStopLoopNodeIds.includes(nodeId) &&
            Date.now() - startedAt > 10
          ) {
            resolve({
              outcome: "completed",
              summary: "Late sibling result that must not overwrite skipped.",
            });
            return;
          }
          if (Date.now() - startedAt > 250) {
            resolve({
              outcome: "completed",
              summary: "Late sibling result without observed stop.",
            });
            return;
          }
          setTimeout(poll, 5);
        };
        poll();
      });
    };
    (chrome.tabs as any).sendMessage = vi.fn(async () => ({
      payload: {
        snapshot: {
          title: "Admin Dashboard",
          url: "http://127.0.0.1:61549/dashboard",
          visibleContent:
            "Overview: Users up 12%, Revenue up 8%, Google Search traffic up 15%. Reports: Monthly performance, engagement funnel, detailed traffic source analysis. Traffic is strongest based on both tabs.",
          pageContent:
            "Overview: Users up 12%, Revenue up 8%, Google Search traffic up 15%. Reports: Monthly performance, engagement funnel, detailed traffic source analysis. Traffic is strongest based on both tabs.",
          elements: [],
          viewport: { width: 1200, height: 800 },
          scroll: { x: 0, y: 0, maxY: 2000 },
        },
      },
    }));

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(
      makeInput(
        "Based on what you saw in both tabs, which area of the business looks strongest - user growth, revenue, or traffic? Give a brief answer referencing the data.",
      ),
    );

    expect(gracefulStopLoopNodeIds).toContain("n2");
    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion?.payload?.status).toBe("completed");
    expect(completion?.payload?.subtaskResults?.[1]?.status).toBe("skipped");
    expect(completion?.payload?.subtaskResults?.[1]?.result).toContain(
      "Skipped: global goal already achieved",
    );
    expect(completion?.payload?.subtaskResults?.[1]?.result).not.toContain(
      "Late sibling result",
    );
    const runTraceEvents = (globalThis as any).__runTraceEvents as Array<{
      url: string;
      body: { type?: string; data?: Record<string, unknown> };
    }>;
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.body.type === "worker_result_ignored" &&
          entry.body.data?.nodeId === "n2" &&
          entry.body.data?.currentStatus === "skipped" &&
          entry.body.data?.executorOutcome === "completed" &&
          entry.body.data?.reason === "node_already_terminal",
      ),
    ).toBe(true);
  });

  test("ignores late error sibling results after root goal completion", async () => {
    const first = makeNode(
      "n1",
      "Read the Overview tab and gather the key metrics needed for a comparison.",
    );
    first.successCriteria =
      "The key Overview metrics are collected for the final comparison.";
    const second = makeNode(
      "n2",
      "Review the remaining dashboard context for the final comparison.",
    );
    second.successCriteria =
      "Final answer identifies traffic as the strongest area based on both tabs.";
    plannerBuildNodesImpl = async () => [first, second];
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });
    orchestratorDeps.lanePolicies = {
      executor: { maxConcurrent: 2 },
    };
    loopStartImpl = async (nodeId) => {
      if (nodeId === "n1") {
        return {
          outcome: "completed",
          summary:
            "Traffic is strongest based on both tabs: Google Search traffic is up 15%, users are up 12%, and revenue is up 8%.",
        };
      }
      return await new Promise((resolve) => {
        const startedAt = Date.now();
        const poll = () => {
          if (
            nodeId &&
            gracefulStopLoopNodeIds.includes(nodeId) &&
            Date.now() - startedAt > 10
          ) {
            resolve({
              outcome: "error",
              summary: "Late sibling error that must not overwrite skipped.",
            });
            return;
          }
          if (Date.now() - startedAt > 250) {
            resolve({
              outcome: "error",
              summary: "Late sibling error without observed stop.",
            });
            return;
          }
          setTimeout(poll, 5);
        };
        poll();
      });
    };
    (chrome.tabs as any).sendMessage = vi.fn(async () => ({
      payload: {
        snapshot: {
          title: "Admin Dashboard",
          url: "http://127.0.0.1:61549/dashboard",
          visibleContent:
            "Overview: Users up 12%, Revenue up 8%, Google Search traffic up 15%. Reports: Monthly performance, engagement funnel, detailed traffic source analysis. Traffic is strongest based on both tabs.",
          pageContent:
            "Overview: Users up 12%, Revenue up 8%, Google Search traffic up 15%. Reports: Monthly performance, engagement funnel, detailed traffic source analysis. Traffic is strongest based on both tabs.",
          elements: [],
          viewport: { width: 1200, height: 800 },
          scroll: { x: 0, y: 0, maxY: 2000 },
        },
      },
    }));

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(
      makeInput(
        "Based on what you saw in both tabs, which area of the business looks strongest - user growth, revenue, or traffic? Give a brief answer referencing the data.",
      ),
    );

    expect(gracefulStopLoopNodeIds).toContain("n2");
    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion?.payload?.status).toBe("completed");
    expect(completion?.payload?.subtaskResults?.[1]?.status).toBe("skipped");
    expect(completion?.payload?.subtaskResults?.[1]?.result).toContain(
      "Skipped: global goal already achieved",
    );
    expect(completion?.payload?.subtaskResults?.[1]?.result).not.toContain(
      "Late sibling error",
    );
    const runTraceEvents = (globalThis as any).__runTraceEvents as Array<{
      url: string;
      body: { type?: string; data?: Record<string, unknown> };
    }>;
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.body.type === "worker_result_ignored" &&
          entry.body.data?.nodeId === "n2" &&
          entry.body.data?.currentStatus === "skipped" &&
          entry.body.data?.executorOutcome === "error" &&
          entry.body.data?.reason === "node_already_terminal",
      ),
    ).toBe(true);
  });

  test("ignores thrown late sibling errors after root goal completion", async () => {
    const first = makeNode(
      "n1",
      "Read the Overview tab and gather the key metrics needed for a comparison.",
    );
    first.successCriteria =
      "The key Overview metrics are collected for the final comparison.";
    const second = makeNode(
      "n2",
      "Review the remaining dashboard context for the final comparison.",
    );
    second.successCriteria =
      "Final answer identifies traffic as the strongest area based on both tabs.";
    plannerBuildNodesImpl = async () => [first, second];
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });
    orchestratorDeps.lanePolicies = {
      executor: { maxConcurrent: 2 },
    };
    loopStartImpl = async (nodeId) => {
      if (nodeId === "n1") {
        return {
          outcome: "completed",
          summary:
            "Traffic is strongest based on both tabs: Google Search traffic is up 15%, users are up 12%, and revenue is up 8%.",
        };
      }
      await new Promise<void>((resolve) => {
        const startedAt = Date.now();
        const poll = () => {
          if (
            nodeId &&
            gracefulStopLoopNodeIds.includes(nodeId) &&
            Date.now() - startedAt > 10
          ) {
            resolve();
            return;
          }
          if (Date.now() - startedAt > 250) {
            resolve();
            return;
          }
          setTimeout(poll, 5);
        };
        poll();
      });
      throw new Error("Late thrown sibling failure that must not overwrite skipped.");
    };
    (chrome.tabs as any).sendMessage = vi.fn(async () => ({
      payload: {
        snapshot: {
          title: "Admin Dashboard",
          url: "http://127.0.0.1:61549/dashboard",
          visibleContent:
            "Overview: Users up 12%, Revenue up 8%, Google Search traffic up 15%. Reports: Monthly performance, engagement funnel, detailed traffic source analysis. Traffic is strongest based on both tabs.",
          pageContent:
            "Overview: Users up 12%, Revenue up 8%, Google Search traffic up 15%. Reports: Monthly performance, engagement funnel, detailed traffic source analysis. Traffic is strongest based on both tabs.",
          elements: [],
          viewport: { width: 1200, height: 800 },
          scroll: { x: 0, y: 0, maxY: 2000 },
        },
      },
    }));

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(
      makeInput(
        "Based on what you saw in both tabs, which area of the business looks strongest - user growth, revenue, or traffic? Give a brief answer referencing the data.",
      ),
    );

    expect(gracefulStopLoopNodeIds).toContain("n2");
    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion?.payload?.status).toBe("completed");
    expect(completion?.payload?.subtaskResults?.[1]?.status).toBe("skipped");
    expect(completion?.payload?.subtaskResults?.[1]?.result).toContain(
      "Skipped: global goal already achieved",
    );
    expect(completion?.payload?.subtaskResults?.[1]?.result).not.toContain(
      "Late thrown sibling failure",
    );
    const runTraceEvents = (globalThis as any).__runTraceEvents as Array<{
      url: string;
      body: { type?: string; data?: Record<string, unknown> };
    }>;
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.body.type === "worker_result_ignored" &&
          entry.body.data?.nodeId === "n2" &&
          entry.body.data?.currentStatus === "skipped" &&
          entry.body.data?.executorOutcome === "error" &&
          entry.body.data?.reason === "node_already_terminal" &&
          String(entry.body.data?.error || "").includes(
            "Late thrown sibling failure",
          ),
      ),
    ).toBe(true);
  });

  test("preserves full user-facing completion summaries beyond compact handoff length", async () => {
    const longSummary = [
      "## Job Posting Summary",
      "",
      "**Position:** Administrative Assistant in the Juridicum Library  ",
      "**Employment Type:** Part-time, substitute employee  ",
      "**Location:** Altenberger Strasse 69, 4040 Linz (JKU Campus)",
      "",
      "### Duties",
      "- Ordering book requests and eBook requests",
      "- Invoice processing and budget management",
      "- Information desk service and reservations",
      "- Managing books, journals, reading areas, and storage rooms",
      "- Communicating with institutes of the Juridicum faculty",
      "",
      "### Contact",
      "Hofraetin Mag.a Sieglinde Hable",
      "Phone: +43 732 2468 3656",
      "Email: sieglinde.hable@jku.at",
      "",
      "This final sentence must remain visible after the five hundred character boundary.",
    ].join("\n");

    plannerBuildNodesImpl = async () => [
      makeNode("n1", "Read and summarize the current page"),
    ];
    loopStartImpl = async () => ({
      outcome: "completed",
      summary: longSummary,
      metrics: undefined,
    });
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("Summarize this page"));

    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");

    expect(completion?.payload?.summary).toBe(longSummary);
    expect(completion?.payload?.summary.length).toBeGreaterThan(500);
    expect(completion?.payload?.summary).toContain(
      "This final sentence must remain visible",
    );
    expect(
      completion?.payload?.subtaskResults?.[0]?.result.length,
    ).toBeLessThanOrEqual(500);
  });

  test("does not use global-goal shortcut when the remaining node is an action step", async () => {
    const first = makeNode("n1", "Reveal Widget X SKU");
    first.successCriteria = "Widget X SKU is visible.";
    const second = makeNode("n2", "Search for Widget X using the revealed SKU");
    second.successCriteria = "Widget X SKU is visible.";
    plannerBuildNodesImpl = async () => [first, second];
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });
    (chrome.tabs as any).sendMessage = vi.fn(async () => ({
      payload: {
        snapshot: {
          title: "Hover Menus",
          url: "http://127.0.0.1:61549/hover-menus",
          visibleContent:
            "Products menu revealed. Electronics selected. Widget X SKU-4829 visible. Search input and Search button still present.",
          pageContent:
            "Products menu revealed. Electronics selected. Widget X SKU-4829 visible. Search input and Search button still present.",
          elements: [],
          viewport: { width: 1200, height: 800 },
          scroll: { x: 0, y: 0, maxY: 2000 },
        },
      },
    }));

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(
      makeInput(
        "Go to Electronics under the Products menu, find the SKU number for Widget X, and search for it.",
      ),
    );

    expect(createdLoopNodeIds).toEqual(["n1", "n2"]);
    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion).toBeDefined();
    expect(
      completion?.payload?.subtaskResults?.some(
        (item: any) =>
          String(item.result || "").includes("Skipped: global goal already achieved"),
      ),
    ).toBe(false);
  });

  test("skips remaining planner micro-steps after a navigation-only goal is already satisfied", async () => {
    const first = makeNode(
      "n1",
      "Open the Performance Analytics application navigator module",
    );
    first.successCriteria =
      "The Breakdowns > Elements Filters module is open in Performance Analytics.";
    const second = makeNode(
      "n2",
      "Search for and open the Performance Analytics application",
      ["n1"],
    );
    second.successCriteria = "Performance Analytics application is selected.";
    const third = makeNode(
      "n3",
      "Click Elements Filters under Breakdowns",
      ["n2"],
    );
    third.successCriteria = "Elements Filters is open.";
    plannerBuildNodesImpl = async () => [first, second, third];
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });
    loopStartImpl = async () => ({
      outcome: "completed",
      summary:
        'Successfully navigated to the "Breakdowns > Elements Filters" module of the "Performance Analytics" application.',
    });
    (chrome.tabs as any).sendMessage = vi.fn(async () => ({
      payload: {
        snapshot: {
          title: "Elements Filters | ServiceNow",
          url: "https://workarenapublic16.service-now.com/now/nav/ui/classic/params/target/pa_filters_list.do",
          visibleContent:
            "Performance Analytics Elements Filters list with Title, Breakdown source, and Filter columns.",
          pageContent:
            "Performance Analytics Breakdowns Elements Filters list with Title, Breakdown source, and Filter columns.",
          elements: [],
          viewport: { width: 1200, height: 800 },
          scroll: { x: 0, y: 0, maxY: 0 },
        },
      },
    }));

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(
      makeInput(
        'Navigate to the "Breakdowns > Elements Filters" module of the "Performance Analytics" application.',
      ),
    );

    expect(createdLoopNodeIds).toEqual(["n1"]);
    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion).toBeDefined();
    expect(completion?.payload?.status).toBe("completed");
    expect(
      completion?.payload?.subtaskResults
        ?.slice(1)
        .every((item: any) => item.status === "skipped"),
    ).toBe(true);
    const runTraceEvents = (globalThis as any).__runTraceEvents as Array<{
      url: string;
      body: { type?: string; data?: Record<string, unknown> };
    }>;
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.url.endsWith("/run-traces") &&
          entry.body.type === "navigation_goal_gate" &&
          entry.body.data?.skippedNodes === 2,
      ),
    ).toBe(true);
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.body.type === "completion_scope_transition" &&
          entry.body.data?.scope === "root" &&
          entry.body.data?.status === "sibling_ignored" &&
          entry.body.data?.reason === "navigation_goal_already_achieved" &&
          Array.isArray(entry.body.data?.skippedNodeIds) &&
          (entry.body.data.skippedNodeIds as string[]).includes("n2") &&
          (entry.body.data.skippedNodeIds as string[]).includes("n3"),
      ),
    ).toBe(true);
  });

  test("stops active navigation siblings after root goal completion", async () => {
    const first = makeNode(
      "n1",
      "Open the Performance Analytics Elements Filters module",
    );
    first.successCriteria =
      "The Breakdowns > Elements Filters module is open in Performance Analytics.";
    const second = makeNode(
      "n2",
      "Continue scanning Performance Analytics navigation shortcuts",
    );
    second.successCriteria = "Navigation shortcut scan is complete.";
    plannerBuildNodesImpl = async () => [first, second];
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });
    orchestratorDeps.lanePolicies = {
      executor: { maxConcurrent: 2 },
    };
    loopStartImpl = async (nodeId) => {
      if (nodeId === "n1") {
        return {
          outcome: "completed",
          summary:
            'Successfully navigated to the "Breakdowns > Elements Filters" module of the "Performance Analytics" application.',
        };
      }
      return await new Promise((resolve) => {
        const startedAt = Date.now();
        const poll = () => {
          if (nodeId && gracefulStopLoopNodeIds.includes(nodeId)) {
            resolve({
              outcome: "stopped",
              summary: "Stopped after root navigation completion.",
            });
            return;
          }
          if (Date.now() - startedAt > 250) {
            resolve({
              outcome: "completed",
              summary: "Unexpectedly completed sibling navigation scan.",
            });
            return;
          }
          setTimeout(poll, 5);
        };
        poll();
      });
    };
    (chrome.tabs as any).sendMessage = vi.fn(async () => ({
      payload: {
        snapshot: {
          title: "Elements Filters | ServiceNow",
          url: "https://workarenapublic16.service-now.com/now/nav/ui/classic/params/target/pa_filters_list.do",
          visibleContent:
            "Performance Analytics Elements Filters list with Title, Breakdown source, and Filter columns.",
          pageContent:
            "Performance Analytics Breakdowns Elements Filters list with Title, Breakdown source, and Filter columns.",
          elements: [],
          viewport: { width: 1200, height: 800 },
          scroll: { x: 0, y: 0, maxY: 0 },
        },
      },
    }));

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(
      makeInput(
        'Navigate to the "Breakdowns > Elements Filters" module of the "Performance Analytics" application.',
      ),
    );

    expect(createdLoopNodeIds).toEqual(expect.arrayContaining(["n1", "n2"]));
    expect(gracefulStopLoopNodeIds).toContain("n2");
    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion?.payload?.status).toBe("completed");
    expect(completion?.payload?.subtaskResults?.[1]?.status).toBe("skipped");
    const runTraceEvents = (globalThis as any).__runTraceEvents as Array<{
      url: string;
      body: { type?: string; data?: Record<string, unknown> };
    }>;
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.body.type === "worker_cancelled" &&
          entry.body.data?.nodeId === "n2" &&
          entry.body.data?.reason === "navigation_goal_already_achieved",
      ),
    ).toBe(true);
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.body.type === "completion_scope_transition" &&
          entry.body.data?.scope === "root" &&
          entry.body.data?.status === "sibling_ignored" &&
          Array.isArray(entry.body.data?.skippedNodeIds) &&
          (entry.body.data.skippedNodeIds as string[]).includes("n2"),
      ),
    ).toBe(true);
  });

  test("skips dependent pending navigation descendants after root goal completion", async () => {
    const first = makeNode(
      "n1",
      "Open the Performance Analytics Elements Filters module",
    );
    first.successCriteria =
      "The Breakdowns > Elements Filters module is open in Performance Analytics.";
    const second = makeNode(
      "n2",
      "Continue scanning Performance Analytics navigation shortcuts",
    );
    second.successCriteria = "Navigation shortcut scan is complete.";
    const third = makeNode(
      "n3",
      "Open the fallback Performance Analytics module if shortcut scan fails",
      ["n2"],
    );
    third.successCriteria = "Fallback module is open.";
    const fourth = makeNode(
      "n4",
      "Confirm the fallback Performance Analytics page title",
      ["n3"],
    );
    fourth.successCriteria = "Fallback title is confirmed.";
    plannerBuildNodesImpl = async () => [first, second, third, fourth];
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });
    orchestratorDeps.lanePolicies = {
      executor: { maxConcurrent: 2 },
    };
    loopStartImpl = async (nodeId) => {
      if (nodeId === "n1") {
        return {
          outcome: "completed",
          summary:
            'Successfully navigated to the "Breakdowns > Elements Filters" module of the "Performance Analytics" application.',
        };
      }
      return await new Promise((resolve) => {
        const startedAt = Date.now();
        const poll = () => {
          if (nodeId && gracefulStopLoopNodeIds.includes(nodeId)) {
            resolve({
              outcome: "stopped",
              summary: "Stopped after root navigation completion.",
            });
            return;
          }
          if (Date.now() - startedAt > 250) {
            resolve({
              outcome: "completed",
              summary: "Unexpectedly completed sibling navigation scan.",
            });
            return;
          }
          setTimeout(poll, 5);
        };
        poll();
      });
    };
    (chrome.tabs as any).sendMessage = vi.fn(async () => ({
      payload: {
        snapshot: {
          title: "Elements Filters | ServiceNow",
          url: "https://workarenapublic16.service-now.com/now/nav/ui/classic/params/target/pa_filters_list.do",
          visibleContent:
            "Performance Analytics Elements Filters list with Title, Breakdown source, and Filter columns.",
          pageContent:
            "Performance Analytics Breakdowns Elements Filters list with Title, Breakdown source, and Filter columns.",
          elements: [],
          viewport: { width: 1200, height: 800 },
          scroll: { x: 0, y: 0, maxY: 0 },
        },
      },
    }));

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(
      makeInput(
        'Navigate to the "Breakdowns > Elements Filters" module of the "Performance Analytics" application.',
      ),
    );

    expect(createdLoopNodeIds).toEqual(expect.arrayContaining(["n1", "n2"]));
    expect(createdLoopNodeIds).not.toContain("n3");
    expect(createdLoopNodeIds).not.toContain("n4");
    expect(gracefulStopLoopNodeIds).toContain("n2");
    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion?.payload?.status).toBe("completed");
    expect(completion?.payload?.subtaskResults?.[1]?.status).toBe("skipped");
    expect(completion?.payload?.subtaskResults?.[2]?.status).toBe("skipped");
    expect(completion?.payload?.subtaskResults?.[3]?.status).toBe("skipped");
    const runTraceEvents = (globalThis as any).__runTraceEvents as Array<{
      url: string;
      body: { type?: string; data?: Record<string, unknown> };
    }>;
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.body.type === "worker_cancelled" &&
          entry.body.data?.nodeId === "n2" &&
          entry.body.data?.reason === "navigation_goal_already_achieved",
      ),
    ).toBe(true);
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.body.type === "completion_scope_transition" &&
          entry.body.data?.scope === "root" &&
          entry.body.data?.status === "sibling_ignored" &&
          entry.body.data?.reason === "navigation_goal_already_achieved" &&
          Array.isArray(entry.body.data?.skippedNodeIds) &&
          (entry.body.data.skippedNodeIds as string[]).includes("n2") &&
          (entry.body.data.skippedNodeIds as string[]).includes("n3") &&
          (entry.body.data.skippedNodeIds as string[]).includes("n4"),
      ),
    ).toBe(true);
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.body.type === "worker_result_ignored" &&
          entry.body.data?.nodeId === "n2" &&
          entry.body.data?.currentStatus === "skipped" &&
          entry.body.data?.executorOutcome === "stopped" &&
          entry.body.data?.reason === "node_already_terminal",
      ),
    ).toBe(true);
  });

  test("ignores late user-interaction sibling results after root navigation completion", async () => {
    const first = makeNode(
      "n1",
      "Open the Performance Analytics Elements Filters module",
    );
    first.successCriteria =
      "The Breakdowns > Elements Filters module is open in Performance Analytics.";
    const second = makeNode(
      "n2",
      "Ask which Performance Analytics shortcut should be inspected next",
    );
    second.successCriteria = "A follow-up shortcut is selected.";
    const third = makeNode(
      "n3",
      "Request approval before opening another Performance Analytics shortcut",
    );
    third.successCriteria = "Approval is collected for another shortcut.";
    plannerBuildNodesImpl = async () => [first, second, third];
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });
    orchestratorDeps.lanePolicies = {
      executor: { maxConcurrent: 3 },
    };
    loopStartImpl = async (nodeId) => {
      if (nodeId === "n1") {
        return {
          outcome: "completed",
          summary:
            'Successfully navigated to the "Breakdowns > Elements Filters" module of the "Performance Analytics" application.',
        };
      }
      return await new Promise((resolve) => {
        const startedAt = Date.now();
        const poll = () => {
          if (
            nodeId &&
            gracefulStopLoopNodeIds.includes(nodeId) &&
            Date.now() - startedAt > 10
          ) {
            resolve(
              nodeId === "n2"
                ? {
                    outcome: "awaiting_clarification",
                    summary:
                      "Late sibling clarification that must not pause a completed task.",
                    pendingInteraction: {
                      kind: "clarification",
                      clarificationId: "clarify-after-root-completion",
                      nodeId,
                      question: "Which shortcut should be inspected next?",
                      requestedAt: Date.now(),
                      timeoutMs: 60_000,
                    },
                  }
                : {
                    outcome: "awaiting_approval",
                    summary:
                      "Late sibling approval that must not pause a completed task.",
                    pendingInteraction: {
                      kind: "approval",
                      approvalId: "approval-after-root-completion",
                      nodeId,
                      toolName: "click",
                      args: {},
                      requestedAt: Date.now(),
                      timeoutMs: 60_000,
                    },
                  },
            );
            return;
          }
          if (Date.now() - startedAt > 250) {
            resolve({
              outcome: "failed",
              summary: "Late sibling did not observe root-completion stop.",
            });
            return;
          }
          setTimeout(poll, 5);
        };
        poll();
      });
    };
    (chrome.tabs as any).sendMessage = vi.fn(async () => ({
      payload: {
        snapshot: {
          title: "Elements Filters | ServiceNow",
          url: "https://workarenapublic16.service-now.com/now/nav/ui/classic/params/target/pa_filters_list.do",
          visibleContent:
            "Performance Analytics Elements Filters list with Title, Breakdown source, and Filter columns.",
          pageContent:
            "Performance Analytics Breakdowns Elements Filters list with Title, Breakdown source, and Filter columns.",
          elements: [],
          viewport: { width: 1200, height: 800 },
          scroll: { x: 0, y: 0, maxY: 0 },
        },
      },
    }));

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(
      makeInput(
        'Navigate to the "Breakdowns > Elements Filters" module of the "Performance Analytics" application.',
      ),
    );

    expect(createdLoopNodeIds).toEqual(
      expect.arrayContaining(["n1", "n2", "n3"]),
    );
    expect(gracefulStopLoopNodeIds).toEqual(
      expect.arrayContaining(["n2", "n3"]),
    );
    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion?.payload?.status).toBe("completed");
    expect(completion?.payload?.subtaskResults?.[1]?.status).toBe("skipped");
    expect(completion?.payload?.subtaskResults?.[2]?.status).toBe("skipped");
    expect(messages.some((m) => m.type === "ESCALATION_REQUEST")).toBe(false);
    expect(
      messages.some(
        (m) =>
          m.type === "TASK_STATUS" &&
          String(m.payload?.message || "").includes("Awaiting user input"),
      ),
    ).toBe(false);
    const runTraceEvents = (globalThis as any).__runTraceEvents as Array<{
      url: string;
      body: { type?: string; data?: Record<string, unknown> };
    }>;
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.body.type === "worker_result_ignored" &&
          entry.body.data?.nodeId === "n2" &&
          entry.body.data?.currentStatus === "skipped" &&
          entry.body.data?.executorOutcome === "awaiting_clarification" &&
          entry.body.data?.reason === "node_already_terminal",
      ),
    ).toBe(true);
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.body.type === "worker_result_ignored" &&
          entry.body.data?.nodeId === "n3" &&
          entry.body.data?.currentStatus === "skipped" &&
          entry.body.data?.executorOutcome === "awaiting_approval" &&
          entry.body.data?.reason === "node_already_terminal",
      ),
    ).toBe(true);
  });

  test("ignores late verifier reroute after root navigation completion skips a sibling", async () => {
    const first = makeNode(
      "n1",
      "Open the Performance Analytics Elements Filters module",
    );
    first.successCriteria =
      "The Breakdowns > Elements Filters module is open in Performance Analytics.";
    const second = makeNode(
      "n2",
      "Delete a temporary navigation shortcut only if the primary route fails",
    );
    second.successCriteria =
      "A safe alternate route is prepared only when the primary route fails.";
    plannerBuildNodesImpl = async () => [first, second];
    orchestratorDeps.lanePolicies = {
      executor: { maxConcurrent: 2 },
      verifier: { maxConcurrent: 2 },
    };
    verifierDecisionImpl = async (...args: unknown[]) => {
      const input = args[0] as { objective?: string };
      if (String(input.objective || "").includes("temporary navigation")) {
        await new Promise<void>((resolve) => {
          const startedAt = Date.now();
          const poll = () => {
            if (
              gracefulStopLoopNodeIds.includes("n2") ||
              Date.now() - startedAt > 500
            ) {
              resolve();
              return;
            }
            setTimeout(poll, 5);
          };
          poll();
        });
        return {
          decision: "reroute",
          reason: "Late verifier reroute that must not overwrite skipped.",
          rerouteObjective: "Open an alternate Performance Analytics route.",
        };
      }
      return { decision: "accept", reason: "ok" };
    };
    loopStartImpl = async (nodeId) => {
      if (nodeId === "n1") {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          outcome: "completed",
          summary:
            'Successfully navigated to the "Breakdowns > Elements Filters" module of the "Performance Analytics" application.',
        };
      }
      return {
        outcome: "completed",
        summary: "Primary route blocked; alternate route required.",
      };
    };
    (chrome.tabs as any).sendMessage = vi.fn(async () => ({
      payload: {
        snapshot: {
          title: "Elements Filters | ServiceNow",
          url: "https://workarenapublic16.service-now.com/now/nav/ui/classic/params/target/pa_filters_list.do",
          visibleContent:
            "Performance Analytics Elements Filters list with Title, Breakdown source, and Filter columns.",
          pageContent:
            "Performance Analytics Breakdowns Elements Filters list with Title, Breakdown source, and Filter columns.",
          elements: [],
          viewport: { width: 1200, height: 800 },
          scroll: { x: 0, y: 0, maxY: 0 },
        },
      },
    }));

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(
      makeInput(
        'Navigate to the "Breakdowns > Elements Filters" module of the "Performance Analytics" application.',
      ),
    );

    expect(createdLoopNodeIds).toEqual(expect.arrayContaining(["n1", "n2"]));
    expect(gracefulStopLoopNodeIds).toContain("n2");
    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion?.payload?.status).toBe("completed");
    expect(completion?.payload?.subtaskResults?.[1]?.status).toBe("skipped");
    expect(completion?.payload?.subtaskResults?.[1]?.result).toContain(
      "Skipped: navigation goal already achieved",
    );
    expect(
      completion?.payload?.subtaskResults?.some((item: any) =>
        String(item.result || "").includes("Late verifier reroute"),
      ),
    ).toBe(false);
    const runTraceEvents = (globalThis as any).__runTraceEvents as Array<{
      url: string;
      body: { type?: string; data?: Record<string, unknown> };
    }>;
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.body.type === "worker_result_ignored" &&
          entry.body.data?.nodeId === "n2" &&
          entry.body.data?.currentStatus === "skipped" &&
          entry.body.data?.executorOutcome === "completed" &&
          entry.body.data?.verifierDecision === "reroute" &&
          entry.body.data?.reason === "node_already_terminal",
      ),
    ).toBe(true);
  });

  test("does not skip navigation steps when the target is only visible in a menu", async () => {
    const first = makeNode(
      "n1",
      "Search for and open the Performance Analytics application in the navigator",
    );
    first.successCriteria =
      "Performance Analytics application is expanded or selected, showing its modules.";
    const second = makeNode(
      "n2",
      "Click Elements Filters under Breakdowns",
      ["n1"],
    );
    second.successCriteria = "Elements Filters page is open.";
    plannerBuildNodesImpl = async () => [first, second];
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });
    loopStartImpl = async (nodeId) => ({
      outcome: "completed",
      summary:
        nodeId === "n1"
          ? "Performance Analytics is expanded in the navigator and shows Breakdowns with Elements Filters."
          : 'Successfully navigated to the "Breakdowns > Elements Filters" module.',
    });
    (chrome.tabs as any).sendMessage = vi.fn(async () => ({
      payload: {
        snapshot: {
          title: "Shared admin dashboard | ServiceNow",
          url: "https://workarenapublic16.service-now.com/now/nav/ui/home",
          visibleContent:
            "Performance Analytics Breakdowns Elements Filters menu item is visible.",
          pageContent:
            "Performance Analytics Breakdowns Elements Filters menu item is visible.",
          elements: [],
          viewport: { width: 1200, height: 800 },
          scroll: { x: 0, y: 0, maxY: 0 },
        },
      },
    }));

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(
      makeInput(
        'Navigate to the "Breakdowns > Elements Filters" module of the "Performance Analytics" application.',
      ),
    );

    expect(createdLoopNodeIds).toEqual(["n1", "n2"]);
    const runTraceEvents = (globalThis as any).__runTraceEvents as Array<{
      url: string;
      body: { type?: string; data?: Record<string, unknown> };
    }>;
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.url.endsWith("/run-traces") &&
          entry.body.type === "navigation_goal_gate",
      ),
    ).toBe(false);
  });

  test("does not use global-goal shortcut for pending confirm/clicking mutation steps", async () => {
    const first = makeNode(
      "n1",
      "Search for and select Ezekiel Mildon from the impersonation dialog",
    );
    first.successCriteria =
      "Ezekiel Mildon is selected in the impersonation dialog.";
    const second = makeNode(
      "n2",
      "Confirm impersonation by clicking the Impersonate user button",
    );
    second.successCriteria =
      "Ezekiel Mildon is selected and the Impersonate user button is ready.";
    plannerBuildNodesImpl = async () => [first, second];
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });
    (chrome.tabs as any).sendMessage = vi.fn(async () => ({
      payload: {
        snapshot: {
          title: "Shared admin dashboard | ServiceNow",
          url: "https://workarenapublic18.service-now.com/now/nav/ui/home",
          visibleContent:
            "Ezekiel Mildon is selected. The Impersonate user button is enabled and ready.",
          pageContent:
            "Ezekiel Mildon is selected. The Impersonate user button is enabled and ready.",
          elements: [],
          viewport: { width: 1200, height: 800 },
          scroll: { x: 0, y: 0, maxY: 0 },
        },
      },
    }));

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("Impersonate the user Ezekiel Mildon."));

    expect(createdLoopNodeIds).toEqual(["n1", "n2"]);
    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion).toBeDefined();
    expect(
      completion?.payload?.subtaskResults?.some(
        (item: any) =>
          String(item.result || "").includes("Skipped: global goal already achieved"),
      ),
    ).toBe(false);
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
    const runTraceEvents = (globalThis as any).__runTraceEvents as Array<{
      url: string;
      body: { type?: string; data?: Record<string, unknown> };
    }>;
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.url.endsWith("/run-traces") &&
          entry.body.type === "node_failure_attribution" &&
          entry.body.data?.reason === "unsatisfiable_dependencies" &&
          entry.body.data?.nodeId === "n1",
      ),
    ).toBe(true);
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
        totalPromptTokens: 1_090_000,
        totalCompletionTokens: 10_000,
        totalTokens: 1_100_000,
        totalCost: 0.4,
        totalLlmTimeMs: 1000,
        totalSessionTimeMs: 3000,
        llmCallCount: 3,
        totalCachedTokens: 200,
        modelBreakdown: {
          "test/model": {
            promptTokens: 1_090_000,
            completionTokens: 10_000,
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
    expect(completion?.payload?.metrics?.totalTokens).toBe(1100000);
  });

  test("expands token budget for large exhaustive review graphs", async () => {
    plannerBuildNodesImpl = async () =>
      Array.from({ length: 8 }, (_, i) => ({
        ...makeNode(
          `r${i + 1}`,
          `review listing ${i + 1}`,
          i > 0 ? [`r${i}`] : [],
        ),
        selectedSkillId: "list-detail-review-loop" as const,
      }));
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });
    loopStartImpl = async (nodeId) => ({
      outcome: "completed",
      summary: `completed ${nodeId || "unknown"}`,
      metrics: {
        totalPromptTokens: nodeId === "r1" ? 1_090_000 : 1_000,
        totalCompletionTokens: nodeId === "r1" ? 10_000 : 100,
        totalTokens: nodeId === "r1" ? 1_100_000 : 1_100,
        totalCost: nodeId === "r1" ? 0.4 : 0.001,
        totalLlmTimeMs: 1000,
        totalSessionTimeMs: 3000,
        llmCallCount: 1,
        totalCachedTokens: 0,
        modelBreakdown: {},
      },
    });

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("review all job listings"));

    expect(createdLoopNodeIds).toContain("r2");
    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion?.payload?.terminationReason || "").not.toContain(
      "Global token budget exceeded",
    );
  });

  test("does not globally skip a final node that already failed once", async () => {
    const setup = makeNode("n1", "Collect checkout details");
    const final = makeNode("n2", "Verify final confirmation", ["n1"]);
    final.successCriteria = "Order confirmation and thank you message visible";
    plannerBuildNodesImpl = async () => [setup, final];

    const attempts: Record<string, number> = {};
    (chrome.tabs as any).sendMessage = vi.fn(async () => ({
      payload: {
        snapshot: {
          title: attempts.n2 ? "Order Confirmed" : "Checkout",
          url: "https://example.com/shop",
          visibleContent: attempts.n2
            ? "Order confirmation. Thank you for your purchase."
            : "Checkout form",
          pageContent: attempts.n2
            ? "Order confirmation. Thank you for your purchase."
            : "Checkout form",
          elements: [],
          viewport: { width: 1200, height: 800 },
          scroll: { x: 0, y: 0, maxY: 0 },
        },
      },
    }));

    loopStartImpl = async (nodeId) => {
      const key = nodeId || "unknown";
      attempts[key] = (attempts[key] || 0) + 1;
      if (nodeId === "n2" && attempts[key] === 1) {
        return {
          outcome: "failed",
          summary: "Reached turn limit before confirming completion.",
          metrics: undefined,
        };
      }
      return {
        outcome: "completed",
        summary:
          nodeId === "n2"
            ? "Confirmed order confirmation and thank you message."
            : "Collected checkout details.",
        metrics: undefined,
      };
    };
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("verify final confirmation"));

    expect(attempts.n2).toBe(2);
  });

  test("preflight warns on excess nodes without failing them upfront", async () => {
    plannerBuildNodesImpl = async () =>
      Array.from({ length: 10 }, (_, i) => makeNode(`p${i + 1}`, `plan step ${i + 1}`));
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("preflight budget fit task"));

    expect(createdLoopNodeIds).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
      "p7",
      "p8",
      "p9",
      "p10",
    ]);
    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion).toBeDefined();
    expect(
      messages.some(
        (m) =>
          m.type === "AGENT_STEP" &&
          String(m.payload?.step?.label || "").includes("Planner preflight budget gate"),
      ),
    ).toBe(true);
    expect(completion?.payload?.status).toBe("completed");
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

  test("planner failure falls back to a synthesized executor objective", async () => {
    plannerBuildNodesImpl = async () => {
      throw new Error("planner upstream unavailable");
    };

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    const query =
      "Please find the Warehouse Beta inventory count and tell me the exact number.";

    await orchestrator.startTask(makeInput(query));

    expect(capturedInstructions).toHaveLength(1);
    expect(capturedInstructions[0].instruction).toContain(`Objective: ${query}`);
    expect(capturedInstructions[0].instruction).toContain(
      "Success criteria: Page or tool output shows Warehouse Beta",
    );
  });

  test("planner-lane failure fallback collapses a ServiceNow field-value form into one submit-requiring node", async () => {
    // End-to-end deterministic proof of the create-incident fix: when the
    // planner lane times out (buildNodes throws), the orchestrator falls back to
    // buildFallbackNodes. That fallback must (a) receive the current page
    // context so it selects servicenow-record-form on a ServiceNow page, and
    // (b) collapse the synthesized "fill (do not submit yet)" + "submit" plan
    // into a single submit-requiring node. Without the fix the executor gets a
    // "do not submit the form yet" objective and strands without submitting.
    plannerBuildNodesImpl = async () => {
      throw new Error("planner lane timeout (20000ms)");
    };
    (chrome.tabs as any).get = vi.fn(async (tabId: number) => ({
      id: tabId,
      title: "Create INC0000031 | Incident | ServiceNow",
      url: "https://workarenapublic20.service-now.com/now/nav/ui/classic/params/target/incident.do",
    }));

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    const query =
      'Create a new incident with a value of "EMAIL Server Down Again" for field "Short description", a value of "Joe Employee" for field "Caller", and a value of "Phone" for field "Channel".';

    await orchestrator.startTask(makeInput(query));

    // Single collapsed node reached the executor — not a stranded fill node.
    expect(capturedInstructions).toHaveLength(1);
    const instruction = capturedInstructions[0].instruction;
    // The stranding clause is gone and submission is required.
    expect(instruction).not.toContain("Do not submit the form yet");
    expect(instruction).not.toContain(
      "the final submit action has not been clicked yet",
    );
    expect(instruction).toContain(
      "Complete the workflow for the original request",
    );
    // Page context threaded → ServiceNow record-form skill selected.
    expect(createdLoopConfigs[0]?.selectedSkillId).toBe(
      "servicenow-record-form",
    );
  });

  test("accepts deterministic completion envelopes without verifier split-brain", async () => {
    plannerBuildNodesImpl = async () => [
      makeNode("n1", "select the correct quiz options"),
    ];
    loopStartImpl = async () => ({
      outcome: "completed",
      summary: "Selected the correct options.",
      completionEnvelope: {
        status: "completed",
        resultId: "completion-node-1",
        source: "model_done",
        contractKind: "quiz_selection",
        decisionReason: "selected options match expected answers",
        evidenceKeys: ["quiz:question:32:selected:domain-adaptation"],
        evidenceEpoch: "turn:2",
      },
    });
    verifierDecisionImpl = async () => {
      throw new Error("verifier should not run for deterministic envelopes");
    };

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("Select the correct option on each quiz page"));

    expect(verifierDecisionCalls).toBe(0);
    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion?.payload?.status).toBe("completed");
    expect(completion?.payload?.summary).toContain(
      "Selected the correct options.",
    );
    const runTraceEvents = (globalThis as any).__runTraceEvents as Array<{
      url: string;
      body: { type?: string; data?: Record<string, unknown> };
    }>;
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.url.endsWith("/run-traces") &&
          entry.body.type === "completion_envelope_verification" &&
          entry.body.data?.nodeId === "n1" &&
          entry.body.data?.decision === "accept" &&
          entry.body.data?.contractKind === "quiz_selection",
      ),
    ).toBe(true);
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.body.type === "completion_scope_transition" &&
          entry.body.data?.scope === "lane" &&
          entry.body.data?.status === "completed" &&
          entry.body.data?.nodeId === "n1" &&
          entry.body.data?.resultId === "completion-node-1",
      ),
    ).toBe(true);
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.body.type === "completion_scope_transition" &&
          entry.body.data?.scope === "node" &&
          entry.body.data?.status === "completed" &&
          entry.body.data?.nodeId === "n1" &&
          entry.body.data?.resultId === "completion-node-1",
      ),
    ).toBe(true);
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.body.type === "completion_scope_transition" &&
          entry.body.data?.scope === "root" &&
          entry.body.data?.status === "completed",
      ),
    ).toBe(true);
  });

  test("reroutes malformed deterministic completion envelopes instead of retrying a completed lane", async () => {
    plannerBuildNodesImpl = async () => [
      makeNode("n1", "select the correct quiz options"),
    ];
    loopStartImpl = async (nodeId) => {
      if (nodeId === "n1") {
        return {
          outcome: "completed",
          summary: "Selected the correct options.",
          completionEnvelope: {
            status: "completed",
            resultId: "completion-node-1",
            source: "model_done",
            contractKind: "quiz_selection",
            decisionReason: "selected options match expected answers",
            evidenceKeys: [],
            evidenceEpoch: "turn:2",
          },
        };
      }
      return {
        outcome: "completed",
        summary: "Re-verified the selected options with explicit evidence.",
        completionEnvelope: {
          status: "completed",
          resultId: "completion-repair-1",
          source: "model_done",
          contractKind: "quiz_selection",
          decisionReason: "selected options match expected answers after repair",
          evidenceKeys: ["quiz:question:32:selected:domain-adaptation"],
          evidenceEpoch: "turn:3",
        },
      };
    };
    verifierDecisionImpl = async () => {
      throw new Error("verifier should not run for deterministic envelopes");
    };

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("Select the correct option on each quiz page"));

    expect(verifierDecisionCalls).toBe(0);
    expect(createdLoopNodeIds).toHaveLength(2);
    expect(createdLoopNodeIds[0]).toBe("n1");
    expect(createdLoopNodeIds[1]).not.toBe("n1");
    expect(capturedInstructions[1].instruction).toContain(
      "Verify and repair the completion for: select the correct quiz options.",
    );

    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion?.payload?.status).toBe("completed");

    const runTraceEvents = (globalThis as any).__runTraceEvents as Array<{
      url: string;
      body: { type?: string; data?: Record<string, unknown> };
    }>;
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.body.type === "completion_envelope_verification" &&
          entry.body.data?.nodeId === "n1" &&
          entry.body.data?.decision === "reroute" &&
          entry.body.data?.failureType === "insufficient_evidence" &&
          entry.body.data?.rerouteObjective ===
            "Verify and repair the completion for: select the correct quiz options. The previous executor lane reported completion through a deterministic envelope, but the envelope lacked required evidence. Re-check the current page state, complete only missing verification or repair actions, then call done with explicit evidence.",
      ),
    ).toBe(true);
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.body.type === "node_verified" &&
          entry.body.data?.nodeId === "n1" &&
          entry.body.data?.decision === "reroute" &&
          entry.body.data?.failureType === "insufficient_evidence",
      ),
    ).toBe(true);
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.body.type === "completion_scope_transition" &&
          entry.body.data?.scope === "node" &&
          entry.body.data?.status === "completed" &&
          entry.body.data?.nodeId === "n1" &&
          entry.body.data?.resultId === "completion-node-1",
      ),
    ).toBe(false);
  });

  test("restores a compatible turn checkpoint only on the first recovered launch", async () => {
    plannerBuildNodesImpl = async () => [makeNode("n1", "recoverable step")];

    let loopAttempt = 0;
    loopStartImpl = async () => {
      loopAttempt += 1;
      if (loopAttempt === 1) {
        return { outcome: "failed", summary: "needs retry", metrics: undefined };
      }
      return { outcome: "completed", summary: "recovered", metrics: undefined };
    };
    verifierDecisionImpl = async () =>
      loopAttempt === 1
        ? { decision: "retry", reason: "retry once" }
        : { decision: "accept", reason: "ok" };

    const checkpointStore = (globalThis as any).__checkpointStore as Record<
      string,
      unknown
    >;
    const localStore = (globalThis as any).__localStore as Record<string, unknown>;

    checkpointStore["ws-1"] = makeRecoveryTaskCheckpoint("task-recover-1");
    localStore["opensidebar:turn-checkpoint:ws-1:n1"] = makeTurnCheckpoint();

    createdLoopNodeIds.length = 0;
    createdLoopConfigs.length = 0;
    capturedInstructions.length = 0;

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.restoreFromCheckpoints();
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(createdLoopNodeIds).toEqual(["n1", "n1"]);
    expect(createdLoopConfigs[0]?.turnCheckpoint).not.toBeNull();
    expect(createdLoopConfigs[0]?.turnCheckpoint?.turnCount).toBe(3);
    expect(createdLoopConfigs[1]?.turnCheckpoint ?? null).toBeNull();
  });

  test("discards an incompatible recovered turn checkpoint", async () => {
    plannerBuildNodesImpl = async () => [makeNode("n1", "recoverable step")];
    loopStartImpl = async () => ({
      outcome: "completed",
      summary: "fresh start",
      metrics: undefined,
    });
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });

    const checkpointStore = (globalThis as any).__checkpointStore as Record<
      string,
      unknown
    >;
    const localStore = (globalThis as any).__localStore as Record<string, unknown>;

    checkpointStore["ws-1"] = makeRecoveryTaskCheckpoint("task-recover-2");
    localStore["opensidebar:turn-checkpoint:ws-1:n1"] = makeTurnCheckpoint({
      pageUrl: "https://example.com/other-page",
      snapshotFingerprint: "https://example.com/other-page|0|123",
    });

    createdLoopNodeIds.length = 0;
    createdLoopConfigs.length = 0;

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.restoreFromCheckpoints();
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(createdLoopNodeIds).toEqual(["n1"]);
    expect(createdLoopConfigs[0]?.turnCheckpoint ?? null).toBeNull();
  });

  test("emits checkpoint restore and discard run-trace events during recovery", async () => {
    const checkpointStore = (globalThis as any).__checkpointStore as Record<
      string,
      unknown
    >;
    const localStore = (globalThis as any).__localStore as Record<string, unknown>;
    const runTraceEvents = (globalThis as any).__runTraceEvents as Array<{
      url: string;
      body: { type?: string; data?: Record<string, unknown> };
    }>;

    checkpointStore["ws-1"] = makeRecoveryTaskCheckpoint("task-recover-3");
    localStore["opensidebar:turn-checkpoint:ws-1:n1"] = makeTurnCheckpoint();

    loopStartImpl = async () => ({
      outcome: "completed",
      summary: "used restored checkpoint",
    });

    let orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.restoreFromCheckpoints();
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(
      runTraceEvents.some(
        (entry) =>
          entry.url.endsWith("/run-traces") &&
          entry.body.type === "checkpoint_turn_restored" &&
          entry.body.data?.nodeId === "n1",
      ),
    ).toBe(true);

    runTraceEvents.length = 0;
    checkpointStore["ws-1"] = makeRecoveryTaskCheckpoint("task-recover-4");
    localStore["opensidebar:turn-checkpoint:ws-1:n1"] = makeTurnCheckpoint({
      pageUrl: "https://example.com/other-page",
      snapshotFingerprint: "https://example.com/other-page|0|123",
    });
    createdLoopNodeIds.length = 0;
    createdLoopConfigs.length = 0;

    orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.restoreFromCheckpoints();
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(
      runTraceEvents.some(
        (entry) =>
          entry.url.endsWith("/run-traces") &&
          entry.body.type === "checkpoint_turn_discarded" &&
          entry.body.data?.nodeId === "n1" &&
          entry.body.data?.reason === "snapshot_mismatch",
      ),
    ).toBe(true);
  });

  test("pauses on approval request and resumes with the resolved approval", async () => {
    let launchCount = 0;
    loopStartImpl = async () => {
      launchCount += 1;
      if (launchCount === 1) {
        return {
          outcome: "awaiting_approval",
          summary: "Awaiting approval",
          pendingInteraction: {
            kind: "approval",
            nodeId: "n1",
            requestedAt: Date.now(),
            approvalId: "approval-1",
            toolName: ToolName.CLICK_ELEMENT,
            args: { id: 4 },
            context: "Click [4]",
            timeoutMs: 60_000,
          },
        };
      }
      return {
        outcome: "completed",
        summary: "clicked after approval",
      };
    };

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("needs approval"));

    expect(createdLoopNodeIds).toEqual(["n1"]);
    expect(
      orchestrator.resolveApprovalResponse(
        { approvalId: "approval-1", approved: true },
        "ws-1",
      ),
    ).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(createdLoopNodeIds).toEqual(["n1", "n1"]);
    expect(createdLoopConfigs[1]?.resumeInteraction?.kind).toBe("approval");
    expect(createdLoopConfigs[1]?.resumeInteraction?.approved).toBe(true);
    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion?.payload?.status).toBe("completed");
    expect(completion?.payload?.summary).toContain("clicked after approval");
  });

  test("restores a pending clarification request and resumes only after the answer arrives", async () => {
    const checkpointStore = (globalThis as any).__checkpointStore as Record<
      string,
      unknown
    >;
    const localStore = (globalThis as any).__localStore as Record<
      string,
      unknown
    >;
    checkpointStore["ws-1"] = makeRecoveryTaskCheckpoint(
      "task-recover-clarify",
      {
        pendingInteraction: {
          kind: "clarification",
          nodeId: "n1",
          requestedAt: Date.now(),
          clarificationId: "clarify-1",
          question: "Which account should I use?",
          suggestions: ["Account A", "Account B"],
          timeoutMs: 120_000,
        },
      },
    );
    localStore["opensidebar:turn-checkpoint:ws-1:n1"] = makeTurnCheckpoint();

    loopStartImpl = async () => ({
      outcome: "completed",
      summary: "resumed after clarification",
    });

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.restoreFromCheckpoints();
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(createdLoopNodeIds).toEqual([]);
    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    expect(messages.some((m) => m.type === "CLARIFICATION_REQUEST")).toBe(true);

    expect(
      orchestrator.resolveClarificationResponse(
        { clarificationId: "clarify-1", answer: "Account B" },
        "ws-1",
      ),
    ).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(createdLoopNodeIds).toEqual(["n1"]);
    expect(createdLoopConfigs[0]?.resumeInteraction?.kind).toBe(
      "clarification",
    );
    expect(createdLoopConfigs[0]?.resumeInteraction?.answer).toBe("Account B");
  });

  test("emits pending interaction restore and timeout run-trace events", async () => {
    const checkpointStore = (globalThis as any).__checkpointStore as Record<
      string,
      unknown
    >;
    const runTraceEvents = (globalThis as any).__runTraceEvents as Array<{
      url: string;
      body: { type?: string; data?: Record<string, unknown> };
    }>;

    checkpointStore["ws-1"] = makeRecoveryTaskCheckpoint("task-recover-approval", {
      pendingInteraction: {
        kind: "approval",
        nodeId: "n1",
        requestedAt: Date.now(),
        approvalId: "approval-restore-1",
        toolName: ToolName.CLICK_ELEMENT,
        args: { id: 4 },
        context: "Click [4]",
        timeoutMs: 60_000,
      },
    });

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.restoreFromCheckpoints();
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(
      runTraceEvents.some(
        (entry) =>
          entry.url.endsWith("/run-traces") &&
          entry.body.type === "pending_interaction_restored" &&
          entry.body.data?.kind === "approval" &&
          entry.body.data?.interactionId === "approval-restore-1",
      ),
    ).toBe(true);

    runTraceEvents.length = 0;
    checkpointStore["ws-1"] = makeRecoveryTaskCheckpoint("task-recover-timeout", {
      pendingInteraction: {
        kind: "clarification",
        nodeId: "n1",
        requestedAt: Date.now() - 100,
        clarificationId: "clarify-timeout-1",
        question: "Which account should I use?",
        suggestions: ["Account A", "Account B"],
        timeoutMs: 10,
      },
    });

    activeOrchestrator = new Orchestrator(orchestratorDeps);
    await activeOrchestrator.restoreFromCheckpoints();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(
      runTraceEvents.some(
        (entry) =>
          entry.url.endsWith("/run-traces") &&
          entry.body.type === "pending_interaction_timed_out" &&
          entry.body.data?.kind === "clarification" &&
          entry.body.data?.interactionId === "clarify-timeout-1",
      ),
    ).toBe(true);
  });

  test("includes recent side effects in failed task completion summaries", async () => {
    loopStartImpl = async () => ({
      outcome: "error",
      summary: "executor failed",
      sideEffectsLog: [
        {
          id: "fx-1",
          turn: 2,
          planIndex: 0,
          toolName: ToolName.CREATE_TAB,
          args: { url: "https://example.com/details" },
          result: "Opened a new tab for details.",
          timestamp: Date.now(),
          snapshotFingerprint: "snap-1",
        },
      ],
    });

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("fail after mutation"));

    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion?.payload?.status).toBe("failed");
    expect(String(completion?.payload?.summary || "")).toContain(
      "Recent side effects",
    );
    expect(
      String(completion?.payload?.subtaskResults?.[0]?.result || ""),
    ).toContain("create_tab");
  });

  test("stops timed-out executor worker to prevent lane contamination", async () => {
    plannerBuildNodesImpl = async () => [makeNode("n1", "timeout cleanup node")];
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });
    loopStartImpl = async () =>
      await new Promise<{ outcome: "completed" | "failed"; summary: string }>(
        () => {
          // Intentionally never resolve to force executor lane timeout.
        },
      );
    orchestratorDeps.lanePolicies = {
      executor: {
        maxCallMs: 30,
        maxFailuresBeforeIsolation: 1,
        isolationCooldownMs: 60_000,
      },
    };

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    const runPromise = orchestrator.startTask(makeInput("executor timeout cleanup"));

    await new Promise((resolve) => setTimeout(resolve, 1_100));

    const laneState = (orchestrator as any).getLaneRuntimeState("ws-1", "executor");
    expect(laneState.isolatedUntilMs).toBeGreaterThan(Date.now());

    const workersByWorkspace = (orchestrator as any).workersByWorkspace as Map<
      string,
      { executor?: Map<string, unknown> }
    >;
    expect(workersByWorkspace.get("ws-1")?.executor?.size ?? 0).toBe(0);

    const tasksByWorkspace = (orchestrator as any).tasksByWorkspace as Map<
      string,
      { nodes: Array<{ id: string; status: string; retries: number }> }
    >;
    const task = tasksByWorkspace.get("ws-1");
    const node = task?.nodes.find((item) => item.id === "n1");
    expect(node?.status).toBe("pending");
    expect(node?.retries).toBe(1);

    await orchestrator.stopTask("ws-1");
    await runPromise;
  });

  test("accepts terminal completion when executor timeout follows done", async () => {
    plannerBuildNodesImpl = async () => [makeNode("n1", "timeout after done")];
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });
    loopStartImpl = async (nodeId) => {
      if (nodeId) {
        mockLoopCompletedResults.set(nodeId, {
          summary: "Done before executor timeout.",
          completionEnvelope: {
            status: "completed",
            resultId: "result-timeout-after-done",
            source: "model_done",
            contractKind: "workflow_confirmation",
            decisionReason: "done accepted before timeout",
            evidenceKeys: ["confirmation:done"],
            evidenceEpoch: "1:page",
          },
        });
      }
      return await new Promise<{ outcome: "completed"; summary: string }>(
        () => {
          // Intentionally never resolve to force executor lane timeout.
        },
      );
    };
    orchestratorDeps.lanePolicies = {
      executor: {
        maxCallMs: 30,
        maxFailuresBeforeIsolation: 99,
        isolationCooldownMs: 60_000,
      },
    };

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("timeout after done"));

    expect(verifierDecisionCalls).toBe(0);

    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion?.payload?.status).toBe("completed");
    expect(completion?.payload?.summary).toContain(
      "Done before executor timeout",
    );

    const runTraceEvents = (globalThis as any).__runTraceEvents as Array<{
      url: string;
      body: { type?: string; data?: Record<string, unknown> };
    }>;
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.body.type === "completion_scope_transition" &&
          entry.body.data?.scope === "lane" &&
          entry.body.data?.reason ===
            "executor_timeout_after_terminal_completion",
      ),
    ).toBe(true);
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.body.type === "completion_scope_transition" &&
          entry.body.data?.scope === "node" &&
          entry.body.data?.reason ===
            "accepted_terminal_completion_after_executor_timeout",
      ),
    ).toBe(true);
  });

  test("keeps user stop terminal when timeout sees completed result", async () => {
    plannerBuildNodesImpl = async () => [
      makeNode("n1", "timeout completed result during stop"),
    ];
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });
    loopStartImpl = async (nodeId) => {
      if (nodeId) {
        mockLoopCompletedResults.set(nodeId, {
          summary: "Done before stop-drain timeout.",
          completionEnvelope: {
            status: "completed",
            resultId: "result-timeout-during-stop",
            source: "model_done",
            contractKind: "workflow_confirmation",
            decisionReason: "done accepted before stop timeout",
            evidenceKeys: ["confirmation:done"],
            evidenceEpoch: "1:page",
          },
        });
      }
      return await new Promise<{ outcome: "completed"; summary: string }>(
        () => {
          // Intentionally never resolve to force executor lane timeout.
        },
      );
    };
    orchestratorDeps.lanePolicies = {
      executor: {
        maxCallMs: 40,
        maxFailuresBeforeIsolation: 99,
        isolationCooldownMs: 60_000,
      },
    };

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    const runPromise = orchestrator.startTask(makeInput("timeout stop race"));

    await vi.waitFor(() => {
      expect(createdLoopNodeIds).toContain("n1");
    });

    await orchestrator.stopTask("ws-1");
    await runPromise;

    expect(gracefulStopLoopNodeIds).toContain("n1");
    expect(verifierDecisionCalls).toBe(0);

    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion?.payload?.status).toBe("stopped");
    expect(completion?.payload?.subtaskResults?.[0]?.status).toBe("stopped");
    expect(completion?.payload?.subtaskResults?.[0]?.result).toContain(
      "Stopped by user",
    );
    expect(completion?.payload?.subtaskResults?.[0]?.result).not.toContain(
      "Done before stop-drain timeout",
    );

    const runTraceEvents = (globalThis as any).__runTraceEvents as Array<{
      url: string;
      body: { type?: string; data?: Record<string, unknown> };
    }>;
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.body.type === "worker_result_ignored" &&
          entry.body.data?.nodeId === "n1" &&
          entry.body.data?.executorOutcome === "timeout" &&
          entry.body.data?.reason === "task_stop_requested" &&
          entry.body.data?.hadCompletedResult === true,
      ),
    ).toBe(true);
  });

  test("reopens the durable root URL when a retry tab degrades to about:blank", async () => {
    plannerBuildNodesImpl = async () => [makeNode("n1", "recover after blank tab")];
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });

    let rootTabBlank = false;
    let loopAttempts = 0;
    (chrome.tabs as any).get = vi.fn(async (tabId: number) => {
      if (tabId === 101) {
        return {
          id: 101,
          url: rootTabBlank ? "about:blank" : "https://example.com/catalog",
          title: rootTabBlank ? "Blank Page" : "Catalog Page",
          groupId: 1,
        } as chrome.tabs.Tab;
      }
      if (tabId === 202) {
        return {
          id: 202,
          url: "https://example.com/catalog",
          title: "Catalog Page",
          groupId: 1,
        } as chrome.tabs.Tab;
      }
      throw new Error(`Unknown tab ${tabId}`);
    });
    (chrome.tabs as any).create = vi.fn(async ({ url }: { url: string }) => ({
      id: 202,
      url,
      title: "Catalog Page",
      groupId: 1,
    }));

    loopStartImpl = async () => {
      loopAttempts += 1;
      if (loopAttempts === 1) {
        rootTabBlank = true;
        return await new Promise<{
          outcome: "completed" | "failed";
          summary: string;
        }>(() => {
          // Intentionally never resolve to force an executor timeout.
        });
      }
      return {
        outcome: "completed",
        summary: "completed after re-grounding on durable root URL",
        metrics: undefined,
      };
    };
    orchestratorDeps.lanePolicies = {
      executor: {
        maxCallMs: 30,
        maxFailuresBeforeIsolation: 99,
        isolationCooldownMs: 60_000,
      },
    };

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("recover retry after blank tab"));

    expect(loopAttempts).toBe(2);
    expect((chrome.tabs as any).create).toHaveBeenCalledWith({
      url: "https://example.com/catalog",
      active: false,
    });

    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.findLast((m) => m.type === "TASK_COMPLETION");
    expect(completion?.payload?.status).toBe("completed");
    expect(String(completion?.payload?.summary || "")).toContain(
      "completed after re-grounding",
    );
  });

  test("drains active executor workers before finalizing a stop request", async () => {
    plannerBuildNodesImpl = async () => [makeNode("n1", "graceful stop node")];
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });

    let releaseWorker: (() => void) | null = null;
    loopStartImpl = async (nodeId) =>
      await new Promise((resolve) => {
        const poll = () => {
          if (nodeId && gracefulStopLoopNodeIds.includes(nodeId)) {
            resolve({
              outcome: "stopped",
              summary: "Stopped by user",
              metrics: undefined,
            });
            return;
          }
          releaseWorker = poll;
          setTimeout(poll, 5);
        };
        poll();
      });

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    const runPromise = orchestrator.startTask(makeInput("graceful stop"));

    await vi.waitFor(() => {
      expect(createdLoopNodeIds).toContain("n1");
    });

    await orchestrator.stopTask("ws-1");

    expect(gracefulStopLoopNodeIds).toContain("n1");
    expect(stoppedLoopNodeIds).not.toContain("n1");

    const tasksByWorkspace = (orchestrator as any).tasksByWorkspace as Map<
      string,
      { status: string }
    >;
    expect(tasksByWorkspace.get("ws-1")?.status).toBe("stopping");

    releaseWorker?.();
    await runPromise;

    expect(tasksByWorkspace.has("ws-1")).toBe(false);

    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion?.payload?.status).toBe("stopped");
    expect(completion?.payload?.summary).toContain("Stopped by user");
    expect(completion?.payload?.subtaskResults?.[0]?.status).toBe("stopped");
  });

  test("gives user stop precedence over a worker completion result", async () => {
    plannerBuildNodesImpl = async () => [
      makeNode("n1", "completion racing with stop"),
    ];
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });

    loopStartImpl = async (nodeId) =>
      await new Promise((resolve) => {
        const poll = () => {
          if (nodeId && gracefulStopLoopNodeIds.includes(nodeId)) {
            resolve({
              outcome: "completed",
              summary: "Completed after stop request.",
              metrics: undefined,
            });
            return;
          }
          setTimeout(poll, 5);
        };
        poll();
      });

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    const runPromise = orchestrator.startTask(makeInput("stop race"));

    await vi.waitFor(() => {
      expect(createdLoopNodeIds).toContain("n1");
    });

    await orchestrator.stopTask("ws-1");
    await runPromise;

    expect(gracefulStopLoopNodeIds).toContain("n1");
    expect(stoppedLoopNodeIds).not.toContain("n1");
    expect(verifierDecisionCalls).toBe(0);

    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion?.payload?.status).toBe("stopped");
    expect(completion?.payload?.subtaskResults?.[0]?.status).toBe("stopped");
    expect(completion?.payload?.subtaskResults?.[0]?.result).toContain(
      "Stopped by user",
    );
    expect(completion?.payload?.subtaskResults?.[0]?.result).not.toContain(
      "Completed after stop request",
    );

    const runTraceEvents = (globalThis as any).__runTraceEvents as Array<{
      url: string;
      body: { type?: string; data?: Record<string, unknown> };
    }>;
    expect(
      runTraceEvents.some(
        (entry) =>
          entry.body.type === "worker_result_ignored" &&
          entry.body.data?.nodeId === "n1" &&
          entry.body.data?.currentStatus === "running" &&
          entry.body.data?.executorOutcome === "completed" &&
          entry.body.data?.reason === "task_stop_requested",
      ),
    ).toBe(true);
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

  test("retries executor work after transient lane isolation instead of failing runnable nodes", async () => {
    plannerBuildNodesImpl = async () => [
      makeNode("n1", "executor isolate one"),
      makeNode("n2", "executor isolate two"),
    ];
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok" });
    let firstAttempt = true;
    loopStartImpl = async (nodeId) => {
      if (firstAttempt) {
        firstAttempt = false;
        throw new Error("executor transport unavailable");
      }
      return {
        outcome: "completed",
        summary: `completed ${nodeId || "unknown"}`,
        metrics: undefined,
      };
    };
    orchestratorDeps.lanePolicies = {
      executor: { maxFailuresBeforeIsolation: 1, isolationCooldownMs: 10, maxConcurrent: 1 },
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
    expect(completion?.payload?.status).toBe("completed");
    const subtaskResults = completion?.payload?.subtaskResults || [];
    expect(subtaskResults.length).toBeGreaterThan(0);
    expect(
      subtaskResults.every((item: any) => item.status === "completed"),
    ).toBe(true);
    expect(
      subtaskResults.some((item: any) =>
        String(item.result || "").includes("completed n1"),
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
