import { MemoryType } from "../../types";

const PROCEDURE_PATTERNS = [
  /\b(step \d|first,? |then |next,? |finally )/i,
  /\bhow to\b/i,
  /\b(click|navigate|type|scroll|select|fill|submit)\b.*\bthen\b/i,
  /\b\d+\.\s/,
];

const PREFERENCE_PATTERNS = [
  /\b(always|never|prefer|avoid|don't|do not|should)\b/i,
  /\buser (wants|prefers|likes|hates)\b/i,
  /\bremember (to|that)\b/i,
];

/**
 * Heuristically classify memory content into a MemoryType.
 * Returns explicit type if provided, otherwise pattern-matches.
 */
export function classifyMemoryType(
  content: string,
  explicit?: MemoryType,
): { type: MemoryType; confidence: number } {
  if (explicit) return { type: explicit, confidence: 1.0 };

  if (PROCEDURE_PATTERNS.some((p) => p.test(content))) {
    return { type: "procedure", confidence: 0.8 };
  }
  if (PREFERENCE_PATTERNS.some((p) => p.test(content))) {
    return { type: "preference", confidence: 0.8 };
  }
  return { type: "fact", confidence: 0.8 };
}
