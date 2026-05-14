import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  collectRunWarnings,
  stampManifest,
  summarizeVideoReviewWarnings,
} from "../../../../scripts/run-e2e-video-review";
import { buildSummary } from "../../../../scripts/run-e2e-video-suite";

describe("e2e video artifact reporting", () => {
  it("stamps teardown warnings into review manifests with structured categories", () => {
    const dir = mkdtempSync(join(tmpdir(), "opensidebar-video-review-"));
    try {
      const logPath = join(dir, "vitest.log");
      const manifestPath = join(dir, "manifest.json");
      const closeWarning =
        "[e2e] Browser close did not finish cleanly (Browser close timed out after 3000ms); killed browser process.";
      writeFileSync(logPath, `${closeWarning}\n`, "utf-8");
      writeFileSync(
        manifestPath,
        `${JSON.stringify({ schemaVersion: "2026-05-14", warnings: [] })}\n`,
        "utf-8",
      );

      const warnings = collectRunWarnings({
        logPath,
        timedOut: false,
        timeoutMs: 10_000,
        manifestCount: 1,
      });
      expect(warnings).toEqual([
        "Browser close did not finish cleanly (Browser close timed out after 3000ms); killed browser process.",
      ]);
      expect(
        summarizeVideoReviewWarnings(warnings).byKind.teardown_warning,
      ).toBe(1);

      stampManifest({
        manifestPath,
        args: {
          testFile: "apps/extension/tests/e2e/summarize.test.ts",
          grep: null,
          label: "summarize",
          retry: 0,
          timeoutMs: 10_000,
        },
        exitCode: 0,
        timedOut: false,
        startedAt: "2026-05-14T00:00:00.000Z",
        finishedAt: "2026-05-14T00:00:01.000Z",
        logPath,
        warnings,
      });

      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      expect(manifest.warnings).toEqual(warnings);
      expect(manifest.warningSummary.byKind.teardown_warning).toBe(1);
      expect(manifest.vitest.warningSummary.byKind.teardown_warning).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stamps trace metrics into review manifests", () => {
    const dir = mkdtempSync(join(tmpdir(), "opensidebar-video-metrics-"));
    try {
      const logPath = join(dir, "vitest.log");
      const tracePath = join(dir, "trace.jsonl");
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(logPath, "", "utf-8");
      writeFileSync(
        tracePath,
        `${JSON.stringify({
          traceKind: "agent.turn",
          runId: "run-1",
          turnNumber: 1,
          recordedAt: "2026-05-14T00:00:00.500Z",
          llmRequest: {
            messages: [
              {
                role: "system",
                content: "Page Interpretation: login form visible",
              },
            ],
          },
          llmResponse: {
            toolCalls: [
              {
                function: {
                  name: "type_text",
                  arguments: JSON.stringify({
                    id: 2,
                    text: "admin@example.com",
                  }),
                },
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
            },
            durationMs: 250,
          },
          toolExecutions: [
            {
              toolName: "type_text",
              success: true,
            },
          ],
        })}\n`,
        "utf-8",
      );
      writeFileSync(
        manifestPath,
        `${JSON.stringify({
          schemaVersion: "2026-05-14",
          warnings: [],
          traceFiles: [tracePath],
        })}\n`,
        "utf-8",
      );

      stampManifest({
        manifestPath,
        args: {
          testFile: "apps/extension/tests/e2e/login.test.ts",
          grep: null,
          label: "login",
          retry: 0,
          timeoutMs: 10_000,
        },
        exitCode: 0,
        timedOut: false,
        startedAt: "2026-05-14T00:00:00.000Z",
        finishedAt: "2026-05-14T00:00:01.000Z",
        logPath,
        warnings: [],
      });

      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      expect(manifest.metrics.executorTurns).toBe(1);
      expect(manifest.metrics.perceptionTurns).toBe(1);
      expect(manifest.metrics.toolCounts.type_text).toBe(1);
      expect(manifest.metrics.firstStateChangingAction.toolName).toBe(
        "type_text",
      );
      expect(manifest.metrics.llmUsage.executorTotalTokens).toBe(15);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("carries review warnings into the video suite summary", () => {
    const dir = mkdtempSync(join(tmpdir(), "opensidebar-video-suite-"));
    try {
      const summaryPath = join(dir, "summary.json");
      const closeWarning =
        "[e2e] Browser close did not finish cleanly (Browser close timed out after 3000ms); killed browser process.";
      writeFileSync(
        summaryPath,
        `${JSON.stringify({
          result: "passed",
          warnings: [closeWarning],
          warningSummary: summarizeVideoReviewWarnings([closeWarning]),
        })}\n`,
        "utf-8",
      );

      const suiteSummary = buildSummary({
        startedAt: "2026-05-14T00:00:00.000Z",
        finishedAt: "2026-05-14T00:00:01.000Z",
        suites: ["easy"],
        timeoutMs: 10_000,
        retry: 0,
        results: [
          {
            suite: "easy",
            file: "summarize.test.ts",
            label: "summarize",
            exitCode: 0,
            startedAt: "2026-05-14T00:00:00.000Z",
            finishedAt: "2026-05-14T00:00:01.000Z",
            summaries: [summaryPath],
          },
        ],
      });

      expect(suiteSummary.warningSummary.byKind.teardown_warning).toBe(1);
      expect(suiteSummary.results[0].warnings).toEqual([closeWarning]);
      expect(
        suiteSummary.results[0].warningSummary.byKind.teardown_warning,
      ).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
