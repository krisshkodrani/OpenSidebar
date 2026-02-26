/**
 * Perception eval case extractor.
 *
 * Reads trace turns that include perception data (screenshot + elements)
 * and produces PerceptionEvalCase objects with auto-derived expected annotations.
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { PerceptionEvalCase, PerceptionMode } from "./types";
import {
  readTrace,
  readSessionIndex,
  resolveSessionId,
  PERCEPTION_GOLDEN_DIR,
} from "./utils";

export interface PerceptionExtractOverrides {
  id?: string;
  dimension?: PerceptionEvalCase["metadata"]["dimension"];
  difficulty?: "easy" | "medium" | "hard";
  notes?: string;
  pageType?: string;
  signal?: { status: "done" | "not_done" | "unclear"; scope: "subtask" | "objective" };
}

/**
 * Extract a single perception eval case from a trace turn.
 */
export function extractPerceptionCase(
  sessionIdPrefix: string,
  turnNumber: number,
  overrides?: PerceptionExtractOverrides,
): PerceptionEvalCase {
  const sessionId = resolveSessionId(sessionIdPrefix);
  const entries = readTrace(sessionId);
  const sessions = readSessionIndex();
  const session = sessions.find((s: any) => s.sessionId === sessionId) as any;

  if (!session) {
    throw new Error(`Session metadata not found for: ${sessionId}`);
  }

  const turn = (entries as any[]).find((e) => e.turnNumber === turnNumber);
  if (!turn) {
    const available = (entries as any[])
      .filter((e) => e.turnNumber)
      .map((e) => e.turnNumber)
      .join(", ");
    throw new Error(
      `Turn ${turnNumber} not found in session ${sessionId}. Available: ${available}`,
    );
  }

  // Extract perception data from the trace turn
  const perception = turn.perception;
  if (!perception) {
    throw new Error(
      `Turn ${turnNumber} has no perception data. Only turns with screenshots can be extracted.`,
    );
  }

  const screenshotDataUrl = perception.screenshotDataUrl ?? "";
  if (!screenshotDataUrl) {
    throw new Error(`Turn ${turnNumber} has no screenshot in perception data.`);
  }

  const snapshot = turn.snapshot ?? {};
  // Elements live at top-level in trace entries, not inside snapshot
  const elements = turn.elements ?? snapshot.elements ?? [];
  const interpretation = perception.interpretation ?? "";
  const model = perception.model ?? "unknown";
  const providerId = perception.providerId;
  const durationMs = perception.durationMs ?? 0;

  // Auto-derive expected annotations from the reference interpretation
  const derived = deriveExpected(interpretation, elements);

  // Apply overrides
  if (overrides?.pageType) derived.pageType = overrides.pageType;
  if (overrides?.signal) derived.completionSignal = overrides.signal;

  const caseId =
    overrides?.id ??
    `perception-${sessionId.slice(0, 8)}-t${turnNumber}`;

  // Scroll: trace stores scrollY as a number, convert to {y, maxY} object
  const scrollY = typeof snapshot.scrollY === "number" ? snapshot.scrollY : 0;

  return {
    id: caseId,
    sourceSessionId: sessionId,
    sourceTurn: turnNumber,
    input: {
      screenshotDataUrl,
      elements: elements.map((el: any) => ({
        tag: el.tag,
        tagName: el.tagName,
        text: el.text ?? "",
        role: el.role,
        attributes: el.attributes ?? {},
      })),
      url: snapshot.url ?? session.startUrl ?? "",
      title: snapshot.title ?? "",
      scroll: { y: scrollY, maxY: scrollY }, // maxY not stored in trace; approximate
      subtask: turn.subtask,
      objective: session.query,
      toolProfile: turn.toolProfile,
    },
    expected: {
      mode: derived.mode,
      requiredSections: derived.requiredSections,
      pageType: derived.pageType,
      blockers: derived.blockers,
      completionSignal: derived.completionSignal,
      notes: overrides?.notes,
    },
    reference: {
      interpretation,
      model,
      providerId,
      durationMs,
    },
    metadata: {
      url: snapshot.url ?? session.startUrl ?? "",
      query: session.query ?? "",
      difficulty: overrides?.difficulty ?? "medium",
      tags: ["perception", ...(overrides?.dimension ? [overrides.dimension] : [])],
      dimension: overrides?.dimension,
    },
  };
}

