import { afterEach, describe, expect, test, vi } from "vitest";
import "../setup";
import { emitBudgetWarnings } from "../../src/background/orchestrator/execution-budget";
import type { OrchestratorTask } from "../../src/background/orchestrator/types";

afterEach(() => vi.restoreAllMocks());

describe("execution budget warnings", () => {
  test("emits each crossed threshold once", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const task = {
      startedAt: 100,
      createdAt: 100,
      budget: {
        maxSessionTimeMs: 1_000,
        maxTotalTokens: 1_000,
        maxTotalCostUsd: 10,
      },
      sessionMetrics: { totalTokens: 800, totalCost: 8 },
    } as OrchestratorTask;
    const emitted = new Set<string>();
    const emitTrace = vi.fn();

    emitBudgetWarnings(task, emitted, emitTrace);
    emitBudgetWarnings(task, emitted, emitTrace);

    expect(emitTrace.mock.calls.map(([data]) => data.metric)).toEqual([
      "time",
      "tokens",
      "cost",
    ]);
    expect(emitTrace).toHaveBeenCalledTimes(3);
    expect(emitTrace).toHaveBeenCalledWith(
      expect.objectContaining({ metric: "time", ratio: 0.9, elapsedMs: 900 }),
    );
  });
});
