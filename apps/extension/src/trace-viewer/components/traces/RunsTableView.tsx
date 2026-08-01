import React, { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight } from "lucide-react";
import type { TraceSession } from "../../../types/traces";
import type { RunGroup, RunAnnotation } from "../../store/types";
import { annotationKeyFor } from "../../store/types";
import { useStore } from "../../store";
import Badge from "../Badge";
import AdjudicationBadge from "./AdjudicationBadge";
import {
  extractQueryTitle,
  formatCost,
  formatCount,
  formatDuration,
  formatTime,
  getSessionModels,
  outcomeClass,
  sessionNeedsReview,
  shortModel,
  truncate,
} from "../../utils";

interface RunsTableViewProps {
  onSelectSession: (sessionId: string) => void;
  onLoadMore?: () => void;
  loadMorePending?: boolean;
}

// One row of the merged Runs list: either a run group (expandable) or a
// standalone session that has no runId — previously only visible on the
// retired flat Traces table.
type DisplayItem =
  | { kind: "group"; group: RunGroup; sortTime: number }
  | { kind: "session"; session: TraceSession; sortTime: number };

// The adjudication select predicate, transplanted from the retired
// UnifiedSessionsTableView (client-side: verdicts aren't server-searchable).
function matchesAdjudication(
  session: TraceSession,
  filter: string,
  annotations: Record<string, RunAnnotation>,
): boolean {
  if (!filter || filter === "all") return true;
  const a =
    annotations[
      annotationKeyFor({ runId: session.runId, sessionId: session.sessionId })
    ];
  if (filter === "unreviewed") return !a;
  if (filter === "reviewed") return !!a;
  if (filter === "disagreed") return a?.verdict === "disagree";
  return true;
}

function matchesQuery(session: TraceSession, q: string): boolean {
  return (
    session.sessionId.toLowerCase().includes(q) ||
    (session.query ?? "").toLowerCase().includes(q) ||
    (session.runId ?? "").toLowerCase().includes(q)
  );
}

