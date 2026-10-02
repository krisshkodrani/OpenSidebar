/**
 * Content Script - Runs in every page context
 *
 * Responsibilities:
 * - Auto-dismiss cookie banners and overlay modals (Janitor)
 * - Handle DOM snapshot requests from background
 * - Execute tool actions (click, type, scroll, etc.)
 * - Detect and report overlay elements blocking interaction
 *
 * Communication: Receives messages from background via chrome.runtime.onMessage
 */

import { detectFramework } from "./framework-detect";
import {
  deriveAgentCueTransition,
  reduceAgentActivitySignal,
  type AgentActivitySignalState,
} from "./agent-cue";
import { logger } from "../utils";
import { RuntimeMessage, MessageSource } from "../types";
import { buildSnapshot } from "./snapshot";
import { installFrameGeometryRelay } from "./frame-geometry-relay";
import { executeAction } from "./actions";
import { reportSandboxTaskCompletion } from "./sandbox-completion";
import {
  initPresence,
  resumePresence,
  setPresenceSessionActive,
  suspendPresence,
} from "./presence";
import {
  isElementVisible,
  dismissElement,
  addDynamicTag,
  resetStableIds,
  isOwnElement,
} from "./tagging";
import {
  classifyValueKind,
  isSensitiveInput,
  withTimelineText,
} from "../utils/website-skills";
import {
  ensureSkillRecordingStyles,
  isRecordingOverlayElement,
  pulseSkillRecordingElement,
  removeSkillRecordingOverlay,
  renderSkillRecordingOverlay,
} from "./in-page-ui/skill-recording-hud";
import {
  AGENT_BORDER_ID,
  ensureAgentBorderVisible as ensureAgentBorderElementVisible,
  removeAgentBorder,
  type AgentBorderVisualState,
} from "./in-page-ui/agent-border";
import { FLOATING_WRAP_ID } from "./in-page-ui/floating-action-hud";
import {
  removeE2ERail,
  renderE2ERail as renderE2ERailElement,
  type E2ERailState,
} from "./in-page-ui/e2e-rail";
import {
  autoDismissModals,
  detectViewportCoveringOverlays,
} from "./overlay-dismissal";
import {
  getPageDocumentState,
  rejectStaleDismissRequest,
  rejectStaleToolRequest,
  startPageMutationEpochObserver,
} from "./page-state-epoch";

// Re-exported for tests and for consumers that historically imported the
// overlay helpers from content.ts (the code moved to ./overlay-dismissal).
export {
  detectViewportCoveringOverlays,
  isBackdropElement,
  findCloseButton,
  extractOverlayText,
} from "./overlay-dismissal";

logger.info("system", "Content Script Loaded");
startPageMutationEpochObserver();
installFrameGeometryRelay();
function runJanitor() {
  const COMMON_selectors = [
    // Generic aria-labels (consent-specific only — avoid broad labels like "Close"
    // which match app UI buttons on sites like LinkedIn)
    "button[aria-label='Accept all']",
    "button[aria-label='Reject all']",
    "button[aria-label='Accept cookies']",
    "button[aria-label='Accept All Cookies']",
    // Common cookie/consent platforms
    "#onetrust-accept-btn-handler", // OneTrust
    "#onetrust-reject-all-handler",
    ".fc-cta-consent", // Google Funding Choices
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll", // Cookiebot
    "[data-cookiefirst-action='accept']", // CookieFirst
    ".cookie-banner button.primary",
    // Class-based patterns
    "[class*='cookie'] button[class*='accept']",
    "[class*='cookie'] button[class*='close']",
    "[class*='consent'] button[class*='accept']",
    "[class*='gdpr'] button[class*='accept']",
    "[class*='privacy'] button[class*='accept']",
    // ID-based patterns
    "[id*='cookie-accept']",
    "[id*='cookie-close']",
    "[id*='accept-cookies']",
    // Additional CMP platforms
    "#CybotCookiebotDialogBodyButtonAccept", // Cookiebot alternate
    "[data-tid='banner-accept']", // TrustArc
    ".cmp-button_button--accept", // Quantcast/CMP
    ".didomi-continue-without-agreeing", // Didomi
    "#consent_wall_optin", // Various EU sites
  ];

  for (const sel of COMMON_selectors) {
    try {
      const el = document.querySelector(sel);
      if (el && isElementVisible(el)) {
        (el as HTMLElement).click();
        logger.info("tools", "Auto-clicked cookie banner", { selector: sel });
      }
    } catch {
      // Invalid selector on some pages — skip silently
    }
  }
}

// Prepare Janitor — run on load + MutationObserver re-run for async-injected banners
if (document.readyState === "complete") {
  runJanitor();
} else {
  window.addEventListener("load", runJanitor);
}

// LP-24 presence layer: read mode from settings and follow changes.
initPresence();
// Watch for late-injected cookie/GDPR banners (no delay — react to DOM mutations)
let janitorRan = false;

