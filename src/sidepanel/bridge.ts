import { AgentStatus, RuntimeMessage, MessageSource } from "../types";
import { logger } from "../utils";
import { useStore } from "./store";

type StoreApi = typeof useStore;

/**
 * Initialize the message bridge between the background service worker and the
 * side panel Zustand store. Returns a cleanup function to remove the listener.
 *
 * Handles screenshot state via the provided callbacks (since screenshots are
 * managed in component-local state, not the store).
 */
export function initializeBridge(
  store: StoreApi,
  callbacks: {
    onScreenshot: (payload: { dataUrl: string; context: string; timestamp: number }) => void;
    onClose: (windowId: number) => void;
  },
): () => void {
  const listener = (message: RuntimeMessage) => {
    if (message.source !== MessageSource.BACKGROUND) return;

    // Workspace filter: drop messages for other workspaces
    const activeWsId = store.getState().activeWorkspaceId;
    if (message.workspaceId != null && activeWsId != null && message.workspaceId !== activeWsId) {
      logger.debug("ui", "Dropping message for different workspace", { type: message.type, messageWs: message.workspaceId, activeWs: activeWsId });
      return;
    }

    logger.debug("ui", "Received message", { type: message.type });
    const state = store.getState();

    switch (message.type) {
      case "AGENT_STATUS":
        state.updateStatus(message.payload.status, message.payload.detail);
        if (
          message.payload.status === AgentStatus.IDLE ||
          message.payload.status === AgentStatus.ERROR
        ) {
          state.setAgentRunning(false);
          state.clearStuckState();
          state.clearTurnProgress();
          state.setAwaitingPlanApproval(false);
          // Keep sessionMetrics visible after completion (cleared on next run start)
        } else {
          state.setAgentRunning(true);
          // Clear stale metrics when a new run starts (THINKING is the first status)
          if (message.payload.status === AgentStatus.THINKING && !state.sessionMetrics) {
            // No-op — metrics will arrive via SESSION_METRICS
          }
        }
        // Detect plan approval pause
        if (message.payload.status === AgentStatus.PAUSED && message.payload.detail.includes("Plan ready")) {
          state.setAwaitingPlanApproval(true);
        } else if (message.payload.status !== AgentStatus.PAUSED) {
          state.setAwaitingPlanApproval(false);
        }
        break;

      case "STREAM_CHUNK": {
        const { delta, done } = message.payload;
        if (done) {
          state.finalizeStream();
        } else if (delta) {
          state.appendStreamDelta(delta);
        }
        break;
      }

      case "AGENT_RESPONSE":
        if (!message.payload.isStreaming) {
          state.finalizeStream();
        }
        break;

      case "AGENT_STEP":
        if (message.payload.update) {
          state.updateStep(message.payload.step);
        } else {
          state.addStep(message.payload.step);
        }
        break;

      case "SCREENSHOT_CAPTURED":
        callbacks.onScreenshot(message.payload);
        break;

      case "CLOSE_SIDE_PANEL":
        callbacks.onClose(message.payload.windowId);
        break;

      // --- New message types from RFCs ---

      case "AGENT_STUCK":
        if (message.payload.signal === "resolved") {
          state.clearStuckState();
        } else {
          state.setStuckState({
            signal: message.payload.signal,
            staleTurns: message.payload.staleTurns,
            url: message.payload.url,
            receivedAt: Date.now(),
          });
        }
        break;

      case "AGENT_TURN":
        state.setTurnProgress({
          turn: message.payload.turn,
          maxTurns: message.payload.maxTurns,
        });
        break;

      case "TASK_PROGRESS":
        state.setTaskProgress(message.payload);
        break;

      case "TASK_COMPLETION":
        state.setTaskCompletion(message.payload);
        break;

      case "SESSION_METRICS":
        state.setSessionMetrics(message.payload);
        break;

      // Messages from other sources (sidepanel→background, background→content, etc.)
      // These are filtered by the source check above, but listed for exhaustiveness.
      case "USER_CHAT":
      case "STOP_AGENT":
      case "SETTINGS_UPDATE":
      case "SIDE_PANEL_OPENED":
      case "TOOL_EXECUTE":
      case "TOOL_RESULT":
      case "DOM_SNAPSHOT_REQUEST":
      case "DOM_SNAPSHOT_RESPONSE":
      case "NAVIGATION_RESUME":
      case "MEMORY_WORKER":
      case "MEMORY_WORKER_RESPONSE":
      case "AGENT_ACTIVITY":
      case "DISMISS_MODALS":
      case "DISMISS_MODALS_RESPONSE":
      case "SKIP_SUBTASK":
      case "PAUSE_AGENT":
      case "RESUME_AGENT":
        break;

      default: {
        const _exhaustive: never = message;
        logger.debug("ui", "Unknown message type", { type: (_exhaustive as RuntimeMessage).type });
        break;
      }
    }
  };

  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
