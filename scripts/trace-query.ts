/**
 * Trace Query CLI — query trace files produced by the log server.
 *
 * Usage: pnpm exec tsx scripts/trace-query.ts <command> [args]
 * Or:    pnpm run traces -- <command> [args]
 *
 * Commands:
 *   list                          List all recorded sessions
 *   show <session-id>             Session summary + turn-by-turn overview
 *   turns <session-id>            Show each turn: tool calls, LLM response snippet
 *   turn <session-id> <N>         Full detail for turn N
 *   days                          List days with session counts
 *   search [filters]              Filter by day/domain/outcome/session/query
 *   filter --outcome <outcome>    Filter sessions by outcome
 *   stats                         Aggregate stats across all sessions
 *   summarize <session-id>        High-signal diagnosis for one session
 *   context <session-id>          Agent-ready redacted investigation context
 *   compare <session-id>          Show related sessions for comparative debugging
 *   diff <base-id> <related-id>   Side-by-side first divergence summary
 *   debug <session-id>            Agent-debug bundle with context, related traces, diffs
 *   validate                      Validate trace JSONL integrity and links
 *   pin <session-id>              Protect a session from cleanup
 *   unpin <session-id>            Remove cleanup protection
 *   cleanup [--dry-run] [--all]   Delete trace artifacts, preserving pins unless --all
 *   pathologies [session-id]      Show multi-turn pathology events
 *   runs list                     List all orchestrator runs
 *   runs show <run-id>            Show run manifest + linked sessions
 *   runs sessions <run-id>        List session IDs for a run
 *   help                          Show usage
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  analyzeTraceSession,
  buildTraceInvestigationReport,
  compareTraceSessions,
  compareTraceTimelines,
} from "../apps/extension/src/trace-viewer/analysis";
import {
  validateTraceBundle,
  validateTraceRecord,
} from "../apps/extension/src/trace-viewer/analysis";
import type {
  TraceBundleValidationInput,
  TraceValidationIssue,
} from "../apps/extension/src/trace-viewer/analysis";
import { redactTracePayload } from "../apps/extension/src/utils/trace-protection";
import type { RunTraceEvent } from "../apps/extension/src/utils/run-trace";
import type {
  TraceEntry,
  TraceSession,
} from "../apps/extension/src/types/traces";
import { createTraceRepository } from "./obs/repository";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TRACE_DIR = join(PROJECT_ROOT, "traces");
const INDEX_FILE = join(TRACE_DIR, "index.jsonl");
const RUN_TRACE_DIR = join(TRACE_DIR, "runs");
const RUN_INDEX_FILE = join(RUN_TRACE_DIR, "index.jsonl");
const SCREENSHOT_DIR = join(TRACE_DIR, "screenshots");
const LOG_DIR = join(PROJECT_ROOT, "logs");
const PINS_FILE = join(TRACE_DIR, "pins.json");
const traceRepository = createTraceRepository(PROJECT_ROOT);

// ANSI colors
const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

interface TraceSessionRecord {
  schemaVersion?: string;
  traceKind?: string;
  runId?: string;
  correlationId?: string;
  sessionId: string;
  startTime: number;
  endTime: number;
  query: string;
  startUrl: string;
  outcome: string;
  failureCategory?: string;
  failureCode?: string;
  failureDetail?: string;
  turnCount: number;
  summary: string;
  metrics: {
    totalTokens?: number;
    totalCost?: number;
    totalLlmTimeMs?: number;
  } | null;
}

interface TraceEntryRecord {
  schemaVersion?: string;
  traceKind?: string;
  turnId?: string;
  runId?: string;
  correlationId?: string;
  sessionId: string;
  turnNumber: number;
  timestamp: number;
  snapshot: { url: string; title: string; elementCount: number };
  llmRequest: { model: string; messageCount: number; compressionLevel: string };
  llmResponse: {
    content: string | null;
    toolCalls: {
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }[];
    finishReason: string;
    usage: { total_tokens: number; cost?: number } | null;
    durationMs: number;
  };
  toolExecutions: {
    toolName: string;
    args: Record<string, unknown>;
    result: string;
    success: boolean;
    error?: string;
    durationMs: number;
  }[];
  events: { type: string; timestamp: number; data: Record<string, unknown> }[];
  progressState: {
    stagnantTurns?: number;
    staleTurns?: number;
    signal: string | null;
  };
}

function readRawIndex(): TraceSessionRecord[] {
  const indexed = readJsonlFile<TraceSessionRecord>(INDEX_FILE);
  const sessionsById = new Map<string, TraceSessionRecord>();
  for (const session of indexed) {
    if (session.sessionId) sessionsById.set(session.sessionId, session);
  }

  if (existsSync(TRACE_DIR)) {
    for (const file of readdirSync(TRACE_DIR)) {
      if (!file.endsWith(".jsonl") || file === "index.jsonl") continue;
      const sessionId = file.replace(/\.jsonl$/, "");
      if (sessionsById.has(sessionId)) continue;
      const orphan = synthesizeSessionFromTraceFile(sessionId);
      if (orphan) sessionsById.set(sessionId, orphan);
    }
  }

  return [...sessionsById.values()].sort(
    (a, b) => (a.startTime ?? 0) - (b.startTime ?? 0),
  );
}

function readIndex(): TraceSessionRecord[] {
  const sessionsById = new Map<string, TraceSessionRecord>();
  for (const session of traceRepository.loadSessions()) {
    if (session.sessionId) {
      sessionsById.set(
        session.sessionId,
        session as unknown as TraceSessionRecord,
      );
    }
  }
  for (const session of readRawIndex()) {
    if (!sessionsById.has(session.sessionId)) {
      sessionsById.set(session.sessionId, session);
    }
  }
  return [...sessionsById.values()].sort(
    (a, b) => (a.startTime ?? 0) - (b.startTime ?? 0),
  );
}

function readTrace(sessionId: string): TraceEntryRecord[] {
  const entries = traceRepository.loadEntries(sessionId);
  if (entries.length === 0) {
    console.error(`${c.red}Trace not found: ${sessionId}${c.reset}`);
    process.exit(1);
  }
  return dedupeTraceEntries(entries as unknown as TraceEntryRecord[]);
}

function tryReadTrace(sessionId: string): TraceEntry[] | null {
  const entries = traceRepository.loadEntries(sessionId);
  return entries.length > 0
    ? dedupeTraceEntries(entries as unknown as TraceEntry[])
    : null;
}

function dedupeTraceEntries<T extends { turnId?: string; turnNumber?: number }>(
  entries: T[],
): T[] {
  const byTurn = new Map<string, T>();
  for (const entry of entries) {
    const key =
      typeof entry.turnId === "string" && entry.turnId.length > 0
        ? entry.turnId
        : typeof entry.turnNumber === "number"
          ? `turn:${entry.turnNumber}`
          : `row:${byTurn.size}`;
    byTurn.set(key, entry);
  }
  return [...byTurn.values()].sort(
    (a, b) => (a.turnNumber ?? 0) - (b.turnNumber ?? 0),
  );
}

function synthesizeSessionFromTraceFile(
  sessionId: string,
): TraceSessionRecord | null {
  const entries = tryReadTrace(sessionId) as TraceEntryRecord[] | null;
  if (!entries || entries.length === 0) return null;
  const first = entries[0] as TraceEntryRecord & Record<string, unknown>;
  const last = entries[entries.length - 1] as TraceEntryRecord &
    Record<string, unknown>;
  const firstRequest = first.llmRequest as
    | (TraceEntryRecord["llmRequest"] & {
        messages?: Array<{ role?: string; content?: string | null }>;
      })
    | undefined;
  const firstUserMessage =
    firstRequest?.messages?.find((message) => message.role === "user")
      ?.content ?? "";
  const doneSummary = extractDoneSummary(last);
  const tokenTotals = entries.reduce(
    (acc, entry) => {
      const usage = (entry.llmResponse as any)?.usage;
      const totalTokens =
        typeof usage?.total_tokens === "number"
          ? usage.total_tokens
          : typeof usage?.totalTokens === "number"
            ? usage.totalTokens
            : 0;
      const totalCost =
        typeof usage?.cost === "number"
          ? usage.cost
          : typeof usage?.totalCost === "number"
            ? usage.totalCost
            : 0;
      acc.totalTokens += totalTokens;
      acc.totalCost += totalCost;
      return acc;
    },
    { totalTokens: 0, totalCost: 0 },
  );

  return {
    schemaVersion: first.schemaVersion,
    traceKind: "agent.session",
    runId: first.runId,
    correlationId: first.correlationId,
    sessionId,
    startTime: first.timestamp ?? Date.parse(String(first.recordedAt ?? "")),
    endTime: last.timestamp ?? Date.parse(String(last.recordedAt ?? "")),
    query: firstUserMessage || "(raw trace file without session index)",
    startUrl: first.snapshot?.url ?? "",
    outcome: doneSummary ? "completed_raw" : "raw_turns",
    failureCategory: doneSummary ? "none" : "unknown",
    failureCode: doneSummary ? "none" : "missing_session_index",
    turnCount: entries.length,
    summary: doneSummary || "Raw turn file exists but no session index record was written.",
    metrics: {
      totalTokens: tokenTotals.totalTokens,
      totalCost: tokenTotals.totalCost,
    },
  };
}

function extractDoneSummary(entry: TraceEntryRecord): string | null {
  for (const toolCall of entry.llmResponse?.toolCalls ?? []) {
    const name = (toolCall as any)?.function?.name ?? (toolCall as any)?.name;
    if (name !== "done") continue;
    const rawArgs =
      (toolCall as any)?.function?.arguments ?? (toolCall as any)?.arguments;
    if (typeof rawArgs !== "string") continue;
    try {
      const parsed = JSON.parse(rawArgs) as { summary?: unknown };
      return typeof parsed.summary === "string" ? parsed.summary : null;
    } catch {
      return null;
    }
  }
  return null;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function outcomeColor(outcome: string): string {
  switch (outcome) {
    case "completed":
      return c.green;
    case "stopped":
      return c.yellow;
    case "error":
      return c.red;
    case "max_turns":
      return c.yellow;
    default:
      return c.dim;
  }
}

function truncate(s: string | null | undefined, len: number): string {
  if (!s) return "";
  return s.length > len ? s.slice(0, len) + "..." : s;
}

function redactText(s: string | null | undefined, len = 400): string {
  return truncate(
    String(
      redactTracePayload(s ?? "", { mode: "export", maxStringLength: len }),
    ),
    len,
  );
}

function markdownCell(s: string | null | undefined): string {
  return redactText(s, 240).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function localDayKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function extractDomain(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function readJsonlFile<T>(
  file: string,
  onParseError?: (issue: TraceValidationIssue) => void,
): T[] {
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf-8");
  if (!text.trim()) return [];
  const records: T[] = [];
  text.split("\n").forEach((line, index) => {
    if (!line.trim()) return;
    try {
      records.push(JSON.parse(line) as T);
    } catch (err) {
      onParseError?.({
        severity: "error",
        code: "json_parse_error",
        message: String(err),
        file,
        line: index + 1,
      });
    }
  });
  return records;
}

function resolveSession(prefix: string): TraceSessionRecord | null {
  return (
    readIndex().find(
      (s) => s.sessionId === prefix || s.sessionId.startsWith(prefix),
    ) ?? null
  );
}

function readRunTrace(runId: string): RunTraceEvent[] {
  return traceRepository.loadRunEvents(runId) as unknown as RunTraceEvent[];
}

function readSessionLogs(sessionId: string) {
  const file = join(LOG_DIR, `session-${sessionId}.jsonl`);
  return readJsonlFile<{
    ts: string;
    lvl: string;
    src: string;
    cat: string;
    msg: string;
    rid?: string;
    sid?: string;
    data?: Record<string, unknown>;
  }>(file);
}

function readPins(): Set<string> {
  if (!existsSync(PINS_FILE)) return new Set();
  try {
    const parsed = JSON.parse(readFileSync(PINS_FILE, "utf-8")) as {
      sessions?: unknown;
    };
    return new Set(
      Array.isArray(parsed.sessions)
        ? parsed.sessions.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
    );
  } catch {
    return new Set();
  }
}

function writePins(pins: Set<string>): void {
  if (!existsSync(TRACE_DIR)) mkdirSync(TRACE_DIR, { recursive: true });
  writeFileSync(
    PINS_FILE,
    JSON.stringify(
      {
        schemaVersion: "2026-02-19",
        updatedAt: new Date().toISOString(),
        sessions: [...pins].sort(),
      },
      null,
      2,
    ) + "\n",
  );
}

function printIssue(issue: TraceValidationIssue): void {
  const color = issue.severity === "error" ? c.red : c.yellow;
  const loc = [
    issue.file,
    issue.line ? `:${issue.line}` : "",
    issue.sessionId ? ` session=${issue.sessionId.slice(0, 8)}` : "",
    issue.runId ? ` run=${issue.runId.slice(0, 8)}` : "",
    issue.turnNumber != null ? ` T${issue.turnNumber}` : "",
  ].join("");
  console.log(
    `  ${color}${issue.severity.toUpperCase()}${c.reset} ${issue.code} ${c.dim}${loc}${c.reset}`,
  );
  console.log(`    ${issue.message}`);
}

function writeJsonlFile<T>(file: string, records: T[]): void {
  if (records.length === 0) {
    if (existsSync(file)) unlinkSync(file);
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
  );
}

function numberArg(args: string[], name: string, fallback: number): number {
  const idx = args.indexOf(name);
  if (idx < 0 || !args[idx + 1]) return fallback;
  const parsed = parseInt(args[idx + 1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function loadAnalysisInput(sessionPrefix: string) {
  const session = resolveSession(sessionPrefix);
  if (!session) {
    console.error(`${c.red}Session not found: ${sessionPrefix}${c.reset}`);
    process.exit(1);
  }

  const entries = readTrace(session.sessionId) as unknown as TraceEntry[];
  const runEvents =
    typeof session.runId === "string" && session.runId.length > 0
      ? readRunTrace(session.runId)
      : [];
  const logs = readSessionLogs(session.sessionId);

  return {
    session,
    input: {
      session: session as unknown as TraceSession,
      entries,
      runEvents,
      logs,
    },
  };
}

// --- Commands ---

function cmdList() {
  const sessions = readIndex();
  if (sessions.length === 0) {
    console.log("No trace sessions found.");
    return;
  }
  console.log(`${c.bold}Sessions (${sessions.length}):${c.reset}\n`);
  for (const s of sessions.reverse()) {
    const oc = outcomeColor(s.outcome);
    const duration = formatDuration(s.endTime - s.startTime);
    const cost =
      s.metrics?.totalCost != null ? `$${s.metrics.totalCost.toFixed(4)}` : "";
    console.log(
      `  ${c.dim}${formatTime(s.startTime)}${c.reset} ${oc}${s.outcome.padEnd(10)}${c.reset} ` +
        `${c.cyan}${s.turnCount}t${c.reset} ${duration.padEnd(6)} ${cost.padEnd(8)} ` +
        `${truncate(s.query, 50)}`,
    );
    console.log(`  ${c.dim}${s.sessionId}${c.reset}`);
    console.log();
  }
}

function cmdShow(sessionId: string) {
  const sessions = readIndex();
  const session = sessions.find(
    (s) => s.sessionId === sessionId || s.sessionId.startsWith(sessionId),
  );
  if (!session) {
    console.error(`${c.red}Session not found: ${sessionId}${c.reset}`);
    process.exit(1);
  }

  const oc = outcomeColor(session.outcome);
  console.log(`${c.bold}Session: ${session.sessionId}${c.reset}`);
  console.log(`  Query:    ${session.query}`);
  console.log(`  URL:      ${session.startUrl}`);
  console.log(`  Outcome:  ${oc}${session.outcome}${c.reset}`);
  if (session.failureCode && session.failureCode !== "none") {
    console.log(
      `  Failure:  ${c.red}${session.failureCode}${c.reset} (${session.failureCategory || "unknown"})`,
    );
  }
  console.log(`  Turns:    ${session.turnCount}`);
  console.log(
    `  Duration: ${formatDuration(session.endTime - session.startTime)}`,
  );
  console.log(
    `  Time:     ${formatTime(session.startTime)} → ${formatTime(session.endTime)}`,
  );
  if (session.metrics) {
    const m = session.metrics;
    console.log(
      `  Tokens:   ${m.totalTokens?.toLocaleString() ?? "?"}  Cost: $${m.totalCost?.toFixed(4) ?? "?"}`,
    );
  }
  console.log(`  Summary:  ${session.summary}`);
  console.log();

  // Show turn overview
  const entries = readTrace(session.sessionId);
  console.log(`${c.bold}Turns (${entries.length}):${c.reset}`);
  for (const e of entries) {
    const tools =
      e.llmResponse.toolCalls.map((tc) => tc.function.name).join(", ") ||
      "(text only)";
    const text = truncate(e.llmResponse.content, 60);
    const events = e.events.map((ev) => ev.type).join(",");
    console.log(
      `  ${c.cyan}T${String(e.turnNumber).padStart(2)}${c.reset} ` +
        `${c.dim}${e.llmResponse.durationMs}ms${c.reset} ` +
        `${c.green}${tools}${c.reset}` +
        (events ? ` ${c.yellow}[${events}]${c.reset}` : "") +
        (text ? ` ${c.dim}${text}${c.reset}` : ""),
    );
  }
}

function cmdTurns(sessionId: string) {
  const entries = findTrace(sessionId);
  for (const e of entries) {
    console.log(
      `\n${c.bold}${c.cyan}Turn ${e.turnNumber}${c.reset} — ${formatTime(e.timestamp)}`,
    );
    console.log(`  ${c.dim}URL: ${truncate(e.snapshot.url, 80)}${c.reset}`);
    console.log(
      `  ${c.dim}Elements: ${e.snapshot.elementCount} | Model: ${e.llmRequest.model} | Compression: ${e.llmRequest.compressionLevel}${c.reset}`,
    );

    if (e.llmResponse.content) {
      console.log(
        `  ${c.bold}Text:${c.reset} ${truncate(e.llmResponse.content, 120)}`,
      );
    }
    for (const tc of e.llmResponse.toolCalls) {
      const args = truncate(tc.function.arguments, 80);
      console.log(`  ${c.green}→ ${tc.function.name}${c.reset}(${args})`);
    }
    for (const te of e.toolExecutions) {
      const status = te.success
        ? `${c.green}OK${c.reset}`
        : `${c.red}FAIL${c.reset}`;
      console.log(
        `  ${status} ${te.toolName} ${c.dim}${te.durationMs}ms${c.reset} ${truncate(te.result, 80)}`,
      );
    }
    for (const ev of e.events) {
      console.log(
        `  ${c.yellow}[${ev.type}]${c.reset} ${JSON.stringify(ev.data)}`,
      );
    }
  }
}

function cmdTurn(sessionId: string, turnNumber: number) {
  const entries = findTrace(sessionId);
  const entry = entries.find((e) => e.turnNumber === turnNumber);
  if (!entry) {
    console.error(`${c.red}Turn ${turnNumber} not found in session${c.reset}`);
    process.exit(1);
  }

  console.log(`${c.bold}Turn ${entry.turnNumber} — Full Detail${c.reset}`);
  console.log(`  Timestamp: ${formatTime(entry.timestamp)}`);
  console.log(`  URL:       ${entry.snapshot.url}`);
  console.log(`  Title:     ${entry.snapshot.title}`);
  console.log(`  Elements:  ${entry.snapshot.elementCount}`);
  console.log(`  Model:     ${entry.llmRequest.model}`);
  console.log(`  Messages:  ${entry.llmRequest.messageCount}`);
  console.log(`  Compress:  ${entry.llmRequest.compressionLevel}`);
  console.log();

  console.log(`${c.bold}LLM Response:${c.reset}`);
  console.log(`  Duration:  ${entry.llmResponse.durationMs}ms`);
  console.log(`  Finish:    ${entry.llmResponse.finishReason}`);
  if (entry.llmResponse.usage) {
    console.log(
      `  Tokens:    ${entry.llmResponse.usage.total_tokens}  Cost: $${entry.llmResponse.usage.cost?.toFixed(4) ?? "?"}`,
    );
  }
  if (entry.llmResponse.content) {
    console.log(`\n${c.bold}Content:${c.reset}`);
    console.log(entry.llmResponse.content);
  }
  console.log();

  if (entry.llmResponse.toolCalls.length > 0) {
    console.log(`${c.bold}Tool Calls:${c.reset}`);
    for (const tc of entry.llmResponse.toolCalls) {
      console.log(`  ${c.green}${tc.function.name}${c.reset}`);
      try {
        console.log(
          `    Args: ${JSON.stringify(JSON.parse(tc.function.arguments), null, 2)}`,
        );
      } catch {
        console.log(`    Args: ${tc.function.arguments}`);
      }
    }
    console.log();
  }

  if (entry.toolExecutions.length > 0) {
    console.log(`${c.bold}Tool Executions:${c.reset}`);
    for (const te of entry.toolExecutions) {
      const status = te.success
        ? `${c.green}OK${c.reset}`
        : `${c.red}FAIL${c.reset}`;
      console.log(`  ${status} ${te.toolName} (${te.durationMs}ms)`);
      console.log(`    Args:   ${JSON.stringify(te.args)}`);
      console.log(`    Result: ${te.result}`);
      if (te.error) console.log(`    ${c.red}Error:  ${te.error}${c.reset}`);
    }
    console.log();
  }

  if (entry.events.length > 0) {
    console.log(`${c.bold}Events:${c.reset}`);
    for (const ev of entry.events) {
      console.log(
        `  ${c.yellow}${ev.type}${c.reset} at ${formatTime(ev.timestamp)}: ${JSON.stringify(ev.data)}`,
      );
    }
    console.log();
  }

  console.log(
    `${c.bold}Progress:${c.reset} stagnantTurns=${entry.progressState.stagnantTurns ?? entry.progressState.staleTurns ?? 0} signal=${entry.progressState.signal ?? "none"}`,
  );
}

function cmdFilter(args: string[]) {
  const outcomeIdx = args.indexOf("--outcome");
  if (outcomeIdx === -1 || !args[outcomeIdx + 1]) {
    console.error(
      "Usage: filter --outcome <completed|stopped|error|max_turns>",
    );
    process.exit(1);
  }
  const outcome = args[outcomeIdx + 1];
  const sessions = readIndex().filter((s) => s.outcome === outcome);

  if (sessions.length === 0) {
    console.log(`No sessions with outcome "${outcome}"`);
    return;
  }
  console.log(
    `${c.bold}Sessions with outcome "${outcome}" (${sessions.length}):${c.reset}\n`,
  );
  for (const s of sessions.reverse()) {
    const duration = formatDuration(s.endTime - s.startTime);
    console.log(
      `  ${c.dim}${formatTime(s.startTime)}${c.reset} ${s.turnCount}t ${duration} ${truncate(s.query, 50)}`,
    );
    console.log(`  ${c.dim}${s.sessionId}${c.reset}\n`);
  }
}

function cmdDays() {
  const sessions = readIndex();
  if (sessions.length === 0) {
    console.log("No trace sessions found.");
    return;
  }
  const byDay: Record<string, number> = {};
  for (const s of sessions) {
    byDay[localDayKey(s.startTime)] =
      (byDay[localDayKey(s.startTime)] || 0) + 1;
  }
  console.log(`${c.bold}Trace Days:${c.reset}\n`);
  for (const [day, count] of Object.entries(byDay).sort((a, b) =>
    b[0].localeCompare(a[0]),
  )) {
    console.log(`  ${c.cyan}${day}${c.reset}  ${count}`);
  }
}

function cmdSearch(args: string[]) {
  const getArg = (name: string): string => {
    const idx = args.indexOf(name);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : "";
  };
  const day = getArg("--day");
  const from = getArg("--from");
  const to = getArg("--to");
  const domain = getArg("--domain").toLowerCase();
  const outcome = getArg("--outcome");
  const sessionPrefix = getArg("--session");
  const query = getArg("--q").toLowerCase();

  let sessions = readIndex();
  sessions = sessions.filter((s) => {
    const dayKey = localDayKey(s.startTime);
    if (day && dayKey !== day) return false;
    if (from && dayKey < from) return false;
    if (to && dayKey > to) return false;
    if (domain) {
      const d = extractDomain(s.startUrl);
      if (!d || !d.includes(domain)) return false;
    }
    if (outcome && s.outcome !== outcome) return false;
    if (sessionPrefix && !s.sessionId.startsWith(sessionPrefix)) return false;
    if (query) {
      const hay =
        `${s.query || ""} ${s.startUrl || ""} ${s.sessionId}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  if (sessions.length === 0) {
    console.log("No sessions match the provided filters.");
    return;
  }
  console.log(`${c.bold}Search Results (${sessions.length}):${c.reset}\n`);
  for (const s of sessions.sort((a, b) => b.startTime - a.startTime)) {
    const d = extractDomain(s.startUrl) || "-";
    console.log(
      `  ${c.dim}${localDayKey(s.startTime)}${c.reset} ${outcomeColor(s.outcome)}${s.outcome.padEnd(10)}${c.reset} ` +
        `${c.cyan}${d}${c.reset} ${truncate(s.query, 56)}`,
    );
    console.log(`  ${c.dim}${s.sessionId}${c.reset}\n`);
  }
}

function cmdStats() {
  const sessions = readIndex();
  if (sessions.length === 0) {
    console.log("No trace sessions found.");
    return;
  }

  const outcomes: Record<string, number> = {};
  const failureCodes: Record<string, number> = {};
  const failureCategories: Record<string, number> = {};
  let totalTurns = 0;
  let totalCost = 0;
  let totalDuration = 0;
  const toolCounts: Record<string, number> = {};

  for (const s of sessions) {
    outcomes[s.outcome] = (outcomes[s.outcome] || 0) + 1;
    if (s.failureCode && s.failureCode !== "none") {
      failureCodes[s.failureCode] = (failureCodes[s.failureCode] || 0) + 1;
    }
    if (s.failureCategory && s.failureCategory !== "none") {
      failureCategories[s.failureCategory] =
        (failureCategories[s.failureCategory] || 0) + 1;
    }
    totalTurns += s.turnCount;
    totalDuration += s.endTime - s.startTime;
    if (s.metrics?.totalCost) totalCost += s.metrics.totalCost;
  }

  // Read all trace files for tool stats
  const traceFiles = readdirSync(TRACE_DIR).filter(
    (f) => f.endsWith(".jsonl") && f !== "index.jsonl",
  );
  for (const file of traceFiles) {
    try {
      const lines = readFileSync(join(TRACE_DIR, file), "utf-8")
        .trim()
        .split("\n")
        .filter(Boolean);
      for (const line of lines) {
        const entry = JSON.parse(line);
        for (const tc of entry.llmResponse?.toolCalls ?? []) {
          const name = tc.function?.name || "unknown";
          toolCounts[name] = (toolCounts[name] || 0) + 1;
        }
      }
    } catch {
      /* skip corrupt files */
    }
  }

  console.log(`${c.bold}Trace Statistics${c.reset}\n`);
  console.log(`  Sessions:     ${sessions.length}`);
  console.log(`  Total turns:  ${totalTurns}`);
  console.log(`  Avg turns:    ${(totalTurns / sessions.length).toFixed(1)}`);
  console.log(`  Total cost:   $${totalCost.toFixed(4)}`);
  console.log(
    `  Avg duration: ${formatDuration(totalDuration / sessions.length)}`,
  );
  console.log();

  console.log(`${c.bold}Outcomes:${c.reset}`);
  for (const [outcome, count] of Object.entries(outcomes).sort(
    (a, b) => b[1] - a[1],
  )) {
    const pct = ((count / sessions.length) * 100).toFixed(0);
    console.log(
      `  ${outcomeColor(outcome)}${outcome.padEnd(12)}${c.reset} ${count} (${pct}%)`,
    );
  }
  console.log();

  if (Object.keys(failureCodes).length > 0) {
    console.log(`${c.bold}Failure Codes:${c.reset}`);
    for (const [code, count] of Object.entries(failureCodes).sort(
      (a, b) => b[1] - a[1],
    )) {
      const pct = ((count / sessions.length) * 100).toFixed(0);
      console.log(`  ${c.red}${code.padEnd(24)}${c.reset} ${count} (${pct}%)`);
    }
    console.log();
  }

  if (Object.keys(failureCategories).length > 0) {
    console.log(`${c.bold}Failure Categories:${c.reset}`);
    for (const [category, count] of Object.entries(failureCategories).sort(
      (a, b) => b[1] - a[1],
    )) {
      const pct = ((count / sessions.length) * 100).toFixed(0);
      console.log(
        `  ${c.yellow}${category.padEnd(24)}${c.reset} ${count} (${pct}%)`,
      );
    }
    console.log();
  }

  console.log(`${c.bold}Top Tools:${c.reset}`);
  const sortedTools = Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  for (const [name, count] of sortedTools) {
    console.log(`  ${c.green}${name.padEnd(20)}${c.reset} ${count}`);
  }
}

