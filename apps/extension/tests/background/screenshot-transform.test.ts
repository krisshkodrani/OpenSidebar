import { describe, expect, test } from "vitest";
import {
  DEFAULT_SCREENSHOT_PROFILE,
  computeTargetDimensions,
  transformScreenshot,
} from "../../src/background/perception/screenshot-transform";

describe("computeTargetDimensions (LP-9)", () => {
  test("leaves small captures untouched", () => {
    const r = computeTargetDimensions(1024, 768);
    expect(r).toEqual({ width: 1024, height: 768, scaleFactor: 1 });
  });

  test("never upscales at exactly the target width", () => {
    const r = computeTargetDimensions(1280, 800);
    expect(r.scaleFactor).toBe(1);
  });

  test("downscales HiDPI captures to the profile width", () => {
    const r = computeTargetDimensions(2560, 1440);
    expect(r.width).toBe(1280);
    expect(r.height).toBe(720);
    expect(r.scaleFactor).toBe(2);
  });

  test("caps the long edge for tall portrait captures", () => {
    // 1200 wide passes the width cap, but 4000 tall exceeds the 1568 long edge.
    const r = computeTargetDimensions(1200, 4000);
    expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(
      DEFAULT_SCREENSHOT_PROFILE.maxLongEdge,
    );
    expect(r.scaleFactor).toBeCloseTo(1200 / r.width, 5);
  });

  test("preserves aspect ratio", () => {
    const r = computeTargetDimensions(3840, 2160);
    expect(r.width / r.height).toBeCloseTo(3840 / 2160, 2);
  });
});

describe("transformScreenshot graceful degradation", () => {
  test("returns the original capture when canvas APIs are unavailable", async () => {
    // happy-dom has no OffscreenCanvas/createImageBitmap — the transform must
    // never fail a perception turn over image processing.
    const original = "data:image/jpeg;base64,AAAA";
    const r = await transformScreenshot(original);
    expect(r.dataUrl).toBe(original);
    expect(r.scaleFactor).toBe(1);
  });
});