/**
 * Batch-extract all perception turns from a session.
 */
export function extractPerceptionCasesFromSession(
  sessionIdPrefix: string,
  options?: { max?: number },
): PerceptionEvalCase[] {
  const sessionId = resolveSessionId(sessionIdPrefix);
  const entries = readTrace(sessionId);
  const max = options?.max ?? Infinity;

  const perceptionTurns = (entries as any[]).filter(
    (e) => e.turnNumber && e.perception?.screenshotDataUrl,
  );

  const cases: PerceptionEvalCase[] = [];
  for (const turn of perceptionTurns.slice(0, max)) {
    try {
      cases.push(extractPerceptionCase(sessionId, turn.turnNumber));
    } catch {
      // skip turns that fail extraction
    }
  }
  return cases;
}

/**
 * Extract and save a perception case to disk.
 */
export function extractAndSavePerceptionCase(
  sessionIdPrefix: string,
  turnNumber: number,
  overrides?: PerceptionExtractOverrides,
): string {
  const evalCase = extractPerceptionCase(sessionIdPrefix, turnNumber, overrides);

  if (!existsSync(PERCEPTION_GOLDEN_DIR)) {
    mkdirSync(PERCEPTION_GOLDEN_DIR, { recursive: true });
  }

  const filename = `${evalCase.id}.json`;
  const outputPath = join(PERCEPTION_GOLDEN_DIR, filename);
  writeFileSync(outputPath, JSON.stringify(evalCase, null, 2), "utf-8");
  return outputPath;
}

// ── Derivation helpers ───────────────────────────────────────────────

const ORIENTATION_SECTIONS = ["LAYOUT", "STATE", "BLOCKERS", "VISUAL-ONLY", "HAZARDS"];
const FOCUSED_SECTIONS = ["SUBTASK_STATE", "ACTIONABLE", "BLOCKERS", "VISUAL-ONLY", "COMPLETION_SIGNAL"];

interface DerivedExpected {
  mode: PerceptionMode;
  requiredSections: string[];
  pageType?: string;
  blockers: Array<{ type: "nuisance" | "relevant" | "prereq"; description: string; tagId?: number }>;
  completionSignal?: { status: "done" | "not_done" | "unclear"; scope: "subtask" | "objective" } | null;
}

function deriveExpected(
  interpretation: string,
  elements: any[],
): DerivedExpected {
  // Detect mode from section headers
  const hasFocused = /\bSUBTASK_STATE\b/i.test(interpretation);
  const hasOrientation = /\bLAYOUT\b/i.test(interpretation) && !hasFocused;
  const mode: PerceptionMode = hasFocused ? "focused" : "orientation";

  // Detect present sections
  const allSections = mode === "focused" ? FOCUSED_SECTIONS : ORIENTATION_SECTIONS;
  const requiredSections = allSections.filter((section) => {
    const pattern = new RegExp(`\\d+\\.\\s*${section}\\s*:`, "i");
    return pattern.test(interpretation);
  });

  // Extract blockers
  const blockers: DerivedExpected["blockers"] = [];
  const blockerPattern =
    /\b(NUISANCE|RELEVANT|PREREQ)\b\s*(?:\[(\d+)\])?\s*"?([^"\n]+)"?/gi;
  let match;
  while ((match = blockerPattern.exec(interpretation)) !== null) {
    const type = match[1].toLowerCase() as "nuisance" | "relevant" | "prereq";
    const tagId = match[2] ? parseInt(match[2], 10) : undefined;
    const description = match[3].trim().slice(0, 200);
    blockers.push({ type, description, ...(tagId !== undefined && { tagId }) });
  }

  // Extract completion signal
  let completionSignal: DerivedExpected["completionSignal"] = null;
  const signalMatch = interpretation.match(
    /(?:COMPLETION_SIGNAL|OBJECTIVE_CHECK):\s*(DONE|NOT_DONE|UNCLEAR)\b/i,
  );
  if (signalMatch) {
    const raw = signalMatch[1].toUpperCase();
    const status = raw === "DONE" ? "done" : raw === "NOT_DONE" ? "not_done" : "unclear";
    const scope = hasFocused ? "subtask" : "objective";
    completionSignal = { status, scope } as const;
  }

  return {
    mode,
    requiredSections,
    blockers: blockers.length > 0 ? blockers : [],
    completionSignal,
  };
}
