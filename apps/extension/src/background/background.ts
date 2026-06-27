import { logger } from "../utils";
import { registerTools } from "./tools";
import {
  RuntimeMessage,
  MessageSource,
  AgentStatus,
  UserSettings,
  ChatEntry,
  SkillRecordingEvent,
} from "../types";
import { loadSettings } from "../utils/settings-storage";
import { startBrowserBridge } from "./browser-bridge";
import {
  formatMissingProviderKeys,
  getProviderKeyStatus,
} from "../utils/provider-keys";
import { storageLogger } from "../utils/storage-logger";
import { getBlockedRuleForUrl } from "../utils/site-access";
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
import { resolveValidTabId } from "./infrastructure/tab-resolution";
import { isUiMessageSource } from "./ui-message-source";
import { orchestrator } from "./orchestrator";
import { PassiveMonitorController } from "./passive-monitor";
import { transcribeWithGroq } from "./speech/groq";
import { TabAudioCaptureController } from "./speech/tab-audio";
import { perceptionWarmup } from "./perception-warmup";
import { agentNotifications } from "./notifications";
import {
  isE2ESeedPendingInteractionMessage,
  isE2ETestApiEnabled,
} from "./e2e-test-api";
import {
  RECORD_SKILL_INTRO_DISMISSED_KEY,
  WEBSITE_SKILLS_STORAGE_KEY,
  deleteUserWebsiteSkill,
  findMatchingUserWebsiteSkill,
  formatSkillRecordingTimeline,
  formatUserWebsiteSkillGuidance,
  generateWebsiteSkillDraft,
  loadUserWebsiteSkills,
  saveUserWebsiteSkill,
} from "../utils/website-skills";
import { shouldShowPageActivityCue } from "./page-activity-cue";

/** Cached settings — populated on side panel open, invalidated on storage change. */
let cachedSettings: UserSettings | null = null;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.userSettings) cachedSettings = null;
  if (area === "local") cachedSettings = null; // API keys stored in local
});

logger.info("system", "Service Worker Initialized");

const passiveMonitor = new PassiveMonitorController({
  isWorkspaceActive: (workspaceId) => orchestrator.hasActiveTask(workspaceId),
  pageActivity: (event) => {
    chrome.tabs
      .sendMessage(event.tabId, {
        type: "PASSIVE_MONITOR_PAGE_ACTIVITY",
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        workspaceId: event.workspaceId,
        payload: {
          active: event.active,
          status: event.status,
          sessionId: event.sessionId,
        },
      } satisfies RuntimeMessage)
      .catch(() => {});
  },
});

const tabAudioCapture = new TabAudioCaptureController({
  loadSettings,
  updateTranscript: (workspaceId, transcript) =>
    passiveMonitor.updateAudioTranscript(workspaceId, transcript),
  setStatusDetail: (workspaceId, detail) =>
    passiveMonitor.setStatusDetail(workspaceId, detail),
});

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
agentNotifications.registerHandlers();

