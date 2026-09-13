#!/usr/bin/env tsx
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  buildInvestigationReport,
  classifyAttempt,
  fingerprintConfig,
  requestedModels,
  validateConfig,
  type InvestigationAttempt,
  type InvestigationConfig,
} from "./harness-investigation-lib";

const ROOT = resolve(import.meta.dirname, "..");
const CASES = [
  "modal-overlays.test.ts",
  "online-shop.test.ts",
  "sports-research.test.ts",
  "information-extraction.test.ts",
  "custom-combobox.test.ts",
] as const;
const E2E_DIR = resolve(ROOT, "apps/extension/tests/e2e");
const CONFIG = resolve(E2E_DIR, "vitest.e2e.config.ts");
const args = process.argv.slice(2);

function gitText(gitArgs: string[]): string {
  try {
    return execFileSync("git", gitArgs, { cwd: ROOT, encoding: "utf8", windowsHide: true }).trim();
  } catch {
    return "unknown";
  }
}

function value(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function loadConfigs(): InvestigationConfig[] {
  const path = value("--config");
  if (!path) {
    throw new Error("Pass --config <campaign.json>. See scripts/harness-investigation.example.json.");
  }
  const parsed = JSON.parse(readFileSync(resolve(path), "utf8"));
  if (!Array.isArray(parsed?.configurations)) {
    throw new Error("Campaign JSON must contain a configurations array.");
  }
  return parsed.configurations as InvestigationConfig[];
}

function run(command: string, commandArgs: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      env,
      stdio: "inherit",
      shell: false,
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("close", (code) => resolveRun(code ?? 1));
  });
}

function readVitestResult(path: string): { passed: boolean; reason: string; durationMs: number } {
  if (!existsSync(path)) {
    return { passed: false, reason: "runner_error:no Vitest JSON result", durationMs: 0 };
  }
  const result = JSON.parse(readFileSync(path, "utf8"));
  const assertions = (result.testResults ?? []).flatMap((suite: any) => suite.assertionResults ?? []);
  const failed = assertions.filter((test: any) => test.status !== "passed");
  const messages = failed.flatMap((test: any) => test.failureMessages ?? []);
  return {
    passed: failed.length === 0 && assertions.length > 0,
    reason: failed.length === 0
      ? "fixture validator passed"
      : String(messages[0] ?? `${failed.length} assertion(s) failed`).split(/\r?\n/, 1)[0],
    durationMs: assertions.reduce((sum: number, test: any) => sum + (Number(test.duration) || 0), 0),
  };
}

function collectResolvedEvidence(startedAt: number, endedAt: number): {
  resolvedModels: Record<string, string[]>;
  traceRunIds: string[];
  retryLineage: string[];
  usageByRole: InvestigationAttempt["usageByRole"];
} {
  const indexPath = resolve(ROOT, "traces/index.jsonl");
  if (!existsSync(indexPath)) return { resolvedModels: {}, traceRunIds: [], retryLineage: [], usageByRole: {} };
  const sessions = readFileSync(indexPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    })
    .filter((session: any) => {
      const time = Number(session.startTime);
      return session.traceKind === "agent.session" && time >= startedAt - 5_000 && time <= endedAt + 5_000;
    });
  const runIds = [...new Set(sessions.map((session: any) => session.runId).filter(Boolean))] as string[];
  const executor = new Set<string>();
  const planner = new Set<string>();
  const judge = new Set<string>();
  const retryLineage: string[] = [];
  const usageByRole: InvestigationAttempt["usageByRole"] = {};
  const usage = (role: string) => usageByRole[role] ??= {
    calls: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0, llmTimeMs: 0,
  };
  const addUsage = (role: string, values: any) => {
    const target = usage(role);
    target.calls += Number(values.calls ?? 0) || 0;
    target.promptTokens += Number(values.promptTokens ?? values.prompt_tokens ?? 0) || 0;
    target.completionTokens += Number(values.completionTokens ?? values.completion_tokens ?? 0) || 0;
    target.cachedTokens += Number(values.cachedTokens ?? values.cached_tokens ?? values.cacheTelemetry?.cachedPromptTokens ?? 0) || 0;
    target.costUsd += Number(values.costUsd ?? values.cost ?? 0) || 0;
    target.llmTimeMs += Number(values.llmTimeMs ?? values.durationMs ?? 0) || 0;
  };
  for (const session of sessions) {
    for (const model of Object.keys(session.metrics?.modelBreakdown ?? {})) executor.add(model);
    const metrics = session.metrics ?? {};
    addUsage("executor", {
      calls: Object.values<any>(metrics.modelBreakdown ?? {}).reduce((sum, row) => sum + (Number(row.calls) || 0), 0),
      promptTokens: metrics.totalPromptTokens,
      completionTokens: metrics.totalCompletionTokens,
      cachedTokens: metrics.totalCachedTokens,
      costUsd: metrics.totalCost,
      llmTimeMs: metrics.totalLlmTimeMs,
    });
  }
  for (const runId of runIds) {
    const path = resolve(ROOT, "traces/runs", `${runId}.jsonl`);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)) {
      try {
        const event = JSON.parse(line);
        if (event.type === "planner_llm_call" && event.data?.model) {
          planner.add(event.data.model);
          addUsage("planner", { ...event.data.usage, calls: 1, durationMs: event.data.durationMs });
        }
        if (event.type === "judge_call" && event.data?.model && event.data?.judged !== false) {
          judge.add(event.data.model);
          addUsage("judge", { ...event.data.usage, calls: 1, durationMs: event.data.durationMs });
        }
        if (/retry/i.test(String(event.type ?? ""))) {
          retryLineage.push(`${runId}:${event.type}:${JSON.stringify(event.data ?? {}).slice(0, 300)}`);
        }
      } catch { /* malformed trace lines are evidence gaps, not runner crashes */ }
    }
  }
  return {
    resolvedModels: {
      executor: [...executor].sort(),
      planner: [...planner].sort(),
      judge: [...judge].sort(),
    },
    traceRunIds: runIds.sort(),
    retryLineage,
    usageByRole,
  };
}

