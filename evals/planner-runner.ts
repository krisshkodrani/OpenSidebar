/**
 * Planner eval runner.
 *
 * Replays planner eval cases against the LLM (decompose / validateDone)
 * without a browser.
 */

import { existsSync, mkdirSync } from "fs";
import { appendFile } from "fs/promises";
import { join } from "path";
import type { PlannerEvalCase, PlannerEvalResult } from "./types";
import {
  readPlannerEvalCases,
  PLANNER_RESULTS_DIR,
  type ApiKeys,
} from "./utils";
import { scorePlannerDecompose, scorePlannerValidateDone, isPlannerPass } from "./planner-scorer";
import { judgePlannerCase } from "./planner-judge";
import { getPromptTemplate } from "../src/prompts";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const SMART_MODEL = "z-ai/glm-4.7";

/** Adaptive timeout based on case difficulty */
function decomposeTimeout(difficulty: string): number {
  switch (difficulty) {
    case "hard": return 240_000;
    case "medium": return 180_000;
    default: return 120_000;
  }
}

/**
 * Replay a single planner decompose case.
 */
async function replayDecompose(
  keys: ApiKeys,
  evalCase: PlannerEvalCase,
  timeoutMs?: number,
): Promise<{ subtasks: string[]; steps?: any[]; difficulty: string; isMultiStep: boolean; modelVersion?: string }> {
  const systemPrompt = getPromptTemplate("planner.decompose.system");

  const userMessage = [
    `Page: ${evalCase.input.pageTitle} (${evalCase.input.pageUrl})`,
    evalCase.input.perception ? `Page state:\n${evalCase.input.perception}` : "",
    "",
    `Task: ${evalCase.input.query}`,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${keys.openrouter}`,
      "HTTP-Referer": "https://opensidebar.dev",
      "X-Title": "OpenSidebar Planner Evals",
    },
    body: JSON.stringify({
      model: SMART_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 4096,
    }),
    signal: AbortSignal.timeout(timeoutMs ?? 60_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const json = (await response.json()) as any;
  const text = json.choices?.[0]?.message?.content ?? "";
  const modelVersion: string | undefined = json.model ?? undefined;

  // Strip markdown code fences (same cleanup as production planner.ts)
  const cleaned = text
    .replace(/```(?:json)?\s*/g, "")
    .replace(/```/g, "")
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Fallback: extract first {...} block
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(`Failed to parse planner JSON response: ${text.slice(0, 200)}`);
    }
    parsed = JSON.parse(match[0]);
  }

  const subtasks: string[] = parsed.subtasks ?? parsed.steps?.map((s: any) => s.objective) ?? [];
  const steps = parsed.steps ?? [];
  const difficulty = parsed.difficulty ?? parsed.difficultyAssessment ?? "moderate";
  const isMultiStep = parsed.isMultiStep ?? subtasks.length > 1;

  return { subtasks, steps, difficulty, isMultiStep, modelVersion };
}

/**
 * Replay a single planner validateDone case.
 */
async function replayValidateDone(
  keys: ApiKeys,
  evalCase: PlannerEvalCase,
): Promise<{ approved: boolean; reason?: string; modelVersion?: string }> {
  const systemPrompt = getPromptTemplate("planner.validate_done.system");

  const planText = (evalCase.input.plan ?? [])
    .map((s, i) => `${i + 1}. [${s.status}] ${s.description}`)
    .join("\n");

  const userMessage = [
    `Task: ${evalCase.input.query}`,
    "",
    "Plan status:",
    planText,
    "",
    `Agent summary: ${evalCase.input.doneSummary ?? "(none)"}`,
  ].join("\n");

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${keys.openrouter}`,
      "HTTP-Referer": "https://opensidebar.dev",
      "X-Title": "OpenSidebar Planner Evals",
    },
    body: JSON.stringify({
      model: SMART_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 1024,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const json = (await response.json()) as any;
  const text = json.choices?.[0]?.message?.content ?? "";
  const modelVersion: string | undefined = json.model ?? undefined;

  // Strip markdown code fences (same cleanup as production planner.ts)
  const cleaned = text
    .replace(/```(?:json)?\s*/g, "")
    .replace(/```/g, "")
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(`Failed to parse validateDone JSON: ${text.slice(0, 200)}`);
    }
    parsed = JSON.parse(match[0]);
  }

  return {
    approved: parsed.approved ?? parsed.done ?? false,
    reason: parsed.reason ?? parsed.explanation,
    modelVersion,
  };
}

