import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertTriangle } from "lucide-react";
import { useStore } from "../store";
import { logger } from "../../utils";
import { formatStepLabel } from "../../utils/step-labels";
import { uiRuntime } from "../runtime";
import { Button, Card } from "@/ui";

function describeRisk(toolName: string): string {
  if (/submit|delete|close|download|upload|cookie|navigate/i.test(toolName)) {
    return "This action can change page state, navigation, or account data.";
  }
  return "This action can have a visible side effect, so the agent is pausing for confirmation.";
}

export function ApprovalOverlay() {
  const pendingApproval = useStore((s) => s.pendingApproval);
  const reconnecting = useStore(
    (s) => s.backgroundConnection === "reconnecting",
  );
  const clearPendingApproval = useStore((s) => s.clearPendingApproval);
  const [nowMs, setNowMs] = useState(Date.now());
  const [sending, setSending] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const approveButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  const remainingMs = useMemo(() => {
    if (!pendingApproval) return 0;
    const elapsed = nowMs - pendingApproval.requestedAt;
    return Math.max(0, pendingApproval.timeoutMs - elapsed);
  }, [pendingApproval, nowMs]);

  const progressPct = useMemo(() => {
    if (!pendingApproval || pendingApproval.timeoutMs <= 0) return 0;
    return Math.max(
      0,
      Math.min(100, (remainingMs / pendingApproval.timeoutMs) * 100),
    );
  }, [pendingApproval, remainingMs]);

  const proposedAction = useMemo(() => {
    if (!pendingApproval) return "";
    return formatStepLabel(pendingApproval.toolName, pendingApproval.args);
  }, [pendingApproval]);

  const riskDescription = useMemo(() => {
    if (!pendingApproval) return "";
    return describeRisk(String(pendingApproval.toolName));
  }, [pendingApproval]);

  useEffect(() => {
    if (!pendingApproval) return;
    setNowMs(Date.now());
    setDecisionError(null);
    approveButtonRef.current?.focus();

    const tick = setInterval(() => setNowMs(Date.now()), 250);
    const elapsed = Date.now() - pendingApproval.requestedAt;
    const timeoutRemaining = Math.max(0, pendingApproval.timeoutMs - elapsed);
    const timeout = setTimeout(() => {
      clearPendingApproval();
    }, timeoutRemaining);

    return () => {
      clearInterval(tick);
      clearTimeout(timeout);
    };
  }, [pendingApproval, clearPendingApproval]);

  const sendDecision = useCallback(
    async (approved: boolean) => {
      if (!pendingApproval || sending || reconnecting) return;
      setSending(true);
      setDecisionError(null);
      try {
        await uiRuntime.sendMessage({
          type: "APPROVAL_RESPONSE",
          requestId: crypto.randomUUID(),
          source: uiRuntime.source,
          workspaceId: useStore.getState().activeWorkspaceId,
          payload: {
            approvalId: pendingApproval.approvalId,
            approved,
          },
        });
        if (
          useStore.getState().pendingApproval?.approvalId ===
          pendingApproval.approvalId
        )
          clearPendingApproval();
      } catch (error) {
        setDecisionError("Your decision was not sent. Please try again.");
        logger.error("ui", "Failed to send approval response", { error });
      } finally {
        setSending(false);
      }
    },
    [pendingApproval, clearPendingApproval, sending, reconnecting],
  );

  if (!pendingApproval) return null;

  return (
    <Card
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-900/20 p-2.5"
    >
      <div className="flex items-start gap-2 mb-2">
        <AlertTriangle
          size={14}
          className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
        />
        <div className="min-w-0 flex-1">
          <div
            id={titleId}
            className="text-xs font-medium uppercase tracking-[0.08em] text-amber-800 dark:text-amber-200"
          >
            Approval required
          </div>
          <div className="mt-1 text-sm font-medium leading-snug text-amber-900 dark:text-amber-100">
            {proposedAction}
          </div>
          <div
            id={descriptionId}
            className="mt-1 text-xs leading-relaxed text-amber-700 dark:text-amber-300"
          >
            {pendingApproval.context}
          </div>
          <div className="mt-1 text-[11px] leading-relaxed text-amber-700/90 dark:text-amber-300/90">
            {riskDescription}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 h-1 rounded-full bg-amber-100 dark:bg-amber-950/40 overflow-hidden">
          <div
            className="h-full bg-amber-500 transition-[width] duration-200"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <span className="text-[10px] tabular-nums text-amber-600 dark:text-amber-400 shrink-0">
          Auto-rejects in {Math.ceil(remainingMs / 1000)}s
        </span>
      </div>

      {decisionError ? (
        <p role="alert" className="mb-2 text-xs text-red-700 dark:text-red-300">
          {decisionError}
        </p>
      ) : null}
      {reconnecting ? (
        <p className="mb-2 text-xs text-amber-700 dark:text-amber-300">
          Reconnect before sending a decision.
        </p>
      ) : null}
      {/* Buttons */}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void sendDecision(false)}
          disabled={sending || reconnecting}
          className="flex-1 border-amber-300 text-xs text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/40"
        >
          Reject
        </Button>
        <Button
          type="button"
          variant={pendingApproval.risk === "high" ? "destructive" : "default"}
          size="sm"
          onClick={() => void sendDecision(true)}
          ref={approveButtonRef}
          disabled={sending || reconnecting}
          className="h-auto min-h-9 flex-1 whitespace-normal text-xs"
        >
          Approve: {proposedAction}
        </Button>
      </div>
    </Card>
  );
}
