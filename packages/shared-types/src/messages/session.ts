/**
 * OpenSidebar — chat + session-control messages (side panel ↔ background):
 * user chat, response streaming, agent status, run control (stop/pause/
 * resume/skip), panel lifecycle, and privacy/data actions.
 */

import type { AgentStatus, MessageSource } from "../enums";
import type { Citation, ToolCallSummary } from "../agent";
import type { CloudCheckpointIndexV1, CloudSessionV1 } from "../cloud-sessions";
import type { BaseMessage, UiMessageSource } from "./base";

/** User sends a new chat message from the side panel */
export interface UserChatMessage extends BaseMessage {
  type: "USER_CHAT";
  source: UiMessageSource;
  payload: {
    text: string;
    /** Active tab ID at time of sending */
    tabId: number;
    /** Active workspace ID, if any */
    workspaceId: string | null;
    /** UI-generated chat entry ID, echoed back by the background for dedupe. */
    messageId?: string;
    /** UI timestamp, echoed back by the background for consistent ordering. */
    timestamp?: number;
    /** When true, inject as feedback into running agent context (don't start new loop) */
    isFeedback?: boolean;
  };
}

/** Background acknowledges a user chat so all mounted panels can render it */
export interface UserChatAcceptedMessage extends BaseMessage {
  type: "USER_CHAT_ACCEPTED";
  source: MessageSource.BACKGROUND;
  payload: {
    text: string;
    tabId: number;
    workspaceId: string | null;
    messageId: string;
    timestamp: number;
    isFeedback?: boolean;
  };
}

/** Side panel asks the background to transcribe user-captured audio. */
export interface SpeechTranscriptionRequestMessage extends BaseMessage {
  type: "SPEECH_TRANSCRIPTION_REQUEST";
  source: UiMessageSource;
  payload: {
    audioBase64: string;
    mimeType: string;
    workspaceId: string | null;
    language?: string;
    prompt?: string;
  };
}

/** Background sends a completed agent response to the side panel */
export interface AgentResponseMessage extends BaseMessage {
  type: "AGENT_RESPONSE";
  source: MessageSource.BACKGROUND;
  payload: {
    text: string;
    /** Whether the agent loop is still running (more messages may follow) */
    isStreaming: boolean;
    /** Tool calls that were executed during this turn */
    toolCalls: ToolCallSummary[];
    /** Source citations collected during the session */
    citations?: Citation[];
  };
}

/** Background broadcasts status changes to the side panel */
export interface AgentStatusMessage extends BaseMessage {
  type: "AGENT_STATUS";
  source: MessageSource.BACKGROUND;
  payload: {
    status: AgentStatus;
    /** Human-readable description (e.g. "Clicking button [12]") */
    detail: string;
    /** Optional terminal task outcome associated with an IDLE status. */
    completionStatus?: "completed" | "partial" | "failed" | "stopped";
  };
}

/** A single SSE chunk from the LLM stream, forwarded to side panel */
export interface StreamChunkMessage extends BaseMessage {
  type: "STREAM_CHUNK";
  source: MessageSource.BACKGROUND;
  payload: {
    /** Incremental text delta */
    delta: string;
    /** True when this is the final chunk */
    done: boolean;
    /** Source citations collected during the session (only present on done=true) */
    citations?: Citation[];
    /** When set, replaces the entire content of the current streaming message */
    replaceContent?: string;
    /** Extracted LLM thinking/reasoning content */
    thinking?: string;
  };
}

/** User requests the agent loop to stop (from side panel or in-page stop button) */
export interface StopAgentMessage extends BaseMessage {
  type: "STOP_AGENT";
  source: UiMessageSource | MessageSource.CONTENT;
  payload: {
    workspaceId?: string | null;
  };
}

/** Side panel requests pausing the agent loop */
export interface PauseAgentMessage extends BaseMessage {
  type: "PAUSE_AGENT";
  source: UiMessageSource;
  payload: {
    workspaceId?: string | null;
  };
}

/** Side panel requests resuming the paused agent loop */
export interface ResumeAgentMessage extends BaseMessage {
  type: "RESUME_AGENT";
  source: UiMessageSource;
  payload: {
    workspaceId?: string | null;
  };
}

/** Side panel requests skipping the current subtask */
export interface SkipSubtaskMessage extends BaseMessage {
  type: "SKIP_SUBTASK";
  source: UiMessageSource;
  payload: {
    taskId: string;
  };
}

/** Side panel reports it has been opened/mounted */
export interface SidePanelOpenedMessage extends BaseMessage {
  type: "SIDE_PANEL_OPENED";
  source: UiMessageSource;
  payload: {
    tabId: number;
    windowId: number;
  };
}

/** Background instructs the side panel to close itself */
export interface CloseSidePanelMessage extends BaseMessage {
  type: "CLOSE_SIDE_PANEL";
  source: MessageSource.BACKGROUND;
  payload: {
    tabId: number;
    windowId: number;
  };
}

/** Side panel requests background to re-broadcast current state for a workspace */
export interface WorkspaceSyncMessage extends BaseMessage {
  type: "WORKSPACE_SYNC";
  source: UiMessageSource;
  payload: {
    workspaceId: string;
  };
}

/** Background sends a debug screenshot to the side panel for display */
export interface ScreenshotCapturedMessage extends BaseMessage {
  type: "SCREENSHOT_CAPTURED";
  source: MessageSource.BACKGROUND;
  payload: {
    dataUrl: string;
    context: string;
    timestamp: number;
  };
}

