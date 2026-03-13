/**
 * Perception eval scorer — pure functions, no API calls.
 *
 * Scores v6 perception output against expected annotations.
 */

import type { PerceptionEvalCase } from "./types";

const WEIGHTS = {
  sectionCompleteness: 0.15,
  blockerDetection: 0.30,
  affordanceGrounding: 0.25,
  visualOnlyRecall: 0.10,
  hallucination: 0.20,
};

const PASS_COMPOSITE = 0.70;
const PASS_BLOCKERS = 0.50;

export interface PerceptionScores {
  sectionCompleteness: number;
  blockerDetection: number;
  affordanceGrounding: number;
  visualOnlyRecall: number;
  hallucination: number;
  composite: number;
}

export function scorePerception(
  evalCase: PerceptionEvalCase,
  interpretation: string,
): PerceptionScores {
  const sc = scoreSectionCompleteness(evalCase.expected.requiredSections, interpretation);
  const bd = scoreBlockerDetection(evalCase.expected.blockers, interpretation);
  const ag = scoreAffordanceGrounding(
    evalCase.input.elements,
    evalCase.expected.mustMentionElements,
    interpretation,
  );
  const vr = scoreVisualOnlyRecall(evalCase.expected.visualOnlyContent, interpretation);
  const ha = scoreHallucination(evalCase.input.elements, interpretation);

  const composite =
    sc * WEIGHTS.sectionCompleteness +
    bd * WEIGHTS.blockerDetection +
    ag * WEIGHTS.affordanceGrounding +
    vr * WEIGHTS.visualOnlyRecall +
    ha * WEIGHTS.hallucination;

  return {
    sectionCompleteness: sc,
    blockerDetection: bd,
    affordanceGrounding: ag,
    visualOnlyRecall: vr,
    hallucination: ha,
    composite,
  };
}

export function isPass(scores: PerceptionScores): boolean {
  return scores.composite >= PASS_COMPOSITE && scores.blockerDetection >= PASS_BLOCKERS;
}

export function scoreSectionCompleteness(
  requiredSections: readonly string[],
  interpretation: string,
): number {
  if (requiredSections.length === 0) return 1.0;

  let found = 0;
  for (const section of requiredSections) {
    const pattern = new RegExp(`\\d+\\.\\s*${escapeRegex(section)}\\s*:`, "i");
    if (pattern.test(interpretation)) found++;
  }
  return found / requiredSections.length;
}

export function scoreBlockerDetection(
  expectedBlockers: PerceptionEvalCase["expected"]["blockers"],
  interpretation: string,
): number {
  if (!expectedBlockers || expectedBlockers.length === 0) return 1.0;

  const blockerSection = extractSection(interpretation, "BLOCKERS").toUpperCase();
  if (!blockerSection) return 0;

  let matched = 0;
  for (const blocker of expectedBlockers) {
    const typeFound = blockerSection.includes(blocker.type.toUpperCase());
    const descWords = blocker.description
      .split(/\s+/)
      .map((word) => word.replace(/[^A-Za-z0-9-]/g, ""))
      .filter((word) => word.length > 3)
      .slice(0, 5);
    const descFound =
      descWords.length === 0 ||
      descWords.some((word) => blockerSection.includes(word.toUpperCase()));
    const tagFound =
      blocker.tagId == null ||
      blockerSection.includes(`[${blocker.tagId}]`);

    if (typeFound && descFound && tagFound) matched += 1;
    else if ((typeFound && descFound) || (typeFound && tagFound) || (descFound && tagFound)) matched += 0.75;
    else if (typeFound || descFound || tagFound) matched += 0.4;
  }

  return matched / expectedBlockers.length;
}

