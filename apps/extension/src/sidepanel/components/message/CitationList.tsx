import React from "react";
import { ExternalLink } from "lucide-react";
import type { Citation } from "../../../types";

function citationDisplayName(citation: Citation): string {
  if (citation.title && citation.title !== citation.url) {
    return citation.title.length > 50
      ? `${citation.title.slice(0, 47)}...`
      : citation.title;
  }
  try {
    const url = new URL(citation.url);
    const path = url.pathname === "/" ? "" : url.pathname;
    const short = `${url.hostname}${path}`;
    return short.length > 50 ? `${short.slice(0, 47)}...` : short;
  } catch {
    return citation.url.slice(0, 50);
  }
}

export function CitationList({ citations }: { citations: Citation[] }) {
  return (
    <div className="mt-1 flex max-w-[92%] flex-wrap gap-1.5">
      {citations.map((citation, index) => (
        <a
          key={`${citation.url}-${index}`}
          href={citation.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-full border border-warm-200 bg-warm-100 px-2 py-0.5 text-[11px] text-warm-600 transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 dark:border-warm-700 dark:bg-warm-800 dark:text-warm-300 dark:hover:border-primary-600 dark:hover:bg-primary-900/30 dark:hover:text-primary-300"
          title={citation.url}
        >
          <ExternalLink size={9} className="shrink-0" />
          <span className="truncate">{citationDisplayName(citation)}</span>
        </a>
      ))}
    </div>
  );
}
