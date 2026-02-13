/**
 * Trace Query CLI — query trace files produced by the log server.
 *
 * Usage: bun run scripts/trace-query.ts <command> [args]
 * Or:    bun run traces <command> [args]
 *
 * Commands:
 *   list                          List all recorded sessions
 *   show <session-id>             Session summary + turn-by-turn overview
 *   turns <session-id>            Show each turn: tool calls, LLM response snippet
 *   turn <session-id> <N>         Full detail for turn N
 *   filter --outcome <outcome>    Filter sessions by outcome
 *   stats                         Aggregate stats across all sessions
 *   help                          Show usage
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";

const PROJECT_ROOT = join(dirname(import.meta.dir));
const TRACE_DIR = join(PROJECT_ROOT, "traces");
const INDEX_FILE = join(TRACE_DIR, "index.jsonl");

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
  sessionId: string;
  startTime: number;
  endTime: number;
  query: string;
  startUrl: string;
  outcome: string;
  turnCount: number;
  summary: string;
  metrics: {
    totalTokens?: number;
    totalCost?: number;
    totalLlmTimeMs?: number;
  } | null;
}

interface TraceEntryRecord {
  sessionId: string;
  turnNumber: number;
  timestamp: number;
  snapshot: { url: string; title: string; elementCount: number };
  llmRequest: { model: string; messageCount: number; compressionLevel: string };
  llmResponse: {
    content: string | null;
    toolCalls: { id: string; type: string; function: { name: string; arguments: string } }[];
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
  progressState: { staleTurns: number; signal: string | null };
}

function readIndex(): TraceSessionRecord[] {
  if (!existsSync(INDEX_FILE)) return [];
  const lines = readFileSync(INDEX_FILE, "utf-8").trim().split("\n").filter(Boolean);
  return lines.map((l) => JSON.parse(l));
}

function readTrace(sessionId: string): TraceEntryRecord[] {
  const file = join(TRACE_DIR, `${sessionId}.jsonl`);
  if (!existsSync(file)) {
    console.error(`${c.red}Trace file not found: ${file}${c.reset}`);
    process.exit(1);
  }
  const lines = readFileSync(file, "utf-8").trim().split("\n").filter(Boolean);
  return lines.map((l) => JSON.parse(l));
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
    case "completed": return c.green;
    case "stopped": return c.yellow;
    case "error": return c.red;
    case "max_turns": return c.yellow;
    default: return c.dim;
  }
}

function truncate(s: string | null | undefined, len: number): string {
  if (!s) return "";
  return s.length > len ? s.slice(0, len) + "..." : s;
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
    const cost = s.metrics?.totalCost != null ? `$${s.metrics.totalCost.toFixed(4)}` : "";
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
  const session = sessions.find((s) => s.sessionId === sessionId || s.sessionId.startsWith(sessionId));
  if (!session) {
    console.error(`${c.red}Session not found: ${sessionId}${c.reset}`);
    process.exit(1);
  }

  const oc = outcomeColor(session.outcome);
  console.log(`${c.bold}Session: ${session.sessionId}${c.reset}`);
  console.log(`  Query:    ${session.query}`);
  console.log(`  URL:      ${session.startUrl}`);
  console.log(`  Outcome:  ${oc}${session.outcome}${c.reset}`);
  console.log(`  Turns:    ${session.turnCount}`);
  console.log(`  Duration: ${formatDuration(session.endTime - session.startTime)}`);
  console.log(`  Time:     ${formatTime(session.startTime)} → ${formatTime(session.endTime)}`);
  if (session.metrics) {
    const m = session.metrics;
    console.log(`  Tokens:   ${m.totalTokens?.toLocaleString() ?? "?"}  Cost: $${m.totalCost?.toFixed(4) ?? "?"}`);
  }
  console.log(`  Summary:  ${session.summary}`);
  console.log();

  // Show turn overview
  const entries = readTrace(session.sessionId);
  console.log(`${c.bold}Turns (${entries.length}):${c.reset}`);
  for (const e of entries) {
    const tools = e.llmResponse.toolCalls.map((tc) => tc.function.name).join(", ") || "(text only)";
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
    console.log(`\n${c.bold}${c.cyan}Turn ${e.turnNumber}${c.reset} — ${formatTime(e.timestamp)}`);
    console.log(`  ${c.dim}URL: ${truncate(e.snapshot.url, 80)}${c.reset}`);
    console.log(`  ${c.dim}Elements: ${e.snapshot.elementCount} | Model: ${e.llmRequest.model} | Compression: ${e.llmRequest.compressionLevel}${c.reset}`);

    if (e.llmResponse.content) {
      console.log(`  ${c.bold}Text:${c.reset} ${truncate(e.llmResponse.content, 120)}`);
    }
    for (const tc of e.llmResponse.toolCalls) {
      const args = truncate(tc.function.arguments, 80);
      console.log(`  ${c.green}→ ${tc.function.name}${c.reset}(${args})`);
    }
    for (const te of e.toolExecutions) {
      const status = te.success ? `${c.green}OK${c.reset}` : `${c.red}FAIL${c.reset}`;
      console.log(`  ${status} ${te.toolName} ${c.dim}${te.durationMs}ms${c.reset} ${truncate(te.result, 80)}`);
    }
    for (const ev of e.events) {
      console.log(`  ${c.yellow}[${ev.type}]${c.reset} ${JSON.stringify(ev.data)}`);
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
    console.log(`  Tokens:    ${entry.llmResponse.usage.total_tokens}  Cost: $${entry.llmResponse.usage.cost?.toFixed(4) ?? "?"}`);
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
        console.log(`    Args: ${JSON.stringify(JSON.parse(tc.function.arguments), null, 2)}`);
      } catch {
        console.log(`    Args: ${tc.function.arguments}`);
      }
    }
    console.log();
  }

  if (entry.toolExecutions.length > 0) {
    console.log(`${c.bold}Tool Executions:${c.reset}`);
    for (const te of entry.toolExecutions) {
      const status = te.success ? `${c.green}OK${c.reset}` : `${c.red}FAIL${c.reset}`;
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
      console.log(`  ${c.yellow}${ev.type}${c.reset} at ${formatTime(ev.timestamp)}: ${JSON.stringify(ev.data)}`);
    }
    console.log();
  }

  console.log(`${c.bold}Progress:${c.reset} staleTurns=${entry.progressState.staleTurns} signal=${entry.progressState.signal ?? "none"}`);
}

function cmdFilter(args: string[]) {
  const outcomeIdx = args.indexOf("--outcome");
  if (outcomeIdx === -1 || !args[outcomeIdx + 1]) {
    console.error("Usage: filter --outcome <completed|stopped|error|max_turns>");
    process.exit(1);
  }
  const outcome = args[outcomeIdx + 1];
  const sessions = readIndex().filter((s) => s.outcome === outcome);

  if (sessions.length === 0) {
    console.log(`No sessions with outcome "${outcome}"`);
    return;
  }
  console.log(`${c.bold}Sessions with outcome "${outcome}" (${sessions.length}):${c.reset}\n`);
  for (const s of sessions.reverse()) {
    const duration = formatDuration(s.endTime - s.startTime);
    console.log(
      `  ${c.dim}${formatTime(s.startTime)}${c.reset} ${s.turnCount}t ${duration} ${truncate(s.query, 50)}`,
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
  let totalTurns = 0;
  let totalCost = 0;
  let totalDuration = 0;
  const toolCounts: Record<string, number> = {};

  for (const s of sessions) {
    outcomes[s.outcome] = (outcomes[s.outcome] || 0) + 1;
    totalTurns += s.turnCount;
    totalDuration += s.endTime - s.startTime;
    if (s.metrics?.totalCost) totalCost += s.metrics.totalCost;
  }

  // Read all trace files for tool stats
  const traceFiles = readdirSync(TRACE_DIR).filter((f) => f.endsWith(".jsonl") && f !== "index.jsonl");
  for (const file of traceFiles) {
    try {
      const lines = readFileSync(join(TRACE_DIR, file), "utf-8").trim().split("\n").filter(Boolean);
      for (const line of lines) {
        const entry = JSON.parse(line);
        for (const tc of entry.llmResponse?.toolCalls ?? []) {
          const name = tc.function?.name || "unknown";
          toolCounts[name] = (toolCounts[name] || 0) + 1;
        }
      }
    } catch { /* skip corrupt files */ }
  }

  console.log(`${c.bold}Trace Statistics${c.reset}\n`);
  console.log(`  Sessions:     ${sessions.length}`);
  console.log(`  Total turns:  ${totalTurns}`);
  console.log(`  Avg turns:    ${(totalTurns / sessions.length).toFixed(1)}`);
  console.log(`  Total cost:   $${totalCost.toFixed(4)}`);
  console.log(`  Avg duration: ${formatDuration(totalDuration / sessions.length)}`);
  console.log();

  console.log(`${c.bold}Outcomes:${c.reset}`);
  for (const [outcome, count] of Object.entries(outcomes).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / sessions.length) * 100).toFixed(0);
    console.log(`  ${outcomeColor(outcome)}${outcome.padEnd(12)}${c.reset} ${count} (${pct}%)`);
  }
  console.log();

  console.log(`${c.bold}Top Tools:${c.reset}`);
  const sortedTools = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 15);
  for (const [name, count] of sortedTools) {
    console.log(`  ${c.green}${name.padEnd(20)}${c.reset} ${count}`);
  }
}

