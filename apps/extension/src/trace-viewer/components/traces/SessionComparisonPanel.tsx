import React, { useMemo } from "react";
import type { TraceSession } from "../../../types/traces";
import {
  compareTraceSessions,
  type TraceSessionComparison,
} from "../../analysis";
import { useStore } from "../../store";
import {
  formatCost,
  formatDuration,
  outcomeClass,
  truncate,
} from "../../utils";
import Badge from "../Badge";

interface SessionComparisonPanelProps {
  session: TraceSession;
}

function signed(value: number, unit = ""): string {
  if (value === 0) return `0${unit}`;
  return `${value > 0 ? "+" : ""}${value}${unit}`;
}

function signedCost(value: number): string {
  if (value === 0) return "$0";
  const formatted = formatCost(Math.abs(value)) || "$0";
  return `${value > 0 ? "+" : "-"}${formatted}`;
}

function relationVariant(comparison: TraceSessionComparison) {
  if (comparison.relation === "same_failure") return "error" as const;
  if (comparison.relation === "same_run") return "type" as const;
  if (comparison.relation === "same_skill") return "tool" as const;
  return "category" as const;
}

function ComparisonRow({
  comparison,
  onOpen,
}: {
  comparison: TraceSessionComparison;
  onOpen: () => void;
}) {
  const duration = formatDuration(Math.abs(comparison.durationDeltaMs));
  const durationDelta =
    comparison.durationDeltaMs === 0
      ? "0ms"
      : `${comparison.durationDeltaMs > 0 ? "+" : "-"}${duration}`;
  const sharedSignal =
    comparison.sharedSkills[0] ||
    comparison.failureLabel ||
    comparison.domain ||
    comparison.sharedModels[0] ||
    "";

  return (
    <button
      type="button"
      onClick={onOpen}
      title={comparison.recommendation}
      className="w-full rounded border border-trace-border bg-trace-bg px-3 py-2 text-left transition-colors hover:border-trace-accent/40 hover:bg-trace-accent/[0.04]"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Badge variant={relationVariant(comparison)}>{comparison.label}</Badge>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-trace-text">
          {truncate(comparison.queryTitle, 82)}
        </span>
        <Badge
          variant={
            outcomeClass(comparison.outcome) as
              | "completed"
              | "stopped"
              | "error"
              | "max_turns"
          }
          className="shrink-0"
        >
          {comparison.outcome}
        </Badge>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-trace-muted">
        <span>{signed(comparison.turnDelta, "t")}</span>
        <span>{durationDelta}</span>
        <span>{signedCost(comparison.costDelta)}</span>
        {sharedSignal && <span className="truncate">{sharedSignal}</span>}
      </div>
      <div className="mt-1 truncate text-[10px] text-trace-subtle">
        {comparison.recommendation}
      </div>
    </button>
  );
}

export default function SessionComparisonPanel({
  session,
}: SessionComparisonPanelProps) {
  const sessions = useStore((s) => s.sessions);
  const setCurrentSessionId = useStore((s) => s.setCurrentSessionId);
  const setCurrentEntries = useStore((s) => s.setCurrentEntries);
  const setCurrentRunEvents = useStore((s) => s.setCurrentRunEvents);
  const setSessionLogs = useStore((s) => s.setSessionLogs);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const setActiveSubview = useStore((s) => s.setActiveSubview);

  const comparisons = useMemo(
    () => compareTraceSessions(session, sessions, 5).comparisons,
    [session, sessions],
  );

  if (comparisons.length === 0) return null;

  const openComparison = (sessionId: string) => {
    setCurrentSessionId(sessionId);
    setCurrentEntries([]);
    setCurrentRunEvents([]);
    setSessionLogs([]);
    setSearchQuery("");
    setActiveSubview("overview");
  };

  return (
    <section className="bg-trace-panel border border-trace-border rounded-lg p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] text-trace-muted uppercase tracking-wide mb-1">
            Related Traces
          </div>
          <div className="text-sm font-semibold text-trace-text">
            Compare nearby evidence
          </div>
        </div>
        <div className="text-[11px] text-trace-muted shrink-0">
          {comparisons.length} match{comparisons.length === 1 ? "" : "es"}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2">
        {comparisons.map((comparison) => (
          <ComparisonRow
            key={comparison.sessionId}
            comparison={comparison}
            onOpen={() => openComparison(comparison.sessionId)}
          />
        ))}
      </div>
    </section>
  );
}
