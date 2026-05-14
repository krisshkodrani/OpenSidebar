#!/usr/bin/env tsx

import { spawn } from "child_process";
import {
  createWriteStream,
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
  readE2EConfig,
  withE2EConfigEnv,
} from "../apps/extension/tests/e2e/helpers/e2e-config";
import { collectE2EVideoTraceMetrics } from "../apps/extension/tests/e2e/helpers/video-metrics";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const VITEST_CLI = resolve(PROJECT_ROOT, "node_modules/vitest/vitest.mjs");
const E2E_CONFIG = resolve(
  PROJECT_ROOT,
  "apps/extension/tests/e2e/vitest.e2e.config.ts",
);
const VIDEO_RUNS_ROOT = resolve(PROJECT_ROOT, ".artifacts/e2e/video-runs");
const REVIEW_RUNS_ROOT = resolve(
  PROJECT_ROOT,
  ".artifacts/e2e/video-review-runs",
);

type RunArgs = {
  testFile: string;
  grep: string | null;
  label: string;
  retry: number;
  timeoutMs: number;
};

export type VideoReviewWarningKind =
  | "teardown_warning"
  | "timeout"
  | "artifact_warning"
  | "runtime_failure"
  | "browser_runtime"
  | "media_warning"
  | "unknown";

export type VideoReviewWarningSummary = {
  total: number;
  byKind: Record<VideoReviewWarningKind, number>;
  items: Array<{ kind: VideoReviewWarningKind; message: string }>;
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

function sanitizeArtifactName(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "e2e"
  );
}

function parseArg(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function parseArgs(): RunArgs {
  const positional = process.argv
    .slice(2)
    .filter((arg) => !arg.startsWith("--"));
  const testFile = parseArg("test") ?? positional[0] ?? null;
  if (!testFile) {
    throw new Error(
      "Usage: tsx scripts/run-e2e-video-review.ts --test=apps/extension/tests/e2e/summarize.test.ts [--grep=summarizes] [--label=summarize]",
    );
  }

  const inferredLabel = testFile
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.test\.ts$/, "");

  return {
    testFile,
    grep: parseArg("grep"),
    label: sanitizeArtifactName(parseArg("label") ?? inferredLabel ?? "e2e"),
    retry: Number(parseArg("retry") ?? "0"),
    timeoutMs: Number(parseArg("timeoutMs") ?? "540000"),
  };
}

function relativePath(filePath: string): string {
  return relative(PROJECT_ROOT, filePath).replace(/\\/g, "/");
}

function snapshotManifestPaths(): Set<string> {
  const paths = new Set<string>();
  if (!existsSync(VIDEO_RUNS_ROOT)) return paths;

  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.name === "manifest.json") {
        paths.add(entryPath);
      }
    }
  };

  visit(VIDEO_RUNS_ROOT);
  return paths;
}

function findNewManifests(before: Set<string>, startedAtMs: number): string[] {
  if (!existsSync(VIDEO_RUNS_ROOT)) return [];
  const after = snapshotManifestPaths();
  return [...after]
    .filter((manifestPath) => {
      if (!before.has(manifestPath)) return true;
      return statSync(manifestPath).mtimeMs >= startedAtMs;
    })
    .sort();
}

function readLogText(logPath: string): string {
  return existsSync(logPath) ? readFileSync(logPath, "utf-8") : "";
}

function uniqueWarnings(warnings: string[]): string[] {
  return [
    ...new Set(warnings.map((warning) => warning.trim()).filter(Boolean)),
  ];
}

export function classifyVideoReviewWarning(
  warning: string,
): VideoReviewWarningKind {
  if (
    /Browser close did not finish cleanly|Fixture server close timed out|teardown/i.test(
      warning,
    )
  ) {
    return "teardown_warning";
  }
  if (/timed out|Timeout after \d+ms/i.test(warning)) {
    return "timeout";
  }
  if (
    /No new video manifests|MP4 video artifact|artifact was not created/i.test(
      warning,
    )
  ) {
    return "artifact_warning";
  }
  if (
    /Failed to fetch|LLM (?:Stream )?Request Failed|LLM request failed|All providers failed/i.test(
      warning,
    )
  ) {
    return "runtime_failure";
  }
  if (
    /frame was detached|detached frame|Target closed|Execution context was destroyed/i.test(
      warning,
    )
  ) {
    return "browser_runtime";
  }
  if (/ffmpeg|ffprobe|screencast|video frame|media/i.test(warning)) {
    return "media_warning";
  }
  return "unknown";
}

