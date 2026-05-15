import React, { useId, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useStore } from "../../store";
import { useDebounce } from "../../hooks/useDebounce";
import type { SessionLogEntry } from "../../store/types";
import LoadingSpinner from "../LoadingSpinner";

const LEVEL_COLORS: Record<string, string> = {
  DEBUG: "text-trace-dim",
  INFO: "text-trace-accent-light",
  WARN: "text-state-warning",
  ERROR: "text-state-error",
};

const LEVEL_BG: Record<string, string> = {
  DEBUG: "",
  INFO: "",
  WARN: "bg-state-warning/5",
  ERROR: "bg-state-error/5",
};

const SOURCE_COLORS: Record<string, string> = {
  background: "text-trace-accent-light",
  content: "text-state-success",
  sidepanel: "text-trace-accent-light",
  offscreen: "text-state-warning",
};

function formatTs(ts: string): string {
  try {
    const d = new Date(ts);
    return (
      d.toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }) +
      "." +
      String(d.getMilliseconds()).padStart(3, "0")
    );
  } catch {
    return ts;
  }
}

function LogRow({ entry }: { entry: SessionLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const dataId = useId();
  const hasData = entry.data && Object.keys(entry.data).length > 0;
  const rowClass = `flex w-full gap-2 px-3 py-0.5 text-left ${hasData ? "cursor-pointer" : ""}`;
  const rowContent = (
    <>
      <span className="text-trace-dim shrink-0 w-[85px]">
        {formatTs(entry.ts)}
      </span>
      <span
        className={`shrink-0 w-[38px] font-bold ${LEVEL_COLORS[entry.lvl] || "text-trace-muted"}`}
      >
        {entry.lvl}
      </span>
      <span
        className={`shrink-0 w-[80px] ${SOURCE_COLORS[entry.src] || "text-trace-muted"}`}
      >
        {entry.src}
      </span>
      <span className="shrink-0 w-[80px] text-trace-muted">{entry.cat}</span>
      <span className="text-trace-text truncate flex-1">{entry.msg}</span>
      {hasData && (
        <span className="text-trace-dim shrink-0">
          <ChevronRight
            size={13}
            className={`transition-transform ${expanded ? "rotate-90" : ""}`}
            aria-hidden="true"
          />
        </span>
      )}
    </>
  );

  return (
    <div
      className={`font-mono text-[11px] leading-[18px] border-b border-trace-border/40 hover:bg-trace-panel/50 ${LEVEL_BG[entry.lvl] || ""}`}
    >
      {hasData ? (
        <button
          type="button"
          className={rowClass}
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls={dataId}
        >
          {rowContent}
        </button>
      ) : (
        <div className={rowClass}>{rowContent}</div>
      )}
      {expanded && entry.data && (
        <pre
          id={dataId}
          className="px-3 py-1.5 ml-0 sm:ml-[285px] text-[10px] text-trace-subtle bg-trace-bg/60 rounded mb-1 overflow-x-auto max-h-[300px] whitespace-pre-wrap break-all scrollbar-thin"
        >
          {JSON.stringify(entry.data, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function LogList() {
  const sessionLogs = useStore((s) => s.sessionLogs);
  const sessionLogsLoading = useStore((s) => s.sessionLogsLoading);
  const [levelFilter, setLevelFilter] = useState("all");
  const [catFilter, setCatFilter] = useState("all");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 200);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const log of sessionLogs) cats.add(log.cat);
    return Array.from(cats).sort();
  }, [sessionLogs]);

  const filtered = useMemo(() => {
    let logs = sessionLogs;
    if (levelFilter !== "all") {
      logs = logs.filter((l) => l.lvl === levelFilter);
    }
    if (catFilter !== "all") {
      logs = logs.filter((l) => l.cat === catFilter);
    }
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      logs = logs.filter(
        (l) =>
          l.msg.toLowerCase().includes(q) ||
          l.cat.toLowerCase().includes(q) ||
          (l.data && JSON.stringify(l.data).toLowerCase().includes(q)),
      );
    }
    return logs;
  }, [sessionLogs, levelFilter, catFilter, debouncedSearch]);

  if (sessionLogsLoading) {
    return <LoadingSpinner message="Loading logs..." />;
  }

  if (sessionLogs.length === 0) {
    return (
      <div className="py-10 px-4 text-center text-trace-muted text-[13px]">
        No logs for this session.
        <br />
        <span className="text-trace-dim text-[11px]">
          Logs are correlated when the log drain server is running during agent
          execution.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Filter bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-trace-border shrink-0 bg-trace-panel/50">
        <select
          aria-label="Filter logs by level"
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          className="bg-trace-bg text-trace-text border border-trace-border rounded px-2 py-1 text-[11px] outline-none focus:border-trace-accent"
        >
          <option value="all">All Levels</option>
          <option value="DEBUG">DEBUG</option>
          <option value="INFO">INFO</option>
          <option value="WARN">WARN</option>
          <option value="ERROR">ERROR</option>
        </select>
        <select
          aria-label="Filter logs by category"
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          className="bg-trace-bg text-trace-text border border-trace-border rounded px-2 py-1 text-[11px] outline-none focus:border-trace-accent"
        >
          <option value="all">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          type="text"
          aria-label="Search logs"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search logs..."
          className="flex-1 bg-trace-bg text-trace-text border border-trace-border rounded px-2 py-1 text-[11px] outline-none focus:border-trace-accent placeholder:text-trace-dim"
        />
        <span className="text-[10px] text-trace-muted shrink-0">
          {filtered.length}/{sessionLogs.length}
        </span>
      </div>

      {/* Header row */}
      <div className="flex gap-2 px-3 py-1 text-[10px] font-semibold text-trace-muted uppercase tracking-wider border-b border-trace-border bg-trace-panel/30 shrink-0">
        <span className="w-[85px]">Time</span>
        <span className="w-[38px]">Level</span>
        <span className="w-[80px]">Source</span>
        <span className="w-[80px]">Category</span>
        <span className="flex-1">Message</span>
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {filtered.map((entry, i) => (
          <LogRow key={i} entry={entry} />
        ))}
      </div>
    </div>
  );
}
