import { TaggedElement } from "../types";
import { logger } from "../utils";

/** Global tag counter — resets on each snapshot refresh */
let tagCounter = 0;

/** Maps tag number → DOM element (for action execution) */
const tagMap = new Map<number, Element>();

/** CSS class for the injected label overlay */
const LABEL_CLASS = "qsidebar-tag";

/** Pixels above/below viewport to include (peripheral vision) */
const VIEWPORT_EXPANSION = 500;

/** Hard cap on tagged elements per snapshot */
export const MAX_TAGGED_ELEMENTS = 50;

/** Maximum depth to traverse shadow DOM (prevents infinite recursion) */
const MAX_SHADOW_DEPTH = 3;

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

export function getCachedElements(): TaggedElement[] {
  // Reconstruct TaggedElements from the current DOM state of tags
  // This is valid until the page changes naturally
  // But typically we regenerate tags
  return []; // For now, we prefer fresh tagging
}

export function getTagMap(): Map<number, Element> {
  return tagMap;
}

/**
 * Recursively query elements through Shadow DOM boundaries
 * This enables interaction with Web Components and Shadow DOM encapsulated elements
 *
 * @param root - The root element/document to query from
 * @param selector - CSS selector string
 * @param depth - Current recursion depth (used internally)
 * @returns Array of elements matching the selector across all shadow boundaries
 */
export function querySelectorAllDeep(
  root: Document | ShadowRoot | Element,
  selector: string,
  depth: number = 0,
): Element[] {
  // Prevent excessive recursion
  if (depth > MAX_SHADOW_DEPTH) {
    return [];
  }

  const results: Element[] = [];

  try {
    // Query in current root context
    if (root instanceof Element) {
      results.push(...Array.from(root.querySelectorAll(selector)));
    } else {
      results.push(...Array.from(root.querySelectorAll(selector)));
    }

    // Find all elements that might have shadow roots
    const allElements = root.querySelectorAll("*");

    for (const el of allElements) {
      // Check if this element has an open shadow root
      if (el.shadowRoot) {
        try {
          // Recursively query inside the shadow root
          const shadowResults = querySelectorAllDeep(
            el.shadowRoot,
            selector,
            depth + 1,
          );
          results.push(...shadowResults);
        } catch (_e) {
          // Silently skip shadow roots that throw (e.g., closed shadow DOM)
          continue;
        }
      }

      // Also check for shadow hosts within custom elements
      // Some frameworks attach shadow to the element itself
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
    }
  } catch (e) {
    // If querying fails (e.g., cross-origin restrictions), return what we have
    logger.warn("content", "Shadow DOM query failed", { error: e });
  }

  // Remove duplicates (element might be found via multiple paths in complex DOMs)
  return [...new Set(results)];
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

export function tagElements(showTags: boolean = false): TaggedElement[] {
  // 1. Remove old tags
  document.querySelectorAll(`.${LABEL_CLASS}`).forEach((el) => el.remove());
  tagMap.clear();
  tagCounter = 0;

  // 2. Query all interactive elements (now with Shadow DOM support!)
  const candidates = querySelectorAllDeep(document, INTERACTIVE_SELECTORS);
  const results: TaggedElement[] = [];

  for (const el of candidates) {
    if (results.length >= MAX_TAGGED_ELEMENTS) break;
    if (!isElementVisible(el)) continue;

    tagCounter++;
    const tag = tagCounter;
    tagMap.set(tag, el);

    const rect = el.getBoundingClientRect();

    // 3. Inject visual label (only when showTags is true)
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

      // Position the label at the element's top-left
      label.style.top = `${rect.top + window.scrollY}px`;
      label.style.left = `${Math.max(0, rect.left + window.scrollX - 20)}px`;
      document.body.appendChild(label);
    }

    // 4. Build TaggedElement
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
  // getBoundingClientRect() returns viewport-relative coords
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
  // Prefer aria-label > textContent > value > placeholder
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
  // Identity
  "id",
  "data-testid",
  "name",
  // Navigation
  "href",
  "src",
  // Input state
  "type",
  "placeholder",
  "value",
  // Accessibility
  "role",
  "aria-label",
  "alt",
  "title",
];

/** Max chars per attribute value */
const ATTR_TRUNCATION = 60;

function extractAttributes(el: Element): Record<string, string> {
  const attrs: Record<string, string> = {};

  for (const name of PRIORITY_ATTRS) {
    const val = el.getAttribute(name);
    if (!val || val.length === 0) continue;

    // Skip random hashes (low character-to-token ratio, per AgentOccam)
    if ((name === "id" || name === "name") && isRandomHash(val)) continue;

    attrs[name] = val.slice(0, ATTR_TRUNCATION);
  }

  // Label association for form elements
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    // Try explicit <label for="id">
    const elId = el.getAttribute("id");
    if (elId) {
      const labelEl = document.querySelector(`label[for="${CSS.escape(elId)}"]`);
      if (labelEl) attrs["label"] = truncateText(labelEl.textContent?.trim() || "", 40);
    }
    // Try implicit <label> wrapper
    if (!attrs["label"]) {
      const parentLabel = el.closest("label");
      if (parentLabel) {
        const labelText = parentLabel.textContent?.trim().replace(el.value || "", "").trim();
        if (labelText) attrs["label"] = truncateText(labelText, 40);
      }
    }
    // Try aria-labelledby
    if (!attrs["label"]) {
      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        const labelEl = document.getElementById(labelledBy);
        if (labelEl) attrs["label"] = truncateText(labelEl.textContent?.trim() || "", 40);
      }
    }
  }

  // State attributes — only include when they indicate non-default state
  if (el.hasAttribute("disabled")) attrs["disabled"] = "true";
  if (el.getAttribute("aria-expanded") === "true")
    attrs["aria-expanded"] = "true";
  if (el.getAttribute("aria-selected") === "true")
    attrs["aria-selected"] = "true";

  return attrs;
}

/**
 * Detect random hash/generated ID strings that waste tokens.
 * Patterns: css-1q2w3e4, Button_root__2dKj, u_0_j_8W0000
 */
export function isRandomHash(value: string): boolean {
  // CSS module pattern: double underscore + any suffix
  if (/__[a-zA-Z0-9]{2,}$/.test(value)) return true;

  // Trailing mixed alphanumeric suffix after separator (must contain digits AND letters)
  // This distinguishes hashes like "css-1q2w3e4" from words like "login-button"
  const suffixMatch = value.match(/[_-]([a-zA-Z0-9]{4,})$/);
  if (suffixMatch) {
    const suffix = suffixMatch[1];
    if (/\d/.test(suffix) && /[a-zA-Z]/.test(suffix)) return true;
  }

  // Pure alphanumeric with no readable word (>= 3 consecutive lowercase)
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