// 3b. Invalidate perception warmup cache on navigation and tab close
chrome.webNavigation?.onCommitted.addListener((details) => {
  if (details.frameId === 0) {
    perceptionWarmup.invalidate(details.tabId);
    tabAudioCapture.clearTranscriptsForTab(details.tabId);
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  perceptionWarmup.invalidate(tabId);
  passiveMonitor.stopSessionsForTab(tabId);
  tabAudioCapture.stopSessionsForTab(tabId);
  void maybeStopKeepalive();
});

// 4. Initialize Side Panel Behavior
// We handle panel opening manually to support toggle/auto-close behavior
chrome.sidePanel.setPanelBehavior({
  openPanelOnActionClick: false,
});

// 5. State — per-workspace agent loops
const pendingSidePanelOpens = new Set<number>();
const pendingUserChat = new Set<string>(); // per-workspace guard against concurrent USER_CHAT
type UserChatPayload = Extract<RuntimeMessage, { type: "USER_CHAT" }>["payload"];
const queuedUserChat = new Map<string, UserChatPayload>(); // latest follow-up per workspace
const e2eOverlayTabsByWorkspace = new Map<string, number>();
const MAX_WORKSPACE_CONTEXT_MESSAGES = 8;
const MAX_WORKSPACE_CONTEXT_CHARS = 1600;
const MAX_WORKSPACE_CONTEXT_LINE_CHARS = 260;
const skillRecordingSessions = new Map<
  number,
  {
    tabId: number;
    startedAt: number;
    url: string;
    events: SkillRecordingEvent[];
  }
>();

const originalRuntimeSendMessage =
  chrome.runtime.sendMessage.bind(chrome.runtime);

function isE2EWorkspaceId(workspaceId: string | null | undefined): boolean {
  return typeof workspaceId === "string" && workspaceId.startsWith("e2e-");
}

function rememberE2EOverlayTarget(
  workspaceId: string,
  tabId: number,
): void {
  if (!isE2EWorkspaceId(workspaceId)) return;
  if (!tabId || tabId === chrome.tabs.TAB_ID_NONE) return;
  e2eOverlayTabsByWorkspace.set(workspaceId, tabId);
}

function mirrorRuntimeMessageToE2EOverlay(message: unknown): void {
  if (!message || typeof message !== "object") return;
  const runtimeMessage = message as Partial<RuntimeMessage> & {
    payload?: { workspaceId?: string | null; tabId?: number };
  };
  if (runtimeMessage.source !== MessageSource.BACKGROUND) return;

  const workspaceId =
    typeof runtimeMessage.workspaceId === "string"
      ? runtimeMessage.workspaceId
      : runtimeMessage.payload?.workspaceId;
  if (!workspaceId || !isE2EWorkspaceId(workspaceId)) return;

  const tabId =
    e2eOverlayTabsByWorkspace.get(workspaceId) ??
    runtimeMessage.payload?.tabId;
  if (!tabId || tabId === chrome.tabs.TAB_ID_NONE) return;

  chrome.tabs.sendMessage(tabId, message).catch(() => {});
}

try {
  chrome.runtime.sendMessage = ((...args: unknown[]) => {
    const maybeMessage =
      args.length === 1
        ? args[0]
        : args.find(
            (arg) =>
              arg &&
              typeof arg === "object" &&
              typeof (arg as { type?: unknown }).type === "string",
          );
    mirrorRuntimeMessageToE2EOverlay(maybeMessage);
    return originalRuntimeSendMessage(...(args as [any]));
  }) as typeof chrome.runtime.sendMessage;
} catch (error) {
  logger.warn("sidebar", "Failed to install E2E overlay message mirror", {
    error,
  });
}

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

function broadcastUserChatAccepted(
  message: Extract<RuntimeMessage, { type: "USER_CHAT" }>,
  workspaceId: string,
): void {
  const text = message.payload.text.trim();
  if (!text) return;

  chrome.runtime
    .sendMessage({
      type: "USER_CHAT_ACCEPTED",
      requestId: crypto.randomUUID(),
      source: MessageSource.BACKGROUND,
      workspaceId,
      payload: {
        text,
        tabId: message.payload.tabId,
        workspaceId,
        messageId: message.payload.messageId ?? message.requestId,
        timestamp: message.payload.timestamp ?? Date.now(),
        isFeedback: message.payload.isFeedback,
      },
    })
    .catch(() => {});
}

/** Stop keepalive only when all loops are done */
async function maybeStopKeepalive(): Promise<void> {
  if (!orchestrator.hasActiveTasks() && !passiveMonitor.hasActiveSessions()) {
    await stopKeepalive();
  }
}

// --- userOpenedPanel helpers (persisted to chrome.storage.session) ---
const USER_OPENED_KEY = "userOpenedPanel";
const userOpenedPanelTabs = new Set<number>();

async function addUserOpenedPanel(tabId: number): Promise<void> {
  userOpenedPanelTabs.add(tabId);
  const data = await chrome.storage.session.get(USER_OPENED_KEY);
  const arr: number[] = data[USER_OPENED_KEY] ?? [];
  if (!arr.includes(tabId)) arr.push(tabId);
  await chrome.storage.session.set({ [USER_OPENED_KEY]: arr });
}

async function hasUserOpenedPanel(tabId: number): Promise<boolean> {
  if (userOpenedPanelTabs.has(tabId)) return true;
  const data = await chrome.storage.session.get(USER_OPENED_KEY);
  const arr: number[] = data[USER_OPENED_KEY] ?? [];
  return arr.includes(tabId);
}

async function removeUserOpenedPanel(tabId: number): Promise<void> {
  userOpenedPanelTabs.delete(tabId);
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
  await orchestrator.processDurableRunControlRequests();
  if (orchestrator.hasActiveTasks()) {
    await startKeepalive();
  }
  // RFC LP-8 M2: connect to the browser MCP host when configured (default-off).
  await startBrowserBridge();
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
      // Mark the user gesture before opening so a fast side-panel mount cannot
      // race ahead of the SIDE_PANEL_OPENED handler's user-opened check. Do
      // not await storage here; chrome.sidePanel.open needs the click gesture.
      void addUserOpenedPanel(tabId).catch((error) => {
        logger.warn("sidebar", "Failed to persist side panel open marker", {
          tabId,
          error,
        });
      });
      // 0. Re-enable + open panel FIRST (must stay synchronous with gesture)
      chrome.sidePanel.setOptions({
        tabId,
        path: "src/sidepanel/index.html",
        enabled: true,
      });
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
      } catch (_e) {
        await removeUserOpenedPanel(tabId);
        /* sidePanel.open fallback; error already logged above */
      }
    }
  }
});

