import { useEffect, useMemo, useState } from "react";
import type {
  ComposerPolicyV1,
  IncomingWorkItemV1,
  WorkItemAttention,
  WorkItemPhase,
  WorkItemRecordV1,
} from "@shared-types/work-surface";
import { REMOTE_MISSION_LOCAL_STATUS_KEY, type RemoteMissionLocalStatus } from "../remote-mission-local-status";
import { useStore } from "./store";
import { useTaskUiState } from "./task-ui-state";
import { deriveComposerPolicy } from "./work-surface-policy";
import { archiveWorkItem, readWorkHistory } from "./work-surface-storage";
import { uiRuntime } from "./runtime";

const TERMINAL_REMOTE_STATES = new Set<RemoteMissionLocalStatus["state"]>([
  "succeeded", "failed", "cancelled", "outcome_unknown",
]);
const REMOTE_STATES = new Set<RemoteMissionLocalStatus["state"]>([
  "queued", "accepted", "running", "target_selection_required",
  "supervision_required", "approval_required", ...TERMINAL_REMOTE_STATES,
]);

export const parseRemoteMissionStatus = (value: unknown): RemoteMissionLocalStatus | null => {
  if (!value || typeof value !== "object") return null;
  const status = value as Partial<RemoteMissionLocalStatus>;
  return typeof status.missionId === "string" &&
    typeof status.updatedAt === "string" &&
    typeof status.state === "string" &&
    REMOTE_STATES.has(status.state as RemoteMissionLocalStatus["state"])
    ? status as RemoteMissionLocalStatus
    : null;
};

function remoteWorkItem(
  status: RemoteMissionLocalStatus,
  workspaceId: string | null,
): WorkItemRecordV1 {
  const terminal = TERMINAL_REMOTE_STATES.has(status.state);
  const phase: WorkItemPhase = terminal
    ? "terminal"
    : status.state === "queued"
      ? "queued"
      : status.state === "target_selection_required" ||
          status.state === "supervision_required" ||
          status.state === "approval_required"
        ? "awaiting_user"
        : "running";
  const attention: WorkItemAttention =
    status.state === "target_selection_required"
      ? "target_selection"
      : status.state === "supervision_required"
        ? "remote_supervision"
        : status.state === "approval_required"
          ? "approval"
          : "none";
  const outcome = status.state === "succeeded"
    ? "completed"
    : status.state === "failed"
      ? "failed"
      : status.state === "cancelled"
        ? "cancelled"
        : status.state === "outcome_unknown"
          ? "unknown"
          : undefined;
  return {
    schemaVersion: 1,
    workItemId: `remote:${status.missionId}`,
    workspaceId,
    kind: "task",
    origin: "remote",
    phase,
    attention,
    objective: status.instructionSummary ?? "Remote task",
    createdAt: status.updatedAt,
    updatedAt: status.updatedAt,
    revision: 1,
    allowedCommands: terminal ? [] : ["cancel_remote"],
    events: [],
    ...(outcome ? { outcome, terminalAt: status.updatedAt } : {}),
    remote: {
      missionId: status.missionId,
      requesterLabel: status.requesterLabel,
      deviceName: status.deviceName,
      targetContext: status.targetContext,
    },
  };
}

function localWorkItem(
  taskUi: ReturnType<typeof useTaskUiState>,
  workspaceId: string | null,
  objective: string,
  objectiveId: string | null,
  objectiveCreatedAt: string | null,
  requestedAttention: WorkItemAttention,
  recording: boolean,
  monitoring: boolean,
): WorkItemRecordV1 | null {
  if (recording) {
    return baseLocal("recording", "running", "Recording a website workflow", workspaceId, []);
  }
  if (monitoring) {
    return baseLocal("monitor", "running", "Watching this workspace", workspaceId, ["update_monitor", "stop_monitor"]);
  }
  if (taskUi.phase === "idle") return null;
  const phase: WorkItemPhase = taskUi.phase === "confirming_plan"
    ? "awaiting_plan"
    : taskUi.phase === "completed" || taskUi.phase === "partial" || taskUi.phase === "failed" || taskUi.phase === "stopped"
      ? "terminal"
      : taskUi.phase;
  const attention: WorkItemAttention = taskUi.phase === "confirming_plan"
    ? "plan_confirmation"
    : taskUi.phase === "awaiting_user"
      ? requestedAttention
      : "none";
  const commands = attention === "clarification"
    ? ["answer", "stop"] as const
    : attention === "approval"
      ? ["approve", "deny", "stop"] as const
      : phase === "running"
    ? ["guide", "pause", "stop"] as const
    : phase === "awaiting_plan"
      ? ["approve_plan", "revise_plan", "stop"] as const
      : phase === "paused" || phase === "stalled" || phase === "recoverable"
        ? ["resume", "stop"] as const
        : [];
  const item = baseLocal("task", phase, objective || "Current task", workspaceId, [...commands], attention);
  if (objectiveId) item.workItemId = `local:${objectiveId}`;
  if (objectiveCreatedAt) {
    item.createdAt = objectiveCreatedAt;
    item.updatedAt = objectiveCreatedAt;
  }
  if (phase === "terminal") {
    item.outcome = taskUi.phase === "completed" ? "completed" : taskUi.phase === "partial" ? "partial" : taskUi.phase === "stopped" ? "stopped" : "failed";
    item.terminalAt = item.updatedAt;
  }
  return item;
}