function armJanitorObserver() {
  janitorRan = false;
  const obs = new MutationObserver(() => {
    if (janitorRan) return;
    janitorRan = true;
    obs.disconnect();
    runJanitor();
  });
  obs.observe(document.body ?? document.documentElement, {
    childList: true,
    subtree: true,
  });
  // Self-cleanup: stop observing after 3s regardless (no lingering observers)
  setTimeout(() => obs.disconnect(), 3000);
}
armJanitorObserver();

// Reset stable element IDs + re-arm janitor on SPA navigation
let lastHref = window.location.href;
window.addEventListener("pageshow", () => {
  const currentHref = window.location.href;
  if (currentHref !== lastHref) {
    resetStableIds();
    lastHref = currentHref;
    // Re-arm janitor for late-injected banners on new SPA page
    armJanitorObserver();
    runJanitor();
  }
});

// Announce readiness to background — eliminates all "wait for content script" sleeps
if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
  chrome.runtime
    .sendMessage({
      type: "CONTENT_SCRIPT_READY",
      requestId: crypto.randomUUID(),
      source: MessageSource.CONTENT,
      payload: { tabId: -1 }, // Background resolves actual tabId from sender
    })
    .catch(() => {}); // Ignore if background not ready yet
}

// --- Overlay Detection Helpers ---

const E2E_OVERLAY_HOST_ID = "opensidebar-harness-host";
const E2E_OVERLAY_CONFIG_ID = "opensidebar-overlay-config";
const E2E_OVERLAY_MOUNT_EVENT = "opensidebar:overlay:mount";
const E2E_OVERLAY_DISPOSE_EVENT = "opensidebar:overlay:dispose";
let e2eOverlayMounted = false;

type E2EOverlayMountPayload = {
  scriptUrl: string;
  extensionBaseUrl?: string;
  workspaceId: string;
  tab: {
    id?: number;
    url?: string;
    title?: string;
    active?: boolean;
    windowId?: number;
  };
  window?: {
    id?: number;
  };
};

function getE2EOverlayExtensionBaseUrl(
  payload: E2EOverlayMountPayload,
): string | undefined {
  if (
    payload.extensionBaseUrl &&
    !payload.extensionBaseUrl.startsWith("chrome-extension://invalid/")
  ) {
    return payload.extensionBaseUrl;
  }
  try {
    return new URL("/", payload.scriptUrl).toString();
  } catch {
    return payload.extensionBaseUrl;
  }
}

function upsertE2EOverlayConfig(payload: E2EOverlayMountPayload): void {
  (window as Window & { __opensidebarOverlayConfig?: unknown }).__opensidebarOverlayConfig = {
    scriptUrl: payload.scriptUrl,
    glass: true,
    runtimeOptions: {
      storageMode: "chrome-direct",
      extensionBaseUrl: getE2EOverlayExtensionBaseUrl(payload),
      tab: payload.tab,
      window: payload.window,
      e2ePanelConfig: {
        targetTabId: payload.tab.id ?? null,
        workspaceId: payload.workspaceId,
      },
    },
  };
  const existing = document.getElementById(E2E_OVERLAY_CONFIG_ID);
  const config =
    existing instanceof HTMLScriptElement
      ? existing
      : document.createElement("script");
  config.id = E2E_OVERLAY_CONFIG_ID;
  config.type = "application/json";
  config.textContent = JSON.stringify({
    scriptUrl: payload.scriptUrl,
    glass: true,
    runtimeOptions: {
      storageMode: "chrome-direct",
      extensionBaseUrl: getE2EOverlayExtensionBaseUrl(payload),
      tab: payload.tab,
      window: payload.window,
      e2ePanelConfig: {
        targetTabId: payload.tab.id ?? null,
        workspaceId: payload.workspaceId,
      },
    },
  });
  if (!config.parentNode) {
    document.documentElement.appendChild(config);
  }
}

function waitForE2EOverlayHost(timeoutMs: number = 15_000): Promise<void> {
  if (document.getElementById(E2E_OVERLAY_HOST_ID)) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error("Timed out waiting for E2E overlay host."));
    }, timeoutMs);
    const observer = new MutationObserver(() => {
      if (!document.getElementById(E2E_OVERLAY_HOST_ID)) return;
      clearTimeout(timer);
      observer.disconnect();
      resolve();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  });
}

async function mountE2EOverlay(
  payload: E2EOverlayMountPayload,
): Promise<{ ok: true; loaded: boolean }> {
  upsertE2EOverlayConfig(payload);
  const existingHost = document.getElementById(E2E_OVERLAY_HOST_ID);
  if (existingHost) {
    window.dispatchEvent(new CustomEvent(E2E_OVERLAY_MOUNT_EVENT));
    await waitForE2EOverlayHost();
    e2eOverlayMounted = true;
    removeE2ERail();
    removeFloatingHudOnly();
    if (agentSessionActive && agentPageActivityActive) {
      setAgentBorder(true, undefined, "active");
    } else if (watchPageActivityActive) {
      ensureAgentBorderElementVisible("active");
    }
    return { ok: true, loaded: true };
  }
  if (payload.scriptUrl) {
    // The E2E helper injects a small loader with chrome.scripting. This message
    // only prepares isolated-world config before the loader imports the module.
    return { ok: true, loaded: false };
  } else {
    window.dispatchEvent(new CustomEvent(E2E_OVERLAY_MOUNT_EVENT));
  }
  await waitForE2EOverlayHost();
  e2eOverlayMounted = true;
  removeE2ERail();
  removeFloatingHudOnly();
  if (agentSessionActive && agentPageActivityActive) {
    setAgentBorder(true, undefined, "active");
  } else if (watchPageActivityActive) {
    ensureAgentBorderElementVisible("active");
  }
  return { ok: true, loaded: true };
}

