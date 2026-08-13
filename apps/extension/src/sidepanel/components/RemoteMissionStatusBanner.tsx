import { useEffect, useState } from "react";
import { MessageSource } from "../../types";
import {
  REMOTE_MISSION_LOCAL_STATUS_KEY,
  type RemoteMissionLocalStatus,
} from "../../remote-mission-local-status";
import { uiRuntime } from "../runtime";

const labels: Record<RemoteMissionLocalStatus["state"], string> = {
  queued: "Waiting for this browser",
  accepted: "Accepted on this browser",
  running: "Running on this browser",
  target_selection_required: "Choose a browser target in Codex",
  supervision_required: "Waiting for Codex to review evidence",
  approval_required: "Waiting for your approval",
  succeeded: "Completed",
  failed: "Not completed",
  cancelled: "Cancelled",
  outcome_unknown: "Outcome needs review",
};

const targets = {
  active_tab: "Active tab",
  existing_tab: "Matching open tab",
  isolated_tab: "Separate task tab",
} as const;

const parse = (value: unknown): RemoteMissionLocalStatus | null => {
  if (!value || typeof value !== "object") return null;
  const status = value as Partial<RemoteMissionLocalStatus>;
  return (
    typeof status.missionId === "string" &&
    typeof status.updatedAt === "string" &&
    typeof status.state === "string" &&
    status.state in labels
  ) ? status as RemoteMissionLocalStatus : null;
};

type ControlResponse = { ok: boolean; detail?: string };

export function RemoteMissionStatusBanner() {
  const [status, setStatus] = useState<RemoteMissionLocalStatus | null>(null);
  const [pending, setPending] = useState<"cancel" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void uiRuntime.storage.local.get(REMOTE_MISSION_LOCAL_STATUS_KEY).then((stored) => {
      if (active) setStatus(parse(stored[REMOTE_MISSION_LOCAL_STATUS_KEY]));
    });
    const unsubscribe = uiRuntime.storage.local.onChanged?.((changes) => {
      if (REMOTE_MISSION_LOCAL_STATUS_KEY in changes) {
        setStatus(parse(changes[REMOTE_MISSION_LOCAL_STATUS_KEY]?.newValue));
        setPending(null);
        setError(null);
      }
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  if (!status) return null;
  const isActive =
    status.state === "accepted" ||
    status.state === "running" ||
    status.state === "target_selection_required" ||
    status.state === "supervision_required" ||
    status.state === "approval_required";
  const control = async (kind: "cancel" | "deny") => {
    setPending(kind);
    setError(null);
    try {
      const response = await uiRuntime.sendMessage<ControlResponse>({
        type: kind === "cancel" ? "REMOTE_MISSION_CANCEL" : "REMOTE_MISSION_DENY",
        requestId: crypto.randomUUID(),
        source: MessageSource.SIDEPANEL,
        workspaceId: null,
        payload: { missionId: status.missionId },
      });
      if (!response?.ok) throw new Error(response?.detail ?? "Request was not completed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request was not completed.");
      setPending(null);
    }
  };

  return (
    <section
      aria-label="Remote task"
      className={`mx-3 mt-2 overflow-hidden rounded-xl border text-xs shadow-sm ${
        isActive
          ? "border-primary-200 bg-primary-50/90 text-primary-950 dark:border-primary-800 dark:bg-primary-950/40 dark:text-primary-100"
          : "border-warm-200 bg-warm-50 text-warm-800 dark:border-warm-700 dark:bg-warm-900 dark:text-warm-100"
      }`}
    >
      <div className="flex items-start justify-between gap-2 px-3 pb-2 pt-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] opacity-65">
            Remote task
          </div>
          <div className="mt-0.5 font-semibold" role="status" aria-live="polite">
            {labels[status.state]}
          </div>
        </div>
        <span className="rounded-full border border-current/15 bg-white/50 px-2 py-1 text-[10px] font-medium dark:bg-black/10">
          {status.missionId.slice(0, 8)}
        </span>
      </div>

      <div className="border-t border-current/10 px-3 py-2.5">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[10px]">
          <dt className="opacity-60">Requested by</dt>
          <dd className="truncate text-right font-medium">
            {status.requesterLabel ?? "OpenSidebar account"}
          </dd>
          {status.deviceName ? (
            <>
              <dt className="opacity-60">Runs on</dt>
              <dd className="truncate text-right font-medium">{status.deviceName}</dd>
            </>
          ) : null}
          {status.targetContext ? (
            <>
              <dt className="opacity-60">Browser target</dt>
              <dd className="text-right font-medium">{targets[status.targetContext]}</dd>
            </>
          ) : null}
          {status.expiresAt && isActive ? (
            <>
              <dt className="opacity-60">Mission expires</dt>
              <dd className="text-right font-medium">
                {new Date(status.expiresAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </dd>
            </>
          ) : null}
        </dl>

        {status.instructionSummary ? (
          <div className="mt-2 rounded-lg bg-white/55 px-2.5 py-2 dark:bg-black/10">
            <div className="text-[9px] font-semibold uppercase tracking-wide opacity-55">
              Requested task
            </div>
            <p className="mt-1 break-words leading-relaxed">{status.instructionSummary}</p>
          </div>
        ) : null}

        {status.approval ? (
          <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
            <div className="text-[9px] font-semibold uppercase tracking-wide opacity-65">
              Approval requested
            </div>
            <p className="mt-1 break-words font-medium leading-relaxed">
              {status.approval.question}
            </p>
            <div className="mt-1 text-[9px] opacity-65">
              Expires {new Date(status.approval.expiresAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>
        ) : null}

        {status.targetSelection ? (
          <div className="mt-2 rounded-lg border border-primary-300 bg-white/70 px-2.5 py-2 dark:border-primary-700 dark:bg-black/10">
            <div className="text-[9px] font-semibold uppercase tracking-wide opacity-65">
              Multiple matching tabs
            </div>
            <p className="mt-1 leading-relaxed">
              {status.targetSelection.candidates.length} matches found. Continue in Codex to choose by page, tab group, and window.
            </p>
          </div>
        ) : null}

        {status.diagnostic ? (
          <div className="mt-2 break-words text-[10px]" data-testid="remote-mission-diagnostic">
            Local diagnostic: {status.diagnostic}
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="mt-2 break-words text-[10px] text-red-700 dark:text-red-300">
            {error}
          </div>
        ) : null}

        {isActive ? (
          <div className="mt-2.5 flex gap-2">
            {status.state === "approval_required" && status.approval ? (
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => void control("deny")}
                className="min-h-8 flex-1 rounded-lg border border-amber-400 bg-white px-2 font-semibold text-amber-800 disabled:opacity-50 dark:bg-transparent dark:text-amber-200"
              >
                {pending === "deny" ? "Denying…" : "Deny"}
              </button>
            ) : null}
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => void control("cancel")}
              className="min-h-8 flex-1 rounded-lg border border-red-300 bg-white px-2 font-semibold text-red-700 disabled:opacity-50 dark:border-red-800 dark:bg-transparent dark:text-red-300"
            >
              {pending === "cancel" ? "Cancelling…" : "Cancel task"}
            </button>
          </div>
        ) : null}

        <div className="mt-2 text-[9px] opacity-55">Local safety rules always apply.</div>
      </div>
    </section>
  );
}