function baseLocal(
  kind: "task" | "monitor" | "recording",
  phase: WorkItemPhase,
  objective: string,
  workspaceId: string | null,
  allowedCommands: WorkItemRecordV1["allowedCommands"],
  attention: WorkItemAttention = "none",
): WorkItemRecordV1 {
  const now = new Date().toISOString();
  return { schemaVersion: 1, workItemId: `local:${workspaceId ?? "default"}`, workspaceId, kind, origin: "local", phase, attention, objective, createdAt: now, updatedAt: now, revision: 1, allowedCommands, events: [] };
}

export function useWorkSurface(): {
  active: WorkItemRecordV1 | null;
  composer: ComposerPolicyV1;
  history: WorkItemRecordV1[];
  inbox: IncomingWorkItemV1[];
  remoteStatus: RemoteMissionLocalStatus | null;
} {
  const workspaceId = useStore((s) => s.activeWorkspaceId);
  const messages = useStore((s) => s.messages);
  const recording = useStore((s) => s.skillRecordingStatus === "recording");
  const monitoring = useStore((s) => s.passiveStatus === "watching" || s.passiveStatus === "paused");
  const pendingClarification = useStore((s) => s.pendingClarification);
  const pendingApproval = useStore((s) => s.pendingApproval);
  const pendingEscalation = useStore((s) => s.pendingEscalation);
  const taskUi = useTaskUiState();
  const [remoteStatus, setRemoteStatus] = useState<RemoteMissionLocalStatus | null>(null);
  const [history, setHistory] = useState<WorkItemRecordV1[]>([]);
  const objectiveMessage = [...messages].reverse().find((message) => message.role === "user" && !message.isFeedback);
  const objective = objectiveMessage?.content ?? "";

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      uiRuntime.storage.local.get(REMOTE_MISSION_LOCAL_STATUS_KEY),
      readWorkHistory(uiRuntime.storage.local, workspaceId),
    ])
      .then(([stored, savedHistory]) => {
        if (!mounted) return;
        setRemoteStatus(parseRemoteMissionStatus(stored[REMOTE_MISSION_LOCAL_STATUS_KEY]));
        setHistory(savedHistory);
      })
      .catch(() => undefined);
    const unsubscribe = uiRuntime.storage.local.onChanged?.((changes) => {
      if (REMOTE_MISSION_LOCAL_STATUS_KEY in changes) {
        setRemoteStatus(parseRemoteMissionStatus(changes[REMOTE_MISSION_LOCAL_STATUS_KEY]?.newValue));
      }
    });
    return () => { mounted = false; unsubscribe?.(); };
  }, [workspaceId]);

  const remote = useMemo(() => remoteStatus ? remoteWorkItem(remoteStatus, workspaceId) : null, [remoteStatus, workspaceId]);
  useEffect(() => {
    if (!remote || remote.phase !== "terminal") return;
    void archiveWorkItem(uiRuntime.storage.local, workspaceId, remote)
      .then(setHistory)
      .catch(() => undefined);
    const timer = window.setTimeout(() => {
      void uiRuntime.storage.local
        .remove(REMOTE_MISSION_LOCAL_STATUS_KEY)
        .catch(() => undefined);
      setRemoteStatus(null);
    }, 8_000);
    return () => window.clearTimeout(timer);
  }, [remote, workspaceId]);

  const requestedAttention: WorkItemAttention = pendingClarification
    ? "clarification"
    : pendingApproval || pendingEscalation
      ? "approval"
      : "none";
  const objectiveCreatedAt = objectiveMessage
    ? new Date(objectiveMessage.timestamp).toISOString()
    : null;
  const local = useMemo(
    () => localWorkItem(
      taskUi,
      workspaceId,
      objective,
      objectiveMessage?.id ?? null,
      objectiveCreatedAt,
      requestedAttention,
      recording,
      monitoring,
    ),
    [
      monitoring,
      objective,
      objectiveCreatedAt,
      objectiveMessage?.id,
      recording,
      requestedAttention,
      taskUi,
      workspaceId,
    ],
  );
  const deferRemote = Boolean(
    remote?.phase === "queued" && local && local.phase !== "terminal",
  );
  const active = deferRemote ? local : remote ?? local;
  const inbox: IncomingWorkItemV1[] = deferRemote && remote
    ? [{
        schemaVersion: 1,
        workItemId: remote.workItemId,
        origin: "remote",
        objective: remote.objective,
        phase: "queued",
        createdAt: remote.createdAt,
        reason: "workspace_busy",
      }]
    : [];
  useEffect(() => {
    if (!active || active.phase !== "terminal" || active.origin !== "local") return;
    void archiveWorkItem(uiRuntime.storage.local, workspaceId, active)
      .then(setHistory)
      .catch(() => undefined);
  }, [active, workspaceId]);
  return { active, composer: deriveComposerPolicy(active), history, inbox, remoteStatus };
}
