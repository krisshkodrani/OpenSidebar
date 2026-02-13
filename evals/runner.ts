/**
 * Offline eval runner.
 * Replays eval cases against the LLM without a browser.
 */

import { existsSync, mkdirSync } from "fs";
import { appendFile } from "fs/promises";
import { join } from "path";
import type { EvalCase, EvalResult } from "./types";
import { readEvalCases, RESULTS_DIR, loadApiKey } from "./utils";
import { scoreToolNameMatch, scoreToolParamMatch, scoreSequenceMatch } from "./scorer";
import { judgeCase } from "./judge";

const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Run eval cases and return results.
 */
export async function runEvals(options: {
  caseId?: string;
  all?: boolean;
  judge?: boolean;
  model?: string;
}): Promise<EvalResult[]> {
  const apiKey = loadApiKey();
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
  const results: EvalResult[] = [];

  console.log(`Running ${cases.length} eval case(s)...\n`);

  for (let i = 0; i < cases.length; i++) {
    const evalCase = cases[i];
    const model = options.model || evalCase.input.model;
    process.stdout.write(`  [${i + 1}/${cases.length}] ${evalCase.strategy} T${evalCase.sourceTurn} `);

    const start = Date.now();
    let result: EvalResult;

    try {
      const actual = await replayCase(apiKey, evalCase, model);
      const durationMs = Date.now() - start;

      const expectedToolCalls = evalCase.expected.toolCalls.map((tc) => ({
        toolName: tc.toolName as string,
        args: tc.args,
      }));

      const toolNameScore = scoreToolNameMatch(expectedToolCalls, actual.toolCalls);
      const toolParamScore = scoreToolParamMatch(expectedToolCalls, actual.toolCalls);
      const sequenceScore = scoreSequenceMatch(expectedToolCalls, actual.toolCalls);
      const pass = toolNameScore >= 0.8 && sequenceScore >= 0.7;

      result = {
        caseId: evalCase.id,
        timestamp: new Date().toISOString(),
        durationMs,
        status: pass ? "pass" : "fail",
        actual,
        scores: {
          toolNameMatch: toolNameScore,
          toolParamMatch: toolParamScore,
          sequenceMatch: sequenceScore,
        },
      };

      // Run LLM-as-judge for failed cases if enabled
      if (!pass && options.judge) {
        try {
          result.scores.judge = await judgeCase(apiKey, evalCase, actual);
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
    } catch (err: any) {
      const durationMs = Date.now() - start;
      result = {
        caseId: evalCase.id,
        timestamp: new Date().toISOString(),
        durationMs,
        status: "error",
        actual: { toolCalls: [], text: null },
        scores: { toolNameMatch: 0, toolParamMatch: 0, sequenceMatch: 0 },
        error: err.message,
      };
      console.log(`\x1b[31merror\x1b[0m ${err.message}`);
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

async function replayCase(
  apiKey: string,
  evalCase: EvalCase,
  model: string,
): Promise<{ toolCalls: { toolName: string; args: Record<string, unknown> }[]; text: string | null }> {
  const messages = evalCase.input.conversationHistory.length > 0
    ? evalCase.input.conversationHistory
    : [{ role: "user" as const, content: evalCase.metadata.query }];

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: 4096,
    temperature: 0,
  };

  if (evalCase.input.tools.length > 0) {
    body.tools = evalCase.input.tools;
    body.tool_choice = "auto";
  }

  const response = await fetch(OPENROUTER_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://opensidebar.dev",
      "X-Title": "OpenSidebar Evals",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json() as any;
  const choice = data.choices?.[0];
  if (!choice) throw new Error("No response choice");

  const toolCalls = (choice.message?.tool_calls ?? []).map((tc: any) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments);
    } catch { /* keep empty */ }
    return { toolName: tc.function.name, args };
  });

  return {
    toolCalls,
    text: choice.message?.content ?? null,
  };
}
