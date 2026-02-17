/**
 * Trace-to-eval converter.
 * Reads a trace file, extracts eval cases using various strategies.
 */

import { existsSync, mkdirSync } from "fs";
import { appendFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import type { EvalCase } from "./types";
import { readTrace, readSessionIndex, CASES_DIR, resolveSessionId } from "./utils";

type Strategy = "first-turn" | "any-turn" | "recovery" | "escalation" | "all";

/**
 * Convert a trace session into eval cases.
 * Returns the number of cases generated.
 */
export async function convertSession(
  sessionIdPrefix: string,
  strategy: Strategy = "all",
  maxCases = 50,
): Promise<number> {
  const sessionId = resolveSessionId(sessionIdPrefix);
  const entries = readTrace(sessionId);
  const sessions = readSessionIndex();
  const session = sessions.find((s: any) => s.sessionId === sessionId) as any;

  if (!session) {
    throw new Error(`Session metadata not found in index for: ${sessionId}`);
  }

  if (!existsSync(CASES_DIR)) {
    mkdirSync(CASES_DIR, { recursive: true });
  }

  const outputFile = join(CASES_DIR, `${sessionId}.jsonl`);
  const cases: EvalCase[] = [];

  for (const entry of entries) {
    const turn = entry as any;
    const strategies = getStrategies(strategy, turn, entries as any[]);

    for (const s of strategies) {
      if (cases.length >= maxCases) break;

      const evalCase = buildCase(s, turn, session);
      if (evalCase) {
        cases.push(evalCase);
      }
    }
  }

  // Write cases to JSONL
  if (cases.length > 0) {
    const lines = cases.map((c) => JSON.stringify(c)).join("\n") + "\n";
    await appendFile(outputFile, lines);
  }

  return cases.length;
}

function getStrategies(
  requested: Strategy,
  turn: any,
  allTurns: any[],
): ("first-turn" | "any-turn" | "recovery" | "escalation")[] {
  if (requested !== "all") {
    return matchesStrategy(requested as any, turn, allTurns) ? [requested as any] : [];
  }

  // "all" — extract whichever strategies apply
  const result: ("first-turn" | "any-turn" | "recovery" | "escalation")[] = [];
  if (turn.turnNumber === 1) result.push("first-turn");
  if (hasToolFailureBefore(turn.turnNumber, allTurns)) result.push("recovery");
  if (turn.events?.some((e: any) => e.type === "escalation" || e.type === "stuck_signal")) {
    result.push("escalation");
  }
  if (result.length === 0) result.push("any-turn");
  return result;
}

function matchesStrategy(
  strategy: "first-turn" | "any-turn" | "recovery" | "escalation",
  turn: any,
  allTurns: any[],
): boolean {
  switch (strategy) {
    case "first-turn":
      return turn.turnNumber === 1;
    case "recovery":
      return hasToolFailureBefore(turn.turnNumber, allTurns);
    case "escalation":
      return turn.events?.some((e: any) => e.type === "escalation" || e.type === "stuck_signal") ?? false;
    case "any-turn":
      return true;
  }
}

function hasToolFailureBefore(turnNumber: number, allTurns: any[]): boolean {
  const prevTurn = allTurns.find((t: any) => t.turnNumber === turnNumber - 1);
  if (!prevTurn) return false;
  return prevTurn.toolExecutions?.some((te: any) => !te.success) ?? false;
}

function buildCase(
  strategy: "first-turn" | "any-turn" | "recovery" | "escalation",
  turn: any,
  session: any,
): EvalCase | null {
  const toolCalls = turn.llmResponse?.toolCalls ?? [];

  // Skip turns with no tool calls and no text (empty response)
  if (toolCalls.length === 0 && !turn.llmResponse?.content) return null;

  const expectedToolCalls = toolCalls.map((tc: any) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments);
    } catch { /* keep empty */ }
    return { toolName: tc.function.name, args };
  });

  const difficulty = strategy === "first-turn"
    ? "easy" as const
    : strategy === "escalation"
      ? "hard" as const
      : "medium" as const;

  return {
    id: randomUUID(),
    sourceSessionId: session.sessionId,
    sourceTurn: turn.turnNumber,
    strategy,
    input: {
      systemPrompt: "", // Will be reconstructed by runner from elements
      conversationHistory: [], // Placeholder — full history from trace
      tools: [], // Will be populated by runner
      model: turn.llmRequest?.model ?? "unknown",
    },
    expected: {
      toolCalls: expectedToolCalls,
      text: turn.llmResponse?.content ?? null,
    },
    metadata: {
      url: turn.snapshot?.url ?? "",
      query: session.query ?? "",
      sessionOutcome: session.outcome ?? "unknown",
      difficulty,
      tags: [strategy, ...(turn.events?.map((e: any) => e.type) ?? [])],
    },
    promptQuality: {
      promptVersion: "baseline",
      track:
        strategy === "escalation"
          ? "human_escalation"
          : strategy === "recovery"
            ? "orchestrator_lane_isolation"
            : "core_task_success",
      expectedEscalation: strategy === "escalation" ? "requested" : "none",
      mustNot: [],
    },
  };
}
