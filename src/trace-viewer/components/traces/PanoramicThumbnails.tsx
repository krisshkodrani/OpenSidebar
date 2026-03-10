import React, { useState } from "react";
import type { TracePanoramicShot } from "../../../types/traces";

interface PanoramicThumbnailsProps {
  shots: TracePanoramicShot[];
}

export default function PanoramicThumbnails({ shots }: PanoramicThumbnailsProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (shots.length === 0) return null;

  return (
    <div className="mt-2">
      <div className="text-[10px] uppercase tracking-wider text-trace-muted mb-1.5">
        Panoramic views ({shots.length})
      </div>
      <div className="flex gap-2 flex-wrap">
        {shots.map((shot, i) => (
          <button
            key={i}
            className="group relative rounded border border-trace-border hover:border-trace-accent/50 transition-colors overflow-hidden bg-trace-bg cursor-pointer"
            onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
            title={`${shot.label} — scroll Y=${shot.scrollY}px (click to ${expandedIdx === i ? "collapse" : "expand"})`}
          >
            <img
              src={shot.dataUrl}
              alt={`${shot.label} view`}
              className="h-16 w-auto object-cover"
              loading="lazy"
            />
            <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[9px] text-trace-subtle text-center py-0.5">
              {shot.label} · {shot.scrollY}px
            </span>
          </button>
        ))}
      </div>

      {expandedIdx !== null && shots[expandedIdx] && (
        <div className="mt-2 rounded border border-trace-border overflow-hidden">
          <div className="flex items-center gap-2 px-2 py-1 bg-trace-bg text-[10px] text-trace-muted">
            <span className="font-medium text-trace-subtle capitalize">
              {shots[expandedIdx].label}
            </span>
            <span>scroll Y={shots[expandedIdx].scrollY}px</span>
            <button
              className="ml-auto text-trace-dim hover:text-trace-subtle transition-colors"
              onClick={() => setExpandedIdx(null)}
            >
              Close
            </button>
          </div>
          <img
            src={shots[expandedIdx].dataUrl}
            alt={`${shots[expandedIdx].label} view expanded`}
            className="max-w-full"
          />
        </div>
      )}
    </div>
  );
}