function cmdSummarize(sessionPrefix: string, args: string[] = []) {
  const { session, input } = loadAnalysisInput(sessionPrefix);
  const investigation = analyzeTraceSession(input);

  if (args.includes("--json")) {
    console.log(
      JSON.stringify(
        redactTracePayload(investigation, { mode: "export" }),
        null,
        2,
      ),
    );
    return;
  }

  console.log(`${c.bold}Investigation: ${session.sessionId}${c.reset}`);
  console.log(
    `  Outcome:       ${outcomeColor(session.outcome)}${session.outcome}${c.reset}`,
  );
  console.log(`  Headline:      ${investigation.headline}`);
  console.log(`  Failure class: ${investigation.likelyFailureClass}`);
  console.log(
    `  First turn:    ${investigation.firstBadTurn == null ? "-" : `T${investigation.firstBadTurn}`}`,
  );
  console.log(`  Next action:   ${investigation.recommendedAction}`);
  console.log();
  console.log(`${c.bold}Metrics:${c.reset}`);
  console.log(`  Turns:         ${investigation.metrics.turnCount}`);
  console.log(
    `  Productive:    ${investigation.metrics.productiveTurns}/${investigation.metrics.turnCount}`,
  );
  console.log(`  Tool failures: ${investigation.metrics.toolFailureTurns}`);
  console.log(
    `  Perception:    ${investigation.metrics.degradedPerceptionTurns}/${investigation.metrics.perceptionTurns} degraded`,
  );
  console.log(`  Context hot:   ${investigation.metrics.contextHotTurns}`);
  console.log(`  Replans:       ${investigation.metrics.replanCount}`);
  console.log(`  Done rejects:  ${investigation.metrics.doneRejectionCount}`);
  if (investigation.metrics.totalTokens > 0) {
    console.log(
      `  Tokens:        ${investigation.metrics.totalTokens.toLocaleString()}`,
    );
  }
  if (investigation.metrics.totalCost > 0) {
    console.log(
      `  Cost:          $${investigation.metrics.totalCost.toFixed(4)}`,
    );
  }

  if (investigation.findings.length === 0) {
    console.log();
    console.log("No structured findings detected.");
    return;
  }

  console.log();
  console.log(`${c.bold}Top Findings:${c.reset}`);
  for (const finding of investigation.findings.slice(0, 8)) {
    const color =
      finding.severity === "error"
        ? c.red
        : finding.severity === "warning"
          ? c.yellow
          : c.cyan;
    console.log(
      `  ${color}${finding.severity.toUpperCase()}${c.reset} ${finding.title} ${c.dim}${finding.category}${c.reset}`,
    );
    console.log(`    ${truncate(finding.summary, 160)}`);
    if (finding.firstTurn != null) {
      console.log(`    ${c.dim}turn T${finding.firstTurn}${c.reset}`);
    }
  }
}

