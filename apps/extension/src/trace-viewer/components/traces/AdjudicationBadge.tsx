import React from "react";
import { useStore } from "../../store";
import { annotationKeyFor, type RunAnnotation } from "../../store/types";

// A compact human-verdict indicator for fleet rows: agree / disagree / unsure,
// or a quiet dash when a run hasn't been adjudicated yet. Reads the shared
// annotations map keyed by run (falling back to session).

const STYLE: Record<RunAnnotation["verdict"], { glyph: string; cls: string; title: string }> = {
  agree: { glyph: "✓", cls: "text-state-success", title: "Human agreed with the outcome" },
  disagree: { glyph: "✗", cls: "text-state-error", title: "Human disagreed with the outcome" },
  unsure: { glyph: "?", cls: "text-state-warning", title: "Human was unsure" },
};

/** Look up the verdict for a session/run from the store's annotation map. */
export function useAnnotationFor(session: {
  runId?: string;
  sessionId?: string;
}): RunAnnotation | undefined {
  const annotations = useStore((s) => s.annotations);
  return annotations[annotationKeyFor(session)];
}

export default function AdjudicationBadge({
  session,
}: {
  session: { runId?: string; sessionId?: string };
}) {
  const annotation = useAnnotationFor(session);
  if (!annotation) {
    return <span className="text-trace-dim" title="Not adjudicated">—</span>;
  }
  const s = STYLE[annotation.verdict];
  return (
    <span className={`font-semibold ${s.cls}`} title={s.title}>
      {s.glyph}
    </span>
  );
}
