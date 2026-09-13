import { describe, expect, it } from "vitest";
import { projectPortableCheckpoint } from "../../src/background/orchestrator/portable-checkpoint";
import {
  checkpointCompatibility,
  classifyRestoreGrounding,
  migratePortableCheckpoint,
  validatePortableCheckpoint,
} from "@shared-types/portable-checkpoint-policy";
import type { OrchestratorCheckpoint } from "../../src/background/orchestrator/types";

const checkpoint = (): OrchestratorCheckpoint =>
  ({
    version: 1,
    savedAt: Date.parse("2026-08-08T12:00:00.000Z"),
    pendingFeedback: ["Use the monthly view"],
    task: {
      id: "local-task-id",
      workspaceId: "local-workspace-id",
      rootTabId: 42,
      rootTabUrl: "https://example.com/report?month=july",
      query: "Prepare the report",
      status: "running",
      createdAt: Date.parse("2026-08-08T11:00:00.000Z"),
      nodes: [
        {
          id: "step-1",
          role: "executor",
          description: "Read the monthly totals",
          successCriteria: "Totals are recorded",
          allowedTools: [],
          dependencies: [],
          assumptions: [],
          handoffArtifacts: [],
          reflexionLog: [],
          handoffDepth: 0,
          status: "completed",
          retries: 0,
          result: "Total is 120",
        },
      ],
      plannerReflexionLog: [],
      maxWorkers: 1,
      maxReplans: 1,
      replansUsed: 0,
      horizonExpansions: 0,
      currentIndex: 0,
      sessionMetrics: {
        totalPromptTokens: 10,
        totalCompletionTokens: 5,
        totalTokens: 15,
        totalCost: 0,
        totalLlmTimeMs: 100,
        totalSessionTimeMs: 200,
        llmCallCount: 1,
      },
      budget: {
        maxSessionTimeMs: 60_000,
        maxTotalTokens: 10_000,
        maxTotalCostUsd: 1,
      },
    },
  }) as OrchestratorCheckpoint;

describe("portable checkpoint projection", () => {
  it("projects useful state without Chrome-local identifiers", () => {
    const projected = projectPortableCheckpoint({
      sessionId: "1bd0c891-8ddb-468f-8f02-e47a0e430176",
      checkpointId: "f0341e58-3989-41ac-bd85-99aca119dd86",
      revision: 1,
      runtimeVersion: "0.7.2",
      reason: "pause",
      checkpoint: checkpoint(),
    });
    const serialized = JSON.stringify(projected);
    expect(projected.objective.originalRequest).toBe("Prepare the report");
    expect(projected.execution.completedActions[0]?.observedOutcome).toBe(
      "Total is 120",
    );
    expect(projected.grounding.expectedOrigins).toEqual([
      "https://example.com",
    ]);
    expect(serialized).not.toContain("rootTabId");
    expect(serialized).not.toContain("workspaceId");
    expect(serialized).not.toContain("local-workspace-id");
  });

  it("turns approval state into an expiring request without approval grants", () => {
    const local = checkpoint();
    local.task.pendingInteraction = {
      kind: "approval",
      nodeId: "step-1",
      requestedAt: Date.parse("2026-08-08T12:00:00.000Z"),
      approvalId: "local-approval-secret",
      toolName: "click_element",
      args: { id: 55 },
      context: "Submit the report",
      timeoutMs: 30_000,
    };
    const projected = projectPortableCheckpoint({
      sessionId: crypto.randomUUID(),
      checkpointId: crypto.randomUUID(),
      revision: 1,
      runtimeVersion: "0.7.2",
      reason: "waiting_for_user",
      checkpoint: local,
    });
    expect(projected.pending.kind).toBe("approval_required");
    expect(JSON.stringify(projected)).not.toContain("local-approval-secret");
    expect(JSON.stringify(projected)).not.toContain('"id":55');
  });

  it("rejects unknown nested fields and approval grants", () => {
    const projected = projectPortableCheckpoint({
      sessionId: crypto.randomUUID(),
      checkpointId: crypto.randomUUID(),
      revision: 1,
      runtimeVersion: "0.7.2",
      reason: "pause",
      checkpoint: checkpoint(),
    });
    const unknown = structuredClone(projected) as typeof projected & {
      objective: typeof projected.objective & { hidden?: string };
    };
    unknown.objective.hidden = "not allowed";
    expect(validatePortableCheckpoint(unknown)).toMatchObject({
      valid: false,
      code: "invalid_schema",
    });
    const grant = structuredClone(projected) as unknown as Record<string, unknown>;
    (grant.pending as Record<string, unknown>).approvalId = "replayable-grant";
    expect(validatePortableCheckpoint(grant)).toMatchObject({
      valid: false,
      code: "forbidden_field",
      path: "checkpoint.pending.approvalId",
    });
  });

  it("classifies compatibility and fresh page grounding", () => {
    const projected = projectPortableCheckpoint({
      sessionId: crypto.randomUUID(),
      checkpointId: crypto.randomUUID(),
      revision: 1,
      runtimeVersion: "0.7.2",
      reason: "pause",
      checkpoint: checkpoint(),
    });
    expect(checkpointCompatibility(1, "0.7.2", "0.8.0")).toBe("compatible");
    expect(checkpointCompatibility(1, "1.0.0", "0.8.0")).toBe("runtime_incompatible");
    expect(
      classifyRestoreGrounding(projected, {
        available: true,
        authorized: true,
        url: "https://example.com/live",
      }),
    ).toBe("matched");
    expect(
      classifyRestoreGrounding(projected, {
        available: true,
        authorized: true,
        url: "https://other.example/live",
      }),
    ).toBe("changed");
  });

  it("migrates the immediately previous closed schema without rewriting it", () => {
    const projected = projectPortableCheckpoint({
      sessionId: crypto.randomUUID(),
      checkpointId: crypto.randomUUID(),
      revision: 1,
      runtimeVersion: "0.7.2",
      reason: "pause",
      checkpoint: checkpoint(),
    });
    const previous = { ...projected, schemaVersion: 0 };
    expect(migratePortableCheckpoint(previous)).toMatchObject({
      valid: true,
      value: { schemaVersion: 1 },
    });
    expect(previous.schemaVersion).toBe(0);
  });
});
