import "../setup";
import { describe, test, expect } from "vitest";
import {
  isRecord,
  isNonNegativeInteger,
  isTaskNodeStatus,
  isTaskStatus,
  sanitizeTaskNode,
  sanitizeTask,
  sanitizeSessionMetrics,
  sanitizeBudget,
  sanitizeCheckpoint,
  sanitizeEscalationPacket,
  mergeSessionMetrics,
  emptySessionMetrics,
  CHECKPOINT_VERSION,
  DEFAULT_MAX_REPLANS,
  DEFAULT_MAX_SESSION_TIME_MS,
  DEFAULT_MAX_TOTAL_TOKENS,
  DEFAULT_MAX_TOTAL_COST_USD,
} from "../../src/background/orchestrator/sanitizers";
import { ToolName } from "../../src/types";

// ----- helpers -----

function validTaskNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "node-1",
    role: "executor",
    description: "Click the submit button",
    successCriteria: "Form submitted successfully",
    allowedTools: [ToolName.CLICK_ELEMENT, ToolName.TYPE_TEXT],
    dependencies: [],
    assumptions: [],
    handoffArtifacts: [
      {
        role: "planner",
        phase: "planned",
        note: "Initial plan",
        timestamp: 1000,
      },
    ],
    reflexionLog: [],
    handoffDepth: 0,
    status: "pending",
    retries: 0,
    ...overrides,
  };
}

function validTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    workspaceId: "ws-1",
    rootTabId: 123,
    query: "Fill out the form",
    status: "running",
    createdAt: Date.now(),
    nodes: [validTaskNode()],
    maxWorkers: 1,
    maxReplans: 3,
    replansUsed: 0,
    horizonExpansions: 0,
    currentIndex: 0,
    sessionMetrics: validSessionMetrics(),
    budget: {
      maxSessionTimeMs: 720000,
      maxTotalTokens: 1000000,
      maxTotalCostUsd: 1.5,
    },
    ...overrides,
  };
}

function validSessionMetrics() {
  return {
    totalPromptTokens: 100,
    totalCompletionTokens: 50,
    totalTokens: 150,
    totalCost: 0.01,
    totalCostActual: 0.01,
    totalCostEstimated: 0,
    costMode: "actual",
    totalLlmTimeMs: 500,
    totalSessionTimeMs: 2000,
    llmCallCount: 3,
    visionCallCount: 1,
    cachedVisionCallCount: 2,
    totalImagePromptTokenEstimate: 765,
    imagePromptCount: 1,
    perceptionModeDecision: {
      mode: "unified_vl",
      reason: "visual_task_text",
      signals: ["visual_task_text"],
    },
    totalCachedTokens: 20,
    modelBreakdown: {},
  };
}

