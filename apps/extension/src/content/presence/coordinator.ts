/**
 * LP-24 presence layer — the choreography coordinator.
 *
 * Runs a script (glide → dwell → press → ripple) ahead of the real event
 * dispatch. Fail-open by construction: `perform` resolves at the dispatch
 * point, and a hard watchdog (WATCHDOG_MS per mode) guarantees it resolves
 * even if an effect throws or the tab is throttled. Presence can delay an
 * action by at most the watchdog; it can never block one (RFC §2.1).
 */

import type { PresenceMode } from "@shared-types/settings";
import type { ChoreographyScript } from "./choreography";
import type { Point } from "./motion";
import { ARRIVAL_DWELL_MS, sampleGlide } from "./motion";
import { PresenceCursor } from "./cursor";
import { PresenceEffects } from "./effects";

/** Presence can never delay a real action beyond this bounded window. */
export const WATCHDOG_MS = { subtle: 600, cinematic: 600 } as const;

export interface CoordinatorOptions {
  doc?: Document;
  /** Test seam — defaults to matchMedia("(prefers-reduced-motion: reduce)"). */
  prefersReducedMotion?: () => boolean;
  /** Test seam — defaults to requestAnimationFrame with setTimeout fallback. */
  raf?: (cb: () => void) => void;
  /** Debounce before hiding at session end (lane flips must not blink). */
  sessionHideDelayMs?: number;
}

export class PresenceCoordinator {
  readonly cursor: PresenceCursor;
  readonly effects: PresenceEffects;
  private mode: PresenceMode = "off";
  private queue: Promise<void> = Promise.resolve();
  private reducedMotion: () => boolean;
  private raf: (cb: () => void) => void;

