import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, test } from "vitest";
import {
  runTraceLearning,
  type WorkArenaTraceLearningArgs,
} from "../../../../scripts/workarena-trace-learning";
import { WORKARENA_RESET_APPROVAL_MESSAGE } from "../../../../scripts/workarena-safety";
import type { WorkArenaExecutionResult } from "../../../../scripts/workarena-adapter-lib";

function pendingExecutionReport(): WorkArenaExecutionResult {
  return {
    benchmark: "workarena",
    mode: "agent-execution",
    ready: false,
    status: "pending",
    failureStage: null,
    task: {
      taskId: "workarena.servicenow.all-menu",
      envId: "browsergym/workarena.servicenow.all-menu",
      seed: 0,
      category: null,
      kind: "compositional",
      level: null,
      className: "UnknownWorkArenaTask",
    },
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
      },
    },
    timings: {
      resetMs: null,
      agentMs: null,
      validationMs: null,
      totalMs: null,
    },
    errors: [],
    reports: {},
  };
}

function traceLearningArgs(
  reportPath: string,
  includePending: boolean,
): WorkArenaTraceLearningArgs {
  return {
    files: [reportPath],
    includePending,
    json: true,
    noReport: true,
    output: null,
  };
}

describe("WorkArena trace learning", () => {
  test("counts pending/no-trace reports as skipped only when they are excluded", () => {
    const dir = mkdtempSync(join(tmpdir(), "opensidebar-trace-learning-"));
    try {
      const reportPath = join(dir, "workarena-handoff-pending.json");
      writeFileSync(
        reportPath,
        JSON.stringify(pendingExecutionReport(), null, 2),
        "utf-8",
      );

      const defaultResult = runTraceLearning(traceLearningArgs(reportPath, false));
      expect(defaultResult).toMatchObject({
        reportPath: null,
        skippedPending: 1,
        records: [],
      });

      const includedResult = runTraceLearning(traceLearningArgs(reportPath, true));
      expect(includedResult).toMatchObject({
        reportPath: null,
        skippedPending: 0,
        records: [
          {
            taskId: "workarena.servicenow.all-menu",
            status: "pending",
            fixLayer: "Pending/no agent run",
            traces: 0,
          },
        ],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