function cmdContext(sessionPrefix: string, args: string[] = []) {
  const { input } = loadAnalysisInput(sessionPrefix);
  const report = buildTraceInvestigationReport(input, {
    maxFindings: numberArg(args, "--max-findings", 8),
    maxTurns: numberArg(args, "--max-turns", 10),
    turnWindow: numberArg(args, "--turn-window", 1),
    maxSnippetLength: numberArg(args, "--max-snippet", 1200),
  });
  console.log(report);
}

function cmdCompare(sessionPrefix: string, args: string[] = []) {
  const session = resolveSession(sessionPrefix);
  if (!session) {
    console.error(`${c.red}Session not found: ${sessionPrefix}${c.reset}`);
    process.exit(1);
  }

  const limit = numberArg(args, "--limit", 8);
  const sessions = readIndex() as unknown as TraceSession[];
  const result = compareTraceSessions(
    session as unknown as TraceSession,
    sessions,
    limit,
  );

  console.log(`${c.bold}Related Sessions${c.reset}`);
  console.log(`  Base: ${c.cyan}${session.sessionId}${c.reset}`);
  console.log(`  Query: ${truncate(session.query, 100)}`);
  console.log();

  if (result.comparisons.length === 0) {
    console.log("No related sessions found.");
    return;
  }

  for (const comparison of result.comparisons) {
    const turnDelta =
      comparison.turnDelta === 0
        ? "0t"
        : `${comparison.turnDelta > 0 ? "+" : ""}${comparison.turnDelta}t`;
    const costDelta =
      comparison.costDelta === 0
        ? "$0"
        : `${comparison.costDelta > 0 ? "+" : "-"}$${Math.abs(
            comparison.costDelta,
          ).toFixed(4)}`;
    const durationDelta =
      comparison.durationDeltaMs === 0
        ? "0ms"
        : `${comparison.durationDeltaMs > 0 ? "+" : "-"}${formatDuration(
            Math.abs(comparison.durationDeltaMs),
          )}`;
    const signals = [
      comparison.failureLabel,
      comparison.domain,
      comparison.sharedSkills.length
        ? `skills=${comparison.sharedSkills.join(",")}`
        : "",
      comparison.sharedModels.length
        ? `models=${comparison.sharedModels.join(",")}`
        : "",
    ].filter(Boolean);

    console.log(
      `  ${c.cyan}${comparison.sessionId}${c.reset} ${c.bold}${comparison.label}${c.reset} ${outcomeColor(
        comparison.outcome,
      )}${comparison.outcome}${c.reset}`,
    );
    console.log(`    ${truncate(comparison.queryTitle, 100)}`);
    console.log(
      `    ${turnDelta} ${durationDelta} ${costDelta}` +
        (signals.length ? ` ${c.dim}${signals.join(" | ")}${c.reset}` : ""),
    );
    console.log(`    ${c.dim}${comparison.recommendation}${c.reset}`);
  }
}

