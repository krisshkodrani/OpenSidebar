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
import {
  RuntimeMessage,
  MessageSource,
  OverlayDescriptor,
  ElementRect,
} from "../types";
import { buildSnapshot } from "./snapshot";
import { executeAction } from "./actions";
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
import {
  createFloatingActionHud,
  DIVIDER_ID,
  FLOATING_WRAP_ID,
  resetFloatingActionHudForActiveRun,
  STEP_LABEL_ID,
  STOP_BTN_ID,
} from "./in-page-ui/floating-action-hud";
import {
  removeE2ERail,
  renderE2ERail as renderE2ERailElement,
  type E2ERailState,
} from "./in-page-ui/e2e-rail";

logger.info("system", "Content Script Loaded");

/** Privacy-respecting consent buttons, ordered by preference (reject > accept) */
const CONSENT_TEXT =
  /^(reject all|reject|decline all|decline|necessary only|essentials only|accept all|accept cookies|accept all cookies|allow all|accept|agree|i agree|consent|allow)$/i;

/** Generic dismiss buttons (non-consent) */
const DISMISS_TEXT =
  /^(close|dismiss|got it|ok|okay|no thanks|not now|maybe later|skip|i understand|continue|confirm|proceed|acknowledge|deny)$/i;

/** Query selector that also pierces one level of shadow DOM */
function querySelectorAllWithShadow(
  root: HTMLElement,
  selector: string,
): HTMLElement[] {
  const results = Array.from(root.querySelectorAll(selector)).filter(
    (el): el is HTMLElement => el instanceof HTMLElement,
  );
  for (const el of root.querySelectorAll("*")) {
    if (el.shadowRoot) {
      for (const shadow of el.shadowRoot.querySelectorAll(selector)) {
        if (shadow instanceof HTMLElement) results.push(shadow);
      }
    }
  }
  return results;
}

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
const E2E_OVERLAY_SEND_MESSAGE_EVENT = "opensidebar:overlay:send-message";
const E2E_OVERLAY_RECEIVE_MESSAGE_EVENT = "opensidebar:overlay:receive-message";
const E2E_OVERLAY_SEND_RESPONSE_EVENT = "opensidebar:overlay:send-response";
const E2E_OVERLAY_STORAGE_REQUEST_EVENT = "opensidebar:overlay:storage-request";
const E2E_OVERLAY_STORAGE_RESPONSE_EVENT =
  "opensidebar:overlay:storage-response";
const E2E_OVERLAY_MOUNT_EVENT = "opensidebar:overlay:mount";
const E2E_OVERLAY_DISPOSE_EVENT = "opensidebar:overlay:dispose";
let e2eOverlayBridgeInstalled = false;
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

type E2EOverlayStorageAreaName = "local" | "sync" | "session";

