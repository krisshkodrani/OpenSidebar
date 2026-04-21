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
});
