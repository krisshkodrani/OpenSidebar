/** Child-frame entry point. It answers only explicit frame-targeted reads. */
import {
  MessageSource,
  type FrameSnapshotRequest,
  type FrameSnapshotResponse,
  type FrameToolExecuteMessage,
  type ToolResultMessage,
} from "../types";
import { executeAction } from "./actions";
import { extractVisibleText } from "./readability";
import { buildSnapshot } from "./snapshot";
import { installFrameGeometryRelay, requestParentFrameGeometry } from "./frame-geometry-relay";
import {
  getPageDocumentState,
  rejectStaleToolRequest,
  startPageMutationEpochObserver,
} from "./page-state-epoch";

export function createFrameSnapshotResponse(
  request: FrameSnapshotRequest,
): FrameSnapshotResponse {
  const snapshot = buildSnapshot(request.payload.refresh);
  if (request.payload.refresh && !snapshot.pageContent) {
    const text = extractVisibleText().trim();
    if (text) snapshot.pageContent = text;
  }
  return {
    type: "FRAME_SNAPSHOT_RESPONSE",
    requestId: request.requestId,
    source: MessageSource.CONTENT,
    payload: {
      snapshot,
      documentState: getPageDocumentState(),
    },
  };
}

if (window.top !== window) {
  installFrameGeometryRelay();
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!message || typeof message !== "object" ||
        (message as { source?: unknown }).source !== MessageSource.BACKGROUND)
      return false;
    if ((message as { type?: unknown }).type === "FRAME_TOOL_EXECUTE") {
      const request = message as FrameToolExecuteMessage;
      const { toolName, args, toolCallId, observationBasis } = request.payload;
      let responded = false;
      const respond = (payload: ToolResultMessage["payload"]): void => {
        if (responded) return;
        responded = true;
        sendResponse({ type: "TOOL_RESULT", requestId: request.requestId,
          source: MessageSource.CONTENT, payload } satisfies ToolResultMessage);
      };
      if (rejectStaleToolRequest(observationBasis, (result) =>
        respond({ toolCallId, ...result }))) return true;
      setTimeout(() => respond({ toolCallId, success: false,
        result: `Tool execution timed out: ${toolName}`, navigated: false }), 10_000);
      try {
        Promise.resolve(executeAction(toolName, args, toolCallId))
          .then((result) => respond({ toolCallId, ...result }))
          .catch((error: unknown) => respond({ toolCallId, success: false,
            result: `Tool error: ${error instanceof Error ? error.message : String(error)}`,
            navigated: false }));
      } catch (error) {
        respond({ toolCallId, success: false,
          result: `Tool error: ${error instanceof Error ? error.message : String(error)}`,
          navigated: false });
      }
      return true;
    }
    if ((message as { type?: unknown }).type !== "FRAME_SNAPSHOT_REQUEST")
      return false;
    startPageMutationEpochObserver();
    const request = message as FrameSnapshotRequest;
    if (request.payload.geometryNonce)
      requestParentFrameGeometry(request.payload.geometryNonce);
    sendResponse(createFrameSnapshotResponse(request));
    return false;
  });
}