function unmountE2EOverlay(): { ok: true } {
  window.dispatchEvent(new CustomEvent(E2E_OVERLAY_DISPOSE_EVENT));
  document.getElementById(E2E_OVERLAY_HOST_ID)?.remove();
  document.getElementById(E2E_OVERLAY_CONFIG_ID)?.remove();
  delete (window as Window & { __opensidebarOverlayConfig?: unknown }).__opensidebarOverlayConfig;
  e2eOverlayMounted = false;
  return { ok: true };
}

// --- Message Handler ---

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(
    (message: RuntimeMessage, _sender, sendResponse) => {
      const messageType = message.type as string;
      if (
        messageType === "SANDBOX_TASK_COMPLETION" &&
        window.location.hostname === "play.opensidebar.com"
      ) {
        const payload = (
          message as unknown as {
            payload?: { status?: string; terminationReason?: string };
          }
        ).payload;
        void reportSandboxTaskCompletion(payload).catch(() => undefined);
        return false;
      }
      if (messageType === "E2E_CONTENT_READY_PING") {
        sendResponse?.({
          ok: true,
          href: window.location.href,
          readyState: document.readyState,
        });
        return true;
      }

      if (message.type === "E2E_RAIL_UPDATE") {
        e2eRailState = {
          ...e2eRailState,
          active:
            message.payload.status === "Running" ||
            (message.payload.status == null && e2eRailState.active),
          status: message.payload.status ?? e2eRailState.status,
          detail: message.payload.detail ?? e2eRailState.detail,
          outcome: message.payload.outcome ?? e2eRailState.outcome,
          updatedAt: Date.now(),
          prompt: message.payload.prompt ?? e2eRailState.prompt,
          planItems: message.payload.planItems ?? e2eRailState.planItems,
          feed: message.payload.feed ?? e2eRailState.feed,
          finalText: message.payload.finalText ?? e2eRailState.finalText,
        };
        void renderE2ERail();
        sendResponse?.({ ok: true });
        return true;
      }

      if (messageType === "E2E_OVERLAY_MOUNT") {
        if (
          import.meta.env.MODE !== "e2e" ||
          message.source !== MessageSource.SIDEPANEL
        ) {
          sendResponse?.({ ok: false, detail: "E2E overlay is disabled." });
          return true;
        }
        void (async () => {
          const stored = await chrome.storage.local.get("opensidebar:e2eTestApiEnabled");
          if (stored["opensidebar:e2eTestApiEnabled"] !== true) {
            return { ok: false as const, detail: "E2E overlay is disabled." };
          }
          return mountE2EOverlay(
            (message as unknown as { payload: E2EOverlayMountPayload }).payload,
          );
        })()
          .then((response) => sendResponse?.(response))
          .catch((error) =>
            sendResponse?.({
              ok: false,
              detail: error instanceof Error ? error.message : String(error),
            }),
          );
        return true;
      }

      if (messageType === "E2E_OVERLAY_UNMOUNT") {
        if (
          import.meta.env.MODE !== "e2e" ||
          message.source !== MessageSource.SIDEPANEL
        ) {
          sendResponse?.({
            ok: false,
            detail: "Invalid overlay control source.",
          });
          return true;
        }
        sendResponse?.(unmountE2EOverlay());
        return true;
      }

      // Only accept messages from our own background service worker
      if (message.source !== MessageSource.BACKGROUND) return;

      if (message.type === "AGENT_ACTIVITY") {
        const previousSignalState = readAgentActivitySignalState();
        const reduction = reduceAgentActivitySignal(previousSignalState, {
          type: "activity",
          active: message.payload.active,
          outcome: message.payload.outcome,
          pageActivity: message.payload.pageActivity,
        });
        applyAgentActivitySignalState(reduction.state);
        // LP-24: cursor visibility is session-scoped — visible for the whole
        // run, faded out at the end (no per-action blinking).
        setPresenceSessionActive(reduction.state.sessionActive);
        if (reduction.accepted) {
          e2eRailState = {
            ...e2eRailState,
            detail: message.payload.active
              ? "Agent is working"
              : (message.payload.outcome?.label ?? "Task complete"),
            updatedAt: Date.now(),
          };
          void renderE2ERail();
        }
        clearAgentCueTimer();
        if (
          reduction.state.sessionActive &&
          reduction.state.pageActivityActive &&
          (!previousSignalState.sessionActive ||
            !previousSignalState.pageActivityActive)
        ) {
          setAgentBorder(true, undefined, "active");
        } else if (
          reduction.state.sessionActive &&
          !reduction.state.pageActivityActive &&
          !previousSignalState.sessionActive
        ) {
          removeFloatingAgentCue();
        } else if (
          previousSignalState.sessionActive &&
          !message.payload.active
        ) {
          setAgentBorder(false, message.payload.outcome);
        }
        return;
      }

      if (message.type === "PASSIVE_MONITOR_PAGE_ACTIVITY") {
        applyWatchPageActivity(message.payload.active);
        configurePassivePageListener(
          message.payload.active,
          message.payload.sessionId,
        );
        return;
      }

      if (message.type === "TASK_PROGRESS") {
        const subtasks = Array.isArray(message.payload?.subtasks)
          ? message.payload.subtasks
          : [];
        e2eRailState = {
          ...e2eRailState,
          planItems: subtasks
            .map((subtask: { description?: unknown; title?: unknown }) =>
              typeof subtask.description === "string"
                ? subtask.description
                : typeof subtask.title === "string"
                  ? subtask.title
                  : "",
            )
            .filter(Boolean),
          updatedAt: Date.now(),
        };
        void renderE2ERail();
        return;
      }

      if (message.type === "AGENT_STEP_LABEL") {
        const reduction = reduceAgentActivitySignal(
          readAgentActivitySignalState(),
          {
            type: "step",
            status: message.payload.status,
          },
        );
        if (!reduction.accepted) {
          return;
        }
        applyAgentActivitySignalState(reduction.state);
        e2eRailState = {
          ...e2eRailState,
          detail: message.payload.label,
          updatedAt: Date.now(),
        };
        void renderE2ERail();
        const transition = deriveAgentCueTransition({
          sessionActive: reduction.state.pageActivityActive,
          stepStatus: message.payload.status,
        });
        if (transition.showCue && transition.borderState) {
          setAgentBorder(true, undefined, transition.borderState);
        }
        if (transition.hideAfterMs != null) {
          scheduleAgentCueHide(transition.hideAfterMs);
        }
        return;
      }

      if (message.type === "SKILL_RECORDING_START") {
        startSkillRecording();
        sendResponse?.({ ok: true });
        return true;
      }

      if (message.type === "SKILL_RECORDING_STOP") {
        stopSkillRecording();
        sendResponse?.({ ok: true });
        return true;
      }

      if (message.type === "SKILL_RECORDING_CANCEL") {
        stopSkillRecording();
        sendResponse?.({ ok: true });
        return true;
      }

      if (message.type === "DISMISS_MODALS") {
        if (rejectStaleDismissRequest(message, sendResponse)) return true;
        const result = autoDismissModals();
        sendResponse({
          type: "DISMISS_MODALS_RESPONSE",
          requestId: message.requestId,
          source: MessageSource.CONTENT,
          payload: {
            dismissed: result.dismissed,
            clickedClose: result.clickedClose,
            cssHidden: result.cssHidden,
            remainingOverlay: result.remainingOverlay,
            capturedTexts: result.capturedTexts,
          },
        });
        return true;
      }

      if (message.type === "SCROLL_TO_POSITION") {
        window.scrollTo({
          top: message.payload.y,
          behavior: "instant" as ScrollBehavior,
        });
        requestAnimationFrame(() => {
          sendResponse({
            type: "SCROLL_TO_POSITION_RESPONSE",
            requestId: message.requestId,
            source: MessageSource.CONTENT,
            payload: { actualY: window.scrollY },
          });
        });
        return true; // async response
      }

      // DOM readiness probe — waits for DOM quiescence using MutationObserver + rAF
      if (message.type === "DOM_READY_PROBE") {
        const { timeoutMs, waitForElements } = message.payload;
        const probeStart = performance.now();

        const respond = () => {
          const elCount = document.querySelectorAll(
            "a, button, input, select, textarea, [role='button'], [role='link'], [role='textbox'], [tabindex]",
          ).length;
          sendResponse({
            type: "DOM_READY_ACK",
            requestId: message.requestId,
            source: MessageSource.CONTENT,
            payload: {
              waitedMs: Math.round(performance.now() - probeStart),
              elementCount: elCount,
              documentState: getPageDocumentState(),
            },
          });
        };

        // Fast path: if DOM already has elements and we don't need to wait for mutations
        const quickCount = document.querySelectorAll(
          "a, button, input, select, textarea, [role='button'], [role='link'], [role='textbox'], [tabindex]",
        ).length;
        if (quickCount > 0 && !waitForElements) {
          respond();
          return true;
        }

        // Watch for DOM mutations. Use requestIdleCallback (when available) for
        // framework-aware settling — the browser confirms the main thread is idle,
        // meaning React/Vue/Angular commits are done. Falls back to 2-frame idle
        // detection on older browsers.
        detectFramework();
        const hasIdleCallback = typeof requestIdleCallback === "function";
        let idleFrames = 0;
        let settled = false;
        const cap = Math.min(timeoutMs || 150, 500); // hard cap 500ms

        const observer = new MutationObserver(() => {
          idleFrames = 0; // reset on any mutation
        });
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
        });

        // Safety net: always wait at least MIN_SETTLE_MS even if the smart
        // detection fires early. Catches React/Vue microtask state flushes
        // that complete between animation frames.
        const MIN_SETTLE_MS = 50;

        const settle = () => {
          if (settled) return;
          const elCount = document.querySelectorAll(
            "a, button, input, select, textarea, [role='button'], [role='link'], [role='textbox'], [tabindex]",
          ).length;
          if (!waitForElements || elCount > 0) {
            const elapsed = performance.now() - probeStart;
            if (elapsed < MIN_SETTLE_MS) {
              // Smart detection fired early — wait for the safety floor
              setTimeout(() => {
                if (settled) return;
                settled = true;
                observer.disconnect();
                clearTimeout(timer);
                respond();
              }, MIN_SETTLE_MS - elapsed);
              return;
            }
            settled = true;
            observer.disconnect();
            clearTimeout(timer);
            respond();
          }
        };

        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            observer.disconnect();
            respond();
          }
        }, cap);

        const checkIdle = () => {
          if (settled) return;
          idleFrames++;
          if (idleFrames >= 2 && hasIdleCallback) {
            // 2 idle frames + requestIdleCallback: browser confirms main thread
            // is free — framework render commits (React, Vue, Angular) are done.
            // 2 frames (not 1) ensures React's batched state updates from synthetic
            // events have committed before we snapshot.
            requestIdleCallback(() => settle(), { timeout: 50 });
            return;
          }
          if (idleFrames >= 2) {
            // Fallback: 2 consecutive animation frames with no mutations
            settle();
            return;
          }
          requestAnimationFrame(checkIdle);
        };
        requestAnimationFrame(checkIdle);
        return true; // async response
      }

      if (message.type === "DOM_SNAPSHOT_REQUEST") {
        (async () => {
          const start = performance.now();

          // Auto-dismiss overlays that block the viewport (synchronous — no sleep needed)
          // Skipped for post-tool refreshes (autoDismiss: false) so agent-triggered
          // dialogs like confirmation prompts are not destroyed.
          let dismissedTexts: string[] = [];
          const shouldDismiss = message.payload.autoDismiss !== false;
          const overlays = detectViewportCoveringOverlays();
          if (overlays.length > 0 && shouldDismiss) {
            const result = autoDismissModals();
            dismissedTexts = result.capturedTexts;
          }

          const snapshot = buildSnapshot(message.payload.refresh);

          // Archivist: attach captured overlay text to snapshot for LLM context
          if (dismissedTexts.length > 0) {
            snapshot.capturedTexts = dismissedTexts;
          }

          // Detect survivors and attach to snapshot
          const survivors = detectViewportCoveringOverlays();
          if (survivors.length > 0) {
            snapshot.survivingOverlays = survivors.map((s) => ({
              tagId: addDynamicTag(s.el),
              coveragePercent: Math.round(s.coverage),
            }));
          }

          sendResponse({
            type: "DOM_SNAPSHOT_RESPONSE",
            requestId: message.requestId,
            source: MessageSource.CONTENT,
            payload: {
              snapshot,
              durationMs: Math.round(performance.now() - start),
              documentState: getPageDocumentState(),
            },
          });
        })();
        return true; // async response
      }

      // LP-24: capture bracket — hide the presence cursor the same frame so
      // perception screenshots never contain it (RFC §6).
      if (message.type === "PRESENCE_SUSPEND") {
        suspendPresence();
        sendResponse?.({ ok: true });
        return true;
      }
      if (message.type === "PRESENCE_RESUME") {
        resumePresence();
        sendResponse?.({ ok: true });
        return true;
      }

      if (message.type === "TOOL_EXECUTE") {
        const { toolName, args, toolCallId, observationBasis } = message.payload;
        let responded = false;
        const respond = (res: any) => {
          if (responded) return;
          responded = true;
          sendResponse({
            type: "TOOL_RESULT",
            requestId: message.requestId,
            source: MessageSource.CONTENT,
            payload: { toolCallId, ...res },
          });
        };
        if (rejectStaleToolRequest(observationBasis, respond)) return true;
        // Safety timeout: ensure sendResponse is always called
        setTimeout(() => {
          if (!responded) {
            console.error("[content] TOOL_EXECUTE timed out for", toolName);
            respond({
              success: false,
              result: `Tool execution timed out: ${toolName}`,
              navigated: false,
            });
          }
        }, 10_000);
        try {
          const res = executeAction(toolName, args, toolCallId);
          Promise.resolve(res)
            .then(respond)
            .catch((err: any) => {
              console.error("[content] TOOL_EXECUTE error:", toolName, err);
              respond({
                success: false,
                result: `Tool error: ${err?.message || err}`,
                navigated: false,
              });
            });
        } catch (err: any) {
          console.error("[content] TOOL_EXECUTE sync error:", toolName, err);
          respond({
            success: false,
            result: `Tool sync error: ${err?.message || err}`,
            navigated: false,
          });
        }
        return true; // async response
      }
    },
  );
}