/** Side panel requests a scoped privacy/data cleanup action. */
export interface DataControlRequestMessage extends BaseMessage {
  type: "DATA_CONTROL_REQUEST";
  source: UiMessageSource;
  payload: {
    action:
      | "clear_logs"
      | "clear_chat_history"
      | "clear_workspace_chat_history"
      | "clear_local_data";
  };
}

/** Background reports result of a data cleanup action. */
export interface DataControlResultMessage extends BaseMessage {
  type: "DATA_CONTROL_RESULT";
  source: MessageSource.BACKGROUND;
  payload: {
    action: DataControlRequestMessage["payload"]["action"];
    ok: boolean;
    detail: string;
  };
}

/** Lists restorable cloud sessions through the background-owned cloud client. */
export interface CloudRestoreListRequestMessage extends BaseMessage {
  type: "CLOUD_RESTORE_LIST_REQUEST";
  source: UiMessageSource;
  payload: Record<string, never>;
}

/** Selects a checkpoint and prepares a freshly grounded, paused restore. */
export interface CloudRestorePrepareMessage extends BaseMessage {
  type: "CLOUD_RESTORE_PREPARE";
  source: UiMessageSource;
  payload: { sessionId: string; checkpointId?: string; tabId: number };
}

/** Explicit user confirmation that permits a prepared restore to execute. */
export interface CloudRestoreContinueMessage extends BaseMessage {
  type: "CLOUD_RESTORE_CONTINUE";
  source: UiMessageSource;
  payload: { restoreId: string; outcomeResolution?: string };
}

export type CloudRestoreListResponse =
  | { ok: true; sessions: Array<{ session: CloudSessionV1; checkpoint: CloudCheckpointIndexV1 | null }> }
  | { ok: false; detail: string; disabled?: boolean };

export type CloudRestorePrepareResponse =
  | {
      ok: true;
      restoreId: string;
      preview: {
        state: "restored_paused";
        objective: string;
        completed: string[];
        remaining: string[];
        grounding: "matched" | "changed" | "unavailable" | "unauthorized";
        pageTitle?: string;
        pageUrl?: string;
        changedStateWarning: boolean;
        requiresFreshApproval: boolean;
        requiresOutcomeClarification: boolean;
      };
    }
  | { ok: false; detail: string; disabled?: boolean };

export type CloudRestoreContinueResponse =
  | { ok: true; workspaceId: string }
  | { ok: false; detail: string; disabled?: boolean };

export interface CloudDeviceReconnectMessage extends BaseMessage {
  type: "CLOUD_DEVICE_RECONNECT";
  source: UiMessageSource;
  payload: {
    sessionId: string;
    sessionRevision: number;
    tabId: number;
    afterSequence?: number;
  };
}

export interface CloudDeviceTakeoverMessage extends BaseMessage {
  type: "CLOUD_DEVICE_TAKEOVER";
  source: UiMessageSource;
  payload: { takeoverId: string };
}

export interface CloudDeviceTakeoverContinueMessage extends BaseMessage {
  type: "CLOUD_DEVICE_TAKEOVER_CONTINUE";
  source: UiMessageSource;
  payload: { restoreId: string; outcomeResolution?: string };
}

export interface CloudDeviceCommandApprovalDecisionMessage extends BaseMessage {
  type: "CLOUD_DEVICE_COMMAND_APPROVAL_DECISION";
  source: UiMessageSource;
  payload: { approvalId: string; approved: boolean };
}

export type CloudDeviceReconnectResponse =
  | {
      ok: true;
      state: "connected";
      lastSequence: number;
      processedCommands: number;
    }
  | {
      ok: true;
      state: "needs_takeover";
      takeoverId: string;
      previousDeviceName: string;
    }
  | {
      ok: true;
      state: "takeover_paused";
      restoreId: string;
      preview: Extract<CloudRestorePrepareResponse, { ok: true }>["preview"];
    }
  | {
      ok: true;
      state: "approval_required";
      approvalId: string;
      action: {
        kind: "click";
        target: string;
        origin: string;
        expectedResult: string;
        risk: "reversible_write" | "sensitive_write";
        expiresAt: string;
      };
    }
  | { ok: true; state: "read_only"; detail: string }
  | { ok: false; detail: string; disabled?: boolean };

export type CloudDeviceTakeoverResponse =
  | (Extract<CloudRestorePrepareResponse, { ok: true }> & {
      state: "takeover_paused";
    })
  | { ok: false; detail: string; disabled?: boolean };

/** Chat, streaming, run control, panel lifecycle, and data-control messages. */
export type SessionMessage =
  | UserChatMessage
  | UserChatAcceptedMessage
  | SpeechTranscriptionRequestMessage
  | AgentResponseMessage
  | AgentStatusMessage
  | StreamChunkMessage
  | StopAgentMessage
  | PauseAgentMessage
  | ResumeAgentMessage
  | SkipSubtaskMessage
  | SidePanelOpenedMessage
  | CloseSidePanelMessage
  | WorkspaceSyncMessage
  | ScreenshotCapturedMessage
  | DataControlRequestMessage
  | DataControlResultMessage
  | CloudRestoreListRequestMessage
  | CloudRestorePrepareMessage
  | CloudRestoreContinueMessage
  | CloudDeviceReconnectMessage
  | CloudDeviceTakeoverMessage
  | CloudDeviceTakeoverContinueMessage
  | CloudDeviceCommandApprovalDecisionMessage;
