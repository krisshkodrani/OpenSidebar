/**
 * Readability + Turndown — DOM distillation to clean Markdown.
 *
 * Two extraction strategies:
 * 1. extractPageContent() — Readability parses article-like pages, Turndown converts to Markdown.
 * 2. extractVisibleText() — TreeWalker fallback for SPAs/dashboards where Readability fails.
 */

import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

/** Shared Turndown instance (stateless — safe to reuse). */
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

// Custom rule: strip empty anchors and image-only links (noise)
turndown.addRule("stripEmptyLinks", {
  filter(node) {
    return (
      node.nodeName === "A" &&
      !node.textContent?.trim() &&
      !node.querySelector("img")
    );
  },
  replacement() {
    return "";
  },
});

/**
 * Extract page content as clean Markdown using Readability + Turndown.
 *
 * Clones the document (non-destructive), runs Mozilla Readability to strip
 * navigation/ads/sidebars, then converts the cleaned HTML to Markdown.
 *
 * @returns Markdown string, or null if Readability can't parse the page
 *          (dashboards, SPAs, mostly-empty pages).
 */
export function extractPageContent(): string | null {
  try {
    const clone = document.cloneNode(true) as Document;
    const reader = new Readability(clone);
    const article = reader.parse();

    if (!article || !article.content) return null;

    const markdown = turndown.turndown(article.content);

    // Collapse excessive blank lines (3+ → 2)
    return markdown.replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    // Readability can throw on malformed DOMs
    return null;
  }
}

/** Tags to skip when walking the DOM for visible text. */
const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "SVG",
  "TEMPLATE",
  "IFRAME",
  "OBJECT",
  "EMBED",
]);

/**
 * Fallback text extraction for pages where Readability fails (SPAs, dashboards, etc.).
 *
 * Walks visible text nodes via TreeWalker, skipping hidden elements and
 * non-content tags. Returns space-joined, whitespace-collapsed plain text.
 *
 * @param maxLength Maximum characters to collect (default 15000).
 */
export function extractVisibleText(maxLength: number = 15000): string {
  const chunks: string[] = [];
  let length = 0;

  const walker = document.createTreeWalker(
    document.body || document.documentElement,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        // Skip non-content tags
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;

        // Skip hidden elements
        if (parent.offsetParent === null && parent.tagName !== "BODY") {
          return NodeFilter.FILTER_REJECT;
        }

        const text = node.textContent?.trim();
        if (!text) return NodeFilter.FILTER_REJECT;

        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  while (walker.nextNode()) {
    const text = walker.currentNode.textContent?.trim();
    if (!text) continue;

    chunks.push(text);
    length += text.length;

    if (length >= maxLength) break;
  }

  // Join and collapse whitespace
  return chunks
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