export function summarizeVideoReviewWarnings(
  warnings: string[],
): VideoReviewWarningSummary {
  const items = uniqueWarnings(warnings).map((message) => ({
    kind: classifyVideoReviewWarning(message),
    message,
  }));
  const byKind = {
    teardown_warning: 0,
    timeout: 0,
    artifact_warning: 0,
    runtime_failure: 0,
    browser_runtime: 0,
    media_warning: 0,
    unknown: 0,
  } satisfies Record<VideoReviewWarningKind, number>;
  for (const item of items) {
    byKind[item.kind] += 1;
  }
  return {
    total: items.length,
    byKind,
    items,
  };
}

export function collectRunWarnings(input: {
  logPath: string;
  timedOut: boolean;
  timeoutMs: number;
  manifestCount: number;
}): string[] {
  const warnings: string[] = [];
  if (input.timedOut) {
    warnings.push(`Vitest timed out after ${input.timeoutMs}ms.`);
  }
  if (input.manifestCount === 0) {
    warnings.push("No new video manifests were found for this run.");
  }

  const logText = readLogText(input.logPath);
  const patterns = [
    /Browser close did not finish cleanly[^\r\n]*/gi,
    /Failed to (?:start|stop|write|capture|confirm|mount)[^\r\n]*/gi,
    /Failed to fetch[^\r\n]*/gi,
    /LLM (?:Stream )?Request Failed[^\r\n]*/gi,
    /LLM request failed[^\r\n]*/gi,
    /All providers failed[^\r\n]*/gi,
    /Timeout after \d+ms[^\r\n]*/gi,
    /(?:frame was detached|detached frame|Target closed|Execution context was destroyed)[^\r\n]*/gi,
  ];
  for (const pattern of patterns) {
    for (const match of logText.matchAll(pattern)) {
      warnings.push(match[0]);
    }
  }
  return uniqueWarnings(warnings);
}

export function detectRunResult(input: {
  exitCode: number;
  logPath: string;
  manifestCount: number;
}): "passed" | "failed" | "skipped" {
  if (input.exitCode !== 0) return "failed";
  const logText = readLogText(input.logPath);
  if (input.manifestCount === 0 && /\bskipped\b/i.test(logText)) {
    return "skipped";
  }
  return "passed";
}

function readManifestArtifactSummary(
  manifestPath: string,
): Record<string, unknown> {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    return {
      manifest: relativePath(manifestPath),
      result: manifest.result ?? null,
      video: manifest.video?.path ?? null,
      videoFormat: manifest.video?.format ?? null,
      mp4: manifest.video?.mp4?.path ?? null,
      contactSheet: manifest.frames?.contactSheet ?? null,
      screenshots: Array.isArray(manifest.screenshots)
        ? manifest.screenshots
        : [],
      metrics: manifest.metrics ?? null,
      warnings: Array.isArray(manifest.warnings) ? manifest.warnings : [],
      warningSummary:
        manifest.warningSummary ??
        summarizeVideoReviewWarnings(
          Array.isArray(manifest.warnings) ? manifest.warnings : [],
        ),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      manifest: relativePath(manifestPath),
      error: detail,
    };
  }
}

function runVitest(
  args: RunArgs,
  logPath: string,
): Promise<{ exitCode: number; timedOut: boolean }> {
  const testPath = resolve(PROJECT_ROOT, args.testFile);
  const vitestArgs = [
    VITEST_CLI,
    "run",
    "--config",
    E2E_CONFIG,
    "--retry",
    String(args.retry),
    testPath,
  ];
  if (args.grep) {
    vitestArgs.push("-t", args.grep);
  }

  const env = withE2EConfigEnv(
    process.env,
    readE2EConfig({ defaultProfile: "video" }),
  );

  const commandLine = [process.execPath, ...vitestArgs]
    .map((part) => (/\s/.test(part) ? `"${part}"` : part))
    .join(" ");
  const logStream = createWriteStream(logPath, { flags: "w" });
  logStream.write(`$ ${commandLine}\n\n`);

  return new Promise((resolveRun) => {
    let timedOut = false;
    const child = spawn(process.execPath, vitestArgs, {
      cwd: PROJECT_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      const message = `\n[video-review] Timeout after ${args.timeoutMs}ms; terminating Vitest.\n`;
      logStream.write(message);
      process.stderr.write(message);
      child.kill();
    }, args.timeoutMs);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      logStream.write(text);
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      logStream.write(text);
      process.stderr.write(text);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      logStream.end();
      resolveRun({ exitCode: code ?? 1, timedOut });
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      logStream.write(
        `\n[video-review] Failed to start Vitest: ${error.message}\n`,
      );
      logStream.end();
      resolveRun({ exitCode: 1, timedOut });
    });
  });
}

