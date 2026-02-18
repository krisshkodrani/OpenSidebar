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

import { TaggedElement } from "../types";
import { logger } from "../utils";

/** Maps tag number → DOM element (for action execution) */
const tagMap = new Map<number, Element>();

/** Elements tagged via addDynamicTag() — survives tagMap.clear() in tagElements(). Pinned for N cycles. */
const dynamicTagEntries = new Map<number, { el: Element; cyclesRemaining: number }>();

/** CSS class for the injected label overlay */
const LABEL_CLASS = "qsidebar-tag";

/** Pixels above/below viewport to include (peripheral vision) */
const VIEWPORT_EXPANSION = 500;

/** Default hard cap on tagged elements per snapshot */
export const MAX_TAGGED_ELEMENTS = 50;

/** Elevated cap for pages with drag-and-drop elements */
const MAX_TAGGED_ELEMENTS_DND = 75;

/** Return effective cap: raised for DnD pages to ensure drop zones are tagged */
function getEffectiveCap(candidates: Element[]): number {
  const hasDraggable = candidates.some(el => el.getAttribute("draggable") === "true");
  const hasDropzone = candidates.some(el =>
    el.hasAttribute("dropzone") ||
    (el as HTMLElement).dataset?.droptarget ||
    (el as HTMLElement).dataset?.dropzone
  );
  return (hasDraggable || hasDropzone) ? MAX_TAGGED_ELEMENTS_DND : MAX_TAGGED_ELEMENTS;
}

/** Maximum depth to traverse shadow DOM (prevents infinite recursion) */
const MAX_SHADOW_DEPTH = 3;

/** Time budget for cursor:pointer scan (ms) */
const CLICKABLE_SCAN_BUDGET_MS = 10;

const INTERACTIVE_SELECTORS = [
  "a[href]",
  "button",
  "input:not([type='hidden'])",
  "textarea",
  "select",
  "[role='button']",
  "[role='link']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='switch']",
  "[role='combobox']",
  "[contenteditable='true']",
  "summary",
  "details",
  "[onclick]",
  "[tabindex]:not([tabindex='-1'])",
  "canvas",
  "[draggable='true']",
].join(", ");

// --- Stable ID infrastructure ---

/** Persistent hash → integer ID map (survives across snapshot refreshes) */
const hashToId = new Map<string, number>();
/** Reverse map: integer ID → hash */
const idToHash = new Map<number, string>();
/** Next available integer ID */
let nextId = 1;
/** IDs from previous refresh that weren't seen this refresh (grace period) */
const previousIds = new Set<number>();

/**
 * FNV-1a 32-bit hash → 8-char hex string.
 * Fast, deterministic, good distribution for short strings.
 */
function fnv1aHash(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Build a simplified DOM path from body → element using child indices */
function getDomPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  while (
    current &&
    current !== document.body &&
    current !== document.documentElement
  ) {
    const parent = current.parentElement;
    if (!parent) break;
    const siblings = Array.from(parent.children);
    const idx = siblings.indexOf(current);
    parts.unshift(`${current.tagName.toLowerCase()}:${idx}`);
    current = parent;
  }
  return parts.join(">");
}

/** Build a stable attribute signature from identity-bearing attributes */
function getAttrSignature(el: Element): string {
  const keys = [
    "id",
    "name",
    "type",
    "role",
    "href",
    "aria-label",
    "data-testid",
  ];
  return keys
    .map((k) => el.getAttribute(k))
    .filter(Boolean)
    .join("|");
}

/**
 * Compute a stable hash for an element based on its identity.
 * Components: tagName, DOM path, first 30 chars of text, key attributes.
 */
function computeStableHash(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const path = getDomPath(el);
  const text = (el.textContent?.trim() || "").slice(0, 30).toLowerCase();
  const attrs = getAttrSignature(el);
  return fnv1aHash(`${tag}|${path}|${text}|${attrs}`);
}

/**
 * Get or allocate a stable integer ID for a given hash.
 * Reuses existing ID if the hash was seen before.
 */
