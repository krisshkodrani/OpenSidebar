#!/usr/bin/env tsx

import { execSync, spawn } from "child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "fs";
import { join, relative, resolve } from "path";
import { fileURLToPath } from "url";
import { deflateSync } from "zlib";
import { LLMClient } from "../../apps/extension/src/background/llm/client";
import { estimateCostUsd } from "../../apps/extension/src/background/llm/pricing";
import { DONE_DEF } from "../../apps/extension/src/background/tools/definitions";
import { ToolName } from "../../apps/extension/src/types";
import { loadFireworksApiKey } from "../../apps/extension/tests/e2e/helpers/e2e-provider-config";
import { loadTaskFile, selectStratifiedSubset } from "./loader";
import type {
  BenchAggregate,
  BenchRunEvidence,
  BenchTaskResult,
} from "./types";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const APP_DIR = resolve(PROJECT_ROOT, "apps/extension");
const TSX_CLI = resolve(PROJECT_ROOT, "node_modules/tsx/dist/cli.mjs");
const VITEST_CLI = resolve(PROJECT_ROOT, "node_modules/vitest/vitest.mjs");
const RUN_BENCH = resolve(PROJECT_ROOT, "scripts/run-bench.ts");
const BENCH_CONFIG = resolve(APP_DIR, "tests/bench/vitest.bench.config.ts");
const BENCH_TASKS = resolve(PROJECT_ROOT, process.env.BENCH_TASKS_FILE ?? "scripts/bench/tasks/online-mind2web.json");
const KIMI_K2P6 = "accounts/fireworks/routers/kimi-k2p6-turbo";
const KIMI_K2P7 = "accounts/fireworks/models/kimi-k2p7-code";

const BENCH_SIZE = parseInt(process.env.BENCH_SIZE ?? "30", 10);
const SWEEP_TASK_IDS = selectStratifiedSubset(loadTaskFile(BENCH_TASKS).tasks, {
  size: BENCH_SIZE,
  seed: 0,
}).map((task) => task.task_id).sort();
const EXPECTED_TASK_COUNT = SWEEP_TASK_IDS.length;

interface ProbeReceipt {
  passed: boolean;
  model: string;
  actualModel: string;
  actualProviderId: string;
  recognizedColor: string;
  toolName: string;
  toolArguments: Record<string, unknown>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cached_tokens?: number;
  };
  estimatedCostUsd: number | null;
  streamedText: string;
  durationMs: number;
  generatedAt: string;
}

interface ValidatedRun {
  label: string;
  model: string;
  runDir: string;
  aggregate: BenchAggregate;
  totalDurationMs: number;
  medianDurationMs: number;
  evidenceFiles: number;
  judgedTasks: number;
  receiptFiles: number;
  failures: Array<{
    taskId: string;
    status: BenchRunEvidence["completionStatus"];
    verdict: string;
  }>;
}

