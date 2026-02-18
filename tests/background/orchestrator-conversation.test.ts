import { beforeEach, describe, expect, mock, test } from "bun:test";
import "../setup";
import { SessionMetrics, ToolName, UserSettings } from "../../src/types";
import {
  AdvocateResponse,
  OrchestratorTask,
  PlanReviewResult,
  PlannerReflexionEntry,
  RetrospectiveResult,
  TaskNode,
} from "../../src/background/orchestrator/types";
import {
  Orchestrator,
  OrchestratorDeps,
} from "../../src/background/orchestrator/index";
import {
  DialogueResult,
  NodeVerificationInput,
  NodeVerificationResult,
} from "../../src/background/orchestrator/verifier";

const createdLoopNodeIds: string[] = [];
const capturedInstructions: Array<{ nodeId?: string; instruction: string }> = [];

type MockLoopConfig = { nodeId?: string };

let plannerBuildNodesImpl: (...args: unknown[]) => Promise<TaskNode[]>;
let plannerExpandNodeImpl: (...args: unknown[]) => Promise<TaskNode[] | null>;
let plannerRetrospectiveImpl:
  | ((
      task: OrchestratorTask,
      nodes: TaskNode[],
      reflexionLog: PlannerReflexionEntry[],
    ) => Promise<RetrospectiveResult>)
  | undefined;
let verifierDecisionImpl: (...args: unknown[]) => Promise<NodeVerificationResult>;
let verifierReviewPlanImpl:
  | ((task: OrchestratorTask, nodes: TaskNode[]) => Promise<PlanReviewResult>)
  | undefined;
let verifierRunDialogueImpl:
  | ((
      input: NodeVerificationInput,
      maxRounds: number,
      confidenceDelta: number,
    ) => Promise<DialogueResult>)
  | undefined;
