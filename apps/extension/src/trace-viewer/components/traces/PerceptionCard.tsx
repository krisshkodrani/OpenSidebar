import React, { useState } from "react";
import type { TraceEntry } from "../../../types/traces";
import Badge from "../Badge";
import { screenshotUrl } from "../../api";
import { truncate } from "../../utils";
import { useStore } from "../../store";
import PanoramicThumbnails from "./PanoramicThumbnails";

interface PerceptionCardProps {
  entry: TraceEntry;
  sessionId: string;
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

  const screenshotSrc = p.screenshotDataUrl
    ? p.screenshotDataUrl
    : screenshotUrl(sessionId, turnNum);

  // Prefer the stored element summary (exactly what the model saw),
  // fall back to reconstructing from raw elements for older traces
  const elementText = p.elementSummary
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
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-trace-accent/[0.08] border-b border-trace-accent/[0.12]">
        <a
          className="text-[13px] font-bold text-trace-accent-light hover:underline cursor-pointer"
          onClick={() => navigateToTurn(turnNum)}
          title="Jump to this turn"
        >
          Turn {turnNum} &rarr;
        </a>
        <Badge variant="model">{p.model || "unknown"}</Badge>
        {p.mode && <Badge variant="type">{p.mode}</Badge>}
        {p.source && <Badge variant="category">{p.source}</Badge>}
        {p.cached && <Badge variant="stopped">cached</Badge>}
        {p.elementSummary && <Badge variant="type">exact input</Badge>}
        {p.fallbackReason && <Badge variant="error">{p.fallbackReason}</Badge>}
      </div>

      {/* Body */}
      <div className="flex flex-col xl:flex-row min-h-[200px]">
        {/* Left: screenshot + elements */}
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
              Screenshot not available
            </div>
          )}
          {p.panoramicShots && p.panoramicShots.length > 0 && (
            <PanoramicThumbnails shots={p.panoramicShots} />
          )}
          {elementText && (
            <div className="text-[11px] text-trace-muted font-mono max-h-[400px] overflow-y-auto leading-normal whitespace-pre-wrap break-all">
              {elementText}
            </div>
          )}
        </div>

        {/* Right: interpretation + metadata */}
        <div className="flex-1 p-3 min-w-0 flex flex-col gap-2.5">
          <div className="text-xs text-trace-subtle leading-relaxed whitespace-pre-wrap break-words">
            {p.interpretation}
          </div>
          <div className="flex gap-3 flex-wrap text-[11px] text-trace-muted mt-auto pt-2 border-t border-trace-accent/[0.12]">
            <span>Model: {p.model || "?"}</span>
            {p.providerId && <span>Provider: {p.providerId}</span>}
            <span>
              Duration: {p.durationMs != null ? `${p.durationMs}ms` : "?"}
            </span>
            <span>Cached: {p.cached ? "Yes" : "No"}</span>
            {p.freshnessReason && <span>Freshness: {p.freshnessReason}</span>}
            {p.screenshotStatus && (
              <span>Screenshot: {p.screenshotStatus}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
