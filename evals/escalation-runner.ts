/**
 * Escalation eval runner.
 *
 * Two-phase eval per golden case:
 * Phase 1 (Trigger): Executor model sees stagnant history → should call `escalate`
 * Phase 2 (Recovery): Planner model sees distilled trajectory + escalation reflection → should pick recovery tool
 *
 * Each phase is a single LLM call.
 */

import { existsSync, mkdirSync, readFileSync } from "fs";
import { appendFile } from "fs/promises";
import { join } from "path";
import type { EscalationGoldenCase, EscalationEvalResult } from "./escalation-types";
import { readEscalationGoldenCases, ESCALATION_RESULTS_DIR, type ApiKeys } from "./utils";
import { scoreEscalation, isEscalationPass } from "./escalation-scorer";
import { judgeEscalationCase } from "./escalation-judge";
import { formatSnapshotElements } from "../src/background/agent/context";
import { getPromptTemplate, renderPrompt } from "../src/prompts";
import { recoverToolCallsFromText } from "../src/background/agent/tool-recovery";
import type { TaggedElement } from "../src/types";

export type PlannerModel = "deepseek" | "deepseek-base";

const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";
const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";

const FAST_MODEL_OPENROUTER = "openai/gpt-oss-120b";
const FAST_MODEL_GROQ = "openai/gpt-oss-120b";
const PLANNER_MODEL_DEEPSEEK = "deepseek/deepseek-v3.2";
const PLANNER_MODEL_DEEPSEEK_BASE = "deepseek/deepseek-v3.2";

const TOOL_DEFS_PATH = join("evals", "tool-definitions.json");

function loadToolDefinitions(): any[] {
  if (!existsSync(TOOL_DEFS_PATH)) {
    console.warn(`Warning: ${TOOL_DEFS_PATH} not found.`);
    return [];
  }
  return JSON.parse(readFileSync(TOOL_DEFS_PATH, "utf-8"));
}

// ── Phase 1: Executor model — should escalate ────────────────────────

function buildFastSystemPrompt(goldenCase: EscalationGoldenCase): string {
  const template = getPromptTemplate("agent.system");
  const elements = goldenCase.fastPhase.elements as unknown as TaggedElement[];
  const elementList = formatSnapshotElements(elements);
  const snap = goldenCase.fastPhase.snapshot;

  return (
    template +
    "\n\n## Page Context\n\n" +
    `URL: ${snap.url}\n` +
    `Title: ${snap.title}\n` +
    `Scroll: ${snap.scrollY}px\n` +
    `Elements: ${snap.elementCount}\n\n` +
    "### Interactive Elements\n\n" +
    elementList
  );
}

/**
 * Stagnation nudge injected after the stagnant history.
 * Mirrors production behavior: the stagnation monitor detects no DOM progress
 * and injects a user-role message telling the agent it's stuck.
 * In production this triggers escalateModel() — here we test if the model
 * voluntarily calls the `escalate` tool when nudged.
 */
const STAGNATION_NUDGE =
  "STAGNATION DETECTED — No DOM progress for multiple turns. " +
  "You have exhausted your available approaches at this capability tier.\n\n" +
  "REQUIRED ACTION: Call the `escalate` tool now. Provide a `reason` describing " +
  "what you tried and why it failed. The reasoning model will take over with " +
  "deeper analysis capabilities.\n\n" +
  "Do NOT attempt another action — you must escalate.";

