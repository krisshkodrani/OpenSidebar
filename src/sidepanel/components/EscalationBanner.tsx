import React, { useCallback } from "react";
import { AlertOctagon } from "lucide-react";
import { EscalationOptionId, MessageSource } from "../../types";
import { logger } from "../../utils";
import { useStore } from "../store";

export function EscalationBanner() {
  const pendingEscalation = useStore((s) => s.pendingEscalation);
  const clearPendingEscalation = useStore((s) => s.clearPendingEscalation);

  const sendDecision = useCallback(
    async (optionId: EscalationOptionId, rerouteObjective?: string) => {
      if (!pendingEscalation) return;
      try {
        await chrome.runtime.sendMessage({
          type: "ESCALATION_DECISION",
          requestId: crypto.randomUUID(),
          source: MessageSource.SIDEPANEL,
          workspaceId: useStore.getState().activeWorkspaceId,
          payload: {
            escalationId: pendingEscalation.escalationId,
            optionId,
            rerouteObjective,
          },
        });
      } catch (error) {
        logger.error("ui", "Failed to send escalation decision", { error });
      } finally {
        clearPendingEscalation();
      }
    },
    [pendingEscalation, clearPendingEscalation],
  );

  if (!pendingEscalation) return null;

  return (
    <div
      role="alert"
      className="mx-3 mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100"
    >
      <div className="flex items-start gap-2">
        <AlertOctagon size={14} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">Operator decision required</div>
          <div className="mt-0.5">{pendingEscalation.reason}</div>
          <div className="mt-1 text-xs opacity-80">
            Risk: {pendingEscalation.risk} | Confidence:{" "}
            {pendingEscalation.confidence.toFixed(2)}
          </div>
          <div className="mt-1 text-xs opacity-80 truncate">
            Snapshot: {pendingEscalation.snapshotSummary}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {pendingEscalation.options.map((option) => (
          <button
            key={option.id}
            onClick={() => void sendDecision(option.id, option.rerouteObjective)}
            className={
              option.id === pendingEscalation.recommendedOption
                ? "rounded bg-amber-700 px-2 py-1 text-xs text-white hover:bg-amber-800"
                : "rounded border border-amber-300 px-2 py-1 text-xs hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900/40"
            }
            title={option.impact}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
