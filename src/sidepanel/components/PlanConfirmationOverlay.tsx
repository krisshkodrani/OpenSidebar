import React, { useCallback, useState } from "react";
import { ClipboardList } from "lucide-react";
import { MessageSource } from "../../types";
import { useStore } from "../store";
import { logger } from "../../utils";

export function PlanConfirmationOverlay() {
  const pending = useStore((s) => s.pendingPlanConfirmation);
  const clearPending = useStore((s) => s.clearPendingPlanConfirmation);
  const [feedback, setFeedback] = useState("");

  const sendDecision = useCallback(
    async (decision: "approve" | "cancel") => {
      if (!pending) return;
      try {
        await chrome.runtime.sendMessage({
          type: "PLAN_CONFIRMATION_RESPONSE",
          requestId: crypto.randomUUID(),
          source: MessageSource.SIDEPANEL,
          workspaceId: useStore.getState().activeWorkspaceId,
          payload: {
            confirmationId: pending.confirmationId,
            decision,
            feedback: feedback.trim() || undefined,
          },
        });
      } catch (error) {
        logger.error("ui", "Failed to send plan confirmation", { error });
      } finally {
        clearPending();
        setFeedback("");
      }
    },
    [pending, clearPending, feedback],
  );

  if (!pending) return null;

  const hasFeedback = feedback.trim().length > 0;

  return (
    <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/80 dark:bg-blue-900/20 p-2.5">
      <div className="flex items-start gap-2 mb-2">
        <ClipboardList
          size={14}
          className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-400"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-blue-800 dark:text-blue-200">
              Plan ready
            </span>
            {pending.difficulty && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300">
                {pending.difficulty}
              </span>
            )}
          </div>
          <div className="text-xs text-blue-700 dark:text-blue-300 truncate mt-0.5">
            {pending.query}
          </div>
        </div>
      </div>

      {/* Step list */}
      <div className="max-h-40 overflow-y-auto mb-2 space-y-1">
        {pending.nodes.map((node, i) => (
          <div
            key={i}
            className="flex items-start gap-1.5 text-xs text-blue-800 dark:text-blue-200"
          >
            <span className="shrink-0 w-4 h-4 flex items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/40 text-[10px] font-medium text-blue-600 dark:text-blue-300 mt-0.5">
              {i + 1}
            </span>
            <span className="leading-relaxed">{node.description}</span>
          </div>
        ))}
      </div>

      {/* Feedback textarea */}
      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="Optional: add guidance or corrections..."
        rows={2}
        className="w-full px-2 py-1.5 mb-2 text-xs border border-blue-200 dark:border-blue-700 rounded-md bg-white dark:bg-blue-950/30 text-blue-800 dark:text-blue-200 placeholder:text-blue-400 dark:placeholder:text-blue-600 outline-none focus:ring-1 focus:ring-blue-400 resize-none"
      />

      {/* Buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => void sendDecision("cancel")}
          className="flex-1 rounded border border-blue-300 dark:border-blue-700 px-2 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => void sendDecision("approve")}
          className="flex-1 rounded bg-blue-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
        >
          {hasFeedback ? "Replan & Start" : "Start"}
        </button>
      </div>
    </div>
  );
}
