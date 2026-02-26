/**
 * Planner eval case extractor.
 *
 * Reads trace sessions and produces PlannerEvalCase objects
 * for decompose and validateDone evaluation.
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { PlannerEvalCase, PlannerEvalMethod } from "./types";
import {
  readTrace,
  readSessionIndex,
  resolveSessionId,
  PLANNER_GOLDEN_DIR,
} from "./utils";

export interface PlannerExtractOverrides {
  id?: string;
  method?: PlannerEvalMethod;
  dimension?: PlannerEvalCase["metadata"]["dimension"];
  difficulty?: "easy" | "medium" | "hard";
}

/**
 * Extract a planner decompose eval case from a trace session.
 */
export function extractPlannerCase(
  sessionIdPrefix: string,
  overrides?: PlannerExtractOverrides,
): PlannerEvalCase {
  const sessionId = resolveSessionId(sessionIdPrefix);
  const entries = readTrace(sessionId);
  const sessions = readSessionIndex();
  const session = sessions.find((s: any) => s.sessionId === sessionId) as any;

  if (!session) {
    throw new Error(`Session metadata not found for: ${sessionId}`);
  }

  const firstEntry = (entries as any[])[0];
  if (!firstEntry) {
    throw new Error(`No trace entries found for session: ${sessionId}`);
  }

  const query = session.query ?? "";
  const turnCount = session.turnCount ?? entries.length;
  const outcome = session.outcome ?? "completed";
  const decomposition = session.planDecomposition;
  const difficultyAssessment = session.difficultyAssessment ?? "";

  // Count escalation events
  const escalationCount = (entries as any[]).filter(
    (e) => e.llmResponse?.escalation || e.events?.some?.((ev: any) => ev.type === "escalation"),
  ).length;

  // Extract page context from first entry
  const snapshot = firstEntry.snapshot ?? {};
  const pageTitle = snapshot.title ?? "";
  const pageUrl = snapshot.url ?? session.startUrl ?? "";
  const perception = firstEntry.perception?.interpretation;

  // Auto-derive expected difficulty from turn count + outcome
  const difficulty = deriveDifficulty(turnCount, outcome, escalationCount);

  // Auto-derive step count range
  const stepCountRange = {
    min: Math.max(2, Math.ceil(turnCount / 5)),
    max: Math.min(8, Math.ceil(turnCount / 3)),
  };

  // Auto-derive must-cover topics from query
  const mustCoverTopics = extractKeyTopics(query);

  const caseId =
    overrides?.id ??
    `planner-${sessionId.slice(0, 8)}-decompose`;

  return {
    id: caseId,
    sourceSessionId: sessionId,
    method: overrides?.method ?? "decompose",
    input: {
      query,
      pageTitle,
      pageUrl,
      perception,
    },
    expected: {
      difficulty,
      isMultiStep: turnCount > 5,
      stepCountRange,
      mustCoverTopics,
      antiPatterns: ["site-specific heuristics", "empty objectives"],
    },
    reference: {
      decomposition: decomposition
        ? { subtasks: decomposition.subtasks, steps: decomposition.steps, difficulty: difficultyAssessment }
        : undefined,
      sessionOutcome: outcome,
      sessionTurnCount: turnCount,
      escalationCount,
    },
    metadata: {
      url: pageUrl,
      query,
      difficulty: overrides?.difficulty ?? (turnCount > 20 ? "hard" : turnCount > 10 ? "medium" : "easy"),
      tags: ["planner", "decompose"],
      dimension: overrides?.dimension ?? "coverage",
    },
  };
}

/**
 * Extract validateDone cases by finding done_rejected events in trace.
 */
