/**
 * inspect_region executor (RFC LP-13): crop a screen region out of the
 * current screenshot and return a magnified view — the pixel-path complement
 * to inspect_chart's DOM/SVG/a11y reading.
 *
 * Lives outside the loop behind a narrow host interface: the loop supplies
 * chrome plumbing (capture, tag-rect resolution, budget, trace, delivery)
 * and this module owns validation, the per-turn cap, and orchestration.
 *
 * Delivery is mode-dependent: on unified_vl turns the crop rides a fresh
 * user image message into the executor's next prompt (tool results are
 * strings only and role:"tool" cannot carry image parts); on structured
 * turns it is described by the perception model and the text is the result.
 */

import type {
  DomSnapshot,
  InspectRegionArgs,
  TraceEventPayloadByType,
} from "../../types";
import {
  computeRegionCropGeometry,
  cropScreenshotRegion,
  transformScreenshot,
} from "../perception/screenshot-transform";
import {
  getCachedScreenshotEntry,
  setCachedScreenshot,
} from "./screenshot-cache";

/** RFC LP-13: at most 2 zooms per turn (mirrors the popup-triage ≤3 cap). */
export const REGION_ZOOM_TURN_CAP = 2;
/** Padding around a tag's bounding box when the id sugar is used. */
export const REGION_ZOOM_ID_PADDING_PX = 20;

type InspectRegionTraceData = TraceEventPayloadByType["inspect_region"];

export interface RegionZoomState {
  turn: number;
  count: number;
}

export function emptyRegionZoomState(): RegionZoomState {
  return { turn: -1, count: 0 };
}

