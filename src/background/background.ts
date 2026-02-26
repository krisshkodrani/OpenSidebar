import { logger } from "../utils";
import { registerTools } from "./tools";
import {
  RuntimeMessage,
  MessageSource,
  AgentStatus,
  UserSettings,
} from "../types";
import { sendMessageToMemory } from "./memory/bridge";
import { storageLogger } from "../utils/storage-logger";
import { SKILLS_STORAGE_KEY } from "../skills/types";
import { getBlockedRuleForUrl } from "../utils/site-access";
import { AgentLoop } from "./agent";
import { workspaceManager } from "./workspaces/manager";
import { sanitizeUserInput } from "./security";
import {
  registerNavigationListeners,
  setNavigationCallbacks,
} from "./navigation";
import {
  registerAlarmListener,
  startKeepalive,
  stopKeepalive,
} from "./keepalive";
import { registerContentScriptReadyListener } from "./tab-ready";
import { orchestrator } from "./orchestrator";
import { perceptionWarmup } from "./perception-warmup";
import { DemoStore } from "./demos/store";
import { RecordingSession } from "./recording-session";
import { ManualModeHandler } from "./manual-mode";

logger.info("system", "Service Worker Initialized");

// 1. Initialize Tools
registerTools();

// 1b. Track content script readiness (eliminates init sleep delays)
registerContentScriptReadyListener();

// 2. Initialize Navigation Bridge
registerNavigationListeners();
setNavigationCallbacks(
  // Resume callback — called when navigation completes
  (_state, _newUrl: string) => {},
  // Status callback — broadcasts status updates (includes workspaceId from nav state)
  (status: AgentStatus, detail: string, workspaceId?: string | null) => {
    chrome.runtime
      .sendMessage({
        type: "AGENT_STATUS",
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        workspaceId: workspaceId ?? undefined,
        payload: { status, detail },
      })
      .catch(() => {});
  },
);

// 3. Initialize Keepalive Alarm
registerAlarmListener();

// 3b. Invalidate perception warmup cache on navigation and tab close
chrome.webNavigation?.onCommitted.addListener((details) => {
  if (details.frameId === 0) perceptionWarmup.invalidate(details.tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => perceptionWarmup.invalidate(tabId));

// 4. Initialize Side Panel Behavior
// We handle panel opening manually to support toggle/auto-close behavior
chrome.sidePanel.setPanelBehavior({
  openPanelOnActionClick: false,
});

// 5. State — per-workspace agent loops
let pendingCloseTimer: ReturnType<typeof setTimeout> | null = null;
const pendingSidePanelOpens = new Set<number>();
let demoActionCounter = 0;

// Recording session (replaces old golden state)
let activeRecording: RecordingSession | null = null;

// Manual mode handlers (per workspace)
const manualHandlers = new Map<string, ManualModeHandler>();

/** Resolve a workspace ID from the payload or by tab lookup. Falls back to "default". */
async function resolveWorkspaceId(
  tabId: number,
  provided?: string | null,
): Promise<string> {
  if (provided) return provided;
  const ws = await workspaceManager.getWorkspaceForTab(tabId);
  if (ws?.id) return ws.id;
  logger.debug("workspace", "No workspace found for tab, using default", {
    tabId,
  });
  return "default";
}

/** Stop keepalive only when all loops are done */
async function maybeStopKeepalive(): Promise<void> {
  if (!orchestrator.hasActiveTasks()) await stopKeepalive();
}

// --- userOpenedPanel helpers (persisted to chrome.storage.session) ---
const USER_OPENED_KEY = "userOpenedPanel";

async function addUserOpenedPanel(tabId: number): Promise<void> {
  const data = await chrome.storage.session.get(USER_OPENED_KEY);
  const arr: number[] = data[USER_OPENED_KEY] ?? [];
  if (!arr.includes(tabId)) arr.push(tabId);
  await chrome.storage.session.set({ [USER_OPENED_KEY]: arr });
}

async function hasUserOpenedPanel(tabId: number): Promise<boolean> {
  const data = await chrome.storage.session.get(USER_OPENED_KEY);
  const arr: number[] = data[USER_OPENED_KEY] ?? [];
  return arr.includes(tabId);
}

async function removeUserOpenedPanel(tabId: number): Promise<void> {
  const data = await chrome.storage.session.get(USER_OPENED_KEY);
  const arr: number[] = data[USER_OPENED_KEY] ?? [];
  await chrome.storage.session.set({
    [USER_OPENED_KEY]: arr.filter((id) => id !== tabId),
  });
}

// 6. Restore workspaces on startup (check for existing OpenSidebar tab groups)
void (async () => {
  await restoreWorkspacesFromExistingGroups();
  await orchestrator.restoreFromCheckpoints();
  if (orchestrator.hasActiveTasks()) {
    await startKeepalive();
  }
})();

// 7. Listeners
chrome.runtime.onInstalled.addListener(() => {
  logger.info("system", "Extension Installed");
});

// Handle icon click - Always fires now since openPanelOnActionClick is false
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    logger.info("sidebar", "Icon clicked", { tabId: tab.id });
    const tabId = tab.id;
    try {
      // 0. Re-enable + open panel FIRST (must stay synchronous with gesture)
      chrome.sidePanel.setOptions({
        tabId,
        path: "src/sidepanel/index.html",
        enabled: true,
      });
      await chrome.sidePanel.open({ tabId });

      // 1. Mark as user-initiated AFTER open succeeds (still before SIDE_PANEL_OPENED arrives)
      await addUserOpenedPanel(tabId);

      // We can call the same handler as the side panel message, or just let the side panel message trigger it.
      // However, if the side panel message fires, we might double-create if we are not careful.
      // But handleSidePanelOpened checks if workspace exists first.

      // Let's rely on the side panel "SIDE_PANEL_OPENED" message first?
      // Or should we force it here?
      // If we open the panel, the panel script runs -> "SIDE_PANEL_OPENED" sent -> workspace created.
      // So we just need to open it.
    } catch (error) {
      logger.error("sidebar", "Failed to handle icon click", { error });
      // Fallback: This is the user gesture path.
      try {
        await chrome.sidePanel.open({ tabId });
      } catch (_e) {
        /* sidePanel.open fallback; error already logged above */
      }
    }
  }
});

