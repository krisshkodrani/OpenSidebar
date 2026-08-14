import { describe, expect, test, vi } from "vitest";
import {
  createBrowserAgentRunner,
  mapCompletion,
  resolveBrowserAgentCredential,
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

describe("resolveBrowserAgentCredential", () => {
  test("uses the cloud relay sentinel for signed-in cloud inference", () => {
    expect(
      resolveBrowserAgentCredential(
        {
          providerMode: "openrouter",
          inferenceMode: "cloud",
          openRouterApiKey: "",
        } as never,
        "",
      ),
    ).toBe("__opensidebar_cloud__");
  });

  test("keeps the configured local provider credential in local mode", () => {
    expect(
      resolveBrowserAgentCredential(
        {
          providerMode: "openrouter",
          inferenceMode: "local",
          openRouterApiKey: "local-key",
        } as never,
        "local-key",
      ),
    ).toBe("local-key");
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
  grouped: Array<{ workspaceId: string; tabId: number }>;
  navigated: Array<{ tabId: number; url: string }>;
  stopped: string[];
  resolved: Array<{ workspaceId: string; approvalId: string; approved: boolean }>;
  liveTabs: Set<number>;
  matchingTabs: Array<{ tabId: number; pageTitle: string; groupTitle?: string; windowLabel?: string }>;
} {
  const listeners = new Set<(ws: string, p: CompletionPayload) => void>();
  const pauseListeners = new Set<(ws: string, p: PausePayload) => void>();
  const started: Array<{ workspaceId: string; tabId: number }> = [];
  const created: string[] = [];
  const grouped: Array<{ workspaceId: string; tabId: number }> = [];
  const navigated: Array<{ tabId: number; url: string }> = [];
  const stopped: string[] = [];
  const resolved: Array<{
    workspaceId: string;
    approvalId: string;
    approved: boolean;
  }> = [];
  const liveTabs = new Set<number>([8]);
  const matchingTabs = [{ tabId: 8, pageTitle: "Example Domain", windowLabel: "Window 1" }];
  let nextTabId = 42;
  let resolveApprovalResult = true;
  return {
    started,
    created,
    grouped,
    navigated,
    stopped,
    resolved,
    liveTabs,
    matchingTabs,
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
    async findWorkspaceTargets() {
      return [{
        workspaceId: "workspace-1",
        sourceTabId: 8,
        pageTitle: "OpenSidebar",
        groupTitle: "OpenSidebar 1",
        windowLabel: "Window 1",
      }];
    },
    async createTabInWorkspace(_sourceTabId, _workspaceId, url) {
      created.push(url);
      const tabId = nextTabId++;
      liveTabs.add(tabId);
      return tabId;
    },
    async getActiveTab() {
      return 7;
    },
    async findTabsByUrl(url) {
      return url === "https://example.com/" ? matchingTabs : [];
    },
    async tabExists(tabId) {
      return liveTabs.has(tabId);
    },
    async tabMatchesUrl(tabId, url) {
      return liveTabs.has(tabId) && url === "https://example.com/";
    },
    async navigateTab(tabId, url) {
      navigated.push({ tabId, url });
    },
    async verifyIsolatedWorkspace(tabId) {
      grouped.push({ workspaceId: "workspace-1", tabId });
      return {
        context: "isolated_tab",
        pageOrigin: "https://example.com",
        pageTitle: "Example Domain",
        expectedUrlMatched: true,
        windowLabel: "Window 1",
        workspaceTitle: "OpenSidebar 1",
        inWorkspace: true,
        sidePanelEnabled: true,
        createdForMission: true,
      };
    },
    async describeTarget(_tabId, context) {
      return {
        context,
        pageOrigin: "https://example.com",
        pageTitle: "Example Domain",
        expectedUrlMatched: true,
        windowLabel: "Window 1",
        workspaceTitle: "OpenSidebar 1",
        inWorkspace: true,
        sidePanelEnabled: true,
        createdForMission: false,
      };
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
    expect(d.grouped).toEqual([{ workspaceId: "workspace-1", tabId: 42 }]);

    d.fire(ws, { status: "completed", summary: "bought" });
    expect(await promise).toMatchObject({
      status: "completed",
      summary: "bought",
      target: {
        context: "isolated_tab",
        workspaceTitle: "OpenSidebar 1",
        inWorkspace: true,
        sidePanelEnabled: true,
        createdForMission: true,
      },
    });
  });

  test("does not start a newly opened task until its content bridge is ready", async () => {
    const d = deps();
    let releaseReady!: () => void;
    d.ensureTabReady = () =>
      new Promise<void>((resolve) => {
        releaseReady = resolve;
      });
    const runner = createBrowserAgentRunner(d);
    const promise = runner.run({ instruction: "read the heading", url: "https://example.com/" });
    await tick();
    expect(d.created).toEqual(["https://example.com/"]);
    expect(d.started).toHaveLength(0);
    releaseReady();
    await tick();
    expect(d.started).toHaveLength(1);
    d.fire(d.started[0]!.workspaceId, { status: "completed", summary: "Example Domain" });
    await expect(promise).resolves.toMatchObject({
      status: "completed",
      target: {
        context: "isolated_tab",
        pageTitle: "Example Domain",
        workspaceTitle: "OpenSidebar 1",
        sidePanelEnabled: true,
      },
    });
  });

  test("does not start an isolated task until its tab joins a workspace group", async () => {
    const d = deps();
    let releaseGroup!: () => void;
    d.verifyIsolatedWorkspace = () =>
      new Promise((resolve) => {
        releaseGroup = resolve;
      }).then(() => ({
        context: "isolated_tab" as const,
        inWorkspace: true,
        sidePanelEnabled: true,
        createdForMission: true,
      }));
    const runner = createBrowserAgentRunner(d);
    const promise = runner.run({
      instruction: "read the heading",
      url: "https://example.com/",
      targetContext: "isolated_tab",
    });
    await tick();
    expect(d.created).toEqual(["https://example.com/"]);
    expect(d.started).toHaveLength(0);
    releaseGroup();
    await tick();
    expect(d.started).toHaveLength(1);
    d.fire(d.started[0]!.workspaceId, {
      status: "completed",
      summary: "Example Domain",
    });
    await expect(promise).resolves.toMatchObject({ status: "completed" });
  });

  test("asks which existing workspace to join instead of guessing across groups", async () => {
    const d = deps();
    d.liveTabs.add(9);
    d.findWorkspaceTargets = async () => [
      {
        workspaceId: "workspace-1",
        sourceTabId: 8,
        pageTitle: "First page",
        groupTitle: "OpenSidebar 1",
        windowLabel: "Window 1",
      },
      {
        workspaceId: "workspace-2",
        sourceTabId: 9,
        pageTitle: "Second page",
        groupTitle: "OpenSidebar 2",
        windowLabel: "Window 2",
      },
    ];
    let selectedWorkspace = "";
    d.createTabInWorkspace = async (_sourceTabId, workspaceId, url) => {
      selectedWorkspace = workspaceId;
      d.created.push(url);
      d.liveTabs.add(42);
      return 42;
    };
    const runner = createBrowserAgentRunner(d);
    const task = {
      instruction: "read the heading",
      url: "https://example.com/",
      session: "mission-workspace",
      targetContext: "isolated_tab" as const,
    };

    const waiting = await runner.run(task);
    expect(waiting).toMatchObject({
      status: "needs_human",
      targetSelection: {
        candidates: [
          { groupTitle: "OpenSidebar 1", windowLabel: "Window 1" },
          { groupTitle: "OpenSidebar 2", windowLabel: "Window 2" },
        ],
      },
    });
    expect(d.started).toHaveLength(0);

    const targetHandle = waiting.targetSelection!.candidates[1]!.targetHandle;
    const resumed = runner.selectTarget!({ ...task, targetHandle });
    await tick();
    expect(selectedWorkspace).toBe("workspace-2");
    d.fire(d.started[0]!.workspaceId, { status: "completed", summary: "done" });
    await expect(resumed).resolves.toMatchObject({ status: "completed" });
  });

  test("refuses isolated execution when no OpenSidebar workspace exists", async () => {
    const d = deps();
    d.findWorkspaceTargets = async () => [];
    const outcome = await createBrowserAgentRunner(d).run({
      instruction: "read the heading",
      targetContext: "isolated_tab",
    });
    expect(outcome).toMatchObject({
      status: "error",
      reason: expect.stringContaining("No existing OpenSidebar workspace"),
    });
    expect(d.created).toHaveLength(0);
    expect(d.started).toHaveLength(0);
  });

  test("uses the existing active tab when a visible remote run requests it", async () => {
    const d = deps();
    const runner = createBrowserAgentRunner(d);
    const promise = runner.run({
      instruction: "read the heading",
      targetContext: "active_tab",
    });
    await tick();
    expect(d.created).toEqual([]);
    expect(d.grouped).toEqual([]);
    expect(d.started[0]?.tabId).toBe(7);
    d.fire(d.started[0]!.workspaceId, {
      status: "completed",
      summary: "Example Domain",
    });
    await expect(promise).resolves.toMatchObject({ status: "completed" });
  });

  test("binds a remote run to an already-open matching tab without navigation", async () => {
    const d = deps();
    const runner = createBrowserAgentRunner(d);
    const promise = runner.run({
      instruction: "read the heading",
      url: "https://example.com/",
      targetContext: "existing_tab",
    });
    await tick();
    expect(d.created).toEqual([]);
    expect(d.grouped).toEqual([]);
    expect(d.navigated).toEqual([]);
    expect(d.started[0]?.tabId).toBe(8);
    d.fire(d.started[0]!.workspaceId, {
      status: "completed",
      summary: "Example Domain",
    });
    await expect(promise).resolves.toMatchObject({
      status: "completed",
      target: {
        context: "existing_tab",
        pageTitle: "Example Domain",
        workspaceTitle: "OpenSidebar 1",
        sidePanelEnabled: true,
      },
    });
  });

  test("returns opaque choices for duplicate matches and resumes on the chosen tab", async () => {
    const d = deps();
    d.liveTabs.add(9);
    d.matchingTabs.push({
      tabId: 9,
      pageTitle: "Example Domain",
      groupTitle: "Personal",
      windowLabel: "Window 2",
    });
    const runner = createBrowserAgentRunner(d);
    const task = {
      instruction: "read the heading",
      url: "https://example.com/",
      session: "mission-1",
      targetContext: "existing_tab" as const,
    };
    const waiting = await runner.run(task);
    expect(waiting).toMatchObject({
      status: "needs_human",
      targetSelection: {
        candidates: [
          { pageTitle: "Example Domain", windowLabel: "Window 1" },
          { pageTitle: "Example Domain", groupTitle: "Personal", windowLabel: "Window 2" },
        ],
      },
    });
    expect(JSON.stringify(waiting.targetSelection)).not.toContain("tabId");
    expect(d.started).toHaveLength(0);

    const siblingHandle = waiting.targetSelection!.candidates[0]!.targetHandle;
    const targetHandle = waiting.targetSelection!.candidates[1]!.targetHandle;
    const resumed = runner.selectTarget!({ ...task, targetHandle });
    await tick();
    expect(d.started[0]?.tabId).toBe(9);
    d.fire(d.started[0]!.workspaceId, { status: "completed", summary: "Example Domain" });
    await expect(resumed).resolves.toMatchObject({ status: "completed" });
    await expect(runner.selectTarget!({ ...task, targetHandle: siblingHandle })).resolves.toMatchObject({
      status: "error",
      reason: "The selected browser target expired or is no longer open.",
    });
  });

  test("rejects a target handle when the selected tab is no longer valid", async () => {
    const d = deps();
    d.liveTabs.add(9);
    d.matchingTabs.push({ tabId: 9, pageTitle: "Example Domain", windowLabel: "Window 2" });
    const runner = createBrowserAgentRunner(d);
    const task = {
      instruction: "read the heading",
      url: "https://example.com/",
      session: "mission-stale",
      targetContext: "existing_tab" as const,
    };
    const waiting = await runner.run(task);
    const targetHandle = waiting.targetSelection!.candidates[1]!.targetHandle;
    d.liveTabs.delete(9);
    await expect(runner.selectTarget!({ ...task, targetHandle })).resolves.toMatchObject({
      status: "error",
      reason: "The selected browser target expired or is no longer open.",
    });
    expect(d.started).toHaveLength(0);
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
    expect(await runner.run({ instruction: "x" })).toMatchObject({
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
  test("sessionless isolated runs keep fresh tabs in the same existing workspace", async () => {
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
    expect(d.started[0].workspaceId).toBe("workspace-1");
    expect(d.started[1].workspaceId).toBe("workspace-1");
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

  test("different sessions get independent tabs in the selected existing workspace", async () => {
    const d = deps();
    const runner = createBrowserAgentRunner(d);

    const first = runner.run({ instruction: "a", session: "s1" });
    const second = runner.run({ instruction: "b", session: "s2" });
    await tick();

    expect(d.started).toHaveLength(2);
    expect(d.started[0].workspaceId).toBe("workspace-1");
    expect(d.started[1].workspaceId).toBe("workspace-1");
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

  test("a changed local site policy overrides remote approval", async () => {
    const d = deps();
    d.validateApprovalContext = vi.fn().mockResolvedValue(false);
    const runner = createBrowserAgentRunner(d);
    const first = runner.run({ instruction: "apply", session: "s1" });
    await tick();
    const ws = d.started[0].workspaceId;
    d.firePause(ws, pausePayload("appr-policy"));
    await first;

    const answer = runner.respondApproval!({
      tool: "browser_respond_approval",
      args: { approvalId: "appr-policy", approved: true },
      session: "s1",
    });
    await tick();
    expect(d.resolved).toEqual([
      { workspaceId: ws, approvalId: "appr-policy", approved: false },
    ]);
    d.fire(ws, { status: "stopped", terminationReason: "Approval denied" });
    await expect(answer).resolves.toEqual({
      status: "error",
      reason: "Remote approval was denied by the current local site policy.",
    });
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
