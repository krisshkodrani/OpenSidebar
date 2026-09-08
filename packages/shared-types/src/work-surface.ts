export const WORK_SURFACE_SCHEMA_VERSION = 1 as const;

export type WorkItemKind = "task" | "monitor" | "recording";
export type WorkItemOrigin = "local" | "remote";
export type WorkItemPhase =
  | "queued"
  | "planning"
  | "awaiting_plan"
  | "running"
  | "awaiting_user"
  | "paused"
  | "stalled"
  | "recoverable"
  | "terminal";

export type WorkItemAttention =
  | "none"
  | "plan_confirmation"
  | "approval"
  | "clarification"
  | "target_selection"
  | "remote_supervision";

export type WorkItemOutcome =
  | "completed"
  | "partial"
  | "failed"
  | "stopped"
  | "cancelled"
  | "unknown";

export type WorkCommandKind =
  | "start_task"
  | "guide"
  | "approve_plan"
  | "revise_plan"
  | "answer"
  | "approve"
  | "deny"
  | "pause"
  | "resume"
  | "replan"
  | "stop"
  | "cancel_remote"
  | "update_monitor"
  | "stop_monitor"
  | "finish_recording"
  | "cancel_recording";

export type ComposerMode =
  | "new_task"
  | "guidance"
  | "plan_feedback"
  | "answer"
  | "resume_guidance"
  | "monitor_instructions"
  | "locked"
  | "hidden";

export interface ComposerPolicyV1 {
  schemaVersion: typeof WORK_SURFACE_SCHEMA_VERSION;
  mode: ComposerMode;
  enabled: boolean;
  label: string;
  placeholder?: string;
  submitLabel?: string;
  command?: WorkCommandKind;
  disabledReason?: string;
}

export type WorkEventV1 =
  | {
      schemaVersion: typeof WORK_SURFACE_SCHEMA_VERSION;
      eventId: string;
      kind: "message";
      createdAt: string;
      role: "user" | "assistant";
      content: string;
      intent?: "objective" | "guidance" | "answer";
    }
  | {
      schemaVersion: typeof WORK_SURFACE_SCHEMA_VERSION;
      eventId: string;
      kind: "plan";
      createdAt: string;
      revision: number;
      steps: Array<{ label: string; status: "pending" | "running" | "completed" | "failed" }>;
    }
  | {
      schemaVersion: typeof WORK_SURFACE_SCHEMA_VERSION;
      eventId: string;
      kind: "status" | "decision" | "result";
      createdAt: string;
      label: string;
      detail?: string;
    };

export interface WorkItemRecordV1 {
  schemaVersion: typeof WORK_SURFACE_SCHEMA_VERSION;
  workItemId: string;
  workspaceId: string | null;
  kind: WorkItemKind;
  origin: WorkItemOrigin;
  phase: WorkItemPhase;
  attention: WorkItemAttention;
  objective: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  allowedCommands: WorkCommandKind[];
  events: WorkEventV1[];
  outcome?: WorkItemOutcome;
  terminalAt?: string;
  remote?: {
    missionId: string;
    requesterLabel?: string;
    deviceName?: string;
    targetContext?: "active_tab" | "existing_tab" | "isolated_tab";
  };
}

export interface IncomingWorkItemV1 {
  schemaVersion: typeof WORK_SURFACE_SCHEMA_VERSION;
  workItemId: string;
  origin: "remote";
  objective: string;
  phase: "queued";
  createdAt: string;
  expiresAt?: string;
  reason?: "workspace_busy" | "awaiting_workspace";
}

export interface WorkSurfaceSnapshotV1 {
  schemaVersion: typeof WORK_SURFACE_SCHEMA_VERSION;
  workspaceId: string | null;
  revision: number;
  active: WorkItemRecordV1 | null;
  history: WorkItemRecordV1[];
  inbox: IncomingWorkItemV1[];
  composer: ComposerPolicyV1;
}

export interface WorkCommandV1 {
  schemaVersion: typeof WORK_SURFACE_SCHEMA_VERSION;
  commandId: string;
  workItemId?: string;
  workspaceId: string | null;
  expectedRevision: number;
  kind: WorkCommandKind;
  text?: string;
}
