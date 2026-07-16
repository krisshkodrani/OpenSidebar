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

type PausePayload = Parameters<
  Parameters<BrowserTaskDeps["addPauseListener"]>[0]
>[1];

function deps(): BrowserTaskDeps & {
  fire: (ws: string, p: CompletionPayload) => void;
  firePause: (ws: string, p: PausePayload) => void;
  resolveApprovalReturns: (value: boolean) => void;
  started: Array<{ workspaceId: string; tabId: number }>;
  created: string[];
  navigated: Array<{ tabId: number; url: string }>;
  stopped: string[];
  resolved: Array<{ workspaceId: string; approvalId: string; approved: boolean }>;
  liveTabs: Set<number>;
} {
  const listeners = new Set<(ws: string, p: CompletionPayload) => void>();
  const pauseListeners = new Set<(ws: string, p: PausePayload) => void>();
  const started: Array<{ workspaceId: string; tabId: number }> = [];
  const created: string[] = [];
  const navigated: Array<{ tabId: number; url: string }> = [];
  const stopped: string[] = [];
  const resolved: Array<{
    workspaceId: string;
    approvalId: string;
    approved: boolean;
  }> = [];
  const liveTabs = new Set<number>();
  let nextTabId = 42;
  let resolveApprovalResult = true;
  return {
    started,
    created,
    navigated,
    stopped,
    resolved,
    liveTabs,
    fire(ws, p) {
      for (const fn of [...listeners]) fn(ws, p);
    },
    firePause(ws, p) {
      for (const fn of [...pauseListeners]) fn(ws, p);
    },
    resolveApprovalReturns(value) {
      resolveApprovalResult = value;
    },
    async createTab(url) {
      created.push(url);
      const tabId = nextTabId++;
      liveTabs.add(tabId);
      return tabId;
    },
    async tabExists(tabId) {
      return liveTabs.has(tabId);
    },
    async navigateTab(tabId, url) {
      navigated.push({ tabId, url });
    },
    async stopTask(workspaceId) {
      stopped.push(workspaceId);
    },
    resolveApproval(workspaceId, payload) {
      resolved.push({ workspaceId, ...payload });
      return resolveApprovalResult;
    },
    async startTask(input) {
      started.push({ workspaceId: input.workspaceId, tabId: input.tabId });
    },
    addCompletionListener(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    addPauseListener(fn) {
      pauseListeners.add(fn);
      return () => {
        pauseListeners.delete(fn);
      };
    },
  };
}

/** A TASK_PAUSED payload for an approval on workspace `ws`. */
function pausePayload(approvalId: string): PausePayload {
  return {
    taskId: "task-1",
    interaction: {
      kind: "approval",
      approvalId,
      toolName: "click_element",
      args: { id: 7 },
      context: "Submit the application",
      requestedAt: 1_700_000_000_000,
      timeoutMs: 600_000,
      expiresAt: 1_700_000_600_000,
    },
  };
}

/** Let queued microtasks + the runner's tab/start chain settle. */
const tick = () => new Promise((r) => setTimeout(r, 0));

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

describe("createBrowserAgentRunner sessions", () => {
  test("sessionless runs keep a fresh workspace and tab per call", async () => {
    const d = deps();
    const runner = createBrowserAgentRunner(d);

    const first = runner.run({ instruction: "a" });
    await tick();
    d.fire(d.started[0].workspaceId, { status: "completed" });
    await first;

    const second = runner.run({ instruction: "b" });
    await tick();
    d.fire(d.started[1].workspaceId, { status: "completed" });
    await second;

    expect(d.created).toHaveLength(2);
    expect(d.started[0].tabId).not.toBe(d.started[1].tabId);
    expect(d.started[0].workspaceId).not.toBe(d.started[1].workspaceId);
  });

  test("a second run on the same session reuses the workspace and tab", async () => {
    const d = deps();
    const runner = createBrowserAgentRunner(d);

    const first = runner.run({ instruction: "fill the form", url: "https://a.test", session: "s1" });
    await tick();
    d.fire(d.started[0].workspaceId, { status: "completed" });
    await first;

    const second = runner.run({ instruction: "submit the form", session: "s1" });
    await tick();
    d.fire(d.started[1].workspaceId, { status: "completed" });
    await second;

    expect(d.created).toHaveLength(1);
    expect(d.started[1].tabId).toBe(d.started[0].tabId);
    expect(d.started[1].workspaceId).toBe(d.started[0].workspaceId);
    // No url on the follow-up: the mission continues on the page as-is.
    expect(d.navigated).toHaveLength(0);
  });

  test("a url on a reused session navigates the existing tab instead of creating one", async () => {
    const d = deps();
    const runner = createBrowserAgentRunner(d);

    const first = runner.run({ instruction: "a", url: "https://a.test", session: "s1" });
    await tick();
    d.fire(d.started[0].workspaceId, { status: "completed" });
    await first;

    const second = runner.run({ instruction: "b", url: "https://b.test", session: "s1" });
    await tick();
    d.fire(d.started[1].workspaceId, { status: "completed" });
    await second;

    expect(d.created).toHaveLength(1);
    expect(d.navigated).toEqual([{ tabId: d.started[0].tabId, url: "https://b.test" }]);
  });

  test("a dead session tab falls back to a fresh tab but keeps the workspace", async () => {
    const d = deps();
    const runner = createBrowserAgentRunner(d);

    const first = runner.run({ instruction: "a", session: "s1" });
    await tick();
    d.fire(d.started[0].workspaceId, { status: "completed" });
    await first;

    d.liveTabs.delete(d.started[0].tabId); // user closed the tab

    const second = runner.run({ instruction: "b", session: "s1" });
    await tick();
    d.fire(d.started[1].workspaceId, { status: "completed" });
    await second;

    expect(d.created).toHaveLength(2);
    expect(d.started[1].tabId).not.toBe(d.started[0].tabId);
    expect(d.started[1].workspaceId).toBe(d.started[0].workspaceId);
  });

  test("concurrent runs on one session serialize: the second starts only after the first completes", async () => {
    const d = deps();
    const runner = createBrowserAgentRunner(d);

    const first = runner.run({ instruction: "a", session: "s1" });
    const second = runner.run({ instruction: "b", session: "s1" });
    await tick();

    // Mission B must not start while Mission A is live — starting on the same
    // workspace mid-run corrupts the orchestrator's task registration.
    expect(d.started).toHaveLength(1);

    d.fire(d.started[0].workspaceId, { status: "completed" });
    await first;
    await tick();

    expect(d.started).toHaveLength(2);
    d.fire(d.started[1].workspaceId, { status: "completed" });
    await second;
  });

  test("different sessions get independent workspaces and tabs", async () => {
    const d = deps();
    const runner = createBrowserAgentRunner(d);

    const first = runner.run({ instruction: "a", session: "s1" });
    const second = runner.run({ instruction: "b", session: "s2" });
    await tick();

    expect(d.started).toHaveLength(2);
    expect(d.started[0].workspaceId).not.toBe(d.started[1].workspaceId);
    expect(d.started[0].tabId).not.toBe(d.started[1].tabId);

    d.fire(d.started[0].workspaceId, { status: "completed" });
    d.fire(d.started[1].workspaceId, { status: "completed" });
    await Promise.all([first, second]);
  });
});

describe("createBrowserAgentRunner cancellation", () => {
  test("abort mid-run stops the workspace and settles via the stopped completion", async () => {
    const d = deps();
    const runner = createBrowserAgentRunner(d);
    const controller = new AbortController();

    const promise = runner.run({ instruction: "x", session: "s1" }, { signal: controller.signal });
    await tick();
    const ws = d.started[0].workspaceId;

    controller.abort();
    await tick();
    expect(d.stopped).toEqual([ws]);

    // The run settles through the normal completion path, not early — that is
    // what keeps the session queue blocked until the stop drain lands.
    d.fire(ws, { status: "stopped", terminationReason: "Stopped by user" });
    expect(await promise).toMatchObject({ status: "error", reason: "Stopped by user" });
  });

  test("abort before start resolves canceled without touching tabs or tasks", async () => {
    const d = deps();
    const runner = createBrowserAgentRunner(d);
    const controller = new AbortController();
    controller.abort();

    const outcome = await runner.run({ instruction: "x" }, { signal: controller.signal });

    expect(outcome).toEqual({ status: "error", reason: "canceled by caller" });
    expect(d.created).toHaveLength(0);
    expect(d.started).toHaveLength(0);
    expect(d.stopped).toHaveLength(0);
  });

  test("an abort landing while startTask is in flight still stops the task", async () => {
    const d = deps();
    let releaseStart: () => void = () => {};
    const gated: BrowserTaskDeps = {
      ...d,
      async startTask(input) {
        await new Promise<void>((r) => {
          releaseStart = r;
        });
        d.started.push({ workspaceId: input.workspaceId, tabId: input.tabId });
      },
    };
    const runner = createBrowserAgentRunner(gated);
    const controller = new AbortController();

    const promise = runner.run({ instruction: "x" }, { signal: controller.signal });
    await tick();

    // Abort while startTask is pending: nothing is registered yet, so this
    // stop is a no-op — the post-start re-check must issue another.
    controller.abort();
    await tick();
    releaseStart();
    await tick();

    expect(d.started).toHaveLength(1);
    const ws = d.started[0].workspaceId;
    // Two stop requests: the abort listener's (a no-op in production, nothing
    // registered yet) and the post-start re-check's — the one that counts.
    expect(d.stopped).toEqual([ws, ws]);

    d.fire(ws, { status: "stopped", terminationReason: "Stopped by user" });
    await promise;
  });

  test("abort after completion never calls stopTask", async () => {
    const d = deps();
    const runner = createBrowserAgentRunner(d);
    const controller = new AbortController();

    const promise = runner.run({ instruction: "x" }, { signal: controller.signal });
    await tick();
    d.fire(d.started[0].workspaceId, { status: "completed" });
    await promise;

    controller.abort();
    await tick();

    expect(d.stopped).toHaveLength(0);
  });
});

describe("createBrowserAgentRunner approval forwarding", () => {
  test("a pause on the run's workspace resolves needs_human with the approval", async () => {
    const d = deps();
    const runner = createBrowserAgentRunner(d);
    const promise = runner.run({ instruction: "apply", session: "s1" });
    await tick();
    const ws = d.started[0].workspaceId;

    d.firePause(ws, pausePayload("appr-1"));
    const outcome = await promise;

    expect(outcome.status).toBe("needs_human");
    expect(outcome.approval?.approvalId).toBe("appr-1");
    expect(outcome.approval?.context).toBe("Submit the application");
    expect(outcome.approval?.expiresAt).toBe(1_700_000_600_000);
  });

  test("respondApproval resolves the approval and returns the follow-up completion", async () => {
    const d = deps();
    const runner = createBrowserAgentRunner(d);
    const first = runner.run({ instruction: "apply", session: "s1" });
    await tick();
    const ws = d.started[0].workspaceId;
    d.firePause(ws, pausePayload("appr-1"));
    await first;

    const answer = runner.respondApproval!({
      tool: "browser_respond_approval",
      args: { approvalId: "appr-1", approved: true },
      session: "s1",
    });
    await tick();
    expect(d.resolved).toEqual([
      { workspaceId: ws, approvalId: "appr-1", approved: true },
    ]);

    // The resumed task completes.
    d.fire(ws, { status: "completed", summary: "submitted" });
    expect(await answer).toMatchObject({ status: "completed", summary: "submitted" });
  });

  test("respondApproval on an unknown approvalId errors immediately", async () => {
    const d = deps();
    const runner = createBrowserAgentRunner(d);
    const outcome = await runner.respondApproval!({
      tool: "browser_respond_approval",
      args: { approvalId: "nope", approved: true },
      session: "s1",
    });
    expect(outcome).toEqual({
      status: "error",
      reason: "no pending approval for that id",
    });
    expect(d.resolved).toHaveLength(0);
  });

  test("respondApproval errors fast (queue not blocked) when resolveApproval returns false", async () => {
    const d = deps();
    const runner = createBrowserAgentRunner(d);
    const first = runner.run({ instruction: "apply", session: "s1" });
    await tick();
    const ws = d.started[0].workspaceId;
    d.firePause(ws, pausePayload("appr-1"));
    await first;

    d.resolveApprovalReturns(false); // already answered / expired
    const outcome = await runner.respondApproval!({
      tool: "browser_respond_approval",
      args: { approvalId: "appr-1", approved: true },
      session: "s1",
    });
    expect(outcome.status).toBe("error");
    expect(outcome.reason).toContain("no pending approval");

    // Queue is free: a follow-up mission still starts.
    const next = runner.run({ instruction: "again", session: "s1" });
    await tick();
    expect(d.started).toHaveLength(2);
    d.fire(d.started[1].workspaceId, { status: "completed" });
    await next;
  });

  test("respondApproval joins the session queue — a queued mission waits for the resume", async () => {
    const d = deps();
    const runner = createBrowserAgentRunner(d);
    const first = runner.run({ instruction: "apply", session: "s1" });
    await tick();
    const ws = d.started[0].workspaceId;
    d.firePause(ws, pausePayload("appr-1"));
    await first;

    // Answer, then immediately queue a follow-up mission.
    const answer = runner.respondApproval!({
      tool: "browser_respond_approval",
      args: { approvalId: "appr-1", approved: true },
      session: "s1",
    });
    const queued = runner.run({ instruction: "next", session: "s1" });
    await tick();

    // The follow-up must NOT have started while the resume is in flight.
    expect(d.started).toHaveLength(1);

    d.fire(ws, { status: "completed", summary: "submitted" });
    await answer;
    await tick();
    expect(d.started).toHaveLength(2);
    d.fire(d.started[1].workspaceId, { status: "completed" });
    await queued;
  });

  test("a resumed task that pauses again yields a second needs_human + approval", async () => {
    const d = deps();
    const runner = createBrowserAgentRunner(d);
    const first = runner.run({ instruction: "apply", session: "s1" });
    await tick();
    const ws = d.started[0].workspaceId;
    d.firePause(ws, pausePayload("appr-1"));
    await first;

    const answer = runner.respondApproval!({
      tool: "browser_respond_approval",
      args: { approvalId: "appr-1", approved: true },
      session: "s1",
    });
    await tick();
    d.firePause(ws, pausePayload("appr-2"));
    const outcome = await answer;
    expect(outcome.approval?.approvalId).toBe("appr-2");
  });

  test("a sessionless respond resolves via the approvalId→workspace map", async () => {
    const d = deps();
    const runner = createBrowserAgentRunner(d);
    const first = runner.run({ instruction: "apply" }); // no session
    await tick();
    const ws = d.started[0].workspaceId;
    d.firePause(ws, pausePayload("appr-9"));
    await first;

    const answer = runner.respondApproval!({
      tool: "browser_respond_approval",
      args: { approvalId: "appr-9", approved: false },
    });
    await tick();
    expect(d.resolved).toEqual([
      { workspaceId: ws, approvalId: "appr-9", approved: false },
    ]);
    d.fire(ws, { status: "completed", summary: "refused and continued" });
    await answer;
  });
});