// We also rely on the side panel sending a "SIDE_PANEL_OPENED" message to trigger workspace creation
// because openPanelOnActionClick swallows the click event here.

async function handleSidePanelOpened(tabId: number, windowId: number) {
  if (pendingSidePanelOpens.has(tabId)) return; // already processing
  pendingSidePanelOpens.add(tabId);

  logger.info("sidebar", "Side Panel opened - checking workspace", {
    tabId,
    windowId,
  });

  if (!tabId) {
    pendingSidePanelOpens.delete(tabId);
    logger.error("workspace", "No tab ID in side panel open handler");
    return;
  }

  try {
    // Chrome opens panel automatically via setPanelBehavior
    // Just ensure workspace exists for this tab
    const existingWorkspace = await workspaceManager.getWorkspaceForTab(tabId);

    if (existingWorkspace) {
      logger.debug("workspace", "Tab already in workspace", {
        tabId,
        workspace: existingWorkspace.name,
      });
      // Fire-and-forget: proactively warm perception cache for this tab
      perceptionWarmup.warmup(tabId);
    } else {
      // ONLY create if user explicitly opened it
      if (await hasUserOpenedPanel(tabId)) {
        logger.info(
          "workspace",
          "Creating new workspace for tab (User Initiated)",
          { tabId },
        );
        const workspaceName = workspaceManager.getNextWorkspaceName();
        const workspaceColor = workspaceManager.getNextColor();

        try {
          const workspace = await workspaceManager.createWorkspace(
            workspaceName,
            workspaceColor,
            tabId,
          );
          logger.info("workspace", "Auto-created workspace", {
            name: workspaceName,
            id: workspace.id,
            tabId,
          });
          // Fire-and-forget: proactively warm perception cache for this tab
          perceptionWarmup.warmup(tabId);
        } catch (createError) {
          logger.error("workspace", "Failed to create workspace", {
            tabId,
            error: createError,
          });
        }
        // Consumed the flag
        await removeUserOpenedPanel(tabId);
      } else {
        logger.warn(
          "workspace",
          "Panel opened without user interaction (switching tabs?) - CLOSING",
          { tabId },
        );

        await chrome.sidePanel.setOptions({
          tabId,
          enabled: false,
        });

        if (windowId) {
          // Force close via message (workaround for setOptions not closing open panels)
          await chrome.runtime
            .sendMessage({
              type: "CLOSE_SIDE_PANEL",
              source: MessageSource.BACKGROUND,
              payload: { tabId, windowId },
            })
            .catch(() => {
              // Ignore errors (e.g. no receiver if panel is already closed)
            });
        }
      }
    }
  } catch (error) {
    logger.error("sidebar", "Error in icon click handler", { tabId, error });
  } finally {
    pendingSidePanelOpens.delete(tabId);
  }
}

