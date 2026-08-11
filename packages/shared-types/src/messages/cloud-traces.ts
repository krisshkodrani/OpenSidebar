import type { UiMessageSource } from "./base";
import type { BaseMessage } from "./base";

export interface CloudTraceQueueStatusMessage extends BaseMessage {
  type: "CLOUD_TRACE_QUEUE_STATUS";
  source: UiMessageSource;
}

export interface CloudTraceQueuePauseMessage extends BaseMessage {
  type: "CLOUD_TRACE_QUEUE_PAUSE";
  source: UiMessageSource;
  payload: { paused: boolean };
}

export interface CloudTraceQueueRetryMessage extends BaseMessage {
  type: "CLOUD_TRACE_QUEUE_RETRY";
  source: UiMessageSource;
}

export interface CloudTraceQueueExcludeMessage extends BaseMessage {
  type: "CLOUD_TRACE_QUEUE_EXCLUDE";
  source: UiMessageSource;
  payload: { traceId: string };
}

export type CloudTraceMessage =
  | CloudTraceQueueStatusMessage
  | CloudTraceQueuePauseMessage
  | CloudTraceQueueRetryMessage
  | CloudTraceQueueExcludeMessage;