function getStableId(hash: string): number {
  const existing = hashToId.get(hash);
  if (existing !== undefined) return existing;
  const id = nextId++;
  hashToId.set(hash, id);
  idToHash.set(id, hash);
  return id;
}

/** Reset all stable ID state (call on full page navigation) */
export function resetStableIds(): void {
  hashToId.clear();
  idToHash.clear();
  tagMap.clear();
  dynamicTagEntries.clear();
  previousIds.clear();
  nextId = 1;
}

// --- Container tags for clickable scan filtering ---

const CONTAINER_TAGS = new Set([
  "div",
  "section",
  "article",
  "main",
  "aside",
  "header",
  "footer",
  "nav",
  "form",
  "fieldset",
  "ul",
  "ol",
  "table",
  "tbody",
  "thead",
  "tr",
]);

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

/**
 * Recursively query elements through Shadow DOM and iframe boundaries
 */
export function querySelectorAllDeep(
  root: Document | ShadowRoot | Element,
  selector: string,
  depth: number = 0,
): Element[] {
  if (depth > MAX_SHADOW_DEPTH) {
    return [];
  }

  const results: Element[] = [];

  try {
    if (root instanceof Element) {
      results.push(...Array.from(root.querySelectorAll(selector)));
    } else {
      results.push(...Array.from(root.querySelectorAll(selector)));
    }

    const allElements = root.querySelectorAll("*");

    for (const el of allElements) {
      // Shadow DOM traversal
      if (el.shadowRoot) {
        try {
          const shadowResults = querySelectorAllDeep(
            el.shadowRoot,
            selector,
            depth + 1,
          );
          results.push(...shadowResults);
        } catch (_e) {
          continue;
        }
      }

      if ((el as any).shadowRoot && el !== root) {
        try {
          const shadowResults = querySelectorAllDeep(
            (el as any).shadowRoot,
            selector,
            depth + 1,
          );
          results.push(...shadowResults);
        } catch (_e) {
          continue;
        }
      }

      // Same-origin iframe traversal
      if (el.tagName === "IFRAME") {
        try {
          const iframeDoc = (el as HTMLIFrameElement).contentDocument;
          if (iframeDoc) {
            const iframeResults = querySelectorAllDeep(
              iframeDoc,
              selector,
              depth + 1,
            );
            results.push(...iframeResults);
          }
        } catch (_e) {
          // Cross-origin iframe — silently skip
          continue;
        }
      }
    }
  } catch (e) {
    logger.warn("content", "Deep DOM query failed", { error: e });
  }

  return [...new Set(results)];
}

/**
 * Detect elements with cursor:pointer that aren't captured by INTERACTIVE_SELECTORS.
 * Time-budgeted to avoid blocking on heavy pages.
 */
function detectClickableElements(): Element[] {
  const found: Element[] = [];
  const start = performance.now();

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        const el = node as Element;
        // Skip our own labels
        if ((el as HTMLElement).classList?.contains(LABEL_CLASS))
          return NodeFilter.FILTER_REJECT;
        // Skip if already captured by interactive selectors
        try {
          if (el.matches(INTERACTIVE_SELECTORS)) return NodeFilter.FILTER_SKIP;
        } catch {
          return NodeFilter.FILTER_SKIP;
        }
        // Skip large containers
        const tag = el.tagName.toLowerCase();
        if (CONTAINER_TAGS.has(tag) && el.children.length > 3)
          return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  let node: Node | null;
  while ((node = walker.nextNode())) {
    // Time budget check
    if (performance.now() - start > CLICKABLE_SCAN_BUDGET_MS) {
      logger.warn("content", "Clickable scan exceeded time budget", {
        found: found.length,
        elapsedMs: Math.round(performance.now() - start),
      });
      break;
    }

    const el = node as Element;
    if (!isElementVisible(el)) continue;

    try {
      const style = window.getComputedStyle(el);
      if (style.cursor === "pointer") {
        const text = el.textContent?.trim() || "";
        // Only tag leaf-ish elements with reasonable text
        if (text.length > 0 && text.length < 200 && el.children.length <= 3) {
          found.push(el);
        }
      }
    } catch {
      // getComputedStyle can fail for detached elements
    }
  }
  return found;
}

