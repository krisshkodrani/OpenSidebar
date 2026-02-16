import React, { useCallback } from "react";
import { RotateCcw, X } from "lucide-react";
import { MessageSource } from "../../types";
import { useStore } from "../store";

export function RecoveryBanner() {
  const taskRecovery = useStore((s) => s.taskRecovery);
  const clearTaskRecovery = useStore((s) => s.clearTaskRecovery);

  const stopRecoveredTask = useCallback(async () => {
    if (!taskRecovery) return;
    try {
      await chrome.runtime.sendMessage({
        type: "STOP_AGENT",
        requestId: crypto.randomUUID(),
        source: MessageSource.SIDEPANEL,
        payload: {
          workspaceId: taskRecovery.workspaceId,
        },
      });
    } catch {
      // no-op
    } finally {
      clearTaskRecovery();
    }
  }, [clearTaskRecovery, taskRecovery]);

  if (!taskRecovery) return null;

  return (
    <div
      role="status"
      className="mx-3 mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm border bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800"
    >
      <RotateCcw size={14} className="shrink-0" />
      <span className="flex-1 truncate">
        Recovered task: {taskRecovery.completedSubtasks}/{taskRecovery.totalSubtasks} completed, {taskRecovery.pendingSubtasks} pending
      </span>
      <button
        onClick={stopRecoveredTask}
        className="px-2 py-0.5 rounded text-xs font-medium border border-blue-300 dark:border-blue-700 hover:bg-black/10 dark:hover:bg-white/10"
      >
        Stop
      </button>
      <button
        onClick={clearTaskRecovery}
        className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10"
      >
        <X size={14} />
      </button>
    </div>
  );
}
