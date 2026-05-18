import { describe, expect, test, vi } from "vitest";
import "../setup";
import { PassiveMonitorController } from "../../src/background/passive-monitor";
import {
  MessageSource,
  type DomSnapshot,
  type PassiveInputSource,
  type RuntimeMessage,
  type UserSettings,
} from "../../src/types";
import type {
  BrowserPagePort,
  ContentBridgePort,
} from "../../src/background/environment";

const baseSettings: UserSettings = {
  openRouterApiKey: "",
  maxTurns: 30,
  theme: "system",
  showSessionMetrics: false,
  requireApprovals: true,
  allowNavigation: true,
};

function snapshot(question: string): DomSnapshot {
  return {
    title: "Practice Quiz",
    url: "https://example.com/quiz",
    elements: [
      {
        tag: 1,
        tagName: "button",
        role: "button",
        text: question,
        attributes: {},
        rect: { x: 0, y: 0, width: 100, height: 32 },
        isVisible: true,
        isDisabled: false,
      },
    ],
    visibleContent: question,
    pageContent: question,
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
  };
}

function createHarness(
  options: {
    snapshots?: DomSnapshot[];
    tab?: { active?: boolean; url?: string; windowId?: number };
    settings?: UserSettings;
    activeWorkspace?: boolean;
    autoSchedule?: boolean;
    now?: () => number;
    setTimeoutFn?: typeof setTimeout;
    clearTimeoutFn?: typeof clearTimeout;
  } = {},
) {
  const snapshots = [...(options.snapshots ?? [snapshot("Question A")])];
  const broadcasts: RuntimeMessage[] = [];
  const pageActivity = vi.fn();
  const captureVisibleTab = vi.fn(async () => "data:image/jpeg;base64,screen");
  const pagePort: BrowserPagePort = {
    getTab: vi.fn(async () => ({
      id: 123,
      url: options.tab?.url ?? "https://example.com/quiz",
      title: "Practice Quiz",
      active: options.tab?.active ?? true,
      windowId: options.tab?.windowId ?? 1,
    })),
    queryTabs: vi.fn(async () => []),
    updateTab: vi.fn(async () => ({ id: 123 })),
    createTab: vi.fn(async () => ({ id: 456 })),
    removeTab: vi.fn(async () => {}),
    reloadTab: vi.fn(async () => {}),
    captureVisibleTab,
  };
  const contentPort: ContentBridgePort = {
    sendMessage: vi.fn(async (_tabId: number, message: any) => {
      if (message.type === "DOM_READY_PROBE") {
        return {
          type: "DOM_READY_ACK",
          requestId: message.requestId,
          source: MessageSource.CONTENT,
          payload: { ready: true },
        };
      }
      if (message.type === "DOM_SNAPSHOT_REQUEST") {
        return {
          type: "DOM_SNAPSHOT_RESPONSE",
          requestId: message.requestId,
          source: MessageSource.CONTENT,
          payload: {
            snapshot: snapshots.shift() ?? snapshot("Question A"),
            durationMs: 1,
          },
        };
      }
      throw new Error(`Unexpected content message ${message.type}`);
    }),
    executeContentScripts: vi.fn(async () => {}),
    getContentScriptFiles: vi.fn(() => []),
    onContentScriptReady: vi.fn(() => () => {}),
    onTabRemoved: vi.fn(() => () => {}),
    onBeforeNavigate: vi.fn(() => () => {}),
  };
  const evaluate = vi.fn(async () => ({
    shouldPost: true,
    answer: "Answer from watcher",
    confidence: "high" as const,
    evidence: ["Question changed"],
    reason: "new_question",
  }));
  const controller = new PassiveMonitorController({
    pagePort,
    contentPort,
    loadSettings: async () => options.settings ?? baseSettings,
    evaluate,
    broadcast: (message) => {
      broadcasts.push(message);
    },
    pageActivity,
    isWorkspaceActive: () => options.activeWorkspace ?? false,
    autoSchedule: options.autoSchedule ?? false,
    now: options.now ?? (() => 1000 + broadcasts.length),
    setTimeoutFn: options.setTimeoutFn,
    clearTimeoutFn: options.clearTimeoutFn,
  });

  return {
    controller,
    broadcasts,
    pageActivity,
    evaluate,
    contentPort,
    pagePort,
    captureVisibleTab,
  };
}

