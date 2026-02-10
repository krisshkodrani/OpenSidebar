import { logger } from "../utils";
import { registerTools } from "./tools";
import { AgentLoop } from "./agent";
import {
  RuntimeMessage,
  MessageSource,
  AgentStatus,
  AgentLoopState,
} from "../types";
import { workspaceManager } from "./workspaces/manager";
import { sanitizeUserInput } from "./security";
import {
  registerNavigationListeners,
  setNavigationCallbacks,
} from "./navigation";
import { registerAlarmListener } from "./keepalive";

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
  // Status callback — broadcasts status updates
  (status: AgentStatus, detail: string) => {
    chrome.runtime
      .sendMessage({
        type: "AGENT_STATUS",
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
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

// 5. State
let agentLoop: AgentLoop | null = null;
const userOpenedPanel = new Set<number>();

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
      // 0. Mark as user-initiated
      userOpenedPanel.add(tabId);

      // 1. Re-enable panel for this tab (fire and forget to preserve gesture)
      chrome.sidePanel.setOptions({
        tabId,
        path: "src/sidepanel/index.html",
        enabled: true,
      });

      // 2. Open it immediately
      await chrome.sidePanel.open({ tabId });

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
      if (userOpenedPanel.has(tabId)) {
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
        userOpenedPanel.delete(tabId);
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
  const workspace = await workspaceManager.getWorkspaceForTab(tabId);

  if (workspace) {
    // Tab IS in a workspace -> Enable and Open Side Panel
    try {
      // 1. Enable panel for this tab (in case it was disabled globally or locally)
      // We set plain options to ensure it's enabled.
      await chrome.sidePanel.setOptions({
        tabId,
        path: "src/sidepanel/index.html",
        enabled: true,
      });

      // 2. Open the panel
      // onActivated is a user gesture, so we can call open()
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
    // We disable it for this specific tab to close it.
    try {
      await chrome.sidePanel.setOptions({
        tabId,
        enabled: false,
      });
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

      logger.debug("sidebar", "Panel closed for non-workspace tab", { tabId });
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
        await chrome.runtime
          .sendMessage({
            type: "CLOSE_SIDE_PANEL",
            source: MessageSource.BACKGROUND,
            payload: {
              tabId: activeTab.id,
              windowId: activeTab.windowId,
            },
          })
          .catch(() => {});
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
    // 1. Chat
    if (
      message.source === MessageSource.SIDEPANEL &&
      message.type === "USER_CHAT"
    ) {
      handleUserChat(message.payload);
      return false;
    }

    // 2. Stop Agent
    if (message.type === "STOP_AGENT") {
      if (agentLoop) {
        agentLoop.stop();
        agentLoop = null;
      }
      // Notify content script to remove the border
      chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (tab?.id) sendAgentActivity(tab.id, false);
      }).catch(() => {});
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

async function handleUserChat(payload: { text: string; tabId: number }) {
  const { tabId } = payload;
  const text = sanitizeUserInput(payload.text);

  // 1. Get Settings (API Key)
  const settings = await chrome.storage.sync.get([
    "cerebrasApiKey",
    "openRouterApiKey",
    "model",
    "contextWindowSize",
    "maxTurns",
  ]);
  const apiKey =
    settings.cerebrasApiKey ||
    settings.openRouterApiKey;

  if (!apiKey) {
    chrome.runtime.sendMessage({
      type: "AGENT_STATUS",
      requestId: crypto.randomUUID(),
      source: MessageSource.BACKGROUND,
      payload: { status: AgentStatus.ERROR, detail: "No API Key configured." },
    });
    return;
  }

  // 2. Initialize Loop if needed
  if (!agentLoop) {
    agentLoop = new AgentLoop(apiKey, {
      onStatusUpdate: (status, detail) => {
        chrome.runtime
          .sendMessage({
            type: "AGENT_STATUS",
            requestId: crypto.randomUUID(),
            source: MessageSource.BACKGROUND,
            payload: { status, detail },
          })
          .catch(() => {});
        // Send AGENT_ACTIVITY to content script when agent starts/stops
        if (status === AgentStatus.IDLE || status === AgentStatus.ERROR) {
          sendAgentActivity(tabId, false);
        }
      },
      onMessage: (text, toolCalls) => {
        chrome.runtime
          .sendMessage({
            type: "AGENT_RESPONSE",
            requestId: crypto.randomUUID(),
            source: MessageSource.BACKGROUND,
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
            payload: { step, update },
          })
          .catch(() => {});
      },
    }, { maxContextTokens: settings.contextWindowSize || 32000, maxTurns: settings.maxTurns || 30 });
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
        payload: { includeText: true, refresh: true },
      });
      snapshot = response.payload.snapshot;
    }
  } catch (e) {
    logger.warn("agent", "Failed to get snapshot", { error: e });
  }

  // Notify content script that agent is active
  sendAgentActivity(tabId, true);

  agentLoop.start(text, tabId, snapshot);
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
  const settings = await chrome.storage.sync.get([
    "cerebrasApiKey",
    "openRouterApiKey",
    "contextWindowSize",
    "maxTurns",
  ]);
  const apiKey = settings.cerebrasApiKey || settings.openRouterApiKey;

  if (!apiKey) {
    chrome.runtime
      .sendMessage({
        type: "AGENT_STATUS",
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        payload: {
          status: AgentStatus.ERROR,
          detail: "No API Key configured.",
        },
      })
      .catch(() => {});
    return;
  }

  // Create a new agent loop with restored state
  agentLoop = new AgentLoop(apiKey, {
    onStatusUpdate: (status, detail) => {
      chrome.runtime
        .sendMessage({
          type: "AGENT_STATUS",
          requestId: crypto.randomUUID(),
          source: MessageSource.BACKGROUND,
          payload: { status, detail },
        })
        .catch(() => {});
      if (status === AgentStatus.IDLE || status === AgentStatus.ERROR) {
        sendAgentActivity(state.activeTabId, false);
      }
    },
    onMessage: (text, toolCalls) => {
      chrome.runtime
        .sendMessage({
          type: "AGENT_RESPONSE",
          requestId: crypto.randomUUID(),
          source: MessageSource.BACKGROUND,
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
          payload: { step, update },
        })
        .catch(() => {});
    },
  }, { maxContextTokens: settings.contextWindowSize || 32000, maxTurns: settings.maxTurns || 30 });

  // Get fresh snapshot from the new page
  let snapshot = undefined;
  try {
    if (state.activeTabId && state.activeTabId !== chrome.tabs.TAB_ID_NONE) {
      const response = await chrome.tabs.sendMessage(state.activeTabId, {
        type: "DOM_SNAPSHOT_REQUEST",
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        payload: { includeText: true, refresh: true },
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

  // Resume from saved state
  agentLoop.resume(state, snapshot);
}

/**
 * Restore workspaces from existing OpenSidebar tab groups on browser restart
 */
async function restoreWorkspacesFromExistingGroups() {
  try {
    const groups = await chrome.tabGroups.query({});
    const opensidebarGroups = groups.filter((g) =>
      g.title?.startsWith("OpenSidebar "),
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
