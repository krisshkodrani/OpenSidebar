/**
 * Page-opened (_blank) tab adoption + surfacing to the executor model.
 *
 * Covers the 2026-07-11 multi-tab reliability fix: a click on a target=_blank
 * link used to create a tab the runtime never tracked — the effect tracker
 * scored the click as a no-op, the model was told its click "did nothing",
 * and the tab-management gate blocked switch_tab so the spawned tabs were
 * unreachable. These tests pin the three layers of the fix:
 *   1. WorkspaceManager adopts page-created navigation targets whose source
 *      tab belongs to a workspace.
 *   2. surfaceSpawnedTabs drains the queue into a model-visible note.
 *   3. The spawned-tab latch unlocks the tab-management tool gate, and the
 *      context renders a standing "## Open Tabs" section when multi-tab.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import "../setup";

import { WorkspaceManager } from "../../src/background/workspaces/manager";
import { ContextManager } from "../../src/background/agent/context";
import { tabManagementBlocked } from "../../src/background/agent/loop-tool-handlers";
import type { AgentLoopToolHandlerHost } from "../../src/background/agent/loop-tool-handlers";

// LP-21: page state moved out of the system message into a trailing user
// message, so content assertions join the whole rendered prompt.
function renderedPrompt(prompt: { content?: unknown }[]): string {
  return prompt
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("\n");
}

const WS_STORAGE = {
  "opensidebar:workspaces": [
    {
      id: "ws1",
      name: "OpenSidebar 1",
      tabIds: [10],
      color: "blue",
      tabGroupId: null,
    },
  ],
  "opensidebar:nextWorkspaceNum": 2,
};

describe("WorkspaceManager page-opened tab adoption", () => {
  let consoleSpy: any;
  let groupSpy: any;
  let groupEndSpy: any;
  let capturedNavigationTarget:
    | ((
        details: chrome.webNavigation.WebNavigationSourceCallbackDetails,
      ) => void)
    | null;
  let originalNavigationTarget: unknown;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    groupSpy = vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    groupEndSpy = vi.spyOn(console, "groupEnd").mockImplementation(() => {});
    capturedNavigationTarget = null;
    originalNavigationTarget = (globalThis.chrome.webNavigation as any)
      .onCreatedNavigationTarget;
    (globalThis.chrome.webNavigation as any).onCreatedNavigationTarget = {
      addListener: (
        fn: (
          details: chrome.webNavigation.WebNavigationSourceCallbackDetails,
        ) => void,
      ) => {
        capturedNavigationTarget = fn;
      },
      removeListener: () => {},
    };
  });

  afterEach(async () => {
    (globalThis.chrome.webNavigation as any).onCreatedNavigationTarget =
      originalNavigationTarget;
    consoleSpy?.mockRestore();
    groupSpy?.mockRestore();
    groupEndSpy?.mockRestore();
    await new Promise((r) => setTimeout(r, 100));
  });

  async function buildManager(): Promise<WorkspaceManager> {
    const manager = new WorkspaceManager({
      isContentScript: () => false,
      storageLocal: {
        // Deep-clone: the manager mutates workspace objects in place, and a
        // shared fixture would leak tab adoptions across tests.
        get: async () => JSON.parse(JSON.stringify(WS_STORAGE)),
        set: async () => {},
      },
    });
    await new Promise((r) => setTimeout(r, 50));
    return manager;
  }

  test("adopts a tab whose openerTabId belongs to a workspace and queues it", async () => {
    const manager = await buildManager();
    expect(capturedNavigationTarget).not.toBeNull();

    capturedNavigationTarget!({
      tabId: 42,
      sourceTabId: 10,
      url: "http://127.0.0.1/ashby-job-application?job=sr-fe-1",
    } as chrome.webNavigation.WebNavigationSourceCallbackDetails);
    await new Promise((r) => setTimeout(r, 50));

    const ws = await manager.getWorkspaceById("ws1");
    expect(ws?.tabIds).toContain(42);

    const drained = manager.drainSpawnedTabs("ws1");
    expect(drained).toHaveLength(1);
    expect(drained[0]).toMatchObject({
      tabId: 42,
      openerTabId: 10,
      workspaceId: "ws1",
      url: "http://127.0.0.1/ashby-job-application?job=sr-fe-1",
    });

    // Drain clears the queue.
    expect(manager.drainSpawnedTabs("ws1")).toHaveLength(0);
  });

  test("ensureTrackingWorkspace anchors synthetic run ids so adoption works end-to-end", async () => {
    const manager = await buildManager();

    // e2e/integration runs mint their own workspaceId with no side-panel
    // workspace behind it — without this anchor, adoption never matches.
    await manager.ensureTrackingWorkspace("e2e-run-1", 70);
    const ws = await manager.getWorkspaceById("e2e-run-1");
    expect(ws?.tabIds).toEqual([70]);
    expect(ws?.tabGroupId).toBeNull();

    // Idempotent + accumulates the same run's tabs.
    await manager.ensureTrackingWorkspace("e2e-run-1", 70);
    await manager.ensureTrackingWorkspace("e2e-run-1", 71);
    expect((await manager.getWorkspaceById("e2e-run-1"))?.tabIds).toEqual([
      70, 71,
    ]);

    // "default" is the no-workspace sentinel — never materialized.
    await manager.ensureTrackingWorkspace("default", 70);
    expect(await manager.getWorkspaceById("default")).toBeNull();

    // A tab owned by a real workspace keeps its owner.
    await manager.ensureTrackingWorkspace("e2e-run-2", 10);
    expect(await manager.getWorkspaceById("e2e-run-2")).toBeNull();

    // The anchored run now adopts page-opened tabs.
    capturedNavigationTarget!({
      tabId: 72,
      sourceTabId: 70,
      url: "http://x/detail",
    } as chrome.webNavigation.WebNavigationSourceCallbackDetails);
    await new Promise((r) => setTimeout(r, 50));
    expect(
      (await manager.getWorkspaceById("e2e-run-1"))?.tabIds,
    ).toContain(72);
    expect(manager.drainSpawnedTabs("e2e-run-1")).toHaveLength(1);
  });

  test("ignores page-created targets whose source tab is outside the workspace", async () => {
    const manager = await buildManager();

    capturedNavigationTarget!({
      tabId: 44,
      sourceTabId: 999,
      url: "http://x/b",
    } as chrome.webNavigation.WebNavigationSourceCallbackDetails);
    await new Promise((r) => setTimeout(r, 50));

    const ws = await manager.getWorkspaceById("ws1");
    expect(ws?.tabIds).toEqual([10]);
    expect(manager.drainSpawnedTabs("ws1")).toHaveLength(0);
  });
});

describe("surfaceSpawnedTabs", () => {
  test("posts a model-visible note, latches the context, and reports the count", async () => {
    vi.resetModules();
    vi.doMock("../../src/background/workspaces/manager", () => ({
      workspaceManager: {
        drainSpawnedTabs: vi.fn(() => [
          {
            tabId: 777,
            openerTabId: 10,
            workspaceId: "ws1",
            url: "http://127.0.0.1/ashby-job-application?job=sr-fe-1",
            createdAt: 0,
          },
        ]),
      },
    }));
    const { surfaceSpawnedTabs } = await import(
      "../../src/background/agent/spawned-tab-surfacing"
    );

    const messages: Array<{ role: string; content: string }> = [];
    let latched = false;
    const traceEvents: Array<{ name: string; data?: unknown }> = [];
    const host = {
      turnCount: 7,
      context: {
        addMessage: (m: { role: "user"; content: string }) => {
          messages.push(m);
        },
        noteSpawnedTabs: () => {
          latched = true;
        },
        setOpenTabs: () => {},
      },
      log: { info: () => {} },
      traceRecorder: {
        recordEvent: (name: string, data?: Record<string, unknown>) => {
          traceEvents.push({ name, data });
        },
      },
    };

    const count = await surfaceSpawnedTabs(host, "ws1");

    expect(count).toBe(1);
    expect(latched).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain("opened a NEW browser tab");
    expect(messages[0].content).toContain("Tab 777");
    expect(messages[0].content).toContain("switch_tab");
    expect(traceEvents.map((e) => e.name)).toContain(
      "page_opened_tab_adopted",
    );

    vi.doUnmock("../../src/background/workspaces/manager");
    vi.resetModules();
  });

  test("no-ops for the default workspace and when nothing was spawned", async () => {
    vi.resetModules();
    const drain = vi.fn(() => []);
    vi.doMock("../../src/background/workspaces/manager", () => ({
      workspaceManager: { drainSpawnedTabs: drain },
    }));
    const { surfaceSpawnedTabs } = await import(
      "../../src/background/agent/spawned-tab-surfacing"
    );
    const host = {
      turnCount: 1,
      context: {
        addMessage: () => {
          throw new Error("should not message");
        },
        noteSpawnedTabs: () => {
          throw new Error("should not latch");
        },
        setOpenTabs: () => {},
      },
      log: { info: () => {} },
      traceRecorder: null,
    };

    expect(await surfaceSpawnedTabs(host, null)).toBe(0);
    expect(await surfaceSpawnedTabs(host, "default")).toBe(0);
    expect(await surfaceSpawnedTabs(host, "ws1")).toBe(0);
    expect(drain).toHaveBeenCalledWith("ws1");

    vi.doUnmock("../../src/background/workspaces/manager");
    vi.resetModules();
  });
});

describe("tab-management gate spawned-tab unlock", () => {
  const gatedLoop = (hasSpawned: boolean) =>
    ({
      context: { hasSpawnedTabs: () => hasSpawned },
      shouldBlockTabManagementTools: () => true,
    }) as unknown as AgentLoopToolHandlerHost;

  test("stays blocked without spawned tabs", () => {
    expect(tabManagementBlocked(gatedLoop(false))).toBe(true);
  });

  test("unlocks once a page action spawned a workspace tab", () => {
    expect(tabManagementBlocked(gatedLoop(true))).toBe(false);
  });
});

describe("tool-profile spawned-tab unlock", () => {
  test("switch_tab/list_tabs survive step-profile filtering once a tab was spawned", async () => {
    const { applyToolProfile } = await import(
      "../../src/background/agent/loop-skill-tools"
    );
    const def = (name: string) =>
      ({ type: "function", function: { name, parameters: {} } }) as any;
    const tools = [
      def("click_element"),
      def("type_text"),
      def("switch_tab"),
      def("list_tabs"),
      def("done"),
    ];
    const buildLoop = (hasSpawned: boolean) =>
      ({
        context: {
          getPlanStatusRaw: () => ({
            subtasks: [
              {
                status: "running",
                description: "Fill the application form",
                toolProfile: "form_fill",
              },
            ],
          }),
          getSnapshot: () => null,
          hasSpawnedTabs: () => hasSpawned,
        },
        limits: { stepWarnTurns: 99 },
        log: { info: () => {} },
        originalQuery: "fill the form",
        planSteps: [{}],
        planSubtasks: [
          { description: "Fill the application form", toolProfile: "form_fill" },
        ],
        selectedSkillId: null,
        turnCount: 3,
        turnsOnCurrentStep: 0,
      }) as any;

    const withoutSpawn = applyToolProfile(buildLoop(false), tools).map(
      (t: any) => t.function.name,
    );
    expect(withoutSpawn).not.toContain("switch_tab");
    expect(withoutSpawn).not.toContain("list_tabs");

    const withSpawn = applyToolProfile(buildLoop(true), tools).map(
      (t: any) => t.function.name,
    );
    expect(withSpawn).toContain("switch_tab");
    expect(withSpawn).toContain("list_tabs");
    expect(withSpawn).toContain("click_element");
  });
});

describe("ContextManager open-tab inventory", () => {
  test("renders the Open Tabs section with a current-tab marker at 2+ tabs", () => {
    const context = new ContextManager();
    context.setOpenTabs(
      [
        { tabId: 10, title: "TechJobs Board", url: "http://x/job-board" },
        {
          tabId: 42,
          title: "Application — Nextera",
          url: "http://x/ashby-job-application?job=sr-fe-1",
        },
      ],
      42,
    );
    const prompt = context.getPrompt();
    const system = renderedPrompt(prompt);
    expect(system).toContain("## Open Tabs (workspace)");
    expect(system).toContain('Tab 10: "TechJobs Board" — http://x/job-board');
    expect(system).toContain("Tab 42:");
    expect(system).toContain("← CURRENT TAB");
    // Marker sits on the current tab's line, not the other one.
    const markerLine = system
      .split("\n")
      .find((line) => line.includes("← CURRENT TAB"));
    expect(markerLine).toContain("Tab 42");
  });

  test("renders nothing for single-tab workspaces", () => {
    const context = new ContextManager();
    context.setOpenTabs(
      [{ tabId: 10, title: "Only Tab", url: "http://x/" }],
      10,
    );
    const system = renderedPrompt(context.getPrompt());
    expect(system).not.toContain("## Open Tabs");
    expect(system).not.toContain("{{openTabs}}");
  });

  test("spawned-tab latch starts false and latches on", () => {
    const context = new ContextManager();
    expect(context.hasSpawnedTabs()).toBe(false);
    context.noteSpawnedTabs();
    expect(context.hasSpawnedTabs()).toBe(true);
  });
});
