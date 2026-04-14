/**
 * Sprint 3 WI-1: Broadened Overlay Detection Tests
 * Tests for: expanded selectors, lowered threshold, dialog[open], aria-modal, backdrop detection
 */

import { describe, test, expect, beforeEach } from "vitest";
import "../setup";
import { isLikelyOverlay } from "../../src/content/actions";
import { detectViewportCoveringOverlays } from "../../src/content/content";

// Mock viewport dimensions
Object.defineProperty(window, "innerWidth", { value: 1024, writable: true });
Object.defineProperty(window, "innerHeight", { value: 768, writable: true });

// Patch getComputedStyle to read inline styles
const _origGetComputedStyle = window.getComputedStyle;
window.getComputedStyle = function (el: Element) {
  const base = _origGetComputedStyle.call(window, el);
  const htmlEl = el as HTMLElement;
  return new Proxy(base, {
    get(target, prop) {
      if (prop === "position" && htmlEl.style?.position) return htmlEl.style.position;
      if (prop === "display" && htmlEl.style?.display) return htmlEl.style.display;
      if (prop === "visibility" && htmlEl.style?.visibility) return htmlEl.style.visibility;
      if (prop === "opacity" && htmlEl.style?.opacity) return htmlEl.style.opacity;
      if (prop === "zIndex" && htmlEl.style?.zIndex) return htmlEl.style.zIndex;
      if (prop === "backdropFilter" && htmlEl.style?.backdropFilter) return htmlEl.style.backdropFilter;
      if (prop === "backgroundColor" && htmlEl.style?.backgroundColor) return htmlEl.style.backgroundColor;
      if (prop === "clip") return (target as any).clip || "auto";
      return (target as any)[prop as any];
    },
  });
} as typeof window.getComputedStyle;

// Per-element bounding rect overrides
const rectOverrides = new WeakMap<Element, DOMRect>();
function setMockRect(el: Element, rect: Partial<DOMRect>) {
  const full = {
    x: rect.x ?? 0,
    y: rect.y ?? 0,
    width: rect.width ?? 100,
    height: rect.height ?? 100,
    top: rect.top ?? rect.y ?? 0,
    left: rect.left ?? rect.x ?? 0,
    bottom: (rect.top ?? rect.y ?? 0) + (rect.height ?? 100),
    right: (rect.left ?? rect.x ?? 0) + (rect.width ?? 100),
    toJSON: () => {},
  } as DOMRect;
  rectOverrides.set(el, full);
}

const _origGetBoundingClientRect = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function () {
  const override = rectOverrides.get(this);
  if (override) return override;
  return _origGetBoundingClientRect.call(this);
};

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("isLikelyOverlay — broadened selectors", () => {
  test("[aria-modal='true'] element detected as overlay", () => {
    const el = document.createElement("div");
    el.setAttribute("aria-modal", "true");
    document.body.appendChild(el);
    expect(isLikelyOverlay(el)).toBe(true);
  });

  test("<dialog open> detected as overlay", () => {
    const el = document.createElement("dialog");
    el.setAttribute("open", "");
    document.body.appendChild(el);
    expect(isLikelyOverlay(el)).toBe(true);
  });

  test("<dialog> without open attribute is NOT detected", () => {
    const el = document.createElement("dialog");
    document.body.appendChild(el);
    expect(isLikelyOverlay(el)).toBe(false);
  });

  test("[data-modal] element detected as overlay", () => {
    const el = document.createElement("div");
    el.setAttribute("data-modal", "");
    document.body.appendChild(el);
    expect(isLikelyOverlay(el)).toBe(true);
  });

  test("[data-overlay] element detected as overlay", () => {
    const el = document.createElement("div");
    el.setAttribute("data-overlay", "");
    document.body.appendChild(el);
    expect(isLikelyOverlay(el)).toBe(true);
  });

  test("[data-dialog] element detected as overlay", () => {
    const el = document.createElement("div");
    el.setAttribute("data-dialog", "");
    document.body.appendChild(el);
    expect(isLikelyOverlay(el)).toBe(true);
  });

  test(".lightbox element detected as overlay", () => {
    const el = document.createElement("div");
    el.className = "lightbox";
    document.body.appendChild(el);
    expect(isLikelyOverlay(el)).toBe(true);
  });

  test(".backdrop element detected as overlay", () => {
    const el = document.createElement("div");
    el.className = "backdrop";
    document.body.appendChild(el);
    expect(isLikelyOverlay(el)).toBe(true);
  });

  test("[class*='backdrop'] element detected as overlay", () => {
    const el = document.createElement("div");
    el.className = "my-backdrop-layer";
    document.body.appendChild(el);
    expect(isLikelyOverlay(el)).toBe(true);
  });

  test(".notification element detected as overlay", () => {
    const el = document.createElement("div");
    el.className = "notification";
    document.body.appendChild(el);
    expect(isLikelyOverlay(el)).toBe(true);
  });

  test(".toast element detected as overlay", () => {
    const el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
    expect(isLikelyOverlay(el)).toBe(true);
  });
});

describe("isLikelyOverlay — lowered viewport threshold", () => {
  test("20% viewport coverage triggers detection (above 15% threshold)", () => {
    const el = document.createElement("div");
    el.style.position = "fixed";
    document.body.appendChild(el);
    // 20% of 1024*768 = 157,286 → ~397x397
    setMockRect(el, { x: 0, y: 0, width: 400, height: 400, top: 0, left: 0 });
    expect(isLikelyOverlay(el)).toBe(true);
  });

  test("10% viewport coverage does NOT trigger (below 15% threshold)", () => {
    const el = document.createElement("div");
    el.style.position = "fixed";
    document.body.appendChild(el);
    // ~10% of 1024*768 = 78,643 → ~280x280
    setMockRect(el, { x: 0, y: 0, width: 280, height: 280, top: 0, left: 0 });
    expect(isLikelyOverlay(el)).toBe(false);
  });
});

describe("detectViewportCoveringOverlays — lowered threshold", () => {
  test("detects overlay at 20% viewport coverage", () => {
    const el = document.createElement("div");
    el.style.position = "fixed";
    document.body.appendChild(el);
    // ~20% coverage
    setMockRect(el, { x: 0, y: 0, width: 400, height: 384, top: 0, left: 0 });
    const results = detectViewportCoveringOverlays();
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});
