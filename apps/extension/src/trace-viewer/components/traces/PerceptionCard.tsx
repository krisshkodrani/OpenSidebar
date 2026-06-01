import React, { useState } from "react";
import type {
  TraceEntry,
  TracePageStateCapture,
  TracePanoramicShot,
} from "../../../types/traces";
import Badge from "../Badge";
import { screenshotUrl } from "../../api";
import { truncate } from "../../utils";
import { useStore } from "../../store";
import CollapsibleSection from "../CollapsibleSection";
import PanoramicThumbnails from "./PanoramicThumbnails";

interface PerceptionCardProps {
  entry: TraceEntry;
  sessionId: string;
}

function selectPageStateCapture(entry: TraceEntry): TracePageStateCapture | null {
  const pageState = entry.pageState;
  if (!pageState) return null;
  if (entry.perception?.pageStateRef === "postTool" && pageState.postTool) {
    return pageState.postTool;
  }
  if (entry.perception?.pageStateRef === "preDecision") {
    return pageState.preDecision;
  }
  return pageState.postTool ?? pageState.preDecision;
}

function panoramicFromCapture(
  capture: TracePageStateCapture | null,
): TracePanoramicShot[] {
  return (capture?.screenshots ?? [])
    .filter((shot) => shot.kind === "panorama" && shot.dataUrl)
    .map((shot) => ({
      screenshotId: shot.screenshotId,
      sessionId: shot.sessionId,
      turnNumber: shot.turnNumber,
      dataUrl: shot.dataUrl!,
      scrollY: shot.scrollY ?? 0,
      label: shot.label ?? "panorama",
    }));
}

function hasLegacyBackfilledPerceptionMeta(
  p: NonNullable<TraceEntry["perception"]>,
): boolean {
  return (
    p.model === "google/gemini-2.5-flash" &&
    p.durationMs === 0 &&
    !p.providerId &&
    p.cached === false &&
    p.source === "fresh" &&
    p.freshnessReason === "new_fingerprint"
  );
}

