/**
 * Stagnation eval case extractor.
 *
 * Reads trace sessions and extracts snapshot sequences
 * for stagnation detection evaluation.
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { StagnationEvalCase } from "./types";
import {
  readTrace,
  readSessionIndex,
  resolveSessionId,
  STAGNATION_GOLDEN_DIR,
} from "./utils";

export interface StagnationExtractOverrides {
  id?: string;
  dimension?: StagnationEvalCase["metadata"]["dimension"];
  difficulty?: "easy" | "medium" | "hard";
}

/** State attributes kept for element signatures (matches stagnation.ts STATE_ATTRS) */
const STATE_ATTRS = [
  "disabled",
  "checked",
  "aria-expanded",
  "value",
  "selected",
  "aria-selected",
];

/**
 * Extract a stagnation eval case from a trace session.
 */
export function extractStagnationCase(
  sessionIdPrefix: string,
  overrides?: StagnationExtractOverrides,
): StagnationEvalCase {
  const sessionId = resolveSessionId(sessionIdPrefix);
  const entries = readTrace(sessionId);
  const sessions = readSessionIndex();
  const session = sessions.find((s: any) => s.sessionId === sessionId) as any;

  if (!session) {
    throw new Error(`Session metadata not found for: ${sessionId}`);
  }

  const sortedEntries = (entries as any[])
    .filter((e) => e.turnNumber)
    .sort((a, b) => a.turnNumber - b.turnNumber);

  if (sortedEntries.length === 0) {
    throw new Error(`No entries with turn numbers in session: ${sessionId}`);
  }

  // Extract compact snapshots
  const snapshots = sortedEntries.map((entry) => {
    const snapshot = entry.snapshot ?? {};
    const elements = (entry.elements ?? []).map((el: any) => {
      const attrs: Record<string, string> = {};
      for (const attr of STATE_ATTRS) {
        if (el.attributes?.[attr] !== undefined) {
          attrs[attr] = String(el.attributes[attr]);
        }
      }
      return {
        tagName: el.tagName ?? "",
        text: (el.text ?? "").slice(0, 30),
        attributes: attrs,
      };
    });

    return {
      turnNumber: entry.turnNumber as number,
      url: snapshot.url ?? "",
      title: snapshot.title ?? "",
      elements,
    };
  });

  // Find escalation events in trace
  const escalationEvents: Array<{ turn: number; stagnantTurns: number }> = [];
  for (const entry of sortedEntries) {
    const events = entry.events ?? [];
    for (const event of events) {
      if (
        event.type === "escalation" ||
        event.type === "stagnation" ||
        event.type === "agent_stagnation"
      ) {
        escalationEvents.push({
          turn: entry.turnNumber,
          stagnantTurns: event.stagnantTurns ?? 0,
        });
      }
    }
    // Also check llmResponse for escalation signals
    if (entry.llmResponse?.escalation) {
      escalationEvents.push({
        turn: entry.turnNumber,
        stagnantTurns: entry.llmResponse.stagnantTurns ?? 0,
      });
    }
  }

  const outcome = session.outcome ?? "completed";
  const turnCount = session.turnCount ?? sortedEntries.length;
  const sessionWasStuck = escalationEvents.length > 0 || outcome === "max_turns";
  const shouldFire = sessionWasStuck;

  // Expected turn range: from reference ± 2 tolerance
  const expectedTurnRange = escalationEvents.length > 0
    ? {
        min: Math.max(1, escalationEvents[0].turn - 2),
        max: escalationEvents[0].turn + 2,
      }
    : undefined;

  const caseId =
    overrides?.id ??
    `stagnation-${sessionId.slice(0, 8)}`;

  return {
    id: caseId,
    sourceSessionId: sessionId,
    input: {
      snapshots,
    },
    expected: {
      escalation: { shouldFire, expectedTurnRange },
      sessionWasStuck,
    },
    reference: {
      escalationEvents,
      sessionOutcome: outcome,
      sessionTurnCount: turnCount,
    },
    metadata: {
      url: snapshots[0]?.url ?? session.startUrl ?? "",
      query: session.query ?? "",
      difficulty: overrides?.difficulty ?? "medium",
      tags: [
        "stagnation",
        sessionWasStuck ? "stuck" : "not-stuck",
      ],
      dimension: overrides?.dimension ?? (sessionWasStuck ? "false_negative" : "false_positive"),
    },
  };
}

/**
 * Batch-extract stagnation cases from available sessions.
 */
export function extractStagnationCasesFromSessions(
  options?: { max?: number },
): StagnationEvalCase[] {
  const sessions = readSessionIndex();
  const max = options?.max ?? Infinity;
  const cases: StagnationEvalCase[] = [];

  for (const session of sessions as any[]) {
    if (cases.length >= max) break;
    try {
      cases.push(extractStagnationCase((session as any).sessionId));
    } catch {
      // skip sessions that fail extraction
    }
  }

  return cases;
}

/**
 * Extract and save a stagnation case to disk.
 */
export function extractAndSaveStagnationCase(
  sessionIdPrefix: string,
  overrides?: StagnationExtractOverrides,
): string {
  const evalCase = extractStagnationCase(sessionIdPrefix, overrides);

  if (!existsSync(STAGNATION_GOLDEN_DIR)) {
    mkdirSync(STAGNATION_GOLDEN_DIR, { recursive: true });
  }

  const filename = `${evalCase.id}.json`;
  const outputPath = join(STAGNATION_GOLDEN_DIR, filename);
  writeFileSync(outputPath, JSON.stringify(evalCase, null, 2), "utf-8");
  return outputPath;
}