function cmdDiff(
  basePrefix: string,
  candidatePrefix: string,
  args: string[] = [],
) {
  const base = resolveSession(basePrefix);
  const candidate = resolveSession(candidatePrefix);
  if (!base) {
    console.error(`${c.red}Session not found: ${basePrefix}${c.reset}`);
    process.exit(1);
  }
  if (!candidate) {
    console.error(`${c.red}Session not found: ${candidatePrefix}${c.reset}`);
    process.exit(1);
  }

  const diff = compareTraceTimelines(
    {
      baseSession: base as unknown as TraceSession,
      baseEntries: readTrace(base.sessionId) as unknown as TraceEntry[],
      candidateSession: candidate as unknown as TraceSession,
      candidateEntries: readTrace(
        candidate.sessionId,
      ) as unknown as TraceEntry[],
    },
    {
      maxDiffs: numberArg(args, "--limit", 8),
    },
  );

  console.log(`${c.bold}Trace Timeline Diff${c.reset}`);
  console.log(`  Base:    ${c.cyan}${base.sessionId}${c.reset}`);
  console.log(`  Related: ${c.cyan}${candidate.sessionId}${c.reset}`);
  console.log(`  Turns:   ${diff.turnsCompared}`);
  console.log();
  console.log(`  ${c.bold}${diff.headline}${c.reset}`);
  console.log(`  ${diff.recommendedAction}`);

  if (diff.diffs.length === 0) return;

  console.log();
  for (const turn of diff.diffs) {
    const color =
      turn.severity === "error"
        ? c.red
        : turn.severity === "warning"
          ? c.yellow
          : c.cyan;
    console.log(
      `  ${color}T${turn.turnNumber}${c.reset} ${c.bold}${turn.summary}${c.reset}`,
    );
    if (
      turn.baseTitle ||
      turn.candidateTitle ||
      turn.baseUrl ||
      turn.candidateUrl
    ) {
      console.log(
        `    base:    ${truncate(turn.baseTitle || turn.baseUrl || "-", 100)}`,
      );
      console.log(
        `    related: ${truncate(
          turn.candidateTitle || turn.candidateUrl || "-",
          100,
        )}`,
      );
    }
    for (const signal of turn.signals.slice(0, 6)) {
      const changed = signal.changed ? "" : ` ${c.dim}(shared)${c.reset}`;
      console.log(`    ${signal.category} ${signal.label}${changed}`);
      console.log(`      base:    ${truncate(signal.base || "-", 100)}`);
      console.log(`      related: ${truncate(signal.candidate || "-", 100)}`);
    }
    if (turn.signals.length > 6) {
      console.log(
        `    ${c.dim}+${turn.signals.length - 6} more signals${c.reset}`,
      );
    }
  }
}

