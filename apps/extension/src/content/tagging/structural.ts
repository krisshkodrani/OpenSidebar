/**
 * Structural extraction — lightweight page skeleton alongside interactive elements.
 *
 * Extracts headings, landmarks, status/live regions, and visible text nodes
 * that give the page meaning beyond interactive elements. Capped at 30 nodes
 * with priority: headings > landmarks > status > text.
 */

import { PageSkeletonNode } from "../../types";
import { isElementVisible, truncateText } from "./utils";

/** Maximum skeleton nodes to emit */
const MAX_SKELETON_NODES = 30;

/** Minimum text length for text-content nodes (rule 4) */
const MIN_TEXT_LENGTH = 10;

/** Minimum text length for headings and landmarks (rules 1-3) */
const MIN_STRUCTURAL_TEXT_LENGTH = 3;

/** Maximum nesting depth reported */
const MAX_DEPTH = 4;

// --- Selector sets ---

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6, [role='heading']";

const LANDMARK_SELECTOR = [
  "nav",
  "main",
  "header",
  "footer",
  "aside",
  "[role='banner']",
  "[role='navigation']",
  "[role='main']",
  "[role='contentinfo']",
  "[role='complementary']",
  "[role='region'][aria-label]",
].join(", ");

const STATUS_SELECTOR = [
  "[role='status']",
  "[role='alert']",
  "[role='progressbar']",
  "[aria-live]",
].join(", ");

const TEXT_SELECTOR = [
  "p",
  "span",
  "li",
  "td",
  "th",
  "caption",
  "figcaption",
  "label",
  "blockquote",
].join(", ");

/** Tier for priority ordering */
const enum Tier {
  HEADING = 0,
  LANDMARK = 1,
  STATUS = 2,
  TEXT = 3,
}

interface CandidateNode {
  el: Element;
  node: PageSkeletonNode;
  tier: Tier;
}

/** Compute nesting depth from <body>, capped at MAX_DEPTH */
function computeDepth(el: Element): number {
  let depth = 0;
  let current = el.parentElement;
  while (current && current !== document.body && depth < MAX_DEPTH) {
    depth++;
    current = current.parentElement;
  }
  return Math.min(depth, MAX_DEPTH);
}

/** Get the heading level from an element (1-6) */
function getHeadingLevel(el: Element): number | undefined {
  const tag = el.tagName.toLowerCase();
  if (tag.startsWith("h") && tag.length === 2) {
    const n = parseInt(tag[1], 10);
    if (n >= 1 && n <= 6) return n;
  }
  // [role='heading'] with aria-level
  const ariaLevel = el.getAttribute("aria-level");
  if (ariaLevel) {
    const n = parseInt(ariaLevel, 10);
    if (n >= 1 && n <= 6) return n;
  }
  return undefined;
}

/** Map element to semantic role */
function inferStructuralRole(el: Element): string {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;

  const tag = el.tagName.toLowerCase();
  const roleMap: Record<string, string> = {
    h1: "heading",
    h2: "heading",
    h3: "heading",
    h4: "heading",
    h5: "heading",
    h6: "heading",
    nav: "navigation",
    main: "main",
    header: "banner",
    footer: "contentinfo",
    aside: "complementary",
  };
  return roleMap[tag] || tag;
}

/** Get direct text content of an element (not deeply nested children for text nodes) */
function getDirectText(el: Element): string {
  return (el.textContent ?? "").trim();
}

/**
 * Extract a lightweight page skeleton: headings, landmarks, status/live regions,
 * and visible text nodes that aren't already captured as interactive elements.
 *
 * @param interactiveTexts - Set of trimmed text strings already shown as interactive elements (for dedup)
 */
export function extractPageSkeleton(
  interactiveTexts?: Set<string>,
): PageSkeletonNode[] {
  const dedup = interactiveTexts ?? new Set<string>();
  const candidates: CandidateNode[] = [];
  const seenTexts = new Set<string>();

  // Helper: try to add an element as a candidate
  function tryAdd(el: Element, tier: Tier, minText: number): void {
    if (!isElementVisible(el)) return;

    const text = getDirectText(el);
    if (text.length < minText) return;

    // Dedup against interactive elements
    if (dedup.has(text)) return;

    // Dedup within skeleton (same trimmed text)
    if (seenTexts.has(text)) return;
    seenTexts.add(text);

    const tagName = el.tagName.toLowerCase();
    const node: PageSkeletonNode = {
      tagName,
      role: inferStructuralRole(el),
      text: truncateText(text, 120),
      depth: computeDepth(el),
    };

    const level = getHeadingLevel(el);
    if (level !== undefined) {
      node.level = level;
    }

    candidates.push({ el, node, tier });
  }

  // 1. Headings (always kept, high signal)
  for (const el of document.querySelectorAll(HEADING_SELECTOR)) {
    tryAdd(el, Tier.HEADING, MIN_STRUCTURAL_TEXT_LENGTH);
  }

  // 2. Landmarks (always kept, high signal)
  for (const el of document.querySelectorAll(LANDMARK_SELECTOR)) {
    tryAdd(el, Tier.LANDMARK, MIN_STRUCTURAL_TEXT_LENGTH);
  }

  // 3. Status / live regions (always kept)
  for (const el of document.querySelectorAll(STATUS_SELECTOR)) {
    tryAdd(el, Tier.STATUS, MIN_STRUCTURAL_TEXT_LENGTH);
  }

  // 4. Text nodes (fill remaining budget, ≥10 chars)
  for (const el of document.querySelectorAll(TEXT_SELECTOR)) {
    tryAdd(el, Tier.TEXT, MIN_TEXT_LENGTH);
  }

  // 5. Cap at MAX_SKELETON_NODES with tier priority
  // All headings + all landmarks + all status, then fill with text
  const byTier: CandidateNode[][] = [[], [], [], []];
  for (const c of candidates) {
    byTier[c.tier].push(c);
  }

  const selected: CandidateNode[] = [];
  for (const tierBucket of byTier) {
    for (const c of tierBucket) {
      if (selected.length >= MAX_SKELETON_NODES) break;
      selected.push(c);
    }
    if (selected.length >= MAX_SKELETON_NODES) break;
  }

  // 6. Re-sort into DOM order for final output
  selected.sort((a, b) => {
    const pos = a.el.compareDocumentPosition(b.el);
    // DOCUMENT_POSITION_FOLLOWING (4) means b is after a → a comes first
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });

  return selected.map((c) => c.node);
}
