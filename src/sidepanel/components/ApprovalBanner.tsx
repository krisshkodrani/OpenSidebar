import React, { useCallback, useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { MessageSource } from "../../types";
import { useStore } from "../store";
import { logger } from "../../utils";

export function ApprovalBanner() {
  const pendingApproval = useStore((s) => s.pendingApproval);
  const clearPendingApproval = useStore((s) => s.clearPendingApproval);

  useEffect(() => {
    if (!pendingApproval) return;
    const elapsed = Date.now() - pendingApproval.requestedAt;
    const remaining = Math.max(0, pendingApproval.timeoutMs - elapsed);
    const timer = setTimeout(() => {
      clearPendingApproval();
    }, remaining);
    return () => clearTimeout(timer);
  }, [pendingApproval, clearPendingApproval]);

  const sendDecision = useCallback(
    async (approved: boolean) => {
      if (!pendingApproval) return;
      try {
        await chrome.runtime.sendMessage({
          type: "APPROVAL_RESPONSE",
          requestId: crypto.randomUUID(),
          source: MessageSource.SIDEPANEL,
          workspaceId: useStore.getState().activeWorkspaceId,
          payload: {
            approvalId: pendingApproval.approvalId,
            approved,
          },
        });
      } catch (error) {
        logger.error("ui", "Failed to send approval response", { error });
      } finally {
        clearPendingApproval();
      }
    },
    [pendingApproval, clearPendingApproval],
  );

  if (!pendingApproval) return null;

  return (
    <div
      role="alert"
      className="mx-3 mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">High-risk action requires approval</div>
          <div className="mt-0.5 truncate">{pendingApproval.context}</div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => void sendDecision(false)}
          className="rounded border border-red-300 px-2 py-1 text-xs hover:bg-red-100 dark:border-red-700 dark:hover:bg-red-900/40"
        >
          Reject
        </button>
        <button
          onClick={() => void sendDecision(true)}
          className="rounded bg-red-700 px-2 py-1 text-xs text-white hover:bg-red-800"
        >
          Approve
        </button>
      </div>
    </div>
  );
}
