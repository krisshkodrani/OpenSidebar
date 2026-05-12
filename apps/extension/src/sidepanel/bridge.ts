import { AgentStatus, RuntimeMessage, MessageSource } from "../types";
import { logger } from "../utils";
import { useStore } from "./store";
import { uiRuntime } from "./runtime";
import type { UiRuntimeKeepalivePort } from "./runtime";

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
    onScreenshot: (payload: {
      dataUrl: string;
      context: string;
      timestamp: number;
    }) => void;
    onClose: (windowId: number) => void;
  },
): () => void {
  const listener = (message: RuntimeMessage) => {
    if (message.source !== MessageSource.BACKGROUND) return;

    // Workspace filter: drop messages for other workspaces.
    // If the panel has no active workspace yet, also drop workspace-scoped
    // messages to prevent cross-workspace bleed during startup/switch races.
    const activeWsId = store.getState().activeWorkspaceId;
    if (message.workspaceId != null) {
      if (activeWsId == null) {
        logger.debug(
          "ui",
          "Dropping workspace-scoped message without active workspace",
          {
            type: message.type,
            messageWs: message.workspaceId,
          },
        );
        return;
      }
      if (message.workspaceId !== activeWsId) {
        logger.debug("ui", "Dropping message for different workspace", {
          type: message.type,
          messageWs: message.workspaceId,
          activeWs: activeWsId,
        });
        return;
      }
    }

    logger.debug("ui", "Received message", {
      type: message.type,
      wsId: message.workspaceId,
    });
    const state = store.getState();

    switch (message.type) {
      case "AGENT_STATUS":
        store.setState((current) => {
          if (
            message.payload.status === AgentStatus.IDLE ||
            message.payload.status === AgentStatus.ERROR
          ) {
            // Clear stale task progress if no TASK_COMPLETION was received.
            // Keep sessionMetrics visible after completion (cleared on next run start).
            return {
              agentStatus: message.payload.status,
              statusDetail: message.payload.detail,
              isAgentRunning: false,
              stagnationState: null,
              turnProgress: null,
              pendingApproval: null,
              pendingEscalation: null,
              pendingPlanConfirmation: null,
              pendingClarification: null,
              taskRecovery: null,
              durableRunStatus: null,
              laneTelemetry: null,
              latestStepLabel: null,
              isPlanning: false,
              ...(current.taskProgress
                ? { taskProgress: null, taskCompletion: null }
                : {}),
            };
          }
          if (message.payload.status === AgentStatus.THINKING) {
            // Clear stale completion/progress from previous run when a new run starts.
            return {
              agentStatus: message.payload.status,
              statusDetail: message.payload.detail,
              isAgentRunning: true,
              taskProgress: null,
              taskCompletion: null,
              sessionMetrics: null,
              durableRunStatus: null,
              isPlanning: true,
            };
          }
          return {
            agentStatus: message.payload.status,
            statusDetail: message.payload.detail,
            isAgentRunning: true,
          };
        });
        break;

      case "APPROVAL_REQUEST":
        state.setPendingApproval({
          ...message.payload,
          requestedAt: Date.now(),
        });
        break;

      case "TASK_RECOVERY":
        state.setTaskRecovery({
          workspaceId: message.workspaceId ?? activeWsId ?? null,
          ...message.payload,
          recoveredAt: Date.now(),
        });
        break;

      case "DURABLE_RUN_STATUS":
        state.setDurableRunStatus(message.payload);
        break;

      case "ESCALATION_REQUEST":
        state.setPendingEscalation({
          ...message.payload,
          requestedAt: Date.now(),
        });
        break;

      case "PLAN_CONFIRMATION_REQUEST":
        state.setIsPlanning(false);
        state.setPendingPlanConfirmation({
          ...message.payload,
          requestedAt: Date.now(),
        });
        // Plan confirmation is now surfaced exclusively via PlanStrip —
        // no synthetic message card needed.
        break;

      case "CLARIFICATION_REQUEST":
        state.setPendingClarification({
          ...message.payload,
          requestedAt: Date.now(),
        });
        break;

      case "STREAM_CHUNK": {
        // Single transaction — avoids 2-3 separate re-renders per chunk
        state.applyStreamChunk(message.payload);
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
        if (message.payload.step.status === "running") {
          state.setLatestStepLabel(message.payload.step.label);
        }
        break;

      case "SCREENSHOT_CAPTURED":
        callbacks.onScreenshot(message.payload);
        break;

      case "CLOSE_SIDE_PANEL":
        callbacks.onClose(message.payload.windowId);
        break;

      // --- New message types from RFCs ---

      case "AGENT_STAGNATION":
        if (message.payload.signal === "resolved") {
          state.clearStagnationState();
        } else {
          state.setStagnationState({
            signal: message.payload.signal,
            stagnantTurns: message.payload.stagnantTurns,
            url: message.payload.url,
            receivedAt: Date.now(),
          });
        }
        break;

      case "AGENT_TURN":
        state.setTurnProgress({
          turn: message.payload.turn,
          maxTurns: message.payload.maxTurns,
          provider: message.payload.provider,
        });
        break;

      case "TASK_PROGRESS":
        state.setTaskProgress(message.payload);
        // Clear stale confirmation so PlanStrip transitions to progress mode
        if (state.pendingPlanConfirmation) {
          state.clearPendingPlanConfirmation();
        }
        break;

      case "TASK_COMPLETION":
        state.setTaskCompletion(message.payload);
        state.setCompletionOnLastMessage(message.payload);
        break;

      case "SESSION_METRICS":
        state.setSessionMetrics(message.payload);
        break;

      case "AGENT_ACTIVITY":
        state.setLaneTelemetry(message.payload.laneTelemetry ?? null);
        break;

      case "SKILL_RECORDING_STATUS":
        state.setSkillRecordingStatus(message.payload);
        break;

      case "USER_SKILL_LIST":
        if (message.payload.skills) {
          useStore.setState({ userWebsiteSkills: message.payload.skills });
        }
        break;

      case "USER_SKILL_USAGE_STATUS":
        state.setActiveUserWebsiteSkill(message.payload.skill);
        break;

      // Background-sourced messages not relevant to the side panel (sent to content script, etc.)
      case "TOOL_EXECUTE":
      case "DOM_SNAPSHOT_REQUEST":
      case "NAVIGATION_RESUME":
      case "DISMISS_MODALS":
      case "DOM_READY_PROBE":
      case "SCROLL_TO_POSITION":
      case "DATA_CONTROL_RESULT":
      case "SKILL_RECORDING_START":
      case "SKILL_RECORDING_STOP":
      case "SKILL_RECORDING_CANCEL":
      case "SKILL_RECORDING_EVENT":
        break;

      default:
        // Non-exhaustive: other message types are filtered by source guard above
        logger.debug("ui", "Unhandled message type", {
          type: (message as RuntimeMessage).type,
        });
        break;
    }
  };

  const unsubscribeMessages = uiRuntime.subscribeMessages(listener);

  // Long-lived port to detect SW crashes. When the SW terminates, the port
  // disconnects and we reset stuck agent state so the user isn't locked out.
  let port: UiRuntimeKeepalivePort | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelay = 1000;
  const MAX_RECONNECT_DELAY = 30_000;
  let tornDown = false;

  function connectPort() {
    if (tornDown) return;
    try {
      port = uiRuntime.connectKeepalive("sidepanel-keepalive", () => {
        port = null;
        if (tornDown) return;
        const state = store.getState();
        if (state.isAgentRunning) {
          logger.warn(
            "ui",
            "SW disconnected while agent running — resetting state",
          );
          state.setAgentRunning(false);
          state.updateStatus(AgentStatus.IDLE, "Agent disconnected");
          state.finalizeStream();
        }
        // Clear any stuck overlays
        state.clearPendingApproval();
        state.clearPendingEscalation();
        state.clearPendingClarification();
        state.clearPendingPlanConfirmation();
        // Reconnect with exponential backoff (SW may restart)
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connectPort();
        }, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
      });
      reconnectDelay = 1000; // reset backoff on successful connect
      // Re-sync agent status after reconnect (SW may still be running a task)
      const wsId = store.getState().activeWorkspaceId;
      if (wsId) {
        uiRuntime
          .sendMessage({
            type: "WORKSPACE_SYNC",
            requestId: crypto.randomUUID(),
            source: uiRuntime.source,
            payload: { workspaceId: wsId },
          })
          .catch(() => {});
      }
    } catch {
      // Extension context invalidated — side panel is closing
      return;
    }
  }

  connectPort();

  return () => {
    tornDown = true;
    unsubscribeMessages();
    if (reconnectTimer != null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (port) {
      try {
        port.disconnect();
      } catch {
        /* context invalidated */
      }
      port = null;
    }
  };
}