function crc32(input: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function redPngDataUrl(): string {
  const width = 16;
  const height = 16;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  const row = Buffer.alloc(1 + width * 3);
  for (let offset = 1; offset < row.length; offset += 3) {
    row[offset] = 255;
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function runPreflight(): void {
  console.log("[kimi-k2p7-sweep] Running focused tests...");
  execSync(
    "node node_modules/vitest/vitest.mjs run --config apps/extension/vitest.config.ts " +
      "apps/extension/tests/background/provider-models.test.ts " +
      "apps/extension/tests/background/pricing.test.ts " +
      "apps/extension/tests/background/e2e-config.test.ts " +
      "apps/extension/tests/background/e2e-report.test.ts " +
      "apps/extension/tests/background/e2e-helpers.test.ts",
    { cwd: PROJECT_ROOT, stdio: "inherit", windowsHide: true },
  );
  console.log("[kimi-k2p7-sweep] Running typecheck...");
  execSync("corepack pnpm run typecheck", {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    windowsHide: true,
  });
  console.log("[kimi-k2p7-sweep] Building extension...");
  execSync("corepack pnpm run build", {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    windowsHide: true,
  });
}

async function runProbe(
  apiKey: string,
  outPath: string,
): Promise<ProbeReceipt> {
  const client = new LLMClient("", {
    providerMode: "fireworks",
    fireworksApiKey: apiKey,
    executorModel: KIMI_K2P7,
    plannerModel: KIMI_K2P7,
    temperature: 0,
  });
  const streamed: string[] = [];
  const startedAt = Date.now();
  const response = await client.completeStream(
    {
      model: KIMI_K2P7,
      messages: [
        {
          role: "system",
          content:
            "Inspect the image, identify its dominant color, and call the required done tool. The done summary must name the color plainly.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "What color is this image? Call done with the answer.",
            },
            {
              type: "image_url",
              image_url: { url: redPngDataUrl(), detail: "low" },
            },
          ],
        },
      ],
      tools: [DONE_DEF],
      tool_choice: "required",
      temperature: 0,
      max_tokens: 256,
    },
    (delta) => streamed.push(delta),
  );
  const durationMs = Date.now() - startedAt;
  const toolCall = response.tool_calls?.find(
    (call) => call.function.name === ToolName.DONE,
  );
  if (!toolCall) {
    throw new Error("K2.7 probe did not emit the required done tool call.");
  }

  let toolArguments: Record<string, unknown>;
  try {
    toolArguments = JSON.parse(toolCall.function.arguments) as Record<
      string,
      unknown
    >;
  } catch {
    throw new Error("K2.7 probe emitted invalid JSON tool arguments.");
  }
  const summary = toolArguments.summary;
  if (typeof summary !== "string" || !/\bred\b/i.test(summary)) {
    throw new Error("K2.7 probe did not identify the image as red.");
  }
  if (response.actualModel !== KIMI_K2P7) {
    throw new Error(
      `K2.7 probe resolved unexpected model ${response.actualModel ?? "(missing)"}.`,
    );
  }
  const usage = response.usage;
  if (
    !usage ||
    !Number.isFinite(usage.prompt_tokens) ||
    usage.prompt_tokens <= 0 ||
    !Number.isFinite(usage.completion_tokens) ||
    usage.completion_tokens < 0 ||
    !Number.isFinite(usage.total_tokens) ||
    usage.total_tokens < usage.prompt_tokens
  ) {
    throw new Error("K2.7 probe returned invalid streaming usage data.");
  }

  const receipt: ProbeReceipt = {
    passed: true,
    model: KIMI_K2P7,
    actualModel: response.actualModel,
    actualProviderId: response.actualProviderId ?? "unknown",
    recognizedColor: "red",
    toolName: toolCall.function.name,
    toolArguments,
    usage,
    estimatedCostUsd: estimateCostUsd("fireworks", KIMI_K2P7, usage),
    streamedText: streamed.join(""),
    durationMs,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf-8");
  console.log(
    `[kimi-k2p7-sweep] Probe passed with ${receipt.actualModel} in ${durationMs} ms.`,
  );
  return receipt;
}

function runBenchTask(
  label: string,
  model: string,
  runDir: string,
  taskId: string,
): Promise<void> {
  mkdirSync(runDir, { recursive: true });
  return new Promise((resolveTask, rejectTask) => {
    const child = spawn(
      process.execPath,
      [VITEST_CLI, "run", "--config", BENCH_CONFIG],
      {
        cwd: APP_DIR,
        stdio: "inherit",
        windowsHide: true,
        env: {
          ...process.env,
          E2E_PROFILE: "headed",
          E2E_PROVIDER: "fireworks",
          E2E_MODEL: model,
          E2E_PLANNER_MODEL: model,
          E2E_ARTIFACTS: "headed,no-panel,no-screenshot,no-video",
          BENCH_TASKS_FILE: BENCH_TASKS,
          BENCH_RUN_DIR: runDir,
          BENCH_SEED: "0",
          BENCH_MAX_TURNS: "25",
          BENCH_TASK_IDS: taskId,
          BENCH_TASK_TIMEOUT_MS: "300000",
        },
      },
    );
    child.on("error", rejectTask);
    child.on("close", (code) => {
      if (code === 0) {
        resolveTask();
        return;
      }
      rejectTask(
        new Error(`${label} task ${taskId} benchmark run exited ${code ?? 1}.`),
      );
    });
  });
}

function judgeBench(
  label: string,
  model: string,
  runDir: string,
): Promise<void> {
  return new Promise((resolveJudge, rejectJudge) => {
    const child = spawn(
      process.execPath,
      [
        TSX_CLI,
        RUN_BENCH,
        "--judge-only",
        "--run-dir",
        runDir,
        "--config-label",
        label,
      ],
      {
        cwd: PROJECT_ROOT,
        stdio: "inherit",
        windowsHide: true,
        env: {
          ...process.env,
          E2E_PROVIDER: "fireworks",
          E2E_MODEL: model,
          E2E_PLANNER_MODEL: model,
        },
      },
    );
    child.on("error", rejectJudge);
    child.on("close", (code) => {
      if (code === 0) {
        resolveJudge();
        return;
      }
      rejectJudge(new Error(`${label} judging exited ${code ?? 1}.`));
    });
  });
}

function hasUsableEvidence(runDir: string, taskId: string): boolean {
  const safeId = taskId.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const path = join(runDir, "tasks", `${safeId}.json`);
  if (!existsSync(path)) return false;
  try {
    const evidence = readJson<BenchRunEvidence>(path);
    return (
      evidence.task.task_id === taskId &&
      evidence.traceFiles.length > 0 &&
      evidence.traceFiles.every((receipt) => existsSync(join(runDir, receipt)))
    );
  } catch {
    return false;
  }
}

async function runMissingTasks(
  label: string,
  model: string,
  runDir: string,
): Promise<void> {
  const failures: string[] = [];
  for (const taskId of SWEEP_TASK_IDS) {
    if (hasUsableEvidence(runDir, taskId)) {
      console.log(`[kimi-k2p7-sweep] Reusing ${label} evidence for ${taskId}.`);
      continue;
    }
    try {
      await runBenchTask(label, model, runDir, taskId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      failures.push(`${taskId}: ${detail}`);
      console.error(`[kimi-k2p7-sweep] ${detail}`);
    }
  }
  if (failures.length > 0) {
    console.error(
      `${label} had ${failures.length} task launch failure(s): ${failures.join("; ")}`,
    );
    // don't throw, we want to judge whatever succeeded
  }
}

function validateRun(
  label: string,
  model: string,
  runDir: string,
): ValidatedRun {
  const manifestPath = join(runDir, "manifest.json");
  if (!existsSync(manifestPath)) {
     throw new Error(`${label} missing manifest.json.`);
  }
  const manifest = readJson<{
    taskIds?: string[];
    executorModel?: string | null;
    plannerModel?: string | null;
  }>(manifestPath);
  if (manifest.taskIds?.length !== EXPECTED_TASK_COUNT) {
    console.warn(`${label} manifest contains ${manifest.taskIds?.length} tasks, expected ${EXPECTED_TASK_COUNT}.`);
  }

  const tasksDir = join(runDir, "tasks");
  const evidenceNames = existsSync(tasksDir) ? readdirSync(tasksDir).filter((name) =>
    name.endsWith(".json"),
  ) : [];
  if (evidenceNames.length === 0) {
    throw new Error(`${label} produced no evidence files.`);
  }
  const evidence = evidenceNames.map((name) =>
    readJson<BenchRunEvidence>(join(tasksDir, name)),
  );
  
  const resultsPath = join(runDir, "results.json");
  if (!existsSync(resultsPath)) {
      throw new Error(`${label} missing results.json.`);
  }
  const results = readJson<BenchTaskResult[]>(resultsPath);
  
  const summaryPath = join(runDir, "summary.json");
  if (!existsSync(summaryPath)) {
      throw new Error(`${label} missing summary.json.`);
  }
  const aggregate = readJson<BenchAggregate>(summaryPath);
  
  const executed = results.filter(
    (result) => result.evidence.completionStatus !== "skipped",
  );
  
  const durations = evidence.map((item) => item.durationMs);
  const receiptFiles = evidence.reduce(
    (total, item) => total + item.traceFiles.length,
    0,
  );
  const validated: ValidatedRun = {
    label,
    model,
    runDir: relative(PROJECT_ROOT, runDir),
    aggregate,
    totalDurationMs: durations.reduce((total, value) => total + value, 0),
    medianDurationMs: median(durations),
    evidenceFiles: evidence.length,
    judgedTasks: executed.length,
    receiptFiles,
    failures: results
      .filter((result) => result.verdict?.outcome !== "success")
      .map((result) => ({
        taskId: result.evidence.task.task_id,
        status: result.evidence.completionStatus,
        verdict: result.verdict?.outcome ?? "missing",
      })),
  };
  writeFileSync(
    join(runDir, "sweep-receipt.json"),
    `${JSON.stringify({ passed: true, ...validated }, null, 2)}\n`,
    "utf-8",
  );
  return validated;
}

function formatComparison(
  probe: ProbeReceipt,
  baseline: ValidatedRun,
  candidate: ValidatedRun,
): string {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  const dollars = (value: number | null) =>
    value == null ? "n/a" : `$${value.toFixed(4)}`;
  const lines = [
    "# Kimi K2.7 Code Mind2Web Sweep",
    "",
    `> Stratified sample of ${EXPECTED_TASK_COUNT} tasks from online-mind2web.`,
    "",
    "## Probe",
    "",
    `- Model: \`${probe.actualModel}\``,
    `- Streaming usage: ${probe.usage.total_tokens} total tokens`,
    `- Vision result: ${probe.recognizedColor}`,
    `- Required tool call: \`${probe.toolName}\``,
    "",
    "## Paired results",
    "",
    "| Config | Pass rate | Failures | Median turns | Total duration | Cost |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    `| K2.6 baseline | ${pct(baseline.aggregate.passRate)} | ${baseline.aggregate.failures + baseline.aggregate.uncertain} | ${baseline.aggregate.medianTurns} | ${(baseline.totalDurationMs / 1000).toFixed(1)}s | ${dollars(baseline.aggregate.totalCostUsd)} |`,
    `| K2.7 Code candidate | ${pct(candidate.aggregate.passRate)} | ${candidate.aggregate.failures + candidate.aggregate.uncertain} | ${candidate.aggregate.medianTurns} | ${(candidate.totalDurationMs / 1000).toFixed(1)}s | ${dollars(candidate.aggregate.totalCostUsd)} |`,
    "",
    `Both runs used the same ${EXPECTED_TASK_COUNT} tasks, seed 0, 25-turn cap, 300-second task timeout, and WebJudge configuration.`,
    "",
  ];
  return lines.join("\n");
}

function defaultRunDir(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return resolve(PROJECT_ROOT, ".artifacts/bench", `kimi-k2p7-sweep-${stamp}`);
}

async function main(): Promise<void> {
  const runDirArg = process.argv.indexOf("--run-dir");
  const skipPreflight = process.argv.includes("--skip-preflight");
  const reuseProbe = process.argv.includes("--reuse-probe");
  const rootDir =
    runDirArg >= 0 && process.argv[runDirArg + 1]
      ? resolve(process.cwd(), process.argv[runDirArg + 1])
      : defaultRunDir();
  mkdirSync(rootDir, { recursive: true });
  console.log(`[kimi-k2p7-sweep] Artifact root: ${rootDir}`);
  console.log(`[kimi-k2p7-sweep] Task sweep size: ${EXPECTED_TASK_COUNT}`);

  if (!skipPreflight) runPreflight();
  const apiKey = loadFireworksApiKey();
  if (!apiKey) {
    throw new Error("FIREWORKS_API_KEY is required for the K2.7 sweep.");
  }

  const probePath = join(rootDir, "probe.json");
  const probe =
    reuseProbe && existsSync(probePath)
      ? readJson<ProbeReceipt>(probePath)
      : await runProbe(apiKey, probePath);
  if (!probe.passed || probe.actualModel !== KIMI_K2P7) {
    throw new Error("The existing K2.7 probe receipt is not valid.");
  }
  const baselineDir = join(rootDir, "k2p6");
  const candidateDir = join(rootDir, "k2p7-code");

  await runMissingTasks(
    `fireworks / Kimi K2.6 Turbo (${EXPECTED_TASK_COUNT}-task sweep)`,
    KIMI_K2P6,
    baselineDir,
  );
  await runMissingTasks(
    `fireworks / Kimi K2.7 Code (${EXPECTED_TASK_COUNT}-task sweep)`,
    KIMI_K2P7,
    candidateDir,
  );

  await judgeBench(
    `fireworks / Kimi K2.6 Turbo (${EXPECTED_TASK_COUNT}-task sweep)`,
    KIMI_K2P6,
    baselineDir,
  );
  await judgeBench(
    `fireworks / Kimi K2.7 Code (${EXPECTED_TASK_COUNT}-task sweep)`,
    KIMI_K2P7,
    candidateDir,
  );

  const baseline = validateRun("K2.6 baseline", KIMI_K2P6, baselineDir);
  const candidate = validateRun("K2.7 Code candidate", KIMI_K2P7, candidateDir);

  const comparison = {
    generatedAt: new Date().toISOString(),
    compatibilityOnly: false,
    productionDefaultChanged: false,
    tasksFile: relative(PROJECT_ROOT, BENCH_TASKS),
    seed: 0,
    maxTurns: 25,
    taskTimeoutMs: 300_000,
    probe,
    baseline,
    candidate,
  };
  writeFileSync(
    join(rootDir, "comparison.json"),
    `${JSON.stringify(comparison, null, 2)}\n`,
    "utf-8",
  );
  writeFileSync(
    join(rootDir, "comparison.md"),
    formatComparison(probe, baseline, candidate),
    "utf-8",
  );
  console.log(`[kimi-k2p7-sweep] Comparison written to ${rootDir}`);
}

main().catch((error) => {
  console.error(
    "[kimi-k2p7-sweep] Fatal:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