// Handle tab activation - show/hide panel based on workspace status
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  // Cancel any pending close from a previous rapid tab switch
  if (pendingCloseTimer) {
    clearTimeout(pendingCloseTimer);
    pendingCloseTimer = null;
  }

  const workspace = await workspaceManager.getWorkspaceForTab(tabId);

  if (workspace) {
    // Tab IS in a workspace -> Enable side panel, but do not auto-open.
    // Per-tab sidebar policy: user must click extension icon to open.
    try {
      await chrome.sidePanel.setOptions({
        tabId,
        path: "src/sidepanel/index.html",
        enabled: true,
      });

      logger.debug("sidebar", "Panel enabled for workspace tab (manual open)", {
        tabId,
        workspace: workspace.name,
      });
    } catch (e) {
      logger.debug("sidebar", "Failed to enable panel for workspace tab", {
        tabId,
        error: e,
      });
    }
  } else {
    // Tab is NOT in a workspace -> Disable/Close Side Panel
    try {
      await chrome.sidePanel.setOptions({
        tabId,
        enabled: false,
      });
      // Debounce the close message so rapid workspace→non-workspace→workspace
      // switches don't kill the panel with a stale CLOSE_SIDE_PANEL
      pendingCloseTimer = setTimeout(() => {
        pendingCloseTimer = null;
        chrome.runtime
          .sendMessage({
            type: "CLOSE_SIDE_PANEL",
            source: MessageSource.BACKGROUND,
            payload: { tabId, windowId },
          })
          .catch(() => {});
      }, 150);

      logger.debug("sidebar", "Panel close scheduled for non-workspace tab", {
        tabId,
      });
    } catch (e) {
      logger.debug("sidebar", "Failed to close panel for non-workspace tab", {
        tabId,
        error: e,
      });
    }
  }
});

