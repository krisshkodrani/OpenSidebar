import { AgentStatus, RuntimeMessage, MessageSource } from "../types";
import { logger } from "../utils";
import { useStore } from "./store";
import { getE2EPanelConfig, uiRuntime } from "./runtime";
import type { UiRuntimeKeepalivePort } from "./runtime";

type StoreApi = typeof useStore;
type SidePanelState = ReturnType<StoreApi["getState"]>;
type UserChatAcceptedPayload = Extract<
  RuntimeMessage,
  { type: "USER_CHAT_ACCEPTED" }
>["payload"];
type PassiveSuggestionPayload = Extract<
  RuntimeMessage,
  { type: "PASSIVE_MONITOR_SUGGESTION" }
>["payload"];

const PASSIVE_SUGGESTION_DEDUPE_TTL_MS = 60_000;

function hasTerminalCompletionWithoutNewerUser(state: SidePanelState): boolean {
  if (!state.taskCompletion || state.isAgentRunning) return false;

  let latestCompletionIndex = -1;
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const message = state.messages[i];
    if (message.role === "assistant" && message.completionData) {
      latestCompletionIndex = i;
      break;
    }
  }

  if (latestCompletionIndex === -1) return true;
  return !state.messages
    .slice(latestCompletionIndex + 1)
    .some((message) => message.role === "user");
}

function hasUserChatMessage(
  state: SidePanelState,
  payload: UserChatAcceptedPayload,
): boolean {
  return state.messages.some(
    (message) => message.role === "user" && message.id === payload.messageId,
  );
}

function appendAcceptedUserChat(
  state: SidePanelState,
  payload: UserChatAcceptedPayload,
): void {
  const text = payload.text.trim();
  if (!text || hasUserChatMessage(state, payload)) return;

  state.addMessage({
    id: payload.messageId,
    role: "user",
    content: text,
    timestamp: payload.timestamp,
    toolCalls: [],
    isStreaming: false,
    ...(payload.isFeedback ? { isFeedback: true } : {}),
  });
}

function formatPassiveSuggestion(
  payload: PassiveSuggestionPayload,
): string {
  return payload.answer.trim();
}

function normalizePassiveSuggestionText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function fingerprintPassiveSuggestion(
  payload: PassiveSuggestionPayload,
  content: string,
): string {
  return [
    "watch",
    payload.sessionId,
    payload.fingerprint,
    normalizePassiveSuggestionText(content),
  ].join("\u001f");
}

function getLastPassiveMessage(state: SidePanelState) {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const message = state.messages[i];
    if (message.isPassive) return message;
  }
  return null;
}

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
  const isE2EPanel = getE2EPanelConfig() != null;
  const passiveSuggestionFingerprints = new Map<string, string>();
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
      case "USER_CHAT_ACCEPTED":
        appendAcceptedUserChat(state, message.payload);
        if (!message.payload.isFeedback) {
          store.setState({
            agentStatus: AgentStatus.THINKING,
            statusDetail: "Starting task...",
            isAgentRunning: true,
            taskProgress: null,
            taskCompletion: null,
            sessionMetrics: null,
            durableRunStatus: null,
            isPlanning: true,
          });
        }
        break;

      case "PASSIVE_MONITOR_STATUS":
        if (message.payload.status !== "watching") {
          passiveSuggestionFingerprints.clear();
        }
        state.setPassiveMonitorStatus(
          message.payload.status,
          message.payload.detail ?? null,
          message.payload.observedAt ?? null,
          message.payload.sessionId ?? null,
        );
        break;

      case "PASSIVE_MONITOR_SUGGESTION":
        {
          const content = formatPassiveSuggestion(message.payload);
          const observationFingerprint = fingerprintPassiveSuggestion(
            message.payload,
            content,
          );
          const lastPassiveMessage = getLastPassiveMessage(state);
          const lastPassiveFingerprint = lastPassiveMessage
            ? passiveSuggestionFingerprints.get(lastPassiveMessage.id)
            : null;
          const duplicateRecentPassiveSuggestion =
            lastPassiveMessage != null &&
            lastPassiveFingerprint === observationFingerprint &&
            Math.abs(message.payload.observedAt - lastPassiveMessage.timestamp) <=
              PASSIVE_SUGGESTION_DEDUPE_TTL_MS;
          const duplicateSuggestionId = state.messages.some(
            (entry) => entry.id === message.payload.suggestionId,
          );

          if (!duplicateSuggestionId && !duplicateRecentPassiveSuggestion) {
            passiveSuggestionFingerprints.set(
              message.payload.suggestionId,
              observationFingerprint,
            );
            state.addMessage({
              id: message.payload.suggestionId,
              role: "assistant",
              content,
              timestamp: message.payload.observedAt,
              toolCalls: [],
              isStreaming: false,
              isPassive: true,
            });
          }
        }
        state.setPassiveMonitorStatus(
          "watching",
          "Suggestion posted.",
          message.payload.observedAt,
          message.payload.sessionId,
        );
        break;

      case "AGENT_STATUS":
        if (
          message.payload.status !== AgentStatus.IDLE &&
          message.payload.status !== AgentStatus.ERROR &&
          hasTerminalCompletionWithoutNewerUser(store.getState())
        ) {
          logger.debug("ui", "Ignored stale running status after completion", {
            status: message.payload.status,
          });
          break;
        }
        if (
          message.payload.status === AgentStatus.THINKING ||
          message.payload.status === AgentStatus.IDLE ||
          message.payload.status === AgentStatus.ERROR
        ) {
          passiveSuggestionFingerprints.clear();
        }
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
        if (hasTerminalCompletionWithoutNewerUser(store.getState())) {
          logger.debug("ui", "Ignored stale stagnation state after completion");
          break;
        }
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
        if (hasTerminalCompletionWithoutNewerUser(store.getState())) {
          logger.debug("ui", "Ignored stale turn progress after completion");
          break;
        }
        state.setTurnProgress({
          turn: message.payload.turn,
          maxTurns: message.payload.maxTurns,
          provider: message.payload.provider,
        });
        break;

      case "TASK_PROGRESS":
        if (hasTerminalCompletionWithoutNewerUser(store.getState())) {
          logger.debug("ui", "Ignored stale task progress after completion");
          break;
        }
        state.setTaskProgress(message.payload);
        // Clear stale confirmation so PlanStrip transitions to progress mode
        if (state.pendingPlanConfirmation) {
          state.clearPendingPlanConfirmation();
        }
        break;

      case "TASK_COMPLETION":
        state.applyTaskCompletion(message.payload);
        break;

      case "DELEGATED_BROWSER_TASK_UPDATE":
        state.setDelegatedBrowserTask(message.payload);
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
      if (wsId && !isE2EPanel) {
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
