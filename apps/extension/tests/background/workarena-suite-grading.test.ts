import { describe, expect, test } from "vitest";
import type { WorkArenaExecutionResult } from "../../../../scripts/workarena-adapter-lib";
import {
  aggregateWorkArenaReports,
  passedByWorkArenaScore,
} from "../../../../scripts/workarena-grading-lib";
import {
  parseSeedSpec,
  parseSuiteArgs,
  selectSuiteTargets,
  suiteReportFileStem,
  suiteRunFromAttempt,
  type WorkArenaSuiteReport,
} from "../../../../scripts/workarena-suite-lib";
import { validateWorkArenaReport } from "../../../../scripts/workarena-report-schema";

function executionReport(
  taskId: string,
  category: string,
  score: number | null,
  validationPassed: boolean | null,
  turns: number,
): WorkArenaExecutionResult {
  const passed = score !== null ? score > 0 : validationPassed === true;
  return {
    benchmark: "workarena",
    mode: "agent-execution",
    ready: true,
    status: passed ? "passed" : "failed",
    failureStage: passed ? null : "validation",
    task: {
      taskId,
      envId: `browsergym/${taskId}`,
      seed: 0,
      category,
      kind: "atomic",
      level: null,
      className: "TestTask",
    },
    prompt: {
      source: "workarena_goal_after_reset",
      value: `Run ${taskId}`,
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
      traceIds: [`trace-${taskId}`],
      traceFiles: [`traces/${taskId}.jsonl`],
      finalAnswer: null,
      turns,
      perceptions: turns,
      toolCalls: turns + 1,
      toolExecutions: turns,
      tokens: {
        input: turns * 10,
        output: turns,
        total: turns * 11,
      },
      costUsd: 0,
    },
    validation: {
      passed: validationPassed,
      score,
      message: passed ? "Nice work" : "Wrong value",
      details: {
        agentTerminalReason: "task_completed",
      },
    },
    timings: {
      resetMs: 1,
      agentMs: 2,
      validationMs: 3,
      totalMs: 6,
    },
    errors: passed ? [] : [{ stage: "validation", message: "Wrong value" }],
    reports: {},
  };
}

describe("WorkArena suite parsing", () => {
  test("parses seed ranges and suite options", () => {
    expect(parseSeedSpec("0,2..4,4")).toEqual([0, 2, 3, 4]);

    const args = parseSuiteArgs([
      "--suite",
      "atomic",
      "--categories",
      "menu,service catalog",
      "--seeds",
      "0..2",
      "--retries",
      "1",
      "--provider",
      "fireworks",
    ]);

    expect(args.suite).toBe("atomic");
    expect(args.categories).toEqual(["menu", "service-catalog"]);
    expect(args.seeds).toEqual([0, 1, 2]);
    expect(args.retries).toBe(1);
    expect(args.provider).toBe("fireworks");
  });

  test("selects category-filtered targets across requested seeds", () => {
    const args = parseSuiteArgs([
      "--suite",
      "atomic",
      "--category",
      "service-catalog",
      "--seeds",
      "0,1",
    ]);
    const targets = selectSuiteTargets(
      {
        benchmark: "workarena",
        suite: "atomic",
        count: 2,
        categories: [],
        tasks: [
          {
            id: "workarena.servicenow.all-menu",
            category: "menu",
            kind: "atomic",
            level: null,
            seed: null,
            className: "MenuTask",
          },
          {
            id: "workarena.servicenow.order-standard-laptop",
            category: "service catalog",
            kind: "atomic",
            level: null,
            seed: null,
            className: "CatalogTask",
          },
        ],
      },
      args,
    );

    expect(targets.map((target) => `${target.task.id}:${target.seed}`)).toEqual([
      "workarena.servicenow.order-standard-laptop:0",
      "workarena.servicenow.order-standard-laptop:1",
    ]);
  });

  test("builds scoped suite report names instead of date-only names", () => {
    const categoryStem = suiteReportFileStem({
      generatedAt: "2026-05-09T12:34:56.789Z",
      suite: "atomic",
      categories: ["dashboard", "knowledge", "menu"],
      seeds: [0],
      runs: [],
    });

    expect(categoryStem).toBe(
      "workarena-suite-2026-05-09-dashboard-knowledge-menu-seed-0-123456789",
    );

    const singleTaskStem = suiteReportFileStem({
      generatedAt: "2026-05-09T12:34:57.001Z",
      suite: "atomic",
      categories: ["all"],
      seeds: [0],
      runs: [
        {
          taskId: "workarena.servicenow.sort-change-request-list",
          category: "list-sort",
          seed: 0,
          attempt: 1,
          status: "passed",
          passed: true,
          score: 1,
          reportPath: "sort-change-request-list.json",
          turns: 2,
          traces: 1,
          failureStage: null,
          validationMessage: "Nice work",
          prompt: null,
          warnings: [],
        },
      ],
    });

    expect(singleTaskStem).toBe(
      "workarena-suite-2026-05-09-workarena.servicenow.sort-change-request-list-seed-0-123457001",
    );
  });
});

describe("WorkArena grading", () => {
  test("uses score as the pass signal when score and done disagree", () => {
    const failed = executionReport("workarena.servicenow.create-incident", "form", 0, true, 12);

    expect(passedByWorkArenaScore(failed)).toBe(false);
  });

  test("aggregates pass rates and validates grade/suite report shapes", () => {
    const inputs = [
      {
        reportPath: "one.json",
        result: executionReport("workarena.servicenow.all-menu", "menu", 1, true, 4),
        attempt: 1,
      },
      {
        reportPath: "two.json",
        result: executionReport("workarena.servicenow.create-incident", "form", 0, true, 10),
        attempt: 1,
      },
    ];
    const grade = aggregateWorkArenaReports(inputs);

    expect(grade.targetCount).toBe(2);
    expect(grade.passAt1).toBe(0.5);
    expect(grade.categoryBalancedPassAt1).toBe(0.5);
    expect(validateWorkArenaReport(grade)).toEqual([]);

    const suite: WorkArenaSuiteReport = {
      benchmark: "workarena",
      mode: "suite",
      generatedAt: "2026-04-29T00:00:00.000Z",
      suite: "atomic",
      categories: ["all"],
      seeds: [0],
      maxTurns: 20,
      timeoutMs: 600000,
      retries: 0,
      provider: null,
      allowServiceNowReset: true,
      status: "failed",
      planned: 2,
      completed: 2,
      skipped: 0,
      runs: grade.attempts.map(suiteRunFromAttempt),
      grade,
      reports: {},
    };

    expect(validateWorkArenaReport(suite)).toEqual([]);
  });
});
