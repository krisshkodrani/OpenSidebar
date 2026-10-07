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
export const CINEMATIC_PACE = 1;

/** Minimum visible travel time, shared by both presentation modes. */
export const CINEMATIC_MIN_GLIDE_MS = 90;

/** Dwell after arrival before the press begins, ms (RFC §4). */
export const ARRIVAL_DWELL_MS = { subtle: 30, cinematic: 40 } as const;

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
 * Smaller targets allow more time for the final approach; both modes remain
 * bounded to 90–320ms so presentation does not hold up the real action.
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
  const base = 65 + 55 * Math.log2(dist / width + 1);
  const clamped = Math.round(Math.min(320, Math.max(90, base)));
  return mode === "cinematic"
    ? Math.max(CINEMATIC_MIN_GLIDE_MS, Math.round(clamped * CINEMATIC_PACE))
    : clamped;
}

/**
 * Control point for the quadratic Bézier glide arc: perpendicular to the
 * chord, with a gently varied apex and curvature from the endpoint hash.
 * Short hops stay nearly straight; long paths bend by at most 25px.
 */
export function arcControlPoint(from: Point, to: Point): Point {
  const dist = distance(from, to);
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  if (dist < 1) return mid;
  const seed = pathSeed(from, to);
  const bulge = Math.min((0.035 + ((seed >>> 1) % 66) / 1000) * dist, 25);
  const side = seed % 2 === 0 ? 1 : -1;
  const apex = 0.4 + ((seed >>> 8) % 201) / 1000;
  // Unit perpendicular to the chord.
  const px = -(to.y - from.y) / dist;
  const py = (to.x - from.x) / dist;
  return {
    x: from.x + (to.x - from.x) * apex + px * bulge * side,
    y: from.y + (to.y - from.y) * apex + py * bulge * side,
  };
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

/** Smooth launch and stop, with a slightly earlier speed peak and longer braking. */
export function ballisticEase(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  const u = clamped + 0.12 * Math.sin(Math.PI * clamped);
  // Quintic smoothstep gives zero velocity and acceleration at both ends.
  return u * u * u * (10 + u * (-15 + 6 * u));
}

/**
 * Whether this glide gets a 2-3px overshoot-and-settle (cinematic, long
 * moves only — the settle is what reads as "a hand stopped here", RFC §4).
 */
export function hasOvershoot(
  from: Point,
  to: Point,
  mode: PresenceMode,
): boolean {
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
  for (let i = 0; i <= frames; i++) {
    const t = i / frames;
    // Give the tiny correction a real settling interval, rather than snapping
    // back in one frame. The click still lands at the exact requested point.
    if (overshoot && t > 0.8) {
      const settle = ballisticEase((t - 0.8) / 0.2);
      points.push({
        x: glideTarget.x + (to.x - glideTarget.x) * settle,
        y: glideTarget.y + (to.y - glideTarget.y) * settle,
      });
    } else {
      points.push(
        bezierPoint(
          from,
          control,
          glideTarget,
          ballisticEase(t / (overshoot ? 0.8 : 1)),
        ),
      );
    }
  }
  points[0] = from;
  points[points.length - 1] = to;
  return { points, durationMs };
}
