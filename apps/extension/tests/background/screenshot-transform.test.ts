import { describe, expect, test } from "vitest";
import {
  DEFAULT_SCREENSHOT_PROFILE,
  REGION_CROP_MAX_LONG_EDGE,
  REGION_CROP_MAX_UPSCALE,
  computeRegionCropGeometry,
  computeTargetDimensions,
  cropScreenshotRegion,
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
    expect(r.capturedWidth).toBe(0);
    expect(r.capturedHeight).toBe(0);
  });
});

describe("computeRegionCropGeometry (LP-13)", () => {
  test("HiDPI untouched capture: dpr=2 maps CSS rect to double image pixels", () => {
    // viewport 640 CSS px wide, image 1280 (dpr 2, no LP-9 downscale)
    const r = computeRegionCropGeometry({
      cssRect: { x: 100, y: 50, width: 80, height: 40 },
      viewportWidth: 640,
      viewportHeight: 400,
      imageWidth: 1280,
      imageHeight: 800,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.geometry.sourceRect).toEqual({
      x: 200,
      y: 100,
      width: 160,
      height: 80,
    });
  });

  test("LP-9 downscaled capture: 1600 CSS viewport stored as 1280 image", () => {
    const r = computeRegionCropGeometry({
      cssRect: { x: 400, y: 200, width: 200, height: 100 },
      viewportWidth: 1600,
      viewportHeight: 1000,
      imageWidth: 1280,
      imageHeight: 800,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // cssToImage = 0.8
    expect(r.geometry.sourceRect.x).toBe(320);
    expect(r.geometry.sourceRect.y).toBe(160);
    expect(r.geometry.sourceRect.width).toBe(160);
    expect(r.geometry.sourceRect.height).toBe(80);
  });

  test("dpr=2 combined with LP-9 downscale behaves like the single ratio", () => {
    // 1600 CSS viewport, captured at 3200 device px, downscaled to 1280:
    // cssToImage = 1280/1600 = 0.8 regardless of the intermediate dpr.
    const r = computeRegionCropGeometry({
      cssRect: { x: 0, y: 0, width: 100, height: 100 },
      viewportWidth: 1600,
      viewportHeight: 900,
      imageWidth: 1280,
      imageHeight: 720,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.geometry.sourceRect.width).toBe(80);
  });

  test("pads the rect and clamps to viewport and image bounds", () => {
    const r = computeRegionCropGeometry({
      cssRect: { x: 5, y: 5, width: 50, height: 50 },
      padding: 20,
      viewportWidth: 640,
      viewportHeight: 400,
      imageWidth: 640,
      imageHeight: 400,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // x/y clamp at 0; right/bottom extend by padding.
    expect(r.geometry.sourceRect.x).toBe(0);
    expect(r.geometry.sourceRect.y).toBe(0);
    expect(r.geometry.sourceRect.width).toBe(75);
    expect(r.geometry.sourceRect.height).toBe(75);
  });

  test("caps upscale at 4x for tiny targets", () => {
    const r = computeRegionCropGeometry({
      cssRect: { x: 100, y: 100, width: 40, height: 20 },
      viewportWidth: 1280,
      viewportHeight: 800,
      imageWidth: 1280,
      imageHeight: 800,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.geometry.upscale).toBe(REGION_CROP_MAX_UPSCALE);
    expect(r.geometry.outputWidth).toBe(160);
    expect(r.geometry.outputHeight).toBe(80);
  });

  test("caps the output long edge at 1024 for large regions", () => {
    const r = computeRegionCropGeometry({
      cssRect: { x: 0, y: 0, width: 600, height: 300 },
      viewportWidth: 1280,
      viewportHeight: 800,
      imageWidth: 1280,
      imageHeight: 800,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(
      Math.max(r.geometry.outputWidth, r.geometry.outputHeight),
    ).toBeLessThanOrEqual(REGION_CROP_MAX_LONG_EDGE);
    expect(r.geometry.upscale).toBeGreaterThan(1);
  });

  test("never downscales a region below its native size", () => {
    // A region whose long edge already exceeds 1024 stays at 1:1.
    const r = computeRegionCropGeometry({
      cssRect: { x: 0, y: 0, width: 1200, height: 700 },
      viewportWidth: 1280,
      viewportHeight: 800,
      imageWidth: 1280,
      imageHeight: 800,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.geometry.upscale).toBe(1);
    expect(r.geometry.outputWidth).toBe(1200);
  });

  test("rejects sub-8px regions", () => {
    const r = computeRegionCropGeometry({
      cssRect: { x: 10, y: 10, width: 3, height: 3 },
      viewportWidth: 1280,
      viewportHeight: 800,
      imageWidth: 1280,
      imageHeight: 800,
    });
    expect(r.ok).toBe(false);
  });

  test("rejects regions fully outside the viewport", () => {
    const r = computeRegionCropGeometry({
      cssRect: { x: 2000, y: 100, width: 50, height: 50 },
      viewportWidth: 1280,
      viewportHeight: 800,
      imageWidth: 1280,
      imageHeight: 800,
    });
    expect(r.ok).toBe(false);
  });

  test("rejects when dimensions are missing", () => {
    const r = computeRegionCropGeometry({
      cssRect: { x: 0, y: 0, width: 100, height: 100 },
      viewportWidth: 0,
      viewportHeight: 800,
      imageWidth: 1280,
      imageHeight: 800,
    });
    expect(r.ok).toBe(false);
  });
});

describe("cropScreenshotRegion graceful degradation", () => {
  test("returns an error result when canvas APIs are unavailable", async () => {
    const r = await cropScreenshotRegion("data:image/jpeg;base64,AAAA", {
      sourceRect: { x: 0, y: 0, width: 100, height: 100 },
      outputWidth: 400,
      outputHeight: 400,
      upscale: 4,
    });
    expect(r.ok).toBe(false);
  });
});
