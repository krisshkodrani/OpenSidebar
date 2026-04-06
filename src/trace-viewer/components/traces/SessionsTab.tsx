import React from "react";
import { useStore } from "../../store";
import { useTraceData } from "../../hooks/useTraceData";
import PanelLayout from "../PanelLayout";
import EmptyState from "../EmptyState";
import ErrorBanner from "../ErrorBanner";
import TraceFilterPanel from "./TraceFilterPanel";
import TraceSessionList from "./TraceSessionList";
import CostDashboard from "./CostDashboard";
import Badge from "../Badge";
import {
  extractQueryTitle,
  formatCost,
  formatDuration,
  formatTime,
  outcomeClass,
  shortModel,
} from "../../utils";

export default function SessionsTab() {
  const runGroups = useStore((s) => s.runGroups);
  const tracesError = useStore((s) => s.tracesError);
  const currentSessionId = useStore((s) => s.currentSessionId);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const { sessions, refreshSessions } = useTraceData();

  const currentSession = sessions.find((s) => s.sessionId === currentSessionId);
  const completedCount = sessions.filter((s) =>
    ["completed", "success"].includes(s.outcome),
  ).length;
  const uniqueSites = new Set(
    sessions.map((s) => {
      try {
        return s.startUrl ? new URL(s.startUrl).hostname : "";
      } catch {
        return "";
      }
    }),
  );

  return (
    <PanelLayout
      left={
        <>
          <div className="px-4 pt-4 pb-3 border-b border-trace-border/70 bg-black/10">
            <div className="text-[11px] uppercase tracking-[0.24em] text-trace-accent-light/75">
              Session Explorer
            </div>
            <div className="mt-1 text-sm text-trace-subtle">
              Filter runs and choose a session to open in Trace View.
            </div>
          </div>
          <TraceFilterPanel onFiltersChanged={refreshSessions} />
          <div className="border-b border-trace-border/70" />
          {tracesError ? (
            <ErrorBanner
              message={`Failed to load sessions: ${tracesError}`}
              hint="Ensure the log server is running (npm run logs)"
              onRetry={refreshSessions}
            />
          ) : (
            <>
              <CostDashboard
                sessions={sessions}
                runGroups={runGroups}
                onDeleted={refreshSessions}
              />
              <TraceSessionList />
            </>
          )}
        </>
      }
      right={
        <div className="flex-1 overflow-y-auto px-6 py-6 scrollbar-thin">
          <section className="grid grid-cols-1 xl:grid-cols-[1.4fr_0.8fr] gap-4">
            <div className="rounded-3xl border border-white/8 bg-white/[0.03] p-6 shadow-soft-md">
              <div className="text-[11px] uppercase tracking-[0.24em] text-trace-accent-light/80">
                Workspace Overview
              </div>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white">
                Sessions first, traces second.
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#cfc6bb]">
                The old viewer pushed filters, browsing, and deep trace inspection into the same narrow surface. This layout separates discovery from diagnosis so the viewer feels more like a product and less like a raw log console.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Pill label={`${sessions.length} sessions`} />
                <Pill label={`${runGroups.length} run groups`} />
                <Pill label={`${completedCount} completed`} />
                <Pill label={`${[...uniqueSites].filter(Boolean).length} websites`} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <OverviewCard
                label="Completion"
                value={
                  sessions.length > 0
                    ? `${Math.round((completedCount / sessions.length) * 100)}%`
                    : "0%"
                }
                hint="Successful or completed sessions"
              />
              <OverviewCard
                label="Selected"
                value={currentSession ? currentSession.sessionId.slice(0, 8) : "None"}
                hint="Current focus session"
              />
              <OverviewCard
                label="Turn Volume"
                value={String(
                  sessions.reduce((sum, session) => sum + (session.turnCount || 0), 0),
                )}
                hint="Total turns in the current result set"
              />
              <OverviewCard
                label="Spend"
                value={
                  formatCost(
                    sessions.reduce(
                      (sum, session) => sum + (session.metrics?.totalCost ?? 0),
                      0,
                    ),
                  ) || "$0"
                }
                hint="Aggregate estimated cost"
              />
            </div>
          </section>

          <section className="mt-4 rounded-3xl border border-white/8 bg-[#211d1a]/78 p-5 shadow-soft-md">
            {currentSession ? (
              <>
                <div className="flex items-start gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-[0.24em] text-trace-accent-light/80">
                      Session Preview
                    </div>
                    <h3 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-white">
                      {extractQueryTitle(currentSession.query).title}
                    </h3>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-trace-subtle">
                      <Badge
                        variant={
                          outcomeClass(currentSession.outcome) as
                            | "completed"
                            | "stopped"
                            | "error"
                            | "max_turns"
                        }
                      >
                        {currentSession.outcome}
                      </Badge>
                      <span>{formatTime(currentSession.startTime)}</span>
                      <span>{currentSession.turnCount || 0} turns</span>
                      <span>
                        {formatDuration(
                          (currentSession.endTime || 0) -
                            (currentSession.startTime || 0),
                        )}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setActiveTab("trace")}
                    className="ml-auto rounded-2xl border border-trace-accent/35 bg-trace-accent/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-trace-accent/20"
                  >
                    Open Trace View
                  </button>
                </div>
                <div className="mt-5 grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-4">
                  <div className="rounded-2xl border border-white/8 bg-black/10 p-4">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-trace-muted">
                      Session Facts
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-[#d9d1c6]">
                      <Fact label="Session ID" value={currentSession.sessionId.slice(0, 12)} />
                      <Fact label="Start URL" value={currentSession.startUrl || "Unknown"} />
                      <Fact
                        label="Models"
                        value={(currentSession.models || []).map(shortModel).join(", ") || "None"}
                      />
                      <Fact
                        label="Cost"
                        value={formatCost(currentSession.metrics?.totalCost) || "$0"}
                      />
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-black/10 p-4">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-trace-muted">
                      Why this split helps
                    </div>
                    <div className="mt-3 space-y-3 text-sm leading-6 text-[#cfc6bb]">
                      <p>Sessions is now the management surface: filter, compare, and decide what deserves attention.</p>
                      <p>Trace View becomes the forensic surface: turns, perception, logs, and story for one selected session.</p>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <EmptyState
                icon="&#9711;"
                message="Choose a session on the left to preview it here and open Trace View."
              />
            )}
          </section>
        </div>
      }
    />
  );
}

function OverviewCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.035] p-4">
      <div className="text-[11px] uppercase tracking-[0.22em] text-trace-muted">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-white">
        {value}
      </div>
      <div className="mt-1 text-xs text-trace-subtle">{hint}</div>
    </div>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <div className="rounded-full border border-trace-accent/20 bg-trace-accent/10 px-3 py-1 text-xs text-trace-accent-light">
      {label}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.2em] text-trace-muted">
        {label}
      </div>
      <div className="mt-1 break-words text-sm text-[#e7e0d6]">{value}</div>
    </div>
  );
}