/** Map inferred role → short hint abbreviation for visual labels */
const ROLE_HINTS: Record<string, string> = {
  link: "link",
  button: "btn",
  textbox: "txt",
  combobox: "sel",
  checkbox: "chk",
  radio: "radio",
  tab: "tab",
  menuitem: "menu",
  switch: "sw",
};

/** Get abbreviated hint for a visual tag label */
function shortHint(el: Element): string {
  const role = el.getAttribute("role") || inferRole(el);
  if (ROLE_HINTS[role]) return ROLE_HINTS[role];

  const tag = el.tagName.toLowerCase();
  if (tag === "input") return "input";
  if (tag === "textarea") return "txt";
  if (tag === "select") return "sel";
  if (tag === "a") return "link";
  return role.slice(0, 4);
}

// --- Overflow metadata ---

/** Overflow info from the last tagElements run */
let lastOverflow: { shown: number; total: number; collapsedGroups: string[] } | null = null;

/** Get overflow metadata from the most recent tagElements call */
export function getOverflowMetadata(): typeof lastOverflow {
  return lastOverflow;
}

/**
 * Collapse near-identical elements to free tag slots for diverse ones.
 * Groups by `tagName|role|normalizedText` and keeps max 2 representatives per group.
 * Never collapses elements with special attributes (draggable, dropzone, submit, file, dialog, name).
 */
function collapseNearIdentical(elements: Element[]): {
  survivors: Element[];
  collapsedCount: number;
  collapsedGroups: string[];
} {
  /** Strip trailing digits/numbers to normalize text for grouping */
  function normalizeText(text: string): string {
    return text.replace(/\s*\d+\s*$/, "").trim().toLowerCase();
  }

  /** Elements that should never be collapsed */
  function isProtected(el: Element): boolean {
    if (el.getAttribute("draggable") === "true") return true;
    if (el.hasAttribute("dropzone")) return true;
    if ((el as HTMLElement).dataset?.droptarget) return true;
    if ((el as HTMLElement).dataset?.dropzone) return true;
    if (typeof (el as any).ondrop === "function") return true;
    if (typeof (el as any).ondragover === "function") return true;
    const type = el.getAttribute("type");
    if (type === "submit" || type === "file") return true;
    const role = el.getAttribute("role");
    if (role === "dialog" || role === "alertdialog") return true;
    if (el.hasAttribute("name")) return true;
    return false;
  }

  const MAX_PER_GROUP = 2;

  // Group elements by key
  const groups = new Map<string, Element[]>();
  const protectedElements: Element[] = [];

  for (const el of elements) {
    if (isProtected(el)) {
      protectedElements.push(el);
      continue;
    }
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role") || "";
    const text = normalizeText(el.textContent?.trim().slice(0, 40) || "");
    const key = `${tag}|${role}|${text}`;

    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(el);
  }

  const survivors: Element[] = [...protectedElements];
  let collapsedCount = 0;
  const collapsedGroups: string[] = [];

  for (const [key, group] of groups) {
    if (group.length <= MAX_PER_GROUP) {
      // Small group — keep all
      survivors.push(...group);
    } else {
      // Keep first + last for position context
      survivors.push(group[0], group[group.length - 1]);
      const dropped = group.length - MAX_PER_GROUP;
      collapsedCount += dropped;
      // Extract readable group name from key
      const parts = key.split("|");
      const label = parts[2] || parts[0];
      collapsedGroups.push(`${dropped}× "${label}"`);
    }
  }

  return { survivors, collapsedCount, collapsedGroups };
}

/**
 * Score an element by task-relevance. Higher scores = more likely to be useful.
 * Form inputs, draggable/dropzone elements, and semantically-named elements rank highest.
 */