// --- Website Skill Recording Overlay ---

let skillRecordingActive = false;
let skillRecordingAbort: AbortController | null = null;
let skillRecordingLastHref = window.location.href;
const skillRecordingInputTimers = new WeakMap<
  Element,
  ReturnType<typeof setTimeout>
>();

function startSkillRecording() {
  if (skillRecordingActive) return;
  skillRecordingActive = true;
  skillRecordingLastHref = window.location.href;
  skillRecordingAbort = new AbortController();
  ensureSkillRecordingStyles();
  renderSkillRecordingOverlay({
    onStop: () => {
      chrome.runtime
        .sendMessage({
          type: "SKILL_RECORDING_STOP",
          requestId: crypto.randomUUID(),
          source: MessageSource.CONTENT,
          payload: {},
        })
        .catch(() => {});
    },
    onCancel: () => {
      chrome.runtime
        .sendMessage({
          type: "SKILL_RECORDING_CANCEL",
          requestId: crypto.randomUUID(),
          source: MessageSource.CONTENT,
          payload: {},
        })
        .catch(() => {});
    },
  });
  emitSkillRecordingEvent("page", document.title || "page");

  const signal = skillRecordingAbort.signal;
  document.addEventListener("click", handleSkillRecordingClick, {
    capture: true,
    signal,
  });
  document.addEventListener("change", handleSkillRecordingChange, {
    capture: true,
    signal,
  });
  document.addEventListener("input", handleSkillRecordingInput, {
    capture: true,
    signal,
  });
  window.addEventListener("popstate", checkSkillRecordingNavigation, {
    signal,
  });
  window.addEventListener("hashchange", checkSkillRecordingNavigation, {
    signal,
  });
}

