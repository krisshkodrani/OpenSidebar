/**
 * Context compression eval case extractor.
 *
 * Reads trace sessions and reconstructs conversation history
 * at specific turns for compression evaluation.
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { ContextEvalCase } from "./types";
import {
  readTrace,
  readSessionIndex,
  resolveSessionId,
  CONTEXT_GOLDEN_DIR,
} from "./utils";

export interface ContextExtractOverrides {
  id?: string;
  dimension?: ContextEvalCase["metadata"]["dimension"];
  difficulty?: "easy" | "medium" | "hard";
  maxContextTokens?: number;
}

/**
 * Extract a context compression eval case from a specific trace turn.
 */
export function extractContextCase(
  sessionIdPrefix: string,
  turnNumber: number,
  overrides?: ContextExtractOverrides,
): ContextEvalCase {
  const sessionId = resolveSessionId(sessionIdPrefix);
  const entries = readTrace(sessionId);
  const sessions = readSessionIndex();
  const session = sessions.find((s: any) => s.sessionId === sessionId) as any;

  if (!session) {
    throw new Error(`Session metadata not found for: ${sessionId}`);
  }

  // Collect entries up to target turn
  const targetEntries = (entries as any[]).filter(
    (e) => e.turnNumber && e.turnNumber <= turnNumber,
  );

  if (targetEntries.length === 0) {
    throw new Error(`No entries found up to turn ${turnNumber} in session ${sessionId}`);
  }

  const lastEntry = targetEntries[targetEntries.length - 1];
  const snapshot = lastEntry.snapshot ?? {};
  const elements = lastEntry.elements ?? [];

  // Reconstruct conversation history from trace messages
  const history = reconstructHistory(targetEntries);

  // Find original query from first user message
  const originalQuery = session.query ?? findOriginalQuery(history);

  // Extract plan status from planner events
  const planStatus = extractPlanStatus(targetEntries);

  // Extract perception
  const perception = lastEntry.perception?.interpretation;

  // Auto-derive expected compression level from turn count
  const historyLength = history.length;
  const expectedLevel = deriveExpectedLevel(historyLength);

  // Auto-derive token reduction target
  const tokenReductionMin = expectedLevel === "light" ? 0.3
    : expectedLevel === "medium" ? 0.5
    : expectedLevel === "heavy" ? 0.7
    : undefined;

  // Extract error patterns from tool results
  const errorPatterns = extractErrorPatterns(history);
  const keyFacts = errorPatterns.length > 0 ? errorPatterns : undefined;

  const caseId =
    overrides?.id ??
    `context-${sessionId.slice(0, 8)}-t${turnNumber}`;

  return {
    id: caseId,
    sourceSessionId: sessionId,
    sourceTurn: turnNumber,
    input: {
      history,
      snapshot: {
        url: snapshot.url ?? "",
        title: snapshot.title ?? "",
        elementCount: snapshot.elementCount ?? elements.length,
        scrollY: snapshot.scrollY ?? 0,
      },
      elements: elements.slice(0, 100).map((el: any) => ({
        tag: el.tag,
        tagName: el.tagName,
        text: (el.text ?? "").slice(0, 80),
        role: el.role,
        attributes: el.attributes ?? {},
      })),
      originalQuery,
      planStatus: planStatus ?? undefined,
      maxContextTokens: overrides?.maxContextTokens ?? 32000,
      perception,
    },
    expected: {
      mustPreserve: {
        originalQuery: true,
        planStatus: planStatus !== null,
        recentToolResults: 2,
        errorPatterns: keyFacts,
        keyFacts,
      },
      expectedLevel,
      tokenReductionMin,
    },
    metadata: {
      url: snapshot.url ?? session.startUrl ?? "",
      query: session.query ?? "",
      historyLength,
      difficulty: overrides?.difficulty ?? (historyLength > 100 ? "hard" : historyLength > 50 ? "medium" : "easy"),
      tags: ["context", expectedLevel],
      dimension: overrides?.dimension ?? "goal_amnesia",
    },
  };
}

/**
 * Auto-extract at turn 30, 60, 100, and final turn.
 */
