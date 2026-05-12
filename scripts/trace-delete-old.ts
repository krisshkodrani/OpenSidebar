import Database from "better-sqlite3";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const DEFAULT_HOT_DAYS = 7;
const DEFAULT_DB_PATH = ".artifacts/trace-index.sqlite";

export interface TraceDeleteOldOptions {
  projectRoot: string;
  dbPath?: string;
  hotDays: number;
  apply: boolean;
}

interface JsonlLine {
  raw: string;
  record: Record<string, unknown> | null;
}

export interface TraceDeleteOldPlan {
  cutoffMs: number;
  sessionIds: Set<string>;
  runIds: Set<string>;
  files: string[];
  retainedSessionIndex: string[];
  retainedRunIndex: string[];
  bytes: number;
}

function readJsonl(path: string): JsonlLine[] {
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

function writeJsonl(path: string, lines: string[]): void {
  writeFileSync(path, lines.length > 0 ? `${lines.join("\n")}\n` : "", "utf-8");
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function sqliteHasSession(db: Database.Database, sessionId: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM trace_sessions WHERE session_id = ?")
    .get(sessionId);
  return Boolean(row);
}

function sqliteHasRunEvents(db: Database.Database, runId: string): boolean {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM trace_run_events WHERE run_id = ?")
    .get(runId) as { count?: number } | undefined;
  return (row?.count ?? 0) > 0;
}

function addFile(plan: TraceDeleteOldPlan, path: string): void {
  if (!existsSync(path)) return;
  plan.files.push(path);
  plan.bytes += statSync(path).size;
}

export function buildTraceDeleteOldPlan(
  options: TraceDeleteOldOptions,
): TraceDeleteOldPlan {
  const dbPath = options.dbPath ?? join(options.projectRoot, DEFAULT_DB_PATH);
  if (!existsSync(dbPath)) {
    throw new Error(`SQLite trace store not found: ${dbPath}`);
  }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const cutoffMs = Date.now() - options.hotDays * 24 * 60 * 60 * 1000;
    const traceDir = join(options.projectRoot, "traces");
    const runDir = join(traceDir, "runs");
    const screenshotDir = join(traceDir, "screenshots");
    const logDir = join(options.projectRoot, "logs");
    const sessionIndexPath = join(traceDir, "index.jsonl");
    const runIndexPath = join(runDir, "index.jsonl");
    const sessionIds = new Set<string>();
    const runIds = new Set<string>();
    const hotRunIds = new Set<string>();
    const retainedSessionIndex: string[] = [];
    const retainedRunIndex: string[] = [];
    const plan: TraceDeleteOldPlan = {
      cutoffMs,
      sessionIds,
      runIds,
      files: [],
      retainedSessionIndex,
      retainedRunIndex,
      bytes: 0,
    };

    for (const line of readJsonl(sessionIndexPath)) {
      const sessionId = asString(line.record?.sessionId);
      const runId = asString(line.record?.runId);
      const startTime = asNumber(line.record?.startTime);
      const isOld = startTime > 0 && startTime < cutoffMs;
      if (sessionId && isOld) {
        if (!sqliteHasSession(db, sessionId)) {
          throw new Error(
            `Refusing to delete ${sessionId}; missing trace_sessions row in SQLite`,
          );
        }
        sessionIds.add(sessionId);
        if (runId) runIds.add(runId);
      } else {
        retainedSessionIndex.push(line.raw);
        if (runId) hotRunIds.add(runId);
      }
    }

    for (const runId of Array.from(runIds)) {
      if (hotRunIds.has(runId)) runIds.delete(runId);
    }

    for (const line of readJsonl(runIndexPath)) {
      const runId = asString(line.record?.runId);
      if (runId && runIds.has(runId)) {
        if (!sqliteHasRunEvents(db, runId)) {
          throw new Error(
            `Refusing to delete run ${runId}; missing trace_run_events rows in SQLite`,
          );
        }
      } else {
        retainedRunIndex.push(line.raw);
      }
    }

    if (existsSync(traceDir)) {
      for (const file of readdirSync(traceDir)) {
        if (!file.endsWith(".jsonl") || file === "index.jsonl") continue;
        const fullPath = join(traceDir, file);
        const sessionId = file.replace(/\.jsonl$/, "");
        if (!sessionIds.has(sessionId) && statSync(fullPath).mtimeMs >= cutoffMs) {
          continue;
        }
        if (!sqliteHasSession(db, sessionId)) {
          throw new Error(
            `Refusing to delete ${fullPath}; missing trace_sessions row in SQLite`,
          );
        }
        sessionIds.add(sessionId);
        addFile(plan, fullPath);
      }
    }

    if (existsSync(runDir)) {
      for (const file of readdirSync(runDir)) {
        if (!file.endsWith(".jsonl") || file === "index.jsonl") continue;
        const fullPath = join(runDir, file);
        const runId = file.replace(/\.jsonl$/, "");
        if (!runIds.has(runId) && statSync(fullPath).mtimeMs >= cutoffMs) continue;
        if (!sqliteHasRunEvents(db, runId)) {
          throw new Error(
            `Refusing to delete ${fullPath}; missing trace_run_events rows in SQLite`,
          );
        }
        runIds.add(runId);
        addFile(plan, fullPath);
      }
    }

    if (existsSync(screenshotDir)) {
      for (const file of readdirSync(screenshotDir)) {
        const fullPath = join(screenshotDir, file);
        const match = file.match(/^(.+)-T\d+(?:-pan\d+)?\.jpg$/);
        const sessionId = match?.[1];
        if (
          (!sessionId || !sessionIds.has(sessionId)) &&
          statSync(fullPath).mtimeMs >= cutoffMs
        ) {
          continue;
        }
        if (!sessionId || !sqliteHasSession(db, sessionId)) {
          throw new Error(
            `Refusing to delete ${fullPath}; missing trace_sessions row in SQLite`,
          );
        }
        addFile(plan, fullPath);
      }
    }

    if (existsSync(logDir)) {
      for (const file of readdirSync(logDir)) {
        if (!file.startsWith("session-") || !file.endsWith(".jsonl")) continue;
        const fullPath = join(logDir, file);
        const sessionId = file.replace(/^session-/, "").replace(/\.jsonl$/, "");
        if (!sessionIds.has(sessionId) && statSync(fullPath).mtimeMs >= cutoffMs) {
          continue;
        }
        if (!sqliteHasSession(db, sessionId)) {
          throw new Error(
            `Refusing to delete ${fullPath}; missing trace_sessions row in SQLite`,
          );
        }
        addFile(plan, fullPath);
      }
    }

    if (sessionIds.size > 0) addFile(plan, sessionIndexPath);
    if (runIds.size > 0) addFile(plan, runIndexPath);

    return plan;
  } finally {
    db.close();
  }
}

export function applyTraceDeleteOldPlan(
  options: TraceDeleteOldOptions,
  plan: TraceDeleteOldPlan,
): void {
  const traceDir = join(options.projectRoot, "traces");
  const runDir = join(traceDir, "runs");
  const sessionIndexPath = join(traceDir, "index.jsonl");
  const runIndexPath = join(runDir, "index.jsonl");
  const indexPaths = new Set([sessionIndexPath, runIndexPath]);

  for (const file of plan.files) {
    if (indexPaths.has(file)) continue;
    if (existsSync(file)) unlinkSync(file);
  }
  if (existsSync(sessionIndexPath)) writeJsonl(sessionIndexPath, plan.retainedSessionIndex);
  if (existsSync(runIndexPath)) writeJsonl(runIndexPath, plan.retainedRunIndex);
}

function parseArgs(argv: string[]): TraceDeleteOldOptions {
  const options: TraceDeleteOldOptions = {
    projectRoot: join(dirname(fileURLToPath(import.meta.url)), ".."),
    hotDays: DEFAULT_HOT_DAYS,
    apply: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--hot-days") {
      const value = Number(argv[++index]);
      if (!Number.isFinite(value) || value < 1) {
        throw new Error("--hot-days requires a positive number");
      }
      options.hotDays = Math.floor(value);
    } else if (arg === "--db") {
      const value = argv[++index];
      if (!value) throw new Error("--db requires a path");
      options.dbPath = value;
    } else if (arg === "--project-root") {
      const value = argv[++index];
      if (!value) throw new Error("--project-root requires a path");
      options.projectRoot = value;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: tsx scripts/trace-delete-old.ts [--apply] [--hot-days 7] [--db .artifacts/trace-index.sqlite] [--project-root <path>]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const plan = buildTraceDeleteOldPlan(options);
  const mb = (plan.bytes / 1024 / 1024).toFixed(1);
  console.log(`${options.apply ? "Deleting" : "Dry run"} old raw traces`);
  console.log(`Hot trace window: ${options.hotDays} days`);
  console.log(`Cutoff: ${new Date(plan.cutoffMs).toISOString()}`);
  console.log(`Sessions covered: ${plan.sessionIds.size}`);
  console.log(`Runs covered: ${plan.runIds.size}`);
  console.log(`Files planned: ${plan.files.length}`);
  console.log(`Bytes planned: ${mb} MB`);
  for (const file of plan.files.slice(0, 20)) console.log(file);
  if (plan.files.length > 20) console.log(`... ${plan.files.length - 20} more`);
  if (options.apply) applyTraceDeleteOldPlan(options, plan);
  else console.log("Dry run only. Re-run with --apply to delete files.");
}

if (
  process.argv[1]?.replace(/\\/g, "/").endsWith(
    "scripts/trace-delete-old.ts",
  )
) {
  main();
}