// Cleanup when tabs are closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  // Workspace auto-delete is handled by WorkspaceManager
  logger.debug("sidebar", "Tab closed", { tabId });

  // Cancel any pending close from onActivated (the tab switch after removal
  // will be handled fresh below or by the next onActivated)
  if (pendingCloseTimer) {
    clearTimeout(pendingCloseTimer);
    pendingCloseTimer = null;
  }

  // Robustness: Check if the *currently active* tab is in a workspace.
  // This handles edge cases where tab closure triggers a switch to a non-workspace tab
  // but onActivated didn't catch it (e.g. race conditions or group deletions).
  try {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (activeTab?.id) {
      const workspace = await workspaceManager.getWorkspaceForTab(activeTab.id);
      if (!workspace) {
        logger.debug(
          "sidebar",
          "Active tab not in workspace after tab removal - enforcing close",
          { activeTabId: activeTab.id },
        );
        await chrome.sidePanel.setOptions({
          tabId: activeTab.id,
          enabled: false,
        });
        // Debounce close message (same as onActivated)
        pendingCloseTimer = setTimeout(() => {
          pendingCloseTimer = null;
          chrome.runtime
            .sendMessage({
              type: "CLOSE_SIDE_PANEL",
              source: MessageSource.BACKGROUND,
              payload: {
                tabId: activeTab.id!,
                windowId: activeTab.windowId,
              },
            })
            .catch(() => {});
        }, 150);
      }
    }
  } catch (e) {
    logger.warn("sidebar", "Failed to enforce panel state on tab removal", {
      error: e,
    });
  }
});

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, _sender, sendResponse) => {
    // 1. Chat (or hint injection)
    if (
      message.source === MessageSource.SIDEPANEL &&
      message.type === "USER_CHAT"
    ) {
      const wsId = message.payload.workspaceId;
      (async () => {
        const resolvedWsId = await resolveWorkspaceId(
          message.payload.tabId,
          wsId,
        );
        if (message.payload.isFeedback) {
          logger.debug("agent", "User feedback", {
            text: message.payload.text,
            workspaceId: resolvedWsId,
          });
          orchestrator.injectFeedback(resolvedWsId, message.payload.text);
        } else {
          handleUserChat(message.payload, resolvedWsId);
        }
      })();
      return false;
    }

    // 2. Stop Agent
    if (message.type === "STOP_AGENT") {
      const wsId = message.payload?.workspaceId;
      (async () => {
        await orchestrator.stopTask(wsId ?? undefined);
        await maybeStopKeepalive();
        // Notify content script to remove the border
        chrome.tabs
          .query({ active: true, currentWindow: true })
          .then(([tab]) => {
            if (tab?.id) sendAgentActivity(tab.id, false);
          })
          .catch(() => {});
      })();
      return false;
    }

    // 3. Pause / Resume Agent
    if (message.type === "PAUSE_AGENT") {
      const wsId = message.payload?.workspaceId;
      orchestrator.pauseTask(wsId ?? undefined);
      return false;
    }
    if (message.type === "RESUME_AGENT") {
      const wsId = message.payload?.workspaceId;
      orchestrator.resumeTask(wsId ?? undefined);
      return false;
    }
    if (
      message.source === MessageSource.SIDEPANEL &&
      message.type === "SKIP_SUBTASK"
    ) {
      const wsId = message.workspaceId ?? undefined;
      void orchestrator.skipSubtask(wsId, message.payload.taskId).then((ok) => {
        if (!ok) {
          logger.warn("orchestrator", "Skip subtask request ignored", {
            workspaceId: wsId,
            taskId: message.payload.taskId,
          });
        }
      });
      return false;
    }

    // 3b. Approval decision from side panel
    if (
      message.source === MessageSource.SIDEPANEL &&
      message.type === "APPROVAL_RESPONSE"
    ) {
      AgentLoop.resolveApproval(
        message.payload.approvalId,
        message.payload.approved,
      );
      return false;
    }

    if (
      message.source === MessageSource.SIDEPANEL &&
      message.type === "ESCALATION_DECISION"
    ) {
      const accepted = orchestrator.resolveEscalationDecision(message.payload);
      if (!accepted) {
        logger.warn("orchestrator", "Unknown escalation decision ignored", {
          escalationId: message.payload.escalationId,
          optionId: message.payload.optionId,
        });
      }
      return false;
    }

    // --- Manual Mode ---
    if (
      message.source === MessageSource.SIDEPANEL &&
      message.type === "MANUAL_TOOL_EXECUTE"
    ) {
      const wsId = message.workspaceId;
      (async () => {
        try {
          // Reject if agent is running
          if (orchestrator.hasActiveTasks()) {
            chrome.runtime
              .sendMessage({
                type: "MANUAL_TOOL_RESULT",
                requestId: crypto.randomUUID(),
                source: MessageSource.BACKGROUND,
                workspaceId: wsId ?? undefined,
                payload: {
                  command: message.payload.command,
                  success: false,
                  result: "Cannot use manual commands while agent is running. Stop the agent first.",
                  durationMs: 0,
                },
              })
              .catch(() => {});
            return;
          }

          const resolvedWsId = await resolveWorkspaceId(
            message.payload.tabId,
            wsId,
          );

          // Get or create handler for this workspace
          let handler = manualHandlers.get(resolvedWsId);
          if (!handler) {
            handler = new ManualModeHandler();
            manualHandlers.set(resolvedWsId, handler);
          }

          const result = await handler.handleCommand(message.payload, resolvedWsId);

          chrome.runtime
            .sendMessage({
              type: "MANUAL_TOOL_RESULT",
              requestId: crypto.randomUUID(),
              source: MessageSource.BACKGROUND,
              workspaceId: resolvedWsId,
              payload: result,
            })
            .catch(() => {});
        } catch (e: any) {
          logger.error("manual", "Manual command failed", { error: e.message });
          chrome.runtime
            .sendMessage({
              type: "MANUAL_TOOL_RESULT",
              requestId: crypto.randomUUID(),
              source: MessageSource.BACKGROUND,
              workspaceId: wsId ?? undefined,
              payload: {
                command: message.payload.command,
                success: false,
                result: `Error: ${e.message}`,
                durationMs: 0,
              },
            })
            .catch(() => {});
        }
      })();
      return false;
    }

    // --- Demo Recording ---
    if (
      message.source === MessageSource.SIDEPANEL &&
      message.type === "DEMO_RECORD_START"
    ) {
      const tabId = message.payload.tabId;
      demoActionCounter = 0;

      // Create RecordingSession
      (async () => {
        try {
          const tab = await chrome.tabs.get(tabId);
          const startUrl = tab.url || "";
          const wsId = await resolveWorkspaceId(tabId, null);
          activeRecording = new RecordingSession(
            `Recording ${new Date().toLocaleString()}`,
            startUrl,
            wsId,
          );
        } catch {
          activeRecording = new RecordingSession(
            `Recording ${new Date().toLocaleString()}`,
            "",
          );
        }

        // Tell content script to start capturing (always golden mode)
        chrome.tabs
          .sendMessage(tabId, {
            type: "DEMO_RECORD_START",
            requestId: message.requestId,
            source: MessageSource.BACKGROUND,
            payload: { golden: true },
          })
          .then(() => {
            chrome.runtime
              .sendMessage({
                type: "DEMO_RECORD_STATUS",
                requestId: crypto.randomUUID(),
                source: MessageSource.BACKGROUND,
                payload: {
                  active: true,
                  actionCount: 0,
                  sessionId: activeRecording?.sessionId,
                },
              })
              .catch(() => {});
          })
          .catch((err) => {
            logger.warn("demos", "Failed to start recording", {
              error: err?.message,
            });
          });
      })();
      return false;
    }

    if (
      message.source === MessageSource.SIDEPANEL &&
      message.type === "DEMO_RECORD_STOP"
    ) {
      const tabId = message.payload.tabId;
      const demoName = message.payload.name;
      const {
        description: demoDesc,
        goal: demoGoal,
        outcomeSignal: demoOutcome,
      } = message.payload;

      chrome.tabs.sendMessage(
        tabId,
        {
          type: "DEMO_RECORD_STOP",
          requestId: message.requestId,
          source: MessageSource.BACKGROUND,
          payload: { golden: true },
        },
        async (response: any) => {
          try {
            const actions = response?.actions || [];
            const tab = await chrome.tabs.get(tabId);
            const demoStore = new DemoStore();
            const demo = await demoStore.saveDemonstration({
              name: demoName,
              description: demoDesc,
              goal: demoGoal,
              outcomeSignal: demoOutcome,
              actions,
              url: tab.url || "",
            });

            // Notify side panel: recording stopped
            chrome.runtime
              .sendMessage({
                type: "DEMO_RECORD_STATUS",
                requestId: crypto.randomUUID(),
                source: MessageSource.BACKGROUND,
                payload: { active: false, actionCount: actions.length },
              })
              .catch(() => {});
            chrome.runtime
              .sendMessage({
                type: "DEMO_SAVED",
                requestId: crypto.randomUUID(),
                source: MessageSource.BACKGROUND,
                payload: { demo },
              })
              .catch(() => {});

            // Finalize via TraceRecorder (resilient queueing)
            if (activeRecording) {
              try {
                const result = await activeRecording.finalize(demoName, demoGoal);
                logger.info("recording", "Recording saved via TraceRecorder", {
                  sessionId: result.sessionId,
                  turnCount: result.turnCount,
                  durationMs: result.durationMs,
                });
                chrome.runtime
                  .sendMessage({
                    type: "RECORDING_SAVED",
                    requestId: crypto.randomUUID(),
                    source: MessageSource.BACKGROUND,
                    payload: {
                      sessionId: result.sessionId,
                      turnCount: result.turnCount,
                      name: demoName,
                    },
                  })
                  .catch(() => {});
              } catch (err: any) {
                logger.error("recording", "Failed to finalize recording", {
                  error: err?.message,
                });
              }
            }
          } catch (err: any) {
            logger.error("demos", "Failed to save demo", {
              error: err?.message,
            });
            chrome.runtime
              .sendMessage({
                type: "DEMO_RECORD_STATUS",
                requestId: crypto.randomUUID(),
                source: MessageSource.BACKGROUND,
                payload: { active: false, actionCount: 0 },
              })
              .catch(() => {});
          } finally {
            activeRecording = null;
          }
        },
      );
      return true; // async response via callback
    }

    if (
      message.source === MessageSource.CONTENT &&
      message.type === "DEMO_ACTION_CAPTURED"
    ) {
      // Forward action count to side panel
      demoActionCounter++;
      chrome.runtime
        .sendMessage({
          type: "DEMO_RECORD_STATUS",
          requestId: crypto.randomUUID(),
          source: MessageSource.BACKGROUND,
          payload: { active: true, actionCount: demoActionCounter },
        })
        .catch(() => {});
      return false;
    }

    // Golden action from content script (enriched with snapshot + tag ID)
    if (
      message.source === MessageSource.CONTENT &&
      message.type === "GOLDEN_ACTION"
    ) {
      if (activeRecording) {
        activeRecording
          .recordAction(message.payload.goldenAction)
          .catch((err) => {
            logger.warn("recording", "Failed to record action", {
              error: err?.message,
            });
          });
      }
      demoActionCounter++;
      chrome.runtime
        .sendMessage({
          type: "DEMO_RECORD_STATUS",
          requestId: crypto.randomUUID(),
          source: MessageSource.BACKGROUND,
          payload: {
            active: true,
            actionCount: demoActionCounter,
            sessionId: activeRecording?.sessionId,
          },
        })
        .catch(() => {});
      return false;
    }

    // Golden annotation from side panel
    if (
      message.source === MessageSource.SIDEPANEL &&
      message.type === "GOLDEN_ANNOTATION"
    ) {
      if (activeRecording) {
        const stubSnapshot = {
          title: "",
          url: "",
          elements: [] as any[],
          visibleContent: "",
          viewport: { width: 0, height: 0 },
          scroll: { x: 0, y: 0, maxY: 0 },
        };
        activeRecording
          .recordAction({
            action: {
              type: "annotate",
              timestamp: Date.now(),
              url: "",
              value: message.payload.text,
            },
            tagId: null,
            snapshot: stubSnapshot,
          })
          .catch((err) => {
            logger.warn("recording", "Failed to record annotation", {
              error: err?.message,
            });
          });
        demoActionCounter++;
        chrome.runtime
          .sendMessage({
            type: "DEMO_RECORD_STATUS",
            requestId: crypto.randomUUID(),
            source: MessageSource.BACKGROUND,
            payload: {
              active: true,
              actionCount: demoActionCounter,
              sessionId: activeRecording?.sessionId,
            },
          })
          .catch(() => {});
      }
      return false;
    }

    // 4. Side Panel Opened (Mount)
    if (
      message.source === MessageSource.SIDEPANEL &&
      message.type === "SIDE_PANEL_OPENED"
    ) {
      handleSidePanelOpened(message.payload.tabId, message.payload.windowId);
      return false;
    }

    if (
      message.source === MessageSource.SIDEPANEL &&
      message.type === "DATA_CONTROL_REQUEST"
    ) {
      (async () => {
        try {
          const action = message.payload.action;
          if (action === "clear_memory") {
            await sendMessageToMemory({ action: "clear" });
            sendResponse({
              ok: true,
              detail: "Long-term memory cleared.",
            });
            return;
          }
          if (action === "clear_logs") {
            await storageLogger.clear();
            sendResponse({
              ok: true,
              detail: "Local extension logs cleared.",
            });
            return;
          }
          if (action === "clear_chat_history") {
            const localData = await chrome.storage.local.get(null);
            const keys = Object.keys(localData).filter(
              (k) => k === "chatMessages" || k.startsWith("chatMessages:"),
            );
            if (keys.length > 0) await chrome.storage.local.remove(keys);
            sendResponse({
              ok: true,
              detail: "Chat history cleared for all workspaces.",
            });
            return;
          }
          if (action === "clear_local_data") {
            await chrome.storage.local.remove([
              "opensidebar:savedPrompts",
              "opensidebar:savedPromptsSeeded",
              "opensidebar:savedPromptsVersion",
              SKILLS_STORAGE_KEY,
              "opensidebar:demos:v1",
              "opensidebar_logs",
              "opensidebar:workspaces",
              "opensidebar:nextWorkspaceNum",
              "opensidebar:checkpoints:v1",
            ]);
            sendResponse({
              ok: true,
              detail: "Local extension data cleared.",
            });
            return;
          }
          sendResponse({ ok: false, detail: "Unknown data control action." });
        } catch (error: any) {
          sendResponse({
            ok: false,
            detail: `Failed: ${error?.message ?? String(error)}`,
          });
        }
      })();
      return true;
    }

    return false;
  },
);