function stopSkillRecording() {
  skillRecordingActive = false;
  skillRecordingAbort?.abort();
  skillRecordingAbort = null;
  removeSkillRecordingOverlay();
}

function handleSkillRecordingClick(event: MouseEvent) {
  if (!skillRecordingActive) return;
  const target = event.target instanceof Element ? event.target : null;
  const el = target?.closest<HTMLElement>(
    "button, a, [role='button'], input, textarea, select, [contenteditable='true']",
  );
  if (!el || isRecordingOverlayElement(el)) return;
  if (isEditableElement(el)) return;
  pulseSkillRecordingElement(el, "click");
  emitSkillRecordingEvent("click", getElementLabel(el), el);
  checkSkillRecordingNavigationSoon();
}

function handleSkillRecordingChange(event: Event) {
  if (!skillRecordingActive) return;
  const el = event.target instanceof HTMLElement ? event.target : null;
  if (!el || isRecordingOverlayElement(el)) return;
  captureSkillRecordingField(el);
}

function handleSkillRecordingInput(event: Event) {
  if (!skillRecordingActive) return;
  const el = event.target instanceof HTMLElement ? event.target : null;
  if (!el || isRecordingOverlayElement(el)) return;
  if (isCheckableInput(el)) return;
  if (!isEditableElement(el)) return;
  const previous = skillRecordingInputTimers.get(el);
  if (previous) clearTimeout(previous);
  skillRecordingInputTimers.set(
    el,
    setTimeout(() => captureSkillRecordingField(el), 500),
  );
}

