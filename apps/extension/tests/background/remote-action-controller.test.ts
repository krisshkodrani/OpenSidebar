import { describe, expect, test, vi } from "vitest";
import {
  RemoteActionController,
  type DirectActionAttempt,
  type DirectControlExecution,
  type DirectControlSession,
} from "../../src/background/remote-control/action-controller";
import {
  parseRemoteBrowserAction,
  type RemoteBrowserActionRequest,
  type RemoteBrowserObservation,
} from "@shared-types/remote-browser-control";

const request: RemoteBrowserActionRequest = {
  sessionId: "session",
  requestId: "request",
  expectedRevision: "revision",
  action: { kind: "click", element: "button" },
};
function setup() {
  const session: DirectControlSession = {
    sessionId: "session",
    generation: 1,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    stopped: false,
    mode: "direct",
  };
  const attempts = new Map<string, DirectActionAttempt>();
  const journal = {
    session: async () => session,
    stop: async () => {
      session.stopped = true;
    },
    attempt: async (_id: string, id: string) => attempts.get(id) ?? null,
    writeAttempt: async (_id: string, a: DirectActionAttempt) => {
      attempts.set(a.requestId, a);
    },
  };
  const observation: RemoteBrowserObservation = {
    revision: "next",
    observedAt: new Date().toISOString(),
    origin: "https://example.test",
    title: "Test",
    tab: "tab",
    text: "Saved",
    truncated: false,
    elements: [],
    tabs: [],
  };
  const execution: DirectControlExecution = {
    ground: vi.fn().mockResolvedValue(true),
    authorize: vi.fn().mockResolvedValue({ kind: "allowed" }),
    dispatch: vi.fn().mockResolvedValue(undefined),
    observe: vi.fn().mockResolvedValue(observation),
  };
  return {
    session,
    journal,
    attempts,
    execution,
    controller: new RemoteActionController(journal, execution),
  };
}
describe("direct browser action safety", () => {
  test("rejects arbitrary code, extra arguments, unsafe URLs and non-browser keys", () => {
    for (const action of [
      { kind: "execute_js", code: "1" },
      { kind: "click", element: "x", approved: true },
      { kind: "navigate", url: "javascript:alert(1)" },
      { kind: "navigate", url: "https://user:secret@example.test" },
      { kind: "key", key: "Meta+Q" },
    ])
      expect(() => parseRemoteBrowserAction(action)).toThrow();
    expect(
      parseRemoteBrowserAction({ text: "", kind: "type", element: "input" }),
    ).toEqual({ kind: "type", element: "input", text: "" });
  });
  test("executes once, returns fresh evidence, and replays without another effect", async () => {
    const w = setup();
    expect((await w.controller.act(request)).state).toBe("succeeded");
    expect((await w.controller.act(request)).state).toBe("succeeded");
    expect(w.execution.dispatch).toHaveBeenCalledTimes(1);
    await expect(
      w.controller.act({
        ...request,
        action: { kind: "click", element: "other" },
      }),
    ).rejects.toThrow("idempotency_conflict");
  });
  test("a restarted controller never retries an interrupted action", async () => {
    const w = setup();
    await w.controller.act(request);
    const old = w.attempts.get("request")!;
    w.attempts.set("request", { ...old, state: "started", result: undefined });
    const restarted = new RemoteActionController(w.journal, w.execution);
    expect(await restarted.act(request)).toEqual({
      state: "outcome_unknown",
      code: "interrupted_action_not_retried",
    });
    expect(w.execution.dispatch).toHaveBeenCalledTimes(1);
  });
  test("stale evidence fails before dispatch, including changes while authorizing", async () => {
    const w = setup();
    vi.mocked(w.execution.ground)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    await expect(w.controller.act(request)).rejects.toThrow(
      "stale_observation",
    );
    expect(w.execution.dispatch).not.toHaveBeenCalled();
  });
  test("approval and local denial cannot be overridden by a direct caller", async () => {
    const w = setup();
    vi.mocked(w.execution.authorize).mockResolvedValueOnce({
      kind: "approval",
      approvalId: "approve",
      expiresAt: new Date(Date.now() + 10000).toISOString(),
      description: "Send to recipient",
    });
    expect(await w.controller.act(request)).toMatchObject({
      state: "approval_required",
      approvalId: "approve",
    });
    expect(w.execution.dispatch).not.toHaveBeenCalled();
    vi.mocked(w.execution.authorize).mockResolvedValueOnce({
      kind: "denied",
      code: "local_deny",
    });
    expect(await w.controller.act(request)).toEqual({
      state: "failed",
      code: "local_deny",
    });
    expect(w.execution.dispatch).not.toHaveBeenCalled();
  });
  test("a direct session cannot execute while a task owns the target", async () => {
    const w = setup();
    w.session.mode = "task";
    await expect(w.controller.act(request)).rejects.toThrow(
      "session_not_active",
    );
    expect(w.execution.dispatch).not.toHaveBeenCalled();
  });
  test("local stop aborts immediately and prevents restart", async () => {
    const w = setup();
    let began!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    vi.mocked(w.execution.dispatch).mockImplementation(
      async (_s, _a, signal) => {
        began();
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
    );
    const running = w.controller.act(request);
    await started;
    await expect(
      w.controller.act({ ...request, requestId: "second" }),
    ).rejects.toThrow("session_busy");
    await w.controller.stop("session");
    expect(await running).toEqual({
      state: "outcome_unknown",
      code: "action_effect_not_verified",
    });
    await expect(
      new RemoteActionController(w.journal, w.execution).act(request),
    ).rejects.toThrow("session_not_active");
  });
  test("loss of observation after dispatch is unknown, not success or a retry", async () => {
    const w = setup();
    vi.mocked(w.execution.observe).mockRejectedValue(new Error("offline"));
    expect((await w.controller.act(request)).state).toBe("outcome_unknown");
    expect((await w.controller.act(request)).state).toBe("outcome_unknown");
    expect(w.execution.dispatch).toHaveBeenCalledTimes(1);
  });
});
