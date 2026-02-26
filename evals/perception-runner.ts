/**
 * Perception eval runner.
 *
 * Replays perception eval cases against vision APIs (Groq / OpenRouter)
 * without a browser.
 */

import { existsSync, mkdirSync } from "fs";
import { appendFile } from "fs/promises";
import { join } from "path";
import type { PerceptionEvalCase, PerceptionEvalResult } from "./types";
import {
  readPerceptionEvalCases,
  PERCEPTION_RESULTS_DIR,
  type ApiKeys,
} from "./utils";
import { scorePerception, isPass } from "./perception-scorer";
import { judgePerceptionCase } from "./perception-judge";
import { buildPerceptionPrompt, parseCompletionSignal } from "../src/background/perception";
import { stripThinkTags } from "../src/background/llm";

export type PerceptionProvider = "groq" | "openrouter" | "both";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const GROQ_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const OPENROUTER_MODEL = "openai/gpt-4o-mini";

interface ProviderConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  providerId: string;
  headers: Record<string, string>;
}

function buildProviderConfig(
  provider: "groq" | "openrouter",
  keys: ApiKeys,
): ProviderConfig | null {
  if (provider === "groq") {
    if (!keys.groq) return null;
    return {
      apiUrl: GROQ_API_URL,
      apiKey: keys.groq,
      model: GROQ_MODEL,
      providerId: "groq",
      headers: {},
    };
  }
  return {
    apiUrl: OPENROUTER_API_URL,
    apiKey: keys.openrouter,
    model: OPENROUTER_MODEL,
    providerId: "openrouter",
    headers: {
      "HTTP-Referer": "https://opensidebar.dev",
      "X-Title": "OpenSidebar Perception Evals",
    },
  };
}

/**
 * Replay a single perception case against a target provider.
 */
export async function replayPerceptionCase(
  keys: ApiKeys,
  evalCase: PerceptionEvalCase,
  provider: "groq" | "openrouter",
): Promise<{
  interpretation: string;
  completionSignal?: { status: string; evidence: string; scope: string } | null;
  model: string;
  providerId: string;
  durationMs: number;
}> {
  const config = buildProviderConfig(provider, keys);
  if (!config) {
    throw new Error(`No API key for provider: ${provider}`);
  }

  // Reconstruct the perception prompt
  const { promptText, mode } = buildPerceptionPrompt({
    screenshotDataUrl: evalCase.input.screenshotDataUrl,
    elements: evalCase.input.elements as any,
    url: evalCase.input.url,
    title: evalCase.input.title,
    scroll: evalCase.input.scroll,
    subtask: evalCase.input.subtask,
    objective: evalCase.input.objective,
    toolProfile: evalCase.input.toolProfile,
  });

  const start = Date.now();

  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
      ...config.headers,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: promptText },
            {
              type: "image_url",
              image_url: { url: evalCase.input.screenshotDataUrl },
            },
          ],
        },
      ],
      max_tokens: 600,
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${provider} API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const json = (await response.json()) as any;
  const text = json.choices?.[0]?.message?.content ?? "";
  const cleaned = stripThinkTags(text);
  const durationMs = Date.now() - start;

  // Parse completion signal
  const signalScope = mode === "focused" ? "subtask" : "objective";
  const completionSignal = parseCompletionSignal(cleaned, signalScope) ?? null;

  return {
    interpretation: cleaned,
    completionSignal: completionSignal
      ? { status: completionSignal.status, evidence: completionSignal.evidence, scope: completionSignal.scope }
      : null,
    model: config.model,
    providerId: config.providerId,
    durationMs,
  };
}

/**
 * Main entry point: run perception evals.
 */
export async function runPerceptionEvals(options: {
  keys: ApiKeys;
  provider?: PerceptionProvider;
  dimension?: string;
  judge?: boolean;
  outDir?: string;
}): Promise<PerceptionEvalResult[]> {
  const { keys, judge = false } = options;
  const provider = options.provider ?? "both";

  let cases = readPerceptionEvalCases();
  if (cases.length === 0) {
    console.log("No perception eval cases found in evals/golden/perception/");
    return [];
  }

  if (options.dimension) {
    cases = cases.filter((c) => c.metadata.dimension === options.dimension);
  }

  const outDir = options.outDir ?? PERCEPTION_RESULTS_DIR;
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputFile = join(outDir, `perception-${timestamp}.jsonl`);

  const providers: ("groq" | "openrouter")[] =
    provider === "both" ? ["groq", "openrouter"] : [provider];

  const results: PerceptionEvalResult[] = [];

  console.log(
    `Running ${cases.length} perception case(s) against ${providers.join(" + ")}...\n`,
  );

  for (let i = 0; i < cases.length; i++) {
    const evalCase = cases[i];

    for (const prov of providers) {
      const config = buildProviderConfig(prov, keys);
      if (!config) {
        console.log(
          `  [${i + 1}/${cases.length}] ${evalCase.id} [${prov}] \x1b[33mskipped\x1b[0m (no key)`,
        );
        continue;
      }

      process.stdout.write(
        `  [${i + 1}/${cases.length}] ${evalCase.id.slice(0, 35)} [${prov}]... `,
      );

      const start = Date.now();
      let result: PerceptionEvalResult;

      try {
        const replay = await replayPerceptionCase(keys, evalCase, prov);
        const durationMs = Date.now() - start;

        const scores = scorePerception(
          evalCase,
          replay.interpretation,
          replay.completionSignal,
        );
        const pass = isPass(scores);

        result = {
          caseId: evalCase.id,
          timestamp: new Date().toISOString(),
          durationMs,
          status: pass ? "pass" : "fail",
          provider: { model: replay.model, providerId: replay.providerId },
          actual: {
            interpretation: replay.interpretation,
            completionSignal: replay.completionSignal,
          },
          scores: {
            ...scores,
          },
        };

        // Run LLM judge if enabled
        if (judge) {
          try {
            result.scores.judge = await judgePerceptionCase(
              keys.openrouter,
              evalCase,
              replay.interpretation,
            );
            // Judge can override pass/fail
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
            `sec=${scores.sectionCompleteness.toFixed(2)} sig=${scores.signalAccuracy.toFixed(2)} ` +
            `blk=${scores.blockerDetection.toFixed(2)} hal=${scores.hallucination.toFixed(2)} ` +
            `comp=${scores.composite.toFixed(2)} ${durationMs}ms`,
        );
      } catch (err: any) {
        result = {
          caseId: evalCase.id,
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - start,
          status: "error",
          provider: { model: config.model, providerId: config.providerId },
          actual: { interpretation: "" },
          scores: {
            sectionCompleteness: 0,
            signalAccuracy: 0,
            blockerDetection: 0,
            actionability: 0,
            hallucination: 0,
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
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errors = results.filter((r) => r.status === "error").length;
  console.log(`\nResults: ${passed} passed, ${failed} failed, ${errors} errors`);
  console.log(`Written to: ${outputFile}`);

  return results;
}
