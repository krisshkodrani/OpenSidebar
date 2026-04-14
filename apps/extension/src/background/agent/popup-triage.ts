/**
 * Popup Triage — Perception-guided nuisance popup auto-dismiss.
 *
 * Parses the BLOCKERS section of a perception interpretation to extract
 * nuisance overlays (cookie/consent/promo/newsletter/ads) with their
 * dismiss button tag IDs. The agent loop uses this to auto-click dismiss
 * buttons before the LLM turn starts, so the model sees a clean page.
 *
 * RELEVANT blockers (login/checkout/confirmation) are left untouched.
 */

/** A nuisance popup identified by perception with a known dismiss target. */
export interface NuisanceBlocker {
  /** Tag ID of the overlay/popup container itself */
  overlayTagId: number;
  /** Tag ID of the button to click to dismiss it */
  dismissTagId: number;
  /** Human-readable description from perception */
  description: string;
}

/**
 * Parse the BLOCKERS section of a perception interpretation and extract
 * nuisance popups with actionable dismiss targets.
 *
 * Expected format from perception:
 *   NUISANCE [12] "cookie consent banner" → click [15]
 *   RELEVANT [20] "login modal" → user must authenticate
 *
 * Returns only NUISANCE entries that have a `click [N]` dismiss target.
 */
export function parseNuisanceBlockers(
  interpretation: string,
): NuisanceBlocker[] {
  if (!interpretation) return [];

  // Find the BLOCKERS section — everything after "BLOCKERS:" until the next
  // numbered section (e.g. "6. SPATIAL:") or end of string.
  const blockersMatch = interpretation.match(
    /BLOCKERS:(.+?)(?=\n\d+\.\s|\n[A-Z]+:|$)/s,
  );
  if (!blockersMatch) return [];

  const blockersText = blockersMatch[1];

  // "None" or empty means no blockers
  if (/^\s*none\.?\s*$/i.test(blockersText)) return [];

  const results: NuisanceBlocker[] = [];

  // Match lines like: NUISANCE [12] "cookie banner" → click [15]
  // Allow for unicode arrow (→) or ASCII arrow (->)
  const linePattern =
    /NUISANCE\s+\[(\d+)\]\s+"([^"]+)"\s*(?:→|->)\s*click\s+\[(\d+)\]/gi;

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
