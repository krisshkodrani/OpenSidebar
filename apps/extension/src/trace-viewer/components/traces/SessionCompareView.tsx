import React, { useEffect, useMemo, useState } from "react";
import type { TraceEntry, TraceSession } from "../../../types/traces";
import { fetchTraceEntries } from "../../api";
import { summarizeSessionComparison } from "../../compare";
import { useStore } from "../../store";
import LoadingSpinner from "../LoadingSpinner";
import Badge from "../Badge";
import {
  extractQueryTitle,
  formatCost,
  formatDuration,
  formatTime,
  shortModel,
} from "../../utils";

interface SessionCompareViewProps {
  sessions: TraceSession[];
}

export default function SessionCompareView({ sessions }: SessionCompareViewProps) {
  const compareSessionIds = useStore((s) => s.compareSessionIds);
  const clearCompareSessions = useStore((s) => s.clearCompareSessions);
  const setCompareViewActive = useStore((s) => s.setCompareViewActive);
  const [entriesBySessionId, setEntriesBySessionId] = useState<Record<string, TraceEntry[]>>(
    {},
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSessions = useMemo(
    () =>
      compareSessionIds
        .map((id) => sessions.find((session) => session.sessionId === id))
        .filter(Boolean) as TraceSession[],
    [compareSessionIds, sessions],
  );

  useEffect(() => {
    if (compareSessionIds.length !== 2) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all(compareSessionIds.map((sessionId) => fetchTraceEntries(sessionId)))
      .then(([leftEntries, rightEntries]) => {
        if (cancelled) return;
        setEntriesBySessionId({
          [compareSessionIds[0]]: leftEntries,
          [compareSessionIds[1]]: rightEntries,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [compareSessionIds]);

  if (selectedSessions.length !== 2) {
    return (
      <div className="flex-1 flex items-center justify-center text-trace-dim text-sm">
        Pick two sessions to compare.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 px-5 py-4">
        <LoadingSpinner message="Loading comparison..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 px-5 py-4 text-sm text-red-300">
        Failed to load comparison: {error}
      </div>
    );
  }

  const [leftSession, rightSession] = selectedSessions;
  const leftEntries = entriesBySessionId[leftSession.sessionId] || [];
  const rightEntries = entriesBySessionId[rightSession.sessionId] || [];
  const summary = summarizeSessionComparison(
    leftSession,
    rightSession,
    leftEntries,
    rightEntries,
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-5 pt-3 pb-2 border-b border-trace-border shrink-0">
        <button
          onClick={() => setCompareViewActive(false)}
          className="text-[11px] text-trace-muted hover:text-trace-accent-light transition-colors"
        >
          &larr; Back To List
        </button>
        <span className="text-trace-dim text-[10px]">&middot;</span>
        <span className="text-[11px] text-trace-muted">
          shared prefix {summary.sharedToolPrefixTurns} turns
        </span>
        <span className="text-[11px] text-trace-muted">
          first divergence{" "}
          <span className="text-trace-subtle">
            {summary.divergenceTurn ? `T${summary.divergenceTurn}` : "none"}
          </span>
        </span>
        <button
          onClick={clearCompareSessions}
          className="ml-auto text-[11px] text-trace-muted hover:text-trace-text border border-trace-border rounded px-2 py-1 transition-colors"
        >
          Clear Compare
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 px-5 py-4 overflow-y-auto scrollbar-thin">
        <CompareSessionCard
          session={leftSession}
          entries={leftEntries}
          label="A"
          models={summary.leftModels.map(shortModel)}
          diagnostics={summary.leftDiagnostics}
        />
        <CompareSessionCard
          session={rightSession}
          entries={rightEntries}
          label="B"
          models={summary.rightModels.map(shortModel)}
          diagnostics={summary.rightDiagnostics}
        />
      </div>

      <div className="px-5 pb-4">
        <div className="rounded border border-trace-border bg-trace-panel p-4">
          <div className="text-[11px] uppercase tracking-[0.22em] text-trace-muted mb-3">
            Diff Summary
          </div>
          <div className="grid grid-cols-[1.2fr,1fr,1fr] gap-y-2 gap-x-3 text-[12px]">
            <DiffRow label="Outcome" left={leftSession.outcome} right={rightSession.outcome} />
            <DiffRow label="Turns" left={String(leftSession.turnCount || 0)} right={String(rightSession.turnCount || 0)} />
            <DiffRow label="Duration" left={formatDuration(leftSession.endTime - leftSession.startTime)} right={formatDuration(rightSession.endTime - rightSession.startTime)} />
            <DiffRow label="Cost" left={formatCost(leftSession.metrics?.totalCost ?? 0) || "$0"} right={formatCost(rightSession.metrics?.totalCost ?? 0) || "$0"} />
            <DiffRow label="Productive turns" left={String(summary.leftDiagnostics.productiveTurns)} right={String(summary.rightDiagnostics.productiveTurns)} />
            <DiffRow label="Loop turns" left={String(summary.leftDiagnostics.loopTurns)} right={String(summary.rightDiagnostics.loopTurns)} />
            <DiffRow label="Escalations" left={String(summary.leftDiagnostics.escalations)} right={String(summary.rightDiagnostics.escalations)} />
            <DiffRow label="Failovers" left={String(summary.leftDiagnostics.failovers)} right={String(summary.rightDiagnostics.failovers)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function CompareSessionCard({
  session,
  entries,
  label,
  models,
  diagnostics,
}: {
  session: TraceSession;
  entries: TraceEntry[];
  label: string;
  models: string[];
  diagnostics: ReturnType<typeof summarizeSessionComparison>["leftDiagnostics"];
}) {
  return (
    <div className="rounded border border-trace-border bg-trace-panel p-4 min-w-0">
      <div className="flex items-center gap-2 mb-2">
        <Badge variant="type">{label}</Badge>
        <span className="font-mono text-[11px] text-trace-muted">
          {session.sessionId}
        </span>
      </div>
      <div className="text-sm text-trace-text font-medium break-words">
        {extractQueryTitle(session.query).title}
      </div>
      <div className="flex gap-3 mt-2 flex-wrap text-[11px] text-trace-muted">
        <span>{formatTime(session.startTime)}</span>
        <span>{entries.length} entries</span>
        <span>{session.turnCount || 0} turns</span>
        <span>{formatDuration(session.endTime - session.startTime)}</span>
      </div>
      <div className="flex gap-1.5 mt-3 flex-wrap">
        <Badge variant="model">{models.join(", ") || "-"}</Badge>
        <Badge variant="type">{session.outcome}</Badge>
        {diagnostics.escalations > 0 && (
          <Badge variant="event-escalation">{diagnostics.escalations} escalations</Badge>
        )}
        {diagnostics.failovers > 0 && (
          <Badge variant="category">{diagnostics.failovers} failovers</Badge>
        )}
      </div>
    </div>
  );
}

function DiffRow({
  label,
  left,
  right,
}: {
  label: string;
  left: string;
  right: string;
}) {
  const differs = left !== right;
  return (
    <>
      <div className="text-trace-muted">{label}</div>
      <div className={differs ? "text-trace-text font-semibold" : "text-trace-subtle"}>
        {left}
      </div>
      <div className={differs ? "text-trace-text font-semibold" : "text-trace-subtle"}>
        {right}
      </div>
    </>
  );
}
