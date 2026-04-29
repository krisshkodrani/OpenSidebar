import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "../setup";
import { ToolName } from "../../src/types";
import { TraceRecorder } from "../../src/background/agent/trace";

describe("TraceRecorder skill tool metrics", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 204 })) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("finalize persists aggregated skill tool metrics on the session record", async () => {
    const recorder = new TraceRecorder("session-skill-metrics");
    recorder.setSessionInfo("Objective: fill the form", "https://example.com/form");
    recorder.startTurn(
      1,
      {
        url: "https://example.com/form",
        title: "Form",
        elementCount: 3,
        visibleContentLength: 100,
        pageContentLength: 120,
        scrollY: 0,
      },
      [],
      2,
      3,
      "openai/gpt-5.4",
      "none",
    );
    recorder.recordEvent("skill_tool_ranking_applied", {
      turn: 1,
      skillId: "structured-form-fill",
      preferredTools: [ToolName.READ_PAGE, ToolName.TYPE_TEXT],
      discouragedTools: [ToolName.PRESS_KEY],
      originalOrder: [ToolName.PRESS_KEY, ToolName.TYPE_TEXT, ToolName.READ_PAGE],
      rankedOrder: [ToolName.READ_PAGE, ToolName.TYPE_TEXT, ToolName.PRESS_KEY],
    });
    recorder.recordEvent("skill_tool_selected", {
      turn: 1,
      skillId: "structured-form-fill",
      toolName: ToolName.TYPE_TEXT,
      preference: "preferred",
      mode: "sequential",
    });
    recorder.recordEvent("skill_tool_selected", {
      turn: 1,
      skillId: "structured-form-fill",
      toolName: ToolName.PRESS_KEY,
      preference: "discouraged",
      mode: "sequential",
    });
    await recorder.endTurn();
    await recorder.finalize("completed", "done", 1, null, null);

    const fetchMock = globalThis.fetch as any;
    const sessionCall = fetchMock.mock.calls.find(
      ([url]: [string]) => String(url).endsWith("/traces/session"),
    );
    expect(sessionCall).toBeTruthy();

    const sessionPayload = JSON.parse(sessionCall[1].body);
    expect(sessionPayload.skillToolMetrics).toEqual({
      skillId: "structured-form-fill",
      rankingApplications: 1,
      totalSelections: 2,
      preferredSelections: 1,
      neutralSelections: 0,
      discouragedSelections: 1,
      preferredSelectionRate: 0.5,
      discouragedSelectionRate: 0.5,
    });
  });

  test("turn traces include canonical page state while preserving legacy perception fields", async () => {
    const recorder = new TraceRecorder("session-page-state");
    recorder.startTurn(
      1,
      {
        url: "https://example.com/start",
        title: "Start",
        elementCount: 1,
        visibleContentLength: 50,
        pageContentLength: 75,
        scrollY: 0,
      },
      [
        {
          tag: 1,
          tagName: "button",
          text: "Continue",
          attributes: {},
          isVisible: true,
          isInteractive: true,
          rect: { x: 0, y: 0, width: 20, height: 20 },
        } as any,
      ],
      2,
      1,
      "openai/gpt-5.4",
      "none",
    );
    recorder.recordPostToolSnapshot({
      url: "https://example.com/next",
      title: "Next",
      elementCount: 1,
      visibleContentLength: 80,
      pageContentLength: 120,
      scrollY: 10,
      elements: [
        {
          tag: 2,
          tagName: "h1",
          text: "Next page",
          attributes: {},
          isVisible: true,
          isInteractive: false,
          rect: { x: 0, y: 0, width: 80, height: 20 },
        } as any,
      ],
    });
    await recorder.recordPerception(
      {
        interpretation: "The next page is visible.",
        model: "vision-model",
        durationMs: 25,
        cached: false,
        mode: "structured",
        source: "fresh",
        freshnessReason: "new_fingerprint",
        screenshotStatus: "captured",
      },
      "data:image/jpeg;base64,abc",
      "[2] h1 \"Next page\"",
      [{ dataUrl: "data:image/jpeg;base64,pan", scrollY: 300, label: "bottom" }],
    );
    await recorder.endTurn();

    const fetchMock = globalThis.fetch as any;
    const turnCall = fetchMock.mock.calls.find(
      ([url]: [string]) => String(url).endsWith("/traces"),
    );
    expect(turnCall).toBeTruthy();

    const payload = JSON.parse(turnCall[1].body);
    expect(payload.pageState.preDecision).toMatchObject({
      url: "https://example.com/start",
      title: "Start",
      elementCount: 1,
      domSnapshot: expect.any(Array),
    });
    expect(payload.pageState.postTool).toMatchObject({
      url: "https://example.com/next",
      title: "Next",
      scrollY: 10,
      domDistillation: "[2] h1 \"Next page\"",
    });
    expect(payload.pageState.postTool.screenshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "viewport",
          dataUrl: "data:image/jpeg;base64,abc",
          status: "captured",
        }),
        expect.objectContaining({
          kind: "panorama",
          dataUrl: "data:image/jpeg;base64,pan",
          label: "bottom",
        }),
      ]),
    );
    expect(payload.perception).toMatchObject({
      screenshotDataUrl: "data:image/jpeg;base64,abc",
      elementSummary: "[2] h1 \"Next page\"",
      pageStateRef: "postTool",
    });
  });
});
