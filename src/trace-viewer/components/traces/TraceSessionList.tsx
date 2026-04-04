import React, { useRef, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useStore } from "../../store";
import type { TraceSession } from "../../../types/traces";
import type { RunGroup } from "../../store/types";
import TraceSessionItem from "./TraceSessionItem";
import RunGroupHeader from "./RunGroupHeader";
import RunGroupSummary from "./RunGroupSummary";
import LoadingSpinner from "../LoadingSpinner";

const SESSION_ROW_HEIGHT = 72;
const GROUP_HEADER_HEIGHT = 80;
const GROUP_SUMMARY_HEIGHT = 64;
const GROUP_FOOTER_HEIGHT = 1;

type ListItem =
  | { kind: "group"; group: RunGroup; sortTime: number }
  | {
      kind: "session";
      session: TraceSession;
      indented: boolean;
      sortTime: number;
    }
  | { kind: "group-summary"; group: RunGroup; sortTime: number }
  | { kind: "group-footer"; runId: string; sortTime: number };

export default function TraceSessionList() {
  const sessions = useStore((s) => s.sessions);
  const runGroups = useStore((s) => s.runGroups);
  const currentSessionId = useStore((s) => s.currentSessionId);
  const setCurrentSessionId = useStore((s) => s.setCurrentSessionId);
  const setCurrentEntries = useStore((s) => s.setCurrentEntries);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const setActiveSubview = useStore((s) => s.setActiveSubview);
  const toggleRunGroup = useStore((s) => s.toggleRunGroup);
  const tracesLoading = useStore((s) => s.tracesLoading);

  const parentRef = useRef<HTMLDivElement>(null);

  // Build flat render list interleaving group headers and sessions
  const flatItems = useMemo(() => {
    // Collect session IDs that belong to any run group
    const grouped = new Set<string>();
    for (const g of runGroups) {
      for (const s of g.sessions) {
        grouped.add(s.sessionId);
      }
    }

    // Build top-level items: groups (by latestEnd) + standalone sessions
    const topLevel: Array<
      | { kind: "group"; group: RunGroup; sortTime: number }
      | {
          kind: "session";
          session: TraceSession;
          indented: false;
          sortTime: number;
        }
    > = [];

    for (const g of runGroups) {
      topLevel.push({ kind: "group", group: g, sortTime: g.latestEnd });
    }

    for (const s of sessions) {
      if (!grouped.has(s.sessionId)) {
        topLevel.push({
          kind: "session",
          session: s,
          indented: false,
          sortTime: s.startTime ?? 0,
        });
      }
    }

    // Sort descending by time
    topLevel.sort((a, b) => {
      const dt = b.sortTime - a.sortTime;
      if (dt !== 0) return dt;
      if (a.kind === "group" && b.kind !== "group") return -1;
      if (b.kind === "group" && a.kind !== "group") return 1;
      return 0;
    });

    // Flatten: insert expanded children after their group header
    const result: ListItem[] = [];
    for (const item of topLevel) {
      result.push(item);
      if (item.kind === "group" && item.group.expanded) {
        // Summary row
        result.push({
          kind: "group-summary",
          group: item.group,
          sortTime: 0,
        });
        // Child sessions
        for (const s of item.group.sessions) {
          result.push({
            kind: "session",
            session: s,
            indented: true,
            sortTime: s.startTime ?? 0,
          });
        }
        // Closing line
        result.push({
          kind: "group-footer",
          runId: item.group.runId,
          sortTime: 0,
        });
      }
    }

    return result;
  }, [sessions, runGroups]);

  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => {
      const k = flatItems[i]?.kind;
      return k === "group"
        ? GROUP_HEADER_HEIGHT
        : k === "group-summary"
          ? GROUP_SUMMARY_HEIGHT
          : k === "group-footer"
            ? GROUP_FOOTER_HEIGHT
            : SESSION_ROW_HEIGHT;
    },
    overscan: 10,
  });

  const selectSession = (sessionId: string) => {
    if (currentSessionId === sessionId) return;
    setCurrentSessionId(sessionId);
    setCurrentEntries([]);
    setSearchQuery("");
    setActiveSubview("turns");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const container = parentRef.current;
    if (!container) return;
    const items = container.querySelectorAll<HTMLElement>("[role=option]");
    const focused = document.activeElement as HTMLElement;
    const idx = Array.from(items).indexOf(focused);
    if (e.key === "ArrowDown" && idx < items.length - 1)
      items[idx + 1]?.focus();
    else if (e.key === "ArrowUp" && idx > 0) items[idx - 1]?.focus();
    else if (e.key === "ArrowDown" && idx === -1) items[0]?.focus();
  };

  if (tracesLoading) return <LoadingSpinner message="Loading sessions..." />;

  if (flatItems.length === 0) {
    return (
      <div className="py-10 px-4 text-center text-trace-muted text-[13px]">
        No trace sessions found.
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      role="listbox"
      onKeyDown={handleKeyDown}
      className="flex-1 overflow-y-auto scrollbar-thin"
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = flatItems[virtualRow.index];
          let key: string;
          let content: React.ReactNode;

          if (item.kind === "group") {
            key = `group-${item.group.runId}`;
            content = (
              <RunGroupHeader
                group={item.group}
                onToggle={() => toggleRunGroup(item.group.runId)}
              />
            );
          } else if (item.kind === "group-summary") {
            key = `summary-${item.group.runId}`;
            content = <RunGroupSummary group={item.group} />;
          } else if (item.kind === "group-footer") {
            key = `footer-${item.runId}`;
            content = <div className="ml-4 h-px bg-trace-accent/15 mr-4" />;
          } else {
            key = `session-${item.session.sessionId}`;
            content = item.indented ? (
              <div className="ml-4 border-l-2 border-trace-accent/25 pl-3 bg-[rgba(13,148,136,0.03)]">
                <TraceSessionItem
                  session={item.session}
                  isActive={item.session.sessionId === currentSessionId}
                  onClick={() => selectSession(item.session.sessionId)}
                />
              </div>
            ) : (
              <TraceSessionItem
                session={item.session}
                isActive={item.session.sessionId === currentSessionId}
                onClick={() => selectSession(item.session.sessionId)}
              />
            );
          }

          return (
            <div
              key={key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