  constructor(options: CoordinatorOptions = {}) {
    const doc = options.doc ?? document;
    this.cursor = new PresenceCursor(doc);
    this.effects = new PresenceEffects(() => this.cursor.getLayer());
    this.reducedMotion =
      options.prefersReducedMotion ??
      (() =>
        doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)")
          .matches ?? false);
    this.raf =
      options.raf ??
      ((cb) => {
        const view = doc.defaultView;
        if (view?.requestAnimationFrame) view.requestAnimationFrame(() => cb());
        else setTimeout(cb, 16);
      });
    this.sessionHideDelayMs = options.sessionHideDelayMs ?? 4000;
  }

  setMode(mode: PresenceMode): void {
    this.mode = mode;
    if (mode === "off") {
      this.cursor.detach();
    } else if (this.sessionActive) {
      this.cursor.show();
    }
  }

  private sessionActive = false;
  private sessionHideTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Session-scoped visibility (owner feedback 2026-07-24): show the cursor
   * for the whole agent session — it glides between actions and sits still
   * while the model thinks, like a real hand on a real mouse — and fade it
   * out only when the session ends. The hide is DEBOUNCED: the orchestrator
   * flips the activity signal off/on between plan lanes, and hiding on every
   * flip made the cursor appear and disappear mid-run (owner report #3).
   */
  setSessionActive(active: boolean): void {
    this.sessionActive = active;
    if (this.mode === "off") return;
    if (active) {
      if (this.sessionHideTimer) clearTimeout(this.sessionHideTimer);
      this.sessionHideTimer = null;
      this.cursor.show();
      return;
    }
    if (this.sessionHideTimer) clearTimeout(this.sessionHideTimer);
    this.sessionHideTimer = setTimeout(() => {
      this.sessionHideTimer = null;
      if (!this.sessionActive) {
        this.cursor.hide();
      }
    }, this.sessionHideDelayMs);
  }

  private readonly sessionHideDelayMs: number;

  getMode(): PresenceMode {
    return this.mode;
  }

  suspend(): void {
    this.cursor.suspend();
  }

  resume(): void {
    this.cursor.resume();
  }

  /**
   * Play the pre-dispatch choreography for a script. Resolves at the
   * dispatch point. Never rejects.
   */
  perform(script: ChoreographyScript, onActing?: () => void): Promise<void> {
    if (this.mode === "off" || script.kind === "none") {
      return Promise.resolve();
    }
    if (this.cursor.isSuspended || document.visibilityState === "hidden") {
      return Promise.resolve();
    }
    const watchdogMs =
      this.mode === "cinematic" ? WATCHDOG_MS.cinematic : WATCHDOG_MS.subtle;
    const run = this.queue
      .then(() => this.runScript(script, onActing))
      .catch(() => {});
    // Travel stays ordered; outcome effects run independently and never hold
    // the next action behind a decorative linger.
    this.queue = run;
    void run.then(() => this.postAction(script)).catch(() => {});
    return Promise.race([
      run,
      new Promise<void>((resolve) => setTimeout(resolve, watchdogMs)),
    ]);
  }

  /** Post-dispatch settle: the page has reacted by now, so effects that
   *  narrate the OUTCOME (chips) anchor against fresh element geometry. */
  private async postAction(script: ChoreographyScript): Promise<void> {
    if (script.chipText) {
      // Two frames: let the framework re-render before reading the rect.
      await this.frame();
      await this.frame();
      const anchor = script.anchorTarget ?? script.point;
      if (anchor) this.effects.chip(anchor, script.chipText);
    }
    // A newer action arrived during the linger — it glides from here.
  }

  private async runScript(
    script: ChoreographyScript,
    onActing?: () => void,
  ): Promise<void> {
    const wasHidden = this.cursor.wake();

    if (script.point) {
      if (wasHidden && !this.reducedMotion()) {
        // Movement must never start on an invisible cursor — let the fade-in
        // land first so the viewer sees the cursor LEAVE, not arrive.
        await new Promise((resolve) => setTimeout(resolve, 240));
      }
      await this.glideTo(
        script.point,
        script.targetWidth,
        null,
        script.acquisition,
      );
      await this.dwell();
    }

    onActing?.();
    switch (script.kind) {
      case "click":
      case "right_click":
      case "checkbox":
      case "upload":
      case "type":
      case "select": {
        this.cursor.pressDown();
        await this.frame();
        this.cursor.pressUp();
        if (script.point && script.ripple !== "none") {
          this.effects.ripple(
            script.point,
            script.ripple === "square" ? "square" : "accent",
            this.mode === "cinematic" ? 1.6 : 1,
          );
        }
        // No halo on focusable fields — the page's native focus ring is the
        // only highlight (owner reports: anything layered on it reads as a
        // double). Chips spawn in settle(), AFTER the page has reacted.
        break;
      }
      case "key": {
        if (script.keyLabel) {
          this.effects.keyChip(this.cursor.position, script.keyLabel);
        }
        break;
      }
      case "scroll": {
        if (script.scrollDirection) {
          this.effects.scrollGlyph(
            this.cursor.position,
            script.scrollDirection,
          );
        }
        break;
      }
      case "drag": {
        await this.runDrag(script);
        break;
      }
      case "hover":
      case "none":
        break;
    }
  }

  private async runDrag(script: ChoreographyScript): Promise<void> {
    if (!script.dragTo) return;
    this.cursor.pressDown();
    const ghost = script.dragSourceRect
      ? this.effects.createDragGhost(script.dragSourceRect)
      : null;
    // Weighted glide: ×1.4 duration via a narrower virtual target (RFC §5).
    await this.glideTo(
      script.dragTo,
      Math.max(6, script.targetWidth / 3),
      ghost,
    );
    ghost?.remove();
    this.cursor.pressUp();
    this.effects.ripple(script.dragTo, "accent");
  }

  private async glideTo(
    to: Point,
    targetWidth: number,
    follower: HTMLElement | null = null,
    showAcquisition = false,
  ): Promise<void> {
    if (this.reducedMotion()) {
      // Accessibility floor (RFC §7): instant reposition, no glide.
      this.cursor.moveTo(to);
      return;
    }
    const { points, durationMs } = sampleGlide(
      this.cursor.position,
      to,
      targetWidth,
      this.mode === "cinematic" ? "cinematic" : "subtle",
    );
    if (points.length > 5) {
      const trailPoints = points.slice(Math.max(0, points.length - 6), -1);
      setTimeout(
        () => this.effects.motionTrail(trailPoints),
        Math.max(0, durationMs - 80),
      );
    }
    if (showAcquisition) {
      setTimeout(
        () => this.effects.acquisition(to, this.mode === "cinematic"),
        Math.max(0, durationMs - 60),
      );
    }
    // Preferred path: compositor-driven WAAPI glide — the x,y travel renders
    // smoothly even while agent actions jank the main thread. The drag ghost
    // follower still needs the rAF path to track the cursor.
    if (!follower && (await this.cursor.animateGlide(points, durationMs))) {
      return;
    }
    for (const point of points) {
      this.cursor.moveTo(point);
      if (follower) {
        follower.style.transform = `translate3d(${point.x + 8}px, ${point.y + 8}px, 0)`;
      }
      await new Promise<void>((resolve) => this.raf(resolve));
    }
  }

  private dwell(): Promise<void> {
    if (this.reducedMotion()) return Promise.resolve();
    const ms =
      this.mode === "cinematic"
        ? ARRIVAL_DWELL_MS.cinematic
        : ARRIVAL_DWELL_MS.subtle;
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private frame(): Promise<void> {
    return new Promise((resolve) => this.raf(resolve));
  }

  /** Post-action failure feedback: shake + red pulse at the last position. */
  errorPulse(): void {
    if (this.mode === "off") return;
    this.cursor.wake();
    this.cursor.shake();
    this.effects.ripple(this.cursor.position, "error");
  }
}