function captureSkillRecordingField(el: HTMLElement) {
  if (!skillRecordingActive || !isEditableElement(el)) return;
  pulseSkillRecordingElement(el, "field");
  const input = el as
    | HTMLInputElement
    | HTMLTextAreaElement
    | HTMLSelectElement;
  const label = getElementLabel(el);
  const inputType =
    el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase();
  const value =
    "value" in input ? String(input.value || "") : el.textContent || "";
  const sensitive = isSensitiveInput(inputType);

  if (el instanceof HTMLSelectElement) {
    emitSkillRecordingEvent("select", label, el, {
      selectedLabel: el.selectedOptions?.[0]?.textContent?.trim() || undefined,
    });
    return;
  }

  if (
    el instanceof HTMLInputElement &&
    (el.type === "checkbox" || el.type === "radio")
  ) {
    emitSkillRecordingEvent("checkbox", label, el, {
      checked: el.checked,
      controlType: el.type === "radio" ? "radio" : "checkbox",
      inputType,
    });
    return;
  }

  if (!value && !(el instanceof HTMLElement && el.isContentEditable)) return;
  emitSkillRecordingEvent("input", label, el, {
    inputType,
    sensitive,
    valueKind: sensitive ? "redacted" : classifyValueKind(value, inputType),
  });
}

function checkSkillRecordingNavigationSoon() {
  setTimeout(checkSkillRecordingNavigation, 350);
  setTimeout(checkSkillRecordingNavigation, 900);
}