type E2EOverlayStorageRequestDetail = {
  requestId?: string;
  area?: E2EOverlayStorageAreaName;
  operation?: "get" | "set" | "remove";
  keys?: string | string[] | Record<string, unknown> | null;
  items?: Record<string, unknown>;
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
      storageMode: "chrome-bridge",
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

function dispatchE2EOverlayRuntimeMessage(message: RuntimeMessage): void {
  if (!e2eOverlayMounted) return;
  window.dispatchEvent(
    new CustomEvent(E2E_OVERLAY_RECEIVE_MESSAGE_EVENT, {
      detail: { message },
    }),
  );
}

function dispatchE2EOverlayResponse(
  requestId: string,
  response?: unknown,
  error?: unknown,
): void {
  window.dispatchEvent(
    new CustomEvent(E2E_OVERLAY_SEND_RESPONSE_EVENT, {
      detail: {
        requestId,
        response,
        error:
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : undefined,
      },
    }),
  );
}

function dispatchE2EOverlayStorageResponse(
  requestId: string,
  response?: Record<string, unknown>,
  error?: unknown,
): void {
  window.dispatchEvent(
    new CustomEvent(E2E_OVERLAY_STORAGE_RESPONSE_EVENT, {
      detail: {
        requestId,
        response,
        error:
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : undefined,
      },
    }),
  );
}

function storageAreaForE2EOverlay(
  areaName: E2EOverlayStorageAreaName,
): chrome.storage.StorageArea {
  return chrome.storage[areaName];
}

function ensureE2EOverlayBridge(): void {
  if (e2eOverlayBridgeInstalled) return;
  e2eOverlayBridgeInstalled = true;
  window.addEventListener(E2E_OVERLAY_SEND_MESSAGE_EVENT, (event) => {
    const detail = (
      event as CustomEvent<{ message?: unknown; requestId?: string }>
    ).detail;
    if (!detail?.requestId) return;
    chrome.runtime
      .sendMessage(detail.message)
      .then((response) =>
        dispatchE2EOverlayResponse(detail.requestId!, response),
      )
      .catch((error) =>
        dispatchE2EOverlayResponse(detail.requestId!, undefined, error),
      );
  });
  window.addEventListener(E2E_OVERLAY_STORAGE_REQUEST_EVENT, (event) => {
    const detail = (event as CustomEvent<E2EOverlayStorageRequestDetail>)
      .detail;
    const requestId = detail?.requestId;
    if (!requestId || !detail.area || !detail.operation) return;
    const area = storageAreaForE2EOverlay(detail.area);
    const run = async (): Promise<Record<string, unknown>> => {
      if (detail.operation === "get") {
        return (await area.get(detail.keys as any)) as unknown as Record<
          string,
          unknown
        >;
      }
      if (detail.operation === "set") {
        await area.set(detail.items ?? {});
        return {};
      }
      await area.remove(detail.keys as any);
      return {};
    };
    run()
      .then((response) =>
        dispatchE2EOverlayStorageResponse(requestId, response),
      )
      .catch((error) =>
        dispatchE2EOverlayStorageResponse(requestId, undefined, error),
      );
  });
}

async function mountE2EOverlay(
  payload: E2EOverlayMountPayload,
): Promise<{ ok: true; loaded: boolean }> {
  ensureE2EOverlayBridge();
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
    // only prepares config and bridge state before the loader imports the module.
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
  e2eOverlayMounted = false;
  return { ok: true };
}

/**
 * Detect elements that cover >15% of the viewport via fixed/absolute positioning.
 * Returns elements sorted by coverage descending.
 */
export function detectViewportCoveringOverlays(): {
  el: HTMLElement;
  coverage: number;
  rect: DOMRect;
}[] {
  const vpW = window.innerWidth;
  const vpH = window.innerHeight;
  const vpArea = vpW * vpH;
  if (vpArea === 0) return [];

  const OVERLAY_SCAN_BUDGET_MS = 15;
  const results: { el: HTMLElement; coverage: number; rect: DOMRect }[] = [];
  const allElements = document.querySelectorAll("*");
  const start = performance.now();

  for (const raw of allElements) {
    if (performance.now() - start > OVERLAY_SCAN_BUDGET_MS) break;
    if (!(raw instanceof HTMLElement)) continue;
    if (raw.id === AGENT_BORDER_ID) continue;
    if (isOwnElement(raw)) continue;
    if (!isElementVisible(raw)) continue;

    let style: CSSStyleDeclaration;
    try {
      style = window.getComputedStyle(raw);
    } catch {
      continue;
    }
    if (style.position !== "fixed" && style.position !== "absolute") continue;

    const rect = raw.getBoundingClientRect();
    // Clamp to viewport
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(vpW, rect.right);
    const bottom = Math.min(vpH, rect.bottom);
    const visibleW = Math.max(0, right - left);
    const visibleH = Math.max(0, bottom - top);
    const visibleArea = visibleW * visibleH;
    const coverage = (visibleArea / vpArea) * 100;

    if (coverage > 15) {
      results.push({ el: raw, coverage, rect });
    }
  }

  results.sort((a, b) => b.coverage - a.coverage);
  return results;
}

/**
 * Heuristic: does this element look like primary app content rather than a
 * nuisance overlay (cookie banner, GDPR modal, promo popup)?
 *
 * Real app panels (e.g. LinkedIn messaging, SPA drawers) are fixed/overlay-
 * positioned but contain significant interactive content. Cookie banners
 * typically have 1-5 buttons and little text. We skip dismissal when the
 * element clearly holds app content the user needs.
 */
function isLikelyAppContent(el: HTMLElement): boolean {
  // IFRAMEs are never cookie banners — hiding one blanks the page
  const tag = el.tagName.toLowerCase();
  if (tag === "iframe") return true;

  // Semantic containers are never nuisance overlays
  if (tag === "main" || tag === "nav" || tag === "header") return true;
  const role = el.getAttribute("role");
  if (role === "main" || role === "navigation") return true;

  // If the element contains a <main>, <nav>, or common SPA root, it's app content
  if (
    el.querySelector(
      "main, nav, [role='main'], [role='navigation'], #app, #root, #__next, #__nuxt",
    )
  ) {
    return true;
  }

  // Count interactive children — app panels have many, cookie banners have few
  const interactiveCount = el.querySelectorAll(
    "a[href], button, input, textarea, select, [contenteditable='true']",
  ).length;
  if (interactiveCount > 10) return true;

  // Substantial text content (cookie banners rarely exceed a few hundred chars)
  const textLen = (el.textContent || "").length;
  if (textLen > 1000) return true;

  return false;
}

/**
 * Check if an element looks like a backdrop/scrim overlay.
 */
export function isBackdropElement(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);

  // Has backdrop-filter (blur, brightness, etc.)
  if (style.backdropFilter && style.backdropFilter !== "none") return true;

  // Semi-transparent background color (rgba with alpha between 0 exclusive and 0.9 inclusive)
  const bg = style.backgroundColor;
  const rgbaMatch = bg.match(
    /rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*([\d.]+)\s*)?\)/,
  );
  if (rgbaMatch && rgbaMatch[1] !== undefined) {
    const alpha = parseFloat(rgbaMatch[1]);
    if (alpha > 0 && alpha <= 0.9) return true;
  }

  return false;
}

