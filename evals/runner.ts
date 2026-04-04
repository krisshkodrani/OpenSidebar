/**
 * Offline eval runner.
 * Replays eval cases against the LLM without a browser.
 */

import { existsSync, mkdirSync, readFileSync } from "fs";
import { appendFile, writeFile } from "fs/promises";
import { join } from "path";
import { createHash, randomUUID } from "crypto";
import type { EvalCase, EvalResult } from "./types";
import { readEvalCases, RESULTS_DIR, loadApiKeys, type ApiKeys } from "./utils";
import { scoreToolNameMatch, scoreToolParamMatch, scoreSequenceMatch } from "./scorer";
import { judgeCase } from "./judge";
import { RunManifest, RunPromptRef, RunTraceWriter } from "../src/utils/run-trace";
import { recoverToolCallsFromText } from "../src/background/agent/tool-recovery";
import { ToolName, type ToolDefinition } from "../src/types";
import type { LLMMessage } from "../src/background/llm/types";

const TOOL_DEFS_PATH = join("evals", "tool-definitions.json");

/** Load the static tool definitions extracted from the registry. */
function loadToolDefinitions(): any[] {
  if (!existsSync(TOOL_DEFS_PATH)) {
    console.warn(`Warning: ${TOOL_DEFS_PATH} not found. Run: npx tsx scripts/extract-tool-defs.ts`);
    return [];
  }
  return JSON.parse(readFileSync(TOOL_DEFS_PATH, "utf-8"));
}

const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";
const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";

export type EvalProvider = "openrouter" | "groq";

/** Sanitize messages for strict APIs (Groq requires type:"function" on tool_calls) */
function sanitizeMessagesForProvider(
  messages: LLMMessage[],
  provider: EvalProvider | undefined,
): LLMMessage[] {
  if (provider !== "groq") return messages;
  return messages.map((msg) => {
    if (msg.role !== "assistant" || !msg.tool_calls) return msg;
    return {
      ...msg,
      tool_calls: msg.tool_calls.map((tc: any) => ({
        type: "function",
        ...tc,
      })),
    };
  });
}
export type EvalReplayMode = "single" | "recovery";

const PAGE_CONTEXT_MARKER = "## Page Context";
const RECOVERY_MAX_TURNS = 3;
const RECOVERY_REPEAT_WINDOW = 20;
const RECOVERY_REPEAT_EXEMPT_TOOLS = new Set<string>([
  ToolName.DISMISS_OVERLAYS,
  ToolName.DONE,
  ToolName.ESCALATE,
  ToolName.READ_PAGE,
  ToolName.SCROLL_PAGE,
]);

interface ReplayOutput {
  toolCalls: { toolName: string; args: Record<string, unknown> }[];
  text: string | null;
  modelVersion?: string;
  recovery?: {
    attemptedTurns: number;
    recovered: boolean;
    firstTurnToolCalls: { toolName: string; args: Record<string, unknown> }[];
    finalTurnToolCalls: { toolName: string; args: Record<string, unknown> }[];
    interventions: string[];
  };
}

export interface VisibleElementLite {
  tag: number;
  tagName: string;
  text: string;
}

export interface SeededToolCall {
  toolName: string;
  argsKey: string;
}

export interface ReplayContextSignals {
  visibleElements: VisibleElementLite[];
  repeatedCalls: SeededToolCall[];
  historicalToolCallCount: number;
  hasStagnationWarning: boolean;
  hasSameUrlEscalation: boolean;
  objectiveHint: string;
  systemPrompt: string;
  recentTypedText: string | null;
}

/**
 * Run eval cases and return results.
 */
