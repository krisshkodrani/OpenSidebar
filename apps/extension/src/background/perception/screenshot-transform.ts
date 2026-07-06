/**
 * Screenshot transform (RFC LP-9): own the resolution, format, and scale
 * factor of every screenshot before it reaches a VLM.
 *
 * Vendors silently downscale oversized images and return coordinates in the
 * image space *they* saw — pre-downscaling client-side with a recorded scale
 * factor keeps that mapping ours (prerequisite for LP-13 region zoom and any
 * future coordinate grounding), and cuts vision token cost on HiDPI captures.
 *
 * Runs in the MV3 service worker: decode via createImageBitmap, re-encode via
 * OffscreenCanvas. Any failure degrades gracefully to the original capture.
 */

export interface ScreenshotProfile {
  /** Target maximum output width in CSS pixels. */
  maxWidth: number;
  /** Hard cap on the longest edge (Claude-class standard-tier limit). */
  maxLongEdge: number;
  format: "image/jpeg" | "image/png";
  /** Encoder quality for lossy formats (0..1). */
  quality: number;
}

/** Default per RFC LP-9: 1280-wide JPEG q85, capped at 1568 long edge. */
export const DEFAULT_SCREENSHOT_PROFILE: ScreenshotProfile = {
  maxWidth: 1280,
  maxLongEdge: 1568,
  format: "image/jpeg",
  quality: 0.85,
};

export interface ScreenshotTransformResult {
  dataUrl: string;
  /** capturedWidth / outputWidth — 1 when the capture was left untouched. */
  scaleFactor: number;
  width: number;
  height: number;
  /** Raw capture dimensions before any resize (0 when decode was skipped). */
  capturedWidth: number;
  capturedHeight: number;
}

/**
 * Pure geometry: the output dimensions for a capture under a profile.
 * Never upscales.
 */
export function computeTargetDimensions(
  width: number,
  height: number,
  profile: ScreenshotProfile = DEFAULT_SCREENSHOT_PROFILE,
): { width: number; height: number; scaleFactor: number } {
  const longEdge = Math.max(width, height);
  const scale = Math.min(
    1,
    profile.maxWidth / width,
    profile.maxLongEdge / longEdge,
  );
  if (scale >= 1) {
    return { width, height, scaleFactor: 1 };
  }
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  return { width: outWidth, height: outHeight, scaleFactor: width / outWidth };
}

// --- Region crop (RFC LP-13) ---------------------------------------------

/** Long-edge cap for a zoomed crop (RFC LP-13: "at most 1024 px"). */
export const REGION_CROP_MAX_LONG_EDGE = 1024;
/** Upscale cap so a tiny sliver doesn't become 1024 px of blur. */
export const REGION_CROP_MAX_UPSCALE = 4;
/** Crops smaller than this in image pixels carry no readable signal. */
const REGION_CROP_MIN_SIZE_PX = 8;

export interface RegionCropGeometry {
  /** Source rect in image pixels (the space of the stored screenshot). */
  sourceRect: { x: number; y: number; width: number; height: number };
  outputWidth: number;
  outputHeight: number;
  /** Output pixels per source pixel (>= 1 means magnification). */
  upscale: number;
}

export type RegionCropGeometryResult =
  | { ok: true; geometry: RegionCropGeometry }
  | { ok: false; error: string };

/**
 * Pure geometry: map a viewport-CSS-pixel rect (the `@box` coordinate space)
 * onto the stored screenshot image and size the magnified output.
 *
 * The single css→image ratio is `imageWidth / viewportWidth`, which equals
 * devicePixelRatio ÷ LP-9 scaleFactor by construction — correct for HiDPI,
 * browser zoom, downscaled, and degraded-passthrough screenshots alike.
 * Only the crop is ever scaled; the full screenshot is never upscaled.
 */
