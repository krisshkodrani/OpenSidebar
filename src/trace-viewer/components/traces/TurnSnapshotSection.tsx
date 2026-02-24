import React from "react";

interface SnapshotData {
  url?: string;
  title?: string;
  scrollY?: number;
}

interface TurnSnapshotSectionProps {
  snapshot: SnapshotData | null;
}

export default function TurnSnapshotSection({
  snapshot,
}: TurnSnapshotSectionProps) {
  if (!snapshot?.url && !snapshot?.title) return null;

  return (
    <div className="text-[11px] text-trace-muted mb-2">
      <span className="text-trace-accent-light">{snapshot.url}</span>
      {snapshot.title && <> &mdash; {snapshot.title}</>}
      {snapshot.scrollY ? ` (scroll: ${snapshot.scrollY}px)` : ""}
    </div>
  );
}
