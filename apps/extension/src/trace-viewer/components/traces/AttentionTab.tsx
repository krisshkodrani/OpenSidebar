import React, { useEffect, useMemo, useState } from "react";
import { fetchHarnessRatchet, type HarnessRatchetCandidate } from "../../api";
import { useStore } from "../../store";
import { annotationKeyFor } from "../../store/types";
import {
  extractQueryTitle,
  formatTime,
  outcomeClass,
  truncate,
} from "../../utils";
import Badge from "../Badge";

// The adjudication inbox — the viewer's default landing. It answers the one
// question a human maintaining the harness actually opens the viewer to ask:
// "what needs my judgement right now?" That is: runs that failed / half-finished
// and haven't been adjudicated yet, plus the repeated-failure clusters the
// ratchet flags as harness work. Everything here is a doorway into a run's
// Story, where the verdict is recorded. Adjudicated runs drop out of the queue.

const NEEDS_LOOK_OUTCOMES = new Set(["error", "max_turns", "stopped"]);

const SEVERITY_BADGE: Record<
  HarnessRatchetCandidate["severity"],
  "error" | "max_turns" | "stopped"
> = {
  high: "error",
  medium: "max_turns",
  low: "stopped",
};

interface AttentionTabProps {
  onSelectSession: (sessionId: string) => void;
}

export default function AttentionTab({ onSelectSession }: AttentionTabProps) {
  const sessions = useStore((s) => s.sessions);
  const annotations = useStore((s) => s.annotations);

  const [ratchet, setRatchet] = useState<HarnessRatchetCandidate[]>([]);
  const [ratchetLoaded, setRatchetLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    fetchHarnessRatchet()
      .then((r) => {
        if (live) {
          setRatchet(r);
          setRatchetLoaded(true);
        }
      })
      .catch(() => {
        if (live) setRatchetLoaded(true);
      });
    return () => {
      live = false;
    };
  }, []);

  // The queue: unreviewed runs that failed or only partially finished, newest
  // first. Reviewed runs (any verdict) fall out — that is the point.
  const queue = useMemo(() => {
    return sessions
      .filter((s) => {
        const reviewed =
          !!annotations[
            annotationKeyFor({ runId: s.runId, sessionId: s.sessionId })
          ];
        if (reviewed) return false;
        return NEEDS_LOOK_OUTCOMES.has(s.outcome) || !!s.partialHandoff;
      })
      .sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0));
  }, [sessions, annotations]);

  const reviewedCount = useMemo(
    () =>
      sessions.filter(
        (s) =>
          !!annotations[
            annotationKeyFor({ runId: s.runId, sessionId: s.sessionId })
          ],
      ).length,
    [sessions, annotations],
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-trace-text">
          Needs adjudication
        </h2>
        <Badge variant={queue.length ? "max_turns" : "completed"}>
          {queue.length} queued
        </Badge>
        <span className="text-[11px] text-trace-muted">
          {reviewedCount} reviewed in view
        </span>
      </div>

      {queue.length === 0 ? (
        <div className="rounded-lg border border-trace-border bg-trace-panel/60 px-4 py-6 text-center text-[12px] text-trace-muted">
          All caught up — no failed or partial runs in view are waiting on a
          verdict. Open any trace to adjudicate it.
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-trace-border/50 rounded-lg border border-trace-border bg-trace-panel">
          {queue.map((s) => (
            <button
              key={s.sessionId}
              type="button"
              onClick={() => onSelectSession(s.sessionId)}
              className="flex items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-trace-accent/5"
            >
              <span className="w-16 shrink-0 text-[10px] text-trace-muted">
                {formatTime(s.startTime)}
              </span>
              <Badge
                variant={
                  outcomeClass(s.outcome) as
                    | "completed"
                    | "stopped"
                    | "error"
                    | "max_turns"
                }
              >
                {s.outcome}
              </Badge>
              {s.partialHandoff && <Badge variant="max_turns">partial</Badge>}
              <span className="flex-1 truncate text-[12px] text-trace-text">
                {truncate(extractQueryTitle(s.query).title, 80)}
              </span>
              {s.failureDetail && (
                <span className="hidden shrink-0 text-[10px] text-trace-dim md:inline">
                  {truncate(s.failureDetail, 48)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Harness ratchet — repeated failures worth turning into harness work. */}
      {ratchetLoaded && ratchet.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-trace-text">
            Harness ratchet
          </h2>
          <div className="flex flex-col divide-y divide-trace-border/50 rounded-lg border border-trace-border bg-trace-panel">
            {ratchet.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={!c.sampleSessionId}
                onClick={() =>
                  c.sampleSessionId && onSelectSession(c.sampleSessionId)
                }
                className="flex items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-trace-accent/5 disabled:cursor-default disabled:hover:bg-transparent"
              >
                <Badge variant={SEVERITY_BADGE[c.severity]}>{c.severity}</Badge>
                <span className="font-mono text-[10px] text-trace-muted">
                  {c.harnessLayer}
                </span>
                <span className="flex-1 truncate text-[12px] text-trace-text">
                  {truncate(c.title, 80)}
                </span>
                <span className="shrink-0 text-[10px] text-trace-dim">
                  ×{c.count}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
