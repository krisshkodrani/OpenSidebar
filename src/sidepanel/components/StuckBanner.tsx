import React from "react";
import { AlertTriangle, X } from "lucide-react";
import { useStore } from "../store";

export function StuckBanner() {
  const stuckState = useStore((s) => s.stuckState);
  const clearStuckState = useStore((s) => s.clearStuckState);

  if (!stuckState) return null;

  const isEscalate = stuckState.signal === "escalate";

  return (
    <div
      role="alert"
      className={`mx-3 mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm border ${
        isEscalate
          ? "bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800"
          : "bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800"
      }`}
    >
      <AlertTriangle size={14} className="shrink-0" />
      <span className="flex-1 truncate">
        {isEscalate
          ? `Agent may be stuck (${stuckState.staleTurns} stale turns)`
          : `Agent making slow progress (${stuckState.staleTurns} stale turns)`}
      </span>
      <button
        onClick={clearStuckState}
        className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10"
      >
        <X size={14} />
      </button>
    </div>
  );
}
