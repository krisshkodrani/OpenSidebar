/**
 * navigate-back guard (RFC LP-16 Phase 3 — loop.ts landmine decomposition).
 *
 * Block a navigate() to a URL that matches a completed plan step's landing URL
 * (origin + pathname, and search when either side has one) — navigating back
 * there would undo verified progress. Returns a BLOCKED message or null. Pure
 * over the host's plan state; extracted verbatim from loop() via the dispatch-
 * host idiom; behavior-preserving.
 */

import type { SubtaskSummary } from "../../types";

export interface NavigateGuardHost {
  readonly planSubtasks: SubtaskSummary[];
}

export function checkNavigateGuard(
  host: NavigateGuardHost,
  targetUrl: string,
): string | null {
  if (host.planSubtasks.length === 0) return null;

  const completedWithUrls = host.planSubtasks
    .map((s, i) => ({ ...s, index: i }))
    .filter((s) => s.status === "completed" && s.completedAtUrl);

  if (completedWithUrls.length === 0) return null;

  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    return null; // Unparseable URL — let it through
  }

  for (const step of completedWithUrls) {
    try {
      const completed = new URL(step.completedAtUrl!);
      const includeSearch = Boolean(target.search || completed.search);
      const targetKey =
        target.origin + target.pathname + (includeSearch ? target.search : "");
      const completedKey =
        completed.origin +
        completed.pathname +
        (includeSearch ? completed.search : "");
      if (targetKey === completedKey) {
        return (
          `BLOCKED: Cannot navigate to "${targetUrl}" — matches completed step ${step.index + 1} ("${step.description}").\n` +
          `Navigating back would undo progress. Continue with the current step.\n` +
          `If re-visiting is genuinely needed, revise your plan first.`
        );
      }
    } catch {
      continue;
    }
  }

  return null;
}
