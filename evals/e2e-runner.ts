/**
 * E2E snapshot-replay eval runner.
 *
 * Feeds each golden case's frozen DOM snapshot to the LLM and judges
 * whether it picks the right tools/actions — without a live browser.
 * Single-turn eval: one LLM call per step.
 */

import { existsSync, mkdirSync, readFileSync } from "fs";
import { appendFile } from "fs/promises";
import { join } from "path";
import type { E2EGoldenCase, E2EEvalResult } from "./e2e-types";
import { readE2EGoldenCases, E2E_RESULTS_DIR, type ApiKeys } from "./utils";
import { scoreE2E, isPass } from "./e2e-scorer";
import { judgeE2ECase } from "./e2e-judge";
import { formatSnapshotElements } from "../src/background/agent/context";
import { getPromptTemplate } from "../src/prompts";
import { recoverToolCallsFromText } from "../src/background/agent/tool-recovery";
import type { TaggedElement } from "../src/types";

export type E2EProvider = "groq" | "openrouter";

const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";
const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL_OPENROUTER = "openai/gpt-oss-120b";
const DEFAULT_MODEL_GROQ = "openai/gpt-oss-120b";

const TOOL_DEFS_PATH = join("evals", "tool-definitions.json");

function loadToolDefinitions(): any[] {
  if (!existsSync(TOOL_DEFS_PATH)) {
    console.warn(`Warning: ${TOOL_DEFS_PATH} not found. Run: npx tsx scripts/extract-tool-defs.ts`);
    return [];
  }
  return JSON.parse(readFileSync(TOOL_DEFS_PATH, "utf-8"));
}

/**
 * Build the system prompt for a golden case, mirroring what the live agent sees.
 */
function buildSystemPrompt(goldenCase: E2EGoldenCase): string {
  const template = getPromptTemplate("agent.system");
  const elements = goldenCase.entryElements as unknown as TaggedElement[];
  const elementList = formatSnapshotElements(elements);

  return (
    template +
    "\n\n## Page Context\n\n" +
    `URL: ${goldenCase.entrySnapshot.url}\n` +
    `Title: ${goldenCase.entrySnapshot.title}\n` +
    `Scroll: ${goldenCase.entrySnapshot.scrollY}px\n` +
    `Elements: ${goldenCase.entrySnapshot.elementCount}\n\n` +
    "### Interactive Elements\n\n" +
    elementList
  );
}

/**
 * Build the user message for a golden case.
 */
function buildUserMessage(goldenCase: E2EGoldenCase): string {
  return (
    `You are on step ${goldenCase.stepNumber} of a browser navigation challenge.\n` +
    `The page is: ${goldenCase.entrySnapshot.title}\n` +
    `URL: ${goldenCase.challengeUrl}\n\n` +
    "Your task: Find the hidden code on this page and submit it in the code input field. " +
    "Look carefully at all elements — the code may be hidden in unusual places. " +
    "Once you find the code, type it into the input field and click the submit button."
  );
}

/**
 * Replay a single E2E golden case against the LLM.
 */
export async function replayE2ECase(
  keys: ApiKeys,
  goldenCase: E2EGoldenCase,
  provider: E2EProvider,
): Promise<{
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
  text: string | null;
  modelVersion?: string;
  durationMs: number;
}> {
  const useGroq = provider === "groq" && !!keys.groq;
  const model = useGroq ? DEFAULT_MODEL_GROQ : DEFAULT_MODEL_OPENROUTER;
  const apiUrl = useGroq ? GROQ_API : OPENROUTER_API;

  const systemPrompt = buildSystemPrompt(goldenCase);
  const userMessage = buildUserMessage(goldenCase);

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  const tools = loadToolDefinitions();
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: 4096,
    temperature: 0,
  };

  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${useGroq ? keys.groq! : keys.openrouter}`,
    "Content-Type": "application/json",
  };
  if (!useGroq) {
    headers["HTTP-Referer"] = "https://opensidebar.dev";
    headers["X-Title"] = "OpenSidebar E2E Evals";
  }

  const start = Date.now();
  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`LLM API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await response.json()) as any;
  const choice = data.choices?.[0];
  if (!choice) throw new Error("No response choice");
  const durationMs = Date.now() - start;
  const responseModel: string | undefined = data.model ?? undefined;

  let toolCalls = (choice.message?.tool_calls ?? []).map((tc: any) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments);
    } catch { /* keep empty */ }
    return { toolName: tc.function.name, args };
  });

  const text: string | null = choice.message?.content ?? null;

  // Text recovery: match production behavior when model emits tool calls as JSON text
  if (toolCalls.length === 0 && text) {
    const recovered = recoverToolCallsFromText(text);
    if (recovered && recovered.length > 0) {
      toolCalls = recovered.map((tc) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch { /* keep empty */ }
        return { toolName: tc.function.name, args };
      });
    }
  }

  return { toolCalls, text, modelVersion: responseModel, durationMs };
}

