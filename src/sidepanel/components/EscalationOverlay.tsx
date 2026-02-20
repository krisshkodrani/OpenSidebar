import React, { useCallback } from "react";
import { AlertOctagon } from "lucide-react";
import { EscalationOptionId, MessageSource } from "../../types";
import { logger } from "../../utils";
import { useStore } from "../store";

export function EscalationOverlay() {
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
    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-900/20 p-2.5">
      <div className="flex items-start gap-2 mb-2">
        <AlertOctagon
          size={14}
          className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
        />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-amber-800 dark:text-amber-200">
            Decision required
          </div>
          <div className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
            {pendingEscalation.reason}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {pendingEscalation.options.map((option) => (
          <button
            key={option.id}
            onClick={() =>
              void sendDecision(option.id, option.rerouteObjective)
            }
            className={
              option.id === pendingEscalation.recommendedOption
                ? "rounded bg-amber-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-amber-700 transition-colors"
                : "rounded border border-amber-300 dark:border-amber-700 px-2.5 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
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
