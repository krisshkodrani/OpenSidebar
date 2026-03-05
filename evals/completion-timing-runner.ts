/**
 * Completion-timing eval runner.
 *
 * Single-phase eval per golden case:
 * Feed the model a snapshot + element list + action history + plan status + perception.
 * Score whether it calls `done()` or picks another tool.
 *
 * Each case is a single LLM call — deterministic and fast.
 */

import { existsSync, mkdirSync, readFileSync } from "fs";
import { appendFile } from "fs/promises";
import { join } from "path";
import type {
  CompletionTimingGoldenCase,
  CompletionTimingEvalResult,
} from "./completion-timing-types";
import {
  readCompletionTimingGoldenCases,
  COMPLETION_TIMING_RESULTS_DIR,
  type ApiKeys,
} from "./utils";
import { scoreCompletionTiming, isCompletionTimingPass } from "./completion-timing-scorer";
import { judgeCompletionTimingCase } from "./completion-timing-judge";
import { formatSnapshotElements } from "../src/background/agent/context";
import { getPromptTemplate } from "../src/prompts";
import { recoverToolCallsFromText } from "../src/background/agent/tool-recovery";
import type { TaggedElement } from "../src/types";

const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-oss-120b";

const TOOL_DEFS_PATH = join("evals", "tool-definitions.json");

function loadToolDefinitions(): any[] {
  if (!existsSync(TOOL_DEFS_PATH)) {
    console.warn(`Warning: ${TOOL_DEFS_PATH} not found.`);
    return [];
  }
  return JSON.parse(readFileSync(TOOL_DEFS_PATH, "utf-8"));
}

// ── Prompt construction ──────────────────────────────────────────────

function buildSystemPrompt(goldenCase: CompletionTimingGoldenCase): string {
  const template = getPromptTemplate("agent.system");
  const elements = goldenCase.elements as unknown as TaggedElement[];
  const elementList = formatSnapshotElements(elements);
  const snap = goldenCase.snapshot;

  return (
    template +
    "\n\n## Page Context\n\n" +
    `URL: ${snap.url}\n` +
    `Title: ${snap.title}\n` +
    `Scroll: ${snap.scrollY}px\n` +
    `Elements: ${snap.elementCount}\n\n` +
    "### Interactive Elements\n\n" +
    elementList +
    "\n\n### Page Interpretation (Vision)\n\n" +
    goldenCase.perception
  );
}

function buildMessages(goldenCase: CompletionTimingGoldenCase): any[] {
  const messages: any[] = [
    { role: "system", content: buildSystemPrompt(goldenCase) },
    { role: "user", content: goldenCase.objective },
  ];

  // Inject action history as alternating assistant tool_call + tool result messages
  for (let i = 0; i < goldenCase.actionHistory.length; i++) {
    const h = goldenCase.actionHistory[i];
    const callId = `history-tc-${i}`;

    messages.push({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: callId,
          type: "function",
          function: {
            name: h.tool,
            arguments: JSON.stringify(h.args),
          },
        },
      ],
    });

    messages.push({
      role: "tool",
      tool_call_id: callId,
      content: h.result,
    });
  }

  // Inject plan status as a user message
  const planLines = goldenCase.plan.map(
    (p, i) => `${i + 1}. [${p.status}] ${p.step}`,
  );
  messages.push({
    role: "user",
    content: "PLAN STATUS:\n" + planLines.join("\n"),
  });

  return messages;
}

// ── Replay ───────────────────────────────────────────────────────────

export type CompletionTimingProvider = "openrouter";

/**
 * Replay a single completion-timing case. Returns the model's tool calls and text.
 */
