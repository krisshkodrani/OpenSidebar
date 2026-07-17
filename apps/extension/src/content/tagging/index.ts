/**
 * Tagging - Vimium-style numeric element tagging
 *
 * Responsibilities:
 * - Scan DOM for interactive elements
 * - Assign stable numeric tags [1], [2], [3]...
 * - Support shadow DOM traversal
 * - Generate visible text for each element
 * - Maintain stable IDs across snapshots
 *
 * Tag format: [N] tagName#id "visible text" (role)
 */

import { TaggedElement } from "../../types";
import {
  computeStableHash,
  getStableId,
  hashToId,
  idToHash,
  previousIds,
  resetStableIdMaps,
  swapLastRunHashes,
} from "./stable-ids";
import {
  querySelectorAllDeep,
  detectClickableElements,
  LABEL_CLASS,
  INTERACTIVE_SELECTORS,
} from "./dom-traversal";
import { collapseNearIdentical, scoreElement } from "./scoring";
import {
  isElementVisible,
  isUploadFileInput,
  inferRole,
  getVisibleText,
  extractAttributes,
  truncateText,
  isDisabled,
  getCheckboxOrRadioControl,
} from "./utils";

// Re-export all submodules for barrel compatibility
export * from "./utils";
export * from "./stable-ids";
export * from "./dom-traversal";
export * from "./scoring";
export * from "./structural";

/** Maps tag number → DOM element (for action execution) */
const tagMap = new Map<number, Element>();

/** Elements tagged via addDynamicTag() — survives tagMap.clear() in tagElements(). Pinned for N cycles. */
const dynamicTagEntries = new Map<
  number,
  { el: Element; cyclesRemaining: number }
>();

/** Safety backstop — cap tagged elements to prevent runaway DOMs from eating context */
export const MAX_TAGGED_ELEMENTS = 1000;

// --- Public API ---

export function getCachedElements(): TaggedElement[] {
  return []; // Prefer fresh tagging
}

export function getTagMap(): Map<number, Element> {
  return tagMap;
}

/**
 * Dynamically tag an element that wasn't in the original snapshot
 * (e.g. an overlay detected during click interception).
 * Returns the assigned tag number so the LLM can reference it.
 */
export function addDynamicTag(el: Element): number {
  // Check if already tagged
  for (const [existingTag, existingEl] of tagMap) {
    if (existingEl === el) return existingTag;
  }
  // Compute stable hash for consistency
  const hash = computeStableHash(el);
  const id = getStableId(hash);
  tagMap.set(id, el);
  dynamicTagEntries.set(id, { el, cyclesRemaining: 3 });
  return id;
}

/** Reset all stable ID state (call on full page navigation) */
export function resetStableIds(): void {
  resetStableIdMaps();
  lastRunWasCapped = false;
  tagMap.clear();
  dynamicTagEntries.clear();
}

// --- Overflow metadata ---

/** Overflow info from the last tagElements run */
let lastOverflow: {
  shown: number;
  total: number;
  collapsedGroups: string[];
} | null = null;

/** Get overflow metadata from the most recent tagElements call */
export function getOverflowMetadata(): typeof lastOverflow {
  return lastOverflow;
}

/**
 * LP-10: whether the previous tagging run hit the element cap. When either
 * run is capped, the stable-hash set difference is unreliable (truncation
 * shuffles which elements make the cut), so new-element marks are suppressed.
 */
let lastRunWasCapped = false;