function cmdDebugBundle(sessionPrefix: string, args: string[] = []) {
  const { session, input } = loadAnalysisInput(sessionPrefix);
  const maxRelated = numberArg(args, "--related", 3);
  const maxDiffs = numberArg(args, "--diffs", 4);
  const report = buildTraceInvestigationReport(input, {
    maxFindings: numberArg(args, "--max-findings", 8),
    maxTurns: numberArg(args, "--max-turns", 10),
    turnWindow: numberArg(args, "--turn-window", 1),
    maxSnippetLength: numberArg(args, "--max-snippet", 1200),
  });
  const allSessions = readIndex() as unknown as TraceSession[];
  const comparisons = compareTraceSessions(
    session as unknown as TraceSession,
    allSessions,
    maxRelated,
  ).comparisons;
  const validationIssues = [
    ...validateTraceRecord(session as unknown as Record<string, unknown>, {
      sessionId: session.sessionId,
      runId: session.runId,
    }).issues,
    ...input.entries.flatMap(
      (entry) =>
        validateTraceRecord(entry as unknown as Record<string, unknown>, {
          sessionId: session.sessionId,
          runId: session.runId,
        }).issues,
    ),
    ...input.runEvents.flatMap(
      (event) =>
        validateTraceRecord(event as unknown as Record<string, unknown>, {
          sessionId: session.sessionId,
          runId: session.runId,
        }).issues,
    ),
  ];

  console.log(report.trimEnd());

  console.log("\n## Related Sessions");
  if (comparisons.length === 0) {
    console.log("\nNo related sessions found in the current trace index.");
  } else {
    console.log(
      "\n| Session | Relation | Outcome | Delta | Signals | Recommended check |",
    );
    console.log("| --- | --- | --- | --- | --- | --- |");
    for (const comparison of comparisons) {
      const turnDelta =
        comparison.turnDelta === 0
          ? "0t"
          : `${comparison.turnDelta > 0 ? "+" : ""}${comparison.turnDelta}t`;
      const costDelta =
        comparison.costDelta === 0
          ? "$0"
          : `${comparison.costDelta > 0 ? "+" : "-"}$${Math.abs(
              comparison.costDelta,
            ).toFixed(4)}`;
      const signals = [
        comparison.failureLabel,
        comparison.domain,
        comparison.sharedSkills.length
          ? `skills=${comparison.sharedSkills.join(",")}`
          : "",
        comparison.sharedModels.length
          ? `models=${comparison.sharedModels.join(",")}`
          : "",
      ]
        .filter(Boolean)
        .join("; ");
      console.log(
        `| ${markdownCell(comparison.sessionId)} | ${markdownCell(
          comparison.label,
        )} | ${markdownCell(comparison.outcome)} | ${turnDelta}, ${costDelta} | ${markdownCell(
          signals || "-",
        )} | ${markdownCell(comparison.recommendation)} |`,
      );
    }
  }

  console.log("\n## First Divergence Checks");
  if (comparisons.length === 0) {
    console.log("\nNo related sessions available for timeline diffing.");
  }
  for (const comparison of comparisons) {
    const candidate = allSessions.find(
      (item) => item.sessionId === comparison.sessionId,
    );
    const candidateEntries = tryReadTrace(comparison.sessionId);
    if (!candidate || !candidateEntries) {
      console.log(
        `\n### ${markdownCell(comparison.sessionId)}\n\nTrace entries are missing for this related session.`,
      );
      continue;
    }
    const diff = compareTraceTimelines(
      {
        baseSession: session as unknown as TraceSession,
        baseEntries: input.entries,
        candidateSession: candidate,
        candidateEntries,
      },
      { maxDiffs },
    );

    console.log(`\n### ${markdownCell(comparison.sessionId)}`);
    console.log(`\n${redactText(diff.headline, 500)}`);
    console.log(
      `\nRecommended action: ${redactText(diff.recommendedAction, 500)}`,
    );
    if (diff.diffs.length === 0) {
      console.log("\nNo turn-level diff signals found.");
      continue;
    }
    for (const turn of diff.diffs) {
      console.log(
        `\n- T${turn.turnNumber} ${turn.severity}: ${redactText(turn.summary, 240)}`,
      );
      for (const signal of turn.signals.slice(0, 5)) {
        const marker = signal.changed ? "changed" : "shared";
        console.log(
          `  - ${signal.category} (${marker}): ${redactText(
            signal.label,
            240,
          )}`,
        );
        console.log(`    - base: ${redactText(signal.base || "-", 240)}`);
        console.log(
          `    - related: ${redactText(signal.candidate || "-", 240)}`,
        );
      }
    }
  }

  console.log("\n## Trace Integrity Notes");
  if (validationIssues.length === 0) {
    console.log("\nNo validation issues found for this session bundle.");
  } else {
    const errors = validationIssues.filter(
      (issue) => issue.severity === "error",
    );
    const warnings = validationIssues.filter(
      (issue) => issue.severity === "warning",
    );
    console.log(
      `\nValidation found ${errors.length} errors and ${warnings.length} warnings. Top issues:`,
    );
    for (const issue of validationIssues.slice(0, 12)) {
      const turn = issue.turnNumber != null ? ` T${issue.turnNumber}` : "";
      console.log(
        `- ${issue.severity}: ${issue.code}${turn} - ${redactText(
          issue.message,
          240,
        )}`,
      );
    }
  }

  console.log("\n## Suggested Agent Workflow");
  console.log(
    "\n1. Start with the investigation headline and first bad turn.\n2. Check related sessions for repeated failure class, domain, skill, or model patterns.\n3. Use the first divergence checks to separate page/tool failures from model, perception, context, or verifier behavior.\n4. Treat validation warnings as confidence limits before drawing conclusions from missing IDs, screenshots, or run links.",
  );
}

