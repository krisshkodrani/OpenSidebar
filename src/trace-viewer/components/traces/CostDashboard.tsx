import React, { useState } from "react";
import type { TraceSession } from "../../../types/traces";
import type { RunGroup } from "../../store/types";
import { useStore } from "../../store";
import { formatCost } from "../../utils";
import * as api from "../../api";

interface CostDashboardProps {
  sessions: TraceSession[];
  runGroups: RunGroup[];
  onDeleted?: () => void;
}

export default function CostDashboard({
  sessions,
  runGroups,
  onDeleted,
}: CostDashboardProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const expandAll = useStore((s) => s.expandAllRunGroups);
  const collapseAll = useStore((s) => s.collapseAllRunGroups);

  if (sessions.length === 0) return null;

  let totalCost = 0;
  let totalTurns = 0;

  for (const s of sessions) {
    totalTurns += s.turnCount || 0;
    const cost = s.metrics?.totalCost ?? 0;
    totalCost += cost;
  }

  const anyExpanded = runGroups.some((g) => g.expanded);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteAllTraces();
      setConfirming(false);
      onDeleted?.();
    } catch (err) {
      console.error("Failed to delete traces:", err);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="px-3 py-2.5 bg-[linear-gradient(180deg,rgba(15,13,10,0.85),rgba(15,13,10,0.55))] border-b border-trace-accent/20 shrink-0">
      <div className="flex items-center gap-2 text-[11px]">
        {runGroups.length > 0 && (
          <>
            <span className="text-[10px] font-bold uppercase tracking-widest text-trace-accent-light">
              Runs
            </span>
            <span className="text-trace-muted">
              <span className="font-semibold text-trace-subtle">
                {runGroups.length}
              </span>
            </span>
            <span className="text-trace-dim">&middot;</span>
          </>
        )}
        <span className="text-[10px] font-bold uppercase tracking-widest text-trace-accent-light">
          Sessions
        </span>
        <span className="text-trace-muted">
          <span className="font-semibold text-trace-subtle">
            {sessions.length}
          </span>
        </span>
        <span className="text-trace-dim">&middot;</span>
        <span className="text-trace-muted">
          <span className="font-semibold text-trace-subtle">{totalTurns}</span>{" "}
          turns
        </span>
        {totalCost > 0 && (
          <>
            <span className="text-trace-dim">&middot;</span>
            <span className="text-trace-muted font-mono">
              {formatCost(totalCost)}
            </span>
          </>
        )}
        <span className="flex-1" />
        {runGroups.length > 0 && (
          <button
            onClick={anyExpanded ? collapseAll : expandAll}
            className="px-1.5 py-0.5 text-[10px] text-trace-muted hover:text-trace-accent-light transition-colors"
            title={anyExpanded ? "Collapse all runs" : "Expand all runs"}
          >
            {anyExpanded ? "Collapse all" : "Expand all"}
          </button>
        )}
        {confirming ? (
          <span className="flex items-center gap-1.5">
            <span className="text-red-400 text-[10px]">Delete all?</span>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-red-500/80 hover:bg-red-500 text-white transition-colors disabled:opacity-50"
            >
              {deleting ? "..." : "Yes"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={deleting}
              className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-trace-border hover:bg-trace-dim text-trace-subtle transition-colors disabled:opacity-50"
            >
              No
            </button>
          </span>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="px-1.5 py-0.5 text-[10px] text-trace-muted hover:text-red-400 transition-colors"
            title="Delete all traces"
          >
            Delete all
          </button>
        )}
      </div>
    </div>
  );
}