export interface RegionZoomHost {
  /** Current agent turn (scopes the zoom cap). */
  turnCount: number;
  /** Whether this turn runs in unified VL mode (image delivery path). */
  useVLExecutor: boolean;
  getSnapshot(): DomSnapshot | null | undefined;
  imagePromptBudgetAllows(imageCount: number): boolean;
  recordImagePromptBudgetExhausted(imageCount: number, source: string): void;
  /** Capture the visible tab (host resolves the window). Throws on failure. */
  captureVisibleTab(options: {
    format: "jpeg" | "png";
    quality?: number;
  }): Promise<string>;
  /** Live viewport rect for a tag id (content-script measure), null if gone. */
  resolveTagRect(
    id: number,
  ): Promise<{ x: number; y: number; width: number; height: number } | null>;
  recordInspectRegionEvent(data: InspectRegionTraceData): void;
  /** VL turns: stage the crop as the executor's next-view attachment. */
  setRegionZoomForExecutor(zoom: { dataUrl: string; label: string }): void;
  /** Structured turns: describe the crop via the perception model. */
  describeRegion(args: {
    dataUrl: string;
    label: string;
    purpose?: string;
  }): Promise<string>;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasFullRect(args: InspectRegionArgs): boolean {
  return (
    isFiniteNumber(args.x) &&
    isFiniteNumber(args.y) &&
    isFiniteNumber(args.width) &&
    isFiniteNumber(args.height) &&
    (args.width as number) > 0 &&
    (args.height as number) > 0
  );
}

function formatRegionLabel(
  rect: { x: number; y: number; width: number; height: number },
  requestedId?: number,
): string {
  const base = `(${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(
    rect.width,
  )}x${Math.round(rect.height)})`;
  return requestedId === undefined ? base : `${base} around [${requestedId}]`;
}

async function measureImage(
  dataUrl: string,
): Promise<{ width: number; height: number } | null> {
  try {
    if (typeof createImageBitmap !== "function") return null;
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dims;
  } catch {
    return null;
  }
}

export async function executeInspectRegion(
  host: RegionZoomHost,
  state: RegionZoomState,
  args: InspectRegionArgs,
  tabId: number,
): Promise<string> {
  const mode = host.useVLExecutor ? "unified_vl" : "structured";
  const refuse = (
    refusedReason: NonNullable<InspectRegionTraceData["refusedReason"]>,
    message: string,
    extra?: Partial<InspectRegionTraceData>,
  ): string => {
    host.recordInspectRegionEvent({
      turn: host.turnCount,
      mode,
      refusedReason,
      ...(args.purpose ? { purpose: args.purpose } : {}),
      ...(Number.isInteger(args.id) ? { requestedId: args.id } : {}),
      ...extra,
    });
    return message;
  };

  // Per-turn cap.
  if (state.turn !== host.turnCount) {
    state.turn = host.turnCount;
    state.count = 0;
  }
  if (state.count >= REGION_ZOOM_TURN_CAP) {
    return refuse(
      "turn_cap",
      `inspect_region limit reached for this turn (${REGION_ZOOM_TURN_CAP}). Act on what you can already see, or scroll/navigate to bring the target closer.`,
    );
  }

  // Args: id sugar XOR full rect.
  const useIdSugar = Number.isInteger(args.id);
  if (!useIdSugar && !hasFullRect(args)) {
    return refuse(
      "bad_args",
      "inspect_region needs either id (a tag number) or a full rect x,y,width,height in viewport pixels (the @box coordinate space).",
    );
  }

  // Budget: a zoom is an extra image this turn, charged at high detail.
  if (!host.imagePromptBudgetAllows(1)) {
    host.recordImagePromptBudgetExhausted(1, "inspect_region");
    return refuse(
      "budget",
      "Image budget for this session is exhausted — inspect_region cannot attach another image. Use inspect_chart, read_element, or execute_js to read the value from the DOM instead.",
    );
  }

  // Resolve the region in viewport CSS pixels.
  let cssRect: { x: number; y: number; width: number; height: number };
  if (useIdSugar) {
    const live = await host.resolveTagRect(args.id as number);
    if (!live || live.width <= 0 || live.height <= 0) {
      return refuse(
        "bad_args",
        `inspect_region: element [${args.id}] was not found or has no visible box. Use a fresh tag id from the element list, or pass an explicit rect.`,
      );
    }
    cssRect = live;
  } else {
    cssRect = {
      x: args.x as number,
      y: args.y as number,
      width: args.width as number,
      height: args.height as number,
    };
  }

  const viewport = host.getSnapshot()?.viewport;
  if (!viewport || viewport.width <= 0 || viewport.height <= 0) {
    return refuse(
      "bad_args",
      "inspect_region: no page snapshot with viewport dimensions is available yet.",
    );
  }

  // Screenshot: reuse the 3s-fresh cached capture, else capture now.
  let screenshot = getCachedScreenshotEntry(tabId);
  if (!screenshot) {
    try {
      const captured = await host.captureVisibleTab({
        format: "jpeg",
        quality: 70,
      });
      const transformed = await transformScreenshot(captured);
      setCachedScreenshot(tabId, transformed.dataUrl, {
        scaleFactor: transformed.scaleFactor,
        width: transformed.width,
        height: transformed.height,
      });
      screenshot = getCachedScreenshotEntry(tabId);
    } catch {
      screenshot = undefined;
    }
  }
  if (!screenshot) {
    return refuse(
      "capture_failed",
      "inspect_region: screenshot capture failed. Retry after the page settles, or read the value through DOM tools.",
    );
  }

  // Image dimensions: transform metadata when known, else decode once.
  const imageDims =
    screenshot.width && screenshot.height
      ? { width: screenshot.width, height: screenshot.height }
      : await measureImage(screenshot.dataUrl);
  if (!imageDims) {
    return refuse(
      "crop_failed",
      "inspect_region: image processing is unavailable in this environment.",
    );
  }

  const geometry = computeRegionCropGeometry({
    cssRect,
    padding: useIdSugar ? REGION_ZOOM_ID_PADDING_PX : 0,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    imageWidth: imageDims.width,
    imageHeight: imageDims.height,
  });
  if (!geometry.ok) {
    return refuse("bad_args", `inspect_region: ${geometry.error}.`, {
      rect: cssRect,
    });
  }

  const crop = await cropScreenshotRegion(screenshot.dataUrl, geometry.geometry);
  if (!crop.ok) {
    return refuse("crop_failed", `inspect_region: ${crop.error}.`, {
      rect: cssRect,
    });
  }

  state.count += 1;
  const label = formatRegionLabel(
    cssRect,
    useIdSugar ? (args.id as number) : undefined,
  );
  const upscale = Math.round(geometry.geometry.upscale * 10) / 10;
  host.recordInspectRegionEvent({
    turn: host.turnCount,
    mode,
    rect: cssRect,
    ...(useIdSugar ? { requestedId: args.id as number } : {}),
    ...(args.purpose ? { purpose: args.purpose } : {}),
    outputWidth: geometry.geometry.outputWidth,
    outputHeight: geometry.geometry.outputHeight,
    upscale: geometry.geometry.upscale,
  });

  if (host.useVLExecutor) {
    host.setRegionZoomForExecutor({ dataUrl: crop.dataUrl, label });
    return `Zoomed into ${label} at ${upscale}x magnification — the magnified image is attached to your next view. Read the fine text from it; do not derive click coordinates from the magnified image.`;
  }

  const description = await host.describeRegion({
    dataUrl: crop.dataUrl,
    label,
    purpose: args.purpose,
  });
  return `Zoomed region ${label} at ${upscale}x magnification:\n${description}`;
}
