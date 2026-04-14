import React, { useEffect, useState, useCallback } from "react";
import {
  fetchBackendHealth,
  fetchMemoryList,
  fetchMemorySearch,
  fetchMemoryDetail,
  fetchScheduledTasks,
  deleteMemory,
  deleteScheduledTask,
  type BackendHealth,
  type BackendMemoryRecord,
  type BackendMemoryDetail,
  type BackendScheduledTask,
} from "../api";
import LoadingSpinner from "./LoadingSpinner";
import ErrorBanner from "./ErrorBanner";

type Tab = "memory" | "tasks";

export default function BackendPanel() {
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [offline, setOffline] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("memory");

  const loadHealth = useCallback(async () => {
    try {
      const h = await fetchBackendHealth();
      setHealth(h);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  if (offline) {
    return (
      <div className="flex-1 px-5 py-8">
        <ErrorBanner
          message="Backend service is offline"
          hint="Start it with npm run backend (port 7590)"
          onRetry={loadHealth}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Health bar */}
      {health && (
        <div className="shrink-0 flex items-center gap-4 px-5 py-2.5 border-b border-trace-border bg-trace-panel">
          <StatusDot connected={health.gbrainConnected} />
          <Stat label="Status" value={health.status} />
          <Stat label="Memory Pages" value={String(health.memoryStats?.pageCount ?? 0)} />
          <Stat label="Pending Tasks" value={String(health.pendingTasks)} />
          <Stat label="Uptime" value={formatUptime(health.uptime)} />
        </div>
      )}

      {/* Tab toggle */}
      <div className="flex gap-0.5 px-5 pt-2 bg-trace-panel border-b border-trace-border shrink-0">
        {(["memory", "tasks"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 text-xs font-semibold border-b-2 cursor-pointer transition-colors capitalize ${
              activeTab === tab
                ? "text-trace-accent-light border-trace-accent"
                : "text-trace-muted border-transparent hover:text-[#4C3D80]"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {activeTab === "memory" ? (
          <MemoryTab />
        ) : (
          <TasksTab onChanged={loadHealth} />
        )}
      </div>
    </div>
  );
}

// ── Memory Tab ──────────────────────────────────────────────

function MemoryTab() {
  const [records, setRecords] = useState<BackendMemoryRecord[]>([]);
  const [searchResults, setSearchResults] = useState<BackendMemoryDetail[] | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detailBySlug, setDetailBySlug] = useState<Record<string, BackendMemoryDetail>>({});
  const [loadingDetailSlug, setLoadingDetailSlug] = useState<string | null>(null);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMemoryList();
      setRecords(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    setLoading(true);
    try {
      const results = await fetchMemorySearch(searchQuery.trim());
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  const handleExpand = useCallback(async (slug: string) => {
    if (expanded === slug) {
      setExpanded(null);
      setLoadingDetailSlug(null);
      return;
    }
    setExpanded(slug);
    if (detailBySlug[slug]) {
      setLoadingDetailSlug(null);
      return;
    }
    setLoadingDetailSlug(slug);
    try {
      const detail = await fetchMemoryDetail(slug);
      setDetailBySlug((prev) => ({ ...prev, [slug]: detail }));
    } catch {
      setDetailBySlug((prev) => {
        const next = { ...prev };
        delete next[slug];
        return next;
      });
    } finally {
      setLoadingDetailSlug((current) => (current === slug ? null : current));
    }
  }, [detailBySlug, expanded]);

  const handleDelete = useCallback(async (slug: string) => {
    await deleteMemory(slug);
    setRecords((prev) => prev.filter((r) => r.slug !== slug));
    if (searchResults) {
      setSearchResults((prev) => prev?.filter((r) => r.slug !== slug) ?? null);
    }
    setDetailBySlug((prev) => {
      const next = { ...prev };
      delete next[slug];
      return next;
    });
    if (expanded === slug) {
      setExpanded(null);
      setLoadingDetailSlug(null);
    }
  }, [expanded, searchResults]);

  if (loading && records.length === 0) {
    return <div className="px-5 py-4"><LoadingSpinner message="Loading memories..." /></div>;
  }

  if (error) {
    return <div className="px-5 py-4"><ErrorBanner message={error} onRetry={loadRecords} /></div>;
  }

  const displayItems = searchResults ?? records;

  return (
    <div className="px-5 py-4">
      {/* Search */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="Search memories (semantic)..."
          className="flex-1 px-3 py-1.5 text-xs bg-trace-bg border border-trace-border rounded text-trace-text placeholder:text-trace-dim focus:outline-none focus:border-trace-accent/50"
        />
        <button
          onClick={handleSearch}
          className="px-3 py-1.5 text-xs font-semibold text-trace-accent-light bg-trace-accent/10 border border-trace-accent/30 rounded hover:bg-trace-accent/20 transition-colors"
        >
          Search
        </button>
        {searchResults && (
          <button
            onClick={() => { setSearchResults(null); setSearchQuery(""); }}
            className="px-3 py-1.5 text-xs text-trace-muted border border-trace-border rounded hover:text-trace-text transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {searchResults && (
        <div className="text-[10px] text-trace-muted mb-3">
          {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} for &ldquo;{searchQuery}&rdquo;
        </div>
      )}

      {/* Records */}
      {displayItems.length === 0 ? (
        <div className="text-center py-12 text-trace-muted text-xs">
          {searchResults ? "No matching memories found." : "No memories stored yet. Memories are created as the agent completes tasks."}
        </div>
      ) : (
        <div className="space-y-2">
          {displayItems.map((item) => {
            const slug = "slug" in item ? item.slug : "";
            const title = "title" in item ? item.title : slug;
            const score = "score" in item ? (item as BackendMemoryDetail).score : undefined;
            const isExpanded = expanded === slug;
            const detail = detailBySlug[slug];
            const isLoadingDetail = loadingDetailSlug === slug;

            return (
              <div key={slug} className="border border-trace-border rounded bg-trace-panel">
                <div
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-trace-bg/50 transition-colors"
                  onClick={() => handleExpand(slug)}
                >
                  <span className="text-[10px] text-trace-dim">{isExpanded ? "v" : ">"}</span>
                  <span className="text-xs text-trace-text flex-1 truncate">{title}</span>
                  {score !== undefined && (
                    <span className="text-[10px] text-trace-dim font-mono">
                      score: {score.toFixed(3)}
                    </span>
                  )}
                  <CategoryBadge slug={slug} />
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(slug); }}
                    className="text-[10px] text-trace-dim hover:text-red-400 transition-colors px-1"
                    title="Delete memory"
                  >
                    x
                  </button>
                </div>
                {isExpanded && (
                  <div className="px-3 pb-3 border-t border-trace-border">
                    {isLoadingDetail && !detail ? (
                      <div className="mt-2 text-[11px] text-trace-dim">
                        Loading memory details...
                      </div>
                    ) : detail ? (
                      <pre className="text-[11px] text-trace-subtle whitespace-pre-wrap mt-2 leading-relaxed">
                        {detail.content}
                      </pre>
                    ) : (
                      <div className="mt-2 text-[11px] text-trace-dim">
                        Failed to load memory details.
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Tasks Tab ───────────────────────────────────────────────

function TasksTab({ onChanged }: { onChanged: () => void }) {
  const [tasks, setTasks] = useState<BackendScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchScheduledTasks();
      setTasks(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteScheduledTask(id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
    onChanged();
  }, [onChanged]);

  if (loading && tasks.length === 0) {
    return <div className="px-5 py-4"><LoadingSpinner message="Loading tasks..." /></div>;
  }

  if (error) {
    return <div className="px-5 py-4"><ErrorBanner message={error} onRetry={loadTasks} /></div>;
  }

  if (tasks.length === 0) {
    return (
      <div className="px-5 py-12 text-center text-trace-muted text-xs">
        No scheduled tasks. Ask the agent to schedule something, e.g. &ldquo;check this page every morning at 9am&rdquo;.
      </div>
    );
  }

  return (
    <div className="px-5 py-4">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-trace-muted border-b border-trace-border">
            <th className="py-2 pr-3">Description</th>
            <th className="py-2 pr-3">Schedule</th>
            <th className="py-2 pr-3">Next Run</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3">Last Result</th>
            <th className="py-2 w-8"></th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id} className="border-b border-trace-border/50 hover:bg-trace-bg/50">
              <td className="py-2 pr-3 text-trace-text max-w-[240px] truncate" title={task.query}>
                {task.description}
              </td>
              <td className="py-2 pr-3 font-mono text-trace-muted">
                {task.schedule ?? "one-shot"}
              </td>
              <td className="py-2 pr-3 text-trace-muted">
                {task.runAt ? new Date(task.runAt).toLocaleString() : "-"}
              </td>
              <td className="py-2 pr-3">
                <TaskStatusBadge status={task.status} />
              </td>
              <td className="py-2 pr-3 text-trace-dim max-w-[180px] truncate" title={task.result ?? ""}>
                {task.result ?? "-"}
              </td>
              <td className="py-2">
                <button
                  onClick={() => handleDelete(task.id)}
                  className="text-[10px] text-trace-dim hover:text-red-400 transition-colors"
                  title="Delete task"
                >
                  x
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Shared components ───────────────────────────────────────

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={`w-2 h-2 rounded-full ${connected ? "bg-green-400" : "bg-yellow-400"}`}
      />
      <span className="text-[10px] text-trace-muted">
        GBrain {connected ? "connected" : "degraded"}
      </span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-trace-dim">{label}:</span>
      <span className="text-[10px] font-semibold text-trace-text">{value}</span>
    </div>
  );
}

function CategoryBadge({ slug }: { slug: string }) {
  const match = slug.match(/^agent-mem-(.+)-[a-f0-9]{8}$/);
  const category = match?.[1] ?? "unknown";
  const colors: Record<string, string> = {
    "execution-result": "bg-blue-500/10 text-blue-400 border-blue-500/20",
    "user-preference": "bg-purple-500/10 text-purple-400 border-purple-500/20",
    "site-knowledge": "bg-green-500/10 text-green-400 border-green-500/20",
    "learned-pattern": "bg-amber-500/10 text-amber-400 border-amber-500/20",
  };
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded border ${colors[category] ?? "bg-gray-500/10 text-gray-400 border-gray-500/20"}`}>
      {category}
    </span>
  );
}

function TaskStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    running: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    completed: "bg-green-500/10 text-green-400 border-green-500/20",
    failed: "bg-red-500/10 text-red-400 border-red-500/20",
    cancelled: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  };
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded border ${colors[status] ?? colors.cancelled}`}>
      {status}
    </span>
  );
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
