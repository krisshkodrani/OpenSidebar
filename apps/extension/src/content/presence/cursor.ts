/**
 * LP-24 presence layer — host element and cursor glyph lifecycle.
 *
 * One <opensidebar-presence> host on document.documentElement with an open
 * shadow root; `pointer-events: none` everywhere, aria-hidden, z-index one
 * above the agent border. A MutationObserver re-appends the host if the page
 * removes it; fullscreenchange reparents it (RFC §3).
 */

import type { Point } from "./motion";
import { CURSOR_ARROW_SVG, PRESENCE_STYLE_TEXT } from "./presence-styles";

export const PRESENCE_HOST_TAG = "opensidebar-presence";

const POSITION_STORAGE_KEY = "opensidebar-presence-pos";

export class PresenceCursor {
  private host: HTMLElement | null = null;
  private layer: HTMLElement | null = null;
  private cursorEl: HTMLElement | null = null;
  private observer: MutationObserver | null = null;
  private suspended = false;
  position: Point;

  constructor(private doc: Document = document) {
    this.position = this.restorePosition();
  }

  /** Effect/halo layers render into the same fixed layer as the cursor. */
  getLayer(): HTMLElement | null {
    return this.layer;
  }

  attach(): void {
    if (this.host?.isConnected) return;
    if (!this.host) {
      this.host = this.doc.createElement(PRESENCE_HOST_TAG);
      this.host.setAttribute("aria-hidden", "true");
      const shadow = this.host.attachShadow({ mode: "open" });
      const style = this.doc.createElement("style");
      style.textContent = PRESENCE_STYLE_TEXT;
      shadow.appendChild(style);
      this.layer = this.doc.createElement("div");
      this.layer.id = "layer";
      shadow.appendChild(this.layer);
      this.cursorEl = this.doc.createElement("div");
      this.cursorEl.id = "cursor";
      this.cursorEl.innerHTML = `<span class="glyph">${CURSOR_ARROW_SVG}</span>`;
      this.layer.appendChild(this.cursorEl);
      this.applyPosition();
    }
    this.parentTarget().appendChild(this.host);
    if (!this.observer) {
      // Re-append if an SPA wipes the host; reparent across fullscreen flips.
      this.observer = new MutationObserver(() => {
        if (this.host && !this.host.isConnected) {
          this.parentTarget().appendChild(this.host);
        }
      });
      this.observer.observe(this.doc.documentElement, { childList: true });
      this.doc.addEventListener("fullscreenchange", this.onFullscreenChange);
      this.doc.defaultView?.addEventListener("pagehide", this.persistPosition);
    }
  }

  detach(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.doc.removeEventListener("fullscreenchange", this.onFullscreenChange);
    this.doc.defaultView?.removeEventListener("pagehide", this.persistPosition);
    this.host?.remove();
    this.host = null;
    this.layer = null;
    this.cursorEl = null;
  }

  private onFullscreenChange = (): void => {
    if (this.host) this.parentTarget().appendChild(this.host);
  };

  private parentTarget(): Element {
    return this.doc.fullscreenElement ?? this.doc.documentElement;
  }

  /** Hide synchronously (same frame) for perception captures (RFC §6). */
  suspend(): void {
    this.suspended = true;
    if (this.host) this.host.style.display = "none";
  }

  /** Restore with a short fade so the capture bracket reads as a soft blink,
   *  not a pop (owner feedback 2026-07-24: continuity over flicker). */
  resume(): void {
    this.suspended = false;
    if (!this.host) return;
    this.host.style.display = "";
    if (this.cursorEl?.classList.contains("visible")) {
      this.cursorEl.classList.add("soft-in");
      setTimeout(() => this.cursorEl?.classList.remove("soft-in"), 200);
    }
  }

  get isSuspended(): boolean {
    return this.suspended;
  }

  moveTo(point: Point): void {
    this.position = point;
    this.applyPosition();
  }