/**
 * Search within an overlay for a close/dismiss button.
 * Returns the first visible match or null.
 * Priority: aria-label > class-based > X/× text in top-right quadrant.
 */
export function findCloseButton(overlay: HTMLElement): HTMLElement | null {
  // Priority 1: aria-label based
  const ariaSelectors = [
    '[aria-label*="close" i]',
    '[aria-label*="dismiss" i]',
    '[aria-label*="Close" i]',
    '[aria-label*="Dismiss" i]',
  ];
  for (const sel of ariaSelectors) {
    const el = overlay.querySelector(sel);
    if (el instanceof HTMLElement && isElementVisible(el)) return el;
  }

  // Priority 2: class-based
  const classSelectors = [
    ".close",
    ".dismiss",
    ".btn-close",
    '[class*="close-btn"]',
    '[class*="modal-close"]',
  ];
  for (const sel of classSelectors) {
    const el = overlay.querySelector(sel);
    if (el instanceof HTMLElement && isElementVisible(el)) return el;
  }

  // Priority 3: Consent-specific text buttons (privacy-preferring order)
  const overlayText = (overlay.textContent || "").toLowerCase();
  const isConsent =
    /cookie|consent|gdpr|privacy|tracking|personali[sz]|data collection/.test(
      overlayText,
    );
  if (isConsent) {
    const btns = querySelectorAllWithShadow(
      overlay,
      "button, a, [role='button']",
    );
    let best: HTMLElement | null = null;
    let bestPriority = 999;
    for (const btn of btns) {
      if (!isElementVisible(btn)) continue;
      const text = btn.textContent?.trim() || "";
      // Prefer reject (priority 1) over accept (priority 2)
      if (
        /^(reject all|reject|decline all|decline|necessary only|essentials only)$/i.test(
          text,
        )
      ) {
        if (bestPriority > 1) {
          best = btn;
          bestPriority = 1;
        }
      } else if (CONSENT_TEXT.test(text)) {
        if (bestPriority > 2) {
          best = btn;
          bestPriority = 2;
        }
      }
    }
    if (best) return best;
  }

  // Priority 4: Generic dismiss text buttons
  const dismissBtns = querySelectorAllWithShadow(
    overlay,
    "button, a, [role='button']",
  );
  for (const btn of dismissBtns) {
    if (!isElementVisible(btn)) continue;
    const text = btn.textContent?.trim() || "";
    if (DISMISS_TEXT.test(text)) return btn;
  }

  // Priority 5: buttons with ×/✕/X text in top-right quadrant
  const overlayRect = overlay.getBoundingClientRect();
  const midX = overlayRect.left + overlayRect.width / 2;
  const midY = overlayRect.top + overlayRect.height / 2;
  const closeChars = /^[\s×✕xX✖✗✘☓]\s*$/;

  const buttons = querySelectorAllWithShadow(
    overlay,
    "button, [role='button'], a",
  );
  for (const btn of buttons) {
    if (!isElementVisible(btn)) continue;
    const text = btn.textContent?.trim() || "";
    // Check text or if it's an SVG-only button (no text, has svg child)
    const isSvgOnly = !text && btn.querySelector("svg") !== null;
    if (!closeChars.test(text) && !isSvgOnly) continue;

    // Must be in top-right quadrant of overlay
    const btnRect = btn.getBoundingClientRect();
    const btnCenterX = btnRect.left + btnRect.width / 2;
    const btnCenterY = btnRect.top + btnRect.height / 2;
    if (btnCenterX >= midX && btnCenterY <= midY) return btn;
  }

  return null;
}

