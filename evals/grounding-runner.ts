/**
 * Grounding eval runner.
 *
 * Single-phase eval: the executor model receives a snapshot + instruction
 * and should demonstrate grounded behavior (observe before acting, detect
 * mismatches, avoid traps, try novel strategies).
 */

import { existsSync, mkdirSync, readFileSync } from "fs";
import { appendFile } from "fs/promises";
import { join } from "path";
import type { GroundingGoldenCase, GroundingEvalResult } from "./grounding-types";
import { readGroundingGoldenCases, GROUNDING_RESULTS_DIR, type ApiKeys } from "./utils";
import { scoreGrounding, isGroundingPass } from "./grounding-scorer";
import { judgeGroundingCase } from "./grounding-judge";
import { formatSnapshotElements } from "../src/background/agent/context";
import { getPromptTemplate } from "../src/prompts";
import { recoverToolCallsFromText } from "../src/background/agent/tool-recovery";
import { detectInstructionContradiction } from "../src/background/agent/loop-helpers";
import type { TaggedElement, DomSnapshot } from "../src/types";

export type GroundingProvider = "groq" | "openrouter";

const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";
const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";

const MODEL_OPENROUTER = "openai/gpt-oss-120b";
const MODEL_GROQ = "openai/gpt-oss-120b";

const TOOL_DEFS_PATH = join("evals", "tool-definitions.json");

function loadToolDefinitions(): any[] {
  if (!existsSync(TOOL_DEFS_PATH)) {
    console.warn(`Warning: ${TOOL_DEFS_PATH} not found.`);
    return [];
  }
  return JSON.parse(readFileSync(TOOL_DEFS_PATH, "utf-8"));
}

// ── System prompt construction ───────────────────────────────────────

function buildGroundingSystemPrompt(goldenCase: GroundingGoldenCase): string {
  const template = getPromptTemplate("agent.system");
  const elements = goldenCase.elements as unknown as TaggedElement[];
  const elementList = formatSnapshotElements(elements);
  const snap = goldenCase.snapshot;

  // Replicate the production grounding check (first-turn injection from context.ts)
  let groundingBlock = "## Grounding Check — First-Turn Protocol\n";

  // Run contradiction detection against a synthesized snapshot
  const synthSnapshot: Partial<DomSnapshot> = {
    url: snap.url,
    title: snap.title,
    pageContent: goldenCase.pageContent ?? undefined,
    elements: [],
  };
  const contradiction = detectInstructionContradiction(
    goldenCase.instruction,
    synthSnapshot as DomSnapshot,
  );
  if (contradiction?.mismatch) {
    groundingBlock +=
      `⚠ CONTRADICTION DETECTED: ${contradiction.details}\n` +
      "You MUST call clarify() to resolve this mismatch before taking any other action. Do NOT proceed with the instruction as given.\n\n";
  }

  groundingBlock +=
    "Your FIRST tool call this turn MUST be an observation tool: read_page, find_element, or read_element.\n" +
    "Do NOT call click_element, type_text, scroll_page, or any action tool until you have observed the page.\n" +
    "Even though elements and content are shown above, verify the page state matches your task before acting.\n";

  let prompt =
    template +
    "\n\n" +
    groundingBlock +
    "\n## Page Context\n\n" +
    `URL: ${snap.url}\n` +
    `Title: ${snap.title}\n` +
    `Scroll: ${snap.scrollY}px\n` +
    `Elements: ${snap.elementCount}\n\n` +
    "### Interactive Elements\n\n" +
    elementList;

  // Include page content — crucial for mismatch detection
  if (goldenCase.pageContent) {
    prompt += "\n\n### Visible Page Content\n\n" + goldenCase.pageContent;
  }

  return prompt;
}

// ── Message construction ─────────────────────────────────────────────

function buildGroundingMessages(goldenCase: GroundingGoldenCase): any[] {
  const messages: any[] = [
    { role: "system", content: buildGroundingSystemPrompt(goldenCase) },
    { role: "user", content: goldenCase.instruction },
  ];

  // Inject prior history as alternating assistant tool_call + tool result messages
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

export async function replayGroundingCase(
  keys: ApiKeys,
  goldenCase: GroundingGoldenCase,
  provider: GroundingProvider,
): Promise<{
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
  text: string | null;
  modelVersion?: string;
  durationMs: number;
}> {
  const useGroq = provider === "groq" && !!keys.groq;
  const model = useGroq ? MODEL_GROQ : MODEL_OPENROUTER;
  const apiUrl = useGroq ? GROQ_API : OPENROUTER_API;

  const messages = buildGroundingMessages(goldenCase);
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
    headers["X-Title"] = "OpenSidebar Grounding Evals";
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
    throw new Error(`Grounding API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await response.json()) as any;
  const choice = data.choices?.[0];
  if (!choice) throw new Error("No response choice in grounding phase");
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

export async function runGroundingEvals(options: {
  keys: ApiKeys;
  provider?: GroundingProvider;
  judge?: boolean;
  scenarioFilter?: string;
}): Promise<GroundingEvalResult[]> {
  const { keys, judge = false } = options;
  const provider = options.provider ?? (keys.groq ? "groq" : "openrouter");

  let cases = readGroundingGoldenCases();
  if (cases.length === 0) {
    console.log("No grounding golden cases found in evals/golden/grounding/");
    return [];
  }

  if (options.scenarioFilter) {
    cases = cases.filter((c) => c.scenario === options.scenarioFilter);
  }

  if (!existsSync(GROUNDING_RESULTS_DIR)) {
    mkdirSync(GROUNDING_RESULTS_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputFile = join(GROUNDING_RESULTS_DIR, `grounding-${timestamp}.jsonl`);
  const modelLabel = provider === "groq" ? MODEL_GROQ : MODEL_OPENROUTER;

  const results: GroundingEvalResult[] = [];

  console.log(
    `Running ${cases.length} grounding case(s) [provider: ${provider}]...\n`,
  );

  for (let i = 0; i < cases.length; i++) {
    const goldenCase = cases[i];
    process.stdout.write(
      `  [${i + 1}/${cases.length}] ${goldenCase.id} (${goldenCase.scenario}) ... `,
    );

    const start = Date.now();
    let result: GroundingEvalResult;

    try {
      const response = await replayGroundingCase(keys, goldenCase, provider);

      const durationMs = Date.now() - start;

      const scores = scoreGrounding(goldenCase, response.toolCalls, response.text);
      const pass = isGroundingPass(scores);

      result = {
        caseId: goldenCase.id,
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
      };

      // Run LLM judge if enabled
      if (judge) {
        try {
          result.judge = await judgeGroundingCase(
            keys.openrouter,
            goldenCase,
            response,
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
          `mis=${scores.mismatchDetection.toFixed(2)} obs=${scores.observeFirst.toFixed(2)} ` +
          `trap=${scores.trapAvoidance.toFixed(2)} nov=${scores.strategyNovelty.toFixed(2)} ` +
          `tool=${scores.toolCorrectness.toFixed(2)} comp=${scores.composite.toFixed(2)} ${durationMs}ms`,
      );
    } catch (err: any) {
      result = {
        caseId: goldenCase.id,
        scenario: goldenCase.scenario,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - start,
        status: "error",
        model: modelLabel,
        result: { toolCalls: [], text: null },
        scores: {
          mismatchDetection: 0,
          observeFirst: 0,
          trapAvoidance: 0,
          strategyNovelty: 0,
          toolCorrectness: 0,
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