function cmdValidate() {
  const issues: TraceValidationIssue[] = [];
  const sessions = readJsonlFile<TraceSession>(INDEX_FILE, (issue) =>
    issues.push(issue),
  );
  const entriesBySession = new Map<string, TraceEntry[]>();
  const sessionFiles = new Set<string>();

  if (existsSync(TRACE_DIR)) {
    for (const file of readdirSync(TRACE_DIR)) {
      if (!file.endsWith(".jsonl") || file === "index.jsonl") continue;
      const sessionId = file.replace(/\.jsonl$/, "");
      sessionFiles.add(sessionId);
      entriesBySession.set(
        sessionId,
        readJsonlFile<TraceEntry>(join(TRACE_DIR, file), (issue) =>
          issues.push(issue),
        ),
      );
    }
  }

  const runEventsByRun = new Map<string, RunTraceEvent[]>();
  const manifests = readJsonlFile<Record<string, unknown>>(
    RUN_INDEX_FILE,
    (issue) => issues.push(issue),
  );
  for (const manifest of manifests) {
    issues.push(
      ...validateTraceRecord(manifest, {
        runId: typeof manifest.runId === "string" ? manifest.runId : undefined,
      }).issues,
    );
  }
  if (existsSync(RUN_TRACE_DIR)) {
    for (const file of readdirSync(RUN_TRACE_DIR)) {
      if (!file.endsWith(".jsonl") || file === "index.jsonl") continue;
      const runId = file.replace(/\.jsonl$/, "");
      runEventsByRun.set(
        runId,
        readJsonlFile<RunTraceEvent>(join(RUN_TRACE_DIR, file), (issue) =>
          issues.push(issue),
        ),
      );
    }
  }

  const screenshotFiles = existsSync(SCREENSHOT_DIR)
    ? new Set(readdirSync(SCREENSHOT_DIR))
    : new Set<string>();
  const bundle: TraceBundleValidationInput = {
    sessions,
    entriesBySession,
    runEventsByRun,
    screenshotFiles,
    sessionFiles,
  };
  issues.push(...validateTraceBundle(bundle));

  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  console.log(`${c.bold}Trace Validation${c.reset}`);
  console.log(`  Sessions:    ${sessions.length}`);
  console.log(`  Trace files: ${entriesBySession.size}`);
  console.log(`  Run files:   ${runEventsByRun.size}`);
  console.log(`  Screenshots: ${screenshotFiles.size}`);
  console.log(`  Errors:      ${errors.length}`);
  console.log(`  Warnings:    ${warnings.length}`);

  if (issues.length === 0) {
    console.log(`\n${c.green}OK${c.reset} No validation issues found.`);
    return;
  }

  console.log();
  for (const issue of issues) {
    printIssue(issue);
  }

  if (errors.length > 0) process.exit(1);
}

function cmdPin(sessionPrefix: string, pinned: boolean) {
  const session = resolveSession(sessionPrefix);
  if (!session) {
    console.error(`${c.red}Session not found: ${sessionPrefix}${c.reset}`);
    process.exit(1);
  }

  const pins = readPins();
  if (pinned) {
    pins.add(session.sessionId);
  } else {
    pins.delete(session.sessionId);
  }
  writePins(pins);
  console.log(
    `${pinned ? "Pinned" : "Unpinned"} ${c.cyan}${session.sessionId}${c.reset}`,
  );
}

function sessionIdFromScreenshot(file: string): string | null {
  const match = file.match(/^(.+)-T\d+(?:-pan\d+)?\.jpg$/);
  return match?.[1] ?? null;
}