async function start(
  controller: PassiveMonitorController,
  inputSources: PassiveInputSource[] = ["page"],
) {
  return controller.startSession({
    tabId: 123,
    workspaceId: "ws-1",
    instructions: "Help me answer when the visible question changes.",
    inputSources,
    minIntervalMs: 1500,
  });
}

describe("PassiveMonitorController", () => {
  test("starts and stops a workspace-scoped session", async () => {
    const { controller, broadcasts, pageActivity } = createHarness();

    const result = await start(controller);
    expect(result.ok).toBe(true);
    expect(controller.hasSession("ws-1")).toBe(true);
    expect(broadcasts[0]).toMatchObject({
      type: "PASSIVE_MONITOR_STATUS",
      workspaceId: "ws-1",
      payload: { status: "watching" },
    });
    expect(pageActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: 123,
        workspaceId: "ws-1",
        active: true,
        status: "watching",
      }),
    );

    expect(controller.stopSession("ws-1")).toBe(true);
    expect(controller.hasSession("ws-1")).toBe(false);
    expect(broadcasts.at(-1)).toMatchObject({
      type: "PASSIVE_MONITOR_STATUS",
      payload: { status: "stopped" },
    });
    expect(pageActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tabId: 123,
        workspaceId: "ws-1",
        active: false,
        status: "stopped",
      }),
    );
  });

  test("starts its immediate scheduled observation without unbound timer invocation", async () => {
    let timerCalls = 0;
    const setTimeoutFn = vi.fn(function (
      this: unknown,
      callback: () => void,
    ) {
      if (this !== undefined) throw new TypeError("Illegal invocation");
      timerCalls += 1;
      if (timerCalls === 1) callback();
      return timerCalls as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    const clearTimeoutFn = vi.fn(function (this: unknown) {
      if (this !== undefined) throw new TypeError("Illegal invocation");
    }) as unknown as typeof clearTimeout;
    const { controller, evaluate } = createHarness({
      autoSchedule: true,
      setTimeoutFn,
      clearTimeoutFn,
    });

    const result = await start(controller);

    expect(result.ok).toBe(true);
    await vi.waitFor(() => expect(evaluate).toHaveBeenCalledTimes(1));
  });

  test("does not evaluate again when the page fingerprint is unchanged", async () => {
    const { controller, evaluate, broadcasts } = createHarness({
      snapshots: [snapshot("Question A"), snapshot("Question A")],
    });
    await start(controller);

    await controller.evaluateNow("ws-1");
    await controller.evaluateNow("ws-1");

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(
      broadcasts.filter(
        (message) => message.type === "PASSIVE_MONITOR_SUGGESTION",
      ),
    ).toHaveLength(1);
  });

  test("re-evaluates an unchanged page after the unchanged snapshot TTL expires", async () => {
    let now = 1_000;
    const { controller, evaluate, broadcasts } = createHarness({
      snapshots: [
        snapshot("Question A"),
        snapshot("Question A"),
        snapshot("Question A"),
      ],
      now: () => now,
    });
    await start(controller);

    await controller.evaluateNow("ws-1");
    now += 59_000;
    await controller.evaluateNow("ws-1");
    now += 2_000;
    await controller.evaluateNow("ws-1");

    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(
      broadcasts.filter(
        (message) => message.type === "PASSIVE_MONITOR_SUGGESTION",
      ),
    ).toHaveLength(2);
  });

  test("posts a new passive suggestion when the page fingerprint changes", async () => {
    const { controller, evaluate, broadcasts } = createHarness({
      snapshots: [snapshot("Question A"), snapshot("Question B")],
    });
    await start(controller);

    await controller.evaluateNow("ws-1");
    await controller.evaluateNow("ws-1");

    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(
      broadcasts.filter(
        (message) => message.type === "PASSIVE_MONITOR_SUGGESTION",
      ),
    ).toHaveLength(2);
  });

  test("blocks observations on URLs denied by site access settings", async () => {
    const { controller, evaluate, contentPort, broadcasts, pageActivity } = createHarness({
      tab: { url: "https://blocked.example/quiz" },
      settings: {
        ...baseSettings,
        siteAccessMode: "blocklist",
        siteAccessBlocklist: ["blocked.example"],
      },
    });
    await start(controller);

    await controller.evaluateNow("ws-1");

    expect(evaluate).not.toHaveBeenCalled();
    expect(contentPort.sendMessage).not.toHaveBeenCalled();
    expect(broadcasts.at(-1)).toMatchObject({
      type: "PASSIVE_MONITOR_STATUS",
      payload: { status: "blocked" },
    });
    expect(pageActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        active: false,
        status: "blocked",
      }),
    );
  });

  test("pauses while another agent task is active in the same workspace", async () => {
    const { controller, evaluate, contentPort, broadcasts } = createHarness({
      activeWorkspace: true,
    });
    await start(controller);

    await controller.evaluateNow("ws-1");

    expect(evaluate).not.toHaveBeenCalled();
    expect(contentPort.sendMessage).not.toHaveBeenCalled();
    expect(broadcasts.at(-1)).toMatchObject({
      type: "PASSIVE_MONITOR_STATUS",
      payload: { status: "paused" },
    });
  });

  test("does not post an in-flight suggestion after the monitor is paused", async () => {
    const { controller, evaluate, broadcasts } = createHarness();
    evaluate.mockImplementationOnce(async () => {
      controller.pauseSession(
        "ws-1",
        "Paused while an active agent task runs in this workspace.",
      );
      return {
        shouldPost: true,
        answer: "Late answer",
        confidence: "high" as const,
        evidence: ["Visible change"],
        reason: "new_question",
      };
    });
    await start(controller);

    await controller.evaluateNow("ws-1");

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(
      broadcasts.filter(
        (message) => message.type === "PASSIVE_MONITOR_SUGGESTION",
      ),
    ).toHaveLength(0);
    expect(broadcasts.at(-1)).toMatchObject({
      type: "PASSIVE_MONITOR_STATUS",
      payload: { status: "paused" },
    });
  });

  test("does not capture the screen when the watched tab is not visible", async () => {
    const { controller, evaluate, captureVisibleTab } = createHarness({
      tab: { active: false },
    });
    await start(controller, ["page", "screenshot"]);

    await controller.evaluateNow("ws-1");

    expect(captureVisibleTab).not.toHaveBeenCalled();
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  test("passes tab audio transcript context to passive evaluator", async () => {
    const { controller, evaluate } = createHarness();
    await start(controller, ["page", "tabAudio"]);
    expect(
      controller.updateAudioTranscript("ws-1", {
        source: "tabAudio",
        text: "The presenter said revenue increased by twelve percent.",
        startedAt: 1000,
        endedAt: 2000,
        chunkCount: 1,
      }),
    ).toBe(true);

    await controller.evaluateNow("ws-1");

    expect(evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        audioTranscript: expect.objectContaining({
          text: "The presenter said revenue increased by twelve percent.",
          source: "tabAudio",
        }),
      }),
    );
  });

  test("does not evaluate after a session has been stopped", async () => {
    const { controller, evaluate } = createHarness();
    await start(controller);
    controller.stopSession("ws-1");

    await controller.evaluateNow("ws-1");

    expect(evaluate).not.toHaveBeenCalled();
  });
});
