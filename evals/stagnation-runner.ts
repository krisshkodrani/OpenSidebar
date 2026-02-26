/**
 * Stagnation eval runner.
 *
 * No LLM calls — replays snapshot sequences through StagnationMonitor.
 */

import { existsSync, mkdirSync } from "fs";
import { appendFile } from "fs/promises";
import { join } from "path";
import type { StagnationEvalCase, StagnationEvalResult } from "./types";
import type { DomSnapshot, TaggedElement } from "../src/types";
import {
  readStagnationEvalCases,
  STAGNATION_RESULTS_DIR,
} from "./utils";
import { scoreStagnation, isStagnationPass } from "./stagnation-scorer";
import { StagnationMonitor } from "../src/background/agent/stagnation";

/**
 * Replay a single stagnation case through the StagnationMonitor.
 */
export function replayStagnationCase(evalCase: StagnationEvalCase): {
  escalationFired: boolean;
  escalationTurn?: number;
  stagnantTurnCounts: number[];
  totalStagnantTurns: number;
  urlChanges: number;
} {
  const monitor = new StagnationMonitor();
  const stagnantTurnCounts: number[] = [];
  let escalationFired = false;
  let escalationTurn: number | undefined;
  let urlChanges = 0;
  let prevUrl = "";

  for (const snap of evalCase.input.snapshots) {
    // Construct a DomSnapshot from the compact representation
    const domSnapshot: DomSnapshot = {
      url: snap.url,
      title: snap.title,
      elements: snap.elements.map((el) => ({
        tag: 0,
        tagName: el.tagName,
        text: el.text,
        role: "",
        attributes: el.attributes,
        rect: { x: 0, y: 0, width: 100, height: 20 },
        isVisible: true,
        isDisabled: false,
      })) as TaggedElement[],
      viewport: { width: 1280, height: 720 },
      scroll: { x: 0, y: 0, maxY: 0 },
    };

    // Track URL changes
    if (prevUrl && snap.url !== prevUrl) {
      urlChanges++;
    }
    prevUrl = snap.url;

    // Feed to monitor
    const signal = monitor.onSnapshotRefresh(domSnapshot);

    // Track stagnant state
    if (monitor.isStillStuck()) {
      stagnantTurnCounts.push(snap.turnNumber);
    }

    // Check for escalation signal
    if (signal && signal.type === "escalate") {
      escalationFired = true;
      if (escalationTurn === undefined) {
        escalationTurn = snap.turnNumber;
      }
    }
  }

  return {
    escalationFired,
    escalationTurn,
    stagnantTurnCounts,
    totalStagnantTurns: stagnantTurnCounts.length,
    urlChanges,
  };
}

/**
 * Main entry point: run stagnation evals.
 */
export async function runStagnationEvals(options: {
  dimension?: string;
  outDir?: string;
}): Promise<StagnationEvalResult[]> {
  let cases = readStagnationEvalCases();
  if (cases.length === 0) {
    console.log("No stagnation eval cases found in evals/golden/stagnation/");
    return [];
  }

  if (options.dimension) {
    cases = cases.filter((c) => c.metadata.dimension === options.dimension);
  }

  const outDir = options.outDir ?? STAGNATION_RESULTS_DIR;
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputFile = join(outDir, `stagnation-${timestamp}.jsonl`);

  const results: StagnationEvalResult[] = [];

  console.log(`Running ${cases.length} stagnation case(s)...\n`);

  for (let i = 0; i < cases.length; i++) {
    const evalCase = cases[i];

    process.stdout.write(
      `  [${i + 1}/${cases.length}] ${evalCase.id.slice(0, 40)}... `,
    );

    const start = Date.now();
    let result: StagnationEvalResult;

    try {
      const replay = replayStagnationCase(evalCase);
      const durationMs = Date.now() - start;

      const scores = scoreStagnation(evalCase, replay);
      const pass = isStagnationPass(scores);

      result = {
        caseId: evalCase.id,
        timestamp: new Date().toISOString(),
        durationMs,
        status: pass ? "pass" : "fail",
        actual: replay,
        scores,
      };

      const statusColor = result.status === "pass" ? "\x1b[32m" : "\x1b[31m";
      console.log(
        `${statusColor}${result.status}\x1b[0m ` +
          `esc=${scores.escalationAccuracy.toFixed(2)} timing=${scores.timingAccuracy.toFixed(2)} ` +
          `fp=${scores.falsePositiveRate.toFixed(2)} fn=${scores.falseNegativeRate.toFixed(2)} ` +
          `comp=${scores.composite.toFixed(2)} ${durationMs}ms`,
      );
    } catch (err: any) {
      result = {
        caseId: evalCase.id,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - start,
        status: "error",
        actual: {
          escalationFired: false,
          stagnantTurnCounts: [],
          totalStagnantTurns: 0,
          urlChanges: 0,
        },
        scores: {
          escalationAccuracy: 0,
          timingAccuracy: 0,
          falsePositiveRate: 0,
          falseNegativeRate: 0,
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