function cmdCleanup(args: string[]) {
  const dryRun = args.includes("--dry-run");
  const includePinned = args.includes("--all");
  const pins = readPins();
  const sessions = readRawIndex();
  const pinnedSessions = includePinned ? new Set<string>() : pins;
  const keptSessions = sessions.filter((session) =>
    pinnedSessions.has(session.sessionId),
  );
  const keptSessionIds = new Set(
    keptSessions.map((session) => session.sessionId),
  );
  const deletedSessionIds = new Set<string>();
  let deleted = 0;

  const remove = (file: string) => {
    if (dryRun) {
      console.log(`  ${c.dim}would delete${c.reset} ${file}`);
      deleted++;
      return;
    }
    try {
      unlinkSync(file);
      deleted++;
    } catch {
      /* ignore */
    }
  };

  if (existsSync(TRACE_DIR)) {
    for (const file of readdirSync(TRACE_DIR)) {
      if (!file.endsWith(".jsonl") || file === "index.jsonl") continue;
      const sessionId = file.replace(/\.jsonl$/, "");
      if (!keptSessionIds.has(sessionId)) {
        deletedSessionIds.add(sessionId);
        remove(join(TRACE_DIR, file));
      }
    }
  }

  for (const session of sessions) {
    if (!keptSessionIds.has(session.sessionId)) {
      deletedSessionIds.add(session.sessionId);
    }
  }

  if (existsSync(SCREENSHOT_DIR)) {
    for (const file of readdirSync(SCREENSHOT_DIR)) {
      const sessionId = sessionIdFromScreenshot(file);
      if (!sessionId || !keptSessionIds.has(sessionId)) {
        remove(join(SCREENSHOT_DIR, file));
      }
    }
  }

  const keptRunIds = new Set(
    keptSessions
      .map((session) => session.runId)
      .filter(
        (runId): runId is string =>
          typeof runId === "string" && runId.length > 0,
      ),
  );
  if (existsSync(RUN_TRACE_DIR)) {
    for (const file of readdirSync(RUN_TRACE_DIR)) {
      if (!file.endsWith(".jsonl") || file === "index.jsonl") continue;
      const runId = file.replace(/\.jsonl$/, "");
      if (!keptRunIds.has(runId)) {
        remove(join(RUN_TRACE_DIR, file));
      }
    }
  }

  if (!dryRun) {
    writeJsonlFile(INDEX_FILE, keptSessions);
    const keptRunManifests = readRunIndex().filter((run) =>
      keptRunIds.has(run.runId),
    );
    writeJsonlFile(RUN_INDEX_FILE, keptRunManifests);
    if (includePinned && existsSync(PINS_FILE)) unlinkSync(PINS_FILE);
  }

  console.log(`${c.bold}Trace cleanup${dryRun ? " dry run" : ""}${c.reset}`);
  console.log(`  Deleted artifacts: ${deleted}`);
  console.log(
    `  Preserved pins:    ${includePinned ? 0 : keptSessionIds.size}`,
  );
  if (deletedSessionIds.size > 0) {
    console.log(`  Sessions touched:  ${deletedSessionIds.size}`);
  }
}

