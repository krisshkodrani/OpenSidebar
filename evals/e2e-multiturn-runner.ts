/**
 * E2E multi-turn oracle-guided replay runner.
 *
 * For each step, loops through its trace turns sequentially:
 * 1. Build system prompt with current DOM snapshot + elements from the trace
 * 2. LLM call: agent sees DOM, history of prior turns, picks a tool call
 * 3. Score the turn: compare agent's tool call against the golden tool call
 * 4. Oracle override: inject the golden tool result and advance to next turn's DOM
 * 5. Repeat until all turns in the step are exhausted
 */

import { existsSync, mkdirSync, readFileSync } from "fs";
import { appendFile } from "fs/promises";
import { join } from "path";
import type {
  E2EGoldenCase,
  E2EMultiturnResult,
  E2ETurnScore,
  TraceTurn,
} from "./e2e-types";
import { readE2EGoldenCases, E2E_RESULTS_DIR, TRACE_DIR, type ApiKeys } from "./utils";
import { formatSnapshotElements } from "../src/background/agent/context";
import { getPromptTemplate } from "../src/prompts";
import { recoverToolCallsFromText } from "../src/background/agent/tool-recovery";
import type { TaggedElement } from "../src/types";

export type E2EMultiturnProvider = "groq" | "openrouter";

const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";
const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL_OPENROUTER = "openai/gpt-oss-120b";
const DEFAULT_MODEL_GROQ = "openai/gpt-oss-120b";

const TOOL_DEFS_PATH = join("evals", "tool-definitions.json");
const PASS_THRESHOLD = 0.50;

function loadToolDefinitions(): any[] {
  if (!existsSync(TOOL_DEFS_PATH)) {
    console.warn(`Warning: ${TOOL_DEFS_PATH} not found.`);
    return [];
  }
  return JSON.parse(readFileSync(TOOL_DEFS_PATH, "utf-8"));
}

// ── Trace loader ──────────────────────────────────────────────────────

/**
 * Load per-turn data from a trace JSONL file for a given turn range.
 */
export function loadTraceTurns(
  sessionId: string,
  startTurn: number,
  endTurn: number,
): TraceTurn[] {
  const file = join(TRACE_DIR, `${sessionId}.jsonl`);
  if (!existsSync(file)) {
    throw new Error(`Trace file not found: ${file}`);
  }

  const lines = readFileSync(file, "utf-8").trim().split("\n").filter(Boolean);
  const turns: TraceTurn[] = [];

  for (const line of lines) {
    const entry = JSON.parse(line);
    if (entry.traceKind !== "agent.turn") continue;

    const turnNum = entry.turnNumber as number;
    if (turnNum < startTurn || turnNum > endTurn) continue;

    // Extract the first tool call from llmResponse
    const toolCalls = entry.llmResponse?.toolCalls ?? [];
    const firstTC = toolCalls[0];
    if (!firstTC) continue; // skip turns with no tool call

    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(firstTC.function.arguments);
    } catch { /* keep empty */ }

    // Extract result from toolExecutions
    const executions = entry.toolExecutions ?? [];
    const firstExec = executions[0];
    const result = firstExec?.result ?? "OK";

    turns.push({
      turnNumber: turnNum,
      snapshot: entry.snapshot ?? {
        url: "",
        title: "",
        elementCount: 0,
        scrollY: 0,
      },
      elements: entry.elements ?? [],
      goldenToolCall: { name: firstTC.function.name, args },
      goldenResult: result,
    });
  }

  return turns.sort((a, b) => a.turnNumber - b.turnNumber);
}

// ── System prompt builder ─────────────────────────────────────────────

function buildSystemPromptForTurn(
  goldenCase: E2EGoldenCase,
  turn: TraceTurn,
): string {
  const template = getPromptTemplate("agent.system");
  const elements = turn.elements as unknown as TaggedElement[];
  const elementList = formatSnapshotElements(elements);

  return (
    template +
    "\n\n## Page Context\n\n" +
    `URL: ${turn.snapshot.url}\n` +
    `Title: ${turn.snapshot.title}\n` +
    `Scroll: ${turn.snapshot.scrollY}px\n` +
    `Elements: ${turn.snapshot.elementCount}\n\n` +
    "### Interactive Elements\n\n" +
    elementList
  );
}

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

// ── LLM call ──────────────────────────────────────────────────────────