  /**
   * Compositor-driven glide (owner feedback 2026-07-24: the movement through
   * x,y space must always render). Web Animations API with pre-eased path
   * keyframes runs on the compositor, so the travel stays smooth even while
   * the agent is busy mutating the DOM on the main thread. Returns false when
   * WAAPI is unavailable so the caller can fall back to the rAF loop.
   */
  animateGlide(points: Point[], durationMs: number): Promise<boolean> {
    const el = this.cursorEl;
    if (!el || typeof el.animate !== "function" || points.length === 0) {
      return Promise.resolve(false);
    }
    // Downsample to ≤16 keyframes — the points are already eased, so equal
    // keyframe spacing with linear easing preserves the acceleration curve.
    const step = Math.max(1, Math.floor(points.length / 15));
    const sampled = points.filter((_, i) => i % step === 0);
    if (sampled[sampled.length - 1] !== points[points.length - 1]) {
      sampled.push(points[points.length - 1]);
    }
    const keyframes = sampled.map((p) => ({
      transform: `translate3d(${p.x - 5}px, ${p.y - 3}px, 0)`,
    }));
    const animation = el.animate(keyframes, {
      duration: Math.max(1, durationMs),
      easing: "linear",
      fill: "forwards",
    });
    const target = points[points.length - 1];
    return new Promise<boolean>((resolve) => {
      const settle = () => {
        this.position = target;
        this.applyPosition();
        try {
          animation.cancel();
        } catch {
          /* already done */
        }
        resolve(true);
      };
      animation.finished.then(settle).catch(settle);
      // Guard: a paused/throttled document must not strand the glide.
      setTimeout(settle, durationMs + 400);
    });
  }

  private applyPosition(): void {
    if (!this.cursorEl) return;
    // Hotspot registration: the arrow TIP sits ~(5,3)px inside the 32px SVG;
    // offset so the tip — not the glyph's corner — lands on the target.
    this.cursorEl.style.transform = `translate3d(${this.position.x - 5}px, ${this.position.y - 3}px, 0)`;
  }

  /**
   * Session-scoped visibility (owner feedback 2026-07-24): a real cursor
   * never vanishes between movements. `show()` fades in once when the agent
   * session starts and the cursor then STAYS visible — no idle hide — until
   * `hide()` at session end. wake() only guarantees attachment+visibility.
   */
  show(): void {
    this.attach();
    this.cursorEl?.classList.add("visible");
  }

  hide(): void {
    this.cursorEl?.classList.remove("visible");
  }

  wake(): void {
    this.show();
  }

  pressDown(): void {
    if (this.cursorEl) this.cursorEl.style.scale = "0.92";
  }

  pressUp(): void {
    if (this.cursorEl) this.cursorEl.style.scale = "";
  }

  shake(): void {
    if (!this.cursorEl) return;
    this.cursorEl.classList.remove("shake");
    // Force a reflow so re-adding restarts the animation.
    void this.cursorEl.offsetWidth;
    this.cursorEl.classList.add("shake");
  }

  /** Continuity across same-tab navigations (RFC §4). */
  private persistPosition = (): void => {
    try {
      this.doc.defaultView?.sessionStorage.setItem(
        POSITION_STORAGE_KEY,
        JSON.stringify(this.position),
      );
    } catch {
      /* sessionStorage unavailable (sandboxed frame) — continuity is optional */
    }
  };

  private restorePosition(): Point {
    try {
      const raw = this.doc.defaultView?.sessionStorage.getItem(
        POSITION_STORAGE_KEY,
      );
      if (raw) {
        const parsed = JSON.parse(raw) as Point;
        if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
          return parsed;
        }
      }
    } catch {
      /* fall through to default */
    }
    const view = this.doc.defaultView;
    return {
      x: (view?.innerWidth ?? 1200) / 2,
      y: (view?.innerHeight ?? 800) / 3,
    };
  }
}
