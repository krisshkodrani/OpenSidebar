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
        <div className="mx-3 mt-2 overflow-hidden rounded-xl border border-accent/30 bg-accent-subtle text-ui-control text-fg shadow-sm">
          <div className="flex items-start gap-2.5 px-3 py-3">
            <span className="mt-0.5 rounded-full bg-accent-subtle p-1.5 text-accent-text">
              <Radio size={13} className={active.phase === "running" ? "animate-pulse" : undefined} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-ui-caption font-semibold uppercase tracking-[0.13em] text-accent-text">Remote task</div>
              <div className="mt-0.5 font-semibold" role="status" aria-live="polite">{remoteLabels[remoteStatus.state]}</div>
              <p className="mt-1 line-clamp-2 leading-relaxed text-fg-secondary">{active.objective}</p>
              {remoteStatus.approval ? (
                <p className="mt-2 rounded-lg border border-warning/30 bg-warning-subtle px-2 py-1.5 font-medium text-warning">{remoteStatus.approval.question}</p>
              ) : null}
              {remoteStatus.targetSelection ? (
                <p className="mt-2 text-ui-caption text-fg-tertiary">{remoteStatus.targetSelection.candidates.length} matching tabs found. Choose the target in Codex.</p>
              ) : null}
            </div>
            {active.phase === "terminal" ? (
              <button type="button" aria-label="Dismiss completed remote task" className="rounded-md p-1 text-fg-tertiary hover:bg-surface" onClick={() => void uiRuntime.storage.local.remove(REMOTE_MISSION_LOCAL_STATUS_KEY)}><X size={14} /></button>
            ) : null}
          </div>
          <div className="flex items-center gap-2 border-t border-accent/30 px-3 py-2">
            <button type="button" onClick={() => setDetailsOpen((value) => !value)} className="inline-flex items-center gap-1 text-ui-caption font-medium text-fg-tertiary hover:text-fg">
              {detailsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Details
            </button>
            {active.phase !== "terminal" ? (
              <div className="ml-auto flex gap-1.5">
                {remoteStatus.state === "approval_required" ? (
                  <button type="button" disabled={pending !== null} onClick={() => void controlRemote("deny")} className="rounded-md border border-warning/30 px-2 py-1 text-ui-caption font-semibold text-warning disabled:opacity-50">{pending === "deny" ? "Denying…" : "Deny"}</button>
                ) : null}
                <button type="button" disabled={pending !== null} onClick={() => void controlRemote("cancel")} className="rounded-md border border-danger/30 px-2 py-1 text-ui-caption font-semibold text-danger disabled:opacity-50">{pending === "cancel" ? "Cancelling…" : "Cancel task"}</button>
              </div>
            ) : <span className="ml-auto text-ui-caption text-fg-tertiary">Moves to history in a moment</span>}
          </div>
          {detailsOpen ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-accent/30 px-3 py-2 text-ui-caption">
              <dt className="text-fg-tertiary">Requested by</dt><dd className="truncate text-right">{remoteStatus.requesterLabel ?? "OpenSidebar account"}</dd>
              {remoteStatus.deviceName ? <><dt className="text-fg-tertiary">Device</dt><dd className="truncate text-right">{remoteStatus.deviceName}</dd></> : null}
              <dt className="text-fg-tertiary">Mission ID</dt><dd className="truncate text-right font-mono">{remoteStatus.missionId}</dd>
              {remoteStatus.diagnostic ? <><dt className="text-fg-tertiary">Diagnostic</dt><dd className="break-words text-right">{remoteStatus.diagnostic}</dd></> : null}
            </dl>
          ) : null}
          {controlError ? <div role="alert" className="border-t border-danger/30 px-3 py-2 text-ui-caption text-danger">{controlError}</div> : null}
        </div>
      ) : (
        <TaskStatusRegion {...props} />
      )}

      {inbox.length > 0 ? (
        <div className="mx-3 mt-1.5 flex items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 py-2 text-ui-caption">
          <Radio size={12} className="shrink-0 text-accent-text" />
          <span className="min-w-0 flex-1 truncate text-fg-secondary">Remote task waiting: {inbox[0]?.objective}</span>
          <span className="shrink-0 text-fg-tertiary">Starts when free</span>
        </div>
      ) : null}

      {history.length > 0 ? (
        <div className="mx-3 mt-1.5">
          <button type="button" onClick={() => setHistoryOpen((value) => !value)} className="flex w-full items-center gap-1 rounded-md px-1 py-1 text-ui-caption font-medium text-fg-tertiary hover:text-fg-secondary">
            {historyOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Previous tasks <span className="ml-auto tabular-nums">{history.length}</span>
          </button>
          {historyOpen ? (
            <ol className="mt-1 max-h-28 space-y-1 overflow-y-auto">
              {history.map((item) => <li key={item.workItemId} className="flex items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 py-2 text-ui-caption"><span className="min-w-0 flex-1 truncate text-fg-secondary">{item.objective}</span><span className="shrink-0 capitalize text-fg-tertiary">{item.outcome ?? "done"}</span></li>)}
            </ol>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
