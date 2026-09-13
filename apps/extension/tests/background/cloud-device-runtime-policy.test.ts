import { describe, expect, it, vi } from "vitest";
import type { BrowserCommandV1 } from "@shared-types/cloud-sessions";
import { createCloudCommandExecution } from "../../src/background/cloud-device-read-policy";

const command = (overrides: Partial<BrowserCommandV1> = {}): BrowserCommandV1 => ({
  schemaVersion: 1,
  sessionId: crypto.randomUUID(),
  commandId: crypto.randomUUID(),
  leaseId: crypto.randomUUID(),
  leaseGeneration: 1,
  checkpointRevision: 1,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  action: { kind: "read_current_page", arguments: {} },
  preconditions: [
    { kind: "origin", value: "https://example.test" },
    { kind: "fresh_observation", value: "required" },
  ],
  risk: "read",
  ...overrides,
});

const textCommand = (overrides: Partial<BrowserCommandV1> = {}) => command({
  risk: "reversible_write",
  action: {
    kind: "type_text",
    target: {
      description: "Email field",
      expectedRole: "textbox",
      expectedName: "Email",
      expectedOrigin: "https://example.test",
    },
    arguments: { text: "tester@example.test" },
  },
  preconditions: [
    { kind: "origin", value: "https://example.test" },
    { kind: "fresh_observation", value: "required" },
    { kind: "semantic_target", value: "unique" },
  ],
  ...overrides,
});

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  url: "https://example.test/form",
  title: "Form",
  elements: [{
    tag: 7,
    tagName: "input",
    role: "textbox",
    text: "",
    attributes: { "aria-label": "Email", type: "email" },
    rect: { x: 1, y: 1, width: 100, height: 20 },
    isVisible: true,
    isDisabled: false,
  }],
  viewport: { width: 800, height: 600 },
  scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 600 },
  ...overrides,
});

const clickCommand = (overrides: Partial<BrowserCommandV1> = {}) => command({
  risk: "reversible_write",
  action: {
    kind: "click",
    target: {
      description: "Reveal details",
      expectedRole: "button",
      expectedName: "Show details",
      expectedOrigin: "https://example.test",
    },
    arguments: { postcondition: { kind: "text_present", value: "Details loaded" } },
  },
  preconditions: [
    { kind: "origin", value: "https://example.test" },
    { kind: "fresh_observation", value: "required" },
    { kind: "semantic_target", value: "unique" },
  ],
  ...overrides,
});

const clickSnapshot = (revealed = false) => snapshot({
  visibleContent: revealed ? "Details loaded" : "",
  elements: [{
    tag: 11,
    tagName: "button",
    role: "button",
    text: "Show details",
    attributes: { "aria-label": "Show details" },
    rect: { x: 1, y: 1, width: 100, height: 20 },
    isVisible: true,
    isDisabled: false,
  }],
});