function validEscalationPacket(overrides: Record<string, unknown> = {}) {
  return {
    escalationId: "esc-1",
    taskId: "task-1",
    workspaceId: "ws-1",
    nodeId: "node-1",
    risk: "medium",
    confidence: 0.7,
    reason: "Element not found",
    snapshotSummary: "Page showing error state",
    options: [
      {
        id: "approve_continue",
        label: "Continue anyway",
        impact: "May fail again",
      },
      {
        id: "skip_node",
        label: "Skip this step",
        impact: "Will move to next step",
      },
    ],
    recommendedOption: "approve_continue",
    lastActions: ["click_element(5)", "wait(1000)"],
    budgetState: {
      elapsedMs: 5000,
      maxSessionTimeMs: 720000,
      totalTokens: 5000,
      maxTotalTokens: 1000000,
      totalCostUsd: 0.05,
      maxTotalCostUsd: 1.5,
    },
    timeoutMs: 30000,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ========================================================================
// Type Guards
// ========================================================================

describe("isRecord", () => {
  test("returns true for plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  test("returns false for non-objects", () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord("string")).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord(true)).toBe(false);
  });

  test("returns true for arrays (they are objects)", () => {
    expect(isRecord([])).toBe(true);
  });
});

describe("isNonNegativeInteger", () => {
  test("accepts zero and positive integers", () => {
    expect(isNonNegativeInteger(0)).toBe(true);
    expect(isNonNegativeInteger(1)).toBe(true);
    expect(isNonNegativeInteger(999999)).toBe(true);
  });

  test("rejects negative numbers", () => {
    expect(isNonNegativeInteger(-1)).toBe(false);
  });

  test("rejects floats", () => {
    expect(isNonNegativeInteger(1.5)).toBe(false);
  });

  test("rejects non-numbers", () => {
    expect(isNonNegativeInteger("0")).toBe(false);
    expect(isNonNegativeInteger(null)).toBe(false);
    expect(isNonNegativeInteger(undefined)).toBe(false);
  });
});

describe("isTaskNodeStatus", () => {
  test("accepts valid statuses", () => {
    for (const s of ["pending", "running", "completed", "failed", "skipped"]) {
      expect(isTaskNodeStatus(s)).toBe(true);
    }
  });

  test("rejects invalid values", () => {
    expect(isTaskNodeStatus("cancelled")).toBe(false);
    expect(isTaskNodeStatus("")).toBe(false);
    expect(isTaskNodeStatus(null)).toBe(false);
  });
});

describe("isTaskStatus", () => {
  test("accepts valid statuses", () => {
    for (const s of ["planning", "running", "completed", "failed", "stopped"]) {
      expect(isTaskStatus(s)).toBe(true);
    }
  });

  test("rejects invalid values", () => {
    expect(isTaskStatus("pending")).toBe(false);
    expect(isTaskStatus("skipped")).toBe(false);
  });
});

// ========================================================================
// sanitizeTaskNode
// ========================================================================

describe("sanitizeTaskNode", () => {
  test("accepts valid node", () => {
    const node = sanitizeTaskNode(validTaskNode());
    expect(node).not.toBeNull();
    expect(node!.id).toBe("node-1");
    expect(node!.role).toBe("executor");
    expect(node!.allowedTools).toEqual([
      ToolName.CLICK_ELEMENT,
      ToolName.TYPE_TEXT,
    ]);
  });

  test("rejects non-object", () => {
    expect(sanitizeTaskNode(null)).toBeNull();
    expect(sanitizeTaskNode("string")).toBeNull();
    expect(sanitizeTaskNode(42)).toBeNull();
  });

  test("rejects empty id", () => {
    expect(sanitizeTaskNode(validTaskNode({ id: "" }))).toBeNull();
  });

  test("rejects non-executor role", () => {
    expect(sanitizeTaskNode(validTaskNode({ role: "planner" }))).toBeNull();
    expect(sanitizeTaskNode(validTaskNode({ role: "verifier" }))).toBeNull();
  });

  test("rejects empty description", () => {
    expect(sanitizeTaskNode(validTaskNode({ description: "" }))).toBeNull();
  });

  test("rejects empty successCriteria", () => {
    expect(
      sanitizeTaskNode(validTaskNode({ successCriteria: "" })),
    ).toBeNull();
  });

  test("filters invalid tool names from allowedTools", () => {
    const node = sanitizeTaskNode(
      validTaskNode({
        allowedTools: [ToolName.CLICK_ELEMENT, "fake_tool", ToolName.NAVIGATE],
      }),
    );
    expect(node).not.toBeNull();
    expect(node!.allowedTools).toEqual([
      ToolName.CLICK_ELEMENT,
      ToolName.NAVIGATE,
    ]);
  });

  test("rejects when all tools are invalid", () => {
    expect(
      sanitizeTaskNode(validTaskNode({ allowedTools: ["fake1", "fake2"] })),
    ).toBeNull();
  });

  test("rejects empty allowedTools array", () => {
    expect(sanitizeTaskNode(validTaskNode({ allowedTools: [] }))).toBeNull();
  });

  test("rejects invalid status", () => {
    expect(
      sanitizeTaskNode(validTaskNode({ status: "cancelled" })),
    ).toBeNull();
  });

  test("rejects negative handoffDepth", () => {
    expect(
      sanitizeTaskNode(validTaskNode({ handoffDepth: -1 })),
    ).toBeNull();
  });

  test("rejects non-integer retries", () => {
    expect(sanitizeTaskNode(validTaskNode({ retries: 1.5 }))).toBeNull();
  });

  test("deduplicates dependencies", () => {
    const node = sanitizeTaskNode(
      validTaskNode({ dependencies: ["dep-1", "dep-1", "dep-2"] }),
    );
    expect(node).not.toBeNull();
    expect(node!.dependencies).toEqual(["dep-1", "dep-2"]);
  });

  test("rejects dependencies with empty strings", () => {
    expect(
      sanitizeTaskNode(validTaskNode({ dependencies: ["dep-1", ""] })),
    ).toBeNull();
  });

  test("preserves optional handoffFromNodeId", () => {
    const node = sanitizeTaskNode(
      validTaskNode({ handoffFromNodeId: "node-0" }),
    );
    expect(node!.handoffFromNodeId).toBe("node-0");
  });

  test("preserves optional result, userFacingResult, and error", () => {
    const node = sanitizeTaskNode(
      validTaskNode({
        result: "success",
        userFacingResult: "full answer",
        error: "some warning",
      }),
    );
    expect(node!.result).toBe("success");
    expect(node!.userFacingResult).toBe("full answer");
    expect(node!.error).toBe("some warning");
  });

  test("parses reflexionLog entries", () => {
    const node = sanitizeTaskNode(
      validTaskNode({
        reflexionLog: [
          {
            attempt: 1,
            executorSummary: "Clicked wrong button",
            verifierDecision: "retry",
            verifierReason: "Button not found",
            confidence: 0.5,
            timestamp: 2000,
          },
        ],
      }),
    );
    expect(node!.reflexionLog).toHaveLength(1);
    expect(node!.reflexionLog[0].attempt).toBe(1);
  });

  test("skips invalid reflexionLog entries silently", () => {
    const node = sanitizeTaskNode(
      validTaskNode({
        reflexionLog: [
          { attempt: "bad" }, // invalid
          {
            attempt: 1,
            executorSummary: "ok",
            verifierDecision: "retry",
            verifierReason: "reason",
            confidence: 0.8,
            timestamp: 3000,
          },
        ],
      }),
    );
    expect(node!.reflexionLog).toHaveLength(1);
  });

  test("rejects invalid handoffArtifacts", () => {
    expect(
      sanitizeTaskNode(
        validTaskNode({
          handoffArtifacts: [{ role: "invalid", phase: "planned", note: "x", timestamp: 0 }],
        }),
      ),
    ).toBeNull();
  });
});

// ========================================================================
// sanitizeTask
// ========================================================================

describe("sanitizeTask", () => {
  test("accepts valid task", () => {
    const task = sanitizeTask(validTask());
    expect(task).not.toBeNull();
    expect(task!.id).toBe("task-1");
    expect(task!.nodes).toHaveLength(1);
  });

  test("rejects non-object", () => {
    expect(sanitizeTask(null)).toBeNull();
  });

  test("rejects empty id", () => {
    expect(sanitizeTask(validTask({ id: "" }))).toBeNull();
  });

  test("rejects empty workspaceId", () => {
    expect(sanitizeTask(validTask({ workspaceId: "" }))).toBeNull();
  });

  test("rejects invalid rootTabId", () => {
    expect(sanitizeTask(validTask({ rootTabId: -1 }))).toBeNull();
    expect(sanitizeTask(validTask({ rootTabId: "abc" }))).toBeNull();
  });

  test("rejects invalid status", () => {
    expect(sanitizeTask(validTask({ status: "pending" }))).toBeNull();
  });

  test("rejects maxWorkers out of range", () => {
    expect(sanitizeTask(validTask({ maxWorkers: 0 }))).toBeNull();
    expect(sanitizeTask(validTask({ maxWorkers: 9 }))).toBeNull();
  });

  test("uses default maxReplans when undefined", () => {
    const task = sanitizeTask(validTask({ maxReplans: undefined }));
    expect(task!.maxReplans).toBe(DEFAULT_MAX_REPLANS);
  });

  test("uses default replansUsed (0) when undefined", () => {
    const task = sanitizeTask(validTask({ replansUsed: undefined }));
    expect(task!.replansUsed).toBe(0);
  });

  test("rejects when any node is invalid", () => {
    expect(
      sanitizeTask(
        validTask({ nodes: [validTaskNode(), { id: "" }] }),
      ),
    ).toBeNull();
  });

  test("uses default budget when not provided", () => {
    const task = sanitizeTask(validTask({ budget: undefined }));
    expect(task!.budget.maxSessionTimeMs).toBe(DEFAULT_MAX_SESSION_TIME_MS);
    expect(task!.budget.maxTotalTokens).toBe(DEFAULT_MAX_TOTAL_TOKENS);
    expect(task!.budget.maxTotalCostUsd).toBe(DEFAULT_MAX_TOTAL_COST_USD);
  });

  test("preserves optional fields", () => {
    const task = sanitizeTask(
      validTask({
        runId: "run-1",
        startedAt: 1000,
        finishedAt: 2000,
        terminationReason: "completed",
      }),
    );
    expect(task!.runId).toBe("run-1");
    expect(task!.startedAt).toBe(1000);
    expect(task!.finishedAt).toBe(2000);
    expect(task!.terminationReason).toBe("completed");
  });

  test("rejects invalid startedAt", () => {
    expect(sanitizeTask(validTask({ startedAt: -1 }))).toBeNull();
    expect(sanitizeTask(validTask({ startedAt: "abc" }))).toBeNull();
  });

  test("rejects invalid terminationReason type", () => {
    expect(sanitizeTask(validTask({ terminationReason: 42 }))).toBeNull();
  });

  test("uses empty session metrics when sessionMetrics is missing", () => {
    const task = sanitizeTask(validTask({ sessionMetrics: undefined }));
    expect(task!.sessionMetrics.totalTokens).toBe(0);
  });

  test("parses pendingEscalation", () => {
    const task = sanitizeTask(
      validTask({
        pendingEscalation: {
          packet: validEscalationPacket(),
        },
      }),
    );
    expect(task!.pendingEscalation).toBeDefined();
    expect(task!.pendingEscalation!.packet.escalationId).toBe("esc-1");
  });

  test("rejects invalid pendingEscalation", () => {
    expect(
      sanitizeTask(validTask({ pendingEscalation: "bad" })),
    ).toBeNull();
  });
});

// ========================================================================
// sanitizeSessionMetrics
// ========================================================================

describe("sanitizeSessionMetrics", () => {
  test("accepts valid metrics", () => {
    const result = sanitizeSessionMetrics(validSessionMetrics());
    expect(result).not.toBeNull();
    expect(result!.totalTokens).toBe(150);
    expect(result!.visionCallCount).toBe(1);
    expect(result!.cachedVisionCallCount).toBe(2);
    expect(result!.perceptionModeDecision).toEqual({
      mode: "unified_vl",
      reason: "visual_task_text",
      signals: ["visual_task_text"],
    });
  });

  test("rejects NaN in numeric fields", () => {
    expect(
      sanitizeSessionMetrics({ ...validSessionMetrics(), totalTokens: NaN }),
    ).toBeNull();
  });

  test("rejects negative numeric fields", () => {
    expect(
      sanitizeSessionMetrics({ ...validSessionMetrics(), llmCallCount: -1 }),
    ).toBeNull();
  });

  test("rejects non-number in numeric fields", () => {
    expect(
      sanitizeSessionMetrics({
        ...validSessionMetrics(),
        totalPromptTokens: "100",
      }),
    ).toBeNull();
  });

  test("parses modelBreakdown entries", () => {
    const result = sanitizeSessionMetrics({
      ...validSessionMetrics(),
      modelBreakdown: {
        "openai/gpt-4o": {
          promptTokens: 100,
          completionTokens: 50,
          cost: 0.01,
          calls: 2,
        },
      },
    });
    expect(result!.modelBreakdown["openai/gpt-4o"]).toBeDefined();
    expect(result!.modelBreakdown["openai/gpt-4o"].calls).toBe(2);
  });

  test("rejects invalid modelBreakdown entry", () => {
    expect(
      sanitizeSessionMetrics({
        ...validSessionMetrics(),
        modelBreakdown: {
          "bad-model": { promptTokens: "bad" },
        },
      }),
    ).toBeNull();
  });

  test("infers costMode from actual/estimated costs", () => {
    const result = sanitizeSessionMetrics({
      ...validSessionMetrics(),
      totalCostActual: 0.5,
      totalCostEstimated: 0.3,
      costMode: undefined,
    });
    expect(result!.costMode).toBe("mixed");
  });

  test("uses totalCost as fallback for totalCostActual", () => {
    const metrics = validSessionMetrics();
    delete (metrics as any).totalCostActual;
    const result = sanitizeSessionMetrics(metrics);
    expect(result!.totalCostActual).toBe(metrics.totalCost);
  });

  test("defaults missing vision counters for legacy metrics", () => {
    const metrics = validSessionMetrics();
    delete (metrics as any).visionCallCount;
    delete (metrics as any).cachedVisionCallCount;
    delete (metrics as any).totalImagePromptTokenEstimate;
    delete (metrics as any).imagePromptCount;
    const result = sanitizeSessionMetrics(metrics);
    expect(result!.visionCallCount).toBe(0);
    expect(result!.cachedVisionCallCount).toBe(0);
    expect(result!.totalImagePromptTokenEstimate).toBe(0);
    expect(result!.imagePromptCount).toBe(0);
  });

  test("rejects invalid optional vision counters", () => {
    expect(
      sanitizeSessionMetrics({
        ...validSessionMetrics(),
        visionCallCount: -1,
      }),
    ).toBeNull();
  });

  test("round-trips perception turn-mode counters", () => {
    const result = sanitizeSessionMetrics({
      ...validSessionMetrics(),
      structuredTurnCount: 4,
      unifiedVlTurnCount: 7,
    });
    expect(result!.structuredTurnCount).toBe(4);
    expect(result!.unifiedVlTurnCount).toBe(7);
  });

  test("defaults missing turn-mode counters for legacy metrics", () => {
    const result = sanitizeSessionMetrics(validSessionMetrics());
    expect(result!.structuredTurnCount).toBe(0);
    expect(result!.unifiedVlTurnCount).toBe(0);
  });

  test("rejects negative turn-mode counters", () => {
    expect(
      sanitizeSessionMetrics({
        ...validSessionMetrics(),
        unifiedVlTurnCount: -1,
      }),
    ).toBeNull();
  });

  test("keeps a valid perceptionModeDecision.autoDefault and drops unknown values", () => {
    const withValid = sanitizeSessionMetrics({
      ...validSessionMetrics(),
      perceptionModeDecision: {
        mode: "unified_vl",
        reason: "default_unified_vl",
        signals: [],
        autoDefault: "unified_vl",
      },
    });
    expect(withValid!.perceptionModeDecision!.autoDefault).toBe("unified_vl");

    const withUnknown = sanitizeSessionMetrics({
      ...validSessionMetrics(),
      perceptionModeDecision: {
        mode: "structured",
        reason: "dom_signals_sufficient",
        signals: [],
        autoDefault: "bogus",
      },
    });
    expect(withUnknown).not.toBeNull();
    expect(withUnknown!.perceptionModeDecision!.autoDefault).toBeUndefined();
  });

  test("rejects invalid image prompt estimates", () => {
    expect(
      sanitizeSessionMetrics({
        ...validSessionMetrics(),
        totalImagePromptTokenEstimate: -1,
      }),
    ).toBeNull();
    expect(
      sanitizeSessionMetrics({
        ...validSessionMetrics(),
        imagePromptCount: NaN,
      }),
    ).toBeNull();
  });

  test("rejects invalid perception mode decisions", () => {
    expect(
      sanitizeSessionMetrics({
        ...validSessionMetrics(),
        perceptionModeDecision: {
          mode: "auto",
          reason: "bad",
          signals: [],
        },
      }),
    ).toBeNull();
  });
});

// ========================================================================
// sanitizeBudget
// ========================================================================

describe("sanitizeBudget", () => {
  test("accepts valid budget", () => {
    const result = sanitizeBudget({
      maxSessionTimeMs: 720000,
      maxTotalTokens: 1000000,
      maxTotalCostUsd: 1.5,
    });
    expect(result).not.toBeNull();
    expect(result!.maxTotalCostUsd).toBe(1.5);
  });

  test("rejects non-integer maxSessionTimeMs", () => {
    expect(
      sanitizeBudget({
        maxSessionTimeMs: 1.5,
        maxTotalTokens: 1000000,
        maxTotalCostUsd: 1.5,
      }),
    ).toBeNull();
  });

  test("rejects NaN maxTotalCostUsd", () => {
    expect(
      sanitizeBudget({
        maxSessionTimeMs: 720000,
        maxTotalTokens: 1000000,
        maxTotalCostUsd: NaN,
      }),
    ).toBeNull();
  });

  test("rejects negative maxTotalCostUsd", () => {
    expect(
      sanitizeBudget({
        maxSessionTimeMs: 720000,
        maxTotalTokens: 1000000,
        maxTotalCostUsd: -0.5,
      }),
    ).toBeNull();
  });

  test("accepts zero cost budget", () => {
    const result = sanitizeBudget({
      maxSessionTimeMs: 0,
      maxTotalTokens: 0,
      maxTotalCostUsd: 0,
    });
    expect(result).not.toBeNull();
  });
});

// ========================================================================
// mergeSessionMetrics
// ========================================================================

describe("mergeSessionMetrics", () => {
  test("returns target unchanged when incoming is undefined", () => {
    const target = emptySessionMetrics();
    target.totalTokens = 100;
    const result = mergeSessionMetrics(target, undefined);
    expect(result.totalTokens).toBe(100);
  });

  test("sums all numeric fields", () => {
    const target = emptySessionMetrics();
    target.totalTokens = 100;
    target.llmCallCount = 2;
    target.visionCallCount = 1;
    target.totalImagePromptTokenEstimate = 85;
    target.imagePromptCount = 1;
    target.perceptionModeDecision = {
      mode: "structured",
      reason: "dom_signals_sufficient",
      signals: [],
    };

    const incoming = emptySessionMetrics();
    incoming.totalTokens = 50;
    incoming.llmCallCount = 1;
    incoming.cachedVisionCallCount = 2;
    incoming.totalImagePromptTokenEstimate = 765;
    incoming.imagePromptCount = 1;
    incoming.perceptionModeDecision = {
      mode: "unified_vl",
      reason: "canvas_present",
      signals: ["canvas_present"],
    };

    const result = mergeSessionMetrics(target, incoming);
    expect(result.totalTokens).toBe(150);
    expect(result.llmCallCount).toBe(3);
    expect(result.visionCallCount).toBe(1);
    expect(result.cachedVisionCallCount).toBe(2);
    expect(result.totalImagePromptTokenEstimate).toBe(850);
    expect(result.imagePromptCount).toBe(2);
    expect(result.perceptionModeDecision).toEqual({
      mode: "unified_vl",
      reason: "canvas_present",
      signals: ["canvas_present"],
    });
  });

  test("merges modelBreakdown entries", () => {
    const target = emptySessionMetrics();
    target.modelBreakdown["model-a"] = {
      promptTokens: 100,
      completionTokens: 50,
      cost: 0.01,
      actualCost: 0.01,
      estimatedCost: 0,
      costMode: "actual",
      calls: 2,
    };

    const incoming = emptySessionMetrics();
    incoming.modelBreakdown["model-a"] = {
      promptTokens: 200,
      completionTokens: 100,
      cost: 0.02,
      actualCost: 0.02,
      estimatedCost: 0,
      costMode: "actual",
      calls: 3,
    };
    incoming.modelBreakdown["model-b"] = {
      promptTokens: 50,
      completionTokens: 25,
      cost: 0.005,
      actualCost: 0,
      estimatedCost: 0.005,
      costMode: "estimated",
      calls: 1,
    };

    const result = mergeSessionMetrics(target, incoming);
    expect(result.modelBreakdown["model-a"].calls).toBe(5);
    expect(result.modelBreakdown["model-a"].promptTokens).toBe(300);
    expect(result.modelBreakdown["model-b"].calls).toBe(1);
  });

  test("derives costMode from merged actual/estimated costs", () => {
    const target = emptySessionMetrics();
    target.totalCostActual = 0.5;
    target.totalCostEstimated = 0;

    const incoming = emptySessionMetrics();
    incoming.totalCostActual = 0;
    incoming.totalCostEstimated = 0.3;

    const result = mergeSessionMetrics(target, incoming);
    expect(result.costMode).toBe("mixed");
  });
});

// ========================================================================
// sanitizeCheckpoint
// ========================================================================

describe("sanitizeCheckpoint", () => {
  test("accepts valid checkpoint", () => {
    const cp = sanitizeCheckpoint({
      version: CHECKPOINT_VERSION,
      savedAt: Date.now(),
      task: validTask(),
    });
    expect(cp).not.toBeNull();
    expect(cp!.version).toBe(CHECKPOINT_VERSION);
  });

  test("rejects non-object", () => {
    expect(sanitizeCheckpoint(null)).toBeNull();
    expect(sanitizeCheckpoint("string")).toBeNull();
  });

  test("rejects invalid version type", () => {
    expect(
      sanitizeCheckpoint({ version: "1", savedAt: 1000, task: validTask() }),
    ).toBeNull();
  });

  test("rejects missing savedAt", () => {
    expect(
      sanitizeCheckpoint({ version: CHECKPOINT_VERSION, task: validTask() }),
    ).toBeNull();
  });

  test("rejects when task is invalid", () => {
    expect(
      sanitizeCheckpoint({
        version: CHECKPOINT_VERSION,
        savedAt: 1000,
        task: { id: "" },
      }),
    ).toBeNull();
  });

  test("preserves different version for migration logging", () => {
    const cp = sanitizeCheckpoint({
      version: 99,
      savedAt: 1000,
      task: validTask(),
    });
    // The code still returns a checkpoint with the raw version
    // for the prune flow to log version mismatches
    expect(cp).not.toBeNull();
    expect(cp!.version).toBe(99);
  });
});

// ========================================================================
// sanitizeEscalationPacket
// ========================================================================

describe("sanitizeEscalationPacket", () => {
  test("accepts valid packet", () => {
    const packet = sanitizeEscalationPacket(validEscalationPacket());
    expect(packet).not.toBeNull();
    expect(packet!.escalationId).toBe("esc-1");
    expect(packet!.options).toHaveLength(2);
  });

  test("rejects non-object", () => {
    expect(sanitizeEscalationPacket(null)).toBeNull();
  });

  test("rejects empty escalationId", () => {
    expect(
      sanitizeEscalationPacket(validEscalationPacket({ escalationId: "" })),
    ).toBeNull();
  });

  test("rejects invalid risk level", () => {
    expect(
      sanitizeEscalationPacket(validEscalationPacket({ risk: "low" })),
    ).toBeNull();
  });

  test("accepts all valid risk levels", () => {
    for (const risk of ["medium", "high", "critical"]) {
      expect(
        sanitizeEscalationPacket(validEscalationPacket({ risk })),
      ).not.toBeNull();
    }
  });

  test("rejects empty options array", () => {
    expect(
      sanitizeEscalationPacket(validEscalationPacket({ options: [] })),
    ).toBeNull();
  });

  test("rejects options with invalid id", () => {
    expect(
      sanitizeEscalationPacket(
        validEscalationPacket({
          options: [{ id: "invalid_option", label: "x", impact: "y" }],
        }),
      ),
    ).toBeNull();
  });

  test("rejects invalid recommendedOption", () => {
    expect(
      sanitizeEscalationPacket(
        validEscalationPacket({ recommendedOption: "bad_id" }),
      ),
    ).toBeNull();
  });

  test("rejects non-string lastActions entries", () => {
    expect(
      sanitizeEscalationPacket(
        validEscalationPacket({ lastActions: [1, 2, 3] }),
      ),
    ).toBeNull();
  });

  test("rejects NaN in budgetState", () => {
    expect(
      sanitizeEscalationPacket(
        validEscalationPacket({
          budgetState: {
            elapsedMs: NaN,
            maxSessionTimeMs: 720000,
            totalTokens: 5000,
            maxTotalTokens: 1000000,
            totalCostUsd: 0.05,
            maxTotalCostUsd: 1.5,
          },
        }),
      ),
    ).toBeNull();
  });

  test("rejects negative timeoutMs", () => {
    expect(
      sanitizeEscalationPacket(
        validEscalationPacket({ timeoutMs: -1 }),
      ),
    ).toBeNull();
  });

  test("clamps confidence to [0, 1]", () => {
    const packet = sanitizeEscalationPacket(
      validEscalationPacket({ confidence: 5.0 }),
    );
    expect(packet!.confidence).toBeLessThanOrEqual(1);
    expect(packet!.confidence).toBeGreaterThanOrEqual(0);
  });

  test("defaults confidence when not a number", () => {
    const packet = sanitizeEscalationPacket(
      validEscalationPacket({ confidence: "high" }),
    );
    expect(packet!.confidence).toBe(0.5);
  });

  test("preserves rerouteObjective on option", () => {
    const packet = sanitizeEscalationPacket(
      validEscalationPacket({
        options: [
          {
            id: "reroute_with_option",
            label: "Reroute",
            impact: "Try different approach",
            rerouteObjective: "Use keyboard navigation instead",
          },
        ],
        recommendedOption: "reroute_with_option",
      }),
    );
    expect(packet!.options[0].rerouteObjective).toBe(
      "Use keyboard navigation instead",
    );
  });
});

// ========================================================================
// emptySessionMetrics
// ========================================================================

describe("emptySessionMetrics", () => {
  test("returns zeroed metrics", () => {
    const m = emptySessionMetrics();
    expect(m.totalTokens).toBe(0);
    expect(m.totalCost).toBe(0);
    expect(m.llmCallCount).toBe(0);
    expect(m.costMode).toBe("none");
    expect(Object.keys(m.modelBreakdown)).toHaveLength(0);
  });
});