function cmdHelp() {
  console.log(`
${c.bold}Trace Query CLI${c.reset}

Usage: bun run traces <command> [args]

Commands:
  list                          List all recorded sessions
  show <session-id>             Session summary + turn overview
  turns <session-id>            Show each turn with tool calls
  turn <session-id> <N>         Full detail for turn N
  filter --outcome <outcome>    Filter sessions by outcome
  stats                         Aggregate statistics
  help                          Show this help

Session IDs can be abbreviated (prefix match).
`);
}

function findTrace(sessionId: string): TraceEntryRecord[] {
  // Support prefix matching
  if (!existsSync(TRACE_DIR)) {
    console.error(`${c.red}Trace directory not found: ${TRACE_DIR}${c.reset}`);
    process.exit(1);
  }
  const files = readdirSync(TRACE_DIR).filter((f) => f.startsWith(sessionId) && f.endsWith(".jsonl") && f !== "index.jsonl");
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
    if (!args[1]) { console.error("Usage: show <session-id>"); process.exit(1); }
    cmdShow(args[1]);
    break;
  case "turns":
    if (!args[1]) { console.error("Usage: turns <session-id>"); process.exit(1); }
    cmdTurns(args[1]);
    break;
  case "turn":
    if (!args[1] || !args[2]) { console.error("Usage: turn <session-id> <N>"); process.exit(1); }
    cmdTurn(args[1], parseInt(args[2], 10));
    break;
  case "filter":
    cmdFilter(args.slice(1));
    break;
  case "stats":
    cmdStats();
    break;
  case "help":
  default:
    cmdHelp();
    break;
}