/**
 * Main entry point: run planner evals.
 */
export async function runPlannerEvals(options: {
  keys: ApiKeys;
  dimension?: string;
  method?: string;
  judge?: boolean;
  outDir?: string;
}): Promise<PlannerEvalResult[]> {
  const { keys, judge = false } = options;

  let cases = readPlannerEvalCases();
  if (cases.length === 0) {
    console.log("No planner eval cases found in evals/golden/planner/");
    return [];
  }

  if (options.dimension) {
    cases = cases.filter((c) => c.metadata.dimension === options.dimension);
  }
  if (options.method) {
    cases = cases.filter((c) => c.method === options.method);
  }

  const outDir = options.outDir ?? PLANNER_RESULTS_DIR;
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputFile = join(outDir, `planner-${timestamp}.jsonl`);

  const results: PlannerEvalResult[] = [];

  console.log(`Running ${cases.length} planner case(s)...\n`);

  for (let i = 0; i < cases.length; i++) {
    const evalCase = cases[i];

    process.stdout.write(
      `  [${i + 1}/${cases.length}] ${evalCase.id.slice(0, 40)} [${evalCase.method}]... `,
    );

    const start = Date.now();
    let result: PlannerEvalResult;

    try {
      if (evalCase.method === "decompose") {
        const actual = await replayDecompose(keys, evalCase, decomposeTimeout(evalCase.metadata.difficulty));
        const durationMs = Date.now() - start;
        const scores = scorePlannerDecompose(evalCase, actual);
        const pass = isPlannerPass(scores, "decompose");

        result = {
          caseId: evalCase.id,
          timestamp: new Date().toISOString(),
          durationMs,
          status: pass ? "pass" : "fail",
          method: "decompose",
          modelVersion: actual.modelVersion,
          actual: { decomposition: actual },
          scores,
        };
      } else {
        const actual = await replayValidateDone(keys, evalCase);
        const durationMs = Date.now() - start;
        const scores = scorePlannerValidateDone(evalCase, actual);
        const pass = isPlannerPass(scores, "validateDone");

        result = {
          caseId: evalCase.id,
          timestamp: new Date().toISOString(),
          durationMs,
          status: pass ? "pass" : "fail",
          method: "validateDone",
          modelVersion: actual.modelVersion,
          actual: { validation: actual },
          scores,
        };
      }

      // Run LLM judge if enabled and decompose
      if (judge && evalCase.method === "decompose" && result.actual.decomposition) {
        try {
          result.scores.judge = await judgePlannerCase(
            keys.openrouter,
            evalCase,
            result.actual.decomposition,
          );
          if (result.scores.judge.pass && result.status === "fail") {
            result.status = "pass";
          }
        } catch (err: any) {
          console.warn(`judge error: ${err.message}`);
        }
      }

      const statusColor = result.status === "pass" ? "\x1b[32m" : "\x1b[31m";
      console.log(
        `${statusColor}${result.status}\x1b[0m ` +
          `comp=${result.scores.composite.toFixed(2)} ${result.durationMs}ms`,
      );
    } catch (err: any) {
      result = {
        caseId: evalCase.id,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - start,
        status: "error",
        method: evalCase.method,
        actual: {},
        scores: {
          difficultyAccuracy: 0,
          stepCountScore: 0,
          coverageScore: 0,
          stepQualityScore: 0,
          antiPatternScore: 0,
          stepProgressScore: 0,
          terminationScore: 0,
          composite: 0,
        },
        error: err.message,
      };
      console.log(`\x1b[31merror\x1b[0m ${err.message.slice(0, 80)}`);
    }

    results.push(result);
    await appendFile(outputFile, JSON.stringify(result) + "\n");
  }

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errors = results.filter((r) => r.status === "error").length;
  console.log(`\nResults: ${passed} passed, ${failed} failed, ${errors} errors`);
  console.log(`Written to: ${outputFile}`);

  return results;
}
