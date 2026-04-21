/**
 * Popup Triage - Perception-guided nuisance popup auto-dismiss.
 *
 * Parses the BLOCKERS section of a perception interpretation to extract
 * nuisance overlays (cookie/consent/promo/newsletter/ads) with their
 * dismiss button tag IDs. The agent loop uses this to auto-click dismiss
 * buttons before the LLM turn starts, so the model sees a clean page.
 *
 * RELEVANT blockers (login/checkout/confirmation) are left untouched.
 */

import type { TaggedElement } from "../../types";

/** A nuisance popup identified by perception with a known dismiss target. */
export interface NuisanceBlocker {
  /** Tag ID of the overlay/popup container itself */
  overlayTagId: number;
  /** Tag ID of the button to click to dismiss it */
  dismissTagId: number;
  /** Human-readable description from perception */
  description: string;
}

export interface RejectedNuisanceBlocker extends NuisanceBlocker {
  reason: string;
}

function extractBlockersText(interpretation: string): string | null {
  const blockersMatch = interpretation.match(
    /BLOCKERS:(.+?)(?=\n\d+\.\s|\n[A-Z]+:|$)/s,
  );
  return blockersMatch ? blockersMatch[1] : null;
}

function isDismissCandidate(el: TaggedElement | undefined): boolean {
  if (!el || el.isDisabled || !el.isVisible) return false;

  const tag = el.tagName.toLowerCase();
  const role = el.role.toLowerCase();
  const type = (el.attributes.type || "").toLowerCase();

  return (
    tag === "button" ||
    tag === "a" ||
    role === "button" ||
    ["button", "submit", "reset"].includes(type)
  );
}

/**
 * Parse the BLOCKERS section of a perception interpretation and extract
 * nuisance popups with actionable dismiss targets.
 *
 * Expected format from perception:
 *   NUISANCE [12] "cookie consent banner" -> click [15]
 *   RELEVANT [20] "login modal" -> user must authenticate
 *
 * Returns only NUISANCE entries that have a `click [N]` dismiss target.
 */
export function parseNuisanceBlockers(
  interpretation: string,
): NuisanceBlocker[] {
  if (!interpretation) return [];

  const blockersText = extractBlockersText(interpretation);
  if (!blockersText) return [];

  // "None" or empty means no blockers
  if (/^\s*none\.?\s*$/i.test(blockersText)) return [];

  const results: NuisanceBlocker[] = [];

  // Allow either ASCII arrow or the Unicode right arrow frequently used
  // in model outputs.
  const linePattern =
    /NUISANCE\s+\[(\d+)\]\s+"([^"]+)"\s*(?:->|\u2192|Ã¢â€ â€™)\s*click\s+\[(\d+)\]/gi;

  let match: RegExpExecArray | null;
  while ((match = linePattern.exec(blockersText)) !== null) {
    const overlayTagId = parseInt(match[1], 10);
    const description = match[2];
    const dismissTagId = parseInt(match[3], 10);

    if (!isNaN(overlayTagId) && !isNaN(dismissTagId)) {
      results.push({ overlayTagId, dismissTagId, description });
    }
  }

  return results;
}

export function validateNuisanceBlockers(
  interpretation: string,
  elements: TaggedElement[],
): {
  valid: NuisanceBlocker[];
  rejected: RejectedNuisanceBlocker[];
} {
  const parsed = parseNuisanceBlockers(interpretation);
  if (parsed.length === 0) {
    return { valid: [], rejected: [] };
  }

  const tagMap = new Map<number, TaggedElement>();
  for (const el of elements) {
    tagMap.set(el.tag, el);
  }

  const valid: NuisanceBlocker[] = [];
  const rejected: RejectedNuisanceBlocker[] = [];

  for (const blocker of parsed) {
    const overlay = tagMap.get(blocker.overlayTagId);
    const dismiss = tagMap.get(blocker.dismissTagId);

    if (!overlay) {
      rejected.push({ ...blocker, reason: "overlay tag missing from live DOM" });
      continue;
    }
    if (!dismiss) {
      rejected.push({ ...blocker, reason: "dismiss tag missing from live DOM" });
      continue;
    }
    if (!isDismissCandidate(dismiss)) {
      rejected.push({
        ...blocker,
        reason: `dismiss tag [${blocker.dismissTagId}] is not a visible actionable control`,
      });
      continue;
    }

    valid.push(blocker);
  }

  return { valid, rejected };
}
