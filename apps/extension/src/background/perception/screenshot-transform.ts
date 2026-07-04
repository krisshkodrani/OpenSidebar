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
      return { dataUrl, scaleFactor: 1, width: 0, height: 0 };
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
      };
    } finally {
      bitmap.close();
    }
  } catch {
    // Never fail a perception turn over image processing — ship the original.
    return { dataUrl, scaleFactor: 1, width: 0, height: 0 };
  }
}