// --- Modal Dismissal ---

/** Deduplication cache: prevents re-logging the same overlay text across calls */
const _seenOverlayTexts = new Set<string>();

/**
 * Extract meaningful text from an overlay container before dismissal.
 * Returns empty string if the overlay has no useful text.
 */
export function extractOverlayText(el: HTMLElement): string {
  const raw = (el.innerText ?? el.textContent ?? "").trim();
  if (!raw) return "";
  // Truncate to avoid giant payloads
  return raw.length > 2000 ? raw.slice(0, 2000) + "…" : raw;
}

interface DismissResult {
  dismissed: number;
  remainingOverlay: OverlayDescriptor | null;
  capturedTexts: string[];
}

/**
 * Auto-dismiss modals, overlays, banners, and popups.
 * Phase A: Selector-based (try close buttons before hiding).
 * Phase B: Viewport-cover detection (backdrop→hide, close button→click, else→hide).
 * Phase C: ESC key if anything was dismissed.
 * Phase D: Re-scan for remaining overlays.
 */
function autoDismissModals(): DismissResult {
  let dismissed = 0;
  const capturedTexts: string[] = [];

  /** Extract text, deduplicate, and log before dismissing */
  function archiveOverlay(el: HTMLElement): void {
    const text = extractOverlayText(el);
    if (!text || _seenOverlayTexts.has(text)) return;
    _seenOverlayTexts.add(text);
    capturedTexts.push(text);
    logger.info("tools", "Archived overlay text before dismissal", {
      preview: text.slice(0, 120),
    });
  }

  // Phase A: Selector-based dismissal (broad selectors for modals, banners, cookie/GDPR overlays)
  const containers = document.querySelectorAll(
    "[role='dialog'], [role='alertdialog'], [aria-modal='true'], dialog[open], [data-modal], [data-overlay], .modal, .overlay, .popup, .banner, .cookie, .consent, .lightbox, .notification, .toast, .backdrop, [class*='gdpr'], [class*='privacy'], [class*='cookie-notice'], [class*='consent-banner'], [class*='backdrop'], [id*='cookie'], [id*='consent']",
  );

  for (const el of containers) {
    if (!(el instanceof HTMLElement) || !isElementVisible(el)) continue;

    const style = window.getComputedStyle(el);
    const isOverlay =
      style.position === "fixed" ||
      style.position === "sticky" ||
      parseInt(style.zIndex, 10) > 100;

    if (!isOverlay) continue;

    // Guard: skip elements that look like primary app content
    if (isLikelyAppContent(el)) {
      logger.info("tools", "Skipped app-content overlay", {
        tag: el.tagName,
        classes: el.className.toString().slice(0, 50),
        interactive: el.querySelectorAll("a[href],button,input,textarea,select")
          .length,
      });
      continue;
    }

    // Archive text BEFORE dismissing
    archiveOverlay(el);

    // Try close button first, fall back to hiding
    const closeBtn = findCloseButton(el);
    if (closeBtn) {
      closeBtn.click();
      dismissed++;
      logger.info("tools", "Clicked close button on overlay", {
        tag: el.tagName,
        classes: el.className.toString().slice(0, 50),
      });
    } else {
      dismissElement(el);
      dismissed++;
      logger.info("tools", "Auto-hid overlay", {
        tag: el.tagName,
        classes: el.className.toString().slice(0, 50),
      });
    }
  }

  // Phase B: Viewport-cover detection (catches modals without semantic CSS)
  const coveringOverlays = detectViewportCoveringOverlays();
  for (const { el, coverage } of coveringOverlays) {
    if (!isElementVisible(el)) continue; // May have been hidden in Phase A

    // Guard: skip elements that look like primary app content (same as Phase A)
    if (!isBackdropElement(el) && isLikelyAppContent(el)) {
      logger.info("tools", "Skipped app-content covering element", {
        coverage: Math.round(coverage),
        tag: el.tagName,
        interactive: el.querySelectorAll("a[href],button,input,textarea,select")
          .length,
      });
      continue;
    }

    // Archive text BEFORE dismissing (skip pure backdrops — no useful text)
    if (!isBackdropElement(el)) {
      archiveOverlay(el);
    }

    // Try close button first (even for backdrops) — clicking triggers proper
    // framework state cleanup (React setState, Vue reactivity, etc.) so the
    // overlay doesn't reappear on the next re-render.
    const closeBtn = findCloseButton(el);
    if (closeBtn) {
      closeBtn.click();
      dismissed++;
      logger.info("tools", "Clicked close on covering overlay", {
        coverage: Math.round(coverage),
        tag: el.tagName,
        backdrop: isBackdropElement(el),
      });
    } else {
      dismissElement(el);
      dismissed++;
      logger.info(
        "tools",
        isBackdropElement(el)
          ? "Hid backdrop overlay"
          : "Hid covering overlay (no close button)",
        {
          coverage: Math.round(coverage),
          tag: el.tagName,
        },
      );
    }
  }

  // Phase C: Dispatch ESC key if anything was dismissed (closes keyboard-driven overlays)
  if (dismissed > 0) {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  }

  // Phase C.5: Restore body scroll if overlays locked it
  if (dismissed > 0) {
    for (const target of [document.body, document.documentElement]) {
      if (target && window.getComputedStyle(target).overflow === "hidden") {
        target.style.overflow = "";
      }
    }
  }

  // Phase D: Re-scan for remaining overlays
  const remaining = detectViewportCoveringOverlays();
  if (remaining.length > 0) {
    const top = remaining[0];
    const tagId = addDynamicTag(top.el);
    const rect: ElementRect = {
      x: top.rect.x,
      y: top.rect.y,
      width: top.rect.width,
      height: top.rect.height,
    };
    return {
      dismissed,
      remainingOverlay: {
        html: top.el.outerHTML.slice(0, 3000),
        tagId,
        rect,
        coveragePercent: Math.round(top.coverage),
      },
      capturedTexts,
    };
  }

  return { dismissed, remainingOverlay: null, capturedTexts };
}

