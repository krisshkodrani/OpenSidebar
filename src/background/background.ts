import { logger } from "../utils";
import { registerTools } from "./tools";
import { AgentLoop } from "./agent";
import {
  RuntimeMessage,
  MessageSource,
  AgentStatus,
  AgentLoopState,
  UserSettings,
} from "../types";
import { workspaceManager } from "./workspaces/manager";
import { sanitizeUserInput } from "./security";
import {
  registerNavigationListeners,
  setNavigationCallbacks,
} from "./navigation";
import { registerAlarmListener, startKeepalive, stopKeepalive } from "./keepalive";

logger.info("system", "Service Worker Initialized");

// 1. Initialize Tools
registerTools();

// 2. Initialize Navigation Bridge
registerNavigationListeners();
setNavigationCallbacks(
  // Resume callback — called when navigation completes
  (state: AgentLoopState, newUrl: string) => {
    handleNavigationResume(state, newUrl);
  },
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

// 4. Initialize Side Panel Behavior
// We handle panel opening manually to support toggle/auto-close behavior
chrome.sidePanel.setPanelBehavior({
  openPanelOnActionClick: false,
});

// 5. State — per-workspace agent loops
const agentLoops = new Map<string, AgentLoop>();
let pendingCloseTimer: ReturnType<typeof setTimeout> | null = null;

/** Resolve a workspace ID from the payload or by tab lookup. Falls back to "default". */
async function resolveWorkspaceId(tabId: number, provided?: string | null): Promise<string> {
  if (provided) return provided;
  const ws = await workspaceManager.getWorkspaceForTab(tabId);
  if (ws?.id) return ws.id;
  logger.debug("workspace", "No workspace found for tab, using default", { tabId });
  return "default";
}

/** Start keepalive if any loops are active */
async function ensureKeepalive(): Promise<void> {
  if (agentLoops.size > 0) await startKeepalive();
}

/** Stop keepalive only when all loops are done */
async function maybeStopKeepalive(): Promise<void> {
  if (agentLoops.size === 0) await stopKeepalive();
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
  await chrome.storage.session.set({ [USER_OPENED_KEY]: arr.filter((id) => id !== tabId) });
}

// 6. Restore workspaces on startup (check for existing OpenSidebar tab groups)
restoreWorkspacesFromExistingGroups();

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
      } catch (_e) { /* sidePanel.open fallback; error already logged above */ }
    }
  }
});

// We also rely on the side panel sending a "SIDE_PANEL_OPENED" message to trigger workspace creation
// because openPanelOnActionClick swallows the click event here.

