/**
 * Context-efficiency eval runner.
 *
 * Single-phase eval: replays golden cases against the executor model and measures
 * whether the agent produces equivalent behavior. Supports A/B comparison by running
 * each case with both "baseline" and "optimized" prompt variants.
 */

import { existsSync, mkdirSync, readFileSync } from "fs";
import { appendFile } from "fs/promises";
import { join } from "path";
import type {
  ContextEfficiencyGoldenCase,
  ContextEfficiencyEvalResult,
} from "./context-efficiency-types";
import {
  readContextEfficiencyGoldenCases,
  CONTEXT_EFFICIENCY_RESULTS_DIR,
  type ApiKeys,
} from "./utils";
import {
  scoreContextEfficiency,
  isContextEfficiencyPass,
} from "./context-efficiency-scorer";
import { formatSnapshotElements } from "../src/background/agent/context";
import { getPromptTemplate } from "../src/prompts";
import { recoverToolCallsFromText } from "../src/background/agent/tool-recovery";
import type { TaggedElement } from "../src/types";

export type ContextEfficiencyProvider = "openrouter";

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

// ── System prompt construction ───────────────────────────────────────

function buildSystemPrompt(
  goldenCase: ContextEfficiencyGoldenCase,
  variant: "baseline" | "optimized",
): string {
  const template = getPromptTemplate("agent.system");
  const elements = goldenCase.elements as unknown as TaggedElement[];
  const elementList = formatSnapshotElements(elements);
  const snap = goldenCase.snapshot;

  let prompt = template;

  // Plan status injection
  if (goldenCase.planStatus) {
    const { subtasks, currentIndex } = goldenCase.planStatus;
    const doneList = subtasks
      .filter((s) => s.status === "done")
      .map((s) => s.description)
      .join(", ");
    const current = subtasks[currentIndex];
    const pending = subtasks.filter((s) => s.status === "pending").length;
    prompt += `\n\n## Active Plan [${currentIndex + 1}/${subtasks.length}]`;
    prompt += `\nCurrent: ${current?.description ?? "none"}`;
    if (doneList) prompt += `\nDone: ${doneList}`;
    if (pending > 0) prompt += `\nPending: ${pending} step(s) remaining`;
  }

  // Time awareness (optimized variant only)
  if (variant === "optimized" && goldenCase.turnContext) {
    const { turnCount, maxTurns, elapsedSeconds } = goldenCase.turnContext;
    const remaining = maxTurns - turnCount;
    prompt += `\n\nTurn ${turnCount}/${maxTurns} | Elapsed: ${elapsedSeconds}s | Budget: ${remaining} turns left`;
  }

  prompt +=
    "\n\n## Page Context\n\n" +
    `URL: ${snap.url}\n` +
    `Title: ${snap.title}\n` +
    `Scroll: ${snap.scrollY}px\n` +
    `Elements: ${snap.elementCount}\n\n` +
    "### Interactive Elements\n\n" +
    elementList;

  if (goldenCase.pageContent) {
    prompt += "\n\n### Visible Page Content\n\n" + goldenCase.pageContent;
  }

  return prompt;
}

// ── Message construction ─────────────────────────────────────────────

function buildMessages(
  goldenCase: ContextEfficiencyGoldenCase,
  variant: "baseline" | "optimized",
): any[] {
  const messages: any[] = [
    { role: "system", content: buildSystemPrompt(goldenCase, variant) },
    { role: "user", content: goldenCase.instruction },
  ];

  if (goldenCase.priorHistory && goldenCase.priorHistory.length > 0) {
    for (let i = 0; i < goldenCase.priorHistory.length; i++) {
      const h = goldenCase.priorHistory[i];
      const callId = `prior-ce-${i}`;

      if (variant === "optimized" && i < goldenCase.priorHistory.length - 2) {
        // Observation masking: replace old tool outputs with summaries
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: callId,
              type: "function",
              function: { name: h.tool, arguments: JSON.stringify(h.args) },
            },
          ],
        });
        const firstLine = h.result.split("\n")[0].slice(0, 100);
        messages.push({
          role: "tool",
          tool_call_id: callId,
          content: `[T${i + 1}: ${firstLine}]`,
        });
      } else {
        // Keep recent history verbatim
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: callId,
              type: "function",
              function: { name: h.tool, arguments: JSON.stringify(h.args) },
            },
          ],
        });
        messages.push({
          role: "tool",
          tool_call_id: callId,
          content: h.result,
        });
      }
    }
  }

  return messages;
}

