/**
 * Perception eval case extractor.
 *
 * Reads trace turns that include perception data (screenshot + elements)
 * and produces PerceptionEvalCase objects with auto-derived expected annotations.
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type {
  PerceptionBlockerType,
  PerceptionEvalCase,
  PerceptionRequiredSection,
} from "./types";
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
  mustMentionElements?: number[];
  visualOnlyContent?: string[];
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
  if (overrides?.mustMentionElements) {
    derived.mustMentionElements = overrides.mustMentionElements;
  }
  if (overrides?.visualOnlyContent) {
    derived.visualOnlyContent = overrides.visualOnlyContent;
  }

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
    },
    expected: {
      requiredSections: derived.requiredSections,
      pageType: derived.pageType,
      blockers: derived.blockers,
      mustMentionElements: derived.mustMentionElements,
      visualOnlyContent: derived.visualOnlyContent,
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

const V6_SECTIONS: PerceptionRequiredSection[] = [
  "LOCATION",
  "CHANGES",
  "BLOCKERS",
  "VISUAL-ONLY",
  "AFFORDANCES",
];

interface DerivedExpected {
  requiredSections: PerceptionRequiredSection[];
  pageType?: string;
  blockers: Array<{ type: PerceptionBlockerType; description: string; tagId?: number }>;
  mustMentionElements?: number[];
  visualOnlyContent?: string[];
}

function deriveExpected(
  interpretation: string,
  elements: any[],
): DerivedExpected {
  // Detect present sections
  const requiredSections = V6_SECTIONS.filter((section) => {
    const pattern = new RegExp(`\\d+\\.\\s*${section}\\s*:`, "i");
    return pattern.test(interpretation);
  });

  // Extract blockers
  const blockers: DerivedExpected["blockers"] = [];
  const blockerPattern =
    /\b(NUISANCE|RELEVANT|PREREQ|MISMATCH)\b\s*(?:\[(\d+)\])?\s*"?([^"\n]+)"?/gi;
  let match;
  while ((match = blockerPattern.exec(interpretation)) !== null) {
    const type = match[1].toLowerCase() as PerceptionBlockerType;
    const tagId = match[2] ? parseInt(match[2], 10) : undefined;
    const description = match[3].trim().slice(0, 200);
    blockers.push({ type, description, ...(tagId !== undefined && { tagId }) });
  }

  const mustMentionElements = extractMentionedElementIds(interpretation, elements);
  const visualOnlyContent = extractVisualOnlyFacts(interpretation);

  return {
    requiredSections,
    blockers: blockers.length > 0 ? blockers : [],
    mustMentionElements: mustMentionElements.length > 0 ? mustMentionElements : undefined,
    visualOnlyContent: visualOnlyContent.length > 0 ? visualOnlyContent : undefined,
  };
}

function extractMentionedElementIds(interpretation: string, elements: any[]): number[] {
  const availableIds = new Set(
    elements
      .map((element) => element?.tag)
      .filter((tag): tag is number => typeof tag === "number"),
  );
  const found = new Set<number>();

  for (const match of interpretation.matchAll(/\[(\d+)\]/g)) {
    const id = Number.parseInt(match[1], 10);
    if (availableIds.has(id)) {
      found.add(id);
    }
  }

  return Array.from(found).sort((a, b) => a - b);
}

function extractVisualOnlyFacts(interpretation: string): string[] {
  const sectionMatch = interpretation.match(
    /\bVISUAL-ONLY\s*:\s*([\s\S]*?)(?:\n\s*\d+\.\s*[A-Z-]+\s*:|$)/i,
  );
  if (!sectionMatch) {
    return [];
  }

  return sectionMatch[1]
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 8);
}
