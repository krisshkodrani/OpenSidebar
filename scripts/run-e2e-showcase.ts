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
  readE2EConfig,
  withE2EConfigEnv,
} from "../apps/extension/tests/e2e/helpers/e2e-config";

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
const SHOWCASE_RUNS_ROOT = resolve(PROJECT_ROOT, ".artifacts/e2e/showcase-runs");
const DEFAULT_SHOWCASE_TEST =
  "apps/extension/tests/e2e/showcase-ashby-application.test.ts";
const DEFAULT_SHOWCASE_LABEL = "showcase-ashby-application";

type ShowcaseArgs = {
  timeoutMs: number;
  retry: number;
  test: string;
  label: string;
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

function parseArgs(): ShowcaseArgs {
  return {
    timeoutMs: Number(parseArg("timeoutMs") ?? "720000"),
    retry: Number(parseArg("retry") ?? "0"),
    test: parseArg("test") ?? DEFAULT_SHOWCASE_TEST,
    label: parseArg("label") ?? DEFAULT_SHOWCASE_LABEL,
  };
}

function relativePath(filePath: string): string {
  return relative(PROJECT_ROOT, filePath).replace(/\\/g, "/");
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
  if (!existsSync(REVIEW_RUNS_ROOT)) return [];
  const after = snapshotSummaryPaths();
  return [...after]
    .filter((summaryPath) => {
      if (!before.has(summaryPath)) return true;
      return statSync(summaryPath).mtimeMs >= startedAtMs;
    })
    .sort();
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildShowcaseEnv(): NodeJS.ProcessEnv {
  const env = {
    ...process.env,
    E2E_PROFILE: "video",
    E2E_PROVIDER: "fireworks",
    E2E_ARTIFACTS: "video,panel,screenshots",
  };
  return withE2EConfigEnv(
    env,
    readE2EConfig({ env, defaultProfile: "video" }),
  );
}

function runVideoReview(args: ShowcaseArgs): Promise<number> {
  const childArgs = [
    TSX_CLI,
    VIDEO_REVIEW_SCRIPT,
    `--test=${args.test}`,
    `--label=${args.label}`,
    `--timeoutMs=${args.timeoutMs}`,
    `--retry=${args.retry}`,
  ];

  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, childArgs, {
      cwd: PROJECT_ROOT,
      env: buildShowcaseEnv(),
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("close", (code) => resolveRun(code ?? 1));
    child.on("error", () => resolveRun(1));
  });
}

function primaryArtifact(reviewSummary: Record<string, unknown> | null) {
  const rawArtifacts = reviewSummary?.artifacts;
  const artifacts = Array.isArray(rawArtifacts) ? rawArtifacts : [];
  return artifacts[0] && typeof artifacts[0] === "object"
    ? (artifacts[0] as Record<string, unknown>)
    : {};
}

async function main(): Promise<void> {
  const args = parseArgs();
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const beforeSummaries = snapshotSummaryPaths();
  const exitCode = await runVideoReview(args);
  const finishedAt = new Date().toISOString();
  const reviewSummaries = findNewSummaries(beforeSummaries, startedAtMs);
  const latestReviewSummaryPath = reviewSummaries.at(-1) ?? null;
  const reviewSummary = latestReviewSummaryPath
    ? readJsonFile(latestReviewSummaryPath)
    : null;
  const artifact = primaryArtifact(reviewSummary);

  const today = artifactDate();
  const runDir = resolve(
    SHOWCASE_RUNS_ROOT,
    today,
    `${artifactTimestamp()}-${args.label}`,
  );
  mkdirSync(runDir, { recursive: true });
  const summaryPath = resolve(runDir, "summary.json");
  const result =
    typeof reviewSummary?.result === "string"
      ? reviewSummary.result
      : exitCode === 0
        ? "passed"
        : "failed";

  const summary = {
    schemaVersion: "2026-05-14",
    createdAt: finishedAt,
    scenario: args.label.replace(/^showcase-/, ""),
    label: args.label,
    result,
    exitCode,
    startedAt,
    finishedAt,
    provider: "fireworks",
    profile: "video",
    testFile: args.test,
    reviewSummary: latestReviewSummaryPath
      ? relativePath(latestReviewSummaryPath)
      : null,
    artifacts: {
      manifest:
        typeof artifact.manifest === "string" ? artifact.manifest : null,
      video: typeof artifact.video === "string" ? artifact.video : null,
      mp4: typeof artifact.mp4 === "string" ? artifact.mp4 : null,
      contactSheet:
        typeof artifact.contactSheet === "string"
          ? artifact.contactSheet
          : null,
      screenshots: Array.isArray(artifact.screenshots)
        ? artifact.screenshots
        : [],
      metrics: artifact.metrics ?? null,
    },
    warnings: Array.isArray(reviewSummary?.warnings)
      ? reviewSummary?.warnings
      : [],
    warningSummary: reviewSummary?.warningSummary ?? null,
  };

  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
  console.log(`[showcase] Summary: ${summaryPath}`);
  if (summary.artifacts.mp4) {
    console.log(`[showcase] MP4: ${summary.artifacts.mp4}`);
  }
  if (summary.artifacts.contactSheet) {
    console.log(`[showcase] Contact sheet: ${summary.artifacts.contactSheet}`);
  }
  process.exitCode = exitCode;
}

function isDirectRun(): boolean {
  if (!process.argv[1]) return false;
  return pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error("[showcase] Failed:", error);
    process.exitCode = 1;
  });
}