function buildFastMessages(goldenCase: EscalationGoldenCase): any[] {
  const messages: any[] = [
    { role: "system", content: buildFastSystemPrompt(goldenCase) },
    { role: "user", content: goldenCase.fastPhase.objective },
  ];

  // Inject stagnant history as alternating assistant tool_call + tool result messages
  for (let i = 0; i < goldenCase.fastPhase.stagnantHistory.length; i++) {
    const h = goldenCase.fastPhase.stagnantHistory[i];
    const callId = `stagnant-tc-${i}`;

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

  // Inject stagnation nudge — mirrors the production stagnation monitor's behavior
  messages.push({
    role: "user",
    content: STAGNATION_NUDGE,
  });

  return messages;
}

/**
 * Replay Phase 1: Executor model should recognize stagnation and call escalate.
 */
export async function replayFastPhase(
  keys: ApiKeys,
  goldenCase: EscalationGoldenCase,
  provider: "groq" | "openrouter",
): Promise<{
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
  text: string | null;
  modelVersion?: string;
  durationMs: number;
}> {
  const useGroq = provider === "groq" && !!keys.groq;
  const model = useGroq ? FAST_MODEL_GROQ : FAST_MODEL_OPENROUTER;
  const apiUrl = useGroq ? GROQ_API : OPENROUTER_API;

  const messages = buildFastMessages(goldenCase);
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
    headers["X-Title"] = "OpenSidebar Escalation Evals";
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
    throw new Error(`Executor phase API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await response.json()) as any;
  const choice = data.choices?.[0];
  if (!choice) throw new Error("No response choice in executor phase");
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

// ── Phase 2: Planner model — should recover ──────────────────────────

function buildSmartSystemPrompt(goldenCase: EscalationGoldenCase): string {
  const template = getPromptTemplate("agent.system");
  const elements = goldenCase.smartPhase.elements as unknown as TaggedElement[];
  const elementList = formatSnapshotElements(elements);
  const snap = goldenCase.smartPhase.snapshot;

  return (
    template +
    "\n\n## Page Context\n\n" +
    `URL: ${snap.url}\n` +
    `Title: ${snap.title}\n` +
    `Scroll: ${snap.scrollY}px\n` +
    `Elements: ${snap.elementCount}\n\n` +
    "### Interactive Elements\n\n" +
    elementList
  );
}

function buildSmartMessages(goldenCase: EscalationGoldenCase): any[] {
  // Build distilled trajectory from stagnant history (matches summarizeHistory format)
  const trajectoryEntries = goldenCase.fastPhase.stagnantHistory.map((h, i) => {
    const isFailure =
      h.result.startsWith("Error:") ||
      h.result.includes("Click intercepted") ||
      h.result.includes("No element with tag") ||
      h.result.includes("does not appear to be");

    let argSnippet = "";
    const parts: string[] = [];
    if (h.args.id != null) parts.push(`[${h.args.id}]`);
    if (h.args.text) parts.push(`"${String(h.args.text).slice(0, 30)}"`);
    if (h.args.url) parts.push(String(h.args.url).slice(0, 40));
    if (h.args.direction) parts.push(String(h.args.direction));
    argSnippet = parts.join(" ");

    const outcome = h.result.split("\n")[0].slice(0, isFailure ? 160 : 80);
    return `${isFailure ? "\u26A0 " : ""}T${i + 1}: ${h.tool} ${argSnippet} → ${outcome}`;
  });

  const trajectoryText =
    `ATTEMPT LOG (${trajectoryEntries.length} actions):\n` +
    trajectoryEntries.join("\n");

  // Escalation reflection prompt
  const escalationReflection = renderPrompt("agent.reflection.escalation", {
    escalationReason: goldenCase.smartPhase.escalationReason,
  });

  return [
    { role: "system", content: buildSmartSystemPrompt(goldenCase) },
    { role: "user", content: trajectoryText },
    { role: "user", content: escalationReflection },
  ];
}

/**
 * Replay Phase 2: Planner model should recover using distilled context.
 */
export async function replaySmartPhase(
  keys: ApiKeys,
  goldenCase: EscalationGoldenCase,
  plannerModel: PlannerModel,
): Promise<{
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
  text: string | null;
  modelVersion?: string;
  durationMs: number;
}> {
  const model = plannerModel === "deepseek" ? PLANNER_MODEL_DEEPSEEK : PLANNER_MODEL_DEEPSEEK_BASE;

  const messages = buildSmartMessages(goldenCase);
  const tools = loadToolDefinitions();

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: 4096,
    temperature: 0,
  };

  // DeepSeek Speciale uses mandatory think tags — no extra reasoning param needed

  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${keys.openrouter}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://opensidebar.dev",
    "X-Title": "OpenSidebar Escalation Evals",
  };

  const timeout = 120_000;
  const start = Date.now();
  const response = await fetch(OPENROUTER_API, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Planner phase API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await response.json()) as any;
  const choice = data.choices?.[0];
  if (!choice) throw new Error("No response choice in planner phase");
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

export async function runEscalationEvals(options: {
  keys: ApiKeys;
  plannerModel?: PlannerModel;
  fastProvider?: "groq" | "openrouter";
  judge?: boolean;
  scenarioFilter?: string;
}): Promise<EscalationEvalResult[]> {
  const { keys, judge = false } = options;
  const plannerModel = options.plannerModel ?? "deepseek";
  const fastProvider = options.fastProvider ?? (keys.groq ? "groq" : "openrouter");

  let cases = readEscalationGoldenCases();
  if (cases.length === 0) {
    console.log("No escalation golden cases found in evals/golden/escalation/");
    return [];
  }

  if (options.scenarioFilter) {
    cases = cases.filter((c) => c.scenario === options.scenarioFilter);
  }

  if (!existsSync(ESCALATION_RESULTS_DIR)) {
    mkdirSync(ESCALATION_RESULTS_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputFile = join(ESCALATION_RESULTS_DIR, `escalation-${timestamp}.jsonl`);
  const plannerModelLabel = "deepseek-v3.2";

  const results: EscalationEvalResult[] = [];

  console.log(
    `Running ${cases.length} escalation case(s) [executor: ${fastProvider}, planner: ${plannerModelLabel}]...\n`,
  );

  for (let i = 0; i < cases.length; i++) {
    const goldenCase = cases[i];
    process.stdout.write(
      `  [${i + 1}/${cases.length}] ${goldenCase.id} (${goldenCase.scenario}) ... `,
    );

    const start = Date.now();
    let result: EscalationEvalResult;

    try {
      // Phase 1: Executor model
      const fastResult = await replayFastPhase(keys, goldenCase, fastProvider);

      // Phase 2: Planner model
      const smartResult = await replaySmartPhase(keys, goldenCase, plannerModel);

      const durationMs = Date.now() - start;

      const scores = scoreEscalation(
        goldenCase,
        fastResult.toolCalls,
        smartResult.toolCalls,
        fastResult.text,
      );
      const pass = isEscalationPass(scores);

      result = {
        caseId: goldenCase.id,
        scenario: goldenCase.scenario,
        timestamp: new Date().toISOString(),
        durationMs,
        status: pass ? "pass" : "fail",
        plannerModel: plannerModelLabel,
        fastPhaseResult: {
          toolCalls: fastResult.toolCalls,
          text: fastResult.text,
          modelVersion: fastResult.modelVersion,
        },
        smartPhaseResult: {
          toolCalls: smartResult.toolCalls,
          text: smartResult.text,
          modelVersion: smartResult.modelVersion,
        },
        scores,
      };

      // Run LLM judge if enabled
      if (judge) {
        try {
          result.judge = await judgeEscalationCase(
            keys.openrouter,
            goldenCase,
            fastResult,
            smartResult,
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
          `esc=${scores.escalationTriggered.toFixed(2)} rsn=${scores.reasonQuality.toFixed(2)} ` +
          `tool=${scores.toolMatch.toFixed(2)} args=${scores.argsMatch.toFixed(2)} ` +
          `inv=${scores.investigationQuality.toFixed(2)} comp=${scores.composite.toFixed(2)} ${durationMs}ms`,
      );
    } catch (err: any) {
      result = {
        caseId: goldenCase.id,
        scenario: goldenCase.scenario,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - start,
        status: "error",
        plannerModel: plannerModelLabel,
        fastPhaseResult: { toolCalls: [], text: null },
        smartPhaseResult: { toolCalls: [], text: null },
        scores: {
          escalationTriggered: 0,
          reasonQuality: 0,
          toolMatch: 0,
          argsMatch: 0,
          investigationQuality: 0,
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
