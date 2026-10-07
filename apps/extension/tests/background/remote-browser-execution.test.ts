import { expect, test, vi } from "vitest";
import {
  createDirectBrowserExecution,
  type DirectBrowserPorts,
} from "../../src/background/remote-control/browser-execution";
import type { DomSnapshotResponse } from "@shared-types/messages/content-protocol";
import { MessageSource, ToolName } from "../../src/types";

function setup() {
  const state = {
    documentInstanceId: "doc",
    mutationEpoch: 1,
    url: "https://example.test/form",
    viewport: { width: 1000, height: 700 },
    scroll: { x: 0, y: 0 },
  };
  const element = {
    tag: 1,
    tagName: "input",
    role: "textbox",
    text: "Name",
    attributes: { type: "text" },
    rect: { x: 1, y: 1, width: 200, height: 40 },
    isVisible: true,
    isDisabled: false,
  };
  const response: DomSnapshotResponse = {
    type: "DOM_SNAPSHOT_RESPONSE",
    source: MessageSource.CONTENT,
    requestId: "snapshot",
    payload: {
      durationMs: 1,
      documentState: state,
      snapshot: {
        title: "Form",
        url: state.url,
        visibleContent: "Your profile",
        pageContent: "Hidden state must not be returned",
        viewport: state.viewport,
        scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 700 },
        elements: [
          element,
          {
            ...element,
            tag: 2,
            text: "Password",
            attributes: { type: "password" },
          },
          {
            ...element,
            tag: 3,
            isVisible: false,
            text: "Hidden",
            attributes: { type: "hidden" },
          },
        ],
      },
    },
  };
  const bindings = [
    { tab: "original", tabId: 1, taskCreated: false },
    { tab: "owned", tabId: 2, taskCreated: true },
  ];
  const sendMessage = vi
    .fn()
    .mockImplementation(async (_id, message) =>
      message.type === "DOM_SNAPSHOT_REQUEST"
        ? structuredClone(response)
        : { payload: { success: true } },
    );
  const ports: DirectBrowserPorts = {
    pages: {
      getTab: vi
        .fn()
        .mockImplementation(async (id) => ({
          id,
          url: state.url,
          title: "Form",
        })),
      queryTabs: vi.fn(),
      updateTab: vi.fn(),
      createTab: vi.fn(),
      removeTab: vi.fn(),
      reloadTab: vi.fn(),
      captureVisibleTab: vi.fn(),
    },
    content: {
      sendMessage,
      executeContentScripts: vi.fn(),
      executeFunction: vi.fn(),
    },
    selected: async () => bindings[0],
    tabs: async () => bindings,
    select: vi.fn(),
    register: vi.fn(),
    remove: vi.fn(),
    isAuthorized: async (_id, url) =>
      new URL(url).origin === "https://example.test",
    authorize: async () => ({ kind: "allowed" }),
    attachment: vi.fn(),
  };
  return {
    ports,
    response,
    state,
    sendMessage,
    execution: createDirectBrowserExecution(ports),
  };
}
test("remote observations omit hidden content, passwords and native tab/element IDs", async () => {
  const w = setup();
  const result = await w.execution.observe("session");
  expect(result.text).toBe("Your profile");
  expect(result.elements).toHaveLength(1);
  expect(result.elements[0].ref).not.toBe("1");
  expect(JSON.stringify(result)).not.toContain("Hidden state");
  expect(JSON.stringify(result)).not.toContain("Password");
  expect(JSON.stringify(result)).not.toContain("tabId");
});
test("rejects changed documents and cross-session element references", async () => {
  const w = setup();
  const first = await w.execution.observe("session");
  const action = {
    kind: "type" as const,
    element: first.elements[0].ref,
    text: "Alice",
  };
  expect(await w.execution.ground("other", first.revision, action)).toBe(false);
  w.state.mutationEpoch++;
  expect(await w.execution.ground("session", first.revision, action)).toBe(
    false,
  );
  await expect(
    w.execution.dispatch("session", action, new AbortController().signal),
  ).rejects.toThrow("stale_observation");
});
test("uses existing content tools with a fresh document guard and no implicit submit", async () => {
  const w = setup();
  const first = await w.execution.observe("session");
  await w.execution.dispatch(
    "session",
    { kind: "type", element: first.elements[0].ref, text: "Alice" },
    new AbortController().signal,
  );
  expect(w.sendMessage).toHaveBeenLastCalledWith(
    1,
    expect.objectContaining({
      payload: expect.objectContaining({
        toolName: ToolName.TYPE_TEXT,
        args: { id: 1, text: "Alice", pressEnter: false },
        observationBasis: expect.objectContaining({
          documentInstanceId: "doc",
          mutationEpoch: 1,
        }),
      }),
    }),
  );
  expect(
    await w.execution.ground("session", first.revision, {
      kind: "key",
      key: "Enter",
    }),
  ).toBe(false);
});
test("never closes a user-owned tab or navigates outside authorized sites", async () => {
  const w = setup();
  const first = await w.execution.observe("session");
  expect(
    await w.execution.ground("session", first.revision, {
      kind: "close_tab",
      tab: "original",
    }),
  ).toBe(false);
  expect(
    await w.execution.ground("session", first.revision, {
      kind: "navigate",
      url: "https://other.test",
    }),
  ).toBe(false);
  expect(w.ports.pages.removeTab).not.toHaveBeenCalled();
});
test("stop prevents any browser mutation at the dispatch boundary", async () => {
  const w = setup();
  const first = await w.execution.observe("session");
  const signal = new AbortController();
  signal.abort();
  await expect(
    w.execution.dispatch(
      "session",
      { kind: "click", element: first.elements[0].ref },
      signal.signal,
    ),
  ).rejects.toThrow("stopped");
  expect(
    w.sendMessage.mock.calls.filter(
      ([, message]) => message.type === "TOOL_EXECUTE",
    ),
  ).toHaveLength(0);
});
