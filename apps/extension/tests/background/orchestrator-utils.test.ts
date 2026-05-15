import { describe, expect, test } from "vitest";
import "../setup";
import { toSubtasks } from "../../src/background/orchestrator/utils";
import type { TaskNode } from "../../src/background/orchestrator/types";
import { ToolName } from "../../src/types";

function node(
  id: string,
  description: string,
  status: TaskNode["status"],
): TaskNode {
  return {
    id,
    role: "executor",
    description,
    successCriteria: `${description} is complete.`,
    allowedTools: [ToolName.READ_PAGE, ToolName.DONE],
    dependencies: [],
    assumptions: [],
    handoffArtifacts: [],
    reflexionLog: [],
    handoffDepth: 0,
    status,
    retries: 0,
  };
}

describe("orchestrator utils", () => {
  test("adds environment-neutral worker state to subtask progress", () => {
    const running = {
      ...node("n1", "Read alpha dashboard", "running"),
      parallelContract: {
        parallelism: "independent" as const,
        siblingAwareness: "summary" as const,
        resourceHints: [
          {
            kind: "url" as const,
            key: "alpha.example/dashboard",
            access: "read" as const,
            confidence: 0.95,
            source: "repair" as const,
          },
        ],
      },
    };
    const blocked = {
      ...node("n2", "Update alpha dashboard form", "pending"),
      parallelContract: {
        parallelism: "resource_bound" as const,
        siblingAwareness: "coordination_required" as const,
        resourceHints: [
          {
            kind: "url" as const,
            key: "alpha.example/dashboard",
            access: "write" as const,
            confidence: 0.95,
            source: "repair" as const,
          },
        ],
      },
    };

    const subtasks = toSubtasks([running, blocked]);

    expect(subtasks[0]).toMatchObject({
      nodeId: "n1",
      workerStatus: "running",
      parallelism: "independent",
      resourceSummary: "url:alpha.example/dashboard (read)",
    });
    expect(subtasks[1]).toMatchObject({
      nodeId: "n2",
      workerStatus: "blocked",
      parallelism: "resource_bound",
    });
    expect(subtasks[1].workerStatusDetail).toContain("Read alpha dashboard");
  });

  test("keeps dependency-waiting nodes queued before reporting resource blocks", () => {
    const running = {
      ...node("n1", "Read alpha dashboard", "running"),
      parallelContract: {
        parallelism: "independent" as const,
        siblingAwareness: "summary" as const,
        resourceHints: [
          {
            kind: "url" as const,
            key: "alpha.example/dashboard",
            access: "read" as const,
            confidence: 0.95,
            source: "repair" as const,
          },
        ],
      },
    };
    const dependency = node("n2", "Find the target record", "pending");
    const waiting = {
      ...node("n3", "Update alpha dashboard form", "pending"),
      dependencies: ["n2"],
      parallelContract: {
        parallelism: "resource_bound" as const,
        siblingAwareness: "coordination_required" as const,
        resourceHints: [
          {
            kind: "url" as const,
            key: "alpha.example/dashboard",
            access: "write" as const,
            confidence: 0.95,
            source: "repair" as const,
          },
        ],
      },
    };

    const subtasks = toSubtasks([running, dependency, waiting]);

    expect(subtasks[2]).toMatchObject({
      nodeId: "n3",
      workerStatus: "queued",
      workerStatusDetail: "Waiting for 1 dependency.",
    });
  });
});