export default function PerceptionCard({
  entry,
  sessionId,
}: PerceptionCardProps) {
  const [imgError, setImgError] = useState(false);
  const navigateToTurn = useStore((s) => s.navigateToTurn);
  const p = entry.perception!;
  const turnNum = entry.turnNumber ?? 0;
  const elements = entry.elements || [];
  const capture = selectPageStateCapture(entry);
  const pageStateScreenshot = capture?.screenshots?.find(
    (shot) => shot.kind === "viewport" && shot.dataUrl,
  );
  const panoramicShots = panoramicFromCapture(capture);
  const legacyPanoramicShots = p.panoramicShots ?? [];
  const legacyBackfilledMeta = hasLegacyBackfilledPerceptionMeta(p);

  const screenshotSrc = pageStateScreenshot?.dataUrl
    ? pageStateScreenshot.dataUrl
    : p.screenshotDataUrl
    ? p.screenshotDataUrl
    : screenshotUrl(sessionId, turnNum);

  // Prefer the stored element summary (exactly what the model saw),
  // fall back to reconstructing from raw elements for older traces
  const elementText = capture?.domDistillation
    ? capture.domDistillation
    : p.elementSummary
      ? p.elementSummary
    : elements
        .map((el) => {
          let line = `[${el.tag}] ${el.tagName || ""}`;
          if (el.attributes?.id) line += `#${el.attributes.id}`;
          if (el.attributes?.type) line += ` type=${el.attributes.type}`;
          if (el.text) line += ` "${truncate(el.text, 80)}"`;
          return line;
        })
        .join("\n");

  return (
    <div className="bg-trace-panel border border-trace-accent/[0.15] rounded-lg mb-4 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-trace-accent/[0.08] border-b border-trace-accent/[0.12] flex-wrap">
        <button
          type="button"
          className="text-[13px] font-bold text-trace-accent-light hover:underline cursor-pointer"
          onClick={() => navigateToTurn(turnNum)}
          title="Jump to this turn"
        >
          Turn {turnNum} &rarr;
        </button>
        <Badge variant="model">{p.model || "unknown"}</Badge>
        <Badge variant="type">observation</Badge>
        {p.mode && <Badge variant="type">{p.mode}</Badge>}
        {p.source && <Badge variant="category">{p.source}</Badge>}
        {p.cached && <Badge variant="stopped">cached</Badge>}
        {(capture?.domDistillation || p.elementSummary) && (
          <Badge variant="type">DOM distillation</Badge>
        )}
        {p.fallbackReason && <Badge variant="error">{p.fallbackReason}</Badge>}
        {/* Freshness badge — promoted from footer */}
        {p.freshnessReason && (
          <Badge
            variant={
              p.freshnessReason === "new_fingerprint"
                ? "completed"
                : p.freshnessReason === "dom_fallback"
                  ? "error"
                  : "max_turns"
            }
          >
            {p.freshnessReason}
          </Badge>
        )}
        {/* Screenshot status badge — promoted from footer */}
        {p.screenshotStatus && p.screenshotStatus !== "captured" && (
          <Badge
            variant={
              p.screenshotStatus === "capture_failed" || p.screenshotStatus === "missing"
                ? "error"
                : p.screenshotStatus === "pruned" ||
                    p.screenshotStatus === "load_failed"
                  ? "stopped"
                : p.screenshotStatus === "cached"
                  ? "stopped"
                  : "type"
            }
          >
            screenshot: {p.screenshotStatus}
          </Badge>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-col xl:flex-row min-h-[200px]">
        {/* Left: screenshot */}
        <div className="flex-1 border-b xl:border-b-0 xl:border-r border-trace-accent/[0.12] p-3 flex flex-col gap-2.5 min-w-0">
          {!imgError ? (
            <img
              className="max-w-full rounded border border-trace-accent/[0.15] cursor-pointer transition-opacity hover:opacity-85"
              src={screenshotSrc}
              alt={`Turn ${turnNum} screenshot`}
              loading="lazy"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="bg-trace-accent/[0.08] border border-dashed border-trace-accent/[0.15] rounded p-8 text-center text-trace-dim text-xs">
              {p.screenshotStatus === "pruned"
                ? "Screenshot pruned (hot window elapsed)"
                : "Screenshot failed to load"}
            </div>
          )}
          {panoramicShots.length > 0 ? (
            <PanoramicThumbnails shots={panoramicShots} />
          ) : legacyPanoramicShots.length > 0 ? (
            <PanoramicThumbnails shots={legacyPanoramicShots} />
          ) : null}
        </div>

        {/* Right: interpretation + metadata (or DOM distillation in VL mode) */}
        <div className="flex-1 p-3 min-w-0 flex flex-col gap-2.5">
          {p.mode === "vl_screenshot_only" ? (
            <div className="text-[11px] text-trace-muted font-mono max-h-[400px] overflow-y-auto leading-normal whitespace-pre-wrap break-all">
              {elementText}
            </div>
          ) : (
            <>
              <div className="text-xs text-trace-subtle leading-relaxed whitespace-pre-wrap break-words">
                {p.interpretation}
              </div>
              {(capture?.domDistillation || p.elementSummary) && (
                <CollapsibleSection
                  label="DOM distillation"
                  preview={` ${truncate(elementText, 80)}`}
                  maxHeightClass="sm"
                >
                  <pre className="mt-1 p-2 bg-trace-panel-muted border border-trace-accent/[0.08] rounded text-[11px] text-trace-muted font-mono leading-normal whitespace-pre-wrap break-all overflow-auto">
                    {elementText}
                  </pre>
                </CollapsibleSection>
              )}
              <div className="flex gap-3 flex-wrap text-[11px] text-trace-muted mt-auto pt-2 border-t border-trace-accent/[0.12]">
                {legacyBackfilledMeta ? (
                  <span title="Older traces backfilled first-turn perception after the call and did not persist the actual perception model or timing.">
                    Perception metadata: unavailable (legacy backfill)
                  </span>
                ) : (
                  <>
                    <span>Model: {p.model || "?"}</span>
                    {p.providerId && <span>Provider: {p.providerId}</span>}
                    <span>
                      Duration:{" "}
                      {p.durationMs != null ? `${p.durationMs}ms` : "?"}
                    </span>
                    <span>Cached: {p.cached ? "Yes" : "No"}</span>
                  </>
                )}
                {p.pageStateRef && <span>Page state: {p.pageStateRef}</span>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
