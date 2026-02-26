/**
 * Shared utilities for the eval pipeline.
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { isAbsolute, join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import type { EvalCase, EvalResult, PerceptionEvalCase } from "./types";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const TRACE_DIR = join(PROJECT_ROOT, "traces");
export const CASES_DIR = join(PROJECT_ROOT, "evals", "cases");
export const RESULTS_DIR = join(PROJECT_ROOT, "evals", "results");
const TRACE_INDEX = join(TRACE_DIR, "index.jsonl");
const RUN_TRACE_DIR = join(TRACE_DIR, "runs");
const RUN_TRACE_INDEX = join(RUN_TRACE_DIR, "index.jsonl");

/** Read and parse a trace JSONL file for a given session ID */
export function readTrace(sessionId: string): Record<string, unknown>[] {
  const file = join(TRACE_DIR, `${sessionId}.jsonl`);
  if (!existsSync(file)) {
    throw new Error(`Trace file not found: ${file}`);
  }
  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Read the session index file */
export function readSessionIndex(): Record<string, unknown>[] {
  if (!existsSync(TRACE_INDEX)) return [];
  return readFileSync(TRACE_INDEX, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Read orchestrator run manifests from traces/runs/index.jsonl */
export function readRunTraceManifests(): Record<string, unknown>[] {
  if (!existsSync(RUN_TRACE_INDEX)) return [];
  return readFileSync(RUN_TRACE_INDEX, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Read orchestrator run trace events from traces/runs/{runId}.jsonl */
export function readRunTraceEvents(runId: string): Record<string, unknown>[] {
  const file = join(RUN_TRACE_DIR, `${runId}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Read all eval cases from the cases directory */
export function readEvalCases(): EvalCase[] {
  if (!existsSync(CASES_DIR)) return [];
  const files = readdirSync(CASES_DIR).filter((f) => f.endsWith(".jsonl"));
  const cases: EvalCase[] = [];
  for (const file of files) {
    const lines = readFileSync(join(CASES_DIR, file), "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean);
    for (const line of lines) {
      cases.push(JSON.parse(line));
    }
  }
  return cases;
}

/** Read all eval results from the results directory */
export function readEvalResults(): EvalResult[] {
  if (!existsSync(RESULTS_DIR)) return [];
  const files = readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".jsonl"));
  const results: EvalResult[] = [];
  for (const file of files) {
    const lines = readFileSync(join(RESULTS_DIR, file), "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean);
    for (const line of lines) {
      results.push(JSON.parse(line));
    }
  }
  return results;
}

export interface ApiKeys {
  openrouter: string;
  cerebras?: string;
  groq?: string;
}

/** Load API keys from .env / .env.local. OpenRouter is required; Cerebras is optional. */
export function loadApiKeys(): ApiKeys {
  const envFile = join(PROJECT_ROOT, ".env");
  const localEnv = join(PROJECT_ROOT, ".env.local");

  let content = "";
  if (existsSync(envFile)) {
    content = readFileSync(envFile, "utf-8");
  } else if (existsSync(localEnv)) {
    content = readFileSync(localEnv, "utf-8");
  } else {
    throw new Error("No .env or .env.local found. Set OPENROUTER_API_KEY.");
  }

  // Also layer .env.local on top of .env if both exist
  if (existsSync(envFile) && existsSync(localEnv)) {
    content += "\n" + readFileSync(localEnv, "utf-8");
  }

  const openrouter = extractEnvVar(content, "OPENROUTER_API_KEY");
  if (!openrouter) {
    throw new Error("OPENROUTER_API_KEY not found in .env file");
  }

  const cerebras = extractEnvVar(content, "CEREBRAS_API_KEY") || undefined;
  const groq = extractEnvVar(content, "GROQ_API_KEY") || undefined;

  return { openrouter, cerebras, groq };
}

/** Load OPENROUTER_API_KEY from .env file (backward compat wrapper) */
export function loadApiKey(): string {
  return loadApiKeys().openrouter;
}

function extractEnvVar(content: string, name: string): string | null {
  const match = content.match(new RegExp(`${name}=(.+)`));
  return match?.[1]?.trim() || null;
}

/** Levenshtein edit distance between two arrays of strings */
export function levenshteinDistance(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  return dp[m][n];
}

/** Find a session ID by prefix match */
export function resolveSessionId(prefix: string): string {
  const sessions = readSessionIndex();
  const match = sessions.find(
    (s: any) => s.sessionId === prefix || s.sessionId.startsWith(prefix),
  );
  if (!match) {
    throw new Error(`No session found matching: ${prefix}`);
  }
  return (match as any).sessionId;
}

// ── Perception eval I/O ──────────────────────────────────────────────

export const PERCEPTION_GOLDEN_DIR = join(PROJECT_ROOT, "evals", "golden", "perception");
export const PERCEPTION_RESULTS_DIR = join(PROJECT_ROOT, "evals", "results", "perception");

/** Read all perception eval cases from the perception golden dir */
export function readPerceptionEvalCases(): PerceptionEvalCase[] {
  if (!existsSync(PERCEPTION_GOLDEN_DIR)) return [];
  const files = readdirSync(PERCEPTION_GOLDEN_DIR).filter((f) => f.endsWith(".json"));
  const cases: PerceptionEvalCase[] = [];
  for (const file of files) {
    try {
      const content = readFileSync(join(PERCEPTION_GOLDEN_DIR, file), "utf-8");
      cases.push(JSON.parse(content));
    } catch { /* skip malformed */ }
  }
  return cases;
}

/** Read a prompt file from absolute or project-relative path */
export function readPromptFile(pathArg: string): string {
  const resolved = isAbsolute(pathArg) ? pathArg : resolve(PROJECT_ROOT, pathArg);
  if (!existsSync(resolved)) {
    throw new Error(`Prompt file not found: ${resolved}`);
  }
  const text = readFileSync(resolved, "utf-8").trim();
  if (!text) {
    throw new Error(`Prompt file is empty: ${resolved}`);
  }
  return text;
}