function checkSkillRecordingNavigation() {
  if (
    !skillRecordingActive ||
    window.location.href === skillRecordingLastHref
  ) {
    return;
  }
  skillRecordingLastHref = window.location.href;
  resetStableIds();
  emitSkillRecordingEvent("navigation", window.location.pathname || "/");
}

function emitSkillRecordingEvent(
  kind: Parameters<typeof withTimelineText>[0]["kind"],
  label: string,
  el?: HTMLElement,
  extra: Partial<Parameters<typeof withTimelineText>[0]> = {},
) {
  const event = withTimelineText({
    id: crypto.randomUUID(),
    kind,
    timestamp: Date.now(),
    url: window.location.href,
    path: window.location.pathname || "/",
    label: label.trim().slice(0, 120) || "unnamed control",
    tagName: el?.tagName.toLowerCase(),
    ...extra,
  });
  chrome.runtime
    .sendMessage({
      type: "SKILL_RECORDING_EVENT",
      requestId: crypto.randomUUID(),
      source: MessageSource.CONTENT,
      payload: { event },
    })
    .catch(() => {});
}

function isEditableElement(el: HTMLElement): boolean {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    el.isContentEditable
  );
}

function isCheckableInput(el: HTMLElement): el is HTMLInputElement {
  return (
    el instanceof HTMLInputElement &&
    (el.type === "checkbox" || el.type === "radio")
  );
}

function getElementLabel(el: HTMLElement): string {
  const aria = el.getAttribute("aria-label") || el.getAttribute("title");
  if (aria?.trim()) return aria.trim();
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }
  const wrappingLabel = el.closest("label");
  if (wrappingLabel?.textContent?.trim())
    return wrappingLabel.textContent.trim();
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .filter(Boolean)
      .join(" ");
    if (text) return text;
  }
  const placeholder = el.getAttribute("placeholder");
  if (placeholder?.trim()) return placeholder.trim();
  const text = (el.innerText || el.textContent || "")
    .trim()
    .replace(/\s+/g, " ");
  if (text) return text;
  return el.getAttribute("name") || el.id || el.tagName.toLowerCase();
}

// --- Agent Activity Border Overlay ---

const E2E_VISIBLE_RAIL_STORAGE_KEY = "opensidebar:e2eVisibleRail";
let agentSessionActive = false;
let agentPageActivityActive = false;
let watchPageActivityActive = false;
let agentCueTimer: ReturnType<typeof setTimeout> | null = null;
let floatingCueRemoveTimer: ReturnType<typeof setTimeout> | null = null;
let agentCueFadeTimer: ReturnType<typeof setTimeout> | null = null;
let e2eRailEnabled: boolean | null = null;
let e2eRailState: E2ERailState = {
  active: false,
  status: "Idle",
  detail: "Waiting for task",
  outcome: "",
  updatedAt: 0,
  prompt: "",
  planItems: [] as string[],
  feed: [] as Array<{
    id: string;
    kind: "status" | "step" | "plan" | "completion";
    text: string;
    timestamp: number;
  }>,
  finalText: "",
};

function readAgentActivitySignalState(): AgentActivitySignalState {
  return {
    sessionActive: agentSessionActive,
    pageActivityActive: agentPageActivityActive,
    rail: {
      active: e2eRailState.active,
      status: e2eRailState.status as AgentActivitySignalState["rail"]["status"],
      outcome:
        e2eRailState.outcome as AgentActivitySignalState["rail"]["outcome"],
    },
  };
}

function applyAgentActivitySignalState(state: AgentActivitySignalState): void {
  agentSessionActive = state.sessionActive;
  agentPageActivityActive = state.pageActivityActive;
  e2eRailState = {
    ...e2eRailState,
    active: state.rail.active,
    status: state.rail.status,
    outcome: state.rail.outcome,
  };
}

function clearAgentCueTimer() {
  if (agentCueTimer) {
    clearTimeout(agentCueTimer);
    agentCueTimer = null;
  }
}

function clearFloatingCueRemoveTimer() {
  if (floatingCueRemoveTimer) {
    clearTimeout(floatingCueRemoveTimer);
    floatingCueRemoveTimer = null;
  }
}

function clearAgentCueFadeTimer() {
  if (agentCueFadeTimer) {
    clearTimeout(agentCueFadeTimer);
    agentCueFadeTimer = null;
  }
}

function resetFloatingCueForActiveRun() {
  clearFloatingCueRemoveTimer();
  clearAgentCueFadeTimer();

  const existing = document.getElementById(AGENT_BORDER_ID);
  existing?.getAnimations?.().forEach((animation) => animation.cancel());
  if (existing) existing.style.opacity = "1";
}

function scheduleAgentCueHide(delayMs: number) {
  clearAgentCueTimer();
  agentCueTimer = setTimeout(() => {
    if (agentSessionActive) {
      hideFloatingCue();
    } else {
      setAgentBorder(false);
    }
    agentCueTimer = null;
  }, delayMs);
}

