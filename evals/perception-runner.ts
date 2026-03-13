/**
 * Perception eval runner.
 *
 * Replays perception eval cases against vision APIs (OpenRouter)
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
import { buildProductionPerceptionPrompt } from "../src/background/perception/prompt-builder";
import { stripThinkTags } from "../src/background/llm";

export type PerceptionProvider = "openrouter";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_PERCEPTION_MODEL = "x-ai/grok-4.1-fast";

interface ProviderConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  providerId: string;
  headers: Record<string, string>;
}

function buildProviderConfig(
  keys: ApiKeys,
  model?: string,
): ProviderConfig {
  return {
    apiUrl: OPENROUTER_API_URL,
    apiKey: keys.openrouter,
    model: model ?? DEFAULT_PERCEPTION_MODEL,
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
  model?: string,
): Promise<{
  interpretation: string;
  model: string;
  providerId: string;
  durationMs: number;
}> {
  const config = buildProviderConfig(keys, model);

  // Reconstruct the perception prompt
  const promptText = buildProductionPerceptionPrompt({
    screenshotDataUrl: evalCase.input.screenshotDataUrl,
    elements: evalCase.input.elements as any,
    url: evalCase.input.url,
    title: evalCase.input.title,
    scroll: evalCase.input.scroll,
  }, {
    isFirstObservation: true,
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
    throw new Error(`${config.providerId} API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const json = (await response.json()) as any;
  const text = json.choices?.[0]?.message?.content ?? "";
  const cleaned = stripThinkTags(text);
  const durationMs = Date.now() - start;

  return {
    interpretation: cleaned,
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
  model?: string;
}): Promise<PerceptionEvalResult[]> {
  const { keys, judge = false } = options;
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

  const results: PerceptionEvalResult[] = [];

  const activeModel = options.model ?? DEFAULT_PERCEPTION_MODEL;
  console.log(
    `Running ${cases.length} perception case(s) against ${activeModel}...\n`,
  );

  for (let i = 0; i < cases.length; i++) {
    const evalCase = cases[i];

    {
      const config = buildProviderConfig(keys);

      process.stdout.write(
        `  [${i + 1}/${cases.length}] ${evalCase.id.slice(0, 35)} [openrouter]... `,
      );

      const start = Date.now();
      let result: PerceptionEvalResult;

      try {
        const replay = await replayPerceptionCase(keys, evalCase, options.model);
        const durationMs = Date.now() - start;

        const scores = scorePerception(evalCase, replay.interpretation);
        const pass = isPass(scores);

        result = {
          caseId: evalCase.id,
          timestamp: new Date().toISOString(),
          durationMs,
          status: pass ? "pass" : "fail",
          provider: { model: replay.model, providerId: replay.providerId },
          actual: {
            interpretation: replay.interpretation,
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
            `sec=${scores.sectionCompleteness.toFixed(2)} blk=${scores.blockerDetection.toFixed(2)} ` +
            `aff=${scores.affordanceGrounding.toFixed(2)} vis=${scores.visualOnlyRecall.toFixed(2)} ` +
            `hal=${scores.hallucination.toFixed(2)} ` +
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
            blockerDetection: 0,
            affordanceGrounding: 0,
            visualOnlyRecall: 0,
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
