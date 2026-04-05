/**
 * Shared utilities for the eval pipeline.
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { isAbsolute, join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import type {
  EvalCase,
  EvalResult,
  PerceptionEvalCase,
  PlannerEvalCase,
  ContextEvalCase,
  StagnationEvalCase,
} from "./types";
import type { EscalationGoldenCase } from "./escalation-types";
import type { CompletionTimingGoldenCase } from "./completion-timing-types";
import type { GroundingGoldenCase } from "./grounding-types";
import type { ToolConfusionGoldenCase } from "./tool-confusion-types";
import type { ContextEfficiencyGoldenCase } from "./context-efficiency-types";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const TRACE_DIR = join(PROJECT_ROOT, "traces");
export const LOG_DIR = join(PROJECT_ROOT, "logs");
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

/** Read session manifests directly from trace files when index.jsonl is stale or incomplete. */
export function readSessionFiles(): Record<string, unknown>[] {
  if (!existsSync(TRACE_DIR)) return [];

  const files = readdirSync(TRACE_DIR).filter(
    (file) => file.endsWith(".jsonl") && file !== "index.jsonl",
  );
  const sessions: Record<string, unknown>[] = [];

  for (const file of files) {
    try {
      const lines = readFileSync(join(TRACE_DIR, file), "utf-8")
        .trim()
        .split("\n")
        .filter(Boolean);
      const firstSessionLine = lines.find((line) => {
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          return parsed.traceKind === "agent.session";
        } catch {
          return false;
        }
      });
      if (!firstSessionLine) continue;
      sessions.push(JSON.parse(firstSessionLine));
    } catch {
      continue;
    }
  }

  return sessions;
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
  groq?: string;
  fireworks?: string;
}

/** Load API keys from .env / .env.local. OpenRouter is required. */
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

  const groq = extractEnvVar(content, "GROQ_API_KEY") ?? undefined;
  const fireworks = extractEnvVar(content, "FIREWORKS_API_KEY") ?? undefined;

  return { openrouter, groq, fireworks };
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
  const sessions = [...readSessionIndex(), ...readSessionFiles()];
  const seen = new Set<string>();
  const uniqueSessions = sessions.filter((session: any) => {
    const sessionId = session?.sessionId;
    if (typeof sessionId !== "string" || seen.has(sessionId)) {
      return false;
    }
    seen.add(sessionId);
    return true;
  });
  const match = uniqueSessions.find(
    (s: any) => s.sessionId === prefix || s.sessionId.startsWith(prefix),
  );
  if (!match) {
    throw new Error(`No session found matching: ${prefix}`);
  }
  return (match as any).sessionId;
}