async function isE2ERailEnabled(): Promise<boolean> {
  if (e2eRailEnabled != null) return e2eRailEnabled;
  try {
    const data = await chrome.storage.local.get(E2E_VISIBLE_RAIL_STORAGE_KEY);
    e2eRailEnabled = data[E2E_VISIBLE_RAIL_STORAGE_KEY] === true;
  } catch {
    e2eRailEnabled = false;
  }
  return e2eRailEnabled;
}

function isE2EOverlayPanelMounted(): boolean {
  return (
    e2eOverlayMounted || Boolean(document.getElementById(E2E_OVERLAY_HOST_ID))
  );
}

async function renderE2ERail() {
  await renderE2ERailElement(e2eRailState, {
    isPanelMounted: isE2EOverlayPanelMounted,
    isEnabled: isE2ERailEnabled,
  });
}

function hideFloatingCue() {
  const existingBtn = document.getElementById(FLOATING_WRAP_ID);
  if (!existingBtn) return;
  clearFloatingCueRemoveTimer();
  existingBtn.setAttribute("data-visible", "false");
  floatingCueRemoveTimer = setTimeout(() => {
    if (existingBtn.isConnected) existingBtn.remove();
    floatingCueRemoveTimer = null;
  }, 220);
}

function removeFloatingHudOnly() {
  clearAgentCueTimer();
  clearFloatingCueRemoveTimer();
  clearAgentCueFadeTimer();
  document.getElementById(FLOATING_WRAP_ID)?.remove();
}

function removeFloatingAgentCue() {
  removeFloatingHudOnly();
  removeAgentBorder();
}

let passivePageObserver: MutationObserver | null = null;
let passivePageChangeTimer: ReturnType<typeof setTimeout> | null = null;
let passivePageSessionId: string | null = null;

function configurePassivePageListener(
  active: boolean,
  sessionId: string,
): void {
  passivePageObserver?.disconnect();
  passivePageObserver = null;
  passivePageSessionId = active ? sessionId : null;
  if (passivePageChangeTimer) clearTimeout(passivePageChangeTimer);
  passivePageChangeTimer = null;
  if (!active || !document.documentElement) return;

  passivePageObserver = new MutationObserver((records) => {
    const meaningful = records.some((record) => {
      const element =
        record.target instanceof Element
          ? record.target
          : record.target.parentElement;
      if (element && isOwnElement(element)) return false;
      if (record.type !== "childList") return true;
      const changedNodes = [...record.addedNodes, ...record.removedNodes];
      return (
        changedNodes.length === 0 ||
        changedNodes.some((node) => {
          const changedElement =
            node instanceof Element ? node : node.parentElement;
          return !changedElement || !isOwnElement(changedElement);
        })
      );
    });
    if (!meaningful || passivePageChangeTimer) return;
    passivePageChangeTimer = setTimeout(() => {
      passivePageChangeTimer = null;
      const currentSessionId = passivePageSessionId;
      if (!currentSessionId) return;
      void chrome.runtime
        .sendMessage({
          type: "PASSIVE_MONITOR_PAGE_CHANGED",
          source: MessageSource.CONTENT,
          requestId: crypto.randomUUID(),
          payload: { sessionId: currentSessionId },
        } satisfies RuntimeMessage)
        .catch(() => undefined);
    }, 250);
  });
  passivePageObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      "aria-disabled",
      "aria-label",
      "class",
      "disabled",
      "hidden",
      "style",
      "value",
    ],
  });
}

function applyWatchPageActivity(active: boolean): void {
  watchPageActivityActive = active;
  if (active) {
    clearAgentCueFadeTimer();
    ensureAgentBorderElementVisible("active");
    if (isE2EOverlayPanelMounted() && !agentPageActivityActive) {
      removeFloatingHudOnly();
    }
    return;
  }

  if (!agentPageActivityActive) {
    removeAgentBorder();
  }
}

function setAgentBorder(
  active: boolean,
  outcome?: { status: "completed" | "failed" | "stopped"; label?: string },
  visualState: AgentBorderVisualState = "active",
) {
  const existing = document.getElementById(AGENT_BORDER_ID);
  const existingBtn = document.getElementById(FLOATING_WRAP_ID);

  if (active) {
    resetFloatingCueForActiveRun();
    // No animation — just a persistent "agent is active" indicator.
    ensureAgentBorderElementVisible(visualState);

    removeFloatingHudOnly();
  } else {
    // --- Remove border + any stale HUD from older content-script versions. ---
    clearAgentCueFadeTimer();
    agentCueFadeTimer = setTimeout(() => {
      agentCueFadeTimer = null;
      if (existing) {
        if (watchPageActivityActive) {
          ensureAgentBorderElementVisible("active");
        } else {
          existing.animate([{ opacity: "1" }, { opacity: "0" }], {
            duration: 600,
            easing: "ease-in",
            fill: "forwards",
          }).onfinish = () => existing.remove();
        }
      }
      if (existingBtn) {
        hideFloatingCue();
      }
    }, 0);
  }
}