function scoreElement(el: Element): number {
  let score = 0;
  const tag = el.tagName.toLowerCase();
  const type = el.getAttribute("type") || "";
  const role = el.getAttribute("role") || "";

  // Form inputs (text, email, password, search, tel, url, number, date)
  if (tag === "input" && !["hidden", "submit", "button", "reset"].includes(type)) score += 10;
  if (tag === "textarea") score += 10;
  if (tag === "select") score += 10;

  // Submit/file/action elements
  if (type === "submit" || type === "file") score += 8;

  // Draggable/dropzone (critical for DnD tasks)
  if (el.getAttribute("draggable") === "true") score += 8;
  if (el.hasAttribute("dropzone") ||
      (el as HTMLElement).dataset?.droptarget ||
      (el as HTMLElement).dataset?.dropzone ||
      typeof (el as any).ondrop === "function" ||
      typeof (el as any).ondragover === "function") score += 8;

  // Named elements (semantic, likely unique)
  if (el.hasAttribute("name") || el.hasAttribute("data-testid")) score += 5;

  // Unique identifiers boost
  if (el.id && !isRandomHash(el.id)) score += 3;

  // Role-specific boosts
  if (role === "combobox" || role === "listbox") score += 5;
  if (role === "dialog" || role === "alertdialog") score += 4;
  if (role === "tab" || role === "menuitem") score += 2;

  // Links with href (navigational relevance)
  if (tag === "a" && el.hasAttribute("href")) score += 2;

  // Canvas elements (drawing tasks)
  if (tag === "canvas") score += 6;

  return score;
}

export function tagElements(showTags: boolean = false): TaggedElement[] {
  // 1. Remove old visual labels and MAIN-world bridge attributes
  document.querySelectorAll(`.${LABEL_CLASS}`).forEach((el) => el.remove());
  document.querySelectorAll("[data-os-tag]").forEach((el) => el.removeAttribute("data-os-tag"));

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

  // 5b. Filter visible candidates first for accurate total count
  const visibleCandidates = rawCandidates.filter(el =>
    isElementVisible(el) && !el.closest('[aria-hidden="true"]'),
  );
  const totalCandidates = visibleCandidates.length;

  // 5c. Collapse near-identical elements before the cap loop
  const { survivors, collapsedCount, collapsedGroups } = collapseNearIdentical(visibleCandidates);
  // 5d. Sort by task-relevance score (highest first); stable sort preserves DOM order for ties
  const allCandidates = survivors.sort((a, b) => scoreElement(b) - scoreElement(a));

  const results: TaggedElement[] = [];
  const activeHashes = new Set<string>();
  const effectiveCap = getEffectiveCap(allCandidates);

  for (const el of allCandidates) {
    if (results.length >= effectiveCap) break;
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

    // 6. Inject visual label (only when showTags is true)
    if (showTags) {
      const hint = shortHint(el);
      const label = document.createElement("span");
      label.className = LABEL_CLASS;
      label.textContent = `[${tag}:${hint}]`;
      label.style.cssText = `
        position: absolute;
        z-index: 2147483647;
        background: #fbbf24;
        color: #000;
        font: bold 11px/1 monospace;
        padding: 1px 3px;
        border-radius: 2px;
        pointer-events: none;
        white-space: nowrap;
        box-shadow: 0 1px 2px rgba(0,0,0,0.2);
      `;
      label.style.top = `${rect.top + window.scrollY}px`;
      label.style.left = `${Math.max(0, rect.left + window.scrollX - 20)}px`;
      document.body.appendChild(label);
    }

    // 7. Build TaggedElement
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
      },
      isVisible: true,
      isDisabled: isDisabled(el),
    });
  }

  // 8. Restore dynamic tags — pinned entries survive cap + refresh for cyclesRemaining
  for (const [id, entry] of dynamicTagEntries) {
    if (tagMap.has(id)) {
      // Already re-tagged by interactive scan — decrement but keep tracking
      entry.cyclesRemaining = Math.max(0, entry.cyclesRemaining - 1);
      if (entry.cyclesRemaining <= 0) dynamicTagEntries.delete(id);
      continue;
    }
    if (!document.body.contains(entry.el)) {
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
    if (results.length >= effectiveCap + 5) break;

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
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      isVisible: true,
      isDisabled: isDisabled(entry.el),
    });
  }

  // 9. Set overflow metadata
  if (totalCandidates > results.length || collapsedCount > 0) {
    lastOverflow = { shown: results.length, total: totalCandidates, collapsedGroups };
  } else {
    lastOverflow = null;
  }

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