export function tagElements(): TaggedElement[] {
  // 1. Remove old visual labels and MAIN-world bridge attributes
  document.querySelectorAll(`.${LABEL_CLASS}`).forEach((el) => el.remove());
  document
    .querySelectorAll("[data-os-tag]")
    .forEach((el) => el.removeAttribute("data-os-tag"));

  // 2. Move current IDs into grace period; clear tagMap for fresh population
  previousIds.clear();
  for (const id of idToHash.keys()) {
    previousIds.add(id);
  }
  tagMap.clear();

  // 3. Phase 1: Standard interactive selectors
  const candidates = querySelectorAllDeep(document, INTERACTIVE_SELECTORS);

  // 4. Phase 2: cursor:pointer elements not already captured
  const clickableExtras = detectClickableElements();

  // 4b. Visible labels for hidden checkbox/radio controls are actionable even
  // when the underlying input has no visible box of its own.
  const labelledControlExtras = querySelectorAllDeep(document, "label").filter(
    (el) => getCheckboxOrRadioControl(el) !== null,
  );

  // 5. Deduplicate
  const seen = new Set<Element>();
  const rawCandidates: Element[] = [];
  for (const el of candidates) {
    if (!seen.has(el)) {
      seen.add(el);
      rawCandidates.push(el);
    }
  }
  for (const el of clickableExtras) {
    if (!seen.has(el)) {
      seen.add(el);
      rawCandidates.push(el);
    }
  }
  for (const el of labelledControlExtras) {
    if (!seen.has(el)) {
      seen.add(el);
      rawCandidates.push(el);
    }
  }

  // 5b. Filter visible candidates first for accurate total count. File inputs
  // are the exception: they are the only upload target, are almost always
  // hidden behind a styled button, and must be tagged so upload_file can reach
  // them (otherwise the agent clicks the button and opens an uncontrollable OS
  // file dialog).
  const visibleCandidates = rawCandidates.filter(
    (el) =>
      isUploadFileInput(el) ||
      (isElementVisible(el) && !el.closest('[aria-hidden="true"]')),
  );
  const totalCandidates = visibleCandidates.length;

  // 5c. Collapse near-identical elements before the cap loop
  const { survivors, collapsedCount, collapsedGroups } =
    collapseNearIdentical(visibleCandidates);
  // 5d. Sort by task-relevance score (highest first); stable sort preserves DOM order for ties
  const allCandidates = survivors.sort(
    (a, b) => scoreElement(b) - scoreElement(a),
  );

  const results: TaggedElement[] = [];
  const resultHashes: string[] = [];
  const activeHashes = new Set<string>();
  for (const el of allCandidates) {
    if (results.length >= MAX_TAGGED_ELEMENTS) break;
    // Visibility already pre-filtered by collapseNearIdentical pipeline

    // Compute stable hash and get/allocate a stable ID
    const hash = computeStableHash(el);
    // Handle hash collision: append suffix if this hash is already used by a different element
    let finalHash = hash;
    if (activeHashes.has(hash)) {
      let suffix = 2;
      while (activeHashes.has(`${hash}-${suffix}`)) suffix++;
      finalHash = `${hash}-${suffix}`;
    }
    activeHashes.add(finalHash);

    const tag = getStableId(finalHash);
    previousIds.delete(tag); // Still alive — remove from grace
    tagMap.set(tag, el);

    // Bridge attribute: MAIN-world scripts (React toolkit) use this to find elements by tag ID
    (el as HTMLElement).setAttribute("data-os-tag", String(tag));

    const rect = el.getBoundingClientRect();

    // 6. Build TaggedElement
    results.push({
      tag,
      tagName: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || inferRole(el),
      text: truncateText(getVisibleText(el), 80),
      attributes: extractAttributes(el),
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        pageY: Math.round(rect.y + window.scrollY),
      },
      isVisible: true,
      isDisabled: isDisabled(el),
    });
    resultHashes.push(finalHash);
  }

  // 8. Restore dynamic tags — pinned entries survive cap + refresh for cyclesRemaining
  for (const [id, entry] of dynamicTagEntries) {
    if (tagMap.has(id)) {
      // Already re-tagged by interactive scan — decrement but keep tracking
      entry.cyclesRemaining = Math.max(0, entry.cyclesRemaining - 1);
      if (entry.cyclesRemaining <= 0) dynamicTagEntries.delete(id);
      continue;
    }
    if (!entry.el.isConnected) {
      // Element removed from DOM — clean up immediately
      dynamicTagEntries.delete(id);
      continue;
    }
    entry.cyclesRemaining--;
    if (entry.cyclesRemaining <= 0) {
      dynamicTagEntries.delete(id);
      continue;
    }
    if (!isElementVisible(entry.el)) continue; // Hidden but might reappear — keep entry
    // Allow up to 5 overflow slots beyond effective cap for pinned dynamic tags
    if (results.length >= MAX_TAGGED_ELEMENTS + 5) break;

    const hash = idToHash.get(id);
    if (hash) activeHashes.add(hash);
    previousIds.delete(id);
    tagMap.set(id, entry.el);

    const rect = entry.el.getBoundingClientRect();
    results.push({
      tag: id,
      tagName: entry.el.tagName.toLowerCase(),
      role: entry.el.getAttribute("role") || inferRole(entry.el),
      text: truncateText(getVisibleText(entry.el), 80),
      attributes: extractAttributes(entry.el),
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        pageY: Math.round(rect.y + window.scrollY),
      },
      isVisible: true,
      isDisabled: isDisabled(entry.el),
    });
    resultHashes.push(hash ?? "");
  }

  // 9. Set overflow metadata
  if (totalCandidates > results.length || collapsedCount > 0) {
    lastOverflow = {
      shown: results.length,
      total: totalCandidates,
      collapsedGroups,
    };
  } else {
    lastOverflow = null;
  }

  // 9b. LP-10: mark elements new since the previous snapshot (stable-hash
  // set difference). Suppressed when the diff is unreliable or uninformative:
  // first run (no baseline), navigation-scale change (>50% new), or a capped
  // run on either side (truncation shuffles which elements make the cut).
  const isCapped = results.length >= MAX_TAGGED_ELEMENTS;
  const previousRunHashes = swapLastRunHashes(new Set(activeHashes));
  if (previousRunHashes.size > 0 && !isCapped && !lastRunWasCapped) {
    let newCount = 0;
    for (let i = 0; i < results.length; i++) {
      const hash = resultHashes[i];
      if (hash && !previousRunHashes.has(hash)) {
        results[i].isNew = true;
        newCount++;
      }
    }
    if (newCount > results.length / 2) {
      for (const result of results) delete result.isNew;
    }
  }
  lastRunWasCapped = isCapped;

  // 10. Clean up hashes for elements gone for 2+ refreshes
  // previousIds now contains IDs that existed before but weren't seen this refresh.
  // They get one grace cycle. On the NEXT refresh, they'll be cleared from previousIds
  // at the top, and if still not seen, they won't be in previousIds → eligible for cleanup.
  // We clean hashes that are NOT in activeHashes AND NOT in previousIds (grace).
  for (const [hash, id] of hashToId) {
    if (!activeHashes.has(hash) && !previousIds.has(id)) {
      hashToId.delete(hash);
      idToHash.delete(id);
    }
  }

  return results;
}