export async function runEvals(options: {
  caseId?: string;
  all?: boolean;
  judge?: boolean;
  model?: string;
  promptOverride?: string;
  promptVariant?: string;
  promptRef?: RunPromptRef;
  keys?: ApiKeys;
  provider?: EvalProvider;
  replayMode?: EvalReplayMode;
}): Promise<EvalResult[]> {
  const keys = options.keys ?? loadApiKeys();
  const provider = options.provider ?? "openrouter";
  let cases = readEvalCases();

  if (cases.length === 0) {
    console.log("No eval cases found. Run 'evals convert <session-id>' first.");
    return [];
  }

  if (options.caseId) {
    cases = cases.filter((c) => c.id === options.caseId || c.id.startsWith(options.caseId!));
    if (cases.length === 0) {
      console.error(`No case found matching: ${options.caseId}`);
      return [];
    }
  }

  if (!existsSync(RESULTS_DIR)) {
    mkdirSync(RESULTS_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputFile = join(RESULTS_DIR, `run-${timestamp}.jsonl`);
  const traceFile = join(RESULTS_DIR, `run-${timestamp}.trace.jsonl`);
  const manifestFile = join(RESULTS_DIR, `run-${timestamp}.manifest.json`);
  const runId = randomUUID();
  const results: EvalResult[] = [];
  const traceWriter = new RunTraceWriter(async (record) => {
    await appendFile(traceFile, JSON.stringify(record) + "\n");
  });

  const promptText = options.promptOverride || "";
  const promptHash = promptText
    ? createHash("sha256").update(promptText).digest("hex").slice(0, 16)
    : "runtime-default";
  const promptSet = options.promptRef
    ? [options.promptRef]
    : [
        {
          id: "eval.system",
          version: options.promptVariant || "default",
          hash: promptHash,
        },
      ];
  const manifest: RunManifest = {
    runId,
    environment: "eval",
    startedAt: new Date().toISOString(),
    source: "evals.runner",
    promptSet,
    model: options.model,
    caseId: options.caseId,
  };
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2), "utf-8");
  await traceWriter.emitManifest(manifest);

  console.log(`Running ${cases.length} eval case(s)...\n`);

  for (let i = 0; i < cases.length; i++) {
    const evalCase = cases[i];
    const model = options.model || evalCase.input.model;
    await traceWriter.emitEvent({
      runId,
      type: "eval_case_started",
      role: "system",
      turn: evalCase.sourceTurn,
      data: {
        caseId: evalCase.id,
        strategy: evalCase.strategy,
        sourceSessionId: evalCase.sourceSessionId,
        promptVariant: options.promptVariant || "default",
      },
    });
    process.stdout.write(`  [${i + 1}/${cases.length}] ${evalCase.strategy} T${evalCase.sourceTurn} `);

    const start = Date.now();
    let result: EvalResult;

    try {
      const actual = await replayCase(
        keys,
        evalCase,
        model,
        options.promptOverride,
        provider,
        options.replayMode ?? "single",
      );
      const durationMs = Date.now() - start;

      const expectedToolCalls = evalCase.expected.toolCalls.map((tc) => ({
        toolName: tc.toolName as string,
        args: tc.args,
      }));

      const toolNameScore = scoreToolNameMatch(expectedToolCalls, actual.toolCalls);
      const toolParamScore = scoreToolParamMatch(expectedToolCalls, actual.toolCalls);
      const sequenceScore = scoreSequenceMatch(expectedToolCalls, actual.toolCalls);
      const pass = toolNameScore >= 0.8 && sequenceScore >= 0.7;
      const composite = computeCompositeScore(toolNameScore, toolParamScore, sequenceScore);

      result = {
        caseId: evalCase.id,
        timestamp: new Date().toISOString(),
        durationMs,
        status: pass ? "pass" : "fail",
        promptVariant: options.promptVariant,
        modelVersion: actual.modelVersion,
        actual,
        scores: {
          toolNameMatch: toolNameScore,
          toolParamMatch: toolParamScore,
          sequenceMatch: sequenceScore,
          composite,
        },
      };

      // Run LLM-as-judge for failed cases if enabled
      if (!pass && options.judge) {
        try {
          result.scores.judge = await judgeCase(keys.openrouter, evalCase, actual);
          // Judge can override status
          if (result.scores.judge.pass) {
            result.status = "pass";
          }
        } catch (err: any) {
          console.warn(`  judge error: ${err.message}`);
        }
      }

      const statusColor = result.status === "pass" ? "\x1b[32m" : "\x1b[31m";
      console.log(
        `${statusColor}${result.status}\x1b[0m ` +
        `names=${toolNameScore.toFixed(2)} params=${toolParamScore.toFixed(2)} seq=${sequenceScore.toFixed(2)} ` +
        `${durationMs}ms`,
      );
      await traceWriter.emitEvent({
        runId,
        type: "eval_case_completed",
        role: "system",
        turn: evalCase.sourceTurn,
        data: {
          caseId: evalCase.id,
          status: result.status,
          model,
          scores: result.scores,
          durationMs,
          promptVariant: options.promptVariant || "default",
        },
      });
    } catch (err: any) {
      const durationMs = Date.now() - start;
      result = {
        caseId: evalCase.id,
        timestamp: new Date().toISOString(),
        durationMs,
        status: "error",
        promptVariant: options.promptVariant,
        actual: { toolCalls: [], text: null },
        scores: { toolNameMatch: 0, toolParamMatch: 0, sequenceMatch: 0 },
        error: err.message,
      };
      console.log(`\x1b[31merror\x1b[0m ${err.message}`);
      await traceWriter.emitEvent({
        runId,
        type: "eval_case_error",
        role: "system",
        turn: evalCase.sourceTurn,
        data: {
          caseId: evalCase.id,
          error: err.message,
          durationMs,
          promptVariant: options.promptVariant || "default",
        },
      });
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
  console.log(`Trace events: ${traceFile}`);
  console.log(`Run manifest: ${manifestFile}`);

  return results;
}

export async function replayCase(
  keys: ApiKeys,
  evalCase: EvalCase,
  model: string,
  promptOverride?: string,
  provider?: EvalProvider,
  replayMode: EvalReplayMode = "single",
): Promise<ReplayOutput> {
  const messages = evalCase.input.conversationHistory.length > 0
    ? evalCase.input.conversationHistory
    : [{ role: "user" as const, content: evalCase.metadata.query }];

  const resolvedMessages = applyPromptOverride(messages, promptOverride);

  if (replayMode === "recovery") {
    return replayCaseWithRecovery(
      keys,
      resolvedMessages,
      evalCase,
      model,
      provider,
      evalCase.input.tools.length > 0 ? evalCase.input.tools : loadToolDefinitions(),
    );
  }

  return replaySingleCase(
    keys,
    resolvedMessages,
    model,
    provider,
    evalCase.input.tools.length > 0 ? evalCase.input.tools : loadToolDefinitions(),
  );
}

async function replaySingleCase(
  keys: ApiKeys,
  resolvedMessages: EvalCase["input"]["conversationHistory"],
  model: string,
  provider: EvalProvider | undefined,
  tools: ToolDefinition[],
): Promise<ReplayOutput> {

  const sanitizedMessages = sanitizeMessagesForProvider(resolvedMessages, provider);

  const body: Record<string, unknown> = {
    model,
    messages: sanitizedMessages,
    max_tokens: 4096,
    temperature: 0,
  };

  // Use tools from the case if present, otherwise load from the static registry
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const useGroq = provider === "groq";
  const apiUrl = useGroq ? GROQ_API : OPENROUTER_API;
  const apiKey = useGroq ? keys.groq : keys.openrouter;
  if (!apiKey) {
    throw new Error(useGroq ? "GROQ_API_KEY not found in .env" : "OPENROUTER_API_KEY not found in .env");
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...(useGroq ? {} : { "HTTP-Referer": "https://opensidebar.dev", "X-Title": "OpenSidebar Evals" }),
  };

  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`LLM API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json() as any;
  const choice = data.choices?.[0];
  if (!choice) throw new Error("No response choice");
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

  return { toolCalls, text, modelVersion: responseModel };
}

function computeCompositeScore(
  toolNameMatch: number,
  toolParamMatch: number,
  sequenceMatch: number,
): number {
  return toolNameMatch * 0.45 + toolParamMatch * 0.25 + sequenceMatch * 0.3;
}

function applyPromptOverride(
  messages: EvalCase["input"]["conversationHistory"],
  promptOverride?: string,
): EvalCase["input"]["conversationHistory"] {
  if (!promptOverride) return messages;

  const clone = messages.map((m) => ({ ...m }));
  const firstSystemIdx = clone.findIndex((m) => m.role === "system");
  if (firstSystemIdx < 0) {
    return [{ role: "system", content: promptOverride }, ...clone];
  }

  const existing = clone[firstSystemIdx].content;
  if (typeof existing !== "string") {
    // Can't merge non-string content (null or ContentPart[])
    clone[firstSystemIdx].content = promptOverride;
    return clone;
  }
  const existingCtxIdx = existing.indexOf(PAGE_CONTEXT_MARKER);
  const overrideCtxIdx = promptOverride.indexOf(PAGE_CONTEXT_MARKER);

  if (existingCtxIdx !== -1 && overrideCtxIdx !== -1) {
    // Smart merge: new instructions + original page context
    clone[firstSystemIdx].content =
      promptOverride.slice(0, overrideCtxIdx) + existing.slice(existingCtxIdx);
  } else if (existingCtxIdx !== -1) {
    // Override is instructions-only (no page context section) — splice before page context
    clone[firstSystemIdx].content =
      promptOverride.trimEnd() + "\n\n" + existing.slice(existingCtxIdx);
  } else {
    // No page context marker in either — full replacement
    clone[firstSystemIdx].content = promptOverride;
  }

  return clone;
}

async function replayCaseWithRecovery(
  keys: ApiKeys,
  resolvedMessages: EvalCase["input"]["conversationHistory"],
  evalCase: EvalCase,
  model: string,
  provider: EvalProvider | undefined,
  tools: ToolDefinition[],
): Promise<ReplayOutput> {
  const messages: LLMMessage[] = resolvedMessages.map((m) => ({ ...m }));
  const signals = collectReplayContextSignals(messages);
  const repeatedCalls = signals.repeatedCalls;
  const visibleElements = signals.visibleElements;
  const historicalToolCallCount = signals.historicalToolCallCount;
  const interventions: string[] = [];
  let firstTurnToolCalls: ReplayOutput["toolCalls"] = [];
  let finalTurnToolCalls: ReplayOutput["toolCalls"] = [];
  let finalText: string | null = null;
  let modelVersion: string | undefined;
  let attemptedTurns = 0;
  let recovered = false;

  if (signals.hasStagnationWarning || historicalToolCallCount >= 15) {
    const turnBudget = Math.max(historicalToolCallCount, evalCase.sourceTurn);
    const reminder =
      `TURN BUDGET: You have already used about ${turnBudget} action turns on this objective. ` +
      `If the goal is already satisfied, call done(). Otherwise, if you are not making clear progress, ` +
      `call escalate({"reason": "Stuck after ${turnBudget} turns without completing the goal"}) now. Do not keep cycling.`;
    messages.push({ role: "user", content: reminder });
    interventions.push("turn_budget_reminder");
  }

  for (let turn = 0; turn < RECOVERY_MAX_TURNS; turn++) {
    attemptedTurns = turn + 1;
    const response = await replaySingleCase(keys, messages, model, provider, tools);
    modelVersion = response.modelVersion;
    finalText = response.text;
    finalTurnToolCalls = response.toolCalls;
    if (turn === 0) firstTurnToolCalls = response.toolCalls;

    const intervention = buildRecoveryIntervention(
      response.toolCalls,
      repeatedCalls,
      signals,
      turn,
    );

    if (!intervention) {
      break;
    }

    interventions.push(intervention.kind);
    recovered = true;

    if (intervention.forcedToolCalls && intervention.forcedToolCalls.length > 0) {
      finalTurnToolCalls = intervention.forcedToolCalls;
      finalText = null;
      break;
    }

    messages.push({
      role: "assistant",
      content: response.text,
      tool_calls: response.toolCalls.map((tc, idx) => ({
        id: `recovery-${turn}-${idx}`,
        type: "function",
        function: {
          name: tc.toolName,
          arguments: JSON.stringify(tc.args),
        },
      })),
    });

    for (let i = 0; i < response.toolCalls.length; i++) {
      const tc = response.toolCalls[i];
      if (!RECOVERY_REPEAT_EXEMPT_TOOLS.has(tc.toolName)) {
        repeatedCalls.push({
          toolName: tc.toolName,
          argsKey: JSON.stringify(tc.args),
        });
        if (repeatedCalls.length > RECOVERY_REPEAT_WINDOW) {
          repeatedCalls.shift();
        }
      }

      messages.push({
        role: "tool",
        tool_call_id: `recovery-${turn}-${i}`,
        content: intervention.message(tc),
      });
    }

    messages.push({
      role: "user",
      content: intervention.followUp,
    });
  }

  return {
    toolCalls: finalTurnToolCalls,
    text: finalText,
    modelVersion,
    recovery: {
      attemptedTurns,
      recovered,
      firstTurnToolCalls,
      finalTurnToolCalls,
      interventions,
    },
  };
}

export function collectReplayContextSignals(messages: LLMMessage[]): ReplayContextSignals {
  const systemPrompt = extractSystemPrompt(messages);
  const visibleElements = parseVisibleElementsFromMessages(messages);
  const repeatedCalls = seedRecentToolCalls(messages);
  const historicalToolCallCount = estimateHistoricalToolCallCount(messages, repeatedCalls.length);
  const hasStagnationWarning = messages.some(
    (msg) =>
      typeof msg.content === "string" &&
      msg.content.includes("[SYSTEM STAGNATION WARNING]"),
  );
  const hasSameUrlEscalation = messages.some(
    (msg) =>
      typeof msg.content === "string" &&
      msg.content.includes("SAME-URL ESCALATION:"),
  );
  const objectiveHint = extractObjectiveHint(messages);
  const recentTypedText = extractRecentTypedText(messages);
  return {
    visibleElements,
    repeatedCalls,
    historicalToolCallCount,
    hasStagnationWarning,
    hasSameUrlEscalation,
    objectiveHint,
    systemPrompt,
    recentTypedText,
  };
}

function extractSystemPrompt(messages: LLMMessage[]): string {
  const system = messages.find((m) => m.role === "system" && typeof m.content === "string");
  return typeof system?.content === "string" ? system.content : "";
}

function seedRecentToolCalls(messages: LLMMessage[]): SeededToolCall[] {
  const seeded: SeededToolCall[] = [];
  for (const msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const toolName = tc.function.name;
        if (RECOVERY_REPEAT_EXEMPT_TOOLS.has(toolName)) continue;
        let argsKey = tc.function.arguments;
        try {
          argsKey = JSON.stringify(JSON.parse(tc.function.arguments));
        } catch {
          // Keep raw string when arguments are not valid JSON.
        }
        seeded.push({
          toolName,
          argsKey,
        });
        if (seeded.length > RECOVERY_REPEAT_WINDOW) {
          seeded.shift();
        }
      }
    }

    if (typeof msg.content !== "string") continue;
    const distilledCalls = parseDistilledHistoryToolCalls(msg.content);
    for (const call of distilledCalls) {
      if (RECOVERY_REPEAT_EXEMPT_TOOLS.has(call.toolName)) continue;
      seeded.push(call);
      if (seeded.length > RECOVERY_REPEAT_WINDOW) {
        seeded.shift();
      }
    }
  }
  return seeded;
}

function parseDistilledHistoryToolCalls(content: string): SeededToolCall[] {
  const parsed: SeededToolCall[] = [];
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^T\d+:\s+([a-z_]+)(?:\s+\[(\d+)\])?(?:\s+"([^"]*)")?/i);
    if (!match) continue;
    const toolName = match[1];
    if (!toolName) continue;
    const args: Record<string, unknown> = {};
    if (match[2]) args.id = Number(match[2]);
    if (match[3]) {
      if (toolName === ToolName.TYPE_TEXT) {
        args.text = match[3];
      } else {
        args.searchText = match[3];
      }
    }
    parsed.push({ toolName, argsKey: JSON.stringify(args) });
  }
  return parsed;
}

function estimateHistoricalToolCallCount(messages: LLMMessage[], seededCount: number): number {
  let maxDistilled = 0;
  for (const msg of messages) {
    if (typeof msg.content !== "string") continue;
    const distilledMatch = msg.content.match(/\[DISTILLED HISTORY[^\]]*?(\d+)\s+actions\]/i);
    if (distilledMatch) {
      maxDistilled = Math.max(maxDistilled, Number(distilledMatch[1]));
    }
    const warningMatch = msg.content.match(/executing for\s+(\d+)\s+turns/i);
    if (warningMatch) {
      maxDistilled = Math.max(maxDistilled, Number(warningMatch[1]));
    }
  }
  return Math.max(seededCount, maxDistilled);
}

function extractObjectiveHint(messages: LLMMessage[]): string {
  for (const msg of messages) {
    if (typeof msg.content !== "string") continue;
    const match = msg.content.match(/Objective:\s*(.+)/i);
    if (match) return match[1].trim();
  }
  return "";
}

function extractRecentTypedText(messages: LLMMessage[]): string | null {
  let recent: string | null = null;

  for (const msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (tc.function.name !== ToolName.TYPE_TEXT) continue;
        try {
          const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          if (typeof args.text === "string" && args.text.trim()) {
            recent = args.text.trim();
          }
        } catch {
          // Ignore malformed arguments in replay history.
        }
      }
    }

    if (typeof msg.content !== "string") continue;
    const matches = Array.from(msg.content.matchAll(/T\d+:\s+type_text(?:\s+\[\d+\])?\s+"([^"]+)"/gi));
    for (const match of matches) {
      if (match[1]?.trim()) {
        recent = match[1].trim();
      }
    }
  }

  return recent;
}

function parseVisibleElementsFromMessages(messages: LLMMessage[]): VisibleElementLite[] {
  const system = messages.find((m) => m.role === "system" && typeof m.content === "string");
  if (!system || typeof system.content !== "string") return [];
  return parseVisibleElementsFromPrompt(system.content);
}

function parseVisibleElementsFromPrompt(prompt: string): VisibleElementLite[] {
  const start = prompt.indexOf("## Visible Elements");
  if (start === -1) return [];
  const after = prompt.slice(start);
  const nextHeaderIdx = after.indexOf("\n## ", 1);
  const section = nextHeaderIdx === -1 ? after : after.slice(0, nextHeaderIdx);
  const lines = section.split(/\r?\n/);
  const elements: VisibleElementLite[] = [];
  for (const line of lines) {
    const match = line.match(/^\[(\d+)\]\s+([a-zA-Z0-9_-]+)/);
    if (!match) continue;
    const quotedValues = Array.from(line.matchAll(/"([^"]*)"/g));
    const text = quotedValues.length > 0
      ? quotedValues[quotedValues.length - 1][1]
      : "";
    elements.push({
      tag: Number(match[1]),
      tagName: match[2].toLowerCase(),
      text,
    });
  }
  return elements;
}

function normalizeGuardText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
}

function findVisibleElementMatch(
  elements: VisibleElementLite[],
  rawSearchText: unknown,
): VisibleElementLite | null {
  if (typeof rawSearchText !== "string") return null;
  const query = normalizeGuardText(rawSearchText);
  if (query.length < 2) return null;
  for (const el of elements) {
    const candidate = normalizeGuardText(el.text);
    if (!candidate) continue;
    if (
      candidate === query ||
      candidate.includes(query) ||
      (query.length >= 4 && query.includes(candidate))
    ) {
      return el;
    }
  }
  return null;
}

export function buildRecoveryIntervention(
  toolCalls: ReplayOutput["toolCalls"],
  repeatedCalls: SeededToolCall[],
  signals: ReplayContextSignals,
  turn: number,
): {
  kind: string;
  message: (tc: ReplayOutput["toolCalls"][number]) => string;
  followUp: string;
  forcedToolCalls?: ReplayOutput["toolCalls"];
} | null {
  if (signals.hasStagnationWarning) {
    for (const tc of toolCalls) {
      if (tc.toolName !== ToolName.ESCALATE && tc.toolName !== ToolName.DONE) {
        return {
          kind: "stagnation_warning_forced_escalation",
          message: () =>
            "BLOCKED: Replay history already contains an explicit stagnation warning requiring escalate() or done(). Additional tool calls are disallowed.",
          followUp:
            'You are past the execution budget. Call escalate({"reason":"Exceeded turn budget without completing objective"}) or done() if the task cannot be completed.',
        };
      }
    }
  }

  for (const tc of toolCalls) {
    const visibleCode = findVisibleCodeCandidate(signals.visibleElements);
    const promptCode = findPromptCodeToken(signals.systemPrompt);
    const availableCode = visibleCode?.text ?? signals.recentTypedText ?? promptCode;
    const input = findTextInput(signals.visibleElements);
    const submitButton = findSubmitButton(signals.visibleElements);
    const currentStep = extractCurrentStep(signals.systemPrompt);
    const targetStep = extractTargetStep(signals.objectiveHint);

    if (
      currentStep !== null &&
      targetStep !== null &&
      currentStep >= targetStep &&
      (tc.toolName !== ToolName.DONE)
    ) {
      return {
        kind: "goal_already_reached_done_now",
        message: () =>
          `BLOCKED: The page is already at step ${currentStep}, which satisfies the objective target step ${targetStep}.`,
        followUp:
          "The success boundary has already been reached. Call done() now with a concise summary of the completed reveal, entry, and submit steps.",
      };
    }

    if (
      visibleCode &&
      objectiveSuggestsCodeEntry(signals.objectiveHint) &&
      (
        tc.toolName === ToolName.FIND_ELEMENT ||
        tc.toolName === ToolName.READ_PAGE ||
        tc.toolName === ToolName.INSPECT_HIDDEN ||
        tc.toolName === ToolName.XRAY_PAGE ||
        tc.toolName === ToolName.EXECUTE_JS
      )
    ) {
      const forcedToolCalls = input
        ? [{
            toolName: ToolName.TYPE_TEXT,
            args: {
              id: input.tag,
              text: visibleCode.text,
              pressEnter: true,
            },
          }]
        : [{
            toolName: ToolName.CLICK_ELEMENT,
            args: { id: visibleCode.tag },
          }];
      return {
        kind: "visible_code_to_input_bridge",
        message: () =>
          `BLOCKED: The code is already visible as [${visibleCode.tag}] ${visibleCode.tagName} "${visibleCode.text}". Searching or rereading is unnecessary.`,
        followUp:
          input
            ? `Type the visible code "${visibleCode.text}" into input [${input.tag}] with pressEnter=true, or click submit if the input already contains that value.`
            : `Use the visible code element [${visibleCode.tag}] directly as the next grounding step instead of searching again.`,
        forcedToolCalls,
      };
    }

    if (
      !visibleCode &&
      availableCode &&
      objectiveSuggestsCodeEntry(signals.objectiveHint) &&
      (
        tc.toolName === ToolName.FIND_ELEMENT ||
        tc.toolName === ToolName.PRESS_KEY
      )
    ) {
      return {
        kind: "prompt_code_to_input_bridge",
        message: () =>
          `BLOCKED: The page state already exposes a likely code token "${availableCode}". Searching for "Enter Code" is unnecessary.`,
        followUp:
          input
            ? `Use the visible code "${availableCode}" directly with input [${input.tag}] and pressEnter=true.`
            : `Ground on the exposed code token "${availableCode}" instead of searching again.`,
        forcedToolCalls: input
          ? [{
              toolName: ToolName.TYPE_TEXT,
              args: {
                id: input.tag,
                text: availableCode,
                pressEnter: true,
              },
            }]
          : undefined,
      };
    }

    if (tc.toolName === ToolName.FIND_ELEMENT) {
      const match = findVisibleElementMatch(
        signals.visibleElements,
        tc.args.searchText ?? tc.args.text,
      );
      if (match) {
        return {
          kind: "visible_find_element_blocked",
          message: () =>
            `BLOCKED: Element matching "${String(tc.args.searchText ?? tc.args.text)}" is already visible as ` +
            `[${match.tag}] ${match.tagName} "${match.text}". Use its visible tag directly instead of find_element.`,
          followUp:
            "Use the visible tagged element directly. Do not search again for content that is already present in Visible Elements.",
        };
      }

      if (objectiveSuggestsCodeEntry(signals.objectiveHint)) {
        const visibleCode = findVisibleCodeCandidate(signals.visibleElements);
        if (visibleCode) {
          return {
            kind: "visible_code_already_present",
            message: () =>
              `BLOCKED: The code is already visible as [${visibleCode.tag}] ${visibleCode.tagName} "${visibleCode.text}". Searching again is unnecessary.`,
            followUp:
              "The required code is already visible. Use the visible code element or act directly on the input/submit flow instead of searching again.",
          };
        }
      }
    }

    if (tc.toolName === ToolName.PRESS_KEY && objectiveSuggestsCodeEntry(signals.objectiveHint)) {
      if (input) {
        return {
          kind: "press_key_text_entry_blocked",
          message: () =>
            `BLOCKED: press_key is not the right first action for text entry while visible input [${input.tag}] is available.`,
          followUp:
            "Use type_text on the visible input field for code entry. Reserve press_key for Enter/Escape/Tab after typing or when direct typing is impossible.",
          forcedToolCalls: availableCode
            ? [{
                toolName: ToolName.TYPE_TEXT,
                args: {
                  id: input.tag,
                  text: availableCode,
                  pressEnter: true,
                },
              }]
            : undefined,
        };
      }
    }

    if (
      tc.toolName === ToolName.CLICK_ELEMENT &&
      isPuzzleVerificationPage(signals) &&
      submitButton &&
      String(tc.args.id ?? "") === String(submitButton.tag)
    ) {
      const submitArgsKey = JSON.stringify({ id: submitButton.tag });
      const priorSubmitClicks = repeatedCalls.filter(
        (entry) =>
          entry.toolName === ToolName.CLICK_ELEMENT &&
          entry.argsKey === submitArgsKey,
      ).length;

      if (signals.hasSameUrlEscalation && priorSubmitClicks >= 1) {
        return {
          kind: "repeated_submit_requires_escalation",
          message: () =>
            `BLOCKED: Submit button [${submitButton.tag}] has already been tried on this same URL without progress.`,
          followUp:
            'Do not retry the same code submission again. Call escalate({"reason":"Code rejected by form 3 times - need different approach"}) now.',
          forcedToolCalls: [
            {
              toolName: ToolName.ESCALATE,
              args: {
                reason: "Code rejected by form 3 times - need different approach",
              },
            },
          ],
        };
      }

      return {
        kind: "prefilled_code_requires_verification",
        message: () =>
          `BLOCKED: The page shows a prefilled code and a challenge hint. Verify the code source before submitting [${submitButton.tag}].`,
        followUp:
          'Do not trust the prefilled value yet. Use inspect_hidden({"pattern":"[A-Z0-9]{6}"}) or another hidden-state inspection step first to verify the correct code.',
        forcedToolCalls: [
          {
            toolName: ToolName.INSPECT_HIDDEN,
            args: { pattern: "[A-Z0-9]{6}" },
          },
        ],
      };
    }

    if (
      input &&
      submitButton &&
      visibleCode &&
      normalizeGuardText(input.text) === normalizeGuardText(visibleCode.text) &&
      !isPuzzleVerificationPage(signals) &&
      (
        tc.toolName === ToolName.INSPECT_HIDDEN ||
        tc.toolName === ToolName.FIND_ELEMENT ||
        tc.toolName === ToolName.READ_PAGE ||
        tc.toolName === ToolName.XRAY_PAGE ||
        tc.toolName === ToolName.EXECUTE_JS
      )
    ) {
      return {
        kind: "submit_visible_prefilled_code_now",
        message: () =>
          `BLOCKED: Input [${input.tag}] already contains the visible code "${visibleCode.text}" and submit button [${submitButton.tag}] is available.`,
        followUp:
          `The goal state is already prepared. Click submit button [${submitButton.tag}] now instead of investigating further.`,
        forcedToolCalls: [
          {
            toolName: ToolName.CLICK_ELEMENT,
            args: { id: submitButton.tag },
          },
        ],
      };
    }

    if (
      tc.toolName === ToolName.READ_PAGE &&
      input &&
      submitButton &&
      visibleCode &&
      normalizeGuardText(input.text) === normalizeGuardText(visibleCode.text)
    ) {
      return {
        kind: "submit_after_type_nudge",
        message: () =>
          `BLOCKED: Input [${input.tag}] already contains the visible code "${visibleCode.text}" and submit button [${submitButton.tag}] is available.`,
        followUp:
          `The code is already entered. Click submit button [${submitButton.tag}] now instead of rereading or investigating further.`,
      };
    }

    if (
      tc.toolName === ToolName.TYPE_TEXT &&
      isPostSubmitCompletionCandidate(signals, input, submitButton, visibleCode)
    ) {
      return {
        kind: "submit_now_after_visible_code",
        message: () =>
          `BLOCKED: The code is already visible and entered, and submit button [${submitButton?.tag}] is available.`,
        followUp:
          `Stop retyping or re-investigating. Click submit button [${submitButton?.tag}] now.`,
      };
    }

    if (
      shouldPreferAttributeInspection(signals) &&
      (
        tc.toolName === ToolName.CLICK_ELEMENT ||
        tc.toolName === ToolName.INSPECT_HIDDEN ||
        tc.toolName === ToolName.EXECUTE_JS
      )
      ) {
        return {
          kind: "attribute_hint_tool_redirect",
          message: () =>
            "BLOCKED: The page hint points to attributes, aria labels, or meta tags. Generic clicking, broad hidden scans, or custom JS are not the best next move.",
          followUp:
            "Use xray_page() now. It is the purpose-built tool for revealing hidden DOM content, attributes, aria labels, and metadata on this page.",
          forcedToolCalls: [
            {
              toolName: ToolName.XRAY_PAGE,
              args: {},
            },
          ],
        };
      }

    if (!RECOVERY_REPEAT_EXEMPT_TOOLS.has(tc.toolName)) {
      const argsKey = JSON.stringify(tc.args);
      const priorRepeatCount = repeatedCalls.filter(
        (entry) => entry.toolName === tc.toolName && entry.argsKey === argsKey,
      ).length;
      if (priorRepeatCount >= 2) {
        const repeatCount = priorRepeatCount + 1;
        return {
          kind: "repeat_action_blocked",
          message: () =>
            `BLOCKED: You already called ${tc.toolName} with the same arguments ${repeatCount} times in recent turns. ` +
            `This is cycling. Try a fundamentally different action or call escalate({"reason": "Repeated ${tc.toolName} without progress"})`,
          followUp:
            "The current approach is looping. Choose a fundamentally different next action or escalate if you are stuck.",
        };
      }
    }
  }

  if (toolCalls.length === 0 && turn === 0) {
    return {
      kind: "empty_response_nudge",
      message: () => "No action taken.",
      followUp:
        "You did not take an action. Re-read the page state and choose the most direct tool that advances the objective.",
    };
  }

  return null;
}

function objectiveSuggestsCodeEntry(objectiveHint: string): boolean {
  const normalized = normalizeGuardText(objectiveHint);
  return normalized.includes("enter the code") || normalized.includes("type the code");
}

function findVisibleCodeCandidate(elements: VisibleElementLite[]): VisibleElementLite | null {
  let candidate: VisibleElementLite | null = null;
  for (const el of elements) {
    const text = el.text.trim();
    if (/^[A-Z0-9]{4,8}$/.test(text)) {
      candidate = el;
    }
  }
  return candidate;
}

function findTextInput(elements: VisibleElementLite[]): VisibleElementLite | null {
  for (const el of elements) {
    const normalizedText = normalizeGuardText(el.text);
    if (el.tagName === "input") return el;
    if (normalizedText.includes("enter 6-character code")) return el;
  }
  return null;
}

function findSubmitButton(elements: VisibleElementLite[]): VisibleElementLite | null {
  for (const el of elements) {
    if (el.tagName !== "button") continue;
    if (normalizeGuardText(el.text).includes("submit code")) return el;
  }
  return null;
}

function isPuzzleVerificationPage(signals: ReplayContextSignals): boolean {
  const prompt = normalizeGuardText(signals.systemPrompt);
  return (
    prompt.includes("puzzle challenge") &&
    prompt.includes("code revealed") &&
    findTextInput(signals.visibleElements) !== null &&
    findSubmitButton(signals.visibleElements) !== null
  );
}

function shouldPreferAttributeInspection(signals: ReplayContextSignals): boolean {
  const prompt = normalizeGuardText(signals.systemPrompt);
  return (
    prompt.includes("check the element attributes, aria labels, or meta tags") &&
    findVisibleCodeCandidate(signals.visibleElements) === null &&
    !(findTextInput(signals.visibleElements) && findSubmitButton(signals.visibleElements))
  );
}

function extractCurrentStep(prompt: string): number | null {
  const match = prompt.match(/URL:\s+https?:\/\/[^\s]+\/step(\d+)/i)
    ?? prompt.match(/Challenge Step\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

function extractTargetStep(objectiveHint: string): number | null {
  const explicitTarget = Array.from(objectiveHint.matchAll(/(?:proceed|go|move|advance)\s+to\s+step\s+(\d+)/gi));
  if (explicitTarget.length > 0) {
    return Number(explicitTarget[explicitTarget.length - 1][1]);
  }
  const allSteps = Array.from(objectiveHint.matchAll(/step\s+(\d+)/gi));
  if (allSteps.length === 0) return null;
  return Number(allSteps[allSteps.length - 1][1]);
}

function isPostSubmitCompletionCandidate(
  signals: ReplayContextSignals,
  input: VisibleElementLite | null,
  submitButton: VisibleElementLite | null,
  visibleCode: VisibleElementLite | null,
): boolean {
  if (!input || !submitButton || !visibleCode) return false;
  const prompt = normalizeGuardText(signals.systemPrompt);
  return (
    normalizeGuardText(input.text) === normalizeGuardText(visibleCode.text) &&
    prompt.includes("enter code to proceed") &&
    prompt.includes("submit code")
  );
}

function findPromptCodeToken(prompt: string): string | null {
  const matches = Array.from(prompt.matchAll(/\b([A-Z0-9]{6})\b/g));
  for (const match of matches) {
    const token = match[1];
    if (!token) continue;
    if (token === "BUTTON" || token === "SCROLL" || token === "CONTENT") continue;
    return token;
  }
  return null;
}