export function isElementVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);

  // Must have non-zero dimensions
  if (rect.width === 0 || rect.height === 0) return false;

  // Must not be hidden via CSS
  if (style.display === "none") return false;
  if (style.visibility === "hidden") return false;
  if (style.opacity === "0") return false;

  // Must not be clipped entirely
  if (style.clip === "rect(0px, 0px, 0px, 0px)") return false;

  // Viewport-relative filtering with expansion margin
  const viewportTop = -VIEWPORT_EXPANSION;
  const viewportBottom = window.innerHeight + VIEWPORT_EXPANSION;
  const viewportLeft = 0;
  const viewportRight = window.innerWidth;

  if (rect.bottom < viewportTop || rect.top > viewportBottom) return false;
  if (rect.right < viewportLeft || rect.left > viewportRight) return false;

  return true;
}

function inferRole(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (tag === "a") return "link";
  if (tag === "button" || tag === "summary") return "button";
  if (tag === "input") return (el as HTMLInputElement).type || "textbox";
  if (tag === "textarea") return "textbox";
  if (tag === "select") return "combobox";
  return tag;
}

export function getVisibleText(el: Element): string {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel;

  const text = el.textContent?.trim();
  if (text) return text;

  if (el instanceof HTMLInputElement) {
    return el.value || el.placeholder || "";
  }

  return "";
}

/** Priority attributes for agent identification (AgentOccam hierarchy) */
const PRIORITY_ATTRS = [
  "id",
  "data-testid",
  "name",
  "href",
  "src",
  "type",
  "placeholder",
  "value",
  "role",
  "aria-label",
  "aria-roledescription",
  "alt",
  "title",
  "draggable",
];

/** Max chars per attribute value */
const ATTR_TRUNCATION = 60;

function extractAttributes(el: Element): Record<string, string> {
  const attrs: Record<string, string> = {};

  for (const name of PRIORITY_ATTRS) {
    const val = el.getAttribute(name);
    if (!val || val.length === 0) continue;

    if ((name === "id" || name === "name") && isRandomHash(val)) continue;

    attrs[name] = val.slice(0, ATTR_TRUNCATION);
  }

  // Select element: surface available options so LLM doesn't guess blind
  if (el instanceof HTMLSelectElement) {
    const opts = Array.from(el.options)
      .map((o) => o.textContent?.trim() || o.value)
      .filter(Boolean);
    if (opts.length > 0) {
      attrs["options"] = truncateText(opts.join(" | "), ATTR_TRUNCATION * 2);
    }
    if (el.value) {
      const selected = el.options[el.selectedIndex];
      if (selected) {
        attrs["selected"] = selected.textContent?.trim() || selected.value;
      }
    }
  }

  // Form-specific label association
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  ) {
    const elId = el.getAttribute("id");
    if (elId) {
      const labelEl = document.querySelector(
        `label[for="${CSS.escape(elId)}"]`,
      );
      if (labelEl)
        attrs["label"] = truncateText(labelEl.textContent?.trim() || "", 40);
    }
    if (!attrs["label"]) {
      const parentLabel = el.closest("label");
      if (parentLabel) {
        const labelText = parentLabel.textContent
          ?.trim()
          .replace(el.value || "", "")
          .trim();
        if (labelText) attrs["label"] = truncateText(labelText, 40);
      }
    }
  }

  // General aria-labelledby resolution
  if (!attrs["label"] && !attrs["aria-label"]) {
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts: string[] = [];
      for (const refId of labelledBy.split(/\s+/)) {
        const refEl = document.getElementById(refId);
        if (refEl) {
          const txt = refEl.textContent?.trim();
          if (txt) parts.push(txt);
        }
      }
      if (parts.length > 0) {
        attrs["label"] = truncateText(parts.join(" "), 40);
      }
    }
  }

  // Deduplicate: aria-label supersedes title and alt
  if (attrs["aria-label"]) {
    delete attrs["title"];
    delete attrs["alt"];
  }

  // Deduplicate: placeholder redundant when label already describes the field
  if (attrs["placeholder"] && attrs["label"]) {
    delete attrs["placeholder"];
  }

  // Detect drop zone — JS event handlers aren't HTML attributes, check properties
  if (
    typeof (el as any).ondrop === "function" ||
    typeof (el as any).ondragover === "function" ||
    el.hasAttribute("dropzone") ||
    (el as HTMLElement).dataset?.droptarget ||
    (el as HTMLElement).dataset?.dropzone
  ) {
    attrs["dropzone"] = "true";
  }

  // State attributes
  if (el.hasAttribute("disabled")) attrs["disabled"] = "true";
  if (el.getAttribute("aria-expanded") === "true")
    attrs["aria-expanded"] = "true";
  if (el.getAttribute("aria-selected") === "true")
    attrs["aria-selected"] = "true";

  // Resolve aria-describedby
  const describedBy = el.getAttribute("aria-describedby");
  if (describedBy) {
    const parts: string[] = [];
    for (const refId of describedBy.split(/\s+/)) {
      const refEl = document.getElementById(refId);
      if (refEl) {
        const txt = refEl.textContent?.trim();
        if (txt) parts.push(txt);
      }
    }
    if (parts.length > 0) {
      attrs["description"] = truncateText(parts.join(" "), 80);
    }
  }

  // aria-description direct attribute
  if (!attrs["description"]) {
    const ariaDesc = el.getAttribute("aria-description");
    if (ariaDesc) {
      attrs["description"] = truncateText(ariaDesc, 80);
    }
  }

  // Visual style hints (color) for disambiguation
  try {
    const style = window.getComputedStyle(el);
    const bg = style.backgroundColor;
    // Only emit non-trivial backgrounds (skip transparent/rgba(0,0,0,0))
    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
      attrs["bg-color"] = bg;
    }
    const fg = style.color;
    if (fg) attrs["text-color"] = fg;
  } catch {
    // getComputedStyle can fail for detached elements
  }

  return attrs;
}