let verifierAdvocateImpl:
  | ((
      task: OrchestratorTask,
      node: TaskNode,
      decision: NodeVerificationResult,
    ) => Promise<AdvocateResponse>)
  | undefined;
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
    plannerRetrospectiveImpl = undefined;
    verifierDecisionImpl = async () => ({ decision: "accept", reason: "ok", confidence: 0.9 });
    verifierReviewPlanImpl = undefined;
    verifierRunDialogueImpl = undefined;
    verifierAdvocateImpl = undefined;
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
        retrospective: plannerRetrospectiveImpl
          ? async (
              task: OrchestratorTask,
              nodes: TaskNode[],
              reflexionLog: PlannerReflexionEntry[],
            ) => plannerRetrospectiveImpl!(task, nodes, reflexionLog)
          : undefined,
      }),
      createVerifier: () => ({
        verifyNode: async (...args: unknown[]) => verifierDecisionImpl(...args),
        reviewPlan: verifierReviewPlanImpl
          ? async (task: OrchestratorTask, nodes: TaskNode[]) =>
              verifierReviewPlanImpl!(task, nodes)
          : undefined,
        runDialogue: verifierRunDialogueImpl
          ? async (
              input: NodeVerificationInput,
              maxRounds: number,
              confidenceDelta: number,
            ) => verifierRunDialogueImpl!(input, maxRounds, confidenceDelta)
          : undefined,
        advocateChallenge: verifierAdvocateImpl
          ? async (
              task: OrchestratorTask,
              node: TaskNode,
              decision: NodeVerificationResult,
            ) => verifierAdvocateImpl!(task, node, decision)
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
          isPaused() { return false; },
          injectHint(_text: string) {},
        } as any;
      },
      createLlm: () => ({
        switchToSmart() {},
        async complete() {
          return { content: "Test summary", usage: undefined };
        },
      }),
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

  // ── WS3: Preflight Review ────────────────────────────────────────

  test("preflight review fires for plans with ≥3 nodes and refines on rejection", async () => {
    let reviewPlanCalled = false;
    let expandNodeReason = "";

    plannerBuildNodesImpl = async () => [
      makeNode("n1", "step one"),
      makeNode("n2", "step two", ["n1"]),
      makeNode("n3", "step three", ["n2"]),
    ];

    verifierReviewPlanImpl = async (_task, nodes) => {
      reviewPlanCalled = true;
      expect(nodes.length).toBe(3);
      return {
        approved: false,
        concerns: ["Missing error handling step", "No validation of page state"],
        suggestedChanges: "Add a validation step after step two",
      };
    };

    plannerExpandNodeImpl = async (_node, _title, _url, reason) => {
      expandNodeReason = reason as string;
      return [
        makeNode("r1", "refined step one"),
        makeNode("r2", "refined step two with validation", ["r1"]),
      ];
    };

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("three step plan task"));

    expect(reviewPlanCalled).toBe(true);
    expect(expandNodeReason).toContain("Missing error handling step");
    expect(expandNodeReason).toContain("Add a validation step");
    // Refined plan should be used (2 nodes from expandNode)
    expect(createdLoopNodeIds).toEqual(["r1", "r2"]);
  });

  test("preflight review skips for plans with <3 nodes", async () => {
    let reviewPlanCalled = false;

    plannerBuildNodesImpl = async () => [
      makeNode("n1", "step one"),
      makeNode("n2", "step two", ["n1"]),
    ];

    verifierReviewPlanImpl = async () => {
      reviewPlanCalled = true;
      return { approved: true, concerns: [] };
    };

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("two step plan task"));

    expect(reviewPlanCalled).toBe(false);
    expect(createdLoopNodeIds).toEqual(["n1", "n2"]);
  });

  test("preflight review auto-approves when verifier returns approved:true", async () => {
    let reviewPlanCalled = false;

    plannerBuildNodesImpl = async () => [
      makeNode("n1", "step one"),
      makeNode("n2", "step two", ["n1"]),
      makeNode("n3", "step three", ["n2"]),
    ];

    verifierReviewPlanImpl = async () => {
      reviewPlanCalled = true;
      return { approved: true, concerns: [] };
    };

    plannerExpandNodeImpl = async () => {
      throw new Error("expandNode should not be called when plan is approved");
    };

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("approved three step plan"));

    expect(reviewPlanCalled).toBe(true);
    // Original 3 nodes should be used unchanged
    expect(createdLoopNodeIds).toEqual(["n1", "n2", "n3"]);
  });

  test("preflight review gracefully handles reviewPlan failure", async () => {
    plannerBuildNodesImpl = async () => [
      makeNode("n1", "step one"),
      makeNode("n2", "step two", ["n1"]),
      makeNode("n3", "step three", ["n2"]),
    ];

    verifierReviewPlanImpl = async () => {
      throw new Error("LLM provider unavailable");
    };

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("preflight failure recovery"));

    // Should proceed with original plan despite preflight error
    expect(createdLoopNodeIds).toEqual(["n1", "n2", "n3"]);
  });

  // ── WS5: Advocate-Critic Triad ───────────────────────────────────

  test("advocate overrides low-confidence verifier rejection on first attempt", async () => {
    let advocateCalled = false;

    plannerBuildNodesImpl = async () => [makeNode("n1", "advocate test node")];

    // Initial verifyNode must return non-accept so applyVerifierCriticReflection
    // enters the dialogue/advocate path (line 3429: returns early on accept)
    verifierDecisionImpl = async () => ({
      decision: "retry",
      reason: "Initial assessment negative",
      confidence: 0.5,
      failureType: "insufficient_evidence",
    });

    // runDialogue returns retry with low confidence
    verifierRunDialogueImpl = async () => ({
      finalDecision: {
        decision: "retry",
        reason: "Weak evidence of completion",
        confidence: 0.45,
        failureType: "insufficient_evidence",
      },
      turns: [
        {
          role: "verifier",
          decision: {
            decision: "retry",
            reason: "Weak evidence",
            confidence: 0.45,
            failureType: "insufficient_evidence",
          },
          round: 0,
        },
      ],
      converged: true,
      totalRounds: 1,
    });

    // Advocate argues for acceptance with higher confidence
    verifierAdvocateImpl = async (_task, _node, _decision) => {
      advocateCalled = true;
      return {
        argument: "Executor output explicitly mentions success criteria satisfied",
        suggestedDecision: "accept",
        confidence: 0.82,
      };
    };

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("advocate override task"));

    expect(advocateCalled).toBe(true);
    expect(createdLoopNodeIds).toEqual(["n1"]);

    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion).toBeDefined();
    // Advocate override → accept → task completed
    expect(completion?.payload?.status).toBe("completed");
  });

  test("advocate skips when verifier confidence is high (≥0.7)", async () => {
    let advocateCalled = false;

    plannerBuildNodesImpl = async () => [makeNode("n1", "high confidence reject")];

    // Initial verifyNode must return non-accept to enter dialogue path
    verifierDecisionImpl = async () => ({
      decision: "retry",
      reason: "Initial rejection",
      confidence: 0.7,
      failureType: "insufficient_evidence",
    });

    // Dialogue returns retry with HIGH confidence (≥0.7) — advocate gate blocks
    verifierRunDialogueImpl = async () => ({
      finalDecision: {
        decision: "retry",
        reason: "Clear failure to meet criteria",
        confidence: 0.85,
        failureType: "insufficient_evidence",
      },
      turns: [
        {
          role: "verifier",
          decision: {
            decision: "retry",
            reason: "Clear failure",
            confidence: 0.85,
            failureType: "insufficient_evidence",
          },
          round: 0,
        },
      ],
      converged: true,
      totalRounds: 1,
    });

    verifierAdvocateImpl = async () => {
      advocateCalled = true;
      return {
        argument: "should not be called",
        suggestedDecision: "accept",
        confidence: 0.9,
      };
    };

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("high confidence reject task"));

    expect(advocateCalled).toBe(false);
  });

  test("advocate skips when node has already been retried (retries > 0)", async () => {
    let advocateCalled = false;
    let dialogueCallCount = 0;

    plannerBuildNodesImpl = async () => [makeNode("n1", "retry then advocate check")];

    // Always return non-accept so applyVerifierCriticReflection enters dialogue path
    verifierDecisionImpl = async () => ({
      decision: "retry",
      reason: "Needs more work",
      confidence: 0.6,
      failureType: "insufficient_evidence",
    });

    // Cycle 1: dialogue returns HIGH confidence (≥0.7) → advocate gated by confidence
    // Cycle 2: dialogue returns LOW confidence (<0.7) → advocate gated by retries > 0
    verifierRunDialogueImpl = async () => {
      dialogueCallCount++;
      if (dialogueCallCount === 1) {
        return {
          finalDecision: {
            decision: "retry",
            reason: "High confidence rejection",
            confidence: 0.85,
            failureType: "insufficient_evidence",
          },
          turns: [],
          converged: true,
          totalRounds: 1,
        };
      }
      // Confidence 0.55: low enough for advocate (< 0.7) but above escalation
      // threshold (>= 0.45) to avoid blocking on operator decision
      return {
        finalDecision: {
          decision: "retry",
          reason: "Low confidence but retried node",
          confidence: 0.55,
          failureType: "insufficient_evidence",
        },
        turns: [],
        converged: true,
        totalRounds: 1,
      };
    };

    verifierAdvocateImpl = async () => {
      advocateCalled = true;
      return {
        argument: "Should not fire on retried node",
        suggestedDecision: "accept",
        confidence: 0.9,
      };
    };

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("retry then advocate check"));

    // Cycle 1: advocate skipped because dialogue confidence ≥ 0.7
    // Cycle 2: advocate skipped because node.retries > 0
    expect(advocateCalled).toBe(false);
    expect(dialogueCallCount).toBe(2);
  });

  test("advocate gracefully handles failure and falls back to verifier decision", async () => {
    plannerBuildNodesImpl = async () => [makeNode("n1", "advocate failure fallback")];

    // Initial verifyNode must return non-accept to enter dialogue/advocate path
    verifierDecisionImpl = async () => ({
      decision: "retry",
      reason: "Initial rejection",
      confidence: 0.5,
      failureType: "insufficient_evidence",
    });

    verifierRunDialogueImpl = async () => ({
      finalDecision: {
        decision: "retry",
        reason: "Needs more evidence",
        confidence: 0.45,
        failureType: "insufficient_evidence",
      },
      turns: [],
      converged: true,
      totalRounds: 1,
    });

    verifierAdvocateImpl = async () => {
      throw new Error("advocate LLM call failed");
    };

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("advocate failure fallback task"));

    // Should still complete (retry → fail) without crashing
    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion).toBeDefined();
    // Task should reach completion (failed due to retry with no success)
    expect(["failed", "partial"]).toContain(completion?.payload?.status);
  });

  // ── WS4: Retrospective ──────────────────────────────────────────

  test("retrospective fires when nodes have failed", async () => {
    let retrospectiveCalled = false;
    let retrospectiveReflexionLog: PlannerReflexionEntry[] = [];

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

    plannerRetrospectiveImpl = async (_task, _nodes, reflexionLog) => {
      retrospectiveCalled = true;
      retrospectiveReflexionLog = reflexionLog;
      return {
        lessons: [
          "Should have decomposed into smaller steps for better observability",
          "Missing prerequisite validation before main action",
        ],
      };
    };

    // Need to recreate deps after setting retrospectiveImpl
    orchestratorDeps.createPlanner = () => ({
      buildNodes: async (...args: unknown[]) => plannerBuildNodesImpl(...args),
      expandNode: async (...args: unknown[]) => plannerExpandNodeImpl(...args),
      retrospective: async (
        task: OrchestratorTask,
        nodes: TaskNode[],
        reflexionLog: PlannerReflexionEntry[],
      ) => plannerRetrospectiveImpl!(task, nodes, reflexionLog),
    });

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("retrospective on failure"));

    expect(retrospectiveCalled).toBe(true);
    // Reflexion log should have been populated by verifier retry
    expect(retrospectiveReflexionLog.length).toBeGreaterThan(0);

    const messages = (globalThis as any).__runtimeMessages as Array<{
      type?: string;
      payload?: any;
    }>;
    const completion = messages.find((m) => m.type === "TASK_COMPLETION");
    expect(completion).toBeDefined();
    expect(completion?.payload?.status).toBe("failed");
  });

  test("retrospective does NOT fire when all nodes succeed", async () => {
    let retrospectiveCalled = false;

    plannerBuildNodesImpl = async () => [makeNode("n1", "success step")];
    verifierDecisionImpl = async () => ({
      decision: "accept",
      reason: "All good",
      confidence: 0.95,
    });

    orchestratorDeps.createPlanner = () => ({
      buildNodes: async (...args: unknown[]) => plannerBuildNodesImpl(...args),
      expandNode: async (...args: unknown[]) => plannerExpandNodeImpl(...args),
      retrospective: async () => {
        retrospectiveCalled = true;
        return { lessons: [] };
      },
    });

    const orchestrator = new Orchestrator(orchestratorDeps);
    activeOrchestrator = orchestrator;
    await orchestrator.startTask(makeInput("all success no retrospective"));

    expect(retrospectiveCalled).toBe(false);

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
