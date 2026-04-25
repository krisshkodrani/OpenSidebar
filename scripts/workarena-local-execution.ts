#!/usr/bin/env tsx

import {
  getArenaTask,
  getArenaTasksByTag,
  type ArenaTask,
} from "../apps/extension/tests/e2e/arena/tasks";
import {
  type WorkArenaExecutionResult,
  safeFilePart,
  today,
  writeJsonReport,
} from "./workarena-adapter-lib.js";
import { validateWorkArenaReport } from "./workarena-report-schema.js";

function parseArgs(): {
  taskId: string | null;
  tag: string;
  json: boolean;
  noReport: boolean;
  list: boolean;
} {
  const args = process.argv.slice(2);
  const taskArg = args[args.indexOf("--task") + 1];
  const tagArg = args[args.indexOf("--tag") + 1];
  return {
    taskId: taskArg && !taskArg.startsWith("--") ? taskArg : null,
    tag: tagArg && !tagArg.startsWith("--") ? tagArg : "workarena-gap",
    json: args.includes("--json"),
    noReport: args.includes("--no-report"),
    list: args.includes("--list"),
  };
}

function listTasks(tag: string): void {
  const tasks = getArenaTasksByTag(tag);
  console.log("\n[workarena:local] Local WorkArena-style tasks");
  console.log(`[workarena:local] Tag: ${tag}`);
  console.log(`[workarena:local] Count: ${tasks.length}`);
  console.log("");
  for (const task of tasks) {
    console.log(
      `[workarena:local]   - ${task.id} | ${task.tier} | ${task.validator}`,
    );
  }
}

function resolveTask(taskId: string | null, tag: string): ArenaTask {
  if (taskId) {
    const task = getArenaTask(taskId);
    if (!task) throw new Error(`Unknown arena task id: ${taskId}`);
    return task;
  }
  const tasks = getArenaTasksByTag(tag);
  if (tasks.length === 0) {
    throw new Error(`No local arena tasks found for tag: ${tag}`);
  }
  return tasks[0];
}

function tagsToCategory(task: ArenaTask): string | null {
  const preferred = ["crm", "ticket", "email", "chat", "messaging", "workflow", "document"];
  return preferred.find((tag) => task.tags.includes(tag)) ?? null;
}

function buildExecutionContract(task: ArenaTask): WorkArenaExecutionResult {
  return {
    benchmark: "workarena",
    mode: "agent-execution",
    ready: true,
    status: "pending",
    failureStage: null,
    task: {
      taskId: `local.${task.id}`,
      envId: `local-fixture/${task.id}`,
      seed: 0,
      category: tagsToCategory(task),
      kind: "compositional",
      level: null,
      className: "LocalArenaFixtureTask",
    },
    prompt: {
      source: "local_fixture_prompt",
      value: task.prompt,
      goalObject: [{ type: "text", text: task.prompt }],
    },
    browser: {
      startUrl: task.startRoute,
      activeUrl: task.startRoute,
      openPages: [task.startRoute],
      openPageTitles: [task.title],
    },
    agent: {
      provider: "offline",
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
      message: `Pending local execution; validator is ${task.validator}.`,
      details: {
        localTaskId: task.id,
        title: task.title,
        tier: task.tier,
        sourceFile: task.sourceFile,
        sourceCase: task.sourceCase,
        validator: task.validator,
        validatorKind: task.validatorKind,
        tags: [...task.tags],
        maxTurns: task.maxTurns,
        timeoutMs: task.timeoutMs,
        allowNavigation: Boolean(task.allowNavigation),
        description: task.description,
        notes: task.notes ?? null,
      },
    },
    timings: {
      resetMs: 0,
      agentMs: null,
      validationMs: null,
      totalMs: null,
    },
    errors: [],
    reports: {},
  };
}

function writeReport(result: WorkArenaExecutionResult): string {
  return writeJsonReport(
    result,
    `workarena-local-execution-${today()}-${safeFilePart(result.task.taskId)}.json`,
  );
}

function printHuman(result: WorkArenaExecutionResult): void {
  console.log("\n[workarena:local] Local WorkArena execution contract");
  console.log(`[workarena:local] Ready: ${result.ready ? "yes" : "no"}`);
  console.log(`[workarena:local] Status: ${result.status}`);
  console.log(`[workarena:local] Task: ${result.task.taskId}`);
  console.log(`[workarena:local] Env: ${result.task.envId}`);
  console.log(`[workarena:local] Category: ${result.task.category ?? "uncategorized"}`);
  console.log(`[workarena:local] Start route: ${result.browser.startUrl ?? "(none)"}`);
  if (result.reports.executionReportPath) {
    console.log(`[workarena:local] Report: ${result.reports.executionReportPath}`);
  }
  console.log("");
  console.log(`[workarena:local] Prompt: ${result.prompt.value}`);
  console.log(`[workarena:local] Validator: ${String(result.validation.details.validator)}`);
  console.log("[workarena:local] No browser, OpenSidebar, ServiceNow, or LLM run was started.");
}

function main(): void {
  const args = parseArgs();
  if (args.list) {
    listTasks(args.tag);
    return;
  }

  const task = resolveTask(args.taskId, args.tag);
  const result = buildExecutionContract(task);
  const errors = validateWorkArenaReport(result);
  if (errors.length > 0) {
    throw new Error(
      `generated local execution report failed schema validation: ${errors
        .map((error) => `${error.path}: ${error.message}`)
        .join("; ")}`,
    );
  }

  if (!args.noReport) {
    result.reports.executionReportPath = writeReport(result);
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }
}

main();
