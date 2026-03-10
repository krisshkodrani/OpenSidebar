import React, { useState } from "react";
import type { TraceEntry } from "../../../types/traces";
import CollapsibleSection from "../CollapsibleSection";
import PanoramicThumbnails from "./PanoramicThumbnails";

interface TurnSnapshotSectionProps {
  snapshot: TraceEntry["snapshot"] | null;
  perception?: TraceEntry["perception"];
}

export default function TurnSnapshotSection({ snapshot, perception }: TurnSnapshotSectionProps) {
  const [imgError, setImgError] = useState(false);
  const screenshotDataUrl = perception?.screenshotDataUrl;
  const panoramicShots = perception?.panoramicShots;

  if (!snapshot?.url && !snapshot?.title && !screenshotDataUrl) return null;

  return (
    <div className="mb-2">
      {(snapshot?.url || snapshot?.title) && (
        <div className="text-[11px] text-trace-muted mb-2">
          <span className="text-trace-accent-light">{snapshot.url}</span>
          {snapshot.title && <> &mdash; {snapshot.title}</>}
          {snapshot.scrollY ? ` (scroll: ${snapshot.scrollY}px)` : ""}
        </div>
      )}
      {screenshotDataUrl && !imgError && (
        <CollapsibleSection label="Screenshot" className="mt-1">
          <div className="p-2">
            <img
              src={screenshotDataUrl}
              alt="Turn screenshot"
              className="max-w-full rounded border border-trace-border"
              loading="lazy"
              onError={() => setImgError(true)}
            />
            {panoramicShots && panoramicShots.length > 0 && (
              <PanoramicThumbnails shots={panoramicShots} />
            )}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}