async function handleSidePanelOpened(tabId: number, windowId: number) {
  logger.info("sidebar", "Side Panel opened - checking workspace", {
    tabId,
    windowId,
  });

  if (!tabId) {
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
    // Tab IS in a workspace -> Enable and Open Side Panel
    try {
      await chrome.sidePanel.setOptions({
        tabId,
        path: "src/sidepanel/index.html",
        enabled: true,
      });

      await chrome.sidePanel.open({ tabId });

      logger.debug("sidebar", "Panel opened for workspace tab", {
        tabId,
        workspace: workspace.name,
      });
    } catch (e) {
      logger.debug("sidebar", "Failed to open panel for workspace tab", {
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

      logger.debug("sidebar", "Panel close scheduled for non-workspace tab", { tabId });
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
  (message: RuntimeMessage, _sender, _sendResponse) => {
    // 1. Chat (or hint injection)
    if (
      message.source === MessageSource.SIDEPANEL &&
      message.type === "USER_CHAT"
    ) {
      const wsId = message.payload.workspaceId;
      (async () => {
        const resolvedWsId = await resolveWorkspaceId(message.payload.tabId, wsId);
        const loop = agentLoops.get(resolvedWsId);
        if (message.payload.isHint && loop) {
          // Inject hint into running loop — don't start a new loop
          logger.debug("agent", "User hint", { text: message.payload.text, workspaceId: resolvedWsId });
          loop.injectHint(message.payload.text);
          // If paused (e.g. awaiting plan approval), auto-resume after hint injection
          if (loop.isPaused()) {
            loop.resume();
          }
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
        // If wsId provided, stop that specific loop; otherwise stop all
        if (wsId) {
          const loop = agentLoops.get(wsId);
          if (loop) {
            loop.stop();
            agentLoops.delete(wsId);
            await maybeStopKeepalive();
          }
        } else {
          // Backwards compat: stop all loops
          for (const [id, loop] of agentLoops) {
            loop.stop();
            agentLoops.delete(id);
          }
          await maybeStopKeepalive();
        }
        // Notify content script to remove the border
        chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
          if (tab?.id) sendAgentActivity(tab.id, false);
        }).catch(() => {});
      })();
      return false;
    }

    // 3. Pause / Resume Agent
    if (message.type === "PAUSE_AGENT") {
      const wsId = message.payload?.workspaceId;
      if (wsId) {
        const loop = agentLoops.get(wsId);
        if (loop) loop.pause();
      } else {
        // Backwards compat: pause all
        for (const loop of agentLoops.values()) loop.pause();
      }
      return false;
    }
    if (message.type === "RESUME_AGENT") {
      const wsId = message.payload?.workspaceId;
      if (wsId) {
        const loop = agentLoops.get(wsId);
        if (loop) loop.resume();
      } else {
        // Backwards compat: resume all
        for (const loop of agentLoops.values()) loop.resume();
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

    return false;
  },
);

async function handleUserChat(payload: { text: string; tabId: number }, workspaceId: string) {
  const { tabId } = payload;
  const text = sanitizeUserInput(payload.text);
  logger.debug("agent", "User message", { text, tabId, workspaceId });

  // 1. Get Settings (API Keys)
  const stored = await chrome.storage.sync.get("userSettings");
  const settings = (stored.userSettings ?? {}) as UserSettings;
  const openRouterApiKey = settings.openRouterApiKey || __OPENROUTER_API_KEY__;
  const groqApiKey = settings.groqApiKey || __GROQ_API_KEY__ || undefined;
  const cerebrasApiKey = settings.cerebrasApiKey || __CEREBRAS_API_KEY__ || undefined;
  const useGroqFast = !!(settings.useGroqFast && groqApiKey);

  if (!openRouterApiKey) {
    chrome.runtime.sendMessage({
      type: "AGENT_STATUS",
      requestId: crypto.randomUUID(),
      source: MessageSource.BACKGROUND,
      workspaceId,
      payload: { status: AgentStatus.ERROR, detail: "No OpenRouter API Key configured." },
    });
    return;
  }

  const effectiveMaxTurns = settings.maxTurns || 30;

  // 2. Initialize Loop if needed
  let loop = agentLoops.get(workspaceId);
  if (!loop) {
    loop = new AgentLoop(openRouterApiKey, groqApiKey, cerebrasApiKey, useGroqFast, {
      onStatusUpdate: (status, detail) => {
        chrome.runtime
          .sendMessage({
            type: "AGENT_STATUS",
            requestId: crypto.randomUUID(),
            source: MessageSource.BACKGROUND,
            workspaceId,
            payload: { status, detail },
          })
          .catch(() => {});
        // Send AGENT_ACTIVITY to content script when agent starts/stops
        if (status === AgentStatus.IDLE || status === AgentStatus.ERROR) {
          sendAgentActivity(tabId, false);
          agentLoops.delete(workspaceId);
          maybeStopKeepalive().catch(() => {});
        }
      },
      onMessage: (text, toolCalls) => {
        chrome.runtime
          .sendMessage({
            type: "AGENT_RESPONSE",
            requestId: crypto.randomUUID(),
            source: MessageSource.BACKGROUND,
            workspaceId,
            payload: { text, toolCalls, isStreaming: false },
          })
          .catch(() => {});
      },
      onStep: (step, update) => {
        chrome.runtime
          .sendMessage({
            type: "AGENT_STEP",
            requestId: crypto.randomUUID(),
            source: MessageSource.BACKGROUND,
            workspaceId,
            payload: { step, update },
          })
          .catch(() => {});
      },
    }, {
      maxContextTokens: settings.contextWindowSize || 32000,
      maxTurns: effectiveMaxTurns,
      showElementTags: settings.showElementTags ?? false,
      confirmPlan: settings.confirmPlan ?? false,
      showSessionMetrics: settings.showSessionMetrics ?? false,
      workspaceId,
    });
    agentLoops.set(workspaceId, loop);
  }

  // 3. Start Agent
  let snapshot = undefined;
  try {
    if (tabId && tabId !== chrome.tabs.TAB_ID_NONE) {
      // First, try to inject content script if not already present
      try {
        const manifest = chrome.runtime.getManifest();
        const contentScriptPath = manifest.content_scripts?.[0]?.js?.[0];

        if (contentScriptPath) {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: [contentScriptPath],
          });
          logger.debug("agent", "Content script injected", {
            tabId,
            path: contentScriptPath,
          });
        }
        // Give script a moment to initialize
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (injectError) {
        logger.debug(
          "agent",
          "Content script injection failed or already exists",
          {
            tabId,
            error: injectError,
          },
        );
      }

      // Now request snapshot
      const response = await chrome.tabs.sendMessage(tabId, {
        type: "DOM_SNAPSHOT_REQUEST",
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        payload: { includeText: true, refresh: true, showTags: settings.showElementTags ?? false },
      });
      snapshot = response.payload.snapshot;
    }
  } catch (e) {
    logger.warn("agent", "Failed to get snapshot", { error: e });
  }

  // Notify content script that agent is active
  sendAgentActivity(tabId, true);

  // Start keepalive and run the loop
  await ensureKeepalive();
  loop.start(text, tabId, snapshot);
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
 * Resume agent loop after navigation completes.
 * Called by the navigation bridge when webNavigation.onCompleted fires.
 */
async function handleNavigationResume(state: AgentLoopState, _newUrl: string) {
  const stored = await chrome.storage.sync.get("userSettings");
  const settings = (stored.userSettings ?? {}) as UserSettings;
  const openRouterApiKey = settings.openRouterApiKey || __OPENROUTER_API_KEY__;
  const groqApiKey = settings.groqApiKey || __GROQ_API_KEY__ || undefined;
  const cerebrasApiKey = settings.cerebrasApiKey || __CEREBRAS_API_KEY__ || undefined;
  const useGroqFast = !!(settings.useGroqFast && groqApiKey);
  const workspaceId = state.workspaceId ?? "default";

  if (!openRouterApiKey) {
    chrome.runtime
      .sendMessage({
        type: "AGENT_STATUS",
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        workspaceId,
        payload: {
          status: AgentStatus.ERROR,
          detail: "No OpenRouter API Key configured.",
        },
      })
      .catch(() => {});
    return;
  }

  // Create a new agent loop with restored state
  const loop = new AgentLoop(openRouterApiKey, groqApiKey, cerebrasApiKey, useGroqFast, {
    onStatusUpdate: (status, detail) => {
      chrome.runtime
        .sendMessage({
          type: "AGENT_STATUS",
          requestId: crypto.randomUUID(),
          source: MessageSource.BACKGROUND,
          workspaceId,
          payload: { status, detail },
        })
        .catch(() => {});
      if (status === AgentStatus.IDLE || status === AgentStatus.ERROR) {
        sendAgentActivity(state.activeTabId, false);
        agentLoops.delete(workspaceId);
        maybeStopKeepalive().catch(() => {});
      }
    },
    onMessage: (text, toolCalls) => {
      chrome.runtime
        .sendMessage({
          type: "AGENT_RESPONSE",
          requestId: crypto.randomUUID(),
          source: MessageSource.BACKGROUND,
          workspaceId,
          payload: { text, toolCalls, isStreaming: false },
        })
        .catch(() => {});
    },
    onStep: (step, update) => {
      chrome.runtime
        .sendMessage({
          type: "AGENT_STEP",
          requestId: crypto.randomUUID(),
          source: MessageSource.BACKGROUND,
          workspaceId,
          payload: { step, update },
        })
        .catch(() => {});
    },
  }, {
    maxContextTokens: settings.contextWindowSize || 32000,
    maxTurns: settings.maxTurns || 30,
    showElementTags: settings.showElementTags ?? false,
    confirmPlan: settings.confirmPlan ?? false,
    showSessionMetrics: settings.showSessionMetrics ?? false,
    workspaceId,
  });
  agentLoops.set(workspaceId, loop);

  // Get fresh snapshot from the new page
  let snapshot = undefined;
  try {
    if (state.activeTabId && state.activeTabId !== chrome.tabs.TAB_ID_NONE) {
      const response = await chrome.tabs.sendMessage(state.activeTabId, {
        type: "DOM_SNAPSHOT_REQUEST",
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        payload: { includeText: true, refresh: true, showTags: settings.showElementTags ?? false },
      });
      snapshot = response.payload.snapshot;
    }
  } catch (e) {
    logger.warn("agent", "Failed to get snapshot after navigation", {
      error: e,
    });
  }

  // Notify content script that agent is active
  sendAgentActivity(state.activeTabId, true);

  // Start keepalive and resume from saved state
  await ensureKeepalive();
  loop.resumeFromNavigation(state, snapshot);
}

/**
 * Restore workspaces from existing OpenSidebar tab groups on browser restart
 */
async function restoreWorkspacesFromExistingGroups() {
  try {
    const groups = await chrome.tabGroups.query({});
    const opensidebarGroups = groups.filter(
      (g) => g.title?.startsWith("OS ") || g.title?.startsWith("OpenSidebar "),
    );

    if (opensidebarGroups.length > 0) {
      logger.info(
        "workspace",
        "Restoring workspaces from existing tab groups",
        {
          count: opensidebarGroups.length,
        },
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
