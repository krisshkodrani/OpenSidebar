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

  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  logServerProcess = spawn(command, ["tsx", LOG_SERVER_SCRIPT], {
    cwd: PROJECT_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
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

export interface SkillTraceSummary {
  runId: string;
  skillIds: string[];
  nodeSkills: Array<{
    nodeId: string;
    skillId: string;
    reason?: string;
  }>;
}

export function extractDoneSummary(traceFiles: string[]): string {
  for (const filePath of traceFiles) {
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
  return "";
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