export async function replayCompletionTiming(
  keys: ApiKeys,
  goldenCase: CompletionTimingGoldenCase,
  provider: CompletionTimingProvider,
): Promise<{
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
  text: string | null;
  modelVersion?: string;
  durationMs: number;
}> {
  const model = DEFAULT_MODEL;

  const messages = buildMessages(goldenCase);
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
    Authorization: `Bearer ${keys.openrouter}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://opensidebar.dev",
    "X-Title": "OpenSidebar Completion-Timing Evals",
  };

  const start = Date.now();
  const response = await fetch(OPENROUTER_API, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await response.json()) as any;
  const choice = data.choices?.[0];
  if (!choice) throw new Error("No response choice");
  const durationMs = Date.now() - start;
  const responseModel: string | undefined = data.model ?? undefined;

  let toolCalls = parseToolCalls(choice);
  const text: string | null = choice.message?.content ?? null;

  if (toolCalls.length === 0 && text) {
    const recovered = recoverToolCallsFromText(text);
    if (recovered && recovered.length > 0) {
      toolCalls = recovered.map((tc) => {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments); } catch { /* keep empty */ }
        return { toolName: tc.function.name, args };
      });
    }
  }

  return { toolCalls, text, modelVersion: responseModel, durationMs };
}

// ── Helpers ──────────────────────────────────────────────────────────

function parseToolCalls(
  choice: any,
): Array<{ toolName: string; args: Record<string, unknown> }> {
  return (choice.message?.tool_calls ?? []).map((tc: any) => {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(tc.function.arguments); } catch { /* keep empty */ }
    return { toolName: tc.function.name, args };
  });
}

// ── Main entry point ─────────────────────────────────────────────────

export async function runCompletionTimingEvals(options: {
  keys: ApiKeys;
  provider?: CompletionTimingProvider;
  judge?: boolean;
  scenarioFilter?: string;
}): Promise<CompletionTimingEvalResult[]> {
  const { keys, judge = false } = options;
  const provider = options.provider ?? "openrouter";

  let cases = readCompletionTimingGoldenCases();
  if (cases.length === 0) {
    console.log("No completion-timing golden cases found in evals/golden/completion-timing/");
    return [];
  }

  if (options.scenarioFilter) {
    cases = cases.filter((c) => c.scenario === options.scenarioFilter);
  }

  if (!existsSync(COMPLETION_TIMING_RESULTS_DIR)) {
    mkdirSync(COMPLETION_TIMING_RESULTS_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputFile = join(COMPLETION_TIMING_RESULTS_DIR, `completion-timing-${timestamp}.jsonl`);

  const results: CompletionTimingEvalResult[] = [];

  console.log(
    `Running ${cases.length} completion-timing case(s) [provider: ${provider}]...\n`,
  );

  for (let i = 0; i < cases.length; i++) {
    const goldenCase = cases[i];
    process.stdout.write(
      `  [${i + 1}/${cases.length}] ${goldenCase.id} (${goldenCase.scenario}) ... `,
    );

    const start = Date.now();
    let result: CompletionTimingEvalResult;

    try {
      const replay = await replayCompletionTiming(keys, goldenCase, provider);
      const durationMs = Date.now() - start;

      const scores = scoreCompletionTiming(goldenCase, replay.toolCalls, replay.text);
      const pass = isCompletionTimingPass(scores);

      result = {
        caseId: goldenCase.id,
        scenario: goldenCase.scenario,
        timestamp: new Date().toISOString(),
        durationMs,
        status: pass ? "pass" : "fail",
        modelVersion: replay.modelVersion,
        result: {
          toolCalls: replay.toolCalls,
          text: replay.text,
        },
        scores,
      };

      // Run LLM judge if enabled
      if (judge) {
        try {
          result.judge = await judgeCompletionTimingCase(
            keys.openrouter,
            goldenCase,
            replay,
          );
          if (result.judge.pass && result.status === "fail") {
            result.status = "pass";
          }
        } catch (err: any) {
          console.warn(`judge error: ${err.message}`);
        }
      }

      const statusColor = result.status === "pass" ? "\x1b[32m" : "\x1b[31m";
      console.log(
        `${statusColor}${result.status}\x1b[0m ` +
          `dec=${scores.decisionCorrect.toFixed(2)} sum=${scores.summaryQuality.toFixed(2)} ` +
          `next=${scores.nextActionQuality.toFixed(2)} perc=${scores.perceptionUsage.toFixed(2)} ` +
          `comp=${scores.composite.toFixed(2)} ${durationMs}ms`,
      );
    } catch (err: any) {
      result = {
        caseId: goldenCase.id,
        scenario: goldenCase.scenario,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - start,
        status: "error",
        result: { toolCalls: [], text: null },
        scores: {
          decisionCorrect: 0,
          summaryQuality: 0,
          nextActionQuality: 0,
          perceptionUsage: 0,
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
