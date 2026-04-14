import React, { useState } from "react";
import type { TraceEntry } from "../../../types/traces";
import CollapsibleSection from "../CollapsibleSection";
import PanoramicThumbnails from "./PanoramicThumbnails";
import { screenshotUrl } from "../../api";
import { useStore } from "../../store";

interface TurnSnapshotSectionProps {
  snapshot: TraceEntry["snapshot"] | null;
  perception?: TraceEntry["perception"];
  sessionId: string;
  turnNumber: number;
}

export default function TurnSnapshotSection({
  snapshot,
  perception,
  sessionId,
  turnNumber,
}: TurnSnapshotSectionProps) {
  const [imgError, setImgError] = useState(false);
  const navigateToPerception = useStore((s) => s.navigateToPerception);
  const panoramicShots = perception?.panoramicShots;

  // Use inline data URL if available, otherwise fall back to file-based API
  const screenshotSrc = perception?.screenshotDataUrl
    ? perception.screenshotDataUrl
    : sessionId
      ? screenshotUrl(sessionId, turnNumber)
      : null;

  const hasSnapshot = snapshot?.url || snapshot?.title;

  if (!hasSnapshot && !screenshotSrc) return null;

  return (
    <div className="mb-2">
      {hasSnapshot && (
        <div className="text-[11px] text-trace-muted mb-2">
          <span className="text-trace-accent-light">{snapshot!.url}</span>
          {snapshot!.title && <> &mdash; {snapshot!.title}</>}
          {snapshot!.scrollY ? ` (scroll: ${snapshot!.scrollY}px)` : ""}
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
            {panoramicShots && panoramicShots.length > 0 && (
              <PanoramicThumbnails shots={panoramicShots} />
            )}
            {perception && (
              <a
                className="inline-block mt-2 text-[11px] text-trace-accent-light hover:underline cursor-pointer"
                onClick={() => navigateToPerception(turnNumber)}
                title="View full perception details"
              >
                View in Perception &rarr;
              </a>
            )}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}
