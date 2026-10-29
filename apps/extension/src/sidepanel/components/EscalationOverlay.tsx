import React, { useCallback } from "react";
import { AlertOctagon } from "lucide-react";
import { EscalationOptionId } from "../../types";
import { logger } from "../../utils";
import { useStore } from "../store";
import { uiRuntime } from "../runtime";

export function EscalationOverlay() {
  const pendingEscalation = useStore((s) => s.pendingEscalation);
  const clearPendingEscalation = useStore((s) => s.clearPendingEscalation);

  const sendDecision = useCallback(
    async (optionId: EscalationOptionId, rerouteObjective?: string) => {
      if (!pendingEscalation) return;
      try {
        await uiRuntime.sendMessage({
          type: "ESCALATION_DECISION",
          requestId: crypto.randomUUID(),
          source: uiRuntime.source,
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
    <div className="rounded-lg border border-warning/30 bg-warning-subtle p-2.5">
      <div className="flex items-start gap-2 mb-2">
        <AlertOctagon
          size={14}
          className="mt-0.5 shrink-0 text-warning"
        />
        <div className="min-w-0 flex-1">
          <div className="text-ui-control font-medium text-warning">
            Decision required
          </div>
          <div className="text-ui-control text-warning mt-0.5">
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
                ? "rounded bg-warning px-2.5 py-1.5 text-ui-control font-medium text-canvas hover:bg-warning/90 transition-colors"
                : "rounded border border-warning/30 px-2.5 py-1.5 text-ui-control font-medium text-warning hover:bg-warning-subtle transition-colors"
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
