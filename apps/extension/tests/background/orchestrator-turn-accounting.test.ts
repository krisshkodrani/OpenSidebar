import { describe, expect, test, vi } from "vitest";
import { ToolName } from "../../src/types";
import type { OrchestratorTask, TaskNode } from "../../src/background/orchestrator/types";
import { buildSubtaskResults, buildTaskProgress } from "../../src/background/orchestrator/builders";
import { sanitizeTaskNode } from "../../src/background/orchestrator/sanitizers";
import { observeNodeTurns, stopTrackedWorker, taskTurns, trackNodeTurns } from "../../src/background/orchestrator/turn-accounting";

function node(id = "node-1"): TaskNode {
  return {
    id, role: "executor", description: "Update the record", successCriteria: "Saved",
    allowedTools: [ToolName.READ_PAGE], dependencies: [], assumptions: [], handoffArtifacts: [],
    reflexionLog: [], handoffDepth: 0, status: "running", retries: 0,
  };
}
function task(nodes: TaskNode[]): OrchestratorTask {
  return { id: "task", nodes, status: "running", currentIndex: 0 } as OrchestratorTask;
}
async function attempt(n: TaskNode, turns: number, checkpoint?: number, resume = false) {
  return trackNodeTurns(n, { getCurrentTurn: () => turns }, checkpoint, resume,
    async () => {}, async () => ({ turnCount: turns }));
}

describe("orchestrator executor turn accounting", () => {
  test("counts independent nodes and retries in root, progress, and subtask messages", async () => {
    const a = node(), b = node("node-2");
    await attempt(a, 3);
    await attempt(a, 2);
    await attempt(b, 4);
    const t = task([a, b]);
    expect(taskTurns(t)).toBe(9);
    expect(buildSubtaskResults(t).map((result) => result.turnsUsed)).toEqual([5, 4]);
    const progress = buildTaskProgress(t);
    expect(progress.totalTurnsUsed).toBe(9);
    expect(progress.subtasks.map((subtask) => subtask.turnsUsed)).toEqual([5, 4]);
  });

  test("resumes cumulative checkpoint turns once across repeated recovery", async () => {
    const n = node();
    await attempt(n, 3);
    await attempt(n, 5); // second attempt paused: 8 total
    const restored = sanitizeTaskNode(JSON.parse(JSON.stringify(n)))!;
    expect(restored.turnsUsed).toBe(8);
    expect(restored.turnAttemptBase).toBe(3);
    await attempt(restored, 7, 5, true);
    await attempt(restored, 9, 7, true);
    observeNodeTurns(restored, 9);
    expect(restored.turnsUsed).toBe(12);
  });

  test("recovers turns newer than the orchestrator checkpoint", async () => {
    const n = { ...node(), turnsUsed: 3, turnAttemptBase: 3 };
    await attempt(n, 7, 5, true);
    expect(n.turnsUsed).toBe(10);
  });

  test("counts discarded checkpoint work before starting a fresh attempt", async () => {
    const n = { ...node(), turnsUsed: 8, turnAttemptBase: 3 };
    await attempt(n, 2, 6, false);
    expect(n.turnsUsed).toBe(11);
    expect(n.turnAttemptBase).toBe(9);
  });

  test("persists a retry base before running and records turns even if the loop throws", async () => {
    const n = { ...node(), turnsUsed: 3 };
    const saved: unknown[] = [];
    await expect(trackNodeTurns(n, { getCurrentTurn: () => 2 }, undefined, false,
      async () => { saved.push(JSON.parse(JSON.stringify(n))); },
      async () => {
        expect(saved).toEqual([expect.objectContaining({ turnsUsed: 3, turnAttemptBase: 3 })]);
        throw new Error("worker failed");
      })).rejects.toThrow("worker failed");
    expect(n.turnsUsed).toBe(5);
  });

  test("live progress and forced stop retain counts before worker removal", () => {
    const n = { ...node(), turnsUsed: 3, turnAttemptBase: 3 }, t = task([n]);
    let current = 2;
    const worker = { nodeId: n.id, loop: { getCurrentTurn: () => current, stop: vi.fn() } };
    expect(buildTaskProgress(t, [worker]).subtasks[0].turnsUsed).toBe(5);
    current = 4;
    stopTrackedWorker(t, worker);
    expect(worker.loop.stop).toHaveBeenCalledOnce();
    expect(buildSubtaskResults(t)[0].turnsUsed).toBe(7);
    expect(taskTurns(t)).toBe(7);
  });

  test("legacy checkpoints default to zero and malformed counts cannot poison totals", () => {
    expect(sanitizeTaskNode(node())?.turnsUsed).toBeUndefined();
    const restored = sanitizeTaskNode({ ...node(), turnsUsed: -2, turnAttemptBase: "bad" })!;
    expect(taskTurns(task([restored]))).toBe(0);
    observeNodeTurns(restored, NaN);
    expect(restored.turnsUsed).toBe(0);
  });
});