export default function RunsTableView({
  onSelectSession,
  onLoadMore,
  loadMorePending = false,
}: RunsTableViewProps) {
  const runGroups = useStore((s) => s.runGroups);
  const tracesLoading = useStore((s) => s.tracesLoading);
  const sessions = useStore((s) => s.sessions);
  const sessionsTotal = useStore((s) => s.sessionsTotal);
  const sessionsHasMore = useStore((s) => s.sessionsHasMore);
  const annotations = useStore((s) => s.annotations);
  const adjudicationFilter = useStore((s) => s.filters.adjudication);
  const needsReviewOn = useStore((s) => s.filters.needsReview === "on");
  const expandAllRunGroups = useStore((s) => s.expandAllRunGroups);
  const collapseAllRunGroups = useStore((s) => s.collapseAllRunGroups);
  const toggleRunGroup = useStore((s) => s.toggleRunGroup);
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Merge run groups and standalone sessions into one newest-first list, then
  // apply the client-side filters (adjudication select, needs-review chip,
  // text query). A group stays visible if any member matches.
  const items = useMemo<DisplayItem[]>(() => {
    const q = query.trim().toLowerCase();

    const groupItems: DisplayItem[] = runGroups
      .filter((group) =>
        group.sessions.some((session) =>
          matchesAdjudication(session, adjudicationFilter, annotations),
        ),
      )
      .filter(
        (group) =>
          !needsReviewOn ||
          group.sessions.some((session) =>
            sessionNeedsReview(session, annotations),
          ),
      )
      .filter(
        (group) =>
          !q ||
          group.runId.toLowerCase().includes(q) ||
          group.sessions.some((session) => matchesQuery(session, q)),
      )
      .map((group) => ({
        kind: "group" as const,
        group,
        sortTime: group.earliestStart,
      }));

    const standaloneItems: DisplayItem[] = sessions
      .filter((session) => !session.runId || session.runId.length === 0)
      .filter((session) =>
        matchesAdjudication(session, adjudicationFilter, annotations),
      )
      .filter(
        (session) => !needsReviewOn || sessionNeedsReview(session, annotations),
      )
      .filter((session) => !q || matchesQuery(session, q))
      .map((session) => ({
        kind: "session" as const,
        session,
        sortTime: session.startTime ?? 0,
      }));

    return [...groupItems, ...standaloneItems].sort(
      (a, b) => b.sortTime - a.sortTime,
    );
  }, [runGroups, sessions, annotations, adjudicationFilter, needsReviewOn, query]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 72,
    overscan: 8,
    initialRect: { width: 1024, height: 800 },
    getItemKey: (index) => {
      const item = items[index];
      return item.kind === "group"
        ? `run-${item.group.runId}`
        : `session-${item.session.sessionId}`;
    },
  });
  const virtualRows = virtualizer.getVirtualItems();

  const renderItem = (item: DisplayItem) =>
    item.kind === "group" ? (
      <RunGroupRow
        group={item.group}
        onToggle={() => toggleRunGroup(item.group.runId)}
        onSelectSession={onSelectSession}
      />
    ) : (
      <StandaloneSessionRow
        session={item.session}
        onSelect={() => onSelectSession(item.session.sessionId)}
      />
    );

  if (tracesLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-trace-muted text-sm">
        Loading runs...
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-5 text-center text-trace-muted text-sm">
        <div>
          {needsReviewOn
            ? "All caught up — no failed or partial runs in view are waiting on a verdict."
            : "No runs or traces found for the current filters."}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-2 border-b border-trace-border bg-trace-bg shrink-0">
        <button
          onClick={expandAllRunGroups}
          className="text-[11px] text-trace-muted hover:text-trace-text border border-trace-border rounded px-2 py-1 transition-colors"
        >
          Expand all
        </button>
        <button
          onClick={collapseAllRunGroups}
          className="text-[11px] text-trace-muted hover:text-trace-text border border-trace-border rounded px-2 py-1 transition-colors"
        >
          Collapse all
        </button>
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter runs & traces..."
          aria-label="Filter runs and traces"
          className="w-44 bg-trace-surface text-trace-text border border-trace-border rounded px-2 py-1 text-[11px] outline-none transition-colors focus:border-trace-accent placeholder:text-trace-dim"
        />
        <span className="ml-auto text-[10px] text-trace-dim">
          {formatCount(items.length)} rows from {formatCount(sessions.length)}
          {sessionsTotal > sessions.length
            ? ` / ${formatCount(sessionsTotal)}`
            : ""} traces
        </span>
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto scrollbar-thin">
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: "relative",
            width: "100%",
          }}
        >
          {virtualRows.map((virtualRow) => {
            const item = items[virtualRow.index];
            return (
              <div
                key={virtualRow.key}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {renderItem(item)}
              </div>
            );
          })}
          {virtualRows.length === 0 &&
            items.map((item) => (
              <div
                key={
                  item.kind === "group"
                    ? `run-${item.group.runId}`
                    : `session-${item.session.sessionId}`
                }
              >
                {renderItem(item)}
              </div>
            ))}
        </div>
      </div>
      {sessionsHasMore && onLoadMore && (
        <div className="shrink-0 border-t border-trace-border px-5 py-2 text-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadMorePending}
            className="rounded border border-trace-border px-3 py-1 text-[11px] text-trace-muted hover:border-trace-accent/40 hover:text-trace-text disabled:cursor-wait disabled:opacity-50"
          >
            {loadMorePending ? "Loading traces..." : "Load more traces"}
          </button>
        </div>
      )}
    </div>
  );
}

