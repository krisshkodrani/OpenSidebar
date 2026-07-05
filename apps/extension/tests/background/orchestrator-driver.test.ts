import { describe, expect, test, vi } from "vitest";
import {
  createBrowserAgentRunner,
  mapCompletion,
  type BrowserTaskDeps,
  type CompletionPayload,
} from "../../src/background/browser-bridge/orchestrator-driver";

describe("mapCompletion", () => {
  test("completed → ok; anything else → error", () => {
    expect(mapCompletion({ status: "completed", summary: "done" })).toEqual({
      status: "completed",
      summary: "done",
    });
    expect(mapCompletion({ status: "failed" }).status).toBe("error");
    expect(mapCompletion({ status: "stopped" }).status).toBe("error");
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
});
