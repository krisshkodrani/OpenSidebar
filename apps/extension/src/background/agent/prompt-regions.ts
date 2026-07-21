/**
 * LP-21 — prompt region helpers.
 *
 * Prefix caching keeps everything BEFORE the first byte that changed, so a
 * prompt has to be laid out in regions of decreasing stability:
 *
 *   A  immutable  static rules, persona, current task   (byte-stable per run)
 *   B  run-stable plan instructions, skills, notes
 *   C  volatile   page context, elements, page content, turn status
 *
 * Regions A+B are emitted as the system message; region C is emitted as a
 * trailing user message. Page state used to live inside the system message,
 * which made message 0 differ on every turn — measured at 100% of turn-pairs —
 * so the cache never survived past it.
 */

import type { LLMMessage } from "../llm/types";

/** Template marker separating regions A+B from region C. */
export const VOLATILE_SPLIT_MARKER = "{{volatileSplit}}";

/** Template placeholder for the per-turn valid-element-ID list. */
export const VALID_ELEMENT_IDS_MARKER = "{{validElementIds}}";

export interface PromptRegions {
  /** Regions A + B — must be byte-identical for the whole run. */
  system: LLMMessage;
  /** Region C — changes every turn; null when it renders empty. */
  volatileTail: LLMMessage | null;
}

/**
 * Split a rendered prompt at the volatile boundary.
 *
 * Templates without the marker (older fixtures) fall back to the previous
 * single-message behaviour rather than failing.
 */
export function splitAtVolatileBoundary(content: string): PromptRegions {
  const at = content.indexOf(VOLATILE_SPLIT_MARKER);
  if (at < 0) {
    return { system: { role: "system", content }, volatileTail: null };
  }
  const head = content.slice(0, at).trimEnd();
  const tail = content
    .slice(at + VOLATILE_SPLIT_MARKER.length)
    .replace(/^\n+/, "");
  return {
    system: { role: "system", content: head },
    volatileTail:
      tail.trim().length > 0 ? { role: "user", content: tail } : null,
  };
}

/**
 * Prepend dismissed-overlay text above the Page Content section.
 *
 * Persisted overlays win; the live snapshot's `capturedTexts` is a fallback for
 * the rare case where persistence has not caught up yet.
 */
export function injectDismissedOverlays(
  content: string,
  persisted: readonly string[],
  fallback: readonly string[] | undefined,
  sanitize: (text: string) => string,
): string {
  const source = persisted.length > 0 ? persisted : (fallback ?? []);
  if (source.length === 0) return content;
  const label = persisted.length > 0 ? "Dismissed Overlay" : "Overlay";
  const archived = source
    .map((t, i) => `[${label} ${i + 1}]: ${sanitize(t)}`)
    .join("\n\n");
  return content.replace(
    "## Page Content",
    `## Dismissed Overlay Content\nThe following text was extracted from overlays/modals that were automatically dismissed. Review for any important information.\n${archived}\n\n## Page Content`,
  );
}

/**
 * Render the valid-element-ID list into its dedicated placeholder.
 *
 * This MUST target {{validElementIds}} and never a Markdown heading:
 * `String.prototype.replace` with a string pattern rewrites the FIRST match,
 * and "## Page Interpretation" appeared twice in the template — once in the
 * static rules and once in the page-state section. The injection landed on the
 * static copy, pushing per-turn element IDs above the cache breakpoint and
 * truncating the prefix on every DOM change.
 */
export function injectValidElementIds(
  content: string,
  elementTags: readonly (number | string)[],
): string {
  if (elementTags.length === 0) {
    return content.replace(VALID_ELEMENT_IDS_MARKER, "");
  }
  return content.replace(
    VALID_ELEMENT_IDS_MARKER,
    `\nValid element IDs: [${elementTags.join(",")}]\n`,
  );
}
