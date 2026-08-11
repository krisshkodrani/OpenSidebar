/**
 * OpenSidebar — Watch Mode (passive monitor) messages: start/stop from the
 * side panel, status + suggestion broadcasts from the background, and the
 * page-glow activity signal to the content script.
 */

import type { MessageSource } from "../enums";
import type { BaseMessage, UiMessageSource } from "./base";

export type PassiveInputSource = "page" | "screenshot" | "tabAudio";
export type PassiveMonitorStatus =
  | "watching"
  | "paused"
  | "stopped"
  | "blocked"
  | "error";

/** Side panel starts a passive monitor for the active workspace tab. */
export interface PassiveMonitorStartMessage extends BaseMessage {
  type: "PASSIVE_MONITOR_START";
  source: UiMessageSource;
  payload: {
    tabId: number;
    workspaceId: string | null;
    instructions: string;
    inputSources: PassiveInputSource[];
    minIntervalMs?: number;
    maxSuggestionsPerMinute?: number;
  };
}

/** Side panel stops the passive monitor for a workspace. */
export interface PassiveMonitorStopMessage extends BaseMessage {
  type: "PASSIVE_MONITOR_STOP";
  source: UiMessageSource;
  payload: {
    workspaceId?: string | null;
    sessionId?: string | null;
  };
}

/** Background broadcasts passive monitor status to the side panel. */
export interface PassiveMonitorStatusMessage extends BaseMessage {
  type: "PASSIVE_MONITOR_STATUS";
  source: MessageSource.BACKGROUND;
  payload: {
    status: PassiveMonitorStatus;
    detail?: string;
    sessionId?: string;
    observedAt?: number;
  };
}

/** Background tells the watched page whether Watch Mode owns the page glow. */
export interface PassiveMonitorPageActivityMessage extends BaseMessage {
  type: "PASSIVE_MONITOR_PAGE_ACTIVITY";
  source: MessageSource.BACKGROUND;
  payload: {
    active: boolean;
    status: PassiveMonitorStatus;
    sessionId: string;
  };
}

/** Watched content reports a debounced DOM change to wake the monitor. */
export interface PassiveMonitorPageChangedMessage extends BaseMessage {
  type: "PASSIVE_MONITOR_PAGE_CHANGED";
  source: MessageSource.CONTENT;
  payload: { sessionId: string };
}

/** Background posts a passive suggestion to the side panel chat. */
export interface PassiveMonitorSuggestionMessage extends BaseMessage {
  type: "PASSIVE_MONITOR_SUGGESTION";
  source: MessageSource.BACKGROUND;
  payload: {
    suggestionId: string;
    sessionId: string;
    answer: string;
    confidence: "low" | "medium" | "high";
    evidence: string[];
    reason?: string;
    observedAt: number;
    fingerprint: string;
  };
}

/** Watch Mode (passive monitor) messages. */
export type WatchModeMessage =
  | PassiveMonitorStartMessage
  | PassiveMonitorStopMessage
  | PassiveMonitorStatusMessage
  | PassiveMonitorPageActivityMessage
  | PassiveMonitorPageChangedMessage
  | PassiveMonitorSuggestionMessage;
