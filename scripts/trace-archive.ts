import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const DEFAULT_HOT_DAYS = 7;

export interface TraceArchiveOptions {
  projectRoot: string;
  nowMs?: number;
  hotDays?: number;
  archiveRoot?: string;
}

export interface TraceArchiveMove {
  kind: "session" | "screenshot" | "session_log" | "run" | "session_index" | "run_index";
  source: string;
  destination: string;
  sessionId?: string;
  runId?: string;
}

export interface TraceArchivePlan {
  hotDays: number;
  cutoffMs: number;
  archiveRoot: string;
  sessionIds: string[];
  runIds: string[];
  moves: TraceArchiveMove[];
}

interface SessionRecord {
  sessionId?: string;
  runId?: string;
  startTime?: number;
}

interface JsonlLine {
  raw: string;
  record: Record<string, unknown> | null;
}

function readJsonlLines(path: string): JsonlLine[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((raw) => {
      try {
        return { raw, record: JSON.parse(raw) as Record<string, unknown> };
      } catch {
        return { raw, record: null };
      }
    });
}

function writeJsonlLines(path: string, lines: string[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.length > 0 ? `${lines.join("\n")}\n` : "", "utf-8");
}

function monthKey(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function movePath(source: string, destination: string): void {
  if (!existsSync(source)) return;
  if (existsSync(destination)) {
    throw new Error(`Archive destination already exists: ${destination}`);
  }
  mkdirSync(dirname(destination), { recursive: true });
  renameSync(source, destination);
}

export function buildTraceArchivePlan(
  options: TraceArchiveOptions,
): TraceArchivePlan {
  const hotDays = options.hotDays ?? DEFAULT_HOT_DAYS;
  const nowMs = options.nowMs ?? Date.now();
  const cutoffMs = nowMs - hotDays * 24 * 60 * 60 * 1000;
  const projectRoot = options.projectRoot;
  const archiveRoot =
    options.archiveRoot ?? join(projectRoot, ".artifacts", "trace-archive");
  const traceDir = join(projectRoot, "traces");
  const indexPath = join(traceDir, "index.jsonl");
  const runDir = join(traceDir, "runs");
  const runIndexPath = join(runDir, "index.jsonl");
  const screenshotDir = join(traceDir, "screenshots");
  const logDir = join(projectRoot, "logs");
  const indexLines = readJsonlLines(indexPath);
  const sessions = indexLines
    .map((line) => line.record as SessionRecord | null)
    .filter((record): record is SessionRecord => Boolean(record?.sessionId));
  const archivedSessions = sessions.filter(
    (session) =>
      typeof session.startTime === "number" && session.startTime < cutoffMs,
  );
  const archivedSessionIds = new Set(
    archivedSessions.map((session) => String(session.sessionId)),
  );
  const hotRunIds = new Set(
    sessions
      .filter((session) => !archivedSessionIds.has(String(session.sessionId)))
      .map((session) => session.runId)
      .filter((runId): runId is string => typeof runId === "string" && runId.length > 0),
  );
  const archivedRunIds = new Set(
    archivedSessions
      .map((session) => session.runId)
      .filter(
        (runId): runId is string =>
          typeof runId === "string" && runId.length > 0 && !hotRunIds.has(runId),
      ),
  );
  const moves: TraceArchiveMove[] = [];

  for (const session of archivedSessions) {
    const sessionId = String(session.sessionId);
    const bucket = monthKey(session.startTime ?? nowMs);
    const bucketRoot = join(archiveRoot, bucket);
    const traceFile = join(traceDir, `${sessionId}.jsonl`);
    if (existsSync(traceFile)) {
      moves.push({
        kind: "session",
        source: traceFile,
        destination: join(bucketRoot, "traces", `${sessionId}.jsonl`),
        sessionId,
      });
    }

    const logFile = join(logDir, `session-${sessionId}.jsonl`);
    if (existsSync(logFile)) {
      moves.push({
        kind: "session_log",
        source: logFile,
        destination: join(bucketRoot, "logs", `session-${sessionId}.jsonl`),
        sessionId,
      });
    }

    if (existsSync(screenshotDir)) {
      for (const file of readdirSync(screenshotDir)) {
        if (!file.startsWith(`${sessionId}-T`)) continue;
        moves.push({
          kind: "screenshot",
          source: join(screenshotDir, file),
          destination: join(bucketRoot, "screenshots", file),
          sessionId,
        });
      }
    }
  }

  for (const runId of archivedRunIds) {
    const runFile = join(runDir, `${runId}.jsonl`);
    if (!existsSync(runFile)) continue;
    const runSessions = archivedSessions.filter((session) => session.runId === runId);
    const bucket = monthKey(runSessions[0]?.startTime ?? nowMs);
    moves.push({
      kind: "run",
      source: runFile,
      destination: join(archiveRoot, bucket, "runs", `${runId}.jsonl`),
      runId,
    });
  }

  if (archivedSessionIds.size > 0 && existsSync(indexPath)) {
    moves.push({
      kind: "session_index",
      source: indexPath,
      destination: join(archiveRoot, "indexes", "sessions.jsonl"),
    });
  }
  if (archivedRunIds.size > 0 && existsSync(runIndexPath)) {
    moves.push({
      kind: "run_index",
      source: runIndexPath,
      destination: join(archiveRoot, "indexes", "runs.jsonl"),
    });
  }

  return {
    hotDays,
    cutoffMs,
    archiveRoot,
    sessionIds: Array.from(archivedSessionIds).sort(),
    runIds: Array.from(archivedRunIds).sort(),
    moves,
  };
}

export function applyTraceArchivePlan(plan: TraceArchivePlan): void {
  const sessionIds = new Set(plan.sessionIds);
  const runIds = new Set(plan.runIds);
  const indexMoves = plan.moves.filter(
    (move) => move.kind === "session_index" || move.kind === "run_index",
  );
  const fileMoves = plan.moves.filter(
    (move) => move.kind !== "session_index" && move.kind !== "run_index",
  );

  for (const move of fileMoves) {
    movePath(move.source, move.destination);
  }

  for (const move of indexMoves) {
    const lines = readJsonlLines(move.source);
    const archived: string[] = [];
    const retained: string[] = [];
    for (const line of lines) {
      const id =
        move.kind === "session_index"
          ? line.record?.sessionId
          : line.record?.runId;
      const archivedSet = move.kind === "session_index" ? sessionIds : runIds;
      if (typeof id === "string" && archivedSet.has(id)) archived.push(line.raw);
      else retained.push(line.raw);
    }
    if (archived.length > 0) {
      const previous = existsSync(move.destination)
        ? readFileSync(move.destination, "utf-8").trim()
        : "";
      const combined = [...(previous ? previous.split(/\r?\n/) : []), ...archived];
      writeJsonlLines(move.destination, combined);
    }
    writeJsonlLines(move.source, retained);
  }
}

function parseArgs(argv: string[]): {
  apply: boolean;
  hotDays: number;
  projectRoot: string;
} {
  const defaults = {
    apply: false,
    hotDays: DEFAULT_HOT_DAYS,
    projectRoot: join(dirname(fileURLToPath(import.meta.url)), ".."),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") defaults.apply = true;
    else if (arg === "--hot-days") {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value < 1) {
        throw new Error("--hot-days requires a positive number");
      }
      defaults.hotDays = Math.floor(value);
    } else if (arg === "--project-root") {
      const value = argv[++i];
      if (!value) throw new Error("--project-root requires a path");
      defaults.projectRoot = value;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: tsx scripts/trace-archive.ts [--apply] [--hot-days 7] [--project-root <path>]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return defaults;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const plan = buildTraceArchivePlan({
    projectRoot: args.projectRoot,
    hotDays: args.hotDays,
  });
  console.log(
    `${args.apply ? "Archiving" : "Dry run"}: ${plan.sessionIds.length} sessions, ${plan.runIds.length} runs, ${plan.moves.length} planned moves`,
  );
  console.log(`Hot trace window: ${plan.hotDays} days`);
  console.log(`Archive root: ${plan.archiveRoot}`);
  for (const move of plan.moves.slice(0, 20)) {
    console.log(`${move.kind}: ${move.source} -> ${move.destination}`);
  }
  if (plan.moves.length > 20) {
    console.log(`... ${plan.moves.length - 20} more`);
  }
  if (args.apply) applyTraceArchivePlan(plan);
  else console.log("Dry run only. Re-run with --apply to move files.");
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/trace-archive.ts")) {
  main();
}
