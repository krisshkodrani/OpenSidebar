import { describe, expect, test } from "vitest";
import {
  arcControlPoint,
  bezierPoint,
  distance,
  easeInOut,
  glideDurationMs,
  hasOvershoot,
  overshootPoint,
  pathSeed,
  sampleGlide,
} from "../../src/content/presence/motion";

const A = { x: 100, y: 100 };
const B = { x: 700, y: 400 };

describe("presence motion math", () => {
  test("is fully deterministic — same inputs, same outputs", () => {
    expect(pathSeed(A, B)).toBe(pathSeed({ ...A }, { ...B }));
    expect(arcControlPoint(A, B)).toEqual(arcControlPoint(A, B));
    const s1 = sampleGlide(A, B, 40, "subtle");
    const s2 = sampleGlide(A, B, 40, "subtle");
    expect(s1).toEqual(s2);
  });

  test("duration follows Fitts scaling and clamps to [90, 420] in subtle", () => {
    const short = glideDurationMs(A, { x: 110, y: 100 }, 40, "subtle");
    const long = glideDurationMs(A, { x: 3000, y: 2000 }, 8, "subtle");
    expect(short).toBe(90); // clamp floor
    expect(long).toBe(420); // clamp ceiling
    const mid = glideDurationMs(A, B, 40, "subtle");
    expect(mid).toBeGreaterThan(short);
    expect(mid).toBeLessThanOrEqual(420);
  });

  test("cinematic pacing is ×1.8 over subtle", () => {
    const subtle = glideDurationMs(A, B, 40, "subtle");
    const cinematic = glideDurationMs(A, B, 40, "cinematic");
    expect(cinematic).toBe(Math.round(subtle * 1.8));
  });

  test("zero-distance glides cost nothing", () => {
    expect(glideDurationMs(A, A, 40, "subtle")).toBe(0);
    expect(sampleGlide(A, A, 40, "subtle").points).toEqual([A]);
  });

  test("arc control point bulges perpendicular, capped at 60px", () => {
    const control = arcControlPoint(A, B);
    const mid = { x: 400, y: 250 };
    const bulge = distance(control, mid);
    expect(bulge).toBeGreaterThan(1);
    expect(bulge).toBeLessThanOrEqual(60.001);
  });

  test("bezier hits both endpoints and easing is monotone-bounded", () => {
    const control = arcControlPoint(A, B);
    expect(bezierPoint(A, control, B, 0)).toEqual(A);
    expect(bezierPoint(A, control, B, 1)).toEqual(B);
    expect(easeInOut(0)).toBeCloseTo(0);
    expect(easeInOut(1)).toBeCloseTo(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
  });

  test("overshoot only on long cinematic glides, settling on the true target", () => {
    expect(hasOvershoot(A, B, "subtle")).toBe(false);
    expect(hasOvershoot(A, { x: 150, y: 120 }, "cinematic")).toBe(false);
    expect(hasOvershoot(A, B, "cinematic")).toBe(true);
    const past = overshootPoint(A, B);
    expect(distance(past, B)).toBeGreaterThanOrEqual(2);
    expect(distance(past, B)).toBeLessThanOrEqual(3);
    const glide = sampleGlide(A, B, 40, "cinematic");
    expect(glide.points[glide.points.length - 1]).toEqual(B);
  });

  test("glide always ends exactly on the target in subtle mode", () => {
    const { points } = sampleGlide(A, B, 40, "subtle");
    const last = points[points.length - 1];
    expect(last.x).toBeCloseTo(B.x, 6);
    expect(last.y).toBeCloseTo(B.y, 6);
  });
});