function cmdPathologies(sessionId?: string) {
  const pathologyCounts: Record<string, number> = {};
  const pathologyDetails: {
    session: string;
    turn: number;
    pathology: string;
    trigger: string;
    details?: string;
  }[] = [];

  const processEntries = (entries: TraceEntryRecord[], sid: string) => {
    for (const entry of entries) {
      for (const ev of entry.events) {
        if (ev.type === "multi_turn_pathology") {
          const data = ev.data as {
            pathology?: string;
            trigger?: string;
            turn?: number;
            details?: string;
          };
          const p = data.pathology || "unknown";
          pathologyCounts[p] = (pathologyCounts[p] || 0) + 1;
          pathologyDetails.push({
            session: sid.slice(0, 8),
            turn: data.turn ?? entry.turnNumber,
            pathology: p,
            trigger: data.trigger || "",
            details: data.details,
          });
        }
        if (ev.type === "fresh_start_recovery") {
          const data = ev.data as {
            freshStartNumber?: number;
            totalTurnsSoFar?: number;
            escalationCycles?: number;
          };
          pathologyDetails.push({
            session: sid.slice(0, 8),
            turn: entry.turnNumber,
            pathology: "fresh_start",
            trigger: `#${data.freshStartNumber ?? "?"}`,
            details: `turns=${data.totalTurnsSoFar} cycles=${data.escalationCycles}`,
          });
        }
      }
    }
  };

  if (sessionId) {
    const entries = findTrace(sessionId);
    const sessions = readIndex();
    const session = sessions.find(
      (s) => s.sessionId === sessionId || s.sessionId.startsWith(sessionId),
    );
    processEntries(entries, session?.sessionId || sessionId);
  } else {
    // Scan all trace files
    if (!existsSync(TRACE_DIR)) {
      console.log("No trace directory found.");
      return;
    }
    const files = readdirSync(TRACE_DIR).filter(
      (f) => f.endsWith(".jsonl") && f !== "index.jsonl",
    );
    for (const file of files) {
      try {
        const sid = file.replace(".jsonl", "");
        const lines = readFileSync(join(TRACE_DIR, file), "utf-8")
          .trim()
          .split("\n")
          .filter(Boolean);
        const entries: TraceEntryRecord[] = lines.map((l) => JSON.parse(l));
        processEntries(entries, sid);
      } catch {
        /* skip corrupt */
      }
    }
  }

  if (pathologyDetails.length === 0) {
    console.log("No multi-turn pathologies found.");
    return;
  }

  console.log(
    `${c.bold}Multi-Turn Pathologies${sessionId ? ` (session ${sessionId.slice(0, 8)}...)` : ""}${c.reset}\n`,
  );

  // Summary
  console.log(`${c.bold}By Type:${c.reset}`);
  for (const [p, count] of Object.entries(pathologyCounts).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  ${c.yellow}${p.padEnd(24)}${c.reset} ${count}`);
  }
  console.log();

  // Detail list
  console.log(`${c.bold}Events (${pathologyDetails.length}):${c.reset}`);
  for (const d of pathologyDetails) {
    console.log(
      `  ${c.dim}${d.session}${c.reset} T${String(d.turn).padStart(2)} ` +
        `${c.yellow}${d.pathology.padEnd(24)}${c.reset} ${c.dim}${d.trigger}${c.reset}` +
        (d.details ? ` ${c.dim}${truncate(d.details, 60)}${c.reset}` : ""),
    );
  }
}

// --- Run types and helpers ---

interface RunManifestRecord {
  runId: string;
  correlationId?: string;
  startedAt: string;
  source: string;
  taskId?: string;
  workspaceId?: string;
}

function readRunIndex(): RunManifestRecord[] {
  if (!existsSync(RUN_INDEX_FILE)) return [];
  const lines = readFileSync(RUN_INDEX_FILE, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean);
  return lines.map((l) => JSON.parse(l));
}

function findRunByPrefix(prefix: string): RunManifestRecord | null {
  const runs = readRunIndex();
  return (
    runs.find((r) => r.runId === prefix || r.runId.startsWith(prefix)) ?? null
  );
}

function findSessionsByRunId(runIdPrefix: string): TraceSessionRecord[] {
  const sessions = readIndex();
  return sessions.filter((s) => {
    const rid = (s as any).runId;
    return typeof rid === "string" && rid.startsWith(runIdPrefix);
  });
}

function cmdRunsList() {
  const runs = readRunIndex();
  if (runs.length === 0) {
    console.log("No orchestrator runs found.");
    return;
  }

  // Count sessions per run
  const sessions = readIndex();
  const sessionsByRun = new Map<string, number>();
  for (const s of sessions) {
    const rid = (s as any).runId;
    if (typeof rid === "string" && rid.length > 0) {
      sessionsByRun.set(rid, (sessionsByRun.get(rid) || 0) + 1);
    }
  }

  const sorted = [...runs].sort((a, b) =>
    (b.startedAt || "").localeCompare(a.startedAt || ""),
  );
  console.log(`${c.bold}Orchestrator Runs (${sorted.length}):${c.reset}\n`);
  for (const r of sorted) {
    const shortId = r.runId.slice(0, 8);
    const count = sessionsByRun.get(r.runId) ?? 0;
    const started = r.startedAt ? new Date(r.startedAt).toLocaleString() : "?";
    console.log(
      `  ${c.cyan}${shortId}${c.reset} ${c.dim}${started}${c.reset} ` +
        `${count} session${count !== 1 ? "s" : ""} ` +
        `${c.dim}src=${r.source || "?"}${c.reset}`,
    );
  }
}

function cmdRunsShow(prefix: string) {
  const run = findRunByPrefix(prefix);
  if (!run) {
    console.error(`${c.red}Run not found: ${prefix}${c.reset}`);
    process.exit(1);
  }

  console.log(`${c.bold}Run: ${run.runId}${c.reset}`);
  console.log(`  Short ID:   ${c.cyan}${run.runId.slice(0, 8)}${c.reset}`);
  console.log(
    `  Started:    ${run.startedAt ? new Date(run.startedAt).toLocaleString() : "?"}`,
  );
  console.log(`  Source:     ${run.source || "?"}`);
  if (run.taskId) console.log(`  Task ID:    ${run.taskId}`);
  if (run.workspaceId) console.log(`  Workspace:  ${run.workspaceId}`);
  console.log();

  // List sessions in this run
  const sessions = findSessionsByRunId(run.runId);
  if (sessions.length === 0) {
    console.log("  No agent sessions found for this run.");
    return;
  }

  console.log(`${c.bold}Sessions (${sessions.length}):${c.reset}`);
  for (const s of sessions.sort(
    (a, b) => (a.startTime ?? 0) - (b.startTime ?? 0),
  )) {
    const oc = outcomeColor(s.outcome);
    const duration = formatDuration(s.endTime - s.startTime);
    const cost =
      s.metrics?.totalCost != null ? `$${s.metrics.totalCost.toFixed(4)}` : "";
    console.log(
      `  ${c.dim}${formatTime(s.startTime)}${c.reset} ${oc}${s.outcome.padEnd(10)}${c.reset} ` +
        `${c.cyan}${s.turnCount}t${c.reset} ${duration.padEnd(6)} ${cost.padEnd(8)} ` +
        `${truncate(s.query, 50)}`,
    );
    console.log(`  ${c.dim}${s.sessionId}${c.reset}\n`);
  }
}

function cmdRunsSessions(prefix: string) {
  const run = findRunByPrefix(prefix);
  if (!run) {
    console.error(`${c.red}Run not found: ${prefix}${c.reset}`);
    process.exit(1);
  }

  const sessions = findSessionsByRunId(run.runId);
  if (sessions.length === 0) {
    console.log("No sessions found for this run.");
    return;
  }

  for (const s of sessions.sort(
    (a, b) => (a.startTime ?? 0) - (b.startTime ?? 0),
  )) {
    console.log(s.sessionId);
  }
}

function cmdHelp() {
  console.log(`
${c.bold}Trace Query CLI${c.reset}

Usage: pnpm run traces -- <command> [args]

Commands:
  list                          List all recorded sessions
  show <session-id>             Session summary + turn overview
  turns <session-id>            Show each turn with tool calls
  turn <session-id> <N>         Full detail for turn N
  days                          List days with session counts
  search [--day YYYY-MM-DD] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--domain host] [--outcome o] [--session prefix] [--q text]
  filter --outcome <outcome>    Filter sessions by outcome
  stats                         Aggregate statistics
  summarize <session-id> [--json]
                                High-signal diagnosis for one session
  context <session-id> [--max-turns N] [--turn-window N]
                                Redacted agent-ready investigation context
  compare <session-id> [--limit N]
                                Show related sessions for comparative debugging
  diff <base-id> <related-id> [--limit N]
                                Side-by-side first divergence summary
  debug <session-id> [--related N] [--diffs N]
                                Agent-debug bundle with context, related traces, diffs
  validate                      Validate trace JSONL integrity and links
  pin <session-id>              Protect a session from cleanup
  unpin <session-id>            Remove cleanup protection
  cleanup [--dry-run] [--all]   Delete artifacts; pins are preserved unless --all
  pathologies [session-id]      Show multi-turn pathology events
  runs list                     List all orchestrator runs
  runs show <run-id>            Show run manifest + linked sessions
  runs sessions <run-id>        List session IDs for a run (scriptable)
  help                          Show this help

Session and run IDs can be abbreviated (prefix match).
`);
}

function findTrace(sessionId: string): TraceEntryRecord[] {
  // Support prefix matching
  if (!existsSync(TRACE_DIR)) {
    console.error(`${c.red}Trace directory not found: ${TRACE_DIR}${c.reset}`);
    process.exit(1);
  }
  const files = readdirSync(TRACE_DIR).filter(
    (f) =>
      f.startsWith(sessionId) && f.endsWith(".jsonl") && f !== "index.jsonl",
  );
  if (files.length === 0) {
    // Try exact match
    return readTrace(sessionId);
  }
  return readTrace(files[0].replace(".jsonl", ""));
}

// --- Main ---
const args = process.argv.slice(2);
const command = args[0] || "help";

switch (command) {
  case "list":
    cmdList();
    break;
  case "show":
    if (!args[1]) {
      console.error("Usage: show <session-id>");
      process.exit(1);
    }
    cmdShow(args[1]);
    break;
  case "turns":
    if (!args[1]) {
      console.error("Usage: turns <session-id>");
      process.exit(1);
    }
    cmdTurns(args[1]);
    break;
  case "turn":
    if (!args[1] || !args[2]) {
      console.error("Usage: turn <session-id> <N>");
      process.exit(1);
    }
    cmdTurn(args[1], parseInt(args[2], 10));
    break;
  case "filter":
    cmdFilter(args.slice(1));
    break;
  case "days":
    cmdDays();
    break;
  case "search":
    cmdSearch(args.slice(1));
    break;
  case "stats":
    cmdStats();
    break;
  case "summarize":
    if (!args[1]) {
      console.error("Usage: summarize <session-id> [--json]");
      process.exit(1);
    }
    cmdSummarize(args[1], args.slice(2));
    break;
  case "context":
    if (!args[1]) {
      console.error(
        "Usage: context <session-id> [--max-turns N] [--turn-window N]",
      );
      process.exit(1);
    }
    cmdContext(args[1], args.slice(2));
    break;
  case "compare":
    if (!args[1]) {
      console.error("Usage: compare <session-id> [--limit N]");
      process.exit(1);
    }
    cmdCompare(args[1], args.slice(2));
    break;
  case "diff":
    if (!args[1] || !args[2]) {
      console.error("Usage: diff <base-id> <related-id> [--limit N]");
      process.exit(1);
    }
    cmdDiff(args[1], args[2], args.slice(3));
    break;
  case "debug":
  case "debug-bundle":
    if (!args[1]) {
      console.error(
        "Usage: debug <session-id> [--related N] [--diffs N] [--max-turns N]",
      );
      process.exit(1);
    }
    cmdDebugBundle(args[1], args.slice(2));
    break;
  case "validate":
    cmdValidate();
    break;
  case "pin":
    if (!args[1]) {
      console.error("Usage: pin <session-id>");
      process.exit(1);
    }
    cmdPin(args[1], true);
    break;
  case "unpin":
    if (!args[1]) {
      console.error("Usage: unpin <session-id>");
      process.exit(1);
    }
    cmdPin(args[1], false);
    break;
  case "cleanup":
    cmdCleanup(args.slice(1));
    break;
  case "pathologies":
    cmdPathologies(args[1]);
    break;
  case "runs": {
    const subCmd = args[1] || "list";
    if (subCmd === "list") cmdRunsList();
    else if (subCmd === "show") {
      if (!args[2]) {
        console.error("Usage: runs show <run-id>");
        process.exit(1);
      }
      cmdRunsShow(args[2]);
    } else if (subCmd === "sessions") {
      if (!args[2]) {
        console.error("Usage: runs sessions <run-id>");
        process.exit(1);
      }
      cmdRunsSessions(args[2]);
    } else {
      console.error(
        `Unknown runs subcommand: ${subCmd}. Use: list, show, sessions`,
      );
      process.exit(1);
    }
    break;
  }
  case "help":
  default:
    cmdHelp();
    break;
}
