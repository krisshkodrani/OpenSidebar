import React, { useState } from "react";
import { ChevronDown, ChevronRight, Radio, X } from "lucide-react";
import { MessageSource } from "../../types";
import { REMOTE_MISSION_LOCAL_STATUS_KEY } from "../../remote-mission-local-status";
import { uiRuntime } from "../runtime";
import { useWorkSurface } from "../use-work-surface";
import { TaskStatusRegion } from "./TaskStatusRegion";

const remoteLabels = {
  queued: "Waiting for this workspace",
  accepted: "Accepted on this browser",
  running: "Working in this browser",
  target_selection_required: "Choose a browser target in Codex",
  supervision_required: "Codex is reviewing evidence",
  approval_required: "Your approval is required",
  succeeded: "Task completed",
  failed: "Task not completed",
  cancelled: "Task cancelled",
  outcome_unknown: "Outcome needs review",
} as const;

interface WorkSurfaceRegionProps {
  isPlanExpanded: boolean;
  onTogglePlan: () => void;
  onSkillRecordingHelp: () => void;
}

export function WorkSurfaceRegion(props: WorkSurfaceRegionProps) {
  const { active, history, inbox, remoteStatus } = useWorkSurface();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [pending, setPending] = useState<"cancel" | "deny" | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  const remoteActive = active?.origin === "remote" && remoteStatus;

  const controlRemote = async (kind: "cancel" | "deny") => {
    if (!remoteStatus) return;
    setPending(kind);
    setControlError(null);
    try {
      const response = await uiRuntime.sendMessage<{ ok?: boolean; detail?: string }>({
        type: kind === "cancel" ? "REMOTE_MISSION_CANCEL" : "REMOTE_MISSION_DENY",
        requestId: crypto.randomUUID(),
        source: MessageSource.SIDEPANEL,
        workspaceId: null,
        payload: { missionId: remoteStatus.missionId },
      });
      if (!response?.ok) throw new Error(response?.detail ?? "The request was not completed.");
    } catch (error) {
      setControlError(error instanceof Error ? error.message : "The request was not completed.");
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="shrink-0" aria-label="Work surface" data-work-phase={active?.phase ?? "idle"}>
      {remoteActive ? (
        <div className="mx-3 mt-2 overflow-hidden rounded-xl border border-primary-200 bg-primary-50/90 text-xs text-warm-900 shadow-sm dark:border-primary-800 dark:bg-primary-950/30 dark:text-warm-100">
          <div className="flex items-start gap-2.5 px-3 py-3">
            <span className="mt-0.5 rounded-full bg-primary-100 p-1.5 text-primary-700 dark:bg-primary-900/60 dark:text-primary-200">
              <Radio size={13} className={active.phase === "running" ? "animate-pulse" : undefined} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-[0.13em] text-primary-700/70 dark:text-primary-200/70">Remote task</div>
              <div className="mt-0.5 font-semibold" role="status" aria-live="polite">{remoteLabels[remoteStatus.state]}</div>
              <p className="mt-1 line-clamp-2 leading-relaxed text-warm-600 dark:text-warm-300">{active.objective}</p>
              {remoteStatus.approval ? (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">{remoteStatus.approval.question}</p>
              ) : null}
              {remoteStatus.targetSelection ? (
                <p className="mt-2 text-[10px] text-warm-500 dark:text-warm-400">{remoteStatus.targetSelection.candidates.length} matching tabs found. Choose the target in Codex.</p>
              ) : null}
            </div>
            {active.phase === "terminal" ? (
              <button type="button" aria-label="Dismiss completed remote task" className="rounded-md p-1 text-warm-400 hover:bg-white/70" onClick={() => void uiRuntime.storage.local.remove(REMOTE_MISSION_LOCAL_STATUS_KEY)}><X size={14} /></button>
            ) : null}
          </div>
          <div className="flex items-center gap-2 border-t border-primary-200/70 px-3 py-2 dark:border-primary-800/70">
            <button type="button" onClick={() => setDetailsOpen((value) => !value)} className="inline-flex items-center gap-1 text-[10px] font-medium text-warm-500 hover:text-warm-800 dark:hover:text-warm-100">
              {detailsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Details
            </button>
            {active.phase !== "terminal" ? (
              <div className="ml-auto flex gap-1.5">
                {remoteStatus.state === "approval_required" ? (
                  <button type="button" disabled={pending !== null} onClick={() => void controlRemote("deny")} className="rounded-md border border-amber-300 px-2 py-1 text-[10px] font-semibold text-amber-800 disabled:opacity-50 dark:border-amber-800 dark:text-amber-200">{pending === "deny" ? "Denying…" : "Deny"}</button>
                ) : null}
                <button type="button" disabled={pending !== null} onClick={() => void controlRemote("cancel")} className="rounded-md border border-red-300 px-2 py-1 text-[10px] font-semibold text-red-700 disabled:opacity-50 dark:border-red-800 dark:text-red-300">{pending === "cancel" ? "Cancelling…" : "Cancel task"}</button>
              </div>
            ) : <span className="ml-auto text-[10px] text-warm-400">Moves to history in a moment</span>}
          </div>
          {detailsOpen ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-primary-200/70 px-3 py-2 text-[10px] dark:border-primary-800/70">
              <dt className="text-warm-400">Requested by</dt><dd className="truncate text-right">{remoteStatus.requesterLabel ?? "OpenSidebar account"}</dd>
              {remoteStatus.deviceName ? <><dt className="text-warm-400">Device</dt><dd className="truncate text-right">{remoteStatus.deviceName}</dd></> : null}
              <dt className="text-warm-400">Mission ID</dt><dd className="truncate text-right font-mono">{remoteStatus.missionId}</dd>
              {remoteStatus.diagnostic ? <><dt className="text-warm-400">Diagnostic</dt><dd className="break-words text-right">{remoteStatus.diagnostic}</dd></> : null}
            </dl>
          ) : null}
          {controlError ? <div role="alert" className="border-t border-red-200 px-3 py-2 text-[10px] text-red-700 dark:border-red-900 dark:text-red-300">{controlError}</div> : null}
        </div>
      ) : (
        <TaskStatusRegion {...props} />
      )}

      {inbox.length > 0 ? (
        <div className="mx-3 mt-1.5 flex items-center gap-2 rounded-lg border border-warm-200 bg-warm-50 px-2.5 py-2 text-[10px] dark:border-warm-800 dark:bg-warm-900">
          <Radio size={12} className="shrink-0 text-primary-600" />
          <span className="min-w-0 flex-1 truncate text-warm-600 dark:text-warm-300">Remote task waiting: {inbox[0]?.objective}</span>
          <span className="shrink-0 text-warm-400">Starts when free</span>
        </div>
      ) : null}

      {history.length > 0 ? (
        <div className="mx-3 mt-1.5">
          <button type="button" onClick={() => setHistoryOpen((value) => !value)} className="flex w-full items-center gap-1 rounded-md px-1 py-1 text-[10px] font-medium text-warm-400 hover:text-warm-700 dark:hover:text-warm-200">
            {historyOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Previous tasks <span className="ml-auto tabular-nums">{history.length}</span>
          </button>
          {historyOpen ? (
            <ol className="mt-1 max-h-28 space-y-1 overflow-y-auto">
              {history.map((item) => <li key={item.workItemId} className="flex items-center gap-2 rounded-lg border border-warm-200 bg-warm-50 px-2.5 py-2 text-[10px] dark:border-warm-800 dark:bg-warm-900"><span className="min-w-0 flex-1 truncate text-warm-600 dark:text-warm-300">{item.objective}</span><span className="shrink-0 capitalize text-warm-400">{item.outcome ?? "done"}</span></li>)}
            </ol>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