/**
 * Detect random hash/generated ID strings that waste tokens.
 * Tuned to preserve short, stable suffixes (e.g., "row-1a2b") while
 * still catching Webpack/Vite chunk hashes and CSS-module suffixes.
 */
export function isRandomHash(value: string): boolean {
  // Double-underscore suffixes are almost always CSS-module / build-tool noise
  if (/__[a-zA-Z0-9]{2,}$/.test(value)) return true;

  // React-generated IDs: multiple underscore-separated segments with mixed alphanumeric parts
  // e.g., "u_0_j_8W0000", "id_1_a2B3c4"
  if (/^([a-zA-Z0-9]_)+[a-zA-Z0-9]{4,}$/i.test(value)) return true;

  // Check trailing alphanumeric suffix after _ or -
  const suffixMatch = value.match(/[_-]([a-zA-Z0-9]{4,})$/);
  if (suffixMatch) {
    const suffix = suffixMatch[1];
    // Only strip if suffix is long enough (≥6) AND has mixed letters+digits
    // with roughly even entropy (rules out "row-1" or "step-2a" type patterns)
    if (suffix.length >= 6 && /\d/.test(suffix) && /[a-zA-Z]/.test(suffix)) {
      const digits = suffix.replace(/[^0-9]/g, "").length;
      const ratio = digits / suffix.length;
      // Random hashes have ~20-80% digit ratio; structured IDs tend to be outside this
      if (ratio > 0.2 && ratio < 0.8) return true;
    }
  }

  // Pure alphanumeric blobs without readable words (e.g., "xK9mQ2pL")
  if (/^[a-zA-Z0-9]{8,}$/.test(value) && !/[a-z]{3,}/.test(value)) return true;
  return false;
}

/** Smart truncation preserving head + tail for context */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const head = Math.floor(maxLength * 0.8);
  const tail = maxLength - head - 3;
  return text.slice(0, head) + "..." + text.slice(-tail);
}

function isDisabled(el: Element): boolean {
  return (
    el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true"
  );
}