export function computeRegionCropGeometry(args: {
  cssRect: { x: number; y: number; width: number; height: number };
  padding?: number;
  viewportWidth: number;
  viewportHeight: number;
  imageWidth: number;
  imageHeight: number;
  maxLongEdge?: number;
  maxUpscale?: number;
}): RegionCropGeometryResult {
  const padding = args.padding ?? 0;
  const maxLongEdge = args.maxLongEdge ?? REGION_CROP_MAX_LONG_EDGE;
  const maxUpscale = args.maxUpscale ?? REGION_CROP_MAX_UPSCALE;
  if (
    args.viewportWidth <= 0 ||
    args.viewportHeight <= 0 ||
    args.imageWidth <= 0 ||
    args.imageHeight <= 0
  ) {
    return { ok: false, error: "missing viewport or image dimensions" };
  }

  // Pad, then clamp to the viewport in CSS space.
  const cssX = Math.max(0, args.cssRect.x - padding);
  const cssY = Math.max(0, args.cssRect.y - padding);
  const cssRight = Math.min(
    args.viewportWidth,
    args.cssRect.x + args.cssRect.width + padding,
  );
  const cssBottom = Math.min(
    args.viewportHeight,
    args.cssRect.y + args.cssRect.height + padding,
  );
  if (cssRight <= cssX || cssBottom <= cssY) {
    return { ok: false, error: "region is outside the visible viewport" };
  }

  const cssToImage = args.imageWidth / args.viewportWidth;
  const x = Math.max(0, Math.floor(cssX * cssToImage));
  const y = Math.max(0, Math.floor(cssY * cssToImage));
  const right = Math.min(args.imageWidth, Math.ceil(cssRight * cssToImage));
  const bottom = Math.min(args.imageHeight, Math.ceil(cssBottom * cssToImage));
  const width = right - x;
  const height = bottom - y;
  if (width < REGION_CROP_MIN_SIZE_PX || height < REGION_CROP_MIN_SIZE_PX) {
    return {
      ok: false,
      error: `region is too small to magnify (${width}x${height} image px)`,
    };
  }

  const longEdge = Math.max(width, height);
  const upscale = Math.min(maxUpscale, Math.max(1, maxLongEdge / longEdge));
  return {
    ok: true,
    geometry: {
      sourceRect: { x, y, width, height },
      outputWidth: Math.max(1, Math.round(width * upscale)),
      outputHeight: Math.max(1, Math.round(height * upscale)),
      upscale,
    },
  };
}

/**
 * Crop (and magnify) a region out of a screenshot dataUrl. PNG output for
 * text legibility — crops are small, so size is acceptable. Never throws.
 */
export async function cropScreenshotRegion(
  dataUrl: string,
  geometry: RegionCropGeometry,
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  try {
    if (
      typeof createImageBitmap !== "function" ||
      typeof OffscreenCanvas === "undefined"
    ) {
      return { ok: false, error: "image processing unavailable" };
    }
    const source = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(source);
    try {
      const canvas = new OffscreenCanvas(
        geometry.outputWidth,
        geometry.outputHeight,
      );
      const ctx = canvas.getContext("2d");
      if (!ctx) return { ok: false, error: "canvas context unavailable" };
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(
        bitmap,
        geometry.sourceRect.x,
        geometry.sourceRect.y,
        geometry.sourceRect.width,
        geometry.sourceRect.height,
        0,
        0,
        geometry.outputWidth,
        geometry.outputHeight,
      );
      const blob = await canvas.convertToBlob({ type: "image/png" });
      return { ok: true, dataUrl: await blobToDataUrl(blob) };
    } finally {
      bitmap.close();
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "crop failed",
    };
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Downscale/re-encode a captured screenshot per the profile. Returns the
 * original capture with scaleFactor 1 when no resize is needed or when the
 * environment lacks the required APIs (graceful degradation).
 */
export async function transformScreenshot(
  dataUrl: string,
  profile: ScreenshotProfile = DEFAULT_SCREENSHOT_PROFILE,
): Promise<ScreenshotTransformResult> {
  try {
    if (
      typeof createImageBitmap !== "function" ||
      typeof OffscreenCanvas === "undefined"
    ) {
      return {
        dataUrl,
        scaleFactor: 1,
        width: 0,
        height: 0,
        capturedWidth: 0,
        capturedHeight: 0,
      };
    }
    const source = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(source);
    try {
      const target = computeTargetDimensions(
        bitmap.width,
        bitmap.height,
        profile,
      );
      if (target.scaleFactor === 1) {
        return {
          dataUrl,
          scaleFactor: 1,
          width: bitmap.width,
          height: bitmap.height,
          capturedWidth: bitmap.width,
          capturedHeight: bitmap.height,
        };
      }
      const canvas = new OffscreenCanvas(target.width, target.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return {
          dataUrl,
          scaleFactor: 1,
          width: bitmap.width,
          height: bitmap.height,
          capturedWidth: bitmap.width,
          capturedHeight: bitmap.height,
        };
      }
      ctx.drawImage(bitmap, 0, 0, target.width, target.height);
      const blob = await canvas.convertToBlob({
        type: profile.format,
        quality: profile.quality,
      });
      return {
        dataUrl: await blobToDataUrl(blob),
        scaleFactor: target.scaleFactor,
        width: target.width,
        height: target.height,
        capturedWidth: bitmap.width,
        capturedHeight: bitmap.height,
      };
    } finally {
      bitmap.close();
    }
  } catch {
    // Never fail a perception turn over image processing — ship the original.
    return {
      dataUrl,
      scaleFactor: 1,
      width: 0,
      height: 0,
      capturedWidth: 0,
      capturedHeight: 0,
    };
  }
}
