import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { describe, expect, it } from "vitest";
import { __testOnly as reportTestOnly } from "../e2e/helpers/report";

describe("e2e report helper", () => {
  it("counts Page Interpretation turns and aggregates perception diagnostics", () => {
    const dir = mkdtempSync(join(tmpdir(), "opensidebar-report-"));
    try {
      const traceFile = join(dir, "session-1.jsonl");
      writeFileSync(
        traceFile,
        [
          JSON.stringify({
            sessionId: "session-1",
            turnNumber: 1,
            timestamp: 1,
            snapshot: {
              url: "https://example.com",
              title: "Example",
              elementCount: 4,
              visibleContentLength: 100,
              scrollY: 0,
            },
            elements: [],
            llmRequest: {
              model: "openai/gpt-5.4-mini",
              modelTier: "executor",
              messageCount: 2,
              toolCount: 0,
              compressionLevel: "none",
              messages: [
                { role: "system", content: "system" },
                {
                  role: "user",
                  content:
                    "Task\n\nPage Interpretation\nLOCATION: Example page\nAFFORDANCES:\n- [1] Continue",
                },
              ],
            },
            llmResponse: {
              content: "Continue",
              toolCalls: [],
              finishReason: "stop",
              usage: {
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15,
                cost: 0.001,
              },
              durationMs: 100,
            },
            toolExecutions: [],
            events: [],
            progressState: { stagnantTurns: 0, signal: null },
            perception: {
              interpretation: "LOCATION: Example page",
              model: "vision-model",
              durationMs: 20,
              cached: false,
              mode: "structured",
              source: "fresh",
              freshnessReason: "new_fingerprint",
              screenshotStatus: "captured",
            },
          }),
          JSON.stringify({
            sessionId: "session-1",
            turnNumber: 2,
            timestamp: 2,
            snapshot: {
              url: "https://example.com/modal",
              title: "Modal",
              elementCount: 2,
              visibleContentLength: 50,
              scrollY: 0,
            },
            elements: [],
            llmRequest: {
              model: "openai/gpt-5.4-mini",
              modelTier: "executor",
              messageCount: 1,
              toolCount: 0,
              compressionLevel: "none",
              messages: [{ role: "user", content: "Try to continue" }],
            },
            llmResponse: {
              content: "Fallback",
              toolCalls: [],
              finishReason: "stop",
              usage: {
                prompt_tokens: 8,
                completion_tokens: 4,
                total_tokens: 12,
                cost: 0.002,
              },
              durationMs: 80,
            },
            toolExecutions: [],
            events: [],
            progressState: { stagnantTurns: 0, signal: null },
            perception: {
              interpretation: "[No API key - visual perception unavailable.]",
              model: "vision-model",
              durationMs: 5,
              cached: false,
              mode: "element_only",
              source: "fallback",
              freshnessReason: "dom_fallback",
              fallbackReason: "no_api_key",
              screenshotStatus: "missing",
            },
          }),
        ].join("\n") + "\n",
        "utf-8",
      );

      const analysis = reportTestOnly.analyzeTraces(
        [traceFile],
        new Map([
          [
            "session-1",
            {
              sessionId: "session-1",
              startTime: 1,
              endTime: 2,
              query: "  Find   the   continue button on the example page  ",
              startUrl: "https://example.com",
              outcome: "completed",
              turnCount: 2,
              summary: "done",
              metrics: null,
            },
          ],
        ]),
      );

      expect(analysis.turns).toBe(2);
      expect(analysis.traceCount).toBe(1);
      expect(analysis.pageInterpretationTurns).toBe(1);
      expect(analysis.promptUsed).toBe(
        "Find the continue button on the example page",
      );
      expect(analysis.diagnostics).toMatchObject({
        perceptionCalls: 2,
        structuredPerceptionTurns: 1,
        elementOnlyTurns: 1,
        degradedPerceptionTurns: 1,
        perceptionFreshness: {
          new_fingerprint: 1,
          dom_fallback: 1,
        },
        perceptionFallbacks: {
          no_api_key: 1,
        },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders the required final report format", () => {
    const markdown = reportTestOnly.buildMarkdownReport(
      [
        {
          rec: {
            name: "modal-dismiss",
            passed: true,
            durationMs: 10_000,
            traceFiles: ["trace-1.jsonl"],
          },
          analysis: {
            turns: 3,
            cost: 0.003,
            traceCount: 1,
            pageInterpretationTurns: 2,
            promptUsed: "Dismiss the cookie popup and continue to checkout",
            toolCounts: {},
            repeatedTools: [],
            model: "openai/gpt-5.4-mini",
            turnDetails: [],
            runIds: [],
            sessionIds: ["session-1"],
            skillsUsed: [],
            nodeSkills: [],
            diagnostics: {
              ...reportTestOnly.createEmptyDiagnostics(),
              perceptionCalls: 3,
              structuredPerceptionTurns: 2,
              vlScreenshotTurns: 1,
              perceptionCacheHits: 1,
              perceptionFreshness: {
                new_fingerprint: 2,
                fingerprint_cache_hit: 1,
              },
              perceptionScreenshots: {
                captured: 2,
                cached: 1,
              },
            },
            failureClass: null,
            formMetrics: null,
          },
        },
      ],
      {
        provider: "fireworks",
        lane: "dev",
        configuredExecutorModel: "openai/gpt-5.4-mini",
        diagnosticMode: false,
      },
      new Date("2026-04-18T12:34:56.000Z"),
    );

    expect(markdown).toContain("# E2E Final Report");
    expect(markdown).toContain("Date: 2026-04-18 12:34:56 UTC");
    expect(markdown).toContain(
      "Scope: 1 case(s); lane=dev; provider=fireworks; executor=openai/gpt-5.4-mini; diagnostic=off",
    );
    expect(markdown).toContain("Overall result: 1/1 passed");
    expect(markdown).toContain(
      "| Case | Success | Turns | Perceptions | Traces | Prompt used |",
    );
    expect(markdown).toContain(
      "| modal-dismiss | Yes | 3 | 2 | 1 | Dismiss the cookie popup and continue to checkout |",
    );
    expect(markdown).toContain("## Metric Definitions");
    expect(markdown).toContain("## Stability Notes");
    expect(markdown).toContain(
      "- Perception path mix: structured 2, VL screenshot 1, element-only 0.",
    );
  });
});
