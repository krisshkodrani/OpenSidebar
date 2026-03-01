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
        logger.debug("ui", "Dropping workspace-scoped message without active workspace", {
          type: message.type,
          messageWs: message.workspaceId,
        });
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
          state.clearStagnationState();
          state.clearTurnProgress();
          state.clearPendingApproval();
          state.clearPendingEscalation();
          state.clearPendingPlanConfirmation();
          state.clearPendingClarification();
          state.clearTaskRecovery();
          state.clearLaneTelemetry();
          // Clear stale task progress if no TASK_COMPLETION was received
          if (state.taskProgress) {
            state.clearTaskProgress();
          }
          // Keep sessionMetrics visible after completion (cleared on next run start)
        } else {
          state.setAgentRunning(true);
          // Clear stale metrics when a new run starts (THINKING is the first status)
          if (
            message.payload.status === AgentStatus.THINKING &&
            !state.sessionMetrics
          ) {
            // No-op - metrics will arrive via SESSION_METRICS
          }
        }
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

      case "ESCALATION_REQUEST":
        state.setPendingEscalation({
          ...message.payload,
          requestedAt: Date.now(),
        });
        break;

      case "PLAN_CONFIRMATION_REQUEST":
        state.setPendingPlanConfirmation({
          ...message.payload,
          requestedAt: Date.now(),
        });
        break;

      case "CLARIFICATION_REQUEST":
        state.setPendingClarification({
          ...message.payload,
          requestedAt: Date.now(),
        });
        break;

      case "STREAM_CHUNK": {
        const { delta, done, citations, replaceContent, thinking } =
          message.payload;
        if (replaceContent !== undefined) {
          state.replaceStreamContent(replaceContent);
        }
        if (thinking) {
          state.setStreamThinking(thinking);
        }
        if (done) {
          state.finalizeStream(citations);
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
        // Auto-open PlanBoard on first plan arrival
        if (!state.taskProgress && message.payload && !state.showPlanBoard) {
          state.togglePlanBoard();
        }
        state.setTaskProgress(message.payload);
        break;

      case "TASK_COMPLETION": {
        state.setTaskCompletion(message.payload);
        // Auto-close PlanSheet for trivial tasks (single subtask or 0-1 turns)
        const results = message.payload.subtaskResults ?? [];
        const isTrivial =
          results.length <= 1 || (message.payload.totalTurnsUsed ?? 0) <= 1;
        if (isTrivial && state.showPlanBoard) {
          state.togglePlanBoard();
        }
        break;
      }

      case "SESSION_METRICS":
        state.setSessionMetrics(message.payload);
        break;

      case "AGENT_ACTIVITY":
        state.setLaneTelemetry(message.payload.laneTelemetry ?? null);
        break;

      case "DEMO_RECORD_STATUS":
        state.setDemoRecording(
          message.payload.active,
          message.payload.actionCount,
        );
        break;

      case "DEMO_SAVED":
        // Demo saved successfully — recording already stopped via DEMO_RECORD_STATUS
        logger.info("ui", "Demo saved", {
          name: message.payload.demo.name,
          actionCount: message.payload.demo.actions.length,
        });
        break;

      case "RECORDING_SAVED":
        state.addMessage({
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Recording "${message.payload.name}" saved — ${message.payload.turnCount} actions`,
          timestamp: Date.now(),
          toolCalls: [],
          isStreaming: false,
        });
        break;

      case "MANUAL_TOOL_RESULT": {
        const p = message.payload;
        // Build assistant chat entry from manual command result
        let content = p.result;
        if (p.toolName) {
          content = `**/${p.command}** \`${p.toolName}\` — ${p.result}`;
        }
        state.addMessage({
          id: crypto.randomUUID(),
          role: "assistant",
          content,
          timestamp: Date.now(),
          toolCalls: p.toolName
            ? [
                {
                  name: p.toolName,
                  args: p.args ? JSON.stringify(p.args) : "{}",
                  result: p.result,
                  durationMs: p.durationMs,
                },
              ]
            : [],
          isStreaming: false,
          isManualCommand: true,
        });

        // Update manual recording state from /record responses
        if (p.command === "record") {
          if (p.result.includes("started")) {
            // Extract session info from result text
            const nameMatch = p.result.match(/Recording started: "([^"]+)"/);
            const idMatch = p.result.match(/ID: ([^)]+)/);
            state.setManualRecording({
              sessionId: idMatch?.[1] ?? "",
              turnCount: 0,
              name: nameMatch?.[1] ?? "manual",
            });
          } else if (p.result.includes("stopped")) {
            state.setManualRecording(null);
          }
        }
        break;
      }

      // Messages from other sources (sidepanel->background, background->content, etc.)
      // These are filtered by the source check above, but listed for exhaustiveness.
      case "USER_CHAT":
      case "STOP_AGENT":
      case "SETTINGS_UPDATE":
      case "SIDE_PANEL_OPENED":
      case "APPROVAL_RESPONSE":
      case "ESCALATION_DECISION":
      case "PLAN_CONFIRMATION_RESPONSE":
      case "CLARIFICATION_RESPONSE":
      case "TOOL_EXECUTE":
      case "TOOL_RESULT":
      case "DOM_SNAPSHOT_REQUEST":
      case "DOM_SNAPSHOT_RESPONSE":
      case "NAVIGATION_RESUME":
      case "DISMISS_MODALS":
      case "DISMISS_MODALS_RESPONSE":
      case "SKIP_SUBTASK":
      case "PAUSE_AGENT":
      case "RESUME_AGENT":
      case "CONTENT_SCRIPT_READY":
      case "DOM_READY_PROBE":
      case "DOM_READY_ACK":
      case "DATA_CONTROL_REQUEST":
      case "DATA_CONTROL_RESULT":
      case "DEMO_RECORD_START":
      case "DEMO_RECORD_STOP":
      case "DEMO_ACTION_CAPTURED":
      case "GOLDEN_ACTION":
      case "GOLDEN_ANNOTATION":
      case "MANUAL_TOOL_EXECUTE":
        break;

      default: {
        const _exhaustive: never = message;
        logger.debug("ui", "Unknown message type", {
          type: (_exhaustive as RuntimeMessage).type,
        });
        break;
      }
    }
  };

  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
