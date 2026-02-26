import { describe, test, expect, vi, beforeEach } from "vitest";
import "../setup";
import { ManualModeHandler } from "../../src/background/manual-mode";
import { ToolName } from "../../src/types";

// Mock the tool registry
vi.mock("../../src/background/tools/registry", () => {
  const execute = vi.fn().mockResolvedValue("OK — clicked element [5]");
  return {
    toolRegistry: {
      execute,
      getDefinitions: vi.fn().mockReturnValue([]),
    },
  };
});

// Mock the perception module
vi.mock("../../src/background/perception", () => ({
  perceive: vi.fn().mockResolvedValue({
    interpretation: "Page shows a login form with email and password fields.",
    model: "test-model",
    durationMs: 100,
    cached: false,
  }),
}));

// Mock the TraceRecorder
vi.mock("../../src/background/agent/trace", () => ({
  TraceRecorder: vi.fn().mockImplementation((sessionId: string) => ({
    sessionId,
    setSessionInfo: vi.fn(),
    setWorkspaceId: vi.fn(),
    startTurn: vi.fn(),
    recordLLMResponse: vi.fn(),
    recordToolExecution: vi.fn(),
    recordPerception: vi.fn(),
    endTurn: vi.fn().mockResolvedValue(undefined),
    finalize: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock the metadata
vi.mock("../../src/background/tools/metadata", () => ({
  DOM_MODIFYING_TOOLS: new Set(["click_element", "type_text", "scroll_page"]),
}));

// Helper to make a mock snapshot response
const mockSnapshot = {
  title: "Test Page",
  url: "https://example.com",
  elements: [
    { tag: 1, tagName: "button", role: "button", text: "Submit", attributes: { type: "submit" }, rect: { x: 0, y: 0, width: 100, height: 30 }, isVisible: true, isDisabled: false },
    { tag: 2, tagName: "input", role: "textbox", text: "", attributes: { type: "text" }, rect: { x: 0, y: 40, width: 200, height: 30 }, isVisible: true, isDisabled: false },
  ],
  viewport: { width: 1280, height: 720 },
  scroll: { x: 0, y: 0, maxY: 1000 },
};

describe("ManualModeHandler", () => {
  let handler: ManualModeHandler;

  beforeEach(() => {
    handler = new ManualModeHandler();
    vi.clearAllMocks();

    // Replace chrome.tabs methods with vi.fn() for proper mocking
    (chrome.tabs as any).sendMessage = vi.fn().mockResolvedValue({ snapshot: mockSnapshot });
    (chrome.tabs as any).captureVisibleTab = vi.fn().mockResolvedValue("data:image/jpeg;base64,mock");
    (chrome.tabs as any).query = vi.fn().mockResolvedValue([{ id: 123, url: "https://example.com" }]);
    (chrome.storage.sync as any).get = vi.fn().mockResolvedValue({});
    (chrome.storage.sync as any).set = vi.fn().mockResolvedValue(undefined);
    (chrome.runtime as any).sendMessage = vi.fn().mockResolvedValue(undefined);
  });

  describe("tool commands", () => {
    test("executes a tool via registry", async () => {
      const { toolRegistry } = await import("../../src/background/tools/registry");

      const result = await handler.handleCommand(
        {
          command: "tool",
          toolName: ToolName.CLICK_ELEMENT,
          args: { id: 5 },
          tabId: 123,
        },
        "ws-1",
      );

      expect(result.command).toBe("tool");
      expect(result.success).toBe(true);
      expect(result.result).toContain("clicked");
      expect(result.toolName).toBe(ToolName.CLICK_ELEMENT);
      expect(result.args).toEqual({ id: 5 });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(toolRegistry.execute).toHaveBeenCalledOnce();
    });

    test("returns error when tool name is missing", async () => {
      const result = await handler.handleCommand(
        {
          command: "tool",
          tabId: 123,
        },
        "ws-1",
      );

      expect(result.success).toBe(false);
      expect(result.result).toContain("No tool name");
    });

    test("handles tool execution errors", async () => {
      const { toolRegistry } = await import("../../src/background/tools/registry");
      vi.mocked(toolRegistry.execute).mockRejectedValueOnce(new Error("Element not found"));

      const result = await handler.handleCommand(
        {
          command: "tool",
          toolName: ToolName.CLICK_ELEMENT,
          args: { id: 999 },
          tabId: 123,
        },
        "ws-1",
      );

      expect(result.success).toBe(false);
      expect(result.result).toContain("Element not found");
    });
  });

  describe("perceive command", () => {
    test("runs perception and returns interpretation", async () => {
      const result = await handler.handleCommand(
        {
          command: "perceive",
          objective: "Find the login form",
          tabId: 123,
        },
        "ws-1",
      );

      expect(result.command).toBe("perceive");
      expect(result.success).toBe(true);
      expect(result.interpretation).toContain("login form");
    });

    test("fails gracefully when snapshot unavailable", async () => {
      (chrome.tabs as any).sendMessage = vi.fn().mockRejectedValue(new Error("No content script"));

      const result = await handler.handleCommand(
        { command: "perceive", tabId: 123 },
        "ws-1",
      );

      expect(result.success).toBe(false);
      expect(result.result).toContain("Failed to get DOM snapshot");
    });
  });

  describe("snapshot command", () => {
    test("returns element list", async () => {
      const result = await handler.handleCommand(
        { command: "snapshot", tabId: 123 },
        "ws-1",
      );

      expect(result.command).toBe("snapshot");
      expect(result.success).toBe(true);
      expect(result.result).toContain("2 elements");
      expect(result.elements).toHaveLength(2);
    });

    test("reports empty page", async () => {
      (chrome.tabs as any).sendMessage = vi.fn().mockResolvedValue({
        snapshot: { ...mockSnapshot, elements: [] },
      });

      const result = await handler.handleCommand(
        { command: "snapshot", tabId: 123 },
        "ws-1",
      );

      expect(result.success).toBe(true);
      expect(result.result).toContain("No interactive elements");
    });
  });

  describe("screenshot command", () => {
    test("captures screenshot", async () => {
      (chrome.tabs as any).captureVisibleTab = vi.fn().mockResolvedValue("data:image/jpeg;base64,xyz");

      const result = await handler.handleCommand(
        { command: "screenshot", tabId: 123 },
        "ws-1",
      );

      expect(result.command).toBe("screenshot");
      expect(result.success).toBe(true);
      expect(result.screenshotUrl).toBe("data:image/jpeg;base64,xyz");
    });

    test("handles screenshot failure", async () => {
      (chrome.tabs as any).captureVisibleTab = vi.fn().mockRejectedValue(new Error("Tab not visible"));

      const result = await handler.handleCommand(
        { command: "screenshot", tabId: 123 },
        "ws-1",
      );

      expect(result.success).toBe(false);
      expect(result.result).toContain("failed");
    });
  });

  describe("help command", () => {
    test("returns formatted help text", async () => {
      const result = await handler.handleCommand(
        { command: "help", tabId: 123 },
        "ws-1",
      );

      expect(result.command).toBe("help");
      expect(result.success).toBe(true);
      expect(result.result).toContain("Available commands");
      expect(result.result).toContain("/click");
    });
  });

  describe("dismiss command", () => {
    test("sends dismiss modals to content script", async () => {
      (chrome.tabs as any).sendMessage = vi.fn().mockResolvedValue({ payload: { dismissed: 2 } });

      const result = await handler.handleCommand(
        { command: "dismiss", tabId: 123 },
        "ws-1",
      );

      expect(result.command).toBe("dismiss");
      expect(result.success).toBe(true);
      expect(result.result).toContain("Dismissed 2");
    });

    test("reports no modals found", async () => {
      (chrome.tabs as any).sendMessage = vi.fn().mockResolvedValue({ payload: { dismissed: 0 } });

      const result = await handler.handleCommand(
        { command: "dismiss", tabId: 123 },
        "ws-1",
      );

      expect(result.success).toBe(true);
      expect(result.result).toContain("No modals");
    });
  });

  describe("tags command", () => {
    test("toggles element tags on", async () => {
      (chrome.storage.sync as any).get = vi.fn().mockResolvedValue({
        userSettings: { showElementTags: false },
      });

      const result = await handler.handleCommand(
        { command: "tags", tabId: 123 },
        "ws-1",
      );

      expect(result.command).toBe("tags");
      expect(result.success).toBe(true);
      expect(result.result).toContain("enabled");
    });

    test("toggles element tags off", async () => {
      (chrome.storage.sync as any).get = vi.fn().mockResolvedValue({
        userSettings: { showElementTags: true },
      });

      const result = await handler.handleCommand(
        { command: "tags", tabId: 123 },
        "ws-1",
      );

      expect(result.success).toBe(true);
      expect(result.result).toContain("disabled");
    });
  });

  describe("record command (toggle)", () => {
    test("starts recording on first /record", async () => {
      const result = await handler.handleCommand(
        { command: "record", recordName: "my-session", tabId: 123 },
        "ws-1",
      );

      expect(result.command).toBe("record");
      expect(result.success).toBe(true);
      expect(result.result).toContain("Recording started");
      expect(result.result).toContain("my-session");
      expect(handler.isRecording()).toBe(true);
    });

    test("stops recording on second /record", async () => {
      // Start
      await handler.handleCommand(
        { command: "record", recordName: "my-session", tabId: 123 },
        "ws-1",
      );
      expect(handler.isRecording()).toBe(true);

      // Stop
      const result = await handler.handleCommand(
        { command: "record", tabId: 123 },
        "ws-1",
      );
      expect(result.success).toBe(true);
      expect(result.result).toContain("stopped");
      expect(handler.isRecording()).toBe(false);
    });

    test("getRecordingInfo returns session info when recording", async () => {
      await handler.handleCommand(
        { command: "record", recordName: "test", tabId: 123 },
        "ws-1",
      );

      const info = handler.getRecordingInfo();
      expect(info).not.toBeNull();
      expect(info!.name).toBe("test");
      expect(info!.turnCount).toBe(0);
    });

    test("getRecordingInfo returns null when not recording", () => {
      expect(handler.getRecordingInfo()).toBeNull();
    });
  });

  describe("trace recording integration", () => {
    test("tool execution is recorded when recording is active", async () => {
      const { TraceRecorder } = await import("../../src/background/agent/trace");

      // Start recording
      await handler.handleCommand(
        { command: "record", recordName: "test", tabId: 123 },
        "ws-1",
      );

      // Execute a tool command while recording
      await handler.handleCommand(
        {
          command: "tool",
          toolName: ToolName.CLICK_ELEMENT,
          args: { id: 5 },
          tabId: 123,
        },
        "ws-1",
      );

      // Verify trace methods were called
      const mockInstance = vi.mocked(TraceRecorder).mock.results[0].value;
      expect(mockInstance.startTurn).toHaveBeenCalledOnce();
      expect(mockInstance.recordLLMResponse).toHaveBeenCalledOnce();
      expect(mockInstance.recordToolExecution).toHaveBeenCalledOnce();
      expect(mockInstance.endTurn).toHaveBeenCalledOnce();
    });
  });

  describe("dispose", () => {
    test("finalizes active recording on dispose", async () => {
      const { TraceRecorder } = await import("../../src/background/agent/trace");

      await handler.handleCommand(
        { command: "record", recordName: "test", tabId: 123 },
        "ws-1",
      );
      expect(handler.isRecording()).toBe(true);

      await handler.dispose();
      expect(handler.isRecording()).toBe(false);

      const mockInstance = vi.mocked(TraceRecorder).mock.results[0].value;
      expect(mockInstance.finalize).toHaveBeenCalledOnce();
    });

    test("dispose is no-op when not recording", async () => {
      await handler.dispose(); // should not throw
      expect(handler.isRecording()).toBe(false);
    });
  });
});