function RunGroupRow({
  group,
  onToggle,
  onSelectSession,
}: {
  group: RunGroup;
  onToggle: () => void;
  onSelectSession: (sessionId: string) => void;
}) {
  return (
    <div className="border-b border-trace-border/50">
      <button
        onClick={onToggle}
        className="w-full text-left px-5 py-3 hover:bg-trace-accent/[0.05] transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-trace-muted text-xs shrink-0">
            <ChevronRight
              size={14}
              className={`transition-transform ${group.expanded ? "rotate-90" : ""}`}
              aria-hidden="true"
            />
          </span>
          <span className="text-[11px] text-trace-muted shrink-0">
            {formatTime(group.earliestStart)}
          </span>
          <span className="font-mono text-[11px] text-trace-accent-light shrink-0">
            {group.shortId}
          </span>
          <span className="min-w-0 flex-1 text-[12px] text-trace-text">
            {truncate(extractQueryTitle(group.query).title, 80)}
          </span>
          <RunOutcomeStrip
            outcomes={group.sessions.map((session) => session.outcome)}
          />
          <Badge
            variant={
              outcomeClass(group.overallOutcome) as
                | "completed"
                | "stopped"
                | "error"
                | "max_turns"
            }
          >
            {group.overallOutcome}
          </Badge>
          <AdjudicationBadge session={{ runId: group.runId }} />
          <span className="text-[11px] text-trace-muted shrink-0">
            {formatCount(group.sessions.length)} traces
          </span>
          <span className="text-[11px] text-trace-muted shrink-0">
            {formatCount(group.totalTurns)} turns
          </span>
          <span className="text-[11px] text-trace-muted shrink-0">
            {formatDuration(group.latestEnd - group.earliestStart)}
          </span>
          <span className="text-[11px] text-trace-subtle font-mono shrink-0">
            {formatCost(group.totalCost) || "$0"}
          </span>
        </div>
      </button>
      {group.expanded && (
        <div className="pb-2">
          {group.sessions.map((session) => (
            <RunSessionRow
              key={session.sessionId}
              session={session}
              onSelect={() => onSelectSession(session.sessionId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// A session with no runId, shown as its own top-level row so every loaded
// trace is reachable from the Runs view.
function StandaloneSessionRow({
  session,
  onSelect,
}: {
  session: TraceSession;
  onSelect: () => void;
}) {
  const models = getSessionModels(session).map(shortModel).join(", ");
  return (
    <div className="border-b border-trace-border/50">
      <button
        onClick={onSelect}
        className="w-full text-left px-5 py-3 hover:bg-trace-accent/[0.05] transition-colors"
      >
        <div className="flex items-center gap-3">
          {/* Chevron slot kept empty so columns align with run rows. */}
          <span className="w-[14px] shrink-0" aria-hidden="true" />
          <span className="text-[11px] text-trace-muted shrink-0">
            {formatTime(session.startTime)}
          </span>
          <span className="font-mono text-[11px] text-trace-muted shrink-0">
            {session.sessionId.slice(0, 8)}
          </span>
          <span className="min-w-0 flex-1 text-[12px] text-trace-text">
            {truncate(extractQueryTitle(session.query).title, 80)}
          </span>
          <Badge
            variant={
              outcomeClass(session.outcome) as
                | "completed"
                | "stopped"
                | "error"
                | "max_turns"
            }
          >
            {session.outcome}
          </Badge>
          <AdjudicationBadge session={{ sessionId: session.sessionId }} />
          <span className="text-[11px] text-trace-muted shrink-0">
            {formatCount(session.turnCount || 0)} turns
          </span>
          <span className="text-[10px] text-trace-muted shrink-0">
            {models || "-"}
          </span>
        </div>
      </button>
    </div>
  );
}

function RunOutcomeStrip({ outcomes }: { outcomes: string[] }) {
  if (outcomes.length === 0) return null;
  return (
    <span
      className="hidden xl:flex h-2 w-20 overflow-hidden rounded border border-trace-border bg-trace-surface shrink-0"
      title={outcomes.join(" -> ")}
    >
      {outcomes.map((outcome, index) => (
        <span
          key={`${outcome}-${index}`}
          className={`h-full flex-1 ${
            outcome === "completed" || outcome === "success"
              ? "bg-state-success"
              : outcome === "stopped" || outcome === "max_turns"
                ? "bg-state-warning"
                : "bg-state-error"
          }`}
        />
      ))}
    </span>
  );
}

function RunSessionRow({
  session,
  onSelect,
}: {
  session: TraceSession;
  onSelect: () => void;
}) {
  const models = getSessionModels(session).map(shortModel).join(", ");
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className="w-full text-left ml-11 mr-5 px-4 py-2 rounded border border-transparent hover:border-trace-accent/20 hover:bg-trace-accent/[0.05] transition-colors"
    >
      <div className="flex items-center gap-3">
        <span className="text-[11px] text-trace-dim shrink-0">
          {formatTime(session.startTime)}
        </span>
        <span className="font-mono text-[10px] text-trace-muted shrink-0">
          {session.sessionId.slice(0, 8)}
        </span>
        <span className="min-w-0 flex-1 text-[12px] text-trace-subtle">
          {truncate(extractQueryTitle(session.query).title, 64)}
        </span>
        <span className="text-[10px] text-trace-muted shrink-0">
          {models || "-"}
        </span>
      </div>
    </div>
  );
}
