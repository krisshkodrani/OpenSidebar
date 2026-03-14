/**
 * Action helpers - shared utilities for action execution
 */

import { getTagMap, getVisibleText } from "../tagging";

export function normalizeTagId(id: number | string | unknown): number {
  if (typeof id === "number" && Number.isFinite(id)) return id;
  if (typeof id === "string") {
    const parsed = Number(id.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NaN;
}

export function getTaggedElement(id: number | string | unknown): Element | null {
  const tagId = normalizeTagId(id);
  if (!Number.isFinite(tagId)) return null;
  return getTagMap().get(tagId) ?? null;
}

/** Build a "No element with tag" error with nearby ID hints for LLM recovery */
export function staleIdError(id: number | unknown): {
  success: false;
  result: string;
  navigated: false;
} {
  const numId = normalizeTagId(id);
  const tagMap = getTagMap();
  const available = Array.from(tagMap.keys())
    .sort((a, b) => Math.abs(a - numId) - Math.abs(b - numId))
    .slice(0, 5);
  const hint =
    available.length > 0
      ? ` Nearby IDs: ${available.map((n) => `[${n}]`).join(", ")}. Call read_page if none match.`
      : " No elements tagged — call read_page to refresh.";
  return {
    success: false,
    result: `No element with tag [${numId}]${hint}`,
    navigated: false,
  };
}

/** Build a compact semantic description of an element for tool result strings. */
export function describeElement(el: Element, id: number): string {
  const tag = el.tagName.toLowerCase();
  const text = getVisibleText(el).slice(0, 40);
  const label =
    el.getAttribute("aria-label") || el.getAttribute("name") || "";
  const parts = [`[${id}] <${tag}>`];
  if (label) parts.push(`"${label}"`);
  else if (text) parts.push(`"${text}"`);
  return parts.join(" ");
}

/** Overlay detection selectors (matches semantic overlay CSS classes/roles) */
export const OVERLAY_SELECTORS = [
  "[role='dialog']",
  "[role='alertdialog']",
  "[aria-modal='true']",
  "dialog[open]",
  ".modal",
  ".overlay",
  ".popup",
  ".banner",
  ".cookie",
  ".consent",
  "[class*='modal']",
  "[class*='overlay']",
  "[class*='popup']",
  "[class*='dialog']",
  "[class*='lightbox']",
  "[class*='backdrop']",
  "[id*='modal']",
  "[id*='overlay']",
  "[id*='dialog']",
  "[id*='lightbox']",
  "[data-modal]",
  "[data-overlay]",
  "[data-dialog]",
  ".lightbox",
  ".notification",
  ".toast",
  ".modal-overlay",
  ".modal-backdrop",
  ".backdrop",
];

/**
 * Check if an element is likely an overlay/modal/popup that can safely be hidden.
 * Returns true if the element matches overlay heuristics (fixed/absolute + high z-index,
 * semantic overlay selectors, backdrop-filter, semi-transparent background, or covers >15% viewport).
 */
export function isLikelyOverlay(el: HTMLElement): boolean {
  // Condition 0: Native HTML dialog element — always an overlay when open
  if (el.tagName === "DIALOG" && el.hasAttribute("open")) return true;

  let style: CSSStyleDeclaration;
  try {
    style = window.getComputedStyle(el);
  } catch {
    return false;
  }
  const position = style.position;
  const isPositioned =
    position === "fixed" || position === "absolute" || position === "sticky";
  const zIndex = parseInt(style.zIndex, 10) || 0;

  // Condition 1: fixed/absolute + high z-index
  if (isPositioned && zIndex > 100) return true;

  // Condition 2: matches semantic overlay selectors
  const selectorStr = OVERLAY_SELECTORS.join(",");
  if (el.matches(selectorStr)) return true;

  // Condition 3: has backdrop-filter
  if (style.backdropFilter && style.backdropFilter !== "none") return true;

  // Condition 4: semi-transparent background (alpha 0-0.9)
  const bg = style.backgroundColor;
  const rgbaMatch = bg.match(
    /rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*([\d.]+)\s*)?\)/,
  );
  if (rgbaMatch && rgbaMatch[1] !== undefined) {
    const alpha = parseFloat(rgbaMatch[1]);
    if (alpha > 0 && alpha <= 0.9) return true;
  }

  // Condition 5: covers >15% of viewport with fixed/absolute positioning
  if (isPositioned) {
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    const vpArea = vpW * vpH;
    if (vpArea > 0) {
      const rect = el.getBoundingClientRect();
      const left = Math.max(0, rect.left);
      const top = Math.max(0, rect.top);
      const right = Math.min(vpW, rect.right);
      const bottom = Math.min(vpH, rect.bottom);
      const visibleArea = Math.max(0, right - left) * Math.max(0, bottom - top);
      if (visibleArea / vpArea > 0.15) return true;
    }
  }

  return false;
}
