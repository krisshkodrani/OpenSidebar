/**
 * Headless runtime smoke (RFC LP-15, Phase 5).
 *
 * Proves createAgentRuntime drives its task + completion seam over a fake
 * RuntimeEnvironment with NO chrome present. chrome is deleted for the duration
 * of the exercised path (a canary): if any touched code reached for chrome.*,
 * this would throw.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "../setup";
import { createAgentRuntime } from "../../src/background/runtime";
import { createFakeEnvironment } from "../fakes/environment";
import type { OrchestratorStartInput } from "../../src/background/orchestrator/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test global juggling
let savedChrome: any;

beforeEach(() => {
  savedChrome = (globalThis as any).chrome;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).chrome;
});

afterEach(() => {
  (globalThis as any).chrome = savedChrome;
});

describe("headless agent runtime", () => {
  test("chrome is absent for the exercised path (canary)", () => {
    expect((globalThis as { chrome?: unknown }).chrome).toBeUndefined();
  });

  test("startTask delegates to the injected orchestrator", async () => {
    const { env } = createFakeEnvironment();
    const started: OrchestratorStartInput[] = [];
    const runtime = createAgentRuntime(env, {
      orchestrator: {
        startTask: async (input) => {
          started.push(input);
        },
        stopTask: async () => {},
        resolveApprovalResponse: () => true,
      },
    });

    const input = {
      query: "book a table",
      tabId: 1,
      workspaceId: "ws-1",
      settings: {},
      openRouterApiKey: "",
    } as unknown as OrchestratorStartInput;
    await runtime.startTask(input);

    expect(started).toEqual([input]);
    runtime.dispose();
  });

  test("stopTask delegates to the injected orchestrator with the workspaceId", async () => {
    const { env } = createFakeEnvironment();
    const stopped: Array<string | undefined> = [];
    const runtime = createAgentRuntime(env, {
      orchestrator: {
        startTask: async () => {},
        stopTask: async (workspaceId) => {
          stopped.push(workspaceId);
        },
      },
    });

    await runtime.stopTask("ws-9");
    await runtime.stopTask();

    expect(stopped).toEqual(["ws-9", undefined]);
    runtime.dispose();
  });

  test("resolveApproval delegates to orchestrator.resolveApprovalResponse", () => {
    const { env } = createFakeEnvironment();
    const calls: Array<{ payload: unknown; workspaceId?: string }> = [];
    const runtime = createAgentRuntime(env, {
      orchestrator: {
        startTask: async () => {},
        stopTask: async () => {},
        resolveApprovalResponse: (payload, workspaceId) => {
          calls.push({ payload, workspaceId });
          return true;
        },
      },
    });

    const ok = runtime.resolveApproval("ws-1", { approvalId: "a1", approved: true });

    expect(ok).toBe(true);
    expect(calls).toEqual([
      { payload: { approvalId: "a1", approved: true }, workspaceId: "ws-1" },
    ]);
    runtime.dispose();
  });

  test("onTaskPaused fires from a TASK_PAUSED on the messaging port, filtered by type", () => {
    const { env, messaging } = createFakeEnvironment();
    const runtime = createAgentRuntime(env, {
      orchestrator: {
        startTask: async () => {},
        stopTask: async () => {},
        resolveApprovalResponse: () => true,
      },
    });

    const pauses: Array<{ workspaceId: string; payload: unknown }> = [];
    runtime.onTaskPaused((workspaceId, payload) =>
      pauses.push({ workspaceId, payload }),
    );

    messaging.deliver({ type: "TASK_COMPLETION", workspaceId: "ws-1", payload: {} });
    messaging.deliver({
      type: "TASK_PAUSED",
      workspaceId: "ws-1",
      payload: { taskId: "t1", interaction: { kind: "approval", approvalId: "a1" } },
    });

    expect(pauses).toEqual([
      {
        workspaceId: "ws-1",
        payload: { taskId: "t1", interaction: { kind: "approval", approvalId: "a1" } },
      },
    ]);
    runtime.dispose();
  });

  test("onTaskCompletion fires from a TASK_COMPLETION on the messaging port", () => {
    const { env, messaging } = createFakeEnvironment();
    const runtime = createAgentRuntime(env, {
      orchestrator: { startTask: async () => {}, stopTask: async () => {}, resolveApprovalResponse: () => true },
    });

    const completions: Array<{ workspaceId: string; payload: unknown }> = [];
    runtime.onTaskCompletion((workspaceId, payload) =>
      completions.push({ workspaceId, payload }),
    );

    messaging.deliver({ type: "OTHER" }); // ignored
    messaging.deliver({
      type: "TASK_COMPLETION",
      workspaceId: "ws-1",
      payload: { summary: "done" },
    });

    expect(completions).toEqual([
      { workspaceId: "ws-1", payload: { summary: "done" } },
    ]);
    runtime.dispose();
  });

  test("dispose unsubscribes completion listeners", () => {
    const { env, messaging } = createFakeEnvironment();
    const runtime = createAgentRuntime(env, {
      orchestrator: { startTask: async () => {}, stopTask: async () => {}, resolveApprovalResponse: () => true },
    });
    const listener = vi.fn();
    runtime.onTaskCompletion(listener);

    runtime.dispose();
    messaging.deliver({ type: "TASK_COMPLETION", workspaceId: "ws-1" });

    expect(listener).not.toHaveBeenCalled();
  });
});