async function handleUserChat(
  payload: { text: string; tabId: number },
  workspaceId: string,
) {
  const { tabId } = payload;
  const text = sanitizeUserInput(payload.text);
  logger.debug("agent", "User message", { text, tabId, workspaceId });

  // 1. Get Settings (API Keys)
  const stored = await chrome.storage.sync.get("userSettings");
  const settings = (stored.userSettings ?? {}) as UserSettings;
  const openRouterApiKey = settings.openRouterApiKey || __OPENROUTER_API_KEY__;
  const groqApiKey = settings.groqApiKey || __GROQ_API_KEY__ || undefined;
  const cerebrasApiKey =
    settings.cerebrasApiKey || __CEREBRAS_API_KEY__ || undefined;

  if (!openRouterApiKey) {
    chrome.runtime.sendMessage({
      type: "AGENT_STATUS",
      requestId: crypto.randomUUID(),
      source: MessageSource.BACKGROUND,
      workspaceId,
      payload: {
        status: AgentStatus.ERROR,
        detail: "No OpenRouter API Key configured.",
      },
    });
    return;
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    const tabUrl = tab.url ?? "";
    const blocked = getBlockedRuleForUrl(tabUrl, settings);
    if (blocked) {
      chrome.runtime.sendMessage({
        type: "AGENT_STATUS",
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        workspaceId,
        payload: {
          status: AgentStatus.ERROR,
          detail: `Blocked on ${blocked.host} by site access rule "${blocked.rule}".`,
        },
      });
      return;
    }
  } catch {
    // Ignore tab lookup failures and proceed with normal flow.
  }

  // Notify content script that agent is active
  sendAgentActivity(tabId, true);

  await startKeepalive();
  try {
    await orchestrator.startTask({
      query: text,
      tabId,
      workspaceId,
      settings,
      openRouterApiKey,
      groqApiKey,
      cerebrasApiKey,
    });
  } finally {
    sendAgentActivity(tabId, false);
    await maybeStopKeepalive();
  }
}

