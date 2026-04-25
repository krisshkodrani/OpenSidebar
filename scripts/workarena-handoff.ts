#!/usr/bin/env tsx

import { execSync, spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { createInterface, type Interface } from "readline";
import {
  extractDoneSummary,
  filterTraceFilesByWorkspace,
  findAllNewTraceFiles,
  readTrace,
} from "../apps/extension/tests/e2e/helpers/diagnostics";
import { createE2EHarness } from "../apps/extension/tests/e2e/helpers/harness";
import {
  importPlaywrightStorageState,
  type StorageStateImportResult,
} from "../apps/extension/tests/e2e/helpers/session-state";
import {
  getActiveTabId,
  getMonitoredEvents,
  navigateAndWait,
  resetExtensionState,
  sendUserChat,
  updateUserSettings,
} from "../apps/extension/tests/e2e/helpers/utils";
import {
  type DoctorResult,
  type ReadinessStatus,
  type WorkArenaExecutionFailureStage,
  type WorkArenaExecutionResult,
  PROJECT_ROOT,
  compactGoal,
  loadDotEnv,
  readinessLabel,
  resolvePythonExecutable,
  runWorkArenaDoctor,
  safeFilePart,
  today,
  withReadiness,
  writeJsonReport,
} from "./workarena-adapter-lib.js";
import { validateWorkArenaReport } from "./workarena-report-schema.js";
import { resolve } from "path";
import { existsSync, readFileSync } from "fs";

const SESSION_BRIDGE_PATH = resolve(PROJECT_ROOT, "scripts", "workarena-session-bridge.py");

type JsonRecord = Record<string, unknown>;

type HandoffArgs = {
  taskId: string | null;
  seed: number;
  maxTurns: number;
  timeoutMs: number;
  json: boolean;
  noReport: boolean;
  noBuild: boolean;
  showBrowser: boolean;
  allowServiceNowReset: boolean;
};

type AgentTerminal = {
  ok: boolean;
  reason: string;
  events: JsonRecord[];
};

type TraceMetrics = {
  traceIds: string[];
  traceFiles: string[];
  finalAnswer: string | null;
  turns: number;
  perceptions: number;
  toolCalls: number;
  toolExecutions: number;
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  costUsd: number;
};

function statusSummary(record: JsonRecord | null): JsonRecord | null {
  if (!record) return null;
  return {
    ok: typeof record.ok === "boolean" ? record.ok : null,
    status: typeof record.status === "string" ? record.status : null,
    durationMs: typeof record.durationMs === "number" ? record.durationMs : null,
    error: typeof record.error === "string" ? record.error : null,
  };
}

function parseArgs(): HandoffArgs {
  const args = process.argv.slice(2);
  const taskArg = args[args.indexOf("--task") + 1];
  const seedArg = Number.parseInt(args[args.indexOf("--seed") + 1] ?? "", 10);
  const maxTurnsArg = Number.parseInt(args[args.indexOf("--max-turns") + 1] ?? "", 10);
  const timeoutArg = Number.parseInt(args[args.indexOf("--timeout-ms") + 1] ?? "", 10);
  return {
    taskId: taskArg && !taskArg.startsWith("--") ? taskArg : null,
    seed: Number.isFinite(seedArg) ? seedArg : 42,
    maxTurns: Number.isFinite(maxTurnsArg) ? maxTurnsArg : 30,
    timeoutMs: Number.isFinite(timeoutArg) ? timeoutArg : 600_000,
    json: args.includes("--json"),
    noReport: args.includes("--no-report"),
    noBuild: args.includes("--no-build"),
    showBrowser: args.includes("--show-browser"),
    allowServiceNowReset:
      args.includes("--allow-servicenow-reset") || args.includes("--reset"),
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(record: JsonRecord, key: string): string | null {
  return typeof record[key] === "string" ? record[key] : null;
}

function numberValue(record: JsonRecord, key: string): number | null {
  return typeof record[key] === "number" && Number.isFinite(record[key])
    ? record[key]
    : null;
}

function arrayValue<T = unknown>(record: JsonRecord, key: string): T[] {
  return Array.isArray(record[key]) ? (record[key] as T[]) : [];
}

function nestedRecord(record: JsonRecord, key: string): JsonRecord {
  return isRecord(record[key]) ? (record[key] as JsonRecord) : {};
}

class WorkArenaSessionBridgeClient {
  private child: ChildProcessWithoutNullStreams;
  private lines: JsonRecord[] = [];
  private waiters: Array<(line: JsonRecord) => void> = [];
  private stderr = "";
  private readline: Interface;
  private exited = false;

  constructor() {
    this.child = spawn(resolvePythonExecutable(), [SESSION_BRIDGE_PATH], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        ...loadDotEnv(),
      },
      windowsHide: true,
    });

    this.child.stderr.on("data", (chunk) => {
      this.stderr += String(chunk);
    });

    this.readline = createInterface({ input: this.child.stdout });
    this.readline.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        this.pushLine(JSON.parse(trimmed) as JsonRecord);
      } catch {
        this.pushLine({
          ok: false,
          status: "invalid_bridge_json",
          error: trimmed.slice(0, 1000),
        });
      }
    });

    this.child.on("exit", () => {
      this.exited = true;
    });
  }

  async description(): Promise<JsonRecord> {
    return await this.nextLine();
  }

  async request(message: JsonRecord): Promise<JsonRecord> {
    if (this.exited) {
      throw new Error(`WorkArena session bridge exited. ${this.stderr.trim()}`);
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
    return await this.nextLine();
  }

  async close(): Promise<void> {
    if (!this.exited) {
      try {
        await this.request({ command: "teardown" });
      } catch {
        // Preserve the main failure; process cleanup follows.
      }
      this.child.stdin.end();
    }

    await new Promise<void>((resolveClose) => {
      const timer = setTimeout(() => {
        if (!this.exited) this.child.kill("SIGKILL");
        resolveClose();
      }, 5_000);
      this.child.once("close", () => {
        clearTimeout(timer);
        resolveClose();
      });
    });
    this.readline.close();
  }

  private pushLine(line: JsonRecord): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(line);
      return;
    }
    this.lines.push(line);
  }

  private nextLine(timeoutMs = 120_000): Promise<JsonRecord> {
    const existing = this.lines.shift();
    if (existing) return Promise.resolve(existing);

    return new Promise((resolveLine, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for WorkArena bridge. ${this.stderr.trim()}`));
      }, timeoutMs);
      this.waiters.push((line) => {
        clearTimeout(timer);
        resolveLine(line);
      });
    });
  }
}

function buildBlockedResult(
  args: HandoffArgs,
  status: WorkArenaExecutionResult["status"],
  failureStage: WorkArenaExecutionFailureStage | null,
  message: string,
): WorkArenaExecutionResult {
  const taskId = args.taskId ?? "unknown";
  return {
    benchmark: "workarena",
    mode: "agent-execution",
    ready: false,
    status,
    failureStage,
    task: {
      taskId,
      envId: `browsergym/${taskId}`,
      seed: args.seed,
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
      message,
      details: {
        allowServiceNowReset: args.allowServiceNowReset,
        showBrowser: args.showBrowser,
      },
    },
    timings: {
      resetMs: null,
      agentMs: null,
      validationMs: null,
      totalMs: null,
    },
    errors:
      failureStage === null
        ? []
        : [
            {
              stage: failureStage,
              message,
            },
          ],
    reports: {},
  };
}

function doctorBlockedResult(
  args: HandoffArgs,
  doctor: DoctorResult,
): WorkArenaExecutionResult {
  const readiness = doctor.readiness ?? "blocked";
  const result = buildBlockedResult(
    args,
    "error",
    "setup",
    `Setup is not fully ready: ${readinessLabel(readiness)}.`,
  );
  result.validation.details = {
    ...result.validation.details,
    doctor,
  };
  return result;
}

function taskFromReset(reset: JsonRecord): WorkArenaExecutionResult["task"] {
  const task = nestedRecord(reset, "task");
  return {
    taskId: stringValue(task, "taskId") ?? "unknown",
    envId: stringValue(task, "envId") ?? "browsergym/unknown",
    seed: numberValue(task, "seed") ?? 0,
    category: stringValue(task, "category"),
    kind: stringValue(task, "kind") === "atomic" ? "atomic" : "compositional",
    level: stringValue(task, "level"),
    className: stringValue(task, "className") ?? "UnknownWorkArenaTask",
  };
}

function promptFromReset(reset: JsonRecord): WorkArenaExecutionResult["prompt"] {
  const prompt = nestedRecord(reset, "prompt");
  return {
    source: "workarena_goal_after_reset",
    value: stringValue(prompt, "value") ?? "",
    goalObject: arrayValue<Record<string, unknown>>(prompt, "goalObject").filter(isRecord),
  };
}

function browserFromReset(reset: JsonRecord): WorkArenaExecutionResult["browser"] {
  const browser = nestedRecord(reset, "browser");
  return {
    startUrl: stringValue(browser, "startUrl"),
    activeUrl: stringValue(browser, "activeUrl"),
    openPages: arrayValue<string>(browser, "openPages").filter(
      (value): value is string => typeof value === "string",
    ),
    openPageTitles: arrayValue<string>(browser, "openPageTitles").filter(
      (value): value is string => typeof value === "string",
    ),
  };
}

function validationFromBridge(
  validation: JsonRecord | null,
): WorkArenaExecutionResult["validation"] {
  if (!validation) {
    return {
      passed: null,
      score: null,
      message: null,
      details: {},
    };
  }
  const payload = nestedRecord(validation, "validation");
  return {
    passed: typeof payload.passed === "boolean" ? payload.passed : null,
    score: numberValue(payload, "score"),
    message: stringValue(payload, "message"),
    details: nestedRecord(payload, "details"),
  };
}

function readTraceMetrics(traceFiles: string[]): TraceMetrics {
  let input = 0;
  let output = 0;
  let total = 0;
  let costUsd = 0;
  let toolCalls = 0;
  let toolExecutions = 0;
  let perceptions = 0;
  const traceIds = new Set<string>();

  for (const filePath of traceFiles) {
    if (!existsSync(filePath)) continue;
    const lines = readFileSync(filePath, "utf-8").trim().split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as any;
        if (typeof entry.runId === "string") traceIds.add(entry.runId);
        const usage = entry.llmResponse?.usage;
        input += Number(usage?.prompt_tokens ?? 0);
        output += Number(usage?.completion_tokens ?? 0);
        total += Number(usage?.total_tokens ?? 0);
        costUsd += Number(usage?.cost ?? 0);
        toolCalls += Array.isArray(entry.llmResponse?.toolCalls)
          ? entry.llmResponse.toolCalls.length
          : 0;
        toolExecutions += Array.isArray(entry.toolExecutions)
          ? entry.toolExecutions.length
          : 0;
        const messages = entry.llmRequest?.messages ?? [];
        if (
          Array.isArray(messages) &&
          messages.some(
            (message) =>
              typeof message?.content === "string" &&
              message.content.includes("Page Interpretation"),
          )
        ) {
          perceptions++;
        }
      } catch {
        // Ignore malformed trace lines in metrics aggregation.
      }
    }
  }

  return {
    traceIds: [...traceIds].sort(),
    traceFiles,
    finalAnswer: extractDoneSummary(traceFiles) || null,
    turns: traceFiles.flatMap((filePath) => readTrace(filePath)).length,
    perceptions,
    toolCalls,
    toolExecutions,
    tokens: { input, output, total },
    costUsd,
  };
}

function summarizeAgentTerminal(terminal: AgentTerminal): JsonRecord {
  const lastStatus = [...terminal.events]
    .reverse()
    .find((event) => event.type === "AGENT_STATUS") ?? null;
  const lastCompletion = [...terminal.events]
    .reverse()
    .find((event) => event.type === "TASK_COMPLETION") ?? null;
  const eventCounts: Record<string, number> = {};
  for (const event of terminal.events) {
    const type = typeof event.type === "string" ? event.type : "unknown";
    eventCounts[type] = (eventCounts[type] ?? 0) + 1;
  }

  return {
    ok: terminal.ok,
    reason: terminal.reason,
    eventCount: terminal.events.length,
    eventCounts,
    lastStatus,
    lastCompletion,
  };
}

async function waitForAgentTerminal(
  worker: Parameters<typeof getMonitoredEvents>[0],
  timeoutMs: number,
  workspaceId: string,
): Promise<AgentTerminal> {
  const start = Date.now();
  let sawActiveStatus = false;

  while (Date.now() - start < timeoutMs) {
    const rawEvents = await getMonitoredEvents(worker);
    const events = rawEvents.filter(
      (event: JsonRecord) =>
        event.workspaceId == null || event.workspaceId === workspaceId,
    );
    const lastCompletion = [...events]
      .reverse()
      .find((event) => event.type === "TASK_COMPLETION");
    const lastStatus = [...events]
      .reverse()
      .find((event) => event.type === "AGENT_STATUS");

    if (lastStatus?.status && lastStatus.status !== "IDLE") {
      sawActiveStatus = true;
    }

    if (lastCompletion?.status === "completed") {
      return { ok: true, reason: "task_completed", events };
    }
    if (lastCompletion?.status === "partial") {
      return { ok: false, reason: "task_partial", events };
    }
    if (lastCompletion?.status === "failed") {
      return { ok: false, reason: "task_failed", events };
    }
    if (lastStatus?.status === "ERROR") {
      return {
        ok: false,
        reason: `agent_error:${String(lastStatus.detail ?? "unknown")}`,
        events,
      };
    }
    if (sawActiveStatus && lastStatus?.status === "IDLE") {
      return { ok: true, reason: "agent_idle", events };
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
  }

  const events = (await getMonitoredEvents(worker)).filter(
    (event: JsonRecord) =>
      event.workspaceId == null || event.workspaceId === workspaceId,
  );
  return { ok: false, reason: "timeout", events };
}

function runBuildIfNeeded(args: HandoffArgs): void {
  if (args.noBuild) return;
  console.log("\n[workarena:handoff] Building extension before handoff run...");
  execSync("cmd /c npm run build", {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    windowsHide: true,
  });
}

async function runAgentAgainstHeldSession(args: HandoffArgs): Promise<WorkArenaExecutionResult> {
  if (!args.taskId) {
    return buildBlockedResult(args, "error", "setup", "--task is required");
  }

  const start = Date.now();
  const doctor = withReadiness(runWorkArenaDoctor(false));
  if (!args.allowServiceNowReset) {
    return buildBlockedResult(
      args,
      "pending",
      null,
      "Pass --allow-servicenow-reset after confirming remote instance use is intended.",
    );
  }
  if (!doctor.ready) {
    return doctorBlockedResult(args, doctor);
  }

  runBuildIfNeeded(args);

  const bridge = new WorkArenaSessionBridgeClient();
  let bridgeDescription: JsonRecord | null = null;
  let reset: JsonRecord | null = null;
  let exportSession: JsonRecord | null = null;
  let validation: JsonRecord | null = null;
  let harnessStarted = false;
  const harness = createE2EHarness({
    maxTurns: args.maxTurns,
    testLabel: `workarena-handoff-${safeFilePart(args.taskId)}`,
  });

  try {
    bridgeDescription = await bridge.description();
    reset = await bridge.request({
      command: "reset",
      taskId: args.taskId,
      seed: args.seed,
      allowServiceNowReset: true,
      showBrowser: args.showBrowser,
    });
    if (reset.status !== "reset_succeeded") {
      return buildErroredExecution(args, reset, "reset", start);
    }

    exportSession = await bridge.request({ command: "export_session" });
    if (exportSession.status !== "session_exported") {
      return buildErroredExecution(args, exportSession, "reset", start, reset);
    }

    const task = taskFromReset(reset);
    const prompt = promptFromReset(reset);
    const browser = browserFromReset(reset);
    const activeUrl = nestedRecord(exportSession, "browser").activeUrl;
    const targetUrl =
      typeof activeUrl === "string" && activeUrl.length > 0
        ? activeUrl
        : browser.activeUrl;
    if (!targetUrl) {
      return buildErroredExecution(
        args,
        { error: "No active WorkArena URL was exported", status: "missing_active_url" },
        "reset",
        start,
        reset,
      );
    }
    if (!prompt.value) {
      return buildErroredExecution(
        args,
        { error: "No WorkArena goal was exported", status: "missing_goal" },
        "reset",
        start,
        reset,
      );
    }

    await harness.beforeAllHook();
    harnessStarted = true;
    await harness.beforeEachHook();

    if (!harness.apiKey) {
      return buildErroredExecution(
        args,
        { error: `API key for E2E provider '${harness.providerMode}' is missing` },
        "extension_launch",
        start,
        reset,
      );
    }

    await updateUserSettings(harness.ctx, { allowNavigation: true });
    const storageImport: StorageStateImportResult =
      await importPlaywrightStorageState(harness.page, exportSession.storageState);
    await navigateAndWait(harness.page, targetUrl);
    await harness.page.bringToFront();
    const importedPageUrl = harness.page.url();

    const tabId = await getActiveTabId(harness.ctx.serviceWorker);
    if (tabId <= 0) {
      return buildErroredExecution(
        args,
        { error: "Failed to resolve an active tab for the WorkArena page" },
        "extension_launch",
        start,
        reset,
      );
    }

    const agentStart = Date.now();
    const workspaceId = await sendUserChat(harness.ctx, prompt.value, tabId);
    const terminal = await waitForAgentTerminal(
      harness.ctx.serviceWorker,
      args.timeoutMs,
      workspaceId,
    );
    const agentMs = Date.now() - agentStart;
    const finalOpenSidebarUrl = harness.page.url();

    const traceSummary = await harness.printTraceSummary(workspaceId);
    const traceFiles = filterTraceFilesByWorkspace(
      findAllNewTraceFiles(harness.tracesBefore),
      workspaceId,
    );
    const metrics = readTraceMetrics(traceFiles.length > 0 ? traceFiles : traceSummary.traceFiles);

    const validationStart = Date.now();
    validation = await bridge.request({ command: "validate" });
    const validationMs = Date.now() - validationStart;
    const validationResult = validationFromBridge(validation);
    const passed = validationResult.passed === true;
    const status: WorkArenaExecutionResult["status"] = passed
      ? "passed"
      : terminal.ok
        ? "failed"
        : "failed";

    return {
      benchmark: "workarena",
      mode: "agent-execution",
      ready: true,
      status,
      failureStage: passed ? null : terminal.ok ? "validation" : "agent_run",
      task,
      prompt,
      browser: {
        ...browser,
        activeUrl: targetUrl,
      },
      agent: {
        provider: harness.providerMode,
        executorModel: process.env.E2E_EXECUTOR_MODEL || null,
        plannerModel: process.env.E2E_PLANNER_MODEL || null,
        traceIds: metrics.traceIds,
        traceFiles: metrics.traceFiles,
        finalAnswer: metrics.finalAnswer,
        turns: metrics.turns,
        perceptions: metrics.perceptions,
        toolCalls: metrics.toolCalls,
        toolExecutions: metrics.toolExecutions,
        tokens: metrics.tokens,
        costUsd: metrics.costUsd,
      },
      validation: {
        ...validationResult,
        details: {
          ...validationResult.details,
          agentTerminalReason: terminal.reason,
          agentEventCount: terminal.events.length,
          agentTerminal: summarizeAgentTerminal(terminal),
          bridgeStatuses: {
            description: statusSummary(bridgeDescription),
            reset: statusSummary(reset),
            exportSession: statusSummary(exportSession),
            validation: statusSummary(validation),
          },
          storageImport,
          importedPageUrl,
          finalOpenSidebarUrl,
        },
      },
      timings: {
        resetMs: numberValue(reset, "durationMs"),
        agentMs,
        validationMs,
        totalMs: Date.now() - start,
      },
      errors: passed
        ? []
        : [
            {
              stage: terminal.ok ? "validation" : "agent_run",
              message: terminal.ok
                ? validationResult.message ?? "WorkArena validation did not pass"
                : terminal.reason,
            },
          ],
      reports: {},
    };
  } finally {
    if (harnessStarted) {
      await resetExtensionState(harness.ctx).catch(() => {});
      await harness.afterAllHook().catch(() => {});
    }
    await bridge.close().catch(() => {});
  }
}

function buildErroredExecution(
  args: HandoffArgs,
  source: JsonRecord,
  stage: WorkArenaExecutionFailureStage,
  start: number,
  reset: JsonRecord | null = null,
): WorkArenaExecutionResult {
  const message = stringValue(source, "error") ?? stringValue(source, "status") ?? "unknown";
  const task = reset ? taskFromReset(reset) : {
    taskId: args.taskId ?? "unknown",
    envId: `browsergym/${args.taskId ?? "unknown"}`,
    seed: args.seed,
    category: null,
    kind: "compositional" as const,
    level: null,
    className: "UnknownWorkArenaTask",
  };
  return {
    benchmark: "workarena",
    mode: "agent-execution",
    ready: false,
    status: "error",
    failureStage: stage,
    task,
    prompt: reset ? promptFromReset(reset) : {
      source: "workarena_goal_after_reset",
      value: "",
      goalObject: [],
    },
    browser: reset ? browserFromReset(reset) : {
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
      message,
      details: { source },
    },
    timings: {
      resetMs: reset ? numberValue(reset, "durationMs") : null,
      agentMs: null,
      validationMs: null,
      totalMs: Date.now() - start,
    },
    errors: [{ stage, message }],
    reports: {},
  };
}

function writeReport(result: WorkArenaExecutionResult): string {
  return writeJsonReport(
    result,
    `workarena-handoff-${today()}-${safeFilePart(result.task.taskId)}.json`,
  );
}

function printHuman(result: WorkArenaExecutionResult, readiness?: ReadinessStatus): void {
  console.log("\n[workarena:handoff] WorkArena agent handoff");
  console.log(`[workarena:handoff] Ready: ${result.ready ? "yes" : "no"}`);
  console.log(`[workarena:handoff] Status: ${result.status}`);
  if (result.failureStage) {
    console.log(`[workarena:handoff] Failure stage: ${result.failureStage}`);
  }
  if (readiness) {
    console.log(`[workarena:handoff] Setup: ${readinessLabel(readiness)}`);
  }
  console.log(`[workarena:handoff] Task: ${result.task.taskId}`);
  console.log(`[workarena:handoff] Seed: ${result.task.seed}`);
  console.log(`[workarena:handoff] Prompt: ${compactGoal(result.prompt.value)}`);
  console.log(`[workarena:handoff] Active URL: ${result.browser.activeUrl ?? "(none)"}`);
  console.log(`[workarena:handoff] Agent: ${result.agent.provider}`);
  console.log(`[workarena:handoff] Turns: ${result.agent.turns ?? "(none)"}`);
  console.log(`[workarena:handoff] Validation: ${String(result.validation.passed)}`);
  if (result.validation.message) {
    console.log(`[workarena:handoff] Validation message: ${result.validation.message}`);
  }
  if (result.reports.executionReportPath) {
    console.log(`[workarena:handoff] Report: ${result.reports.executionReportPath}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const result = await runAgentAgainstHeldSession(args);
  const errors = validateWorkArenaReport(result);
  if (errors.length > 0) {
    throw new Error(
      `generated handoff report failed schema validation: ${errors
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
    const doctor = isRecord(result.validation.details.doctor)
      ? (result.validation.details.doctor as DoctorResult)
      : null;
    printHuman(result, doctor?.readiness);
  }

  if (args.allowServiceNowReset && result.status !== "passed") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[workarena:handoff] Fatal error:", error);
  process.exit(1);
});
