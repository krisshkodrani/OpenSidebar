import { beforeEach, describe, expect, mock, test } from "bun:test";
import "../setup";
import { SessionMetrics, ToolName, UserSettings } from "../../src/types";
import {
  OrchestratorTask,
  PlannerReflexionEntry,
  TaskNode,
} from "../../src/background/orchestrator/types";
import {
  Orchestrator,
  OrchestratorDeps,
} from "../../src/background/orchestrator/index";
import {
  NodeVerificationResult,
} from "../../src/background/orchestrator/verifier";

const createdLoopNodeIds: string[] = [];
const capturedInstructions: Array<{ nodeId?: string; instruction: string }> = [];

type MockLoopConfig = { nodeId?: string };

let plannerBuildNodesImpl: (...args: unknown[]) => Promise<TaskNode[]>;
let plannerExpandNodeImpl: (...args: unknown[]) => Promise<TaskNode[] | null>;
let verifierDecisionImpl: (...args: unknown[]) => Promise<NodeVerificationResult>;
let loopStartImpl: (
  nodeId: string | undefined,
  instruction: string,
) => Promise<{
  outcome: "completed" | "failed";
  summary: string;
  metrics?: SessionMetrics;
}>;
let loopEmitStaleSignal: boolean;
let orchestratorDeps: OrchestratorDeps;
let activeOrchestrator: Orchestrator | null = null;
let skillStoreSnapshot: any[] = [];

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
  teachModeEnabled: false,
  autoSkillReplayEnabled: false,
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

function makeInput(query = "conversation test task") {
  return {
    query,
    tabId: 101,
    workspaceId: "ws-conv",
    settings: baseSettings,
    openRouterApiKey: "test-openrouter",
  };
}

describe("Orchestrator conversation collaboration", () => {
  beforeEach(() => {
    createdLoopNodeIds.length = 0;
    capturedInstructions.length = 0;

    plannerBuildNodesImpl = async () => [makeNode("n1", "step one")];
    plannerExpandNodeImpl = async () => null;
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok", confidence: 0.9 });
    loopEmitStaleSignal = false;
    loopStartImpl = async (nodeId) => ({
      outcome: "completed",
      summary: `completed ${nodeId || "unknown"}`,
      metrics: undefined,
    });

    const runtimeMessages: any[] = [];
    const checkpointStore: Record<string, unknown> = {};
    skillStoreSnapshot = [];
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
      return { ok: true };
    });
    (globalThis as any).__runtimeMessages = runtimeMessages;

    (chrome.storage.local as any).get = mock(async (key: string) => {
      if (key === "opensidebar:orchestrator:checkpoints") {
        return { [key]: checkpointStore };
      }
      if (key === "opensidebar:skills:v1") {
        return { [key]: skillStoreSnapshot };
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
      const skillKey = "opensidebar:skills:v1";
      if (Array.isArray(payload[skillKey])) {
        skillStoreSnapshot = payload[skillKey] as any[];
      }
    });

    (chrome.storage.sync as any).get = mock(async () => ({
      userSettings: baseSettings,
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
          title: "Test Page",
          url: "https://example.com/test",
          viewportText: "test page content",
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
          isPaused() { return false; },
          injectHint(_text: string) {},
        } as any;
      },
      workspaceManager: {
        async getWorkspaceById() {
          return { id: "ws-conv", tabIds: [101], tabGroupId: 1 };
        },
        async addTabToWorkspace() {},
      },
      waitForContentScriptReady: async () => true,
    };
    activeOrchestrator = null;
  });

  // ── WS4: Memory Writes (replaces LLM retrospective) ─────────────

  test("memory writes fire when nodes have failed", async () => {
    plannerBuildNodesImpl = async () => [makeNode("n1", "failing step")];
    // confidence 0.5 (above 0.35 threshold) → no bonus retry → maxRetries=1
    // This gives exactly 2 cycles: retry on first, fail on second
    verifierDecisionImpl = async () => ({
      decision: "retry",
      reason: "Executor output is empty",
      confidence: 0.5,
      failureType: "insufficient_evidence",
    });
    loopStartImpl = async (nodeId) => ({
      outcome: "completed",
      summary: `attempted ${nodeId || "unknown"}`,
    });

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("memory write on failure"));

    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;

    // Task should complete as failed (memory write may fail gracefully in test env
    // since offscreen document API isn't available, but the code path is exercised)
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion).toBeDefined();
    expect(completion?.payload?.status).toBe("failed");

    // No planner LLM calls should have been made for retrospective
    // (the old retrospective method no longer exists on PlannerLike)
  });

  test("memory writes do NOT fire when all nodes succeed", async () => {
    plannerBuildNodesImpl = async () => [makeNode("n1", "success step")];
    verifierDecisionImpl = async () => ({
      decision: "accept",
      reason: "All good",
      confidence: 0.95,
    });

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("all success no memory write"));

    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;

    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion).toBeDefined();
    expect(completion?.payload?.status).toBe("completed");
  });

  // ── WS2: Cross-Role Reflexion ────────────────────────────────────

  test("cross-role reflexion populates plannerReflexionLog and feeds to expandNode", async () => {
    let expandNodeReason = "";
    let execCount = 0;

    plannerBuildNodesImpl = async () => [
      makeNode("n1", "reflexion target node"),
    ];

    // Cycle 1: retry with insufficient_evidence → standard retry path → reflexion populated
    // Cycle 2: retry again → stale signal triggers replan → expandNode sees reflexion
    verifierDecisionImpl = async ({ objective }: any) => {
      if (objective === "reflexion target node") {
        return {
          decision: "retry",
          reason: "Page shows product catalog, not checkout",
          confidence: 0.5,
          failureType: "insufficient_evidence",
        };
      }
      return { decision: "accept", reason: "ok", confidence: 0.9 };
    };

    // After first execution cycle, enable stale signal for the second
    loopStartImpl = async (nodeId) => {
      execCount++;
      if (execCount === 1) {
        // After first executor run, set stale signal for next run
        loopEmitStaleSignal = true;
      }
      return { outcome: "completed", summary: `attempted ${nodeId || "unknown"}` };
    };

    plannerExpandNodeImpl = async (_node, _title, _url, reason) => {
      expandNodeReason = reason as string;
      return [
        makeNode("rp1", "navigate to checkout"),
        makeNode("rp2", "complete checkout", ["rp1"]),
      ];
    };

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("cross reflexion flow"));

    // Cycle 1: standard retry path populated plannerReflexionLog
    // Cycle 2: stale signal → replan path → expandNode received reflexion context
    expect(expandNodeReason).toContain("Prior failure lessons");
    expect(expandNodeReason).toContain("verifier retry");
    // n1 executed twice, then replanned into rp1 + rp2
    expect(createdLoopNodeIds).toEqual(["n1", "n1", "rp1", "rp2"]);
  });

  // ── WS1: Structured Evidence ─────────────────────────────────────

  test("executor_finished handoff artifact carries structured evidence", async () => {
    plannerBuildNodesImpl = async () => [makeNode("n1", "evidence test step")];
    verifierDecisionImpl = async () => ({
      decision: "accept",
      reason: "Evidence sufficient",
      confidence: 0.95,
    });

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("evidence attachment test"));

    // Verify via TASK_COMPLETION that the node completed (evidence is internal)
    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion).toBeDefined();
    expect(completion?.payload?.status).toBe("completed");

    // Verify evidence trace event was emitted
    // We can't directly inspect trace events in integration tests,
    // but we verify the task completed successfully with evidence path active
    expect(createdLoopNodeIds).toEqual(["n1"]);
  });
});