// ── Token estimation ─────────────────────────────────────────────────

function estimateTokens(messages: any[]): {
  systemPromptTokens: number;
  historyTokens: number;
  totalInputTokens: number;
} {
  let systemPromptTokens = 0;
  let historyTokens = 0;

  for (const msg of messages) {
    const content = typeof msg.content === "string" ? msg.content : "";
    const toolCalls = msg.tool_calls
      ? JSON.stringify(msg.tool_calls)
      : "";
    const tokens = Math.ceil((content.length + toolCalls.length) / 4);

    if (msg.role === "system") {
      systemPromptTokens += tokens;
    } else {
      historyTokens += tokens;
    }
  }

  return {
    systemPromptTokens,
    historyTokens,
    totalInputTokens: systemPromptTokens + historyTokens,
  };
}

// ── API call ─────────────────────────────────────────────────────────

async function replayCase(
  keys: ApiKeys,
  goldenCase: ContextEfficiencyGoldenCase,
  variant: "baseline" | "optimized",
): Promise<{
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
  text: string | null;
  modelVersion?: string;
  durationMs: number;
  tokenMetrics: { systemPromptTokens: number; historyTokens: number; totalInputTokens: number };
}> {
  const messages = buildMessages(goldenCase, variant);
  const tokenMetrics = estimateTokens(messages);

  let tools = loadToolDefinitions();
  if (goldenCase.toolSubset && goldenCase.toolSubset.length > 0) {
    const subset = new Set(goldenCase.toolSubset);
    tools = tools.filter((t: any) => subset.has(t.function?.name));
  }

  const body: Record<string, unknown> = {
    model: DEFAULT_MODEL,
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
    "X-Title": "OpenSidebar Context-Efficiency Evals",
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
        try { args = JSON.parse(tc.function.arguments); } catch { /* empty */ }
        return { toolName: tc.function.name, args };
      });
    }
  }

  return { toolCalls, text, modelVersion: responseModel, durationMs, tokenMetrics };
}

function parseToolCalls(
  choice: any,
): Array<{ toolName: string; args: Record<string, unknown> }> {
  return (choice.message?.tool_calls ?? []).map((tc: any) => {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(tc.function.arguments); } catch { /* empty */ }
    return { toolName: tc.function.name, args };
  });
}

// ── Main entry point ─────────────────────────────────────────────────

