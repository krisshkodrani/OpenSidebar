import React, { useEffect, useState, useCallback } from "react";
import {
  fetchBackendHealth,
  fetchDurableRunDetail,
  fetchDurableRuns,
  requestDurableRunResume,
  requestDurableRunStop,
  type BackendHealth,
  type BackendDurableRunDetail,
  type BackendDurableRunSummary,
} from "../api";
import LoadingSpinner from "./LoadingSpinner";
import ErrorBanner from "./ErrorBanner";

function formatProgressPayload(payload: unknown): string {
  if (Array.isArray(payload)) {
    return payload.map((item) => String(item)).join(" | ");
  }
  if (payload && typeof payload === "object") {
    return Object.entries(payload as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(" | ");
  }
  return String(payload ?? "");
}

export default function BackendPanel() {
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [offline, setOffline] = useState(false);

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
          hint="Start it with pnpm run dev or pnpm run logs"
          onRetry={loadHealth}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Health bar */}
      {health && (
        <div className="shrink-0 flex items-center gap-x-4 gap-y-1 px-5 py-1.5 border-b border-trace-border bg-trace-panel flex-wrap">
          <StatusDot connected={health.status === "ok"} />
          <Stat label="Status" value={health.status} />
          <Stat label="Uptime" value={formatUptime(health.uptime)} />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        <DurableRunsTab />
      </div>
    </div>
  );
}

function DurableRunsTab() {
  const [runs, setRuns] = useState<BackendDurableRunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BackendDurableRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDurableRuns({ includeProgressSummary: true });
      setRuns(data);
      if (!selectedRunId && data[0]?.id) {
        setSelectedRunId(data[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedRunId]);

  const loadDetail = useCallback(async (runId: string) => {
    setLoadingDetail(true);
    try {
      const nextDetail = await fetchDurableRunDetail(runId);
      setDetail(nextDetail);
    } catch {
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (selectedRunId) {
      loadDetail(selectedRunId);
    } else {
      setDetail(null);
    }
  }, [loadDetail, selectedRunId]);

  const handleResume = useCallback(
    async (runId: string) => {
      await requestDurableRunResume(runId);
      await loadRuns();
      if (selectedRunId === runId) await loadDetail(runId);
    },
    [loadDetail, loadRuns, selectedRunId],
  );

  const handleStop = useCallback(
    async (runId: string) => {
      await requestDurableRunStop(runId);
      await loadRuns();
      if (selectedRunId === runId) await loadDetail(runId);
    },
    [loadDetail, loadRuns, selectedRunId],
  );

  if (loading && runs.length === 0) {
    return (
      <div className="px-5 py-4">
        <LoadingSpinner message="Loading durable runs..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-5 py-4">
        <ErrorBanner message={error} onRetry={loadRuns} />
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="px-5 py-12 text-center text-trace-muted text-xs">
        No active durable runs. Completed and stopped runs are hidden by
        default.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(260px,340px)_1fr] gap-4 px-5 py-4">
      <div className="space-y-2">
        {runs.map((run) => {
          const selected = run.id === selectedRunId;
          return (
            <button
              key={run.id}
              onClick={() => setSelectedRunId(run.id)}
              className={`w-full rounded border px-3 py-2 text-left transition-colors ${
                selected
                  ? "border-trace-accent bg-trace-accent/10"
                  : "border-trace-border bg-trace-panel hover:bg-trace-bg/50"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium text-trace-text">
                  {run.query}
                </span>
                <TaskStatusBadge status={run.status} />
              </div>
              <div className="mt-1 text-[10px] text-trace-muted">
                {run.workspaceId} · updated{" "}
                {new Date(run.updatedAt).toLocaleTimeString()}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-trace-dim">
                {run.nodeCounts ? (
                  <span>
                    {run.nodeCounts.completed}/
                    {Object.values(run.nodeCounts).reduce(
                      (sum, value) => sum + value,
                      0,
                    )}{" "}
                    nodes
                  </span>
                ) : null}
                {run.pendingInteraction?.active ? (
                  <span>{run.pendingInteraction.kind} pending</span>
                ) : null}
                {run.progressSummary?.reviewedItemCount != null ? (
                  <span>{run.progressSummary.reviewedItemCount} reviewed</span>
                ) : null}
                {run.stopRequestedAt ? <span>stop requested</span> : null}
                {run.resumeRequestedAt ? <span>resume requested</span> : null}
              </div>
            </button>
          );
        })}
      </div>

      <div className="rounded border border-trace-border bg-trace-panel p-4">
        {!selectedRunId ? (
          <div className="text-xs text-trace-muted">Select a durable run.</div>
        ) : loadingDetail ? (
          <LoadingSpinner message="Loading durable run detail..." />
        ) : !detail ? (
          <div className="text-xs text-trace-muted">
            Failed to load durable run detail.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-trace-text">
                  {detail.run.query}
                </div>
                <div className="mt-1 text-[11px] text-trace-muted">
                  {detail.run.workspaceId} ·{" "}
                  {detail.run.lastResumeSource ?? "no resume yet"}
                  {detail.run.lastKnownResumeSafe != null
                    ? ` · last known resume ${detail.run.lastKnownResumeSafe ? "safe" : "unsafe"}`
                    : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void handleResume(detail.run.id)}
                  className="rounded border border-trace-accent/40 px-3 py-1.5 text-xs font-medium text-trace-accent-light hover:bg-trace-accent/10"
                >
                  Request resume
                </button>
                <button
                  onClick={() => void handleStop(detail.run.id)}
                  className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
                >
                  Request stop
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-[11px]">
              <DetailStat label="Status" value={detail.run.status} />
              <DetailStat label="Workspace" value={detail.run.workspaceId} />
              <DetailStat
                label="Updated"
                value={new Date(detail.run.updatedAt).toLocaleString()}
              />
              <DetailStat
                label="Pending interaction"
                value={
                  detail.pendingInteraction
                    ? `${detail.pendingInteraction.kind} (${detail.pendingInteraction.status})`
                    : "none"
                }
              />
            </div>

            <div>
              <div className="mb-2 text-[10px] uppercase tracking-wider text-trace-muted">
                Nodes
              </div>
              <div className="space-y-2">
                {detail.nodes.map((node) => (
                  <div
                    key={node.nodeId}
                    className="rounded border border-trace-border/70 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-trace-text">
                        {node.description}
                      </span>
                      <TaskStatusBadge status={node.status} />
                    </div>
                    <div className="mt-1 text-[11px] text-trace-muted">
                      {node.successCriteria}
                    </div>
                    {node.result ? (
                      <div className="mt-1 text-[11px] text-trace-dim">
                        {node.result}
                      </div>
                    ) : null}
                    {node.error ? (
                      <div className="mt-1 text-[11px] text-state-error">
                        {node.error}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 text-[10px] uppercase tracking-wider text-trace-muted">
                Structured Progress
              </div>
              {detail.progress.length === 0 ? (
                <div className="text-[11px] text-trace-muted">
                  No structured progress recorded.
                </div>
              ) : (
                <div className="space-y-2">
                  {detail.progress.map((entry) => (
                    <div
                      key={`${entry.key}:${entry.updatedAt}`}
                      className="rounded border border-trace-border/70 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-trace-text">
                          {entry.key}
                        </span>
                        <span className="text-[10px] uppercase tracking-wide text-trace-muted">
                          {entry.kind}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-trace-dim">
                        {formatProgressPayload(entry.payload)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="mb-2 text-[10px] uppercase tracking-wider text-trace-muted">
                Recent Side Effects
              </div>
              {detail.recentSideEffects.length === 0 ? (
                <div className="text-[11px] text-trace-muted">
                  No recent side effects.
                </div>
              ) : (
                <div className="space-y-2">
                  {detail.recentSideEffects.map((effect) => (
                    <div
                      key={effect.id}
                      className="rounded border border-trace-border/70 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-trace-text">
                          {effect.toolName}
                        </span>
                        <span className="text-[10px] text-trace-muted">
                          {new Date(effect.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-trace-dim">
                        {effect.result}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tasks Tab ───────────────────────────────────────────────

// ── Shared components ───────────────────────────────────────

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={`w-2 h-2 rounded-full ${connected ? "bg-state-success" : "bg-state-warning"}`}
      />
      <span className="text-[10px] text-trace-muted">
        Backend service {connected ? "available" : "degraded"}
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

function TaskStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    planning:
      "bg-trace-accent/10 text-trace-accent-light border-trace-accent/25",
    pending: "bg-state-warning/10 text-state-warning border-state-warning/25",
    running:
      "bg-trace-accent/10 text-trace-accent-light border-trace-accent/25",
    completed: "bg-state-success/10 text-state-success border-state-success/25",
    failed: "bg-state-error/10 text-state-error border-state-error/25",
    stopped: "bg-trace-bg text-trace-muted border-trace-border",
    cancelled: "bg-trace-bg text-trace-muted border-trace-border",
  };
  return (
    <span
      className={`text-[9px] px-1.5 py-0.5 rounded border ${colors[status] ?? colors.cancelled}`}
    >
      {status}
    </span>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-trace-border/70 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-trace-muted">
        {label}
      </div>
      <div className="mt-1 text-xs text-trace-text">{value}</div>
    </div>
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