/**
 * Main entry point: run E2E evals against golden cases.
 */
export async function runE2EEvals(options: {
  keys: ApiKeys;
  provider?: E2EProvider;
  judge?: boolean;
  stepFilter?: number;
}): Promise<E2EEvalResult[]> {
  const { keys, judge = false } = options;
  const provider = options.provider ?? (keys.groq ? "groq" : "openrouter");

  let cases = readE2EGoldenCases();
  if (cases.length === 0) {
    console.log("No E2E golden cases found in evals/golden/e2e/");
    return [];
  }

  if (options.stepFilter) {
    cases = cases.filter((c) => c.stepNumber === options.stepFilter);
  }

  if (!existsSync(E2E_RESULTS_DIR)) {
    mkdirSync(E2E_RESULTS_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputFile = join(E2E_RESULTS_DIR, `e2e-${timestamp}.jsonl`);

  const results: E2EEvalResult[] = [];

  console.log(
    `Running ${cases.length} E2E case(s) against ${provider}...\n`,
  );

  for (let i = 0; i < cases.length; i++) {
    const goldenCase = cases[i];
    process.stdout.write(
      `  [${i + 1}/${cases.length}] step${goldenCase.stepNumber.toString().padStart(2, "0")} ` +
        `(${goldenCase.actions.total} actions) [${provider}]... `,
    );

    const start = Date.now();
    let result: E2EEvalResult;

    try {
      const replay = await replayE2ECase(keys, goldenCase, provider);
      const durationMs = Date.now() - start;

      const scores = scoreE2E(goldenCase, replay.toolCalls);
      const pass = isPass(scores);

      result = {
        caseId: goldenCase.id,
        stepNumber: goldenCase.stepNumber,
        timestamp: new Date().toISOString(),
        durationMs,
        status: pass ? "pass" : "fail",
        modelVersion: replay.modelVersion,
        actual: {
          toolCalls: replay.toolCalls,
          text: replay.text,
        },
        scores: { ...scores },
      };

      // Run LLM judge if enabled
      if (judge) {
        try {
          result.scores.judge = await judgeE2ECase(
            keys.openrouter,
            goldenCase,
            replay.toolCalls,
            replay.text,
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
          `code=${scores.codeDiscovery.toFixed(2)} sol=${scores.solutionActions.toFixed(2)} ` +
          `tool=${scores.toolSelection.toFixed(2)} tgt=${scores.elementTargeting.toFixed(2)} ` +
          `eff=${scores.actionEfficiency.toFixed(2)} comp=${scores.composite.toFixed(2)} ${durationMs}ms`,
      );
    } catch (err: any) {
      result = {
        caseId: goldenCase.id,
        stepNumber: goldenCase.stepNumber,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - start,
        status: "error",
        actual: { toolCalls: [], text: null },
        scores: {
          codeDiscovery: 0,
          toolSelection: 0,
          solutionActions: 0,
          actionEfficiency: 0,
          elementTargeting: 0,
          composite: 0,
        },
        error: err.message,
      };
      console.log(`\x1b[31merror\x1b[0m ${err.message.slice(0, 80)}`);
    }

    results.push(result);
    await appendFile(outputFile, JSON.stringify(result) + "\n");
  }

  // Summary
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errors = results.filter((r) => r.status === "error").length;
  console.log(`\nResults: ${passed} passed, ${failed} failed, ${errors} errors`);
  console.log(`Written to: ${outputFile}`);

  return results;
}
