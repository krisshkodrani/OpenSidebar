import type { ListResult, TaskInfo, WorkArenaSuite } from "./workarena-adapter-lib.js";
import type {
  WorkArenaGradeSummary,
  WorkArenaGradedAttempt,
} from "./workarena-grading-lib.js";

const SUITES: WorkArenaSuite[] = ["all", "atomic", "l1", "l2", "l3"];

export type WorkArenaSuiteArgs = {
  suite: WorkArenaSuite;
  categories: string[];
  taskIds: string[];
  seeds: number[];
  seedsProvided: boolean;
  maxTurns: number;
  timeoutMs: number;
  retries: number;
  provider: string | null;
  noBuild: boolean;
  allowServiceNowReset: boolean;
  resumeFromReport: string | null;
  stopOnFirstFailure: boolean;
  showBrowser: boolean;
  dryRun: boolean;
  json: boolean;
  noReport: boolean;
};

export type WorkArenaSuiteTarget = {
  task: TaskInfo;
  seed: number;
};

export type WorkArenaSuiteRunRecord = {
  taskId: string;
  category: string | null;
  seed: number;
  attempt: number;
  status: "pending" | "passed" | "failed" | "error" | "skipped";
  passed: boolean;
  score: number | null;
  reportPath: string | null;
  turns: number | null;
  traces: number;
  failureStage: string | null;
  validationMessage: string | null;
  prompt: string | null;
  warnings: string[];
};

export type WorkArenaSuiteReport = {
  benchmark: "workarena";
  mode: "suite";
  generatedAt: string;
  suite: WorkArenaSuite;
  categories: string[];
  seeds: number[];
  maxTurns: number;
  timeoutMs: number;
  retries: number;
  provider: string | null;
  allowServiceNowReset: boolean;
  status: "planned" | "passed" | "failed" | "partial" | "error";
  planned: number;
  completed: number;
  skipped: number;
  runs: WorkArenaSuiteRunRecord[];
  grade: WorkArenaGradeSummary;
  reports: {
    jsonReportPath?: string;
    markdownReportPath?: string;
  };
};

function argValues(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue;
    const value = args[index + 1];
    if (value && !value.startsWith("--")) {
      values.push(value);
      index += 1;
    }
  }
  return values;
}

function firstArgValue(args: string[], name: string): string | null {
  return argValues(args, name)[0] ?? null;
}

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function parseSeedSpec(spec: string): number[] {
  const seeds = new Set<number>();
  for (const rawPart of spec.split(",")) {
    const part = rawPart.trim();
    if (!part) continue;
    const range = /^(-?\d+)\.\.(-?\d+)$/.exec(part);
    if (range) {
      const start = Number.parseInt(range[1], 10);
      const end = Number.parseInt(range[2], 10);
      const step = start <= end ? 1 : -1;
      for (let value = start; value !== end + step; value += step) {
        seeds.add(value);
      }
      continue;
    }
    const parsed = Number.parseInt(part, 10);
    if (Number.isFinite(parsed)) seeds.add(parsed);
  }
  return [...seeds].sort((a, b) => a - b);
}

export function normalizeCategory(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function parseList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function parseSuiteArgs(argv = process.argv.slice(2)): WorkArenaSuiteArgs {
  const suiteArg = firstArgValue(argv, "--suite") as WorkArenaSuite | null;
  const seedsArg = firstArgValue(argv, "--seeds");
  const categoryValues = [
    ...argValues(argv, "--category"),
    ...argValues(argv, "--categories"),
  ].flatMap(parseList);
  const taskIds = argValues(argv, "--task").flatMap(parseList);
  const seeds = seedsArg ? parseSeedSpec(seedsArg) : [0];

  return {
    suite: suiteArg && SUITES.includes(suiteArg) ? suiteArg : "atomic",
    categories:
      categoryValues.length === 0
        ? ["all"]
        : [...new Set(categoryValues.map(normalizeCategory))],
    taskIds: [...new Set(taskIds)],
    seeds: seeds.length > 0 ? seeds : [0],
    seedsProvided: Boolean(seedsArg),
    maxTurns: parsePositiveInt(firstArgValue(argv, "--max-turns"), 20),
    timeoutMs: parsePositiveInt(firstArgValue(argv, "--timeout-ms"), 600_000),
    retries: parseNonNegativeInt(firstArgValue(argv, "--retries"), 0),
    provider: firstArgValue(argv, "--provider"),
    noBuild: argv.includes("--no-build"),
    allowServiceNowReset:
      argv.includes("--allow-servicenow-reset") || argv.includes("--reset"),
    resumeFromReport: firstArgValue(argv, "--resume-from-report"),
    stopOnFirstFailure: argv.includes("--stop-on-first-failure"),
    showBrowser: argv.includes("--show-browser"),
    dryRun: argv.includes("--dry-run"),
    json: argv.includes("--json"),
    noReport: argv.includes("--no-report"),
  };
}

export function targetKey(taskId: string, seed: number): string {
  return `${taskId}::${seed}`;
}

export function selectSuiteTargets(
  list: ListResult,
  args: WorkArenaSuiteArgs,
): WorkArenaSuiteTarget[] {
  const categorySet = new Set(args.categories);
  const allCategories = categorySet.has("all");
  const knownTasks = new Map(list.tasks.map((task) => [task.id, task]));
  const tasks =
    args.taskIds.length > 0
      ? args.taskIds.map(
          (taskId) =>
            knownTasks.get(taskId) ?? {
              id: taskId,
              category: null,
              kind: "compositional" as const,
              level: null,
              seed: null,
              className: "UnknownWorkArenaTask",
            },
        )
      : list.tasks.filter((task) => {
          if (allCategories) return true;
          const category = task.category ? normalizeCategory(task.category) : "unknown";
          return categorySet.has(category);
        });

  const targets: WorkArenaSuiteTarget[] = [];
  for (const task of tasks) {
    const seeds = args.seedsProvided || task.seed === null ? args.seeds : [task.seed];
    for (const seed of seeds) {
      targets.push({ task, seed });
    }
  }

  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = targetKey(target.task.id, target.seed);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function completedKeysFromSuiteReport(
  report: Pick<WorkArenaSuiteReport, "runs"> | null,
): Set<string> {
  const completed = new Set<string>();
  for (const run of report?.runs ?? []) {
    if (run.status === "pending" || run.status === "skipped") continue;
    completed.add(targetKey(run.taskId, run.seed));
  }
  return completed;
}

export function suiteRunFromAttempt(
  attempt: WorkArenaGradedAttempt,
): WorkArenaSuiteRunRecord {
  return {
    taskId: attempt.taskId,
    category: attempt.category === "unknown" ? null : attempt.category,
    seed: attempt.seed,
    attempt: attempt.attempt,
    status: attempt.status,
    passed: attempt.passed,
    score: attempt.rawScore,
    reportPath: attempt.reportPath,
    turns: attempt.turns,
    traces: attempt.traces,
    failureStage: attempt.failureStage,
    validationMessage: attempt.validationMessage,
    prompt: attempt.prompt,
    warnings: attempt.warnings,
  };
}
