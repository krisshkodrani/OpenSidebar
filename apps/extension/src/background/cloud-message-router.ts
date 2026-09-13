import type { RuntimeMessage } from "../types";
import {
  handleCloudDeviceMessage,
  isCloudDeviceMessage,
} from "./cloud-device-runtime";
import {
  cloudRestoreEnabled,
  handleCloudRestoreMessage,
  isCloudRestoreMessage,
} from "./cloud-restore-runtime";
import { isUiMessageSource } from "./ui-message-source";
import {
  drainCloudTraceQueue,
  excludeQueuedTrace,
  listCloudTraceQueue,
  setTraceQueuePaused,
  traceQueuePaused,
} from "./cloud-trace-queue";

const isCloudTraceMessage = (message: RuntimeMessage) =>
  [
    "CLOUD_TRACE_QUEUE_STATUS",
    "CLOUD_TRACE_QUEUE_PAUSE",
    "CLOUD_TRACE_QUEUE_RETRY",
    "CLOUD_TRACE_QUEUE_EXCLUDE",
  ].includes(message.type);

async function handleCloudTraceMessage(message: RuntimeMessage) {
  if (message.type === "CLOUD_TRACE_QUEUE_PAUSE")
    await setTraceQueuePaused(message.payload.paused);
  if (message.type === "CLOUD_TRACE_QUEUE_RETRY")
    await drainCloudTraceQueue({ force: true });
  if (message.type === "CLOUD_TRACE_QUEUE_EXCLUDE")
    await excludeQueuedTrace(message.payload.traceId);
  return {
    ok: true,
    paused: await traceQueuePaused(),
    items: await listCloudTraceQueue(),
  };
}

export function routeCloudRuntimeMessage(
  message: RuntimeMessage,
  sendResponse: (response: unknown) => void,
): "async" | "sync" | null {
  if (!isUiMessageSource(message.source)) return null;
  if (isCloudTraceMessage(message)) {
    void handleCloudTraceMessage(message).then(sendResponse);
    return "async";
  }
  if (isCloudDeviceMessage(message)) {
    void handleCloudDeviceMessage(message).then(sendResponse);
    return "async";
  }
  if (!isCloudRestoreMessage(message)) return null;
  if (!cloudRestoreEnabled) {
    sendResponse({
      ok: false,
      disabled: true,
      detail: "Cloud session restore is not enabled in this build.",
    });
    return "sync";
  }
  void handleCloudRestoreMessage(message).then(sendResponse);
  return "async";
}
