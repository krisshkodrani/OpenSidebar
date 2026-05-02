/**
 * Count explicit numbered steps in a user query.
 * Matches patterns like "Step 1:", "1.", "1)", and sequential markers.
 * Returns the number of distinct steps detected.
 */
export function countExplicitSteps(query: string): number {
  // Match numbered patterns: "Step 1", "Step 2", "1.", "2.", "1)", "2)"
  const numberedStepPattern = /(?:^|\n)\s*(?:step\s+)?(\d+)[.):\s]/gim;
  const numbers = new Set<number>();
  let match: RegExpExecArray | null;
  while ((match = numberedStepPattern.exec(query)) !== null) {
    numbers.add(parseInt(match[1], 10));
  }
  return numbers.size;
}