// --- Message Handler ---

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(
    (message: RuntimeMessage, _sender, sendResponse) => {
      const messageType = message.type as string;
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
        void mountE2EOverlay(
          (message as unknown as { payload: E2EOverlayMountPayload }).payload,
        )
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
        sendResponse?.(unmountE2EOverlay());
        return true;
      }

      // Only accept messages from our own background service worker
      if (message.source !== MessageSource.BACKGROUND) return;
      dispatchE2EOverlayRuntimeMessage(message);

      if (message.type === "AGENT_ACTIVITY") {
        const previousSignalState = readAgentActivitySignalState();
        const reduction = reduceAgentActivitySignal(previousSignalState, {
          type: "activity",
          active: message.payload.active,
          outcome: message.payload.outcome,
          pageActivity: message.payload.pageActivity,
        });
        applyAgentActivitySignalState(reduction.state);
        if (message.payload.active && !previousSignalState.sessionActive) {
          currentFloatingStep = null;
        }
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
        } else if (previousSignalState.sessionActive && !message.payload.active) {
          setAgentBorder(false, message.payload.outcome);
        }
        return;
      }

      if (message.type === "PASSIVE_MONITOR_PAGE_ACTIVITY") {
        applyWatchPageActivity(message.payload.active);
        return;
      }

      if (message.type === "TASK_PROGRESS") {
        const subtasks = Array.isArray(message.payload?.subtasks)
          ? message.payload.subtasks
          : [];
        const currentIndex =
          typeof message.payload?.currentIndex === "number"
            ? message.payload.currentIndex
            : 0;
        currentPlanProgress =
          subtasks.length > 0 ? { currentIndex, total: subtasks.length } : null;
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
        if (currentFloatingStep) {
          updateFloatingStepLabel(
            currentFloatingStep.label,
            currentFloatingStep.status,
          );
        }
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
          updateFloatingStepLabel(
            message.payload.label,
            message.payload.status,
          );
        } else {
          currentFloatingStep = null;
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
        const result = autoDismissModals();
        sendResponse({
          type: "DISMISS_MODALS_RESPONSE",
          requestId: message.requestId,
          source: MessageSource.CONTENT,
          payload: {
            dismissed: result.dismissed,
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
            },
          });
        })();
        return true; // async response
      }

      if (message.type === "TOOL_EXECUTE") {
        const { toolName, args, toolCallId } = message.payload;
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
          const res = executeAction(toolName, args);
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
let currentPlanProgress: { currentIndex: number; total: number } | null = null;
let currentFloatingStep: {
  label: string;
  status: "running" | "done" | "error";
} | null = null;
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

function applyAgentActivitySignalState(
  state: AgentActivitySignalState,
): void {
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

  resetFloatingActionHudForActiveRun();
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

/** Update the step label text above the floating stop button */
function updateFloatingStepLabel(
  label: string,
  status: "running" | "done" | "error",
) {
  currentFloatingStep = { label, status };
  const el = document.getElementById(STEP_LABEL_ID);
  if (!el) return;
  const dot = el.querySelector("span") as HTMLSpanElement | null;
  const text = el.querySelector("[data-label]") as HTMLSpanElement | null;
  if (text) {
    text.textContent = formatFloatingStepLabel(label);
    text.style.color = "";
  }
  if (dot) {
    if (status === "error") {
      el.setAttribute("data-status", "failed");
      dot.style.background = "#ef4444";
      dot.style.animation = "none";
    } else if (status === "done") {
      el.setAttribute("data-status", "completed");
      dot.style.background = "#22c55e";
      dot.style.animation = "none";
    } else {
      el.removeAttribute("data-status");
      dot.style.background = "rgba(37,99,235,0.95)";
      dot.style.animation = "opensidebar-pulse 1.5s ease-in-out infinite";
    }
  }
}

function formatFloatingStepLabel(label: string): string {
  if (!currentPlanProgress || currentPlanProgress.total <= 0) return label;
  const stepNumber =
    Math.min(
      Math.max(currentPlanProgress.currentIndex, 0),
      currentPlanProgress.total - 1,
    ) + 1;
  return `Step ${stepNumber} of ${currentPlanProgress.total}: ${label}`;
}

function setAgentBorder(
  active: boolean,
  outcome?: { status: "completed" | "failed" | "stopped"; label?: string },
  visualState: AgentBorderVisualState = "active",
) {
  const existing = document.getElementById(AGENT_BORDER_ID);
  const existingBtn = document.getElementById(FLOATING_WRAP_ID);

  const overlayMounted = isE2EOverlayPanelMounted();

  if (active) {
    resetFloatingCueForActiveRun();
    // No animation — just a persistent "agent is active" indicator.
    ensureAgentBorderElementVisible(visualState);

    if (overlayMounted) {
      removeFloatingHudOnly();
      return;
    }

    // --- Floating HUD bar: [ ● Step label…  ⏹ Stop ] ---
    if (!existingBtn) {
      createFloatingActionHud(() => {
        chrome.runtime
          .sendMessage({
            type: "STOP_AGENT",
            requestId: crypto.randomUUID(),
            source: "content",
            payload: {},
          })
          .catch(() => {});
      });
    }
  } else {
    const fadeDelay = outcome && existingBtn ? 1500 : 0;

    // --- Show outcome flash before fading ---
    if (outcome && existingBtn) {
      // Hide stop button + divider
      const stopBtn = document.getElementById(STOP_BTN_ID);
      const divider = document.getElementById(DIVIDER_ID);
      if (stopBtn) {
        stopBtn.style.opacity = "0";
        stopBtn.style.pointerEvents = "none";
      }
      if (divider) divider.style.opacity = "0";

      // Update label to show outcome
      const labelEl = document.getElementById(STEP_LABEL_ID);
      if (labelEl) {
        const dot = labelEl.querySelector("span") as HTMLSpanElement | null;
        const text = labelEl.querySelector(
          "[data-label]",
        ) as HTMLSpanElement | null;
        labelEl.setAttribute("data-status", outcome.status);
        if (dot) {
          dot.style.animation = "none";
          dot.style.background =
            outcome.status === "completed"
              ? "#22c55e"
              : outcome.status === "failed"
                ? "#ef4444"
                : "#f59e0b";
        }
        if (text) {
          text.textContent =
            outcome.label ||
            (outcome.status === "completed"
              ? "Done"
              : outcome.status === "failed"
                ? "Failed"
                : "Stopped");
          text.style.color = "";
        }
      }
    }

    // --- Remove border + bar (delayed if showing outcome flash) ---
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
    }, fadeDelay);
  }
}
