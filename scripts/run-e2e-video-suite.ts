#!/usr/bin/env tsx

import { spawn } from "child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, relative, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import {
  E2E_SUITE_ORDER,
  E2E_SUITES,
  type E2EDefaultSuiteName,
} from "../apps/extension/tests/e2e/suites";
import {
  readE2EConfig,
  withE2EConfigEnv,
} from "../apps/extension/tests/e2e/helpers/e2e-config";
import {
  summarizeVideoReviewWarnings,
  type VideoReviewWarningSummary,
} from "./run-e2e-video-review";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const TSX_CLI = resolve(PROJECT_ROOT, "node_modules/tsx/dist/cli.mjs");
const VIDEO_REVIEW_SCRIPT = resolve(
  PROJECT_ROOT,
  "scripts/run-e2e-video-review.ts",
);
const REVIEW_RUNS_ROOT = resolve(
  PROJECT_ROOT,
  ".artifacts/e2e/video-review-runs",
);
const VIDEO_SUITE_RUNS_ROOT = resolve(
  PROJECT_ROOT,
  ".artifacts/e2e/video-suite-runs",
);

type RunResult = {
  suite: E2EDefaultSuiteName;
  file: string;
  label: string;
  exitCode: number;
  startedAt: string;
  finishedAt: string;
  summaries: string[];
};

type ReviewSummary = {
  result: string;
  warnings: string[];
  warningSummary: VideoReviewWarningSummary;
};

function artifactDate(): string {
  return new Date().toISOString().split("T")[0];
}

function artifactTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace("Z", "");
}

function parseArg(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function parseSuites(): E2EDefaultSuiteName[] {
  const suite = parseArg("suite");
  if (!suite || suite === "all") return [...E2E_SUITE_ORDER];
  if (E2E_SUITE_ORDER.includes(suite as E2EDefaultSuiteName)) {
    return [suite as E2EDefaultSuiteName];
  }
  throw new Error(`Unknown default E2E suite: ${suite}`);
}

function relativePath(filePath: string): string {
  return relative(PROJECT_ROOT, filePath).replace(/\\/g, "/");
}

function sanitizeArtifactName(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "e2e"
  );
}

function snapshotSummaryPaths(): Set<string> {
  const paths = new Set<string>();
  if (!existsSync(REVIEW_RUNS_ROOT)) return paths;

  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.name === "summary.json") {
        paths.add(entryPath);
      }
    }
  };

  visit(REVIEW_RUNS_ROOT);
  return paths;
}

function findNewSummaries(before: Set<string>, startedAtMs: number): string[] {
  const after = snapshotSummaryPaths();
  return [...after]
    .filter((summaryPath) => {
      if (!before.has(summaryPath)) return true;
      return statSync(summaryPath).mtimeMs >= startedAtMs;
    })
    .sort();
}

function runReview(input: {
  file: string;
  label: string;
  timeoutMs: number;
  retry: number;
}): Promise<number> {
  const args = [
    TSX_CLI,
    VIDEO_REVIEW_SCRIPT,
    `--test=apps/extension/tests/e2e/${input.file}`,
    `--label=${input.label}`,
    `--timeoutMs=${input.timeoutMs}`,
    `--retry=${input.retry}`,
  ];

  const env = withE2EConfigEnv(
    process.env,
    readE2EConfig({ defaultProfile: "video" }),
  );

  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, args, {
      cwd: PROJECT_ROOT,
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("close", (code) => resolveRun(code ?? 1));
    child.on("error", () => resolveRun(1));
  });
}

export function readReviewSummary(summaryPath: string): ReviewSummary {
  try {
    const summary = JSON.parse(readFileSync(summaryPath, "utf-8"));
    const warnings = Array.isArray(summary.warnings) ? summary.warnings : [];
    return {
      result: String(summary.result ?? "unknown"),
      warnings,
      warningSummary:
        summary.warningSummary ?? summarizeVideoReviewWarnings(warnings),
    };
  } catch {
    return {
      result: "unknown",
      warnings: [],
      warningSummary: summarizeVideoReviewWarnings([]),
    };
  }
}

async function main(): Promise<void> {
  const suites = parseSuites();
  const timeoutMs = Number(parseArg("timeoutMs") ?? "900000");
  const retry = Number(parseArg("retry") ?? "0");
  const startedAt = new Date().toISOString();
  const today = artifactDate();
  const runDir = resolve(
    VIDEO_SUITE_RUNS_ROOT,
    today,
    `${artifactTimestamp()}-${suites.join("-")}`,
  );
  mkdirSync(runDir, { recursive: true });
  const summaryPath = resolve(runDir, "summary.json");
  const results: RunResult[] = [];

  for (const suite of suites) {
    for (const file of E2E_SUITES[suite]) {
      const label = sanitizeArtifactName(file.replace(/\.test\.ts$/, ""));
      const testStartedAt = new Date().toISOString();
      const testStartedAtMs = Date.now();
      const beforeSummaries = snapshotSummaryPaths();
      console.log(`\n[video-suite] ${suite} / ${file}`);
      const exitCode = await runReview({ file, label, timeoutMs, retry });
      const finishedAt = new Date().toISOString();
      const summaries = findNewSummaries(beforeSummaries, testStartedAtMs);
      results.push({
        suite,
        file,
        label,
        exitCode,
        startedAt: testStartedAt,
        finishedAt,
        summaries: summaries.map(relativePath),
      });

      const summary = buildSummary({
        startedAt,
        finishedAt,
        suites,
        timeoutMs,
        retry,
        results,
      });
      writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    }
  }

  const finishedAt = new Date().toISOString();
  const summary = buildSummary({
    startedAt,
    finishedAt,
    suites,
    timeoutMs,
    retry,
    results,
  });
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`[video-suite] Summary: ${summaryPath}`);
  if (summary.failed > 0) process.exitCode = 1;
}

export function buildSummary(input: {
  startedAt: string;
  finishedAt: string;
  suites: E2EDefaultSuiteName[];
  timeoutMs: number;
  retry: number;
  results: RunResult[];
}) {
  const enriched = input.results.map((result) => {
    const review =
      result.summaries.length > 0
        ? readReviewSummary(resolve(PROJECT_ROOT, result.summaries.at(-1)!))
        : null;
    return {
      ...result,
      result: review?.result ?? (result.exitCode === 0 ? "passed" : "failed"),
      warnings: review?.warnings ?? [],
      warningSummary:
        review?.warningSummary ?? summarizeVideoReviewWarnings([]),
    };
  });
  const passed = enriched.filter((result) => result.exitCode === 0).length;
  const failed = enriched.filter((result) => result.exitCode !== 0).length;
  const allWarnings = enriched.flatMap((result) => result.warnings);
  return {
    schemaVersion: "2026-05-14",
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    suites: input.suites,
    timeoutMs: input.timeoutMs,
    retry: input.retry,
    total: enriched.length,
    passed,
    failed,
    warningSummary: summarizeVideoReviewWarnings(allWarnings),
    results: enriched,
  };
}

function isDirectRun(): boolean {
  if (!process.argv[1]) return false;
  return pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error("[video-suite] Failed:", error);
    process.exitCode = 1;
  });
}
