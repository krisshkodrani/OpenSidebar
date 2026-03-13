import type {
  PerceptionBlockerType,
  PerceptionEvalCase,
  PerceptionRequiredSection,
} from "./types";
import { readPerceptionEvalCases } from "./utils";

const V6_SECTIONS: PerceptionRequiredSection[] = [
  "LOCATION",
  "CHANGES",
  "BLOCKERS",
  "VISUAL-ONLY",
  "AFFORDANCES",
];

const VALID_BLOCKER_TYPES = new Set<PerceptionBlockerType>([
  "nuisance",
  "relevant",
  "prereq",
  "mismatch",
]);

function extractReferencedTagIds(text: string): number[] {
  const ids: number[] = [];
  for (const match of text.matchAll(/\[(\d+)(?::[^\]]+)?\]/g)) {
    ids.push(Number(match[1]));
  }
  return ids;
}

function validateCase(evalCase: PerceptionEvalCase): {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const elementIds = new Set(evalCase.input.elements.map((el) => el.tag));
  const sections = evalCase.expected?.requiredSections ?? [];

  if (!evalCase.id) errors.push("missing id");
  if (!evalCase.sourceSessionId) errors.push("missing sourceSessionId");
  if (!Number.isFinite(evalCase.sourceTurn)) errors.push("invalid sourceTurn");
  if (!evalCase.input?.screenshotDataUrl?.startsWith("data:image/")) {
    errors.push("missing screenshotDataUrl");
  }
  if (!Array.isArray(evalCase.input?.elements)) errors.push("missing input.elements");
  if (!evalCase.input?.url) errors.push("missing input.url");
  if (!evalCase.input?.title) errors.push("missing input.title");

  if (sections.length !== V6_SECTIONS.length || sections.some((section, index) => section !== V6_SECTIONS[index])) {
    errors.push(`requiredSections must be exactly: ${V6_SECTIONS.join(", ")}`);
  }

  for (const blocker of evalCase.expected?.blockers ?? []) {
    if (!VALID_BLOCKER_TYPES.has(blocker.type)) {
      errors.push(`invalid blocker type: ${blocker.type}`);
    }
    if (!blocker.description?.trim()) {
      errors.push("blocker missing description");
    }
    if (blocker.tagId !== undefined && !elementIds.has(blocker.tagId)) {
      errors.push(`blocker tagId missing from elements: [${blocker.tagId}]`);
    }
  }

  for (const tagId of evalCase.expected?.mustMentionElements ?? []) {
    if (!elementIds.has(tagId)) {
      errors.push(`mustMentionElements tag missing from elements: [${tagId}]`);
    }
  }

  for (const fact of evalCase.expected?.visualOnlyContent ?? []) {
    const normalized = fact.trim().toLowerCase();
    if (!fact.trim()) {
      errors.push("visualOnlyContent contains empty string");
      continue;
    }
    if (
      normalized === "none." ||
      normalized === "none" ||
      normalized === "no text in images, canvas, charts, or svgs." ||
      normalized.includes("content dom inspection misses: none")
    ) {
      errors.push(`visualOnlyContent contains placeholder text: ${fact}`);
    }
    for (const tagId of extractReferencedTagIds(fact)) {
      if (elementIds.has(tagId)) {
        errors.push(`visualOnlyContent references DOM element [${tagId}]`);
      }
    }
  }

  if (evalCase.input.elements.length === 0) {
    warnings.push("elements array is empty; grounding-based expectations are weak");
  }

  return { errors, warnings };
}

export function validatePerceptionGoldenCases(): {
  valid: number;
  invalid: number;
  warningCount: number;
} {
  const cases = readPerceptionEvalCases();
  const seenIds = new Set<string>();
  let valid = 0;
  let invalid = 0;
  let warningCount = 0;

  for (const evalCase of cases) {
    const errors: string[] = [];
    if (seenIds.has(evalCase.id)) {
      errors.push(`duplicate id: ${evalCase.id}`);
    }
    seenIds.add(evalCase.id);

    const result = validateCase(evalCase);
    errors.push(...result.errors);
    warningCount += result.warnings.length;

    if (errors.length > 0) {
      invalid += 1;
      console.log(`  INVALID ${evalCase.id}: ${errors.join(", ")}`);
      for (const warning of result.warnings) {
        console.log(`    warning: ${warning}`);
      }
      continue;
    }

    valid += 1;
    const blockerCount = evalCase.expected.blockers?.length ?? 0;
    const mustMentionCount = evalCase.expected.mustMentionElements?.length ?? 0;
    const visualOnlyCount = evalCase.expected.visualOnlyContent?.length ?? 0;
    console.log(
      `  VALID   ${evalCase.id} (${evalCase.metadata.difficulty}, blockers=${blockerCount}, affordances=${mustMentionCount}, visual=${visualOnlyCount})`,
    );
    for (const warning of result.warnings) {
      console.log(`    warning: ${warning}`);
    }
  }

  return { valid, invalid, warningCount };
}
