import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, XCircle, TimerOff } from "lucide-react";
import { MessageSource } from "../../types";
import { useStore } from "../store";
import { logger } from "../../utils";

type ApprovalOutcome = "approved" | "rejected" | "timed_out" | null;

export function ApprovalBanner() {
  const pendingApproval = useStore((s) => s.pendingApproval);
  const clearPendingApproval = useStore((s) => s.clearPendingApproval);
  const [nowMs, setNowMs] = useState(Date.now());
  const [lastOutcome, setLastOutcome] = useState<ApprovalOutcome>(null);
  const [lastContext, setLastContext] = useState<string>("");

  const remainingMs = useMemo(() => {
    if (!pendingApproval) return 0;
    const elapsed = nowMs - pendingApproval.requestedAt;
    return Math.max(0, pendingApproval.timeoutMs - elapsed);
  }, [pendingApproval, nowMs]);

  const progressPct = useMemo(() => {
    if (!pendingApproval || pendingApproval.timeoutMs <= 0) return 0;
    return Math.max(0, Math.min(100, (remainingMs / pendingApproval.timeoutMs) * 100));
  }, [pendingApproval, remainingMs]);

  useEffect(() => {
    if (!pendingApproval) return;
    setNowMs(Date.now());

    const tick = setInterval(() => setNowMs(Date.now()), 250);
    const elapsed = Date.now() - pendingApproval.requestedAt;
    const timeoutRemaining = Math.max(0, pendingApproval.timeoutMs - elapsed);
    const timeout = setTimeout(() => {
      setLastContext(pendingApproval.context);
      setLastOutcome("timed_out");
      clearPendingApproval();
    }, timeoutRemaining);

    return () => {
      clearInterval(tick);
      clearTimeout(timeout);
    };
  }, [pendingApproval, clearPendingApproval]);

  useEffect(() => {
    if (!lastOutcome) return;
    const timer = setTimeout(() => setLastOutcome(null), 2200);
    return () => clearTimeout(timer);
  }, [lastOutcome]);

  const sendDecision = useCallback(
    async (approved: boolean) => {
      if (!pendingApproval) return;
      try {
        setLastContext(pendingApproval.context);
        setLastOutcome(approved ? "approved" : "rejected");
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

  if (!pendingApproval && !lastOutcome) return null;

  if (!pendingApproval && lastOutcome) {
    const icon =
      lastOutcome === "approved" ? (
        <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-300" />
      ) : lastOutcome === "rejected" ? (
        <XCircle size={14} className="mt-0.5 shrink-0 text-red-600 dark:text-red-300" />
      ) : (
        <TimerOff size={14} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" />
      );
    const label =
      lastOutcome === "approved"
        ? "Approval granted"
        : lastOutcome === "rejected"
          ? "Approval rejected"
          : "Approval timed out";

    return (
      <div
        role="status"
        className="mx-3 mt-2 rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-800 dark:border-warm-700 dark:bg-warm-800/60 dark:text-warm-100"
      >
        <div className="flex items-start gap-2">
          {icon}
          <div className="min-w-0 flex-1">
            <div className="font-medium">{label}</div>
            {lastContext && (
              <div className="mt-0.5 truncate text-xs text-warm-500 dark:text-warm-400">
                {lastContext}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

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
          <div className="mt-1 flex items-center gap-2 text-[11px] text-red-700/80 dark:text-red-300/80">
            <span className="tabular-nums">
              {Math.ceil(remainingMs / 1000)}s remaining
            </span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-red-100/80 dark:bg-red-950/40 overflow-hidden">
            <div
              className="h-full bg-red-500 transition-[width] duration-200"
              style={{ width: `${progressPct}%` }}
            />
          </div>
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