// We also rely on the side panel sending a "SIDE_PANEL_OPENED" message to trigger workspace creation
// because openPanelOnActionClick swallows the click event here.

async function handleSidePanelOpened(
  tabId: number,
  windowId: number,
): Promise<string | null> {
  if (pendingSidePanelOpens.has(tabId)) return null; // already processing
  pendingSidePanelOpens.add(tabId);

  logger.info("sidebar", "Side Panel opened - checking workspace", {
    tabId,
    windowId,
  });

  if (!tabId) {
    pendingSidePanelOpens.delete(tabId);
    logger.error("workspace", "No tab ID in side panel open handler");
    return null;
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
      // Pre-cache settings + warm perception (fire-and-forget)
      loadSettings().then((s) => {
        if (s) cachedSettings = s;
      });
      perceptionWarmup.warmup(tabId);
      return existingWorkspace.id;
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
          // Pre-cache settings + warm perception (fire-and-forget)
          loadSettings().then((s) => {
            if (s) cachedSettings = s;
          });
          perceptionWarmup.warmup(tabId);
          // Consumed the flag
          await removeUserOpenedPanel(tabId);
          return workspace.id;
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
  return null;
}

// Handle tab activation - show/hide panel based on workspace status
chrome.tabs.onActivated.addListener(async ({ tabId, windowId: _windowId }) => {
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
      // Warm perception on tab switch so first message is instant
      perceptionWarmup.warmup(tabId);
    } catch (e) {
      logger.debug("sidebar", "Failed to enable panel for workspace tab", {
        tabId,
        error: e,
      });
    }
  } else {
    // Tab is NOT in a workspace -> Disable side panel for this tab.
    // We intentionally do NOT send CLOSE_SIDE_PANEL / globalThis.close() here.
    // Chrome hides the panel via setOptions({ enabled: false }), but the React
    // app stays alive in memory so Zustand state (messages, progress, overlays)
    // survives tab switches. The panel reappears with full context when the
    // user returns to a workspace tab.
    try {
      await chrome.sidePanel.setOptions({
        tabId,
        enabled: false,
      });

      logger.debug("sidebar", "Panel disabled for non-workspace tab", {
        tabId,
      });
    } catch (e) {
      logger.debug("sidebar", "Failed to disable panel for non-workspace tab", {
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

  // Robustness: If the now-active tab is not in a workspace, disable the
  // side panel for it. Same as onActivated — we do NOT destroy the panel,
  // just let Chrome hide it so state is preserved across tab switches.
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
          "Active tab not in workspace after tab removal - disabling panel",
          { activeTabId: activeTab.id },
        );
        await chrome.sidePanel.setOptions({
          tabId: activeTab.id,
          enabled: false,
        });
      }
    }
  } catch (e) {
    logger.warn("sidebar", "Failed to enforce panel state on tab removal", {
      error: e,
    });
  }
});

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, sender, sendResponse) => {
    if (tabAudioCapture.isOffscreenMessage(message)) {
      tabAudioCapture.handleMessage(message);
      return false;
    }

    if (isE2ESeedPendingInteractionMessage(message)) {
      const payload = message.payload;
      (async () => {
        try {
          if (!(await isE2ETestApiEnabled())) {
            sendResponse({
              ok: false,
              detail: "E2E test API is disabled",
            });
            return;
          }
          const result = await orchestrator.seedE2EPendingInteraction(payload);
          sendResponse({ ok: true, ...result });
        } catch (error: any) {
          sendResponse({
            ok: false,
            detail: error?.message ?? String(error),
          });
        }
      })();
      return true;
    }

    if (
      isUiMessageSource(message.source) &&
      message.type === "SKILL_RECORDING_START"
    ) {
      void handleSkillRecordingStart(message.payload.tabId)
        .then((result) => sendResponse(result))
        .catch((error: any) =>
          sendResponse({ ok: false, detail: error?.message ?? String(error) }),
        );
      return true;
    }

    if (
      (isUiMessageSource(message.source) ||
        message.source === MessageSource.CONTENT) &&
      message.type === "SKILL_RECORDING_STOP"
    ) {
      const tabId = message.payload.tabId ?? sender.tab?.id;
      void handleSkillRecordingStop(tabId)
        .then((result) => sendResponse(result))
        .catch((error: any) =>
          sendResponse({ ok: false, detail: error?.message ?? String(error) }),
        );
      return true;
    }

    if (
      (isUiMessageSource(message.source) ||
        message.source === MessageSource.CONTENT) &&
      message.type === "SKILL_RECORDING_CANCEL"
    ) {
      const tabId = message.payload.tabId ?? sender.tab?.id;
      void handleSkillRecordingCancel(tabId)
        .then((result) => sendResponse(result))
        .catch((error: any) =>
          sendResponse({ ok: false, detail: error?.message ?? String(error) }),
        );
      return true;
    }

    if (
      message.source === MessageSource.CONTENT &&
      message.type === "SKILL_RECORDING_EVENT"
    ) {
      const tabId = sender.tab?.id;
      if (tabId != null) recordSkillEvent(tabId, message.payload.event);
      sendResponse({ ok: true });
      return true;
    }

    if (
      isUiMessageSource(message.source) &&
      message.type === "USER_SKILL_SAVE"
    ) {
      void saveUserWebsiteSkill(message.payload.draft, message.payload.enabled)
        .then(async (skill) => {
          const skills = await loadUserWebsiteSkills();
          broadcastUserSkillList(skills);
          sendResponse({ ok: true, skill, skills });
        })
        .catch((error: any) =>
          sendResponse({ ok: false, detail: error?.message ?? String(error) }),
        );
      return true;
    }

    if (
      isUiMessageSource(message.source) &&
      message.type === "USER_SKILL_LIST"
    ) {
      void loadUserWebsiteSkills()
        .then((skills) => sendResponse({ ok: true, skills }))
        .catch((error: any) =>
          sendResponse({ ok: false, detail: error?.message ?? String(error) }),
        );
      return true;
    }

    if (
      isUiMessageSource(message.source) &&
      message.type === "USER_SKILL_DELETE"
    ) {
      void deleteUserWebsiteSkill(message.payload.id)
        .then((skills) => {
          broadcastUserSkillList(skills);
          sendResponse({ ok: true, skills });
        })
        .catch((error: any) =>
          sendResponse({ ok: false, detail: error?.message ?? String(error) }),
        );
      return true;
    }

    if (
      isUiMessageSource(message.source) &&
      message.type === "SPEECH_TRANSCRIPTION_REQUEST"
    ) {
      void (async () => {
        const settings =
          cachedSettings ?? (await loadSettings()) ?? ({} as UserSettings);
        const result = await transcribeWithGroq({
          apiKey: settings.groqApiKey,
          audioBase64: message.payload.audioBase64,
          mimeType: message.payload.mimeType,
          language: message.payload.language,
          prompt: message.payload.prompt,
        });
        sendResponse({
          ok: true,
          text: result.text,
          durationMs: result.durationMs,
        });
      })().catch((error: any) => {
        logger.warn("recording", "Speech transcription failed", {
          error: error?.message ?? String(error),
        });
        sendResponse({
          ok: false,
          detail: error?.message ?? "Audio transcription failed.",
        });
      });
      return true;
    }

    if (
      isUiMessageSource(message.source) &&
      message.type === "PASSIVE_MONITOR_START"
    ) {
      void (async () => {
        const resolvedWsId = await resolveWorkspaceId(
          message.payload.tabId,
          message.workspaceId ?? message.payload.workspaceId,
        );
        const tabId = await resolveValidTabId(
          message.payload.tabId,
          resolvedWsId,
          workspaceManager,
        );
        if (tabId === null) {
          sendResponse({
            ok: false,
            detail: "No active web page found for Watch Mode.",
          });
          return;
        }
        rememberE2EOverlayTarget(resolvedWsId, tabId);
        const settings =
          cachedSettings ?? (await loadSettings()) ?? ({} as UserSettings);
        try {
          const tab = await chrome.tabs.get(tabId);
          const blocked = getBlockedRuleForUrl(tab.url ?? "", settings);
          if (blocked) {
            sendResponse({
              ok: false,
              detail: `Blocked on ${blocked.host} by site access rule "${blocked.rule}".`,
            });
            return;
          }
        } catch {
          // Controller will surface tab read failures as passive status errors.
        }
        await startKeepalive();
        const result = await passiveMonitor.startSession({
          tabId,
          workspaceId: resolvedWsId,
          instructions: message.payload.instructions,
          inputSources: message.payload.inputSources,
          minIntervalMs: message.payload.minIntervalMs,
          maxSuggestionsPerMinute: message.payload.maxSuggestionsPerMinute,
        });
        if (result.ok && message.payload.inputSources.includes("tabAudio")) {
          await tabAudioCapture.start({ workspaceId: resolvedWsId, tabId }).catch(
            (error: any) => {
              logger.warn("recording", "Failed to start tab audio capture", {
                workspaceId: resolvedWsId,
                tabId,
                error: error?.message ?? String(error),
              });
              passiveMonitor.setStatusDetail(
                resolvedWsId,
                error?.message
                  ? `Audio unavailable: ${error.message}`
                  : "Audio transcription is unavailable.",
              );
            },
          );
        }
        sendResponse(result);
      })().catch((error: any) => {
        sendResponse({
          ok: false,
          detail: error?.message ?? String(error),
        });
      });
      return true;
    }

    if (
      isUiMessageSource(message.source) &&
      message.type === "PASSIVE_MONITOR_STOP"
    ) {
      void (async () => {
        const wsId =
          message.workspaceId ??
          message.payload.workspaceId ??
          (message.payload.workspaceId === null ? null : undefined);
        const stopped = passiveMonitor.stopSession(wsId);
        await tabAudioCapture.stop(wsId);
        await maybeStopKeepalive();
        sendResponse({ ok: true, stopped });
      })().catch((error: any) => {
        sendResponse({
          ok: false,
          detail: error?.message ?? String(error),
        });
      });
      return true;
    }

    // 1. Chat (or hint injection)
    if (isUiMessageSource(message.source) && message.type === "USER_CHAT") {
      const wsId = message.payload.workspaceId;
      (async () => {
        const resolvedWsId = await resolveWorkspaceId(
          message.payload.tabId,
          wsId,
        );
        rememberE2EOverlayTarget(resolvedWsId, message.payload.tabId);
        broadcastUserChatAccepted(message, resolvedWsId);
        if (message.payload.isFeedback) {
          logger.debug("agent", "User feedback", {
            text: message.payload.text,
            workspaceId: resolvedWsId,
          });
          orchestrator.injectFeedback(resolvedWsId, message.payload.text);
        } else {
          await handleUserChat(message.payload, resolvedWsId);
        }
      })().catch((err) => {
        logger.error("agent", "handleUserChat failed", { error: err });
        chrome.runtime
          .sendMessage({
            type: "AGENT_STATUS",
            requestId: crypto.randomUUID(),
            source: MessageSource.BACKGROUND,
            workspaceId: wsId,
            payload: {
              status: AgentStatus.ERROR,
              detail: `Unexpected error: ${err?.message ?? String(err)}`,
            },
          })
          .catch(() => {});
      });
      return false;
    }

    // 2. Stop Agent
    if (
      (isUiMessageSource(message.source) ||
        message.source === MessageSource.CONTENT) &&
      message.type === "STOP_AGENT"
    ) {
      const wsId = message.payload?.workspaceId;
      (async () => {
        await orchestrator.stopTask(wsId ?? undefined);
        await maybeStopKeepalive();
        // Notify content script to remove the border
        chrome.tabs
          .query({ active: true, currentWindow: true })
          .then(([tab]) => {
            if (tab?.id)
              sendAgentActivity(tab.id, false, { status: "stopped" });
          })
          .catch(() => {});
      })();
      return false;
    }

    // 3. Pause / Resume Agent
    if (isUiMessageSource(message.source) && message.type === "PAUSE_AGENT") {
      const wsId = message.payload?.workspaceId;
      orchestrator.pauseTask(wsId ?? undefined);
      return false;
    }
    if (isUiMessageSource(message.source) && message.type === "RESUME_AGENT") {
      const wsId = message.payload?.workspaceId;
      orchestrator.resumeTask(wsId ?? undefined);
      return false;
    }
    if (isUiMessageSource(message.source) && message.type === "SKIP_SUBTASK") {
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
      isUiMessageSource(message.source) &&
      message.type === "APPROVAL_RESPONSE"
    ) {
      orchestrator.resolveApprovalResponse(
        message.payload,
        message.workspaceId,
      );
      return false;
    }

    if (
      isUiMessageSource(message.source) &&
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

    // 3c. Plan confirmation response from side panel
    if (
      isUiMessageSource(message.source) &&
      message.type === "PLAN_CONFIRMATION_RESPONSE"
    ) {
      orchestrator.resolvePlanConfirmation(message.payload);
      return false;
    }

    // 3d. Clarification response from side panel
    if (
      isUiMessageSource(message.source) &&
      message.type === "CLARIFICATION_RESPONSE"
    ) {
      orchestrator.resolveClarificationResponse(
        message.payload,
        message.workspaceId,
      );
      return false;
    }

    // 4. Side Panel Opened (Mount) — returns workspace ID so side panel can set it
    if (
      isUiMessageSource(message.source) &&
      message.type === "SIDE_PANEL_OPENED"
    ) {
      handleSidePanelOpened(message.payload.tabId, message.payload.windowId)
        .then((wsId) => sendResponse({ workspaceId: wsId }))
        .catch(() => sendResponse({ workspaceId: null }));
      return true; // keep message channel open for async response
    }

    // 4b. Workspace Sync — side panel switched workspaces, re-broadcast state
    if (
      isUiMessageSource(message.source) &&
      message.type === "WORKSPACE_SYNC"
    ) {
      const wsId = message.payload.workspaceId;
      if (wsId) {
        void orchestrator.resyncWorkspaceState(wsId);
      }
      return false;
    }

    if (
      isUiMessageSource(message.source) &&
      message.type === "DATA_CONTROL_REQUEST"
    ) {
      (async () => {
        try {
          const action = message.payload.action;
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
          if (action === "clear_workspace_chat_history") {
            const wsId = message.workspaceId;
            if (!wsId) {
              sendResponse({
                ok: false,
                detail: "No workspace specified for workspace-scoped clear.",
              });
              return;
            }
            await chrome.storage.local.set({ [`chatMessages:${wsId}`]: [] });
            sendResponse({
              ok: true,
              detail: "Chat history cleared for the active workspace.",
            });
            return;
          }
          if (action === "clear_local_data") {
            await chrome.storage.local.remove([
              "opensidebar:savedPrompts",
              "opensidebar:savedPromptsSeeded",
              "opensidebar:savedPromptsVersion",
              WEBSITE_SKILLS_STORAGE_KEY,
              RECORD_SKILL_INTRO_DISMISSED_KEY,
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

async function handleSkillRecordingStart(tabId: number) {
  if (!tabId || tabId === chrome.tabs.TAB_ID_NONE) {
    return { ok: false, detail: "No active tab available for recording." };
  }

  const tab = await chrome.tabs.get(tabId);
  const url = tab.url ?? "";
  skillRecordingSessions.set(tabId, {
    tabId,
    startedAt: Date.now(),
    url,
    events: [],
  });

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "SKILL_RECORDING_START",
      requestId: crypto.randomUUID(),
      source: MessageSource.BACKGROUND,
      payload: { tabId },
    });
    broadcastSkillRecordingStatus({
      status: "recording",
      timeline: [],
      detail: "Recording site skill",
    });
    return { ok: true };
  } catch {
    broadcastSkillRecordingStatus({
      status: "paused",
      timeline: [],
      detail: "Recording paused on restricted page. Resume when you return to the original site.",
    });
    return {
      ok: false,
      detail:
        "Recording paused on restricted page. Resume when you return to the original site.",
    };
  }
}

async function handleSkillRecordingStop(tabId?: number) {
  if (tabId == null) {
    return { ok: false, detail: "No recording tab found." };
  }
  const session = skillRecordingSessions.get(tabId);
  if (!session) return { ok: false, detail: "No active recording found." };

  await chrome.tabs
    .sendMessage(tabId, {
      type: "SKILL_RECORDING_STOP",
      requestId: crypto.randomUUID(),
      source: MessageSource.BACKGROUND,
      payload: { tabId },
    })
    .catch(() => {});

  const draft = generateWebsiteSkillDraft(session.events, session.url);
  skillRecordingSessions.delete(tabId);
  broadcastSkillRecordingStatus({
    status: "review",
    timeline: formatSkillRecordingTimeline(session.events),
    draft,
    detail: "Review the generated skill before saving.",
  });
  return { ok: true, draft };
}

async function handleSkillRecordingCancel(tabId?: number) {
  if (tabId != null) {
    skillRecordingSessions.delete(tabId);
    await chrome.tabs
      .sendMessage(tabId, {
        type: "SKILL_RECORDING_CANCEL",
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        payload: { tabId },
      })
      .catch(() => {});
  }
  broadcastSkillRecordingStatus({
    status: "idle",
    timeline: [],
    detail: "Recording canceled.",
  });
  return { ok: true };
}

function recordSkillEvent(tabId: number, event: SkillRecordingEvent) {
  const session = skillRecordingSessions.get(tabId);
  if (!session) return;
  session.events.push(event);
  broadcastSkillRecordingStatus({
    status: "recording",
    timeline: formatSkillRecordingTimeline(session.events),
    detail: "Recording site skill",
  });
}

function broadcastSkillRecordingStatus(
  payload: Extract<
    RuntimeMessage,
    { type: "SKILL_RECORDING_STATUS" }
  >["payload"],
) {
  chrome.runtime
    .sendMessage({
      type: "SKILL_RECORDING_STATUS",
      requestId: crypto.randomUUID(),
      source: MessageSource.BACKGROUND,
      payload,
    })
    .catch(() => {});
}

function broadcastUserSkillList(
  skills: Extract<RuntimeMessage, { type: "USER_SKILL_LIST" }>["payload"]["skills"],
) {
  chrome.runtime
    .sendMessage({
      type: "USER_SKILL_LIST",
      requestId: crypto.randomUUID(),
      source: MessageSource.BACKGROUND,
      payload: { skills },
    })
    .catch(() => {});
}

function normalizeWorkspaceContextText(text: unknown): string {
  return typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
}

function getStoredChatEntryText(entry: Partial<ChatEntry>): string {
  const completionSummary =
    typeof entry.completionData?.summary === "string"
      ? entry.completionData.summary
      : "";
  return normalizeWorkspaceContextText(entry.content || completionSummary);
}

async function buildWorkspaceConversationContext(
  workspaceId: string,
  currentPayload: UserChatPayload,
): Promise<string> {
  const storageKey = `chatMessages:${workspaceId}`;
  try {
    const result = await chrome.storage.local.get(storageKey);
    const stored = result[storageKey];
    if (!Array.isArray(stored)) return "";

    const currentText = normalizeWorkspaceContextText(currentPayload.text);
    const priorMessages = (stored as Partial<ChatEntry>[])
      .filter((entry) => {
        if (entry.isStreaming) return false;
        if (entry.role !== "user" && entry.role !== "assistant") return false;
        if (currentPayload.messageId && entry.id === currentPayload.messageId) {
          return false;
        }
        if (
          entry.role === "user" &&
          currentPayload.timestamp &&
          typeof entry.timestamp === "number" &&
          entry.timestamp >= currentPayload.timestamp &&
          getStoredChatEntryText(entry) === currentText
        ) {
          return false;
        }
        return getStoredChatEntryText(entry).length > 0;
      })
      .slice(-MAX_WORKSPACE_CONTEXT_MESSAGES);

    return priorMessages
      .map((entry) => {
        const role = entry.role === "user" ? "User" : "Assistant";
        const text = getStoredChatEntryText(entry).slice(
          0,
          MAX_WORKSPACE_CONTEXT_LINE_CHARS,
        );
        return `- ${role}: ${text}`;
      })
      .join("\n")
      .slice(0, MAX_WORKSPACE_CONTEXT_CHARS);
  } catch (error) {
    logger.debug("agent", "Failed to load workspace conversation context", {
      workspaceId,
      error,
    });
    return "";
  }
}

async function handleUserChat(
  payload: UserChatPayload,
  workspaceId: string,
) {
  // Per-workspace guard: serialize concurrent requests instead of dropping them.
  if (pendingUserChat.has(workspaceId)) {
    queuedUserChat.set(workspaceId, payload);
    logger.warn("agent", "Queueing concurrent USER_CHAT for workspace", {
      workspaceId,
      textPreview: payload.text.slice(0, 120),
    });
    return;
  }
  pendingUserChat.add(workspaceId);

  try {
    let currentPayload: UserChatPayload | undefined = payload;
    while (currentPayload) {
      const text = sanitizeUserInput(currentPayload.text);
      let agentQuery = text;

      // Validate tabId — side panel's chrome.tabs.query can race with workspace creation
      const tabId = await resolveValidTabId(
        currentPayload.tabId,
        workspaceId,
        workspaceManager,
      );
      if (tabId === null) {
        chrome.runtime.sendMessage({
          type: "AGENT_STATUS",
          requestId: crypto.randomUUID(),
          source: MessageSource.BACKGROUND,
          workspaceId,
          payload: {
            status: AgentStatus.ERROR,
            detail:
              "No active web page found. Please open a web page and try again.",
          },
        });
        return;
      }

      logger.debug("agent", "User message", { text, tabId, workspaceId });
      const conversationContextBrief = await buildWorkspaceConversationContext(
        workspaceId,
        currentPayload,
      );

      // 1. Get Settings (API Keys) — use cache if populated, else load fresh
      const settings =
        cachedSettings ?? (await loadSettings()) ?? ({} as UserSettings);
      const openRouterApiKey = settings.openRouterApiKey;
      const providerKeyStatus = getProviderKeyStatus(settings);

      if (!providerKeyStatus.hasRequiredKeys) {
        const missingKeys = formatMissingProviderKeys(providerKeyStatus);
        const keyNoun =
          providerKeyStatus.missingKeyNames.length === 1
            ? "API Key"
            : "API Keys";
        chrome.runtime.sendMessage({
          type: "AGENT_STATUS",
          requestId: crypto.randomUUID(),
          source: MessageSource.BACKGROUND,
          workspaceId,
          payload: {
            status: AgentStatus.ERROR,
            detail: `No ${missingKeys} ${keyNoun} configured. Open Settings to add one.`,
          },
        });
        return;
      }

      let currentTabUrl = "";
      try {
        const tab = await chrome.tabs.get(tabId);
        currentTabUrl = tab.url ?? "";
        const blocked = getBlockedRuleForUrl(currentTabUrl, settings);
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

      const savedSkill = findMatchingUserWebsiteSkill(
        await loadUserWebsiteSkills(),
        {
          url: currentTabUrl,
          task: text,
        },
      );
      chrome.runtime
        .sendMessage({
          type: "USER_SKILL_USAGE_STATUS",
          requestId: crypto.randomUUID(),
          source: MessageSource.BACKGROUND,
          workspaceId,
          payload: { skill: savedSkill },
        })
        .catch(() => {});
      if (savedSkill) {
        agentQuery = `${text}\n\nSaved website skill guidance:\n${formatUserWebsiteSkillGuidance(savedSkill)}`;
      }

      const pageActivity = shouldShowPageActivityCue(text);

      // Notify content script that agent is active
      sendAgentActivity(tabId, true, undefined, pageActivity);

      await startKeepalive();
      const passiveWasActive = passiveMonitor.hasSession(workspaceId);
      if (passiveWasActive) {
        await tabAudioCapture.stop(workspaceId);
        passiveMonitor.pauseSession(
          workspaceId,
          "Paused while an active agent task runs in this workspace. Audio capture stopped.",
        );
      }
      try {
        await orchestrator.startTask({
          query: agentQuery,
          tabId,
          workspaceId,
          settings,
          conversationContextBrief,
          // In non-OpenRouter modes openRouterApiKey may be empty — pass the
          // active provider key so LLMClient pools receive a valid key.
          openRouterApiKey: providerKeyStatus.activeKey || openRouterApiKey,
        });
      } finally {
        if (passiveWasActive) {
          passiveMonitor.resumeSession(workspaceId);
        }
        const outcomeStatus = orchestrator.getRecentOutcome(workspaceId);
        sendAgentActivity(
          tabId,
          false,
          outcomeStatus ? { status: outcomeStatus } : undefined,
        );
        await maybeStopKeepalive();
      }

      currentPayload = queuedUserChat.get(workspaceId);
      queuedUserChat.delete(workspaceId);
      if (currentPayload) {
        logger.info("agent", "Processing queued USER_CHAT for workspace", {
          workspaceId,
          textPreview: currentPayload.text.slice(0, 120),
        });
      }
    }
  } finally {
    queuedUserChat.delete(workspaceId);
    pendingUserChat.delete(workspaceId);
  }
}

/** Send AGENT_ACTIVITY message to the content script on a specific tab */
function sendAgentActivity(
  tabId: number,
  active: boolean,
  outcome?: { status: "completed" | "failed" | "stopped"; label?: string },
  pageActivity?: boolean,
) {
  if (!tabId || tabId === chrome.tabs.TAB_ID_NONE) return;
  chrome.tabs
    .sendMessage(tabId, {
      type: "AGENT_ACTIVITY",
      requestId: crypto.randomUUID(),
      source: MessageSource.BACKGROUND,
      payload: { active, outcome, pageActivity },
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
