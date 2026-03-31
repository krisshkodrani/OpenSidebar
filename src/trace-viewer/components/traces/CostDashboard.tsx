import React, { useState } from "react";
import type { TraceSession } from "../../../types/traces";
import { formatCost } from "../../utils";
import * as api from "../../api";

interface CostDashboardProps {
  sessions: TraceSession[];
  onDeleted?: () => void;
}

export default function CostDashboard({
  sessions,
  onDeleted,
}: CostDashboardProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (sessions.length === 0) return null;

  let totalCost = 0;
  let totalTurns = 0;

  for (const s of sessions) {
    totalTurns += s.turnCount || 0;
    const cost = s.metrics?.totalCost ?? 0;
    totalCost += cost;
  }

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
    <div className="px-3 py-2 bg-[#0f0d0a] border-b-2 border-trace-accent/40 shrink-0">
      <div className="flex items-center gap-2 text-[11px]">
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
