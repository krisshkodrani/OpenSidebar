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
const CEREBRAS_API = "https://api.cerebras.ai/v1/chat/completions";

export type EvalProvider = "cerebras" | "openrouter";

const CEREBRAS_MODEL_MAP: Record<string, string> = {
  "openai/gpt-oss-120b": "gpt-oss-120b",
  "z-ai/glm-4.7": "zai-glm-4.7",
};

function toCerebrasModel(openRouterModel: string): string {
  return CEREBRAS_MODEL_MAP[openRouterModel] ?? openRouterModel;
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
}): Promise<EvalResult[]> {
  const keys = options.keys ?? loadApiKeys();
  const provider = options.provider ?? (keys.cerebras ? "cerebras" : "openrouter");
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
): Promise<{ toolCalls: { toolName: string; args: Record<string, unknown> }[]; text: string | null }> {
  const useCerebras = provider === "cerebras" && !!keys.cerebras;

  const messages = evalCase.input.conversationHistory.length > 0
    ? evalCase.input.conversationHistory
    : [{ role: "user" as const, content: evalCase.metadata.query }];

  const resolvedMessages = applyPromptOverride(messages, promptOverride);

  const resolvedModel = useCerebras ? toCerebrasModel(model) : model;

  const body: Record<string, unknown> = {
    model: resolvedModel,
    messages: resolvedMessages,
    max_tokens: 4096,
    temperature: 0,
  };

  // Use tools from the case if present, otherwise load from the static registry
  const tools = evalCase.input.tools.length > 0
    ? evalCase.input.tools
    : loadToolDefinitions();

  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const apiUrl = useCerebras ? CEREBRAS_API : OPENROUTER_API;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${useCerebras ? keys.cerebras! : keys.openrouter}`,
    "Content-Type": "application/json",
  };
  if (!useCerebras) {
    headers["HTTP-Referer"] = "https://opensidebar.dev";
    headers["X-Title"] = "OpenSidebar Evals";
  }

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

const PAGE_CONTEXT_MARKER = "## Page Context";

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