function modelIdentityMismatch(
  requested: Record<string, string | null>,
  resolved: Record<string, string[]>,
): string | null {
  const comparisons = [
    ["executor", requested.executorModel],
    ["planner", requested.plannerModel],
    ["judge", requested.judgeModel],
  ] as const;
  for (const [role, expected] of comparisons) {
    const actual = resolved[role] ?? [];
    if (expected && actual.length > 0 && !actual.includes(expected)) {
      return `${role} requested ${expected} but traces resolved ${actual.join(", ")}`;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const configs = loadConfigs();
  const errors = configs.flatMap(validateConfig);
  if (errors.length > 0) throw new Error(`Invalid campaign:\n- ${errors.join("\n- ")}`);
  const repeat = Number.parseInt(value("--repeat") ?? "3", 10);
  if (!Number.isFinite(repeat) || repeat < 1) throw new Error("--repeat must be a positive integer");
  const outputDir = resolve(value("--output") ?? resolve(ROOT, ".artifacts/e2e/harness-investigation"));
  const execute = args.includes("--execute");
  const buildRevision = gitText(["rev-parse", "HEAD"]);
  const worktreeDirty = gitText(["status", "--porcelain"]) !== "";
  const plan = configs.flatMap((config, configIndex) =>
    CASES.flatMap((file, fileIndex) =>
      Array.from({ length: repeat }, (_, repetition) => ({
        config,
        file,
        repetition: repetition + 1,
        order: (configIndex + fileIndex + repetition) % configs.length,
      })),
    ),
  ).sort((left, right) => left.repetition - right.repetition || left.order - right.order || left.file.localeCompare(right.file));

  console.log(`[harness:investigation] ${plan.length} attempts (${CASES.length} cases x ${repeat} repeats x ${configs.length} configs)`);
  for (const config of configs) {
    console.log(`[harness:investigation] ${config.label} ${fingerprintConfig(config)} ${JSON.stringify(requestedModels(config.env))}`);
  }
  if (!execute) {
    console.log(`[harness:investigation] Build ${buildRevision}${worktreeDirty ? " (dirty)" : ""}`);
    console.log("[harness:investigation] Dry run only. Add --execute to spend API credits.");
    return;
  }

  if (worktreeDirty && !args.includes("--allow-dirty")) {
    throw new Error("Refusing a paid campaign from a dirty worktree. Commit/stash changes or pass --allow-dirty for a non-publishable diagnostic run.");
  }
  if (!args.includes("--no-build")) {
    const packageRunner = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    if (await run(packageRunner, ["run", "build:e2e"], process.env) !== 0) throw new Error("E2E extension build failed");
    if (await run(packageRunner, ["run", "fixtures:build"], process.env) !== 0) throw new Error("fixture build failed");
  }

  mkdirSync(outputDir, { recursive: true });
  const attempts: InvestigationAttempt[] = [];
  for (const item of plan) {
    const safeLabel = item.config.label.replace(/[^a-z0-9_-]/gi, "-");
    const resultFile = resolve(outputDir, `${safeLabel}-${basename(item.file, ".test.ts")}-r${item.repetition}.json`);
    const startedAt = Date.now();
    const exitCode = await run(process.execPath, [
      resolve(ROOT, "node_modules/vitest/vitest.mjs"),
      "run", "--config", CONFIG,
      resolve(E2E_DIR, item.file),
      "--reporter=json", "--outputFile", resultFile,
    ], { ...process.env, ...item.config.env });
    const endedAt = Date.now();
    const result = readVitestResult(resultFile);
    const reason = exitCode !== 0 && result.passed ? `runner_error:Vitest exited ${exitCode}` : result.reason;
    const requested = requestedModels(item.config.env);
    const evidence = collectResolvedEvidence(startedAt, endedAt);
    const identityMismatch = modelIdentityMismatch(requested, evidence.resolvedModels);
    const finalReason = identityMismatch ? `model_identity_mismatch:${identityMismatch}` : reason;
    const classification = identityMismatch
      ? { classification: "harness_failure" as const, eligibleForScoring: false }
      : classifyAttempt({ passed: result.passed && exitCode === 0, reason: finalReason });
    attempts.push({
      configLabel: item.config.label,
      file: item.file,
      repetition: item.repetition,
      ...classification,
      status: result.passed && exitCode === 0 ? "passed" : "failed",
      durationMs: result.durationMs,
      reason: finalReason,
      resultFile,
      requestedModels: requested,
      ...evidence,
      configFingerprint: fingerprintConfig(item.config),
      buildRevision,
      worktreeDirty,
    });
    writeFileSync(resolve(outputDir, "attempts.json"), JSON.stringify(attempts, null, 2));
    writeFileSync(resolve(outputDir, "report.md"), buildInvestigationReport(attempts));
    writeFileSync(
      resolve(outputDir, "manual-audit.json"),
      JSON.stringify(attempts.map((attempt) => ({
        configLabel: attempt.configLabel,
        file: attempt.file,
        repetition: attempt.repetition,
        validatorPassed: attempt.status === "passed",
        manualVerdict: null,
        evidenceReviewed: [],
        notes: "",
      })), null, 2),
    );
  }
}

main().catch((error) => {
  console.error(`[harness:investigation] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
