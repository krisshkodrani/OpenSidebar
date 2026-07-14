import { describe, expect, test, vi } from "vitest";
import {
  createBrowserAgentRunner,
  mapCompletion,
  type BrowserTaskDeps,
  type CompletionPayload,
} from "../../src/background/browser-bridge/orchestrator-driver";
import type { PartialProgressHandoff } from "../../src/types";

/** Minimal handoff; only the fields these tests assert on are meaningful. */
function handoff(
  over: Partial<PartialProgressHandoff> = {},
): PartialProgressHandoff {
  return {
    schemaVersion: "2026-05-26",
    reason: "max_turns",
    status: "partial_handoff",
    task: "apply to the job",
    generatedAt: "2026-07-14T00:00:00.000Z",
    turnsUsed: 25,
    maxTurns: 25,
    completed: [],
    evidence: [],
    currentState: {},
    remaining: [],
    uncertainty: [],
    suggestedContinuationPrompt: "carry on from the review step",
    ...over,
  };
}

describe("mapCompletion", () => {
  test("completed → completed", () => {
    expect(mapCompletion({ status: "completed", summary: "done" })).toEqual({
      status: "completed",
      summary: "done",
      handoff: undefined,
    });
  });

  test("failed / stopped → error, with the termination reason", () => {
    expect(mapCompletion({ status: "failed" }).status).toBe("error");
    expect(
      mapCompletion({ status: "stopped", terminationReason: "Stopped by user" }),
    ).toMatchObject({ status: "error", reason: "Stopped by user" });
  });

  test("partial → needs_human, not error — it is progress, not breakage", () => {
    const h = handoff({
      uncertainty: [{ text: "how many years of Go?", confidence: "low" }],
    });

    const outcome = mapCompletion({
      status: "partial",
      summary: "filled 6 of 7 fields",
      partialHandoff: h,
    });

    expect(outcome.status).toBe("needs_human");
    expect(outcome.reason).toBe("how many years of Go?");
  });

  test("the handoff survives on every status", () => {
    const h = handoff();
    expect(mapCompletion({ status: "completed", partialHandoff: h }).handoff).toBe(h);
    expect(mapCompletion({ status: "partial", partialHandoff: h }).handoff).toBe(h);
    expect(mapCompletion({ status: "failed", partialHandoff: h }).handoff).toBe(h);
  });
});

function deps(): BrowserTaskDeps & {
  fire: (ws: string, p: CompletionPayload) => void;
  started: Array<{ workspaceId: string; tabId: number }>;
} {
  let listener: ((ws: string, p: CompletionPayload) => void) | null = null;
  const started: Array<{ workspaceId: string; tabId: number }> = [];
  return {
    started,
    fire(ws, p) {
      listener?.(ws, p);
    },
    async createTab() {
      return 42;
    },
    async startTask(input) {
      started.push({ workspaceId: input.workspaceId, tabId: input.tabId });
    },
    addCompletionListener(fn) {
      listener = fn;
      return () => {
        listener = null;
      };
    },
  };
}

describe("createBrowserAgentRunner", () => {
  test("opens a tab, starts the task, resolves on the correlated completion", async () => {
    const d = deps();
    const runner = createBrowserAgentRunner(d);
    const promise = runner.run({ instruction: "buy milk" });
    await new Promise((r) => setTimeout(r, 0));
    expect(d.started).toHaveLength(1);
    expect(d.started[0].tabId).toBe(42);
    const ws = d.started[0].workspaceId;

    d.fire(ws, { status: "completed", summary: "bought" });
    expect(await promise).toEqual({ status: "completed", summary: "bought" });
  });

  test("ignores completions for a different workspace", async () => {
    const d = deps();
    const runner = createBrowserAgentRunner(d);
    const promise = runner.run({ instruction: "x" });
    await new Promise((r) => setTimeout(r, 0));

    d.fire("some-other-workspace", { status: "completed" });
    let resolved = false;
    void promise.then(() => (resolved = true));
    await new Promise((r) => setTimeout(r, 0));
    expect(resolved).toBe(false);

    d.fire(d.started[0].workspaceId, { status: "completed" });
    await promise;
  });

  test("startTask failure resolves as a structured error", async () => {
    const d = deps();
    const failing: BrowserTaskDeps = {
      ...d,
      async startTask() {
        throw new Error("no tab");
      },
    };
    const runner = createBrowserAgentRunner(failing);
    expect(await runner.run({ instruction: "x" })).toEqual({
      status: "error",
      reason: "no tab",
    });
  });

  test("a completion that never arrives resolves rather than hanging", async () => {
    // The original failure mode: no completion, no timeout, promise pending
    // forever — the caller only ever found out via its own transport timeout.
    const d = { ...deps(), timeoutMs: 50 };
    const runner = createBrowserAgentRunner(d);

    const outcome = await runner.run({ instruction: "x" });

    expect(outcome.status).toBe("error");
    expect(outcome.reason).toContain("no task completion within 50ms");
  });

  test("a completion cancels the timeout", async () => {
    vi.useFakeTimers();
    try {
      const d = { ...deps(), timeoutMs: 50 };
      const runner = createBrowserAgentRunner(d);
      const promise = runner.run({ instruction: "x" });
      await vi.advanceTimersByTimeAsync(0);

      d.fire(d.started[0].workspaceId, { status: "completed", summary: "done" });
      await vi.advanceTimersByTimeAsync(200);

      expect(await promise).toMatchObject({ status: "completed", summary: "done" });
    } finally {
      vi.useRealTimers();
    }
  });
});