async function callLLM(
  keys: ApiKeys,
  provider: E2EMultiturnProvider,
  messages: Array<{ role: string; content?: string | null; tool_calls?: any[]; tool_call_id?: string }>,
): Promise<{
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
  text: string | null;
  modelVersion?: string;
  durationMs: number;
}> {
  const useGroq = provider === "groq" && !!keys.groq;
  const model = useGroq ? DEFAULT_MODEL_GROQ : DEFAULT_MODEL_OPENROUTER;
  const apiUrl = useGroq ? GROQ_API : OPENROUTER_API;

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
    headers["X-Title"] = "OpenSidebar E2E Multi-Turn Evals";
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

  // Text recovery: match production behavior
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

// ── Scoring ───────────────────────────────────────────────────────────

function scoreTurnArgs(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): number {
  const allKeys = Array.from(new Set([...Object.keys(expected), ...Object.keys(actual)]));
  if (allKeys.length === 0) return 1.0;

  let matches = 0;
  for (const key of allKeys) {
    const ev = expected[key];
    const av = actual[key];

    if (key === "id") {
      // Exact match for element IDs
      if (Number(ev) === Number(av)) matches++;
    } else if (typeof ev === "string" && typeof av === "string") {
      // Case-insensitive string containment
      if (
        ev.toLowerCase() === av.toLowerCase() ||
        av.toLowerCase().includes(ev.toLowerCase()) ||
        ev.toLowerCase().includes(av.toLowerCase())
      ) {
        matches++;
      }
    } else if (typeof ev === "number" && typeof av === "number") {
      // Tolerant numeric comparison (within 20% or diff <= 50)
      const diff = Math.abs(ev - av);
      if (diff === 0 || diff / Math.max(Math.abs(ev), 1) <= 0.2 || diff <= 50) {
        matches++;
      }
    } else if (JSON.stringify(ev) === JSON.stringify(av)) {
      matches++;
    }
  }

  return matches / allKeys.length;
}

function aggregateScores(
  turnScores: E2ETurnScore[],
): E2EMultiturnResult["scores"] {
  if (turnScores.length === 0) {
    return { turnAccuracy: 0, argAccuracy: 0, solutionAccuracy: 0, explorationAccuracy: 0, composite: 0 };
  }

  const toolMatches = turnScores.filter((t) => t.toolMatch);
  const turnAccuracy = toolMatches.length / turnScores.length;
  const argAccuracy =
    toolMatches.length > 0
      ? toolMatches.reduce((s, t) => s + t.argsMatch, 0) / toolMatches.length
      : 0;

  const solutionTurns = turnScores.filter((t) => t.isSolutionPhase);
  const solutionAccuracy =
    solutionTurns.length > 0
      ? solutionTurns.filter((t) => t.toolMatch).length / solutionTurns.length
      : 0;

  const explorationTurns = turnScores.filter((t) => !t.isSolutionPhase);
  const explorationAccuracy =
    explorationTurns.length > 0
      ? explorationTurns.filter((t) => t.toolMatch).length / explorationTurns.length
      : 0;

  const composite =
    0.50 * solutionAccuracy +
    0.30 * turnAccuracy +
    0.20 * argAccuracy;

  return { turnAccuracy, argAccuracy, solutionAccuracy, explorationAccuracy, composite };
}

// ── Oracle-guided replay ──────────────────────────────────────────────

/**
 * Replay a single E2E golden case in multi-turn mode.
 * Returns per-turn scores and step-level aggregates.
 */
export async function replayE2EMultiturn(
  keys: ApiKeys,
  goldenCase: E2EGoldenCase,
  traceTurns: TraceTurn[],
  provider: E2EMultiturnProvider,
): Promise<E2EMultiturnResult> {
  const start = Date.now();
  const turnScores: E2ETurnScore[] = [];
  let modelVersion: string | undefined;

  // The exploration/solution phase boundary
  const explorationCount = goldenCase.actions.exploration;

  // Build conversation history incrementally
  // Messages format: system, user, then alternating assistant (tool_call) + tool (result)
  const messages: any[] = [];

  for (let i = 0; i < traceTurns.length; i++) {
    const turn = traceTurns[i];
    const isSolutionPhase = i >= explorationCount;

    // Build system prompt with this turn's DOM state
    const systemPrompt = buildSystemPromptForTurn(goldenCase, turn);

    // Construct messages for this turn's LLM call:
    // Always: fresh system prompt (DOM changes each turn)
    // First turn: add user message
    // Subsequent turns: system + user + history of prior oracle turns
    const turnMessages: any[] = [
      { role: "system", content: systemPrompt },
    ];

    if (i === 0) {
      turnMessages.push({ role: "user", content: buildUserMessage(goldenCase) });
    } else {
      // User message first
      turnMessages.push({ role: "user", content: buildUserMessage(goldenCase) });
      // Then the oracle history from prior turns
      turnMessages.push(...messages);
    }

    // Call LLM
    let llmResult: Awaited<ReturnType<typeof callLLM>>;
    try {
      llmResult = await callLLM(keys, provider, turnMessages);
    } catch (err: any) {
      // On LLM error, record error score for this turn and continue
      turnScores.push({
        turnNumber: turn.turnNumber,
        toolMatch: false,
        argsMatch: 0,
        expectedTool: turn.goldenToolCall.name,
        expectedArgs: turn.goldenToolCall.args,
        actualTool: null,
        actualArgs: {},
        isSolutionPhase,
      });
      // Still inject oracle into history and continue
      injectOracleIntoHistory(messages, turn);
      continue;
    }

    if (!modelVersion && llmResult.modelVersion) {
      modelVersion = llmResult.modelVersion;
    }

    // Score this turn
    const actualTool = llmResult.toolCalls[0]?.toolName ?? null;
    const actualArgs = llmResult.toolCalls[0]?.args ?? {};
    const toolMatch = actualTool === turn.goldenToolCall.name;
    const argsMatch = toolMatch
      ? scoreTurnArgs(turn.goldenToolCall.args, actualArgs)
      : 0;

    turnScores.push({
      turnNumber: turn.turnNumber,
      toolMatch,
      argsMatch,
      expectedTool: turn.goldenToolCall.name,
      expectedArgs: turn.goldenToolCall.args,
      actualTool,
      actualArgs,
      isSolutionPhase,
    });

    // Oracle override: inject the golden action + result into history
    injectOracleIntoHistory(messages, turn);
  }

  const scores = aggregateScores(turnScores);
  const durationMs = Date.now() - start;

  return {
    caseId: goldenCase.id,
    stepNumber: goldenCase.stepNumber,
    timestamp: new Date().toISOString(),
    durationMs,
    status: scores.composite >= PASS_THRESHOLD ? "pass" : "fail",
    modelVersion,
    turnCount: traceTurns.length,
    turnScores,
    scores,
  };
}

/**
 * Inject the golden tool call + result into conversation history.
 */
function injectOracleIntoHistory(
  messages: any[],
  turn: TraceTurn,
): void {
  const callId = `oracle-tc-${turn.turnNumber}`;

  // Assistant message with tool call
  messages.push({
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: callId,
        type: "function",
        function: {
          name: turn.goldenToolCall.name,
          arguments: JSON.stringify(turn.goldenToolCall.args),
        },
      },
    ],
  });

  // Tool result message
  messages.push({
    role: "tool",
    tool_call_id: callId,
    content: turn.goldenResult,
  });
}

