/**
 * LP-24 presence layer — pure motion math.
 *
 * Everything here is deterministic: paths and durations are pure functions of
 * (from, to, target width, mode). No Math.random(), no Date.now() — replays
 * and A/B video comparisons must be pixel-stable (RFC LP-24 §2.3).
 */

import type { PresenceMode } from "@shared-types/settings";

export interface Point {
  x: number;
  y: number;
}

/** Cinematic pacing multiplier over subtle-mode durations (RFC §4). */
export const CINEMATIC_PACE = 1.8;

/** Dwell after arrival before the press begins, ms (RFC §4). */
export const ARRIVAL_DWELL_MS = { subtle: 60, cinematic: 90 } as const;

/** Glides longer than this get an overshoot-and-settle (cinematic only). */
export const OVERSHOOT_MIN_DISTANCE_PX = 300;

/** Deterministic 32-bit FNV-1a hash over the rounded endpoint coordinates. */
export function pathSeed(from: Point, to: Point): number {
  const str = `${Math.round(from.x)},${Math.round(from.y)}:${Math.round(to.x)},${Math.round(to.y)}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function distance(from: Point, to: Point): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/**
 * Fitts-inspired glide duration (RFC §4):
 * clamp(90, 60 + 70 × log2(distance / targetWidth + 1), 420) ms in subtle,
 * ×1.8 in cinematic.
 */
export function glideDurationMs(
  from: Point,
  to: Point,
  targetWidth: number,
  mode: PresenceMode,
): number {
  const dist = distance(from, to);
  if (dist < 1) return 0;
  const width = Math.max(8, targetWidth);
  const base = 60 + 70 * Math.log2(dist / width + 1);
  const clamped = Math.round(Math.min(420, Math.max(90, base)));
  return mode === "cinematic" ? Math.round(clamped * CINEMATIC_PACE) : clamped;
}

/**
 * Control point for the quadratic Bézier glide arc: perpendicular to the
 * chord at min(0.18 × distance, 60px), side chosen deterministically from
 * the endpoint hash (RFC §4).
 */
export function arcControlPoint(from: Point, to: Point): Point {
  const dist = distance(from, to);
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  if (dist < 1) return mid;
  const bulge = Math.min(0.18 * dist, 60);
  const side = pathSeed(from, to) % 2 === 0 ? 1 : -1;
  // Unit perpendicular to the chord.
  const px = -(to.y - from.y) / dist;
  const py = (to.x - from.x) / dist;
  return { x: mid.x + px * bulge * side, y: mid.y + py * bulge * side };
}

/** Point on the quadratic Bézier at t ∈ [0, 1]. */
export function bezierPoint(
  from: Point,
  control: Point,
  to: Point,
  t: number,
): Point {
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
  };
}

/** Ease-in-out (cosine) — smooth acceleration and deceleration. */
export function easeInOut(t: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));
}

/**
 * Whether this glide gets a 2-3px overshoot-and-settle (cinematic, long
 * moves only — the settle is what reads as "a hand stopped here", RFC §4).
 */
export function hasOvershoot(from: Point, to: Point, mode: PresenceMode): boolean {
  return mode === "cinematic" && distance(from, to) > OVERSHOOT_MIN_DISTANCE_PX;
}

/** Deterministic overshoot landing point ~2-3px past the target on the approach line. */
export function overshootPoint(from: Point, to: Point): Point {
  const dist = distance(from, to);
  if (dist < 1) return to;
  const magnitude = 2 + (pathSeed(from, to) % 2); // 2 or 3 px
  return {
    x: to.x + ((to.x - from.x) / dist) * magnitude,
    y: to.y + ((to.y - from.y) / dist) * magnitude,
  };
}

/**
 * Sample a complete glide into per-frame positions at the given fps.
 * Returns at least the final point; the caller drives them with rAF.
 */
export function sampleGlide(
  from: Point,
  to: Point,
  targetWidth: number,
  mode: PresenceMode,
  fps = 60,
): { points: Point[]; durationMs: number } {
  const durationMs = glideDurationMs(from, to, targetWidth, mode);
  if (durationMs === 0) return { points: [to], durationMs: 0 };
  const control = arcControlPoint(from, to);
  const frames = Math.max(2, Math.round((durationMs / 1000) * fps));
  const overshoot = hasOvershoot(from, to, mode);
  const glideTarget = overshoot ? overshootPoint(from, to) : to;
  const points: Point[] = [];
  for (let i = 1; i <= frames; i++) {
    points.push(bezierPoint(from, control, glideTarget, easeInOut(i / frames)));
  }
  if (overshoot) points.push(to); // settle frame back onto the true target
  return { points, durationMs };
}
