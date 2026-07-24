/**
 * LP-24 presence layer — transient effects: ripples, chips, key caps,
 * scroll glyphs, drag ghosts. All fire-and-forget, capped at 3 concurrent
 * (RFC §7 performance budget), self-removing on animation end.
 */

import type { Point } from "./motion";

const MAX_CONCURRENT_EFFECTS = 3;

function isElementAnchor(anchor: Element | Point): anchor is Element {
  return (
    typeof (anchor as { getBoundingClientRect?: unknown })
      .getBoundingClientRect === "function"
  );
}

export class PresenceEffects {
  private live = 0;

  constructor(private getLayer: () => HTMLElement | null) {}

  private spawn(el: HTMLElement, ttlMs: number): void {
    const layer = this.getLayer();
    if (!layer || this.live >= MAX_CONCURRENT_EFFECTS) return;
    this.live++;
    layer.appendChild(el);
    const drop = () => {
      el.remove();
      this.live = Math.max(0, this.live - 1);
    };
    el.addEventListener("animationend", drop, { once: true });
    // Backstop for reduced-motion / cancelled animations.
    setTimeout(drop, ttlMs + 400);
  }

  ripple(
    at: Point,
    variant: "accent" | "error" | "square" = "accent",
    scale = 1,
  ): void {
    const doc = this.getLayer()?.ownerDocument;
    if (!doc) return;
    const el = doc.createElement("div");
    el.className =
      variant === "error"
        ? "ripple error"
        : variant === "square"
          ? "ripple square"
          : "ripple";
    el.style.left = `${at.x}px`;
    el.style.top = `${at.y}px`;
    if (scale !== 1) {
      const size = Math.round(14 * scale);
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.margin = `-${size / 2}px 0 0 -${size / 2}px`;
    }
    this.spawn(el, 300);
  }

  /**
   * Selection / status chip ("Business ✓", "file attached"). Anchored to the
   * ELEMENT when given one: the rect is read at spawn time — after the page
   * has reacted to the action — so a reflow (e.g. conditional fields
   * appearing) cannot strand the chip at stale coordinates (owner report).
   */
  chip(anchor: Element | Point, text: string): void {
    const doc = this.getLayer()?.ownerDocument;
    if (!doc) return;
    let at: Point;
    if (isElementAnchor(anchor)) {
      const rect = anchor.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return; // element left the page
      at = { x: rect.right - 8, y: rect.top };
    } else {
      at = anchor;
    }
    const el = doc.createElement("div");
    el.className = "chip";
    el.textContent = text;
    el.style.left = `${at.x + 14}px`;
    el.style.top = `${at.y - 30}px`;
    this.spawn(el, 900);
  }

  /** Key-cap chip for non-pointer actions (⏎, esc, tab) — RFC §5. */
  keyChip(at: Point, key: string): void {
    const doc = this.getLayer()?.ownerDocument;
    if (!doc) return;
    const el = doc.createElement("div");
    el.className = "chip key";
    el.textContent = formatKeyCap(key);
    el.style.left = `${at.x + 14}px`;
    el.style.top = `${at.y - 30}px`;
    this.spawn(el, 600);
  }

  /** Two-chevron pulse beside the cursor in the scroll direction. */
  scrollGlyph(at: Point, direction: "up" | "down" | "left" | "right"): void {
    const doc = this.getLayer()?.ownerDocument;
    if (!doc) return;
    const el = doc.createElement("div");
    el.className = "scroll-glyph";
    el.textContent =
      direction === "up"
        ? "︿︿"
        : direction === "down"
          ? "﹀﹀"
          : direction === "left"
            ? "‹‹"
            : "››";
    el.style.left = `${at.x + 16}px`;
    el.style.top = `${at.y - 8}px`;
    this.spawn(el, 700);
  }

  /** Low-opacity dashed outline that follows the cursor during a drag. */
  createDragGhost(rect: DOMRect): HTMLElement | null {
    const layer = this.getLayer();
    const doc = layer?.ownerDocument;
    if (!layer || !doc) return null;
    const el = doc.createElement("div");
    el.className = "drag-ghost";
    el.style.width = `${Math.min(rect.width, 240)}px`;
    el.style.height = `${Math.min(rect.height, 120)}px`;
    el.style.left = "0";
    el.style.top = "0";
    layer.appendChild(el);
    return el;
  }
}

export function formatKeyCap(key: string): string {
  const normalized = key.toLowerCase();
  if (normalized === "enter" || normalized === "return") return "⏎";
  if (normalized === "escape" || normalized === "esc") return "esc";
  if (normalized === "tab") return "⇥";
  if (normalized === "backspace") return "⌫";
  if (normalized.startsWith("arrow")) {
    const dir = normalized.slice(5);
    return dir === "up" ? "↑" : dir === "down" ? "↓" : dir === "left" ? "←" : "→";
  }
  return key.length > 8 ? key.slice(0, 8) : key;
}
