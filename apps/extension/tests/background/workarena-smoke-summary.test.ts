import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, test } from "vitest";
import {
  buildSmokeSummary,
  renderSmokeFollowUp,
} from "../../../../scripts/workarena-smoke-summary";
import { WORKARENA_RESET_APPROVAL_MESSAGE } from "../../../../scripts/workarena-safety";
import type { WorkArenaExecutionResult } from "../../../../scripts/workarena-adapter-lib";

function executionReport(traceFile: string): WorkArenaExecutionResult {
  return {
    benchmark: "workarena",
    mode: "agent-execution",
    ready: true,
    status: "failed",
    failureStage: "agent_run",
    task: {
      taskId: "workarena.servicenow.all-menu",
      envId: "browsergym/workarena.servicenow.all-menu",
      seed: 0,
      category: "menu",
      kind: "atomic",
      level: null,
      className: "AllMenuTask",
    },
    prompt: {
      source: "workarena_goal_after_reset",
      value: "Open the all menu",
      goalObject: [],
    },
    browser: {
      startUrl: "https://example.test/start",
      activeUrl: "https://example.test/end",
      openPages: [],
      openPageTitles: [],
    },
    agent: {
      provider: "fireworks",
      executorModel: null,
      plannerModel: null,
      traceIds: ["trace-1"],
      traceFiles: [traceFile],
      finalAnswer: null,
      turns: null,
      perceptions: null,
      toolCalls: 1,
      toolExecutions: 1,
      tokens: {
        input: 10,
        output: 5,
        total: 15,
      },
      costUsd: 0.001,
    },
    validation: {
      passed: false,
      score: 0,
      message: "Agent did not complete",
      details: {
        agentTerminalReason: "task_failed",
      },
    },
    timings: {
      resetMs: 1,
      agentMs: 2,
      validationMs: 3,
      totalMs: 6,
    },
    errors: [{ stage: "agent_run", message: "Agent did not complete" }],
    reports: {},
  };
}

function pendingApprovalReport(): WorkArenaExecutionResult {
  const report = executionReport("");
  return {
    ...report,
    ready: false,
    status: "pending",
    failureStage: null,
    prompt: {
      source: "workarena_goal_after_reset",
      value: "",
      goalObject: [],
    },
    browser: {
      startUrl: null,
      activeUrl: null,
      openPages: [],
      openPageTitles: [],
    },
    agent: {
      provider: "not_started",
      executorModel: null,
      plannerModel: null,
      traceIds: [],
      traceFiles: [],
      finalAnswer: null,
      turns: null,
      perceptions: null,
      toolCalls: null,
      toolExecutions: null,
      tokens: {
        input: null,
        output: null,
        total: null,
      },
      costUsd: null,
    },
    validation: {
      passed: null,
      score: null,
      message: WORKARENA_RESET_APPROVAL_MESSAGE,
      details: {
        allowServiceNowReset: false,
        showBrowser: false,
      },
    },
    timings: {
      resetMs: null,
      agentMs: null,
      validationMs: null,
      totalMs: null,
    },
    errors: [],
  };
}

describe("WorkArena smoke summary", () => {
  test("builds the RFC-005 follow-up template from an agent execution report", () => {
    const dir = mkdtempSync(join(tmpdir(), "opensidebar-smoke-summary-"));
    try {
      const traceFile = join(dir, "trace.jsonl");
      writeFileSync(
        traceFile,
        [
          JSON.stringify({
            runId: "run-1",
            turnNumber: 1,
            snapshot: { elementCount: 10 },
            llmRequest: {
              messages: [
                {
                  role: "user",
                  content: "Task\n\nPage Interpretation\nLOCATION: Menu",
                },
              ],
            },
            toolExecutions: [
              {
                toolName: "click_element",
                success: false,
                error: "button not found",
              },
            ],
            events: [],
          }),
        ].join("\n") + "\n",
        "utf-8",
      );
      const reportPath = join(dir, "workarena-handoff.json");
      writeFileSync(
        reportPath,
        JSON.stringify(executionReport(traceFile), null, 2),
        "utf-8",
      );

      const summary = buildSmokeSummary(
        reportPath,
      );
      const markdown = renderSmokeFollowUp(
        summary,
        new Date("2026-05-16T12:00:00.000Z"),
      );

      expect(summary).toMatchObject({
        taskId: "workarena.servicenow.all-menu",
        validationPassed: false,
        runIds: ["run-1"],
        turns: 1,
        perceptions: 1,
        nextFixLayer: "tool/runtime",
        recommendedAction: "Runtime fix",
      });
      expect(markdown).toContain("# WorkArena Smoke Follow-Up");
      expect(markdown).toContain("Feature-list item: HR-005");
      expect(markdown).toContain("Primary evidence:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("calls out pending ServiceNow reset approval gates", () => {
    const dir = mkdtempSync(join(tmpdir(), "opensidebar-smoke-summary-"));
    try {
      const reportPath = join(dir, "workarena-handoff-pending.json");
      writeFileSync(
        reportPath,
        JSON.stringify(pendingApprovalReport(), null, 2),
        "utf-8",
      );

      const summary = buildSmokeSummary(reportPath);
      const markdown = renderSmokeFollowUp(
        summary,
        new Date("2026-05-16T12:00:00.000Z"),
      );

      expect(summary).toMatchObject({
        failureClass: "approval_gate",
        nextFixLayer: "approval required",
        recommendedAction:
          "Get explicit approval acknowledging ServiceNow reset/mutation before running --allow-servicenow-reset",
        diagnostics: ["approval required: --allow-servicenow-reset"],
      });
      expect(markdown).toContain("Failure class: approval_gate");
      expect(markdown).toContain("Next fix layer: approval required");
      expect(markdown).toContain("approvalGate=Pass --allow-servicenow-reset");
      expect(markdown).toContain("reset or mutate the remote ServiceNow instance");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
