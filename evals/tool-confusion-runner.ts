/**
 * Tool-confusion eval runner.
 *
 * Single-phase eval: the executor model receives a snapshot + instruction
 * and should pick the correct tool while avoiding confusable alternatives.
 */

import { existsSync, mkdirSync, readFileSync } from "fs";
import { appendFile } from "fs/promises";
import { join } from "path";
import type { ToolConfusionGoldenCase, ToolConfusionEvalResult } from "./tool-confusion-types";
import { readToolConfusionGoldenCases, TOOL_CONFUSION_RESULTS_DIR, type ApiKeys } from "./utils";
import { scoreToolConfusion, isToolConfusionPass } from "./tool-confusion-scorer";
import { judgeToolConfusionCase } from "./tool-confusion-judge";
import { formatSnapshotElements } from "../src/background/agent/context";
import { getPromptTemplate } from "../src/prompts";
import { recoverToolCallsFromText } from "../src/background/agent/tool-recovery";
import type { TaggedElement } from "../src/types";

export type ToolConfusionProvider = "openrouter";

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

function buildToolConfusionSystemPrompt(goldenCase: ToolConfusionGoldenCase): string {
  const template = getPromptTemplate("agent.system");
  const elements = goldenCase.elements as unknown as TaggedElement[];
  const elementList = formatSnapshotElements(elements);
  const snap = goldenCase.snapshot;

  let prompt =
    template +
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

function buildToolConfusionMessages(goldenCase: ToolConfusionGoldenCase): any[] {
  const messages: any[] = [
    { role: "system", content: buildToolConfusionSystemPrompt(goldenCase) },
    { role: "user", content: goldenCase.instruction },
  ];

  if (goldenCase.priorHistory && goldenCase.priorHistory.length > 0) {
    for (let i = 0; i < goldenCase.priorHistory.length; i++) {
      const h = goldenCase.priorHistory[i];
      const callId = `prior-tc-${i}`;

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
  }

  return messages;
}

// ── API call ─────────────────────────────────────────────────────────

export async function replayToolConfusionCase(
  keys: ApiKeys,
  goldenCase: ToolConfusionGoldenCase,
  _provider: ToolConfusionProvider,
): Promise<{
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
  text: string | null;
  modelVersion?: string;
  durationMs: number;
}> {
  const model = DEFAULT_MODEL;
  const messages = buildToolConfusionMessages(goldenCase);

  let tools = loadToolDefinitions();

  // If toolSubset is specified, filter to only those tools
  if (goldenCase.toolSubset && goldenCase.toolSubset.length > 0) {
    const subset = new Set(goldenCase.toolSubset);
    tools = tools.filter((t: any) => subset.has(t.function?.name));
  }

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
    "X-Title": "OpenSidebar Tool-Confusion Evals",
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
    throw new Error(`Tool-confusion API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await response.json()) as any;
  const choice = data.choices?.[0];
  if (!choice) throw new Error("No response choice in tool-confusion phase");
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

export async function runToolConfusionEvals(options: {
  keys: ApiKeys;
  provider?: ToolConfusionProvider;
  judge?: boolean;
  pairFilter?: string;
}): Promise<ToolConfusionEvalResult[]> {
  const { keys, judge = false } = options;
  const provider = options.provider ?? "openrouter";

  let cases = readToolConfusionGoldenCases();
  if (cases.length === 0) {
    console.log("No tool-confusion golden cases found in evals/golden/tool-confusion/");
    return [];
  }

  if (options.pairFilter) {
    cases = cases.filter((c) => c.confusionPair.label === options.pairFilter);
  }

  if (!existsSync(TOOL_CONFUSION_RESULTS_DIR)) {
    mkdirSync(TOOL_CONFUSION_RESULTS_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputFile = join(TOOL_CONFUSION_RESULTS_DIR, `tool-confusion-${timestamp}.jsonl`);
  const modelLabel = DEFAULT_MODEL;

  const results: ToolConfusionEvalResult[] = [];

  console.log(
    `Running ${cases.length} tool-confusion case(s) [provider: ${provider}]...\n`,
  );

  for (let i = 0; i < cases.length; i++) {
    const goldenCase = cases[i];
    process.stdout.write(
      `  [${i + 1}/${cases.length}] ${goldenCase.id} (${goldenCase.confusionPair.label}) ... `,
    );

    const start = Date.now();
    let result: ToolConfusionEvalResult;

    try {
      const response = await replayToolConfusionCase(keys, goldenCase, provider);
      const durationMs = Date.now() - start;

      // Run judge first if enabled, to get reasoning score
      let judgeResult = undefined;
      let reasoningScore: number | undefined;
      if (judge) {
        try {
          judgeResult = await judgeToolConfusionCase(keys.openrouter, goldenCase, response);
          // Normalize judge reasoning to 0-1 scale (judge scores 1-5)
          reasoningScore = (judgeResult.contextualReasoning - 1) / 4;
        } catch (err: any) {
          console.warn(`judge error: ${err.message}`);
        }
      }

      const scores = scoreToolConfusion(goldenCase, response.toolCalls, response.text, reasoningScore);
      const pass = isToolConfusionPass(scores);

      result = {
        caseId: goldenCase.id,
        confusionPair: goldenCase.confusionPair.label,
        scenario: goldenCase.scenario,
        timestamp: new Date().toISOString(),
        durationMs,
        status: pass ? "pass" : "fail",
        model: response.modelVersion ?? modelLabel,
        result: {
          toolCalls: response.toolCalls,
          text: response.text,
        },
        scores,
        judge: judgeResult,
      };

      // Allow judge to override status
      if (judgeResult?.pass && result.status === "fail") {
        result.status = "pass";
      }

      const statusColor = result.status === "pass" ? "\x1b[32m" : "\x1b[31m";
      console.log(
        `${statusColor}${result.status}\x1b[0m ` +
          `correct=${scores.correctToolPicked.toFixed(2)} anti=${scores.avoidedAntiPattern.toFixed(2)} ` +
          `params=${scores.parameterCorrectness.toFixed(2)} reason=${scores.reasoningQuality.toFixed(2)} ` +
          `comp=${scores.composite.toFixed(2)} ${durationMs}ms`,
      );
    } catch (err: any) {
      result = {
        caseId: goldenCase.id,
        confusionPair: goldenCase.confusionPair.label,
        scenario: goldenCase.scenario,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - start,
        status: "error",
        model: modelLabel,
        result: { toolCalls: [], text: null },
        scores: {
          correctToolPicked: 0,
          avoidedAntiPattern: 0,
          parameterCorrectness: 0,
          reasoningQuality: 0,
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
