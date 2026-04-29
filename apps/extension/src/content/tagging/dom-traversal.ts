/**
 * DOM traversal - deep query across shadow DOM/iframes, clickable element detection
 */

import { logger } from "../../utils";
import { isElementVisible } from "./utils";

/** CSS class for the injected label overlay (legacy — kept for cleanup of old labels) */
export const LABEL_CLASS = "opensidebar-tag";

/** IDs of elements injected by the extension that should be excluded from tagging */
const OWN_ELEMENT_IDS = new Set([
  "opensidebar-agent-border",
  "opensidebar-e2e-rail",
  "opensidebar-floating-wrap",
  "opensidebar-stop-btn",
]);

/** Check if an element was injected by our extension (not part of the page) */
export function isOwnElement(el: Element): boolean {
  if (OWN_ELEMENT_IDS.has(el.id) || (el as HTMLElement).classList?.contains(LABEL_CLASS)) {
    return true;
  }
  return Boolean(
    el.closest(
      [
        ...Array.from(OWN_ELEMENT_IDS, (id) => `#${CSS.escape(id)}`),
        `.${LABEL_CLASS}`,
      ].join(","),
    ),
  );
}

/** Maximum depth to traverse shadow DOM/iframe trees (prevents infinite recursion). */
export const MAX_SHADOW_DEPTH = 10;

/** Time budget for cursor:pointer scan (ms) */
const CLICKABLE_SCAN_BUDGET_MS = 10;

export const INTERACTIVE_SELECTORS = [
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
  "[role='option']",
  "[contenteditable='true']",
  "summary",
  "details",
  "[onclick]",
  "[tabindex]:not([tabindex='-1'])",
  "canvas",
  "[draggable='true']",
].join(", ");

/** Container tags for clickable scan filtering */
export const CONTAINER_TAGS = new Set([
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

/**
 * Return query roots through open Shadow DOM and same-origin iframe boundaries.
 *
 * The normal document tree does not include shadow-root descendants, so every
 * consumer that needs page-level discovery must opt into this traversal.
 */
export function getDeepQueryRoots(
  root: Document | ShadowRoot | Element,
  depth: number = 0,
): Array<Document | ShadowRoot | Element> {
  if (depth > MAX_SHADOW_DEPTH) {
    return [];
  }

  const roots: Array<Document | ShadowRoot | Element> = [root];

  try {
    const allElements = root.querySelectorAll("*");

    for (const el of allElements) {
      if (isOwnElement(el)) continue;

      // Shadow DOM traversal (single check — avoids duplicate traversal)
      if (el.shadowRoot) {
        try {
          roots.push(
            ...getDeepQueryRoots(
              el.shadowRoot,
              depth + 1,
            ),
          );
        } catch (_e) {
          continue;
        }
      }

      // Same-origin iframe traversal
      if (el.tagName === "IFRAME") {
        try {
          const iframeDoc = (el as HTMLIFrameElement).contentDocument;
          if (iframeDoc) {
            roots.push(
              ...getDeepQueryRoots(
                iframeDoc,
                depth + 1,
              ),
            );
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

  return roots;
}

/**
 * Recursively query elements through Shadow DOM and iframe boundaries
 */
export function querySelectorAllDeep(
  root: Document | ShadowRoot | Element,
  selector: string,
  depth: number = 0,
): Element[] {
  const results: Element[] = [];

  for (const queryRoot of getDeepQueryRoots(root, depth)) {
    try {
      results.push(
        ...Array.from(queryRoot.querySelectorAll(selector)).filter(
          (el) => !isOwnElement(el),
        ),
      );
    } catch (e) {
      logger.warn("content", "Deep selector query failed", { error: e });
    }
  }

  return [...new Set(results)];
}

/**
 * Detect elements with cursor:pointer that aren't captured by INTERACTIVE_SELECTORS.
 * Time-budgeted to avoid blocking on heavy pages.
 */
export function detectClickableElements(): Element[] {
  const found: Element[] = [];
  const start = performance.now();

  const roots = getDeepQueryRoots(document);

  for (const root of roots) {
    const walkRoot =
      root instanceof Document
        ? root.body || root.documentElement
        : root;
    if (!walkRoot) continue;

    const walker = document.createTreeWalker(
      walkRoot,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          const el = node as Element;
          // Skip our own injected elements (stop button, labels)
          if (isOwnElement(el))
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
        return found;
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
  }

  return found;
}