describe("cloud device command execution policy", () => {
  it("allows a freshly observed current-page read", async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      payload: { snapshot: { url: "https://example.test/form" } },
    });
    const execution = createCloudCommandExecution(4, {
      pages: { getTab: vi.fn().mockResolvedValue({ url: "https://example.test/form" }) } as never,
      content: { sendMessage } as never,
    });
    expect(await execution.validateAndGround(command(), "digest")).toBe(true);
    expect(await execution.dispatch(command())).toBe("succeeded");
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it.each([
    command({ risk: "reversible_write", action: { kind: "click", arguments: {} } }),
    command({ action: { kind: "unknown_read", arguments: {} } }),
    command({ preconditions: [{ kind: "origin", value: "https://other.test" }] }),
  ])("defers writes, unknown actions, and origin mismatches", async (value) => {
    const execution = createCloudCommandExecution(4, {
      pages: { getTab: vi.fn().mockResolvedValue({ url: "https://example.test/form" }) } as never,
      content: { sendMessage: vi.fn() } as never,
    });
    expect(await execution.validateAndGround(value, "digest")).toBe(false);
  });

  it("rejects browser-internal pages without throwing", async () => {
    const execution = createCloudCommandExecution(4, {
      pages: { getTab: vi.fn().mockResolvedValue({ url: "not a URL" }) } as never,
      content: { sendMessage: vi.fn() } as never,
    });
    await expect(execution.validateAndGround(command(), "digest")).resolves.toBe(false);
  });

  it("types into one freshly resolved semantic target and verifies its value", async () => {
    const sendMessage = vi.fn().mockImplementation((_tabId, message) =>
      message.type === "DOM_SNAPSHOT_REQUEST"
        ? Promise.resolve({ payload: { snapshot: snapshot() } })
        : Promise.resolve({ payload: { success: true, result: "Typed", navigated: false } }),
    );
    const executeFunction = vi.fn().mockResolvedValue([
      { frameId: 0, result: { found: true, value: "tester@example.test" } },
    ]);
    const execution = createCloudCommandExecution(4, {
      pages: { getTab: vi.fn().mockResolvedValue({ url: "https://example.test/form" }) } as never,
      content: { sendMessage, executeFunction } as never,
      isPageAuthorized: vi.fn().mockResolvedValue(true),
    });
    const value = textCommand();
    expect(await execution.validateAndGround(value, "digest")).toBe(true);
    expect(await execution.dispatch(value)).toBe("succeeded");
    expect(sendMessage).toHaveBeenCalledWith(4, expect.objectContaining({
      type: "TOOL_EXECUTE",
      payload: expect.objectContaining({
        toolName: "type_text",
        args: { id: 7, text: "tester@example.test", pressEnter: false },
      }),
    }));
  });

  it.each([
    ["password field", snapshot({ elements: [{ ...snapshot().elements[0], attributes: { "aria-label": "Email", type: "password" } }] }), textCommand()],
    ["ambiguous target", snapshot({ elements: [snapshot().elements[0], { ...snapshot().elements[0], tag: 8 }] }), textCommand()],
    ["Enter submission", snapshot(), textCommand({ action: { ...textCommand().action, arguments: { text: "value", pressEnter: true } } })],
    ["sensitive write", snapshot(), textCommand({ risk: "sensitive_write" })],
  ])("rejects %s", async (_label, liveSnapshot, value) => {
    const execution = createCloudCommandExecution(4, {
      pages: { getTab: vi.fn().mockResolvedValue({ url: "https://example.test/form" }) } as never,
      content: { sendMessage: vi.fn().mockResolvedValue({ payload: { snapshot: liveSnapshot } }) } as never,
      isPageAuthorized: vi.fn().mockResolvedValue(true),
    });
    expect(await execution.validateAndGround(value, "digest")).toBe(false);
  });

  it("reports an interrupted text write as unknown when the semantic target vanished", async () => {
    const execution = createCloudCommandExecution(4, {
      pages: { getTab: vi.fn().mockResolvedValue({ url: "https://example.test/form" }) } as never,
      content: {
        sendMessage: vi.fn().mockResolvedValue({ payload: { snapshot: snapshot({ elements: [] }) } }),
        executeFunction: vi.fn(),
      } as never,
      isPageAuthorized: vi.fn().mockResolvedValue(true),
    });
    expect(await execution.observe(textCommand())).toBe("outcome_unknown");
  });

  it("never treats an unknown interrupted action as a successful read", async () => {
    const execution = createCloudCommandExecution(4, {
      pages: { getTab: vi.fn() } as never,
      content: { sendMessage: vi.fn() } as never,
    });
    expect(await execution.observe(command({
      risk: "reversible_write",
      action: { kind: "click", arguments: {} },
    }))).toBe("outcome_unknown");
  });

  it("requires one local approval before a semantic click and verifies its postcondition", async () => {
    let snapshotCount = 0;
    const sendMessage = vi.fn().mockImplementation((_tabId, message) => {
      if (message.type === "TOOL_EXECUTE")
        return Promise.resolve({ payload: { success: true, result: "Clicked", navigated: false } });
      snapshotCount += 1;
      return Promise.resolve({
        payload: { snapshot: clickSnapshot(snapshotCount >= 4) },
      });
    });
    const consumeLocalApproval = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const execution = createCloudCommandExecution(4, {
      pages: { getTab: vi.fn().mockResolvedValue({ url: "https://example.test/form" }) } as never,
      content: { sendMessage } as never,
      isPageAuthorized: vi.fn().mockResolvedValue(true),
      consumeLocalApproval,
    });
    const value = clickCommand();
    expect(await execution.validateAndGround(value, "digest")).toBe("approval_required");
    expect(sendMessage.mock.calls.some(([, message]) => message.type === "TOOL_EXECUTE"))
      .toBe(false);
    expect(await execution.validateAndGround(value, "digest")).toBe(true);
    expect(await execution.dispatch(value)).toBe("succeeded");
    expect(sendMessage).toHaveBeenCalledWith(4, expect.objectContaining({
      type: "TOOL_EXECUTE",
      payload: expect.objectContaining({
        toolName: "click_element",
        args: { id: 11 },
      }),
    }));
  });

  it.each([
    ["missing postcondition", clickCommand({ action: { ...clickCommand().action, arguments: {} } }), clickSnapshot()],
    ["already-satisfied postcondition", clickCommand(), clickSnapshot(true)],
    ["ambiguous target", clickCommand(), snapshot({ elements: [clickSnapshot().elements[0], { ...clickSnapshot().elements[0], tag: 12 }] })],
  ])("rejects a click with %s", async (_label, value, liveSnapshot) => {
    const execution = createCloudCommandExecution(4, {
      pages: { getTab: vi.fn().mockResolvedValue({ url: "https://example.test/form" }) } as never,
      content: { sendMessage: vi.fn().mockResolvedValue({ payload: { snapshot: liveSnapshot } }) } as never,
      isPageAuthorized: vi.fn().mockResolvedValue(true),
      consumeLocalApproval: vi.fn().mockResolvedValue(true),
    });
    expect(await execution.validateAndGround(value, "digest")).toBe(false);
  });
});
