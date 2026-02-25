import React from "react";
import Badge from "../Badge";
import { outcomeClass, formatDuration, formatCost, formatTokens, truncate } from "../../utils";

interface TraceDetailHeaderProps {
  session: Record<string, unknown>;
}

export default function TraceDetailHeader({ session }: TraceDetailHeaderProps) {
  const outcome = session.outcome as string;
  const metrics = session.metrics as Record<string, unknown> | undefined;
  const duration = formatDuration(
    ((session.endTime as number) || 0) - ((session.startTime as number) || 0),
  );

  let cost = "";
  let tokens = "";
  if (metrics) {
    if (metrics.totalCost) cost = formatCost(metrics.totalCost as number);
    if (metrics.totalTokens) tokens = `${formatTokens(metrics.totalTokens as number)} tokens`;
  } else {
    if (session.totalCost) cost = formatCost(session.totalCost as number);
    if (session.totalTokens) tokens = `${formatTokens(session.totalTokens as number)} tokens`;
  }

  return (
    <div className="px-5 py-3.5 border-b border-trace-border shrink-0 bg-trace-panel">
      <div className="flex items-center gap-3 mb-1.5">
        <span className="text-xs text-trace-muted font-mono">
          {session.sessionId as string}
        </span>
        <button
          className="text-trace-muted hover:text-trace-text transition-colors p-0.5 -ml-1.5"
          title="Copy session ID"
          onClick={() => {
            navigator.clipboard.writeText(session.sessionId as string);
            const btn = document.activeElement as HTMLButtonElement;
            const orig = btn.innerHTML;
            btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
            setTimeout(() => { btn.innerHTML = orig; }, 1200);
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
        <Badge variant={outcomeClass(outcome) as "completed" | "stopped" | "error" | "max_turns"}>
          {outcome}
        </Badge>
      </div>
      <div className="text-sm text-trace-text font-medium break-words">
        {(session.query as string) || "(no query)"}
      </div>
      <div className="flex gap-4 text-[11px] text-trace-muted mt-1.5 flex-wrap">
        <span>{(session.turnCount as number) || 0} turns</span>
        <span>{duration}</span>
        {tokens && <span>{tokens}</span>}
        {cost && <span>{cost}</span>}
        {session.startUrl && (
          <span>{truncate(session.startUrl as string, 50)}</span>
        )}
      </div>
    </div>
  );
}
