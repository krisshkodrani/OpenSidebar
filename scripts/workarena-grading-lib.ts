import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { isAbsolute, resolve } from "path";
import {
  type WorkArenaExecutionResult,
  PROJECT_ROOT,
  REPORTS_DIR,
  safeFilePart,
  today,
  writeJsonReport,
} from "./workarena-adapter-lib.js";

type JsonRecord = Record<string, unknown>;

export type WorkArenaGradedAttempt = {
  key: string;
  taskId: string;
  category: string;
  seed: number;
  attempt: number;
  status: WorkArenaExecutionResult["status"];
  passed: boolean;
  score: number;
  rawScore: number | null;
  failureStage: WorkArenaExecutionResult["failureStage"];
  turns: number;
  perceptions: number;
  toolCalls: number;
  toolExecutions: number;
  tokens: number;
  costUsd: number;
  traces: number;
  traceIds: string[];
  traceFiles: string[];
  prompt: string;
  validationMessage: string | null;
  reportPath: string;
  warnings: string[];
};

export type WorkArenaCategoryGrade = {
  category: string;
  total: number;
  passed: number;
  passAt1: number;
  medianTurns: number | null;
  p95Turns: number | null;
};

export type WorkArenaGradeSummary = {
  benchmark: "workarena";
  mode: "grade";
  generatedAt: string;
  sourceReports: string[];
  targetCount: number;
  runCount: number;
  passAt1: number;
  passAt2: number | null;
  categoryBalancedPassAt1: number;
  meanScore: number;
  totals: {
    passedAt1: number;
    passedAny: number;
    turns: number;
    perceptions: number;
    toolCalls: number;
    toolExecutions: number;
    tokens: number;
    costUsd: number;
    traces: number;
    warnings: number;
  };
  turns: {
    medianAll: number | null;
    p95All: number | null;
    medianPassed: number | null;
    p95Passed: number | null;
  };
  categories: WorkArenaCategoryGrade[];
  attempts: WorkArenaGradedAttempt[];
  warnings: Array<{
    taskId: string;
    seed: number;
    attempt: number;
    message: string;
  }>;
  reports: {
    jsonReportPath?: string;
    markdownReportPath?: string;
  };
};

export type WorkArenaGradeInput = {
  reportPath: string;
  result: WorkArenaExecutionResult;
  attempt?: number;
};

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isWorkArenaExecutionResult(
  value: unknown,
): value is WorkArenaExecutionResult {
  return (
    isRecord(value) &&
    value.benchmark === "workarena" &&
    value.mode === "agent-execution" &&
    isRecord(value.task) &&
    isRecord(value.agent) &&
    isRecord(value.validation)
  );
}

export function passedByWorkArenaScore(result: WorkArenaExecutionResult): boolean {
  return result.validation.score !== null
    ? result.validation.score > 0
    : result.validation.passed === true;
}

