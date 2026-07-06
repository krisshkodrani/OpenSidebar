import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "../setup";
import { RiskLevel, ToolName } from "../../src/types";
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
      ]),
    );
    expect(payload.perception).toMatchObject({
      screenshotDataUrl: "data:image/jpeg;base64,abc",
      elementSummary: "[2] h1 \"Next page\"",
      pageStateRef: "postTool",
    });
  });

  test("turn traces attach actual prompt tokens and cache telemetry to context metrics", async () => {
    const recorder = new TraceRecorder("session-context-economy");
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
      [],
      2,
      1,
      "accounts/fireworks/routers/kimi-k2p6-turbo",
      "none",
      [{ role: "system", content: "System\n## Page Context\nTitle: Start" }],
      {
        systemTokens: 90,
        historyTokens: 10,
        totalTokens: 100,
        maxTokens: 1000,
        utilization: 0.1,
        droppedMessageCount: 0,
        compressionLevel: "none",
        cachedPrefixLength: 7,
        promptSections: {
          templateId: "agent.system",
          templateVersion: "v5",
          sectionSignatureHash: "abcdef12",
          staticRulesChars: 20,
          systemMessagePrefixChars: 20,
          personaAndTaskChars: 0,
          planStatusChars: 0,
          workingNotesChars: 0,
          pageContextChars: 10,
          lastActionOutcomeChars: 0,
          visibleElementsChars: 0,
          pageContentChars: 0,
          pageInterpretationChars: 0,
          toolCapabilityCatalogChars: 0,
          toolOutputChars: 0,
          distillationSummaryChars: 0,
          systemTotalChars: 30,
          historyChars: 0,
          estimatedPromptTokens: 100,
        },
      },
    );
    recorder.recordLLMResponse(
      "OK",
      [],
      "stop",
      {
        prompt_tokens: 80,
        completion_tokens: 5,
        total_tokens: 85,
        cached_tokens: 40,
        cacheTelemetry: {
          provider: "fireworks",
          promptTokens: 80,
          cachedPromptTokens: 40,
          cacheHitPct: 50,
          source: "response_headers",
        },
      },
      25,
      "fireworks",
      "accounts/fireworks/routers/kimi-k2p6-turbo",
    );
    await recorder.endTurn();

    const fetchMock = globalThis.fetch as any;
    const turnCall = fetchMock.mock.calls.find(
      ([url]: [string]) => String(url).endsWith("/traces"),
    );
    expect(turnCall).toBeTruthy();

    const payload = JSON.parse(turnCall[1].body);
    expect(payload.llmResponse.usage.cached_tokens).toBe(40);
    expect(payload.llmResponse.usage.cacheTelemetry).toMatchObject({
      provider: "fireworks",
      cacheHitPct: 50,
    });
    expect(
      payload.llmRequest.contextMetrics.promptSections.actualPromptTokens,
    ).toBe(80);
    expect(
      payload.llmRequest.contextMetrics.promptSections.estimatorErrorPct,
    ).toBe(25);
  });

  test("redacts profile tool values from trace payloads", async () => {
    const recorder = new TraceRecorder("session-profile-redaction");
    recorder.startTurn(
      1,
      {
        url: "https://example.com/apply",
        title: "Apply",
        elementCount: 2,
        visibleContentLength: 80,
        pageContentLength: 100,
        scrollY: 0,
      },
      [],
      2,
      2,
      "openai/gpt-5.4",
      "none",
    );
    recorder.recordToolExecution(
      "profile-call",
      ToolName.GET_PROFILE_FIELDS,
      { fields: ["full_name", "contact.email"] },
      [
        "PROFILE FIELDS:",
        "- full_name: John Doe",
        "- contact.email: john.doe@example.com",
      ].join("\n"),
      true,
      5,
      RiskLevel.LOW,
    );
    recorder.recordLLMResponse(
      "Typing John Doe into the form.",
      [
        {
          id: "type-name",
          type: "function",
          function: {
            name: ToolName.TYPE_TEXT,
            arguments: JSON.stringify({ id: 7, text: "John Doe" }),
          },
        } as any,
      ],
      "tool_calls",
      null,
      10,
    );
    recorder.recordPostToolSnapshot({
      url: "https://example.com/apply",
      title: "Apply",
      elementCount: 1,
      visibleContentLength: 80,
      pageContentLength: 100,
      scrollY: 0,
      elements: [
        {
          tag: 7,
          tagName: "input",
          text: "John Doe",
          attributes: { value: "john.doe@example.com" },
          isVisible: true,
          isInteractive: true,
          rect: { x: 0, y: 0, width: 100, height: 20 },
        } as any,
      ],
    });
    await recorder.recordPerception(
      {
        interpretation: "The form contains John Doe.",
        model: "vision-model",
        durationMs: 5,
        cached: false,
      },
      undefined,
      '[7] input "john.doe@example.com"',
    );
    await recorder.endTurn();

    const fetchMock = globalThis.fetch as any;
    const turnCall = fetchMock.mock.calls.find(
      ([url]: [string]) => String(url).endsWith("/traces"),
    );
    expect(turnCall).toBeTruthy();

    const body = turnCall[1].body as string;
    expect(body).not.toContain("John Doe");
    expect(body).not.toContain("john.doe@example.com");
    expect(body).toContain("[REDACTED_PROFILE_VALUE]");
  });
  test("finalize drains queued turn traces after session flush succeeds", async () => {
    let traceAttempts = 0;
    globalThis.fetch = vi.fn(async (url: any) => {
      const path = String(url);
      if (path.endsWith("/traces")) {
        traceAttempts += 1;
        if (traceAttempts <= 2) {
          throw new Error("trace server busy");
        }
      }
      return new Response(null, { status: 204 });
    }) as any;

    const recorder = new TraceRecorder("session-final-drain");
    recorder.setSessionInfo("Summarize this page", "https://example.com/article");
    recorder.startTurn(
      1,
      {
        url: "https://example.com/article",
        title: "Article",
        elementCount: 1,
        visibleContentLength: 100,
        pageContentLength: 150,
        scrollY: 0,
      },
      [],
      2,
      1,
      "accounts/fireworks/routers/kimi-k2p6-turbo",
      "none",
    );
    recorder.recordLLMResponse(
      "Done",
      [
        {
          id: "done-call",
          type: "function",
          function: {
            name: ToolName.DONE,
            arguments: JSON.stringify({ summary: "Summary complete" }),
          },
        } as any,
      ],
      "tool_calls",
      null,
      10,
    );

    await recorder.endTurn();
    await recorder.finalize("completed", "Summary complete", 1, null, null);

    const fetchMock = globalThis.fetch as any;
    const paths = fetchMock.mock.calls.map(([url]: [string]) =>
      String(url).replace("http://127.0.0.1:7589", ""),
    );
    expect(paths).toEqual([
      "/traces",
      "/traces",
      "/traces/session",
      "/traces",
    ]);
    expect(traceAttempts).toBe(3);

    const finalTraceCall = fetchMock.mock.calls.at(-1);
    expect(finalTraceCall?.[0]).toContain("/traces");
    expect(JSON.parse(finalTraceCall?.[1].body).sessionId).toBe(
      "session-final-drain",
    );
  });
});
