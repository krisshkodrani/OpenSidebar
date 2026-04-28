import React, { useEffect, useMemo, useState } from "react";
import type { TraceEntry, TraceSession } from "../../../types/traces";
import { fetchTraceEntries } from "../../api";
import {
  compareTraceSessions,
  compareTraceTimelines,
  type TraceSessionComparison,
  type TraceTurnDiff,
  type TraceTurnDiffSignal,
} from "../../analysis";
import { useStore } from "../../store";
import { truncate } from "../../utils";
import Badge from "../Badge";

interface TimelineDiffPanelProps {
  session: TraceSession;
}

const SIGNAL_VARIANT: Record<
  TraceTurnDiffSignal["severity"],
  "type" | "max_turns" | "error"
> = {
  info: "type",
  warning: "max_turns",
  error: "error",
};

function relationLabel(comparison: TraceSessionComparison): string {
  const turnDelta =
    comparison.turnDelta === 0
      ? "0t"
      : `${comparison.turnDelta > 0 ? "+" : ""}${comparison.turnDelta}t`;
  return `${comparison.label} ${turnDelta}`;
}

function severityClass(severity: TraceTurnDiff["severity"]): string {
  if (severity === "error") return "border-state-error/25 bg-state-error/5";
  if (severity === "warning") {
    return "border-state-warning/30 bg-state-warning/5";
  }
  return "border-trace-border bg-trace-bg";
}

function SignalRow({ signal }: { signal: TraceTurnDiffSignal }) {
  return (
    <div className="rounded border border-trace-border/70 bg-trace-panel/60 p-2">
      <div className="flex items-center gap-2">
        <Badge variant={SIGNAL_VARIANT[signal.severity]}>
          {signal.category.replace("_", " ")}
        </Badge>
        <span className="min-w-0 truncate text-[11px] font-medium text-trace-text">
          {signal.label}
        </span>
        {!signal.changed && (
          <span className="text-[10px] text-trace-muted">shared</span>
        )}
      </div>
      <div className="mt-1 grid grid-cols-1 gap-1 text-[10px] text-trace-muted sm:grid-cols-2">
        <div className="min-w-0">
          <span className="text-trace-subtle">base </span>
          <span className="font-mono">{truncate(signal.base || "-", 72)}</span>
        </div>
        <div className="min-w-0">
          <span className="text-trace-subtle">related </span>
          <span className="font-mono">
            {truncate(signal.candidate || "-", 72)}
          </span>
        </div>
      </div>
    </div>
  );
}

function DiffCard({
  diff,
  onOpenTurn,
}: {
  diff: TraceTurnDiff;
  onOpenTurn: (turnNumber: number) => void;
}) {
  return (
    <div className={`rounded border px-3 py-2 ${severityClass(diff.severity)}`}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onOpenTurn(diff.turnNumber)}
          className="shrink-0 text-[12px] font-semibold text-trace-accent hover:underline"
        >
          T{diff.turnNumber}
        </button>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-trace-text">
          {diff.summary}
        </span>
      </div>
      {(diff.baseTitle ||
        diff.candidateTitle ||
        diff.baseUrl ||
        diff.candidateUrl) && (
        <div className="mt-1 grid grid-cols-1 gap-1 text-[10px] text-trace-muted sm:grid-cols-2">
          <div className="truncate">
            base: {truncate(diff.baseTitle || diff.baseUrl || "-", 80)}
          </div>
          <div className="truncate">
            related:{" "}
            {truncate(diff.candidateTitle || diff.candidateUrl || "-", 80)}
          </div>
        </div>
      )}
      <div className="mt-2 space-y-1.5">
        {diff.signals.slice(0, 4).map((signal) => (
          <SignalRow key={signal.id} signal={signal} />
        ))}
        {diff.signals.length > 4 && (
          <div className="text-[10px] text-trace-muted">
            +{diff.signals.length - 4} more signals
          </div>
        )}
      </div>
    </div>
  );
}

