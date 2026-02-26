import { describe, test, expect, vi, beforeEach } from "vitest";
import "../setup";

// Mock TraceRecorder before importing RecordingSession
vi.mock("../../src/background/agent/trace", () => {
  const mockRecorder = {
    sessionId: "mock-session-id",
    setSessionInfo: vi.fn(),
    setWorkspaceId: vi.fn(),
    startTurn: vi.fn(),
    recordLLMResponse: vi.fn(),
    recordToolExecution: vi.fn(),
    recordEvent: vi.fn(),
    endTurn: vi.fn().mockResolvedValue(undefined),
    finalize: vi.fn().mockResolvedValue(undefined),
  };
  return {
    TraceRecorder: vi.fn(() => mockRecorder),
    __mockRecorder: mockRecorder,
  };
});

import { RecordingSession } from "../../src/background/recording-session";
import { TraceRecorder } from "../../src/background/agent/trace";
import type { GoldenAction, DomSnapshot, DemoAction } from "../../src/types";

function makeSnapshot(overrides?: Partial<DomSnapshot>): DomSnapshot {
  return {
    title: "Test Page",
    url: "https://example.com",
    elements: [
      {
        tag: 1,
        tagName: "button",
        role: "button",
        text: "Submit",
        attributes: { type: "submit" },
        rect: { x: 0, y: 0, width: 100, height: 30 },
        isVisible: true,
        isDisabled: false,
      },
    ],
    visibleContent: "Welcome",
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0, maxY: 2000 },
    ...overrides,
  };
}

function makeGoldenAction(
  actionType: DemoAction["type"],
  tagId: number | null,
  actionOverrides?: Partial<DemoAction>,
): GoldenAction {
  return {
    action: {
      type: actionType,
      timestamp: Date.now(),
      url: "https://example.com",
      ...actionOverrides,
    },
    tagId,
    snapshot: makeSnapshot(),
  };
}

describe("RecordingSession", () => {
  let mockRecorder: any;

  beforeEach(() => {
    vi.clearAllMocks();
    // Get the mock recorder from the mock module
    mockRecorder = (TraceRecorder as any).mock?.results?.[0]?.value;
  });

  test("constructor creates TraceRecorder with session info", () => {
    const session = new RecordingSession("Test Recording", "https://example.com", "ws-1");
    expect(TraceRecorder).toHaveBeenCalledWith(session.sessionId);
    // Access the mock instance from the constructor call
    const instance = (TraceRecorder as any).mock.results[0].value;
    expect(instance.setSessionInfo).toHaveBeenCalledWith("Test Recording", "https://example.com");
    expect(instance.setWorkspaceId).toHaveBeenCalledWith("ws-1");
  });

  test("recordAction converts click to trace turn", async () => {
    const session = new RecordingSession("Test", "https://example.com");
    const recorder = (TraceRecorder as any).mock.results[0].value;

    await session.recordAction(makeGoldenAction("click", 5));

    expect(recorder.startTurn).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        url: "https://example.com",
        title: "Test Page",
      }),
      expect.any(Array),
      0,
      0,
      "recording",
      "NONE",
    );

    expect(recorder.recordLLMResponse).toHaveBeenCalledWith(
      null,
      [
        expect.objectContaining({
          function: expect.objectContaining({
            name: "click_element",
            arguments: JSON.stringify({ id: 5 }),
          }),
        }),
      ],
      "stop",
      null,
      0,
    );

    expect(recorder.recordToolExecution).toHaveBeenCalledWith(
      "rec-tc-1",
      "click_element",
      { id: 5 },
      "OK",
      true,
      0,
      "low",
    );

    expect(recorder.endTurn).toHaveBeenCalled();
  });

  test("recordAction converts type to trace turn", async () => {
    const session = new RecordingSession("Test", "https://example.com");
    const recorder = (TraceRecorder as any).mock.results[0].value;

    await session.recordAction(makeGoldenAction("type", 2, { value: "hello" }));

    expect(recorder.recordLLMResponse).toHaveBeenCalledWith(
      null,
      [
        expect.objectContaining({
          function: expect.objectContaining({
            name: "type_text",
            arguments: JSON.stringify({ id: 2, text: "hello" }),
          }),
        }),
      ],
      "stop",
      null,
      0,
    );
  });

  test("recordAction handles annotations as events", async () => {
    const session = new RecordingSession("Test", "https://example.com");
    const recorder = (TraceRecorder as any).mock.results[0].value;

    await session.recordAction(
      makeGoldenAction("annotate", null, { value: "User logged in" }),
    );

    expect(recorder.recordEvent).toHaveBeenCalledWith("annotation", {
      text: "User logged in",
    });
    expect(recorder.endTurn).toHaveBeenCalled();
  });

  test("recordAction skips unmappable actions (click without tagId)", async () => {
    const session = new RecordingSession("Test", "https://example.com");
    const recorder = (TraceRecorder as any).mock.results[0].value;

    await session.recordAction(makeGoldenAction("click", null));

    expect(recorder.startTurn).not.toHaveBeenCalled();
    expect(recorder.endTurn).not.toHaveBeenCalled();
  });

  test("finalize flushes session with correct metadata", async () => {
    const session = new RecordingSession("Test", "https://example.com");
    const recorder = (TraceRecorder as any).mock.results[0].value;

    // Record a couple of actions
    await session.recordAction(makeGoldenAction("click", 1));
    await session.recordAction(makeGoldenAction("type", 2, { value: "hello" }));

    const result = await session.finalize("Login Flow", "Log into account");

    expect(result.sessionId).toBe(session.sessionId);
    expect(result.turnCount).toBe(2);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    expect(recorder.finalize).toHaveBeenCalledWith(
      "completed",
      "Recording: Login Flow — Log into account",
      2,
      null,
      expect.objectContaining({
        totalTokens: 0,
        totalCost: 0,
        modelBreakdown: {
          recording: { calls: 2, tokens: 0, cost: 0 },
        },
      }),
    );
  });

  test("finalize without goal uses name only in summary", async () => {
    const session = new RecordingSession("Test", "https://example.com");
    const recorder = (TraceRecorder as any).mock.results[0].value;

    await session.finalize("My Recording");

    expect(recorder.finalize).toHaveBeenCalledWith(
      "completed",
      "Recording: My Recording",
      0,
      null,
      expect.any(Object),
    );
  });

  test("turn numbers increment correctly", async () => {
    const session = new RecordingSession("Test", "https://example.com");
    const recorder = (TraceRecorder as any).mock.results[0].value;

    await session.recordAction(makeGoldenAction("click", 1));
    await session.recordAction(makeGoldenAction("click", 2));
    await session.recordAction(makeGoldenAction("click", 3));

    const calls = recorder.startTurn.mock.calls;
    expect(calls[0][0]).toBe(1);
    expect(calls[1][0]).toBe(2);
    expect(calls[2][0]).toBe(3);
  });
});
