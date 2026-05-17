/**
 * E2E diagnostics — log server lifecycle, SW console capture, trace reading.
 *
 * Provides full observability for the golden e2e test:
 *   1. Start/stop the log server so traces persist to disk
 *   2. Capture service worker console output via CDP and stream to terminal
 *   3. Read the trace file after the test and print a turn-by-turn summary
 */

import { spawn, type ChildProcess } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import type { Browser } from "puppeteer";
// Runtime diagnostics removed with evals directory — stub to avoid import errors
function analyzeAgentRuntimeDiagnostics(_turns: unknown[]): unknown { return {}; }
function formatRuntimeDiagnostics(_diagnostics: unknown): string { return ""; }

const moduleDir = import.meta.url.startsWith("file:")
  ? dirname(fileURLToPath(import.meta.url))
  : dirname(import.meta.url);
const __dirname = moduleDir;
const PROJECT_ROOT = resolve(__dirname, "../../../../..");
const TRACE_DIR = join(PROJECT_ROOT, "traces");
const RUN_TRACE_DIR = join(TRACE_DIR, "runs");
const LOG_SERVER_SCRIPT = join(PROJECT_ROOT, "scripts", "log-server.ts");
const TSX_CLI = join(PROJECT_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const LOG_SERVER_PORT = 7589;

let logServerProcess: ChildProcess | null = null;

// ── Log server lifecycle ──────────────────────────────────────────

export async function startLogServer(): Promise<void> {
  if (logServerProcess) return;

  // Check if server is already running
  try {
    const res = await fetch(`http://127.0.0.1:${LOG_SERVER_PORT}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (res.ok) {
      console.log("[e2e] Log server already running on port", LOG_SERVER_PORT);
      return;
    }
  } catch {
    // Not running — start it
  }

  logServerProcess = spawn(process.execPath, [TSX_CLI, LOG_SERVER_SCRIPT], {
    cwd: PROJECT_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  // Wait for the server to be ready
  const started = await waitForServer(LOG_SERVER_PORT, 10_000);
  if (!started) {
    await stopLogServer();
    throw new Error("Log server failed to start within 10s");
  }
  console.log("[e2e] Log server started on port", LOG_SERVER_PORT);
}

export async function stopLogServer(): Promise<void> {
  if (!logServerProcess) return;
  const proc = logServerProcess;
  logServerProcess = null;

  const exited = new Promise<void>((resolve) => {
    proc.once("exit", () => resolve());
    proc.once("close", () => resolve());
  });

  proc.kill("SIGTERM");

  await Promise.race([
    exited,
    new Promise<void>((resolve) => {
      setTimeout(() => {
        proc.kill("SIGKILL");
        resolve();
      }, 3_000);
    }),
  ]);
  console.log("[e2e] Log server stopped");
}

async function waitForServer(
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (res.ok) return true;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// ── Trace file snapshot + diff ────────────────────────────────────

export function snapshotTraceFiles(): Set<string> {
  if (!existsSync(TRACE_DIR)) return new Set();
  return new Set(
    readdirSync(TRACE_DIR).filter(
      (f) => f.endsWith(".jsonl") && f !== "index.jsonl",
    ),
  );
}

export function findNewTraceFile(before: Set<string>): string | null {
  if (!existsSync(TRACE_DIR)) return null;
  const candidates = readdirSync(TRACE_DIR)
    .filter((f) => f.endsWith(".jsonl") && f !== "index.jsonl")
    .filter((f) => !before.has(f))
    .map((f) => ({
      filePath: join(TRACE_DIR, f),
      mtimeMs: statSync(join(TRACE_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.filePath ?? null;
}

export function findAllNewTraceFiles(before: Set<string>): string[] {
  if (!existsSync(TRACE_DIR)) return [];
  return readdirSync(TRACE_DIR)
    .filter((f) => f.endsWith(".jsonl") && f !== "index.jsonl")
    .filter((f) => !before.has(f))
    .map((f) => join(TRACE_DIR, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

export function filterTraceFilesByWorkspace(
  traceFiles: string[],
  workspaceId?: string | null,
): string[] {
  if (!workspaceId) return traceFiles;

  return traceFiles.filter((filePath) => traceFileBelongsToWorkspace(filePath, workspaceId));
}

function traceFileBelongsToWorkspace(filePath: string, workspaceId: string): boolean {
  if (!existsSync(filePath)) return false;

  try {
    const raw = readFileSync(filePath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      const entry = JSON.parse(line);
      if (entry?.workspaceId === workspaceId) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

// ── Trace reader + formatter ──────────────────────────────────────

export interface TraceTurn {
  turnNumber: number;
  modelTier?: string;
  model?: string;
  llmContent?: string;
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
  toolResults: Array<{
    name: string;
    success: boolean;
    result: string;
    error?: string;
  }>;
  durationMs?: number;
  url?: string;
}

interface RunTraceEventRecord {
  traceKind?: string;
  runId?: string;
  type?: string;
  role?: string;
  data?: Record<string, unknown>;
}

export interface RunTraceEvent {
  traceKind?: string;
  runId?: string;
  ts?: string;
  recordedAt?: string;
  type?: string;
  role?: string;
  data?: Record<string, unknown>;
}

export interface WorkerTraceInterval {
  nodeId: string;
  workerId?: string;
  startedAtMs: number;
  endedAtMs: number | null;
  startEvent: RunTraceEvent;
  endEvent?: RunTraceEvent;
}

export interface WorkerTraceOverlap {
  first: WorkerTraceInterval;
  second: WorkerTraceInterval;
  overlapMs: number;
}

export interface SkillTraceSummary {
  runId: string;
  skillIds: string[];
  nodeSkills: Array<{
    nodeId: string;
    skillId: string;
    reason?: string;
  }>;
}

export interface RunCompletionSummary {
  runId: string;
  status: "completed" | "partial" | "failed" | "stopped";
  summary: string;
}

export interface FormOutcomeEvidence {
  requiredFieldCount?: number;
  expectedStepTransitions?: number;
  conditionalFieldLabels?: string[];
  validationErrorLabels?: string[];
  reviewText?: string;
  submitted?: boolean;
  confirmationText?: string;
}

export interface FormOutcomeRubric {
  filledRequiredFields: boolean;
  handledConditionalFields: boolean;
  advancedAllSteps: boolean;
  verifiedReview: boolean;
  submitted: boolean;
  detectedConfirmation: boolean;
}

export interface FormTraceMetrics {
  turns: number;
  perceptionReads: number;
  fieldWriteCount: number;
  stepTransitionCount: number;
  validationErrorCount: number;
  correctedFieldCount: number;
  failedSubmitCount: number;
  reworkStagnationCount: number;
  finalSubmitConfidence: number;
  recoverySuccess: boolean;
  outcome: FormOutcomeRubric;
}

function isRejectedDoneTurn(entry: any): boolean {
  const events = Array.isArray(entry?.events) ? entry.events : [];
  return events.some((event: any) => {
    const type = String(event?.type ?? "");
    return (
      type.startsWith("done_rejected") ||
      type.startsWith("done_blocked") ||
      type === "auto_advance_blocked"
    );
  });
}

export function extractDoneSummary(traceFiles: string[]): string {
  let latestAccepted: {
    summary: string;
    timestamp: string;
    fileIndex: number;
    lineIndex: number;
  } | null = null;
  let latestRejected: {
    summary: string;
    timestamp: string;
    fileIndex: number;
    lineIndex: number;
  } | null = null;

  for (let fileIndex = 0; fileIndex < traceFiles.length; fileIndex += 1) {
    const filePath = traceFiles[fileIndex];
    if (!existsSync(filePath)) continue;
    try {
      const raw = readFileSync(filePath, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const entry = JSON.parse(lines[lineIndex]);
        const toolCalls = entry?.llmResponse?.toolCalls ?? [];
        if (!Array.isArray(toolCalls)) continue;

        const rejected = isRejectedDoneTurn(entry);
        const timestamp = String(
          entry?.recordedAt ?? entry?.timestamp ?? entry?.turnNumber ?? "",
        );
        for (const toolCall of toolCalls) {
          const name = toolCall?.function?.name ?? toolCall?.name;
          if (name !== "done") continue;
          const args = toolCall?.function?.arguments
            ? safeParseArgs(toolCall.function.arguments)
            : toolCall?.args ?? {};
          const value =
            typeof args?.summary === "string" && args.summary.trim()
              ? args.summary
              : typeof args?.message === "string" && args.message.trim()
                ? args.message
                : "";
          const summary = value.trim();
          if (!summary) continue;
          const candidate = { summary, timestamp, fileIndex, lineIndex };
          if (rejected) {
            if (
              !latestRejected ||
              candidate.timestamp >= latestRejected.timestamp ||
              (candidate.timestamp === latestRejected.timestamp &&
                (candidate.fileIndex > latestRejected.fileIndex ||
                  candidate.lineIndex > latestRejected.lineIndex))
            ) {
              latestRejected = candidate;
            }
            continue;
          }
          if (
            !latestAccepted ||
            candidate.timestamp >= latestAccepted.timestamp ||
            (candidate.timestamp === latestAccepted.timestamp &&
              (candidate.fileIndex > latestAccepted.fileIndex ||
                candidate.lineIndex > latestAccepted.lineIndex))
          ) {
            latestAccepted = candidate;
          }
        }
      }
    } catch {
      const turns = readTrace(filePath);
      for (const turn of turns) {
        for (const toolCall of turn.toolCalls) {
          if (toolCall.name !== "done") continue;
          const summary = toolCall.args?.summary;
          if (typeof summary === "string" && summary.trim().length > 0) {
            return summary;
          }
          const message = toolCall.args?.message;
          if (typeof message === "string" && message.trim().length > 0) {
            return message;
          }
        }
      }
    }
  }

  return latestAccepted?.summary ?? latestRejected?.summary ?? "";
}

export function extractLatestReadPageText(traceFiles: string[]): string {
  let latestText = "";
  let latestTimestamp = "";

  for (const filePath of sortTraceFilesChronologically(traceFiles)) {
    if (!existsSync(filePath)) continue;
    try {
      const raw = readFileSync(filePath, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);
      for (const line of lines) {
        const entry = JSON.parse(line);
        const timestamp = String(entry.recordedAt ?? entry.ts ?? "");
        const candidates: string[] = [];

        for (const message of entry.llmRequest?.messages ?? []) {
          if (message?.role !== "tool") continue;
          const content = message.content;
          if (
            typeof content === "string" &&
            content.includes("Page content:")
          ) {
            candidates.push(content);
          }
        }

        for (const execution of entry.toolExecutions ?? []) {
          const result = execution?.result;
          if (
            execution?.toolName === "read_page" &&
            typeof result === "string" &&
            result.includes("Page content:")
          ) {
            candidates.push(result);
          }
        }

        for (const candidate of candidates) {
          if (!latestText || timestamp >= latestTimestamp) {
            latestText = candidate;
            latestTimestamp = timestamp;
          }
        }
      }
    } catch {
      continue;
    }
  }

  return latestText;
}

export function readTrace(filePath: string): TraceTurn[] {
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, "utf-8");
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        const entry = JSON.parse(line);
        const toolCalls = (entry.llmResponse?.toolCalls ?? []).map(
          (tc: any) => ({
            name: tc.function?.name ?? tc.name ?? "?",
            args: tc.function?.arguments
              ? safeParseArgs(tc.function.arguments)
              : tc.args ?? {},
          }),
        );
        const toolResults = (entry.toolExecutions ?? []).map((te: any) => ({
          name: te.toolName ?? "?",
          success: te.success ?? false,
          result: truncate(te.result ?? "", 120),
          error: te.error,
        }));
        return {
          turnNumber: entry.turnNumber ?? 0,
          modelTier: entry.llmRequest?.modelTier,
          model: entry.llmRequest?.model,
          llmContent: entry.llmResponse?.content
            ? truncate(entry.llmResponse.content, 200)
            : undefined,
          toolCalls,
          toolResults,
          durationMs: entry.llmResponse?.durationMs,
          url: entry.snapshot?.url,
        } as TraceTurn;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as TraceTurn[];
}

export function extractRunIdFromTraceFile(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      const entry = JSON.parse(line);
      if (typeof entry?.runId === "string" && entry.runId.length > 0) {
        return entry.runId;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function readRunCompletionForTraceFiles(
  traceFiles: string[],
): RunCompletionSummary | null {
  for (const filePath of traceFiles) {
    const runId = extractRunIdFromTraceFile(filePath);
    if (!runId || !existsSync(RUN_TRACE_DIR)) continue;
    const traceFile = join(RUN_TRACE_DIR, `${runId}.jsonl`);
    if (!existsSync(traceFile)) continue;

    try {
      const lines = readFileSync(traceFile, "utf-8")
        .trim()
        .split("\n")
        .filter(Boolean);
      let latestSummary = "";
      let latestStatus: RunCompletionSummary["status"] | null = null;

      for (const line of lines) {
        const entry = JSON.parse(line) as RunTraceEventRecord;
        if (entry.traceKind !== "orchestrator.run.event") continue;
        if (entry.type === "node_completed") {
          const summary = entry.data?.summary;
          if (typeof summary === "string" && summary.trim()) {
            latestSummary = summary;
          }
        }
        if (entry.type === "task_completed") {
          const status = entry.data?.completionStatus;
          if (
            status === "completed" ||
            status === "partial" ||
            status === "failed" ||
            status === "stopped"
          ) {
            latestStatus = status;
          }
        }
      }

      if (latestStatus) {
        return { runId, status: latestStatus, summary: latestSummary };
      }
    } catch {
      continue;
    }
  }

  return null;
}

export function readRunTraceEventsForTraceFile(
  traceFilePath: string,
): RunTraceEvent[] {
  const runId = extractRunIdFromTraceFile(traceFilePath);
  if (!runId || !existsSync(RUN_TRACE_DIR)) return [];
  const runTracePath = join(RUN_TRACE_DIR, `${runId}.jsonl`);
  if (!existsSync(runTracePath)) return [];

  try {
    return readFileSync(runTracePath, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RunTraceEvent)
      .filter((entry) => entry.traceKind === "orchestrator.run.event");
  } catch {
    return [];
  }
}

function runEventTimestampMs(event: RunTraceEvent): number {
  const timestamp =
    typeof event.ts === "string"
      ? event.ts
      : typeof event.recordedAt === "string"
        ? event.recordedAt
        : "";
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : 0;
}

function runEventDataString(
  event: RunTraceEvent,
  key: "nodeId" | "workerId",
): string | undefined {
  const value = event.data?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function sortRunEventsChronologically(events: RunTraceEvent[]): RunTraceEvent[] {
  return [...events].sort((left, right) => {
    const delta = runEventTimestampMs(left) - runEventTimestampMs(right);
    if (delta !== 0) return delta;
    return String(left.type ?? "").localeCompare(String(right.type ?? ""));
  });
}

export function collectWorkerTraceIntervals(
  events: RunTraceEvent[],
): WorkerTraceInterval[] {
  const intervals: WorkerTraceInterval[] = [];

  for (const event of sortRunEventsChronologically(events)) {
    if (event.type === "worker_started") {
      const nodeId = runEventDataString(event, "nodeId");
      if (!nodeId) continue;
      intervals.push({
        nodeId,
        workerId: runEventDataString(event, "workerId"),
        startedAtMs: runEventTimestampMs(event),
        endedAtMs: null,
        startEvent: event,
      });
      continue;
    }

    if (
      event.type !== "node_completed" &&
      event.type !== "worker_cancelled" &&
      event.type !== "worker_released_resource"
    ) {
      continue;
    }

    const nodeId = runEventDataString(event, "nodeId");
    if (!nodeId) continue;
    const workerId = runEventDataString(event, "workerId");
    const match = intervals.find(
      (interval) =>
        interval.nodeId === nodeId &&
        interval.endedAtMs == null &&
        (!workerId || !interval.workerId || interval.workerId === workerId),
    );
    if (!match) continue;
    match.endedAtMs = runEventTimestampMs(event);
    match.endEvent = event;
  }

  return intervals;
}

export function findWorkerTraceOverlaps(
  events: RunTraceEvent[],
  options: { nodeIds?: string[]; minimumOverlapMs?: number } = {},
): WorkerTraceOverlap[] {
  const nodeIdSet = options.nodeIds ? new Set(options.nodeIds) : null;
  const intervals = collectWorkerTraceIntervals(events).filter((interval) =>
    nodeIdSet ? nodeIdSet.has(interval.nodeId) : true,
  );
  const latestEventMs = Math.max(0, ...events.map(runEventTimestampMs));
  const minimumOverlapMs = options.minimumOverlapMs ?? 1;
  const overlaps: WorkerTraceOverlap[] = [];

  for (let leftIndex = 0; leftIndex < intervals.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < intervals.length;
      rightIndex += 1
    ) {
      const first = intervals[leftIndex];
      const second = intervals[rightIndex];
      if (
        first.nodeId === second.nodeId &&
        (!first.workerId || !second.workerId || first.workerId === second.workerId)
      ) {
        continue;
      }
      const overlapStart = Math.max(first.startedAtMs, second.startedAtMs);
      const overlapEnd = Math.min(
        first.endedAtMs ?? latestEventMs,
        second.endedAtMs ?? latestEventMs,
      );
      const overlapMs = overlapEnd - overlapStart;
      if (overlapMs >= minimumOverlapMs) {
        overlaps.push({ first, second, overlapMs });
      }
    }
  }

  return overlaps;
}

function formatWorkerIntervals(intervals: WorkerTraceInterval[]): string {
  return intervals
    .map((interval) => {
      const end =
        interval.endedAtMs == null
          ? "open"
          : `${interval.endedAtMs - interval.startedAtMs}ms`;
      return `${interval.nodeId}${interval.workerId ? `/${interval.workerId}` : ""}:${end}`;
    })
    .join(", ");
}

export function assertWorkerTraceOverlap(
  events: RunTraceEvent[],
  options: { minimumOverlapMs?: number } = {},
): void {
  const overlaps = findWorkerTraceOverlaps(events, options);
  if (overlaps.length > 0) return;
  throw new Error(
    `Expected overlapping executor workers in run trace. Intervals: ${formatWorkerIntervals(
      collectWorkerTraceIntervals(events),
    )}`,
  );
}

export function assertNoWorkerTraceOverlap(
  events: RunTraceEvent[],
  options: { nodeIds?: string[]; minimumOverlapMs?: number } = {},
): void {
  const overlaps = findWorkerTraceOverlaps(events, options);
  if (overlaps.length === 0) return;
  const first = overlaps[0];
  throw new Error(
    `Expected serialized executor workers, but ${first.first.nodeId} and ${first.second.nodeId} overlapped for ${first.overlapMs}ms.`,
  );
}

export function readSkillSummaryForRun(runId: string): SkillTraceSummary | null {
  if (!runId || !existsSync(RUN_TRACE_DIR)) return null;
  const traceFile = join(RUN_TRACE_DIR, `${runId}.jsonl`);
  if (!existsSync(traceFile)) return null;

  try {
    const lines = readFileSync(traceFile, "utf-8").trim().split("\n").filter(Boolean);
    const nodeSkills = new Map<string, { skillId: string; reason?: string }>();
    const skillIds = new Set<string>();

    for (const line of lines) {
      const entry = JSON.parse(line) as RunTraceEventRecord;
      if (entry.traceKind !== "orchestrator.run.event") continue;
      if (!entry.data || typeof entry.data !== "object") continue;

      if (entry.type === "plan_decomposed" && Array.isArray(entry.data.skills)) {
        for (const item of entry.data.skills) {
          if (!item || typeof item !== "object") continue;
          const nodeId = typeof (item as any).nodeId === "string" ? (item as any).nodeId : "";
          const skillId = typeof (item as any).skillId === "string" ? (item as any).skillId : "";
          const reason = typeof (item as any).reason === "string" ? (item as any).reason : undefined;
          if (!nodeId || !skillId) continue;
          nodeSkills.set(nodeId, { skillId, reason });
          skillIds.add(skillId);
        }
      }

      if (entry.type === "node_started") {
        const nodeId =
          typeof entry.data.nodeId === "string" ? entry.data.nodeId : "";
        const skillId =
          typeof entry.data.selectedSkillId === "string"
            ? entry.data.selectedSkillId
            : "";
        const reason =
          typeof entry.data.selectedSkillReason === "string"
            ? entry.data.selectedSkillReason
            : undefined;
        if (!nodeId || !skillId) continue;
        nodeSkills.set(nodeId, { skillId, reason });
        skillIds.add(skillId);
      }
    }

    return {
      runId,
      skillIds: [...skillIds].sort(),
      nodeSkills: [...nodeSkills.entries()].map(([nodeId, value]) => ({
        nodeId,
        skillId: value.skillId,
        ...(value.reason ? { reason: value.reason } : {}),
      })),
    };
  } catch {
    return null;
  }
}

export function collectSkillIdsForTraceFiles(traceFiles: string[]): string[] {
  const skillIds = new Set<string>();

  for (const filePath of traceFiles) {
    const runId = extractRunIdFromTraceFile(filePath);
    if (!runId) continue;

    const summary = readSkillSummaryForRun(runId);
    for (const skillId of summary?.skillIds ?? []) {
      skillIds.add(skillId);
    }
  }

  return [...skillIds].sort();
}

export function collectFormTraceMetrics(
  traceFiles: string[],
  evidence: FormOutcomeEvidence = {},
): FormTraceMetrics {
  let turns = 0;
  let perceptionReads = 0;
  let fieldWriteCount = 0;
  let stepTransitionCount = 0;
  let correctedFieldCount = 0;
  let reworkStagnationCount = 0;
  let sawDone = false;
  let sawSubmitAction = false;
  let submitActionCount = 0;
  let validationSeen = false;
  const rawParts: string[] = [];
  const observedValidationParts: string[] = [];
  const traceEntries: any[] = [];

  for (const filePath of traceFiles) {
    if (!existsSync(filePath)) continue;
    let raw = "";
    try {
      raw = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    rawParts.push(raw);

    const lines = raw.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        traceEntries.push(JSON.parse(line));
      } catch {
        continue;
      }
    }
  }

  for (const entry of traceEntries.sort(compareTraceEntries)) {
    turns++;
    const entryText = collectEntryValidationText(entry);
    const turnHasValidationSignal = entryHasValidationSignal(
      entryText,
      evidence.validationErrorLabels,
    );
    if (turnHasValidationSignal) {
      observedValidationParts.push(entryText);
    }

    const messages = Array.isArray(entry?.llmRequest?.messages)
      ? entry.llmRequest.messages
      : [];
    if (
      messages.some(
        (message: any) =>
          typeof message?.content === "string" &&
          message.content.includes("Page Interpretation"),
      )
    ) {
      perceptionReads++;
    }

    const toolCalls = Array.isArray(entry?.llmResponse?.toolCalls)
      ? entry.llmResponse.toolCalls
      : [];
    let transitionCallsFromToolCalls = 0;
    let submitCallsFromToolCalls = 0;
    for (const toolCall of toolCalls) {
      const name = String(
        toolCall?.function?.name ?? toolCall?.name ?? "",
      );
      const args = toolCall?.function?.arguments
        ? safeParseArgs(toolCall.function.arguments)
        : toolCall?.args ?? {};
      const argsText = JSON.stringify(args);

      if (
        name === "type_text" ||
        name === "select_option" ||
        name === "set_checkbox"
      ) {
        fieldWriteCount++;
        if (validationSeen || turnHasValidationSignal) {
          correctedFieldCount++;
        }
      }
      if (name === "done") {
        sawDone = true;
      }
      if (
        name === "click_element" &&
        /\b(continue|next|review|submit|finish)\b/i.test(argsText)
      ) {
        transitionCallsFromToolCalls++;
        if (/\bsubmit\b/i.test(argsText)) {
          sawSubmitAction = true;
          submitCallsFromToolCalls++;
        }
      }
    }

    const toolExecutions = Array.isArray(entry?.toolExecutions)
      ? entry.toolExecutions
      : [];
    let transitionExecutions = 0;
    let submitExecutions = 0;
    for (const execution of toolExecutions) {
      const toolName = String(execution?.toolName ?? "");
      const resultText =
        typeof execution?.result === "string" ? execution.result : "";
      if (
        toolName === "click_element" &&
        /\b(continue|next|review|submit|finish)\b/i.test(resultText)
      ) {
        transitionExecutions++;
        if (/\bsubmit\b/i.test(resultText)) {
          sawSubmitAction = true;
          submitExecutions++;
        }
      }
    }
    stepTransitionCount +=
      transitionExecutions > 0
        ? transitionExecutions
        : transitionCallsFromToolCalls;
    submitActionCount +=
      submitExecutions > 0 ? submitExecutions : submitCallsFromToolCalls;

    const progress = entry?.progressState;
    if (
      typeof progress?.stagnantTurns === "number" &&
      progress.stagnantTurns > 0
    ) {
      reworkStagnationCount++;
    }
    if (turnHasValidationSignal) {
      validationSeen = true;
    }
  }

  const rawText = rawParts.join("\n");
  reworkStagnationCount += countPattern(rawText, /\bstagnat\w*\b/gi);
  reworkStagnationCount += countPattern(rawText, /\bwiden(?:ed|ing)?\b/gi);
  const normalizedRawText = rawText.toLowerCase();
  const requiredFieldCount = Math.max(1, evidence.requiredFieldCount ?? 1);
  const conditionalLabels = evidence.conditionalFieldLabels ?? [];
  const handledConditionalFields =
    conditionalLabels.length > 0
      ? conditionalLabels.every((label) =>
          normalizedRawText.includes(label.toLowerCase()),
        )
      : /\b(conditional|revealed|required when|data processing agreement|access reason)\b/i.test(
          rawText,
        );
  const verifiedReview = evidence.reviewText
    ? normalizedRawText.includes(evidence.reviewText.toLowerCase())
    : /\b(review|summary|confirm)\b/i.test(rawText);
  const submitted =
    evidence.submitted === true ||
    sawSubmitAction ||
    sawDone ||
    /\b(submitted|request submitted|submitted successfully)\b/i.test(rawText);
  const detectedConfirmation = evidence.confirmationText
    ? normalizedRawText.includes(evidence.confirmationText.toLowerCase())
    : /\b(confirmation|confirmed|request submitted|submitted successfully|complete)\b/i.test(
        rawText,
      );
  const validationErrorCount = countValidationErrors(
    observedValidationParts.join("\n"),
    evidence.validationErrorLabels,
  );
  const failedSubmitCount = Math.max(
    validationErrorCount > 0 ? 1 : 0,
    submitActionCount - (submitted ? 1 : 0),
  );

  const outcome: FormOutcomeRubric = {
    filledRequiredFields: fieldWriteCount >= requiredFieldCount,
    handledConditionalFields,
    advancedAllSteps:
      stepTransitionCount >= Math.max(1, evidence.expectedStepTransitions ?? 1),
    verifiedReview,
    submitted,
    detectedConfirmation,
  };

  const finalSubmitConfidence =
    outcome.submitted && outcome.detectedConfirmation
      ? 1
      : outcome.submitted && sawDone
        ? 0.7
        : sawDone
          ? 0.4
          : 0;
  const recoverySuccess =
    validationErrorCount > 0
      ? failedSubmitCount > 0 &&
        correctedFieldCount >= 1 &&
        outcome.submitted &&
        outcome.detectedConfirmation
      : outcome.submitted && outcome.detectedConfirmation;

  return {
    turns,
    perceptionReads,
    fieldWriteCount,
    stepTransitionCount,
    validationErrorCount,
    correctedFieldCount,
    failedSubmitCount,
    reworkStagnationCount,
    finalSubmitConfidence,
    recoverySuccess,
    outcome,
  };
}

export function traceFilesContainText(traceFiles: string[], text: string): boolean {
  for (const filePath of traceFiles) {
    if (!existsSync(filePath)) continue;
    try {
      const raw = readFileSync(filePath, "utf-8");
      if (raw.includes(text)) return true;
    } catch {
      // Ignore unreadable trace files and keep scanning the rest.
    }
  }

  return false;
}

function countPattern(text: string, pattern: RegExp): number {
  let count = 0;
  pattern.lastIndex = 0;
  while (pattern.exec(text)) count++;
  return count;
}

function entryHasValidationSignal(
  text: string,
  validationErrorLabels: string[] | undefined,
): boolean {
  if (validationErrorLabels?.length) {
    const normalized = text.toLowerCase();
    return validationErrorLabels.some((label) =>
      normalized.includes(label.toLowerCase()),
    );
  }
  return /\b(error|invalid|required|must include|must be|please enter|correct this field)\b/i.test(
    text,
  );
}

function countValidationErrors(
  text: string,
  validationErrorLabels: string[] | undefined,
): number {
  if (validationErrorLabels?.length) {
    const normalized = text.toLowerCase();
    return validationErrorLabels.filter((label) =>
      normalized.includes(label.toLowerCase()),
    ).length;
  }
  return countPattern(
    text,
    /\b(?:invalid|required|must include|must be|please enter|correct this field)\b/gi,
  );
}

function collectEntryValidationText(entry: any): string {
  const parts: string[] = [];

  for (const execution of entry?.toolExecutions ?? []) {
    if (typeof execution?.result === "string") parts.push(execution.result);
    if (typeof execution?.error === "string") parts.push(execution.error);
  }

  for (const element of entry?.elements ?? []) {
    if (typeof element?.text === "string") parts.push(element.text);
    const attributes = element?.attributes;
    if (attributes && typeof attributes === "object") {
      for (const value of Object.values(attributes)) {
        if (typeof value === "string") parts.push(value);
      }
    }
  }

  return parts.join("\n");
}

function compareTraceEntries(a: any, b: any): number {
  return getTraceEntryTimestamp(a) - getTraceEntryTimestamp(b);
}

function getTraceEntryTimestamp(entry: any): number {
  const value = entry?.timestamp ?? entry?.recordedAt ?? entry?.turnNumber;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
  }
  return Number.MAX_SAFE_INTEGER;
}

function safeParseArgs(raw: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "...";
}

export function formatTraceSummary(turns: TraceTurn[]): string {
  if (turns.length === 0) return "[no trace data]";

  const lines: string[] = [];
  lines.push(`\n${"=".repeat(60)}`);
  lines.push(`  AGENT TRACE  (${turns.length} turns)`);
  lines.push(`${"=".repeat(60)}`);

  for (const turn of turns) {
    const tier = turn.modelTier ? `[${turn.modelTier}]` : "";
    const ms = turn.durationMs ? ` (${(turn.durationMs / 1000).toFixed(1)}s)` : "";

    if (turn.toolCalls.length > 0) {
      for (const tc of turn.toolCalls) {
        const argStr = formatArgs(tc.args);
        lines.push(`  T${turn.turnNumber} ${tier} -> ${tc.name}(${argStr})${ms}`);
      }
    } else if (turn.llmContent) {
      const snippet = turn.llmContent.replace(/\n/g, " ").trim();
      lines.push(`  T${turn.turnNumber} ${tier} -- "${truncate(snippet, 100)}"${ms}`);
    }

    for (const tr of turn.toolResults) {
      const icon = tr.success ? "ok" : "FAIL";
      const detail = tr.error ? ` err=${tr.error}` : "";
      lines.push(`           ${icon}: ${tr.result}${detail}`);
    }
  }

  const diagnostics = analyzeAgentRuntimeDiagnostics(turns as never[]);
  const diagnosticSummary = formatRuntimeDiagnostics(diagnostics);
  if (diagnosticSummary) {
    lines.push(diagnosticSummary);
  }

  lines.push(`${"=".repeat(60)}\n`);
  return lines.join("\n");
}

function formatArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string") {
      parts.push(`${k}="${truncate(v, 30)}"`);
    } else if (typeof v === "number" || typeof v === "boolean") {
      parts.push(`${k}=${v}`);
    }
  }
  return parts.join(", ");
}

// ── CDP service worker console capture ────────────────────────────

export async function attachSwConsole(
  browser: Browser,
  options: { diagnosticMode?: boolean } = {},
): Promise<() => void> {
  const diagnosticMode = options.diagnosticMode === true;
  // Find the existing SW target (already discovered by launchWithExtension)
  const swTarget = browser
    .targets()
    .find(
      (t) =>
        t.type() === "service_worker" &&
        t.url().startsWith("chrome-extension://"),
    );
  if (!swTarget) {
    console.log("[e2e] SW target not found — console capture disabled");
    return () => {};
  }

  const session = await swTarget.createCDPSession();
  await session.send("Runtime.enable");

  const handler = (event: any) => {
    const args: string[] = (event.args ?? []).map((a: any) => {
      if (a.value !== undefined) return String(a.value);
      if (a.description) return a.description;
      return a.type ?? "?";
    });
    const text = args.join(" ");
    const level = event.type ?? "log";

    // Filter to agent-relevant output (skip noisy internal logs)
    if (shouldPrint(level, text, diagnosticMode)) {
      const tag = level === "error" ? "ERR" : level === "warn" ? "WRN" : "   ";
      console.log(`[sw:${tag}] ${text}`);
    }
  };

  session.on("Runtime.consoleAPICalled", handler);

  return () => {
    session.off("Runtime.consoleAPICalled", handler);
    session.detach().catch(() => {});
  };
}

function shouldPrint(level: string, text: string, diagnosticMode: boolean = false): boolean {
  if (diagnosticMode) return true;
  // Always show errors and warnings
  if (level === "error" || level === "warn") return true;
  // Show agent loop messages
  if (text.includes("[agent") || text.includes("[loop")) return true;
  if (text.includes("[tool") || text.includes("[llm")) return true;
  if (text.includes("[perception")) return true;
  if (text.includes("[trace")) return true;
  // Show tool execution
  if (text.includes("execute") || text.includes("Execute")) return true;
  // Show completion/status
  if (text.includes("completed") || text.includes("error") || text.includes("stagnant")) return true;
  // Skip everything else (storage, keepalive, misc)
  return false;
}