// ── Main entry point ──────────────────────────────────────────────────

export async function runE2EMultiturnEvals(options: {
  keys: ApiKeys;
  provider?: E2EMultiturnProvider;
  stepFilter?: number;
}): Promise<E2EMultiturnResult[]> {
  const { keys } = options;
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
  const outputFile = join(E2E_RESULTS_DIR, `e2e-multiturn-${timestamp}.jsonl`);

  const results: E2EMultiturnResult[] = [];

  console.log(
    `Running ${cases.length} E2E multi-turn case(s) against ${provider}...\n`,
  );

  for (let i = 0; i < cases.length; i++) {
    const goldenCase = cases[i];
    const [startTurn, endTurn] = goldenCase.metrics.turnRange;

    process.stdout.write(
      `  [${i + 1}/${cases.length}] step${goldenCase.stepNumber.toString().padStart(2, "0")} ` +
        `(${goldenCase.metrics.turnCount} turns) [${provider}]... `,
    );

    let result: E2EMultiturnResult;
    try {
      // Load trace turns for this step
      const traceTurns = loadTraceTurns(goldenCase.sourceSessionId, startTurn, endTurn);

      if (traceTurns.length === 0) {
        throw new Error(
          `No trace turns found for session ${goldenCase.sourceSessionId} range [${startTurn}, ${endTurn}]`,
        );
      }

      result = await replayE2EMultiturn(keys, goldenCase, traceTurns, provider);

      const s = result.scores;
      const statusColor = result.status === "pass" ? "\x1b[32m" : "\x1b[31m";
      console.log(
        `${statusColor}${result.status}\x1b[0m ` +
          `turn=${s.turnAccuracy.toFixed(2)} args=${s.argAccuracy.toFixed(2)} ` +
          `sol=${s.solutionAccuracy.toFixed(2)} exp=${s.explorationAccuracy.toFixed(2)} ` +
          `comp=${s.composite.toFixed(2)} ${result.durationMs}ms`,
      );
    } catch (err: any) {
      result = {
        caseId: goldenCase.id,
        stepNumber: goldenCase.stepNumber,
        timestamp: new Date().toISOString(),
        durationMs: 0,
        status: "error",
        turnCount: 0,
        turnScores: [],
        scores: {
          turnAccuracy: 0,
          argAccuracy: 0,
          solutionAccuracy: 0,
          explorationAccuracy: 0,
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
  const totalTurns = results.reduce((s, r) => s + r.turnCount, 0);
  console.log(`\nResults: ${passed} passed, ${failed} failed, ${errors} errors (${totalTurns} total turns)`);
  console.log(`Written to: ${outputFile}`);

  return results;
}