export function extractValidateDoneCases(
  sessionIdPrefix: string,
): PlannerEvalCase[] {
  const sessionId = resolveSessionId(sessionIdPrefix);
  const entries = readTrace(sessionId);
  const sessions = readSessionIndex();
  const session = sessions.find((s: any) => s.sessionId === sessionId) as any;

  if (!session) {
    throw new Error(`Session metadata not found for: ${sessionId}`);
  }

  const cases: PlannerEvalCase[] = [];
  const turnCount = session.turnCount ?? entries.length;
  const outcome = session.outcome ?? "completed";

  for (const entry of entries as any[]) {
    const events = entry.events ?? [];
    for (const event of events) {
      if (event.type === "done_rejected" || event.type === "validate_done_rejected") {
        const plan = event.plan ?? entry.planStatus?.subtasks?.map((s: any) => ({
          description: s.description ?? s,
          status: s.status ?? "pending",
        }));

        const caseId = `planner-${sessionId.slice(0, 8)}-validate-t${entry.turnNumber}`;

        cases.push({
          id: caseId,
          sourceSessionId: sessionId,
          method: "validateDone",
          input: {
            query: session.query ?? "",
            pageTitle: entry.snapshot?.title ?? "",
            pageUrl: entry.snapshot?.url ?? "",
            plan,
            doneSummary: event.summary ?? event.reason ?? "",
          },
          expected: {
            approved: false,
          },
          reference: {
            sessionOutcome: outcome,
            sessionTurnCount: turnCount,
            escalationCount: 0,
          },
          metadata: {
            url: entry.snapshot?.url ?? "",
            query: session.query ?? "",
            difficulty: "medium",
            tags: ["planner", "validateDone"],
            dimension: "done_validation",
          },
        });
      }
    }
  }

  return cases;
}

/**
 * Extract and save a planner case to disk.
 */
export function extractAndSavePlannerCase(
  sessionIdPrefix: string,
  overrides?: PlannerExtractOverrides,
): string {
  const evalCase = extractPlannerCase(sessionIdPrefix, overrides);

  if (!existsSync(PLANNER_GOLDEN_DIR)) {
    mkdirSync(PLANNER_GOLDEN_DIR, { recursive: true });
  }

  const filename = `${evalCase.id}.json`;
  const outputPath = join(PLANNER_GOLDEN_DIR, filename);
  writeFileSync(outputPath, JSON.stringify(evalCase, null, 2), "utf-8");
  return outputPath;
}

/**
 * Batch-extract all planner cases from available sessions.
 */
export function extractPlannerCasesFromSessions(
  options?: { max?: number },
): PlannerEvalCase[] {
  const sessions = readSessionIndex();
  const max = options?.max ?? Infinity;
  const cases: PlannerEvalCase[] = [];

  for (const session of sessions as any[]) {
    if (cases.length >= max) break;
    if (!session.planDecomposition) continue;

    try {
      cases.push(extractPlannerCase(session.sessionId));
    } catch {
      // skip sessions that fail extraction
    }
  }

  return cases;
}

// ── Derivation helpers ───────────────────────────────────────────────

function deriveDifficulty(
  turnCount: number,
  outcome: string,
  escalationCount: number,
): "simple" | "moderate" | "complex" | "extreme" {
  if (outcome === "max_turns") return "extreme";
  if (turnCount >= 20 || escalationCount > 0) return "complex";
  if (turnCount >= 10) return "moderate";
  return "simple";
}

function extractKeyTopics(query: string): string[] {
  // Extract key nouns/phrases from query — simple regex heuristic
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "as", "into", "through", "during",
    "before", "after", "above", "below", "between", "out", "off", "over",
    "under", "again", "further", "then", "once", "and", "but", "or", "nor",
    "not", "so", "too", "very", "just", "about", "up", "that", "this",
    "it", "its", "my", "me", "i", "you", "your", "we", "our", "they",
    "them", "their", "all", "each", "every", "both", "few", "more", "most",
    "other", "some", "such", "no", "only", "same", "than", "also", "how",
    "what", "which", "who", "whom", "where", "when", "why", "please",
    "go", "get", "make", "click", "find", "open", "close", "use",
  ]);

  const words = query
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  // Deduplicate
  return [...new Set(words)].slice(0, 8);
}
