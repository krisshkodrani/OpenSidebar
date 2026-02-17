/**
 * Shared utilities for the eval pipeline.
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { isAbsolute, join, dirname, resolve } from "path";
import type { EvalCase, EvalResult } from "./types";

const PROJECT_ROOT = join(dirname(import.meta.dir));
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

/** Load OPENROUTER_API_KEY from .env file */
export function loadApiKey(): string {
  const envFile = join(PROJECT_ROOT, ".env");
  if (!existsSync(envFile)) {
    const localEnv = join(PROJECT_ROOT, ".env.local");
    if (existsSync(localEnv)) {
      return extractApiKey(readFileSync(localEnv, "utf-8"));
    }
    throw new Error("No .env or .env.local found. Set OPENROUTER_API_KEY.");
  }
  return extractApiKey(readFileSync(envFile, "utf-8"));
}

function extractApiKey(content: string): string {
  const match = content.match(/OPENROUTER_API_KEY=(.+)/);
  if (!match || !match[1]) {
    throw new Error("OPENROUTER_API_KEY not found in .env file");
  }
  return match[1].trim();
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