export function scoreAffordanceGrounding(
  elements: Array<{ tag: number; tagName: string; text: string; role?: string }>,
  mustMentionElements: number[] | undefined,
  interpretation: string,
): number {
  const affordanceSection = extractSection(interpretation, "AFFORDANCES");
  if (!affordanceSection) return 0;

  const validElements = new Map(elements.map((el) => [el.tag, el]));
  const affordanceLines = affordanceSection
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (affordanceLines.length === 1 && /^none\b/i.test(affordanceLines[0])) {
    return mustMentionElements && mustMentionElements.length > 0 ? 0 : 1;
  }

  const taggedLines = affordanceLines
    .map((line) => {
      const match = line.match(/^\[(\d+)\]\s+(.+)/);
      return match
        ? { tagId: parseInt(match[1], 10), description: match[2].trim() }
        : null;
    })
    .filter((line): line is { tagId: number; description: string } => line !== null);

  if (taggedLines.length === 0) return 0;

  let grounded = 0;
  for (const line of taggedLines) {
    const element = validElements.get(line.tagId);
    if (!element) continue;
    if (descriptionMatchesElement(line.description, element)) grounded++;
  }

  const groundingScore = grounded / taggedLines.length;

  if (!mustMentionElements || mustMentionElements.length === 0) {
    return groundingScore;
  }

  let covered = 0;
  for (const tagId of mustMentionElements) {
    if (taggedLines.some((line) => line.tagId === tagId)) covered++;
  }
  const coverageScore = covered / mustMentionElements.length;

  return (groundingScore + coverageScore) / 2;
}

export function scoreVisualOnlyRecall(
  expectedVisualOnly: string[] | undefined,
  interpretation: string,
): number {
  if (!expectedVisualOnly || expectedVisualOnly.length === 0) return 1.0;

  const visualOnlySection = extractSection(interpretation, "VISUAL-ONLY").toUpperCase();
  if (!visualOnlySection) return 0;

  let matched = 0;
  for (const expected of expectedVisualOnly) {
    const words = expected
      .split(/\s+/)
      .map((word) => word.replace(/[^A-Za-z0-9-]/g, ""))
      .filter((word) => word.length > 3)
      .slice(0, 6);
    if (words.length === 0 || words.some((word) => visualOnlySection.includes(word.toUpperCase()))) {
      matched++;
    }
  }

  return matched / expectedVisualOnly.length;
}

export function scoreHallucination(
  elements: Array<{ tag: number }>,
  interpretation: string,
): number {
  const validIds = new Set(elements.map((el) => el.tag));
  const tagRefs = interpretation.matchAll(/\[(\d+)\]/g);
  const referencedIds = new Set<number>();

  for (const match of tagRefs) {
    referencedIds.add(parseInt(match[1], 10));
  }

  if (referencedIds.size === 0) return 1.0;

  let phantoms = 0;
  for (const id of referencedIds) {
    if (!validIds.has(id)) phantoms++;
  }

  const penalty = Math.min(1.0, phantoms * 0.2);
  return 1.0 - penalty;
}

function extractSection(text: string, sectionName: string): string {
  const pattern = new RegExp(
    `\\d+\\.\\s*${escapeRegex(sectionName)}\\s*:\\s*([\\s\\S]*?)(?=\\n\\d+\\.\\s*[A-Z-]+\\s*:|$)`,
    "i",
  );
  const match = text.match(pattern);
  return match ? match[1].trim() : "";
}

function descriptionMatchesElement(
  description: string,
  element: { tagName: string; text: string; role?: string },
): boolean {
  const lower = description.toLowerCase();
  const tagName = element.tagName.toLowerCase();
  const role = element.role?.toLowerCase();
  const text = element.text.toLowerCase().slice(0, 40);

  const tagMatch = lower.includes(tagName) || (!!role && lower.includes(role));
  const textMatch =
    text.length === 0 ||
    lower.includes(text.slice(0, Math.min(15, text.length))) ||
    text.includes(lower.slice(0, Math.min(15, lower.length)));

  if (text.length <= 3) return tagMatch;
  return tagMatch || textMatch;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
