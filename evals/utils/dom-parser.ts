/**
 * DOM Parser for Eval System
 *
 * Parses HTML strings into TaggedElement[] using happy-dom,
 * replicating the content script's tagging logic offline.
 */

import { Window } from "happy-dom";
import type { TaggedElement } from "../../src/types/index.js";

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
].join(", ");

const KEEP_ATTRS = [
  "href",
  "placeholder",
  "aria-label",
  "type",
  "name",
  "value",
  "title",
  "alt",
];

function inferRole(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (tag === "a") return "link";
  if (tag === "button" || tag === "summary") return "button";
  if (tag === "input") return (el as any).type || "textbox";
  if (tag === "textarea") return "textbox";
  if (tag === "select") return "combobox";
  return tag;
}

function extractAttributes(el: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const name of KEEP_ATTRS) {
    const val = el.getAttribute(name);
    if (val) attrs[name] = val.slice(0, 100);
  }
  return attrs;
}

function getVisibleText(el: Element): string {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel;

  const text = el.textContent?.trim();
  if (text) return text;

  if (el.tagName.toLowerCase() === "input") {
    return (el as any).value || el.getAttribute("placeholder") || "";
  }

  return "";
}

function isDisabled(el: Element): boolean {
  return (
    el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true"
  );
}

/**
 * Parse an HTML string into TaggedElement[], replicating tagging.ts logic.
 */
export function parseHtmlToTaggedElements(html: string): TaggedElement[] {
  const window = new Window();
  const document = window.document;
  document.write(html);

  const candidates = document.querySelectorAll(INTERACTIVE_SELECTORS);
  const results: TaggedElement[] = [];
  let tagCounter = 0;

  for (const el of candidates) {
    if (results.length >= 200) break;

    tagCounter++;
    results.push({
      tag: tagCounter,
      tagName: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || inferRole(el as unknown as Element),
      text: getVisibleText(el as unknown as Element).slice(0, 80),
      attributes: extractAttributes(el as unknown as Element),
      rect: { x: 0, y: 0, width: 100, height: 30 },
      isVisible: true,
      isDisabled: isDisabled(el as unknown as Element),
    });
  }

  window.close();
  return results;
}

/**
 * Extract clean text content from an HTML string for viewport text.
 */
export function extractViewportTextFromHtml(html: string): string {
  const window = new Window();
  const document = window.document;
  document.write(html);

  const body = document.body;
  if (!body) {
    window.close();
    return "";
  }

  // Remove script, style, noscript
  for (const tag of ["script", "style", "noscript"]) {
    const els = body.querySelectorAll(tag);
    for (const el of els) {
      el.remove();
    }
  }

  const text = (body.textContent || "").trim().replace(/\s+/g, " ").slice(0, 15000);
  window.close();
  return text;
}
