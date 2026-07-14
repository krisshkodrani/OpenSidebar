/**
 * OpenSidebar — background ↔ content-script page protocol: DOM snapshots,
 * in-page tool execution, modal dismissal, readiness probes, and scrolling.
 */

import type { MessageSource, ToolName } from "../enums";
import type { DomSnapshot, OverlayDescriptor } from "../dom";
import type { BaseMessage } from "./base";

/** Background requests a DOM snapshot from the content script */
export interface DomSnapshotRequest extends BaseMessage {
  type: "DOM_SNAPSHOT_REQUEST";
  source: MessageSource.BACKGROUND;
  payload: {
    /** Whether to re-tag elements or use cached tags */
    refresh: boolean;
    /** When true, auto-dismiss viewport-covering overlays before snapshotting.
     *  Default: true. Set false for post-tool refreshes so agent-triggered
     *  dialogs (confirmation prompts, menus) are not destroyed. */
    autoDismiss?: boolean;
  };
}

/** Content script returns the DOM snapshot */
export interface DomSnapshotResponse extends BaseMessage {
  type: "DOM_SNAPSHOT_RESPONSE";
  source: MessageSource.CONTENT;
  payload: {
    snapshot: DomSnapshot;
    /** Time in ms to generate the snapshot */
    durationMs: number;
  };
}

/** Background tells the content script to execute a DOM action */
export interface ToolExecuteMessage extends BaseMessage {
  type: "TOOL_EXECUTE";
  source: MessageSource.BACKGROUND;
  payload: {
    toolName: ToolName;
    args: Record<string, unknown>;
    toolCallId: string;
  };
}

/** Content script returns the result of a tool execution */
export interface ToolResultMessage extends BaseMessage {
  type: "TOOL_RESULT";
  source: MessageSource.CONTENT;
  payload: {
    toolCallId: string;
    success: boolean;
    result: string;
    /** If the action triggered a navigation */
    navigated: boolean;
  };
}

/** Background asks the content script to auto-dismiss modals/banners */
export interface DismissModalsMessage extends BaseMessage {
  type: "DISMISS_MODALS";
  source: MessageSource.BACKGROUND;
  payload: Record<string, never>;
}

/** Content script reports how many modals were dismissed */
export interface DismissModalsResponse extends BaseMessage {
  type: "DISMISS_MODALS_RESPONSE";
  source: MessageSource.CONTENT;
  payload: {
    dismissed: number;
    /** Non-null if heuristics couldn't dismiss a viewport-covering overlay */
    remainingOverlay: OverlayDescriptor | null;
    /** Text content extracted from dismissed overlays (deduplicated) */
    capturedTexts: string[];
  };
}

/** Content script announces it's initialized and ready to receive messages */
export interface ContentScriptReadyMessage extends BaseMessage {
  type: "CONTENT_SCRIPT_READY";
  source: MessageSource.CONTENT;
  payload: { tabId: number };
}

/** Background asks content script to signal when DOM has settled (no mutations) */
export interface DomReadyProbeMessage extends BaseMessage {
  type: "DOM_READY_PROBE";
  source: MessageSource.BACKGROUND;
  payload: {
    /** Hard cap in ms — respond even if DOM hasn't fully settled */
    timeoutMs: number;
    /** If true, wait until at least one element is present before responding */
    waitForElements?: boolean;
  };
}

/** Content script responds when DOM quiescence is reached */
export interface DomReadyAckMessage extends BaseMessage {
  type: "DOM_READY_ACK";
  source: MessageSource.CONTENT;
  payload: {
    /** How long the content script waited before responding (ms) */
    waitedMs: number;
    /** Number of elements currently in DOM (0 = page still loading) */
    elementCount: number;
  };
}

/** Background asks content script to scroll to an absolute Y position */
export interface ScrollToPositionMessage extends BaseMessage {
  type: "SCROLL_TO_POSITION";
  source: MessageSource.BACKGROUND;
  payload: { y: number };
}

/** Content script reports the actual scroll position after scrolling */
export interface ScrollToPositionResponse extends BaseMessage {
  type: "SCROLL_TO_POSITION_RESPONSE";
  source: MessageSource.CONTENT;
  payload: { actualY: number };
}

/** Background ↔ content-script page-protocol messages. */
export type ContentProtocolMessage =
  | DomSnapshotRequest
  | DomSnapshotResponse
  | ToolExecuteMessage
  | ToolResultMessage
  | DismissModalsMessage
  | DismissModalsResponse
  | ContentScriptReadyMessage
  | DomReadyProbeMessage
  | DomReadyAckMessage
  | ScrollToPositionMessage
  | ScrollToPositionResponse;