export function extractContextCasesFromSession(
  sessionIdPrefix: string,
  options?: { max?: number },
): ContextEvalCase[] {
  const sessionId = resolveSessionId(sessionIdPrefix);
  const entries = readTrace(sessionId);
  const max = options?.max ?? Infinity;

  const turnNumbers = (entries as any[])
    .filter((e) => e.turnNumber)
    .map((e) => e.turnNumber as number);

  if (turnNumbers.length === 0) return [];

  const maxTurn = Math.max(...turnNumbers);
  const targets = [30, 60, 100, maxTurn].filter(
    (t) => t <= maxTurn && turnNumbers.includes(t),
  );

  // Deduplicate and sort
  const uniqueTargets = [...new Set(targets)].sort((a, b) => a - b);

  const cases: ContextEvalCase[] = [];
  for (const turn of uniqueTargets) {
    if (cases.length >= max) break;
    try {
      cases.push(extractContextCase(sessionId, turn));
    } catch {
      // skip turns that fail extraction
    }
  }
  return cases;
}

/**
 * Extract and save a context case to disk.
 */
export function extractAndSaveContextCase(
  sessionIdPrefix: string,
  turnNumber: number,
  overrides?: ContextExtractOverrides,
): string {
  const evalCase = extractContextCase(sessionIdPrefix, turnNumber, overrides);

  if (!existsSync(CONTEXT_GOLDEN_DIR)) {
    mkdirSync(CONTEXT_GOLDEN_DIR, { recursive: true });
  }

  const filename = `${evalCase.id}.json`;
  const outputPath = join(CONTEXT_GOLDEN_DIR, filename);
  writeFileSync(outputPath, JSON.stringify(evalCase, null, 2), "utf-8");
  return outputPath;
}

// ── Helpers ──────────────────────────────────────────────────────────

function reconstructHistory(entries: any[]): ContextEvalCase["input"]["history"] {
  const history: ContextEvalCase["input"]["history"] = [];

  for (const entry of entries) {
    const messages = entry.llmRequest?.messages;
    if (!messages || !Array.isArray(messages)) continue;

    // Skip system messages (index 0), take the rest
    for (const msg of messages) {
      if (msg.role === "system") continue;
      history.push({
        role: msg.role,
        content: typeof msg.content === "string" ? msg.content : null,
        tool_calls: msg.tool_calls,
        tool_call_id: msg.tool_call_id,
      });
    }
  }

  // Deduplicate: trace entries may overlap on messages
  // Keep unique by stringified content (simple heuristic)
  const seen = new Set<string>();
  const deduped: typeof history = [];
  for (const msg of history) {
    const key = `${msg.role}:${msg.content?.slice(0, 100) ?? ""}:${msg.tool_call_id ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(msg);
    }
  }

  return deduped;
}

function findOriginalQuery(history: ContextEvalCase["input"]["history"]): string {
  for (const msg of history) {
    if (msg.role === "user" && msg.content) return msg.content;
  }
  return "";
}

function extractPlanStatus(
  entries: any[],
): { subtasks: { description: string; status: string }[]; currentIndex: number } | null {
  // Walk entries in reverse to find the most recent plan status
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    const events = entry.events ?? [];
    for (const event of events) {
      if (event.type === "task_progress" && event.subtasks) {
        return {
          subtasks: event.subtasks.map((s: any) => ({
            description: s.description ?? s,
            status: s.status ?? "pending",
          })),
          currentIndex: event.currentIndex ?? 0,
        };
      }
    }
    // Also check tool results that contain plan updates
    if (entry.toolResult?.name === "update_plan" && entry.toolResult?.result) {
      try {
        const plan = typeof entry.toolResult.result === "string"
          ? JSON.parse(entry.toolResult.result)
          : entry.toolResult.result;
        if (plan.subtasks) {
          return {
            subtasks: plan.subtasks.map((s: any) => ({
              description: s.description ?? s,
              status: s.status ?? "pending",
            })),
            currentIndex: plan.currentIndex ?? 0,
          };
        }
      } catch { /* skip */ }
    }
  }
  return null;
}

function extractErrorPatterns(history: ContextEvalCase["input"]["history"]): string[] {
  const errors: string[] = [];
  for (const msg of history) {
    if (msg.role === "tool" && msg.content) {
      const content = msg.content;
      if (content.includes("Error:") || content.includes("error:")) {
        // Extract the error line
        const errorLine = content
          .split("\n")
          .find((l) => /error:/i.test(l));
        if (errorLine) {
          errors.push(errorLine.trim().slice(0, 200));
        }
      }
    }
  }
  return [...new Set(errors)].slice(0, 5);
}

function deriveExpectedLevel(
  historyLength: number,
): "none" | "light" | "medium" | "heavy" {
  if (historyLength >= 100) return "heavy";
  if (historyLength >= 60) return "medium";
  if (historyLength >= 30) return "light";
  return "none";
}