export function stampManifest(input: {
  manifestPath: string;
  args: RunArgs;
  exitCode: number;
  timedOut: boolean;
  startedAt: string;
  finishedAt: string;
  logPath: string;
  warnings: string[];
}): void {
  const raw = readFileSync(input.manifestPath, "utf-8");
  const manifest = JSON.parse(raw);
  const passed = input.exitCode === 0;
  const runWarningSummary = summarizeVideoReviewWarnings(input.warnings);
  const mergedWarnings = uniqueWarnings([
    ...(Array.isArray(manifest.warnings) ? manifest.warnings : []),
    ...input.warnings,
  ]);
  manifest.result = passed ? "passed" : "failed";
  manifest.passed = passed;
  if (Array.isArray(manifest.traceFiles)) {
    manifest.metrics = collectE2EVideoTraceMetrics(manifest.traceFiles);
  }
  manifest.vitest = {
    exitCode: input.exitCode,
    timedOut: input.timedOut,
    testFile: relativePath(resolve(PROJECT_ROOT, input.args.testFile)),
    grep: input.args.grep,
    label: input.args.label,
    retry: input.args.retry,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    log: relativePath(input.logPath),
    warnings: input.warnings,
    warningSummary: runWarningSummary,
  };
  manifest.warnings = mergedWarnings;
  manifest.warningSummary = summarizeVideoReviewWarnings(mergedWarnings);
  writeFileSync(input.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const today = artifactDate();
  const reviewDir = resolve(
    REVIEW_RUNS_ROOT,
    today,
    `${artifactTimestamp()}-${args.label}`,
  );
  mkdirSync(reviewDir, { recursive: true });
  const logPath = resolve(reviewDir, "vitest.log");
  const beforeManifests = snapshotManifestPaths();

  const run = await runVitest(args, logPath);
  const finishedAt = new Date().toISOString();
  const newManifests = findNewManifests(beforeManifests, startedAtMs);
  const warnings = collectRunWarnings({
    logPath,
    timedOut: run.timedOut,
    timeoutMs: args.timeoutMs,
    manifestCount: newManifests.length,
  });
  const result = detectRunResult({
    exitCode: run.exitCode,
    logPath,
    manifestCount: newManifests.length,
  });
  for (const manifestPath of newManifests) {
    stampManifest({
      manifestPath,
      args,
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      startedAt,
      finishedAt,
      logPath,
      warnings,
    });
  }

  const summaryPath = resolve(reviewDir, "summary.json");
  const summary = {
    schemaVersion: "2026-05-14",
    createdAt: finishedAt,
    result,
    exitCode: run.exitCode,
    timedOut: run.timedOut,
    testFile: relativePath(resolve(PROJECT_ROOT, args.testFile)),
    grep: args.grep,
    label: args.label,
    retry: args.retry,
    log: relativePath(logPath),
    manifests: newManifests.map(relativePath),
    artifacts: newManifests.map(readManifestArtifactSummary),
    warnings,
    warningSummary: summarizeVideoReviewWarnings(warnings),
  };
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf-8");

  console.log(`[video-review] Summary: ${summaryPath}`);
  for (const manifestPath of newManifests) {
    console.log(`[video-review] Stamped manifest: ${manifestPath}`);
  }
  if (newManifests.length === 0) {
    console.warn("[video-review] No new video manifests were found.");
  }

  process.exitCode = run.exitCode;
}

function isDirectRun(): boolean {
  if (!process.argv[1]) return false;
  return pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error("[video-review] Failed:", error);
    process.exitCode = 1;
  });
}