/** Send AGENT_ACTIVITY message to the content script on a specific tab */
function sendAgentActivity(tabId: number, active: boolean) {
  if (!tabId || tabId === chrome.tabs.TAB_ID_NONE) return;
  chrome.tabs
    .sendMessage(tabId, {
      type: "AGENT_ACTIVITY",
      requestId: crypto.randomUUID(),
      source: MessageSource.BACKGROUND,
      payload: { active },
    })
    .catch(() => {});
}

/**
 * Restore workspaces from existing OpenSidebar tab groups on browser restart.
 * 1. Validate stored workspaces (remove stale ones, sync tabIds/name/color).
 * 2. Restore any untracked groups that match the "OS N" / "OpenSidebar N" naming.
 */
async function restoreWorkspacesFromExistingGroups() {
  try {
    // First, validate stored workspaces against Chrome state
    await workspaceManager.validateWorkspaces();

    // Then, discover any orphaned groups with our naming convention
    const groups = await chrome.tabGroups.query({});
    const opensidebarGroups = groups.filter(
      (g) => g.title?.startsWith("OS ") || g.title?.startsWith("OpenSidebar "),
    );

    if (opensidebarGroups.length > 0) {
      logger.info(
        "workspace",
        "Restoring workspaces from existing tab groups",
        { count: opensidebarGroups.length },
      );

      for (const group of opensidebarGroups) {
        await workspaceManager.restoreWorkspaceFromGroup(group);
      }
    }
  } catch (error) {
    logger.warn("workspace", "Failed to restore workspaces from groups", {
      error,
    });
  }
}