/** Find a run ID by prefix match */
export function resolveRunId(prefix: string): string {
  const manifests = readRunTraceManifests();
  const match = manifests.find(
    (m: any) => m.runId === prefix || m.runId?.startsWith(prefix),
  );
  if (!match) {
    throw new Error(`No run trace found matching: ${prefix}`);
  }
  return (match as any).runId;
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

// ── Planner eval I/O ─────────────────────────────────────────────────

export const PLANNER_GOLDEN_DIR = join(PROJECT_ROOT, "evals", "golden", "planner");
export const PLANNER_RESULTS_DIR = join(PROJECT_ROOT, "evals", "results", "planner");

/** Read all planner eval cases from the planner golden dir */
export function readPlannerEvalCases(): PlannerEvalCase[] {
  if (!existsSync(PLANNER_GOLDEN_DIR)) return [];
  const files = readdirSync(PLANNER_GOLDEN_DIR).filter((f) => f.endsWith(".json"));
  const cases: PlannerEvalCase[] = [];
  for (const file of files) {
    try {
      const content = readFileSync(join(PLANNER_GOLDEN_DIR, file), "utf-8");
      cases.push(JSON.parse(content));
    } catch { /* skip malformed */ }
  }
  return cases;
}

// ── Context eval I/O ─────────────────────────────────────────────────

export const CONTEXT_GOLDEN_DIR = join(PROJECT_ROOT, "evals", "golden", "context");
export const CONTEXT_RESULTS_DIR = join(PROJECT_ROOT, "evals", "results", "context");

/** Read all context eval cases from the context golden dir */
export function readContextEvalCases(): ContextEvalCase[] {
  if (!existsSync(CONTEXT_GOLDEN_DIR)) return [];
  const files = readdirSync(CONTEXT_GOLDEN_DIR).filter((f) => f.endsWith(".json"));
  const cases: ContextEvalCase[] = [];
  for (const file of files) {
    try {
      const content = readFileSync(join(CONTEXT_GOLDEN_DIR, file), "utf-8");
      cases.push(JSON.parse(content));
    } catch { /* skip malformed */ }
  }
  return cases;
}

// ── Stagnation eval I/O ──────────────────────────────────────────────

export const STAGNATION_GOLDEN_DIR = join(PROJECT_ROOT, "evals", "golden", "stagnation");
export const STAGNATION_RESULTS_DIR = join(PROJECT_ROOT, "evals", "results", "stagnation");

/** Read all stagnation eval cases from the stagnation golden dir */
export function readStagnationEvalCases(): StagnationEvalCase[] {
  if (!existsSync(STAGNATION_GOLDEN_DIR)) return [];
  const files = readdirSync(STAGNATION_GOLDEN_DIR).filter((f) => f.endsWith(".json"));
  const cases: StagnationEvalCase[] = [];
  for (const file of files) {
    try {
      const content = readFileSync(join(STAGNATION_GOLDEN_DIR, file), "utf-8");
      cases.push(JSON.parse(content));
    } catch { /* skip malformed */ }
  }
  return cases;
}


// ── Escalation eval I/O ──────────────────────────────────────────────

export const ESCALATION_GOLDEN_DIR = join(PROJECT_ROOT, "evals", "golden", "escalation");
export const ESCALATION_RESULTS_DIR = join(PROJECT_ROOT, "evals", "results", "escalation");

/** Read all escalation golden cases from the escalation golden dir */
export function readEscalationGoldenCases(): EscalationGoldenCase[] {
  if (!existsSync(ESCALATION_GOLDEN_DIR)) return [];
  const files = readdirSync(ESCALATION_GOLDEN_DIR).filter((f) => f.endsWith(".json"));
  const cases: EscalationGoldenCase[] = [];
  for (const file of files.sort()) {
    try {
      const content = readFileSync(join(ESCALATION_GOLDEN_DIR, file), "utf-8");
      cases.push(JSON.parse(content));
    } catch { /* skip malformed */ }
  }
  return cases;
}

// ── Completion-timing eval I/O ───────────────────────────────────────

export const COMPLETION_TIMING_GOLDEN_DIR = join(PROJECT_ROOT, "evals", "golden", "completion-timing");
export const COMPLETION_TIMING_RESULTS_DIR = join(PROJECT_ROOT, "evals", "results", "completion-timing");

/** Read all completion-timing golden cases from the completion-timing golden dir */
export function readCompletionTimingGoldenCases(): CompletionTimingGoldenCase[] {
  if (!existsSync(COMPLETION_TIMING_GOLDEN_DIR)) return [];
  const files = readdirSync(COMPLETION_TIMING_GOLDEN_DIR).filter((f) => f.endsWith(".json"));
  const cases: CompletionTimingGoldenCase[] = [];
  for (const file of files.sort()) {
    try {
      const content = readFileSync(join(COMPLETION_TIMING_GOLDEN_DIR, file), "utf-8");
      cases.push(JSON.parse(content));
    } catch { /* skip malformed */ }
  }
  return cases;
}

// ── Grounding eval I/O ────────────────────────────────────────────────

export const GROUNDING_GOLDEN_DIR = join(PROJECT_ROOT, "evals", "golden", "grounding");
export const GROUNDING_RESULTS_DIR = join(PROJECT_ROOT, "evals", "results", "grounding");

/** Read all grounding golden cases from the grounding golden dir */
export function readGroundingGoldenCases(): GroundingGoldenCase[] {
  if (!existsSync(GROUNDING_GOLDEN_DIR)) return [];
  const files = readdirSync(GROUNDING_GOLDEN_DIR).filter((f) => f.endsWith(".json"));
  const cases: GroundingGoldenCase[] = [];
  for (const file of files.sort()) {
    try {
      const content = readFileSync(join(GROUNDING_GOLDEN_DIR, file), "utf-8");
      cases.push(JSON.parse(content));
    } catch { /* skip malformed */ }
  }
  return cases;
}

// ── Tool-confusion eval I/O ────────────────────────────────────────────

export const TOOL_CONFUSION_GOLDEN_DIR = join(PROJECT_ROOT, "evals", "golden", "tool-confusion");
export const TOOL_CONFUSION_RESULTS_DIR = join(PROJECT_ROOT, "evals", "results", "tool-confusion");

/** Read all tool-confusion golden cases from the tool-confusion golden dir */
export function readToolConfusionGoldenCases(): ToolConfusionGoldenCase[] {
  if (!existsSync(TOOL_CONFUSION_GOLDEN_DIR)) return [];
  const files = readdirSync(TOOL_CONFUSION_GOLDEN_DIR).filter((f) => f.endsWith(".json"));
  const cases: ToolConfusionGoldenCase[] = [];
  for (const file of files.sort()) {
    try {
      const content = readFileSync(join(TOOL_CONFUSION_GOLDEN_DIR, file), "utf-8");
      cases.push(JSON.parse(content));
    } catch { /* skip malformed */ }
  }
  return cases;
}

// ── Context-efficiency eval I/O ──────────────────────────────────────

export const CONTEXT_EFFICIENCY_GOLDEN_DIR = join(PROJECT_ROOT, "evals", "golden", "context-efficiency");
export const CONTEXT_EFFICIENCY_RESULTS_DIR = join(PROJECT_ROOT, "evals", "results", "context-efficiency");

/** Read all context-efficiency golden cases from the context-efficiency golden dir */
export function readContextEfficiencyGoldenCases(): ContextEfficiencyGoldenCase[] {
  if (!existsSync(CONTEXT_EFFICIENCY_GOLDEN_DIR)) return [];
  const files = readdirSync(CONTEXT_EFFICIENCY_GOLDEN_DIR).filter((f) => f.endsWith(".json"));
  const cases: ContextEfficiencyGoldenCase[] = [];
  for (const file of files.sort()) {
    try {
      const content = readFileSync(join(CONTEXT_EFFICIENCY_GOLDEN_DIR, file), "utf-8");
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
