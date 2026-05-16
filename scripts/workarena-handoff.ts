#!/usr/bin/env tsx

import { execSync, spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { createInterface, type Interface } from "readline";
import {
  filterTraceFilesByWorkspace,
  findAllNewTraceFiles,
} from "../apps/extension/tests/e2e/helpers/diagnostics";
import { createE2EHarness } from "../apps/extension/tests/e2e/helpers/harness";
import { readE2EConfig } from "../apps/extension/tests/e2e/helpers/e2e-config";
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
import {
  extractSubmittedRecordNumberFromText,
  readTraceMetrics,
  readTraceTerminalFromIndex,
} from "./workarena-handoff-metrics.js";
import { WORKARENA_RESET_APPROVAL_MESSAGE } from "./workarena-safety.js";
import { selectValidationUrl } from "./workarena-validation-url.js";
import { resolve } from "path";
import type { Page } from "puppeteer";
import { fileURLToPath } from "url";

const SESSION_BRIDGE_PATH = resolve(PROJECT_ROOT, "scripts", "workarena-session-bridge.py");
const TRACE_INDEX_PATH = resolve(PROJECT_ROOT, "traces", "index.jsonl");

type JsonRecord = Record<string, unknown>;

type HandoffArgs = {
  taskId: string | null;
  seed: number;
  maxTurns: number;
  timeoutMs: number;
  resetRetries: number;
  reportSuffix: string | null;
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

type StorageEntry = {
  name: string;
  value: string;
};

type ExportedStorageState = {
  cookies: JsonRecord[];
  origins: Array<{
    origin: string;
    localStorage: StorageEntry[];
    sessionStorage: StorageEntry[];
  }>;
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
  const argValue = (name: string): string | null => {
    const index = args.indexOf(name);
    if (index < 0) return null;
    const value = args[index + 1];
    return value && !value.startsWith("--") ? value : null;
  };
  const taskArg = argValue("--task");
  const seedArg = Number.parseInt(argValue("--seed") ?? "", 10);
  const maxTurnsArg = Number.parseInt(argValue("--max-turns") ?? "", 10);
  const timeoutArg = Number.parseInt(argValue("--timeout-ms") ?? "", 10);
  const resetRetriesArg = Number.parseInt(argValue("--reset-retries") ?? "", 10);
  const reportSuffixArg = argValue("--report-suffix");
  return {
    taskId: taskArg && !taskArg.startsWith("--") ? taskArg : null,
    seed: Number.isFinite(seedArg) ? seedArg : 42,
    maxTurns: Number.isFinite(maxTurnsArg) ? maxTurnsArg : 30,
    timeoutMs: Number.isFinite(timeoutArg) ? timeoutArg : 600_000,
    resetRetries:
      Number.isFinite(resetRetriesArg) && resetRetriesArg >= 0
        ? Math.min(resetRetriesArg, 5)
        : 2,
    reportSuffix:
      reportSuffixArg && !reportSuffixArg.startsWith("--") ? reportSuffixArg : null,
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

function sanitizeCookieForPlaywright(cookie: JsonRecord): JsonRecord | null {
  const name = stringValue(cookie, "name");
  const value = stringValue(cookie, "value");
  if (!name || value === null) return null;

  const converted: JsonRecord = { name, value };
  for (const key of ["domain", "path", "sameSite"]) {
    const fieldValue = stringValue(cookie, key);
    if (fieldValue !== null) converted[key] = fieldValue;
  }
  for (const key of ["httpOnly", "secure"]) {
    if (typeof cookie[key] === "boolean") converted[key] = cookie[key];
  }
  const expires = numberValue(cookie, "expires");
  if (expires !== null && expires >= 0) converted.expires = expires;
  return converted;
}

async function exportCurrentPageStorageState(
  page: Page,
  activeUrl: string,
): Promise<{ storageState: ExportedStorageState; summary: JsonRecord }> {
  const origin = new URL(activeUrl).origin;
  const rawCookies = (await page.cookies(activeUrl)) as unknown[];
  const cookies = rawCookies
    .filter(isRecord)
    .map(sanitizeCookieForPlaywright)
    .filter((cookie): cookie is JsonRecord => cookie !== null);
  const storage = await page.evaluate(`(() => {
    const readEntries = (store) => {
      const entries = [];
      for (let index = 0; index < store.length; index += 1) {
        const name = store.key(index) || "";
        if (name) entries.push({ name, value: store.getItem(name) || "" });
      }
      return entries;
    };
    return {
      localStorage: readEntries(window.localStorage),
      sessionStorage: readEntries(window.sessionStorage),
    };
  })()`);
  const localStorage = Array.isArray(storage?.localStorage)
    ? storage.localStorage.filter(
        (entry): entry is StorageEntry =>
          isRecord(entry) &&
          typeof entry.name === "string" &&
          typeof entry.value === "string",
      )
    : [];
  const sessionStorage = Array.isArray(storage?.sessionStorage)
    ? storage.sessionStorage.filter(
        (entry): entry is StorageEntry =>
          isRecord(entry) &&
          typeof entry.name === "string" &&
          typeof entry.value === "string",
      )
    : [];
  const storageState: ExportedStorageState = {
    cookies,
    origins: [{ origin, localStorage, sessionStorage }],
  };

  return {
    storageState,
    summary: {
      cookies: cookies.length,
      localStorage: localStorage.length,
      sessionStorage: sessionStorage.length,
      origins: [origin],
    },
  };
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

function extractFinalAnswerFromAgentTerminal(terminal: AgentTerminal): string | null {
  const lastCompletion = [...terminal.events]
    .reverse()
    .find((event) => event.type === "TASK_COMPLETION");
  if (lastCompletion?.status !== "completed") return null;
  const payload = nestedRecord(lastCompletion, "payload");
  return (
    stringValue(payload, "summary") ??
    stringValue(lastCompletion, "detail") ??
    null
  );
}

function terminalFromTraceSession(
  workspaceId: string,
  traceTerminal: NonNullable<ReturnType<typeof readTraceTerminalFromIndex>>,
): AgentTerminal {
  const event: JsonRecord = {
    type: "TASK_COMPLETION",
    status: traceTerminal.status,
    completionStatus: traceTerminal.status,
    detail: traceTerminal.summary ?? traceTerminal.outcome,
    workspaceId,
    timestamp: Date.now(),
    payload: {
      source: "trace_session",
      outcome: traceTerminal.outcome,
      runId: traceTerminal.runId,
      sessionId: traceTerminal.sessionId,
      recordedAt: traceTerminal.recordedAt,
      query: traceTerminal.query,
      summary: traceTerminal.summary,
    },
  };
  return {
    ok: traceTerminal.ok,
    reason: traceTerminal.reason,
    events: [event],
  };
}

function isTaskLevelTraceTerminal(
  traceTerminal: NonNullable<ReturnType<typeof readTraceTerminalFromIndex>>,
): boolean {
  const query = traceTerminal.query ?? "";
  return /\bObjective:\s*Complete the workflow for the original request\b/i.test(
    query,
  );
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

    const traceTerminal = readTraceTerminalFromIndex(
      TRACE_INDEX_PATH,
      workspaceId,
    );
    if (traceTerminal && isTaskLevelTraceTerminal(traceTerminal)) {
      return terminalFromTraceSession(workspaceId, traceTerminal);
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
  }

  const events = (await getMonitoredEvents(worker)).filter(
    (event: JsonRecord) =>
      event.workspaceId == null || event.workspaceId === workspaceId,
  );
  const traceTerminal = readTraceTerminalFromIndex(
    TRACE_INDEX_PATH,
    workspaceId,
  );
  if (traceTerminal && isTaskLevelTraceTerminal(traceTerminal)) {
    return terminalFromTraceSession(workspaceId, traceTerminal);
  }
  return { ok: false, reason: "timeout", events };
}

function runBuildIfNeeded(args: HandoffArgs): void {
  if (args.noBuild) return;
  console.log("\n[workarena:handoff] Building extension before handoff run...");
  execSync("corepack pnpm run build", {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    windowsHide: true,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function isRetryableResetFailure(record: JsonRecord): boolean {
  const status = stringValue(record, "status");
  return (
    status !== "blocked_requires_reset_flag" &&
    status !== "blocked_invalid_request" &&
    status !== "reset_request_failed"
  );
}

function summarizeResetAttempt(
  record: JsonRecord,
  attempt: number,
  maxAttempts: number,
  retryable: boolean,
): JsonRecord {
  return {
    attempt,
    maxAttempts,
    retryable,
    ok: typeof record.ok === "boolean" ? record.ok : null,
    status: stringValue(record, "status"),
    durationMs: numberValue(record, "durationMs"),
    error: stringValue(record, "error"),
    diagnostics: isRecord(record.diagnostics) ? record.diagnostics : null,
  };
}

async function requestResetWithRetry(
  bridge: WorkArenaSessionBridgeClient,
  args: HandoffArgs,
): Promise<{ reset: JsonRecord; attempts: JsonRecord[] }> {
  const attempts: JsonRecord[] = [];
  const maxAttempts = args.resetRetries + 1;
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let reset: JsonRecord;
    try {
      reset = await bridge.request({
        command: "reset",
        taskId: args.taskId,
        seed: args.seed,
        allowServiceNowReset: true,
        showBrowser: args.showBrowser,
      });
    } catch (error) {
      reset = {
        ok: false,
        status: "reset_request_failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const succeeded = reset.status === "reset_succeeded";
    const retryable = !succeeded && isRetryableResetFailure(reset);
    const summary = summarizeResetAttempt(reset, attempt, maxAttempts, retryable);
    attempts.push(summary);

    if (succeeded || !retryable || attempt === maxAttempts) {
      return {
        reset: {
          ...reset,
          resetAttempts: attempts,
          resetTotalMs: Date.now() - startedAt,
        },
        attempts,
      };
    }

    const delayMs = Math.min(5000, 1000 * attempt);
    summary.retryDelayMs = delayMs;
    console.warn(
      `[workarena:handoff] Reset attempt ${attempt}/${maxAttempts} failed (${stringValue(reset, "error") ?? stringValue(reset, "status") ?? "unknown"}); retrying in ${delayMs}ms`,
    );
    await sleep(delayMs);
  }

  return {
    reset: {
      ok: false,
      status: "reset_failed",
      error: "reset retry loop ended unexpectedly",
      resetAttempts: attempts,
      resetTotalMs: Date.now() - startedAt,
    },
    attempts,
  };
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
      WORKARENA_RESET_APPROVAL_MESSAGE,
    );
  }
  if (!doctor.ready) {
    return doctorBlockedResult(args, doctor);
  }

  runBuildIfNeeded(args);

  const bridge = new WorkArenaSessionBridgeClient();
  let bridgeDescription: JsonRecord | null = null;
  let reset: JsonRecord | null = null;
  let resetAttempts: JsonRecord[] = [];
  let exportSession: JsonRecord | null = null;
  let validation: JsonRecord | null = null;
  let validationStorageExport: JsonRecord | null = null;
  let harnessStarted = false;
  const harness = createE2EHarness({
    maxTurns: args.maxTurns,
    testLabel: `workarena-handoff-${safeFilePart(args.taskId)}`,
  });

  try {
    bridgeDescription = await bridge.description();
    const resetResult = await requestResetWithRetry(bridge, args);
    reset = resetResult.reset;
    resetAttempts = resetResult.attempts;
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
    await navigateAndWait(harness.page, targetUrl, {
      timeoutMs: Math.min(Math.max(args.timeoutMs, 30_000), 120_000),
    });
    await harness.page.bringToFront();
    const importedPageUrl = harness.page.url();
    await updateUserSettings(harness.ctx, {
      allowedNavigationOrigins: [new URL(targetUrl).origin],
    });

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
    const finalFrameUrls = harness.page
      .frames()
      .map((frame) => frame.url())
      .filter((url): url is string => typeof url === "string" && url.length > 0);

    const traceSummary = await harness.printTraceSummary(workspaceId);
    const traceFiles = filterTraceFilesByWorkspace(
      findAllNewTraceFiles(harness.tracesBefore),
      workspaceId,
    );
    const metrics = readTraceMetrics(traceFiles.length > 0 ? traceFiles : traceSummary.traceFiles);
    const agentTerminalSummary = summarizeAgentTerminal(terminal);
    const finalAnswer =
      metrics.finalAnswer ?? extractFinalAnswerFromAgentTerminal(terminal);
    const submittedRecordNumber =
      metrics.submittedRecordNumber ??
      extractSubmittedRecordNumberFromText(finalAnswer) ??
      extractSubmittedRecordNumberFromText(JSON.stringify(agentTerminalSummary));

    const validationUrl = selectValidationUrl({
      startUrl: browser.startUrl,
      browserActiveUrl: browser.activeUrl,
      importedPageUrl,
      finalOpenSidebarUrl,
      frameUrls: finalFrameUrls,
      submittedRecordNumber,
    });
    const validationStorage = await exportCurrentPageStorageState(
      harness.page,
      validationUrl.url,
    );
    validationStorageExport = validationStorage.summary;

    const validationStart = Date.now();
    validation = await bridge.request({
      command: "validate",
      activeUrl: validationUrl.url,
      storageState: validationStorage.storageState,
      submittedRecordNumber,
      finalAnswer,
    });
    const validationMs = Date.now() - validationStart;
    const validationResult = validationFromBridge(validation);
    const passed =
      validationResult.score !== null
        ? validationResult.score > 0
        : validationResult.passed === true;
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
        activeUrl: finalOpenSidebarUrl,
      },
      agent: {
        provider: harness.providerMode,
        executorModel: readE2EConfig().model || null,
        plannerModel: null,
        traceIds: metrics.traceIds,
        traceFiles: metrics.traceFiles,
        finalAnswer,
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
          agentTerminal: agentTerminalSummary,
          bridgeStatuses: {
            description: statusSummary(bridgeDescription),
            reset: statusSummary(reset),
            exportSession: statusSummary(exportSession),
            validation: statusSummary(validation),
          },
          resetAttempts,
          storageImport,
          validationStorageExport,
          submittedRecordNumber,
          importedPageUrl,
          finalOpenSidebarUrl,
          validationUrl: validationUrl.url,
          validationUrlSource: validationUrl.source,
          validationUrlCandidates: validationUrl.candidates,
          finalFrameUrls,
        },
      },
      timings: {
        resetMs: numberValue(reset, "resetTotalMs") ?? numberValue(reset, "durationMs"),
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
      resetMs: reset
        ? (numberValue(reset, "resetTotalMs") ?? numberValue(reset, "durationMs"))
        : stage === "reset"
          ? (numberValue(source, "resetTotalMs") ?? numberValue(source, "durationMs"))
          : null,
      agentMs: null,
      validationMs: null,
      totalMs: Date.now() - start,
    },
    errors: [{ stage, message }],
    reports: {},
  };
}

function writeReport(result: WorkArenaExecutionResult, suffix: string | null): string {
  const suffixPart = suffix ? `-${safeFilePart(suffix)}` : "";
  return writeJsonReport(
    result,
    `workarena-handoff-${today()}-${safeFilePart(result.task.taskId)}${suffixPart}.json`,
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
  const source = isRecord(result.validation.details.source)
    ? result.validation.details.source
    : null;
  const resetAttempts = Array.isArray(result.validation.details.resetAttempts)
    ? result.validation.details.resetAttempts
    : source && Array.isArray(source.resetAttempts)
      ? source.resetAttempts
      : [];
  if (resetAttempts.length > 1) {
    console.log(`[workarena:handoff] Reset attempts: ${resetAttempts.length}`);
  }
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
    result.reports.executionReportPath = writeReport(result, args.reportSuffix);
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

const currentModulePath = fileURLToPath(import.meta.url);
const invokedModulePath = process.argv[1] ? resolve(process.argv[1]) : "";

if (currentModulePath === invokedModulePath) {
  main().catch((error) => {
    console.error("[workarena:handoff] Fatal error:", error);
    process.exit(1);
  });
}
