import React, { useMemo, useState } from "react";
import type { TraceSession } from "../../../types/traces";
import {
  buildTraceEvidenceTimeline,
  type TraceEvidenceSignal,
  type TraceEvidenceTurn,
} from "../../analysis";
import { useStore } from "../../store";
import { truncate } from "../../utils";
import Badge from "../Badge";
import SectionCard, { Eyebrow } from "../SectionCard";

const DEFAULT_EVIDENCE_LIMIT = 8;

interface EvidenceTimelineProps {
  session: TraceSession;
}

const SEVERITY_CLASS: Record<TraceEvidenceTurn["severity"], string> = {
  error: "border-state-error/25 bg-state-error/5",
  warning: "border-state-warning/30 bg-state-warning/5",
  info: "border-trace-border bg-trace-bg",
};

const DOT_CLASS: Record<TraceEvidenceTurn["severity"], string> = {
  error: "bg-state-error",
  warning: "bg-state-warning",
  info: "bg-trace-accent",
};

function signalVariant(signal: TraceEvidenceSignal) {
  if (signal.severity === "error") return "error" as const;
  if (signal.severity === "warning") return "max_turns" as const;
  return "type" as const;
}

function signalLabel(signal: TraceEvidenceSignal): string {
  return signal.label.length > 28
    ? `${signal.label.slice(0, 25)}...`
    : signal.label;
}

export default function EvidenceTimeline({ session }: EvidenceTimelineProps) {
  const entries = useStore((s) => s.currentEntries);
  const runEvents = useStore((s) => s.currentRunEvents);
  const logs = useStore((s) => s.sessionLogs);
  const navigateToTurn = useStore((s) => s.navigateToTurn);
  const navigateToPerception = useStore((s) => s.navigateToPerception);
  const setActiveSubview = useStore((s) => s.setActiveSubview);
  const [showAll, setShowAll] = useState(false);

  const evidenceTurns = useMemo(
    () =>
      buildTraceEvidenceTimeline({
        session,
        entries,
        runEvents,
        logs,
      }),
    [entries, logs, runEvents, session],
  );

  if (evidenceTurns.length === 0) return null;

  const openSignal = (turn: TraceEvidenceTurn, signal: TraceEvidenceSignal) => {
    if (signal.target === "perception") {
      navigateToPerception(turn.turnNumber);
    } else if (signal.target === "logs") {
      setActiveSubview("logs");
    } else {
      navigateToTurn(turn.turnNumber);
    }
  };

  const visibleTurns = showAll
    ? evidenceTurns
    : evidenceTurns.slice(0, DEFAULT_EVIDENCE_LIMIT);

  return (
    <SectionCard>
      <div className="flex items-center justify-between gap-3">
        <div>
          <Eyebrow className="mb-1">Evidence Trail</Eyebrow>
          <div className="text-sm text-trace-text font-semibold">
            {evidenceTurns.length} high-signal turn
            {evidenceTurns.length === 1 ? "" : "s"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigateToTurn(evidenceTurns[0].turnNumber)}
          aria-label={`Start evidence review at turn ${evidenceTurns[0].turnNumber}`}
          className="text-[11px] text-trace-accent hover:underline shrink-0"
        >
          Start at T{evidenceTurns[0].turnNumber}
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {visibleTurns.map((turn) => (
          <div
            key={`${turn.sessionId}-${turn.turnNumber}`}
            className={`rounded border px-3 py-2 ${SEVERITY_CLASS[turn.severity]}`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`h-2 w-2 rounded-full shrink-0 ${DOT_CLASS[turn.severity]}`}
              />
              <button
                type="button"
                onClick={() => navigateToTurn(turn.turnNumber)}
                aria-label={`Open evidence turn ${turn.turnNumber}`}
                className="text-[12px] text-trace-accent font-semibold hover:underline shrink-0"
              >
                T{turn.turnNumber}
              </button>
              <div className="text-[12px] text-trace-text font-medium truncate">
                {turn.summary}
              </div>
            </div>
            {(turn.title || turn.url) && (
              <div className="mt-1 text-[10px] text-trace-muted truncate">
                {truncate(turn.title || turn.url || "", 96)}
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {turn.signals.slice(0, 6).map((signal) => (
                <button
                  key={signal.id}
                  type="button"
                  onClick={() => openSignal(turn, signal)}
                  aria-label={`Open ${signal.label} signal for turn ${turn.turnNumber}`}
                  title={signal.detail || signal.label}
                  className="text-left"
                >
                  <Badge variant={signalVariant(signal)}>
                    {signalLabel(signal)}
                  </Badge>
                </button>
              ))}
              {turn.signals.length > 6 && (
                <span className="text-[11px] text-trace-muted">
                  +{turn.signals.length - 6} more
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      {evidenceTurns.length > DEFAULT_EVIDENCE_LIMIT && (
        <button
          type="button"
          onClick={() => setShowAll((prev) => !prev)}
          className="mt-2 text-[11px] text-trace-accent hover:underline"
        >
          {showAll
            ? "Show fewer evidence turns"
            : `Show all ${evidenceTurns.length} evidence turns`}
        </button>
      )}
    </SectionCard>
  );
}
