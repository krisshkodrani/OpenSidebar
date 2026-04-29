import React, { useState } from "react";
import type {
  TraceEntry,
  TracePageStateCapture,
  TracePanoramicShot,
} from "../../../types/traces";
import CollapsibleSection from "../CollapsibleSection";
import PanoramicThumbnails from "./PanoramicThumbnails";
import { screenshotUrl } from "../../api";
import { useStore } from "../../store";

interface TurnSnapshotSectionProps {
  snapshot: TraceEntry["snapshot"] | null;
  pageState?: TraceEntry["pageState"];
  perception?: TraceEntry["perception"];
  sessionId: string;
  turnNumber: number;
}

function selectPageStateCapture(
  pageState: TraceEntry["pageState"] | undefined,
  perception: TraceEntry["perception"] | undefined,
): TracePageStateCapture | null {
  if (!pageState) return null;
  if (perception?.pageStateRef === "postTool" && pageState.postTool) {
    return pageState.postTool;
  }
  if (perception?.pageStateRef === "preDecision") return pageState.preDecision;
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

export default function TurnSnapshotSection({
  snapshot,
  pageState,
  perception,
  sessionId,
  turnNumber,
}: TurnSnapshotSectionProps) {
  const [imgError, setImgError] = useState(false);
  const navigateToPerception = useStore((s) => s.navigateToPerception);
  const capture = selectPageStateCapture(pageState, perception);
  const pageStateScreenshot = capture?.screenshots?.find(
    (shot) => shot.kind === "viewport" && shot.dataUrl,
  );
  const panoramicShots = panoramicFromCapture(capture);
  const legacyPanoramicShots = perception?.panoramicShots ?? [];

  // Use inline data URL if available, otherwise fall back to file-based API
  const screenshotSrc = pageStateScreenshot?.dataUrl
    ? pageStateScreenshot.dataUrl
    : perception?.screenshotDataUrl
      ? perception.screenshotDataUrl
      : sessionId
        ? screenshotUrl(sessionId, turnNumber)
        : null;

  const displayState = capture ?? snapshot;
  const hasSnapshot = displayState?.url || displayState?.title;

  if (!hasSnapshot && !screenshotSrc) return null;

  return (
    <div className="mb-2">
      {hasSnapshot && (
        <div className="text-[11px] text-trace-muted mb-2">
          <span className="text-trace-accent-light">{displayState!.url}</span>
          {displayState!.title && <> &mdash; {displayState!.title}</>}
          {displayState!.scrollY ? ` (scroll: ${displayState!.scrollY}px)` : ""}
        </div>
      )}
      {screenshotSrc && !imgError && (
        <CollapsibleSection label="Screenshot" className="mt-1">
          <div className="p-2">
            <img
              src={screenshotSrc}
              alt="Turn screenshot"
              className="max-w-full rounded border border-trace-border"
              loading="lazy"
              onError={() => setImgError(true)}
            />
            {panoramicShots.length > 0 ? (
              <PanoramicThumbnails shots={panoramicShots} />
            ) : legacyPanoramicShots.length > 0 ? (
              <PanoramicThumbnails shots={legacyPanoramicShots} />
            ) : null}
            {capture?.domDistillation && (
              <CollapsibleSection label="DOM distillation" className="mt-2">
                <pre className="p-2 text-[11px] font-mono text-trace-subtle whitespace-pre-wrap break-words max-h-[260px] overflow-y-auto scrollbar-thin bg-trace-accent/[0.04] rounded">
                  {capture.domDistillation}
                </pre>
              </CollapsibleSection>
            )}
            {perception && (
              <a
                className="inline-block mt-2 text-[11px] text-trace-accent-light hover:underline cursor-pointer"
                onClick={() => navigateToPerception(turnNumber)}
                title="View full perception details"
              >
                View perception observation &rarr;
              </a>
            )}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}