export async function runContextEfficiencyEvals(options: {
  keys: ApiKeys;
  provider?: ContextEfficiencyProvider;
  scenarioFilter?: string;
}): Promise<ContextEfficiencyEvalResult[]> {
  const { keys } = options;

  let cases = readContextEfficiencyGoldenCases();
  if (cases.length === 0) {
    console.log("No context-efficiency golden cases found in evals/golden/context-efficiency/");
    return [];
  }

  if (options.scenarioFilter) {
    cases = cases.filter((c) => c.scenario === options.scenarioFilter);
  }

  if (!existsSync(CONTEXT_EFFICIENCY_RESULTS_DIR)) {
    mkdirSync(CONTEXT_EFFICIENCY_RESULTS_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputFile = join(
    CONTEXT_EFFICIENCY_RESULTS_DIR,
    `context-efficiency-${timestamp}.jsonl`,
  );

  const results: ContextEfficiencyEvalResult[] = [];
  const variants: Array<"baseline" | "optimized"> = ["baseline", "optimized"];

  console.log(
    `Running ${cases.length} context-efficiency case(s) × ${variants.length} variants...\n`,
  );

  for (let i = 0; i < cases.length; i++) {
    const goldenCase = cases[i];

    for (const variant of variants) {
      process.stdout.write(
        `  [${i + 1}/${cases.length}] ${goldenCase.id} (${variant}) ... `,
      );

      const start = Date.now();
      let result: ContextEfficiencyEvalResult;

      try {
        const response = await replayCase(keys, goldenCase, variant);
        const durationMs = Date.now() - start;
        const scores = scoreContextEfficiency(
          goldenCase,
          response.toolCalls,
          response.text,
          response.tokenMetrics,
        );
        const pass = isContextEfficiencyPass(scores);

        result = {
          caseId: goldenCase.id,
          scenario: goldenCase.scenario,
          timestamp: new Date().toISOString(),
          durationMs,
          status: pass ? "pass" : "fail",
          model: response.modelVersion ?? DEFAULT_MODEL,
          promptVariant: variant,
          result: {
            toolCalls: response.toolCalls,
            text: response.text,
          },
          tokenMetrics: response.tokenMetrics,
          scores,
        };

        const statusColor = result.status === "pass" ? "\x1b[32m" : "\x1b[31m";
        console.log(
          `${statusColor}${result.status}\x1b[0m ` +
            `behav=${scores.behaviorPreservation.toFixed(2)} ` +
            `tokens=${scores.tokenReduction.toFixed(2)} ` +
            `plan=${scores.planAwareness.toFixed(2)} ` +
            `time=${scores.timeAwareness.toFixed(2)} ` +
            `comp=${scores.composite.toFixed(2)} ` +
            `(${response.tokenMetrics.totalInputTokens} tokens) ${durationMs}ms`,
        );
      } catch (err: any) {
        result = {
          caseId: goldenCase.id,
          scenario: goldenCase.scenario,
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - start,
          status: "error",
          model: DEFAULT_MODEL,
          promptVariant: variant,
          result: { toolCalls: [], text: null },
          scores: {
            behaviorPreservation: 0,
            tokenReduction: 0,
            planAwareness: 0,
            timeAwareness: 0,
            noRegression: 0,
            composite: 0,
          },
          error: err.message,
        };
        console.log(`\x1b[31merror\x1b[0m ${err.message.slice(0, 80)}`);
      }

      results.push(result);
      await appendFile(outputFile, JSON.stringify(result) + "\n");
    }
  }

  // Summary
  const baselineResults = results.filter((r) => r.promptVariant === "baseline");
  const optimizedResults = results.filter((r) => r.promptVariant === "optimized");

  const bPass = baselineResults.filter((r) => r.status === "pass").length;
  const oPass = optimizedResults.filter((r) => r.status === "pass").length;

  const bTokens = baselineResults.reduce(
    (s, r) => s + (r.tokenMetrics?.totalInputTokens ?? 0),
    0,
  );
  const oTokens = optimizedResults.reduce(
    (s, r) => s + (r.tokenMetrics?.totalInputTokens ?? 0),
    0,
  );

  console.log(`\n── Summary ──`);
  console.log(`Baseline:  ${bPass}/${baselineResults.length} passed, ${bTokens} total tokens`);
  console.log(`Optimized: ${oPass}/${optimizedResults.length} passed, ${oTokens} total tokens`);
  if (bTokens > 0) {
    const savings = ((bTokens - oTokens) / bTokens * 100).toFixed(1);
    console.log(`Token savings: ${savings}%`);
  }
  console.log(`Written to: ${outputFile}`);

  return results;
}

// ── Validation ───────────────────────────────────────────────────────

export function validateContextEfficiencyGoldenCases(): {
  valid: number;
  invalid: number;
} {
  const cases = readContextEfficiencyGoldenCases();
  let valid = 0;
  let invalid = 0;

  console.log(`\x1b[1mValidating ${cases.length} context-efficiency golden case(s)...\x1b[0m\n`);

  for (const c of cases) {
    const errors: string[] = [];

    if (!c.id) errors.push("missing id");
    if (!c.scenario) errors.push("missing scenario");
    if (!c.instruction) errors.push("missing instruction");
    if (!c.expected?.expectedTool) errors.push("missing expected.expectedTool");
    if (!c.elements || c.elements.length === 0) errors.push("no elements");
    if (!c.snapshot?.url) errors.push("missing snapshot.url");

    // Scenario-specific validation
    if (c.scenario === "observation_masking" && (!c.priorHistory || c.priorHistory.length === 0)) {
      errors.push("observation_masking scenario requires priorHistory");
    }
    if (c.scenario === "plan_persistence" && !c.planStatus) {
      errors.push("plan_persistence scenario requires planStatus");
    }
    if (c.scenario === "time_awareness" && !c.turnContext) {
      errors.push("time_awareness scenario requires turnContext");
    }

    if (errors.length === 0) {
      valid++;
      const altCount = c.expected.acceptAlternatives?.length ?? 0;
      const historyCount = c.priorHistory?.length ?? 0;
      console.log(
        `  \x1b[32mVALID\x1b[0m   ${c.id} (${c.scenario}, ${c.difficulty}, ` +
          `tool: ${c.expected.expectedTool}${altCount > 0 ? ` +${altCount} alt` : ""}, ` +
          `${historyCount} prior turns)`,
      );
    } else {
      invalid++;
      console.log(`  \x1b[31mINVALID\x1b[0m ${c.id}: ${errors.join(", ")}`);
    }
  }

  console.log(`\n\x1b[1mValidation: ${valid} valid, ${invalid} invalid\x1b[0m`);
  return { valid, invalid };
}
