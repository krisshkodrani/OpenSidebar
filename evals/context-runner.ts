/**
 * Context compression eval runner.
 *
 * No LLM calls — replays compression through ContextManager directly.
 */

// Import chrome mock BEFORE any ContextManager import
import "./chrome-mock";

import { existsSync, mkdirSync } from "fs";
import { appendFile } from "fs/promises";
import { join } from "path";
import type { ContextEvalCase, ContextEvalResult } from "./types";
import {
  readContextEvalCases,
  CONTEXT_RESULTS_DIR,
} from "./utils";
import { scoreContext, isContextPass } from "./context-scorer";
import { ContextManager } from "../src/background/agent/context";

/**
 * Replay a single context compression case.
 */
export function replayContextCase(evalCase: ContextEvalCase): {
  compressedPrompt: string;
  tokensBefore: number;
  tokensAfter: number;
  historyLengthBefore: number;
  historyLengthAfter: number;
  compressionLevel: string;
} {
  const ctx = new ContextManager(evalCase.input.maxContextTokens);

  // Set original query
  ctx.setOriginalQuery(evalCase.input.originalQuery);

  // Set perception if available
  if (evalCase.input.perception) {
    ctx.setPageInterpretation(evalCase.input.perception);
  }

  // Set plan status if available
  if (evalCase.input.planStatus) {
    ctx.setPlanStatus(
      evalCase.input.planStatus.subtasks.map((s) => ({
        description: s.description,
        status: s.status,
      })),
      evalCase.input.planStatus.currentIndex,
    );
  }

  // Set snapshot with elements
  const snapshot = {
    title: evalCase.input.snapshot.title,
    url: evalCase.input.snapshot.url,
    elements: evalCase.input.elements.map((el) => ({
      tag: el.tag,
      tagName: el.tagName,
      text: el.text,
      role: el.role ?? "",
      attributes: el.attributes,
      rect: { x: 0, y: 0, width: 100, height: 20 },
      isVisible: true,
      isDisabled: false,
    })),
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: evalCase.input.snapshot.scrollY, maxY: evalCase.input.snapshot.scrollY },
  };
  ctx.setSnapshot(snapshot);

  // Measure before compression: add all messages and get initial metrics
  const historyLengthBefore = evalCase.input.history.length;

  // Feed history messages
  for (const msg of evalCase.input.history) {
    ctx.addMessage(msg as any);
  }

  // Get the compressed prompt
  const prompt = ctx.getPrompt();
  const metrics = ctx.getPromptMetrics();

  // Serialize prompt to text for scoring
  const compressedPrompt = prompt
    .map((m) => {
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) {
        return m.content
          .map((part: any) => (typeof part === "string" ? part : part.text ?? ""))
          .join("");
      }
      return "";
    })
    .join("\n\n");

  const historyLengthAfter = ctx.getHistoryLength();

  return {
    compressedPrompt,
    tokensBefore: metrics.systemTokens + metrics.historyTokens + 1000, // approximate pre-compression
    tokensAfter: metrics.totalTokens,
    historyLengthBefore,
    historyLengthAfter,
    compressionLevel: metrics.compressionLevel,
  };
}

/**
 * Main entry point: run context compression evals.
 */
export async function runContextEvals(options: {
  dimension?: string;
  outDir?: string;
}): Promise<ContextEvalResult[]> {
  let cases = readContextEvalCases();
  if (cases.length === 0) {
    console.log("No context eval cases found in evals/golden/context/");
    return [];
  }

  if (options.dimension) {
    cases = cases.filter((c) => c.metadata.dimension === options.dimension);
  }

  const outDir = options.outDir ?? CONTEXT_RESULTS_DIR;
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputFile = join(outDir, `context-${timestamp}.jsonl`);

  const results: ContextEvalResult[] = [];

  console.log(`Running ${cases.length} context compression case(s)...\n`);

  for (let i = 0; i < cases.length; i++) {
    const evalCase = cases[i];

    process.stdout.write(
      `  [${i + 1}/${cases.length}] ${evalCase.id.slice(0, 40)}... `,
    );

    const start = Date.now();
    let result: ContextEvalResult;

    try {
      const replay = replayContextCase(evalCase);
      const durationMs = Date.now() - start;

      const scores = scoreContext(evalCase, replay.compressedPrompt, {
        tokensBefore: replay.tokensBefore,
        tokensAfter: replay.tokensAfter,
        compressionLevel: replay.compressionLevel,
      });
      const pass = isContextPass(scores);

      const reductionPercent = replay.tokensBefore > 0
        ? (1 - replay.tokensAfter / replay.tokensBefore) * 100
        : 0;

      result = {
        caseId: evalCase.id,
        timestamp: new Date().toISOString(),
        durationMs,
        status: pass ? "pass" : "fail",
        compressionLevel: replay.compressionLevel,
        actual: {
          promptTokensBefore: replay.tokensBefore,
          promptTokensAfter: replay.tokensAfter,
          reductionPercent,
          historyLengthBefore: replay.historyLengthBefore,
          historyLengthAfter: replay.historyLengthAfter,
        },
        scores,
      };

      const statusColor = result.status === "pass" ? "\x1b[32m" : "\x1b[31m";
      console.log(
        `${statusColor}${result.status}\x1b[0m ` +
          `goal=${scores.goalPreservation.toFixed(2)} plan=${scores.planPreservation.toFixed(2)} ` +
          `tool=${scores.toolResultPreservation.toFixed(2)} eff=${scores.tokenEfficiency.toFixed(2)} ` +
          `comp=${scores.composite.toFixed(2)} [${replay.compressionLevel}] ${durationMs}ms`,
      );
    } catch (err: any) {
      result = {
        caseId: evalCase.id,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - start,
        status: "error",
        compressionLevel: "unknown",
        actual: {
          promptTokensBefore: 0,
          promptTokensAfter: 0,
          reductionPercent: 0,
          historyLengthBefore: 0,
          historyLengthAfter: 0,
        },
        scores: {
          goalPreservation: 0,
          planPreservation: 0,
          toolResultPreservation: 0,
          keyFactPreservation: 0,
          tokenEfficiency: 0,
          composite: 0,
        },
        error: err.message,
      };
      console.log(`\x1b[31merror\x1b[0m ${err.message.slice(0, 80)}`);
    }

    results.push(result);
    await appendFile(outputFile, JSON.stringify(result) + "\n");
  }

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errors = results.filter((r) => r.status === "error").length;
  console.log(`\nResults: ${passed} passed, ${failed} failed, ${errors} errors`);
  console.log(`Written to: ${outputFile}`);

  return results;
}
