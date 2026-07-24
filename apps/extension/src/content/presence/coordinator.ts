/**
 * LP-24 presence layer — the choreography coordinator.
 *
 * Runs a script (glide → dwell → press → ripple) ahead of the real event
 * dispatch. Fail-open by construction: `perform` resolves at the dispatch
 * point, and a hard watchdog (600ms subtle / 1600ms cinematic) guarantees it
 * resolves even if an effect throws or the tab is throttled. Presence can
 * delay an action by at most the watchdog; it can never block one (RFC §2.1).
 */

import type { PresenceMode } from "@shared-types/settings";
import type { ChoreographyScript } from "./choreography";
import type { Point } from "./motion";
import { ARRIVAL_DWELL_MS, sampleGlide } from "./motion";
import { PresenceCursor } from "./cursor";
import { PresenceEffects } from "./effects";
import { FocusHalo } from "./focus-halo";

export const WATCHDOG_MS = { subtle: 600, cinematic: 1600 } as const;

export interface CoordinatorOptions {
  doc?: Document;
  /** Test seam — defaults to matchMedia("(prefers-reduced-motion: reduce)"). */
  prefersReducedMotion?: () => boolean;
  /** Test seam — defaults to requestAnimationFrame with setTimeout fallback. */
  raf?: (cb: () => void) => void;
}

export class PresenceCoordinator {
  readonly cursor: PresenceCursor;
  readonly effects: PresenceEffects;
  readonly halo: FocusHalo;
  private mode: PresenceMode = "off";
  private queue: Promise<void> = Promise.resolve();
  private reducedMotion: () => boolean;
  private raf: (cb: () => void) => void;

  constructor(options: CoordinatorOptions = {}) {
    const doc = options.doc ?? document;
    this.cursor = new PresenceCursor(doc);
    this.effects = new PresenceEffects(() => this.cursor.getLayer());
    this.halo = new FocusHalo(() => this.cursor.getLayer());
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
  }

  setMode(mode: PresenceMode): void {
    this.mode = mode;
    if (mode === "off") {
      this.halo.clear();
      this.cursor.detach();
    } else if (this.sessionActive) {
      this.cursor.show();
    }
  }

  private sessionActive = false;

  /**
   * Session-scoped visibility (owner feedback 2026-07-24): show the cursor
   * for the whole agent session — it glides between actions and sits still
   * while the model thinks, like a real hand on a real mouse — and fade it
   * out only when the session ends.
   */
  setSessionActive(active: boolean): void {
    this.sessionActive = active;
    if (this.mode === "off") return;
    if (active) {
      this.cursor.show();
    } else {
      this.halo.clear();
      this.cursor.hide();
    }
  }

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
  perform(script: ChoreographyScript): Promise<void> {
    if (this.mode === "off" || script.kind === "none") {
      return Promise.resolve();
    }
    if (this.cursor.isSuspended || document.visibilityState === "hidden") {
      return Promise.resolve();
    }
    const watchdogMs =
      this.mode === "cinematic" ? WATCHDOG_MS.cinematic : WATCHDOG_MS.subtle;
    const run = this.queue.then(() => this.runScript(script)).catch(() => {});
    // The shared queue keeps visuals ordered; the watchdog bounds the wait.
    this.queue = run;
    return Promise.race([
      run,
      new Promise<void>((resolve) => setTimeout(resolve, watchdogMs)),
    ]);
  }

  private async runScript(script: ChoreographyScript): Promise<void> {
    this.cursor.wake();
    this.halo.retargetCheck(script.haloTarget);

    if (script.point) {
      await this.glideTo(script.point, script.targetWidth);
      await this.dwell();
    }

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
          );
        }
        if (script.haloTarget) this.halo.show(script.haloTarget);
        if (script.chipText && script.point) {
          this.effects.chip(script.point, script.chipText);
        }
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
          this.effects.scrollGlyph(this.cursor.position, script.scrollDirection);
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
    await this.glideTo(script.dragTo, Math.max(6, script.targetWidth / 3), ghost);
    ghost?.remove();
    this.cursor.pressUp();
    this.effects.ripple(script.dragTo, "accent");
  }

  private async glideTo(
    to: Point,
    targetWidth: number,
    follower: HTMLElement | null = null,
  ): Promise<void> {
    if (this.reducedMotion()) {
      // Accessibility floor (RFC §7): instant reposition, no glide.
      this.cursor.moveTo(to);
      return;
    }
    const { points } = sampleGlide(
      this.cursor.position,
      to,
      targetWidth,
      this.mode === "cinematic" ? "cinematic" : "subtle",
    );
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