function numberOrZero(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function compact(value: string, maxLength = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function percentile(values: number[], p: number): number | null {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function median(values: number[]): number | null {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function markdown(value: unknown): string {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

function normalizeCategory(value: string | null): string {
  return value?.trim() || "unknown";
}

function warningMessages(result: WorkArenaExecutionResult, passed: boolean): string[] {
  const warnings: string[] = [];
  const scorePassed =
    result.validation.score === null ? null : result.validation.score > 0;
  if (
    scorePassed !== null &&
    result.validation.passed !== null &&
    scorePassed !== result.validation.passed
  ) {
    warnings.push("validation.passed and validation.score disagree");
  }

  const terminalReason = result.validation.details.agentTerminalReason;
  if (
    passed &&
    typeof terminalReason === "string" &&
    terminalReason !== "task_completed"
  ) {
    warnings.push(`passed with agent terminal reason ${terminalReason}`);
  }

  if (result.agent.traceFiles.length === 0 && numberOrZero(result.agent.turns) > 0) {
    warnings.push("turns recorded without trace files");
  }

  return warnings;
}

export function gradeAttempt(input: WorkArenaGradeInput): WorkArenaGradedAttempt {
  const result = input.result;
  const passed = passedByWorkArenaScore(result);
  const rawScore = result.validation.score;
  const score = rawScore !== null ? rawScore : passed ? 1 : 0;
  const category = normalizeCategory(result.task.category);
  const seed = result.task.seed;
  const attempt = input.attempt ?? 1;

  return {
    key: `${result.task.taskId}::${seed}`,
    taskId: result.task.taskId,
    category,
    seed,
    attempt,
    status: result.status,
    passed,
    score,
    rawScore,
    failureStage: result.failureStage,
    turns: numberOrZero(result.agent.turns),
    perceptions: numberOrZero(result.agent.perceptions),
    toolCalls: numberOrZero(result.agent.toolCalls),
    toolExecutions: numberOrZero(result.agent.toolExecutions),
    tokens: numberOrZero(result.agent.tokens.total),
    costUsd: numberOrZero(result.agent.costUsd),
    traces: result.agent.traceFiles.length,
    traceIds: result.agent.traceIds,
    traceFiles: result.agent.traceFiles,
    prompt: compact(result.prompt.value),
    validationMessage: result.validation.message,
    reportPath: input.reportPath,
    warnings: warningMessages(result, passed),
  };
}

export function aggregateWorkArenaReports(
  inputs: WorkArenaGradeInput[],
): WorkArenaGradeSummary {
  const attempts = inputs
    .map(gradeAttempt)
    .sort(
      (a, b) =>
        a.taskId.localeCompare(b.taskId) ||
        a.seed - b.seed ||
        a.attempt - b.attempt ||
        a.reportPath.localeCompare(b.reportPath),
    );

  const byTarget = new Map<string, WorkArenaGradedAttempt[]>();
  for (const attempt of attempts) {
    const existing = byTarget.get(attempt.key) ?? [];
    existing.push(attempt);
    byTarget.set(attempt.key, existing);
  }

  const firstAttempts = [...byTarget.values()]
    .map((items) => [...items].sort((a, b) => a.attempt - b.attempt)[0])
    .filter((item): item is WorkArenaGradedAttempt => Boolean(item));
  const passedAt1 = firstAttempts.filter((attempt) => attempt.passed).length;
  const passedAny = [...byTarget.values()].filter((items) =>
    items.some((attempt) => attempt.passed),
  ).length;
  const hasSecondAttempts = [...byTarget.values()].some((items) =>
    items.some((attempt) => attempt.attempt <= 2 && attempt.attempt > 1),
  );
  const passedAt2 = [...byTarget.values()].filter((items) =>
    items.some((attempt) => attempt.attempt <= 2 && attempt.passed),
  ).length;

  const categoryMap = new Map<string, WorkArenaGradedAttempt[]>();
  for (const attempt of firstAttempts) {
    const existing = categoryMap.get(attempt.category) ?? [];
    existing.push(attempt);
    categoryMap.set(attempt.category, existing);
  }
  const categories = [...categoryMap.entries()]
    .map(([category, items]) => ({
      category,
      total: items.length,
      passed: items.filter((item) => item.passed).length,
      passAt1: ratio(items.filter((item) => item.passed).length, items.length),
      medianTurns: median(items.map((item) => item.turns)),
      p95Turns: percentile(items.map((item) => item.turns), 95),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));

  const warnings = attempts.flatMap((attempt) =>
    attempt.warnings.map((message) => ({
      taskId: attempt.taskId,
      seed: attempt.seed,
      attempt: attempt.attempt,
      message,
    })),
  );

  return {
    benchmark: "workarena",
    mode: "grade",
    generatedAt: new Date().toISOString(),
    sourceReports: inputs.map((input) => input.reportPath).sort(),
    targetCount: byTarget.size,
    runCount: attempts.length,
    passAt1: ratio(passedAt1, byTarget.size),
    passAt2: hasSecondAttempts ? ratio(passedAt2, byTarget.size) : null,
    categoryBalancedPassAt1:
      categories.length === 0
        ? 0
        : categories.reduce((sum, category) => sum + category.passAt1, 0) /
          categories.length,
    meanScore:
      firstAttempts.length === 0
        ? 0
        : firstAttempts.reduce((sum, attempt) => sum + attempt.score, 0) /
          firstAttempts.length,
    totals: {
      passedAt1,
      passedAny,
      turns: attempts.reduce((sum, attempt) => sum + attempt.turns, 0),
      perceptions: attempts.reduce((sum, attempt) => sum + attempt.perceptions, 0),
      toolCalls: attempts.reduce((sum, attempt) => sum + attempt.toolCalls, 0),
      toolExecutions: attempts.reduce(
        (sum, attempt) => sum + attempt.toolExecutions,
        0,
      ),
      tokens: attempts.reduce((sum, attempt) => sum + attempt.tokens, 0),
      costUsd: attempts.reduce((sum, attempt) => sum + attempt.costUsd, 0),
      traces: attempts.reduce((sum, attempt) => sum + attempt.traces, 0),
      warnings: warnings.length,
    },
    turns: {
      medianAll: median(attempts.map((attempt) => attempt.turns)),
      p95All: percentile(attempts.map((attempt) => attempt.turns), 95),
      medianPassed: median(
        attempts.filter((attempt) => attempt.passed).map((attempt) => attempt.turns),
      ),
      p95Passed: percentile(
        attempts.filter((attempt) => attempt.passed).map((attempt) => attempt.turns),
        95,
      ),
    },
    categories,
    attempts,
    warnings,
    reports: {},
  };
}

export function formatPercent(value: number | null): string {
  if (value === null) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

export function generateWorkArenaGradeMarkdown(summary: WorkArenaGradeSummary): string {
  const lines: string[] = [];
  lines.push("# WorkArena Grade Report");
  lines.push("");
  lines.push(`Date: ${summary.generatedAt.split("T")[0]}`);
  lines.push(
    `Overall result: ${summary.totals.passedAt1}/${summary.targetCount} pass@1 (${formatPercent(summary.passAt1)}); category-balanced pass@1 ${formatPercent(summary.categoryBalancedPassAt1)}.`,
  );
  lines.push("");
  lines.push("## Scorecard");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("| --- | ---: |");
  lines.push(`| Targets | ${summary.targetCount} |`);
  lines.push(`| Runs | ${summary.runCount} |`);
  lines.push(`| Pass@1 | ${formatPercent(summary.passAt1)} |`);
  lines.push(`| Pass@2 | ${formatPercent(summary.passAt2)} |`);
  lines.push(`| Mean score | ${summary.meanScore.toFixed(3)} |`);
  lines.push(`| Median turns | ${summary.turns.medianAll ?? "n/a"} |`);
  lines.push(`| P95 turns | ${summary.turns.p95All ?? "n/a"} |`);
  lines.push(`| Tokens | ${summary.totals.tokens} |`);
  lines.push(`| Estimated cost | $${summary.totals.costUsd.toFixed(4)} |`);
  lines.push(`| Warnings | ${summary.totals.warnings} |`);
  lines.push("");
  lines.push("## Categories");
  lines.push("");
  lines.push("| Category | Passed | Total | Pass@1 | Median turns | P95 turns |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const category of summary.categories) {
    lines.push(
      `| ${markdown(category.category)} | ${category.passed} | ${category.total} | ${formatPercent(category.passAt1)} | ${category.medianTurns ?? "n/a"} | ${category.p95Turns ?? "n/a"} |`,
    );
  }
  lines.push("");
  lines.push("## Attempts");
  lines.push("");
  lines.push("| Task | Seed | Attempt | Category | Passed | Score | Turns | Traces | Message |");
  lines.push("| --- | ---: | ---: | --- | --- | ---: | ---: | ---: | --- |");
  for (const attempt of summary.attempts) {
    lines.push(
      `| ${markdown(attempt.taskId)} | ${attempt.seed} | ${attempt.attempt} | ${markdown(attempt.category)} | ${attempt.passed ? "yes" : "no"} | ${attempt.score.toFixed(3)} | ${attempt.turns} | ${attempt.traces} | ${markdown(attempt.validationMessage ?? "")} |`,
    );
  }
  if (summary.warnings.length > 0) {
    lines.push("");
    lines.push("## Warnings");
    lines.push("");
    for (const warning of summary.warnings) {
      lines.push(
        `- ${warning.taskId} seed ${warning.seed} attempt ${warning.attempt}: ${warning.message}`,
      );
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function resolveReportPath(file: string): string {
  return isAbsolute(file) ? file : resolve(PROJECT_ROOT, file);
}

export function readExecutionReport(file: string): WorkArenaGradeInput | null {
  const reportPath = resolveReportPath(file);
  const parsed = JSON.parse(readFileSync(reportPath, "utf-8")) as unknown;
  if (!isWorkArenaExecutionResult(parsed)) return null;
  return { reportPath, result: parsed };
}

export function discoverExecutionReports(): string[] {
  if (!existsSync(REPORTS_DIR)) return [];
  return readdirSync(REPORTS_DIR)
    .filter((name) => /^workarena-.*\.json$/.test(name))
    .map((name) => resolve(REPORTS_DIR, name))
    .filter((file) => {
      try {
        return readExecutionReport(file) !== null;
      } catch {
        return false;
      }
    })
    .sort();
}

export function writeGradeReports(
  summary: WorkArenaGradeSummary,
  suffix = today(),
): WorkArenaGradeSummary {
  const safeSuffix = safeFilePart(suffix);
  const jsonPath = writeJsonReport(summary, `workarena-grade-${safeSuffix}.json`);
  const markdownPath = resolve(REPORTS_DIR, `workarena-grade-${safeSuffix}.md`);
  const withReports: WorkArenaGradeSummary = {
    ...summary,
    reports: {
      jsonReportPath: jsonPath,
      markdownReportPath: markdownPath,
    },
  };
  writeFileSync(jsonPath, `${JSON.stringify(withReports, null, 2)}\n`, "utf-8");
  writeFileSync(markdownPath, generateWorkArenaGradeMarkdown(withReports), "utf-8");
  return withReports;
}