export default function TimelineDiffPanel({ session }: TimelineDiffPanelProps) {
  const sessions = useStore((s) => s.sessions);
  const entries = useStore((s) => s.currentEntries);
  const navigateToTurn = useStore((s) => s.navigateToTurn);
  const setCurrentSessionId = useStore((s) => s.setCurrentSessionId);
  const setCurrentEntries = useStore((s) => s.setCurrentEntries);
  const setCurrentRunEvents = useStore((s) => s.setCurrentRunEvents);
  const setSessionLogs = useStore((s) => s.setSessionLogs);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const setActiveSubview = useStore((s) => s.setActiveSubview);
  const [candidateId, setCandidateId] = useState("");
  const [candidateEntries, setCandidateEntries] = useState<TraceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const comparisons = useMemo(
    () => compareTraceSessions(session, sessions, 4).comparisons,
    [session, sessions],
  );

  useEffect(() => {
    if (comparisons.length === 0) {
      setCandidateId("");
      return;
    }
    if (
      !comparisons.some((comparison) => comparison.sessionId === candidateId)
    ) {
      setCandidateId(comparisons[0].sessionId);
    }
  }, [candidateId, comparisons]);

  const candidateSession = useMemo(
    () => sessions.find((item) => item.sessionId === candidateId) ?? null,
    [candidateId, sessions],
  );
  const selectedComparison = comparisons.find(
    (comparison) => comparison.sessionId === candidateId,
  );

  useEffect(() => {
    if (!candidateId) {
      setCandidateEntries([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTraceEntries(candidateId)
      .then((loaded) => {
        if (!cancelled) setCandidateEntries(loaded || []);
      })
      .catch((err) => {
        if (!cancelled) {
          setCandidateEntries([]);
          setError(String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [candidateId]);

  const diff = useMemo(() => {
    if (
      !candidateSession ||
      entries.length === 0 ||
      candidateEntries.length === 0
    ) {
      return null;
    }
    return compareTraceTimelines(
      {
        baseSession: session,
        baseEntries: entries,
        candidateSession,
        candidateEntries,
      },
      { maxDiffs: 5 },
    );
  }, [candidateEntries, candidateSession, entries, session]);

  if (comparisons.length === 0) return null;

  const openCandidate = () => {
    if (!candidateId) return;
    setCurrentSessionId(candidateId);
    setCurrentEntries([]);
    setCurrentRunEvents([]);
    setSessionLogs([]);
    setSearchQuery("");
    setActiveSubview("overview");
  };

  return (
    <section className="bg-trace-panel border border-trace-border rounded-lg p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] text-trace-muted uppercase tracking-wide mb-1">
            Turn Diff
          </div>
          <div className="text-sm font-semibold text-trace-text">
            First changed evidence between related traces
          </div>
        </div>
        <button
          type="button"
          onClick={openCandidate}
          disabled={!candidateId}
          className="rounded border border-trace-border px-2 py-1 text-[11px] text-trace-accent transition-colors hover:border-trace-accent/40 disabled:cursor-not-allowed disabled:text-trace-muted"
        >
          Open related
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {comparisons.map((comparison) => (
          <button
            key={comparison.sessionId}
            type="button"
            onClick={() => setCandidateId(comparison.sessionId)}
            title={comparison.queryTitle}
            className={`rounded border px-2 py-1 text-[10px] transition-colors ${
              candidateId === comparison.sessionId
                ? "border-trace-accent/50 bg-trace-accent/10 text-trace-accent-light"
                : "border-trace-border bg-trace-bg text-trace-muted hover:border-trace-accent/30"
            }`}
          >
            {relationLabel(comparison)}
          </button>
        ))}
      </div>

      {selectedComparison && (
        <div className="mt-2 truncate text-[11px] text-trace-muted">
          {truncate(selectedComparison.queryTitle, 120)}
        </div>
      )}

      {loading && (
        <div className="mt-3 text-[12px] text-trace-muted">
          Loading related turns...
        </div>
      )}

      {error && (
        <div className="mt-3 rounded border border-state-error/25 bg-state-error/5 px-3 py-2 text-[12px] text-state-error">
          Failed to load related turns: {error}
        </div>
      )}

      {!loading && !error && diff && (
        <div className="mt-3 space-y-2">
          <div className="rounded border border-trace-border bg-trace-bg px-3 py-2">
            <div className="text-[12px] font-medium text-trace-text">
              {diff.headline}
            </div>
            <div className="mt-1 text-[11px] text-trace-muted">
              {diff.recommendedAction}
            </div>
          </div>
          {diff.diffs.map((item) => (
            <DiffCard
              key={item.turnNumber}
              diff={item}
              onOpenTurn={navigateToTurn}
            />
          ))}
        </div>
      )}

      {!loading &&
        !error &&
        candidateSession &&
        (entries.length === 0 || candidateEntries.length === 0) && (
          <div className="mt-3 text-[12px] text-trace-muted">
            Turn data is not available for one side of this comparison.
          </div>
        )}
    </section>
  );
}
