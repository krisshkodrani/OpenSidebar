/**
 * Log Query CLI — query the JSONL log file produced by the log server.
 *
 * Usage: bun run scripts/log-query.ts <command> [args]
 * Or:    bun run logs:query <command> [args]
 *
 * Commands:
 *   tail [N]          Last N entries (default 50)
 *   errors            ERROR-level entries only
 *   since <duration>  Entries from last Nm/Nh (e.g. 5m, 2h)
 *   level <LVL>       Filter by log level
 *   category <CAT>    Filter by category
 *   search <TEXT>     Case-insensitive search in msg+data
 *   stats             Counts by level, category, source
 *   help              Show usage
 */

import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOG_FILE = join(PROJECT_ROOT, "logs", "opensidebar.jsonl");

// ANSI colors
const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  white: "\x1b[37m",
};

interface LogEntry {
  ts: string;
  lvl: string;
  src: string;
  cat: string;
  msg: string;
  rid?: string;
  data?: Record<string, unknown>;
}

function colorLevel(lvl: string): string {
  switch (lvl) {
    case "ERROR": return `${c.red}ERR${c.reset}`;
    case "WARN":  return `${c.yellow}WRN${c.reset}`;
    case "INFO":  return `${c.green}INF${c.reset}`;
    case "DEBUG": return `${c.dim}DBG${c.reset}`;
    default:      return lvl;
  }
}

function formatEntry(e: LogEntry): string {
  const time = e.ts?.slice(11, 19) || "??:??:??";
  const data = e.data ? ` ${c.dim}${JSON.stringify(e.data)}${c.reset}` : "";
  return `${c.dim}${time}${c.reset} ${colorLevel(e.lvl)} ${c.cyan}[${e.cat}]${c.reset} ${e.msg}${data}`;
}

function readEntries(): LogEntry[] {
  if (!existsSync(LOG_FILE)) {
    console.error(`Log file not found: ${LOG_FILE}`);
    console.error("Start the log server first: bun run logs");
    process.exit(1);
  }

  const text = readFileSync(LOG_FILE, "utf-8");
  if (!text.trim()) return [];

  return text
    .trim()
    .split("\n")
    .map((line) => {
      try {
        return JSON.parse(line) as LogEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is LogEntry => e !== null);
}

function parseDuration(s: string): number {
  const match = s.match(/^(\d+)(m|h|s)$/);
  if (!match) {
    console.error(`Invalid duration: "${s}". Use format: 5m, 2h, 30s`);
    process.exit(1);
  }
  const val = Number(match[1]);
  switch (match[2]) {
    case "s": return val * 1000;
    case "m": return val * 60 * 1000;
    case "h": return val * 60 * 60 * 1000;
    default:  return val * 60 * 1000;
  }
}

function printEntries(entries: LogEntry[]): void {
  if (entries.length === 0) {
    console.log("No matching entries.");
    return;
  }
  for (const e of entries) {
    console.log(formatEntry(e));
  }
  console.log(`\n${c.dim}${entries.length} entries${c.reset}`);
}

function showStats(entries: LogEntry[]): void {
  const byLevel: Record<string, number> = {};
  const byCat: Record<string, number> = {};
  const bySrc: Record<string, number> = {};

  for (const e of entries) {
    byLevel[e.lvl] = (byLevel[e.lvl] || 0) + 1;
    byCat[e.cat] = (byCat[e.cat] || 0) + 1;
    bySrc[e.src] = (bySrc[e.src] || 0) + 1;
  }

  console.log(`\nTotal entries: ${entries.length}\n`);

  console.log("By Level:");
  for (const [k, v] of Object.entries(byLevel).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${colorLevel(k).padEnd(15)} ${v}`);
  }

  console.log("\nBy Category:");
  for (const [k, v] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.cyan}${k.padEnd(15)}${c.reset} ${v}`);
  }

  console.log("\nBy Source:");
  for (const [k, v] of Object.entries(bySrc).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.magenta}${k.padEnd(15)}${c.reset} ${v}`);
  }
}

function showHelp(): void {
  console.log(`
${c.cyan}OpenSidebar Log Query${c.reset}

Usage: bun run logs:query <command> [args]

Commands:
  tail [N]          Show last N entries (default 50)
  errors            Show ERROR-level entries
  since <duration>  Show entries from last Nm/Nh/Ns (e.g. 5m, 2h, 30s)
  level <LVL>       Filter by level (DEBUG, INFO, WARN, ERROR)
  category <CAT>    Filter by category (agent, tools, system, etc.)
  search <TEXT>     Case-insensitive search in message and data
  stats             Show aggregate statistics
  help              Show this help

Examples:
  bun run logs:query since 5m
  bun run logs:query search "snapshot"
  bun run logs:query category agent
  bun run logs:query level ERROR
`);
}

// --- Main ---
const args = process.argv.slice(2);
const command = args[0] || "help";

switch (command) {
  case "tail": {
    const n = Number(args[1]) || 50;
    const entries = readEntries();
    printEntries(entries.slice(-n));
    break;
  }

  case "errors": {
    const entries = readEntries().filter((e) => e.lvl === "ERROR");
    printEntries(entries);
    break;
  }

  case "since": {
    if (!args[1]) {
      console.error("Usage: since <duration> (e.g. 5m, 2h)");
      process.exit(1);
    }
    const ms = parseDuration(args[1]);
    const cutoff = new Date(Date.now() - ms).toISOString();
    const entries = readEntries().filter((e) => e.ts >= cutoff);
    printEntries(entries);
    break;
  }

  case "level": {
    if (!args[1]) {
      console.error("Usage: level <LVL> (DEBUG, INFO, WARN, ERROR)");
      process.exit(1);
    }
    const lvl = args[1].toUpperCase();
    const entries = readEntries().filter((e) => e.lvl === lvl);
    printEntries(entries);
    break;
  }

  case "category": {
    if (!args[1]) {
      console.error("Usage: category <CAT> (agent, tools, system, etc.)");
      process.exit(1);
    }
    const cat = args[1].toLowerCase();
    const entries = readEntries().filter((e) => e.cat === cat);
    printEntries(entries);
    break;
  }

  case "search": {
    if (!args[1]) {
      console.error("Usage: search <TEXT>");
      process.exit(1);
    }
    const needle = args.slice(1).join(" ").toLowerCase();
    const entries = readEntries().filter((e) => {
      const haystack = `${e.msg} ${e.data ? JSON.stringify(e.data) : ""}`.toLowerCase();
      return haystack.includes(needle);
    });
    printEntries(entries);
    break;
  }

  case "stats": {
    const entries = readEntries();
    showStats(entries);
    break;
  }

  case "help":
  default:
    showHelp();
    break;
}
