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
import { deriveAgentCueTransition } from "./agent-cue";
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

const AGENT_BORDER_ID = "opensidebar-agent-border";
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
    removeFloatingAgentCue();
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
  removeFloatingAgentCue();
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
        agentSessionActive = message.payload.active;
        e2eRailState = {
          ...e2eRailState,
          active: message.payload.active,
          status: message.payload.active
            ? "Running"
            : message.payload.outcome?.status === "completed"
              ? "Done"
              : message.payload.outcome?.status === "failed"
                ? "Failed"
                : message.payload.outcome?.status === "stopped"
                  ? "Stopped"
                  : "Idle",
          detail:
            message.payload.outcome?.label ??
            (message.payload.active ? "Agent is working" : "Task complete"),
          outcome: message.payload.outcome?.status ?? "",
          updatedAt: Date.now(),
        };
        void renderE2ERail();
        clearAgentCueTimer();
        if (message.payload.active) {
          setAgentBorder(true, undefined, "active");
        } else {
          setAgentBorder(false, message.payload.outcome);
        }
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
        e2eRailState = {
          ...e2eRailState,
          active: message.payload.status === "running",
          status:
            message.payload.status === "running"
              ? "Running"
              : message.payload.status === "done"
                ? "Done"
                : "Failed",
          detail: message.payload.label,
          outcome:
            message.payload.status === "done"
              ? "completed"
              : message.payload.status === "error"
                ? "failed"
                : "",
          updatedAt: Date.now(),
        };
        void renderE2ERail();
        const transition = deriveAgentCueTransition({
          sessionActive: agentSessionActive,
          stepStatus: message.payload.status,
        });
        if (transition.showCue && transition.borderState) {
          setAgentBorder(true, undefined, transition.borderState);
        }
        updateFloatingStepLabel(message.payload.label, message.payload.status);
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

const RECORDING_HUD_ID = "opensidebar-recording-hud";
const RECORDING_BORDER_ID = "opensidebar-recording-border";
const RECORDING_STYLE_ID = "opensidebar-recording-style";
const RECORDING_FEEDBACK_CLASS = "opensidebar-recording-feedback";
const RECORDING_BORDER_EDGE_GLOW = [
  "linear-gradient(to bottom, rgba(220,38,38,0.16), rgba(245,158,11,0.10) 42px, transparent 92px)",
  "linear-gradient(to right, rgba(220,38,38,0.14), rgba(245,158,11,0.08) 42px, transparent 86px)",
  "linear-gradient(to left, rgba(220,38,38,0.14), rgba(245,158,11,0.08) 42px, transparent 86px)",
].join(", ");

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
  renderSkillRecordingOverlay();
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
  document.getElementById(RECORDING_HUD_ID)?.remove();
  document.getElementById(RECORDING_BORDER_ID)?.remove();
  document
    .querySelectorAll(`.${RECORDING_FEEDBACK_CLASS}`)
    .forEach((node) => node.remove());
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

  if (el instanceof HTMLInputElement && el.type === "checkbox") {
    emitSkillRecordingEvent("checkbox", label, el, {
      checked: el.checked,
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

function isRecordingOverlayElement(el: Element): boolean {
  return Boolean(el.closest(`#${RECORDING_HUD_ID}, #${RECORDING_BORDER_ID}`));
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

function pulseSkillRecordingElement(el: HTMLElement, mode: "click" | "field") {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const pulse = document.createElement("div");
  pulse.className = RECORDING_FEEDBACK_CLASS;
  pulse.setAttribute("data-mode", mode);
  Object.assign(pulse.style, {
    position: "fixed",
    left: `${Math.max(0, rect.left - 4)}px`,
    top: `${Math.max(0, rect.top - 4)}px`,
    width: `${rect.width + 8}px`,
    height: `${rect.height + 8}px`,
    pointerEvents: "none",
    zIndex: "2147483647",
  });
  document.documentElement.appendChild(pulse);
  setTimeout(() => pulse.remove(), 760);
}

function renderSkillRecordingOverlay() {
  if (!document.getElementById(RECORDING_BORDER_ID)) {
    const border = document.createElement("div");
    border.id = RECORDING_BORDER_ID;
    document.documentElement.appendChild(border);
  }

  if (document.getElementById(RECORDING_HUD_ID)) return;
  const hud = document.createElement("div");
  hud.id = RECORDING_HUD_ID;
  hud.innerHTML = `
    <div data-main>
      <span data-dot></span>
      <span data-title>Recording site skill</span>
      <span data-privacy>Typed values are redacted</span>
    </div>
    <div data-actions>
      <button type="button" data-stop>Stop</button>
      <button type="button" data-cancel>Cancel</button>
    </div>
  `;
  hud.querySelector("[data-stop]")?.addEventListener("click", () => {
    chrome.runtime
      .sendMessage({
        type: "SKILL_RECORDING_STOP",
        requestId: crypto.randomUUID(),
        source: MessageSource.CONTENT,
        payload: {},
      })
      .catch(() => {});
  });
  hud.querySelector("[data-cancel]")?.addEventListener("click", () => {
    chrome.runtime
      .sendMessage({
        type: "SKILL_RECORDING_CANCEL",
        requestId: crypto.randomUUID(),
        source: MessageSource.CONTENT,
        payload: {},
      })
      .catch(() => {});
  });
  document.documentElement.appendChild(hud);
}

function ensureSkillRecordingStyles() {
  if (document.getElementById(RECORDING_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = RECORDING_STYLE_ID;
  style.textContent = `
    #${RECORDING_BORDER_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147483645;
      pointer-events: none;
      box-shadow:
        inset 0 0 0 2px rgba(220, 38, 38, 0.88),
        inset 0 0 0 7px rgba(245, 158, 11, 0.28);
    }

    #${RECORDING_BORDER_ID}::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: ${RECORDING_BORDER_EDGE_GLOW};
      background-repeat: no-repeat;
      background-size: 100% 100px, 100px 100%, 100px 100%;
      background-position: top, left, right;
      opacity: 0.82;
    }

    #${RECORDING_HUD_ID} {
      position: fixed;
      left: 50%;
      bottom: 18px;
      transform: translateX(-50%);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 12px;
      max-width: min(620px, calc(100vw - 28px));
      padding: 8px 9px 8px 12px;
      border: 1px solid rgba(185, 28, 28, 0.28);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.96);
      color: #7f1d1d;
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.18);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      pointer-events: auto;
    }

    #${RECORDING_HUD_ID} [data-main] {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    #${RECORDING_HUD_ID} [data-dot] {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #dc2626;
      box-shadow: 0 0 0 5px rgba(220, 38, 38, 0.16);
      animation: opensidebar-recording-dot 1.2s ease-in-out infinite;
      flex-shrink: 0;
    }

    #${RECORDING_HUD_ID} [data-title] {
      font-size: 12px;
      line-height: 16px;
      font-weight: 700;
      white-space: nowrap;
    }

    #${RECORDING_HUD_ID} [data-privacy] {
      font-size: 11px;
      line-height: 15px;
      color: #92400e;
      white-space: nowrap;
    }

    #${RECORDING_HUD_ID} [data-actions] {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    #${RECORDING_HUD_ID} button {
      border: 1px solid rgba(185, 28, 28, 0.24);
      border-radius: 7px;
      background: rgba(254, 242, 242, 0.9);
      color: #991b1b;
      cursor: pointer;
      font-size: 12px;
      line-height: 16px;
      font-weight: 650;
      padding: 5px 9px;
      letter-spacing: 0;
    }

    #${RECORDING_HUD_ID} button:hover {
      background: #fee2e2;
    }

    .${RECORDING_FEEDBACK_CLASS} {
      border: 2px solid rgba(220, 38, 38, 0.88);
      border-radius: 8px;
      animation: opensidebar-recording-pulse 720ms ease-out forwards;
    }

    .${RECORDING_FEEDBACK_CLASS}[data-mode="field"] {
      border-color: rgba(245, 158, 11, 0.94);
      background: rgba(245, 158, 11, 0.08);
    }

    @keyframes opensidebar-recording-dot {
      0%, 100% { opacity: 0.66; transform: scale(0.9); }
      50% { opacity: 1; transform: scale(1.08); }
    }

    @keyframes opensidebar-recording-pulse {
      0% { opacity: 0; transform: scale(0.98); }
      18% { opacity: 1; transform: scale(1); }
      100% { opacity: 0; transform: scale(1.08); }
    }

    @media (max-width: 640px) {
      #${RECORDING_HUD_ID} {
        align-items: stretch;
        flex-direction: column;
        width: calc(100vw - 28px);
      }

      #${RECORDING_HUD_ID} [data-main] {
        flex-wrap: wrap;
      }

      #${RECORDING_HUD_ID} [data-actions] {
        justify-content: flex-end;
      }
    }
  `;
  document.documentElement.appendChild(style);
}

// --- Agent Activity Border Overlay ---

const BORDER_ID = "opensidebar-agent-border";
const BORDER_STYLE_ID = "opensidebar-agent-border-style";
const HUD_STYLE_ID = "opensidebar-agent-hud-style";
const STOP_BTN_ID = "opensidebar-stop-btn";
const STEP_LABEL_ID = "opensidebar-step-label";
const FLOATING_WRAP_ID = "opensidebar-floating-wrap";
const DIVIDER_ID = "opensidebar-divider";
const E2E_RAIL_ID = "opensidebar-e2e-rail";
const E2E_RAIL_STYLE_ID = "opensidebar-e2e-rail-style";
const E2E_VISIBLE_RAIL_STORAGE_KEY = "opensidebar:e2eVisibleRail";
let agentSessionActive = false;
let agentCueTimer: ReturnType<typeof setTimeout> | null = null;
let e2eRailEnabled: boolean | null = null;
let currentPlanProgress: { currentIndex: number; total: number } | null = null;
let currentFloatingStep: {
  label: string;
  status: "running" | "done" | "error";
} | null = null;
let e2eRailState = {
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

type AgentBorderVisualState = "active" | "settle";

const AGENT_BORDER_ACTIVE_SHADOW = [
  "inset 0 0 0 2px rgba(37,99,235,0.78)",
  "inset 0 0 0 6px rgba(37,99,235,0.32)",
  "inset 0 0 0 12px rgba(37,99,235,0.18)",
  "inset 0 0 0 20px rgba(37,99,235,0.10)",
  "inset 0 0 40px rgba(37,99,235,0.14)",
  "inset 0 0 84px rgba(37,99,235,0.07)",
].join(", ");
const AGENT_BORDER_PULSE_SHADOW = [
  "inset 0 0 0 2px rgba(37,99,235,0.92)",
  "inset 0 0 0 7px rgba(37,99,235,0.44)",
  "inset 0 0 0 15px rgba(37,99,235,0.24)",
  "inset 0 0 0 24px rgba(37,99,235,0.14)",
  "inset 0 0 56px rgba(37,99,235,0.20)",
  "inset 0 0 120px rgba(37,99,235,0.10)",
].join(", ");
const AGENT_BORDER_SETTLE_SHADOW = [
  "inset 0 0 0 2px rgba(37,99,235,0.58)",
  "inset 0 0 0 5px rgba(37,99,235,0.20)",
  "inset 0 0 0 10px rgba(37,99,235,0.11)",
  "inset 0 0 28px rgba(37,99,235,0.08)",
  "inset 0 0 72px rgba(37,99,235,0.04)",
].join(", ");

const AGENT_BORDER_EDGE_GLOW = [
  "linear-gradient(to bottom, rgba(37,99,235,0.18), transparent 86px)",
  "linear-gradient(to right, rgba(37,99,235,0.16), transparent 82px)",
  "linear-gradient(to left, rgba(37,99,235,0.16), transparent 82px)",
].join(", ");

function clearAgentCueTimer() {
  if (agentCueTimer) {
    clearTimeout(agentCueTimer);
    agentCueTimer = null;
  }
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

function ensureAgentBorderStyles() {
  if (document.getElementById(BORDER_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = BORDER_STYLE_ID;
  style.textContent = `
    @keyframes opensidebar-agent-border-breathe {
      0%, 100% {
        box-shadow: ${AGENT_BORDER_ACTIVE_SHADOW};
        opacity: 0.94;
      }
      50% {
        box-shadow: ${AGENT_BORDER_PULSE_SHADOW};
        opacity: 1;
      }
    }

    #${BORDER_ID}[data-state="active"] {
      box-shadow: ${AGENT_BORDER_ACTIVE_SHADOW};
      opacity: 0.96;
      animation: opensidebar-agent-border-breathe 2.6s ease-in-out infinite;
    }

    #${BORDER_ID}[data-state="settle"] {
      box-shadow: ${AGENT_BORDER_SETTLE_SHADOW};
      opacity: 0.92;
      animation: none;
    }

    #${BORDER_ID}::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: ${AGENT_BORDER_EDGE_GLOW};
      background-repeat: no-repeat;
      background-size: 100% 96px, 96px 100%, 96px 100%;
      background-position: top, left, right;
      opacity: 0.78;
    }

    #${BORDER_ID}[data-state="settle"]::before {
      opacity: 0.44;
    }
  `;
  document.documentElement.appendChild(style);
}

function ensureAgentHudStyles() {
  if (document.getElementById(HUD_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = HUD_STYLE_ID;
  style.textContent = `
    @keyframes opensidebar-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.42; }
    }

    #${FLOATING_WRAP_ID} {
      position: fixed;
      bottom: 24px;
      left: 50%;
      z-index: 2147483647;
      width: 320px;
      max-width: calc(100vw - 32px);
      min-height: 40px;
      display: flex;
      align-items: stretch;
      overflow: hidden;
      color-scheme: light dark;
      background: rgba(248, 250, 252, 0.92);
      color: rgba(15, 23, 42, 0.95);
      border: 1px solid rgba(37, 99, 235, 0.28);
      border-radius: 8px;
      box-shadow:
        0 14px 32px rgba(15, 23, 42, 0.16),
        0 0 0 1px rgba(255, 255, 255, 0.72);
      backdrop-filter: blur(14px) saturate(1.12);
      -webkit-backdrop-filter: blur(14px) saturate(1.12);
      opacity: 0;
      transform: translateX(-50%) translateY(8px);
      transition: opacity 180ms ease-out, transform 180ms ease-out;
    }

    #${FLOATING_WRAP_ID}[data-visible="true"] {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }

    #${STEP_LABEL_ID} {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 9px 0 9px 14px;
    }

    #${STEP_LABEL_ID} > span:first-child {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: rgba(37, 99, 235, 0.95);
      flex-shrink: 0;
      animation: opensidebar-pulse 1.5s ease-in-out infinite;
      transition: background 160ms ease-out;
    }

    #${STEP_LABEL_ID} [data-label] {
      min-width: 0;
      color: currentColor;
      font-size: 11px;
      line-height: 16px;
      font-weight: 500;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      letter-spacing: 0;
      transition: color 160ms ease-out;
    }

    #${STEP_LABEL_ID}[data-status="completed"] > span:first-child {
      background: #22c55e;
      animation: none;
    }

    #${STEP_LABEL_ID}[data-status="failed"] > span:first-child {
      background: #ef4444;
      animation: none;
    }

    #${STEP_LABEL_ID}[data-status="stopped"] > span:first-child {
      background: #f59e0b;
      animation: none;
    }

    #${STEP_LABEL_ID}[data-status="completed"] [data-label] {
      color: rgba(21, 128, 61, 0.95);
    }

    #${STEP_LABEL_ID}[data-status="failed"] [data-label] {
      color: rgba(185, 28, 28, 0.95);
    }

    #${STEP_LABEL_ID}[data-status="stopped"] [data-label] {
      color: rgba(180, 83, 9, 0.95);
    }

    #${DIVIDER_ID} {
      width: 1px;
      height: 18px;
      margin: auto 0;
      background: rgba(100, 116, 139, 0.24);
      flex-shrink: 0;
      transition: opacity 160ms ease-out;
    }

    #${STOP_BTN_ID} {
      pointer-events: auto;
      min-height: 40px;
      display: flex;
      align-items: center;
      padding: 9px 16px 9px 12px;
      background: transparent;
      color: currentColor;
      font-size: 11px;
      line-height: 16px;
      font-weight: 600;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      border: 0;
      border-radius: 0;
      cursor: pointer;
      flex-shrink: 0;
      letter-spacing: 0;
      transition: background 140ms ease-out, color 140ms ease-out, opacity 160ms ease-out;
    }

    #${STOP_BTN_ID}:hover {
      background: rgba(37, 99, 235, 0.12);
      color: rgba(30, 64, 175, 1);
    }

    #${STOP_BTN_ID}:focus-visible {
      outline: 2px solid rgba(37, 99, 235, 0.82);
      outline-offset: -3px;
      background: rgba(37, 99, 235, 0.12);
    }

    #${STOP_BTN_ID} svg {
      flex-shrink: 0;
    }

    #${STOP_BTN_ID} rect {
      fill: currentColor;
      opacity: 0.76;
    }

    @media (prefers-color-scheme: dark) {
      #${FLOATING_WRAP_ID} {
        background: rgba(15, 23, 42, 0.92);
        color: rgba(226, 232, 240, 0.95);
        border-color: rgba(96, 165, 250, 0.34);
        box-shadow:
          0 14px 32px rgba(15, 23, 42, 0.28),
          0 0 0 1px rgba(255, 255, 255, 0.08);
      }

      #${STEP_LABEL_ID} > span:first-child {
        background: rgba(96, 165, 250, 0.95);
      }

      #${DIVIDER_ID} {
        background: rgba(148, 163, 184, 0.26);
      }

      #${STEP_LABEL_ID}[data-status="completed"] [data-label] {
        color: rgba(134, 239, 172, 0.95);
      }

      #${STEP_LABEL_ID}[data-status="failed"] [data-label] {
        color: rgba(252, 165, 165, 0.95);
      }

      #${STEP_LABEL_ID}[data-status="stopped"] [data-label] {
        color: rgba(253, 224, 71, 0.95);
      }

      #${STOP_BTN_ID}:hover,
      #${STOP_BTN_ID}:focus-visible {
        background: rgba(37, 99, 235, 0.22);
        color: rgba(255, 255, 255, 0.98);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      #${BORDER_ID},
      #${FLOATING_WRAP_ID},
      #${STEP_LABEL_ID} > span:first-child,
      #${STEP_LABEL_ID} [data-label],
      #${DIVIDER_ID},
      #${STOP_BTN_ID} {
        animation: none !important;
        transition: none !important;
      }
    }
  `;
  document.documentElement.appendChild(style);
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

function ensureE2ERailStyles() {
  if (document.getElementById(E2E_RAIL_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = E2E_RAIL_STYLE_ID;
  style.textContent = `
    #${E2E_RAIL_ID} {
      position: fixed;
      top: 0;
      right: 0;
      z-index: 2147483646;
      width: 360px;
      max-width: min(360px, 42vw);
      height: 100vh;
      pointer-events: auto;
      user-select: text;
      color-scheme: light;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #0f172a;
      background: rgba(255, 255, 255, 0.96);
      border-left: 1px solid rgba(15, 23, 42, 0.12);
      border-radius: 0;
      box-shadow:
        -18px 0 45px rgba(15, 23, 42, 0.16),
        0 0 0 1px rgba(255, 255, 255, 0.82);
      backdrop-filter: blur(16px) saturate(1.08);
      -webkit-backdrop-filter: blur(16px) saturate(1.08);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    #${E2E_RAIL_ID} [data-header] {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid rgba(15, 23, 42, 0.08);
      background: rgba(248, 250, 252, 0.86);
    }

    #${E2E_RAIL_ID} [data-title] {
      font-size: 13px;
      line-height: 18px;
      font-weight: 700;
      letter-spacing: 0;
      text-transform: uppercase;
      color: #334155;
    }

    #${E2E_RAIL_ID} [data-state] {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      line-height: 17px;
      font-weight: 600;
      color: #475569;
    }

    #${E2E_RAIL_ID} [data-dot] {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: #94a3b8;
      box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.16);
    }

    #${E2E_RAIL_ID}[data-active="true"] [data-dot] {
      background: #2563eb;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.16);
    }

    #${E2E_RAIL_ID}[data-outcome="completed"] [data-dot] {
      background: #16a34a;
      box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.16);
    }

    #${E2E_RAIL_ID}[data-outcome="failed"] [data-dot] {
      background: #dc2626;
      box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.16);
    }

    #${E2E_RAIL_ID}[data-outcome="stopped"] [data-dot] {
      background: #d97706;
      box-shadow: 0 0 0 3px rgba(217, 119, 6, 0.16);
    }

    #${E2E_RAIL_ID} [data-body] {
      flex: 1;
      min-height: 0;
      padding: 12px;
      display: grid;
      align-content: start;
      gap: 10px;
      grid-template-rows:
        minmax(70px, auto)
        minmax(72px, auto)
        minmax(120px, 1fr)
        minmax(104px, auto)
        minmax(110px, auto)
        minmax(24px, auto);
      overflow: hidden;
    }

    #${E2E_RAIL_ID} [data-section] {
      display: grid;
      gap: 6px;
      padding: 10px;
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 8px;
      background: rgba(248, 250, 252, 0.72);
      min-height: 0;
      overflow: hidden;
    }

    #${E2E_RAIL_ID} [data-section-title] {
      font-size: 10px;
      line-height: 14px;
      font-weight: 700;
      letter-spacing: 0;
      text-transform: uppercase;
      color: #64748b;
    }

    #${E2E_RAIL_ID} [data-label] {
      font-size: 14px;
      line-height: 20px;
      font-weight: 650;
      color: #0f172a;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      overflow-wrap: anywhere;
    }

    #${E2E_RAIL_ID} [data-detail] {
      font-size: 12px;
      line-height: 17px;
      color: #64748b;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      overflow-wrap: anywhere;
    }

    #${E2E_RAIL_ID} [data-plan-list],
    #${E2E_RAIL_ID} [data-feed-list] {
      display: grid;
      gap: 7px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    #${E2E_RAIL_ID} [data-plan-list] li {
      position: relative;
      padding-left: 14px;
      font-size: 12px;
      line-height: 17px;
      color: #334155;
      display: -webkit-box;
      -webkit-line-clamp: 1;
      -webkit-box-orient: vertical;
      overflow: hidden;
      overflow-wrap: anywhere;
    }

    #${E2E_RAIL_ID} [data-plan-list] li::before {
      content: "";
      position: absolute;
      top: 7px;
      left: 2px;
      width: 5px;
      height: 5px;
      border-radius: 999px;
      background: #2563eb;
    }

    #${E2E_RAIL_ID} [data-feed-list] li {
      display: grid;
      gap: 2px;
      padding: 6px 8px;
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.78);
      border: 1px solid rgba(15, 23, 42, 0.06);
    }

    #${E2E_RAIL_ID} [data-feed-kind] {
      font-size: 10px;
      line-height: 13px;
      font-weight: 700;
      letter-spacing: 0;
      text-transform: uppercase;
      color: #64748b;
    }

    #${E2E_RAIL_ID} [data-feed-text] {
      font-size: 12px;
      line-height: 17px;
      color: #1e293b;
      display: -webkit-box;
      -webkit-line-clamp: 1;
      -webkit-box-orient: vertical;
      overflow: hidden;
      overflow-wrap: anywhere;
    }

    #${E2E_RAIL_ID} [data-final-text] {
      font-size: 12px;
      line-height: 18px;
      color: #0f172a;
      white-space: pre-wrap;
      display: -webkit-box;
      -webkit-line-clamp: 5;
      -webkit-box-orient: vertical;
      overflow: hidden;
      overflow-wrap: anywhere;
    }

    #${E2E_RAIL_ID} [data-timestamp] {
      font-size: 11px;
      line-height: 15px;
      color: #94a3b8;
    }

    #${E2E_RAIL_ID} [data-meta-row] {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 0 2px;
      min-height: 20px;
    }

    @media (max-width: 900px) {
      #${E2E_RAIL_ID} {
        width: 300px;
        max-width: 50vw;
      }
    }
  `;
  document.documentElement.appendChild(style);
}

function isE2EOverlayPanelMounted(): boolean {
  return (
    e2eOverlayMounted || Boolean(document.getElementById(E2E_OVERLAY_HOST_ID))
  );
}

function removeE2ERail() {
  document.getElementById(E2E_RAIL_ID)?.remove();
}

async function renderE2ERail() {
  if (isE2EOverlayPanelMounted()) {
    removeE2ERail();
    return;
  }
  if (!(await isE2ERailEnabled())) return;
  ensureE2ERailStyles();

  let rail = document.getElementById(E2E_RAIL_ID);
  if (!rail) {
    rail = document.createElement("div");
    rail.id = E2E_RAIL_ID;
    rail.innerHTML = `
      <div data-header>
        <div data-title>OpenSidebar E2E</div>
        <div data-state><span data-dot></span><span data-status></span></div>
      </div>
      <div data-body>
        <div data-section>
          <div data-section-title>Prompt</div>
          <div data-detail data-prompt>Waiting for prompt.</div>
        </div>
        <div data-section>
          <div data-section-title>Current Step</div>
          <div data-label></div>
          <div data-detail></div>
        </div>
        <div data-section>
          <div data-section-title>Plan</div>
          <ul data-plan-list></ul>
        </div>
        <div data-section>
          <div data-section-title>Live Feed</div>
          <ul data-feed-list></ul>
        </div>
        <div data-section>
          <div data-section-title>Final Output</div>
          <div data-final-text>Waiting for completion.</div>
        </div>
        <div data-meta-row>
          <div data-section-title>Last Update</div>
          <div data-timestamp></div>
        </div>
      </div>
    `;
    document.documentElement.appendChild(rail);
  }

  rail.dataset.active = String(e2eRailState.active);
  rail.dataset.outcome = e2eRailState.outcome;
  const status = rail.querySelector("[data-status]");
  const label = rail.querySelector("[data-label]");
  const detail = rail.querySelector("[data-detail]");
  const timestamp = rail.querySelector("[data-timestamp]");
  const prompt = rail.querySelector("[data-prompt]");
  const planList = rail.querySelector("[data-plan-list]");
  const feedList = rail.querySelector("[data-feed-list]");
  const finalText = rail.querySelector("[data-final-text]");
  if (status) status.textContent = e2eRailState.status;
  if (label) {
    label.textContent = e2eRailState.detail;
    label.setAttribute("title", e2eRailState.detail);
  }
  if (detail) {
    detail.textContent = e2eRailState.active
      ? "Watch the page. Agent actions happen here."
      : e2eRailState.outcome
        ? `Task ${e2eRailState.outcome}.`
        : "Ready for visible demo.";
  }
  if (timestamp) {
    timestamp.textContent = e2eRailState.updatedAt
      ? new Date(e2eRailState.updatedAt).toLocaleTimeString()
      : "Not started";
  }
  if (prompt) {
    prompt.textContent = e2eRailState.prompt || "Waiting for prompt.";
    prompt.setAttribute("title", e2eRailState.prompt || "");
  }
  if (planList) {
    planList.replaceChildren(
      ...(e2eRailState.planItems.length > 0
        ? e2eRailState.planItems.slice(0, 5)
        : ["Waiting for plan/progress."]
      ).map((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        li.title = item;
        return li;
      }),
    );
  }
  if (feedList) {
    feedList.replaceChildren(
      ...e2eRailState.feed.slice(-3).map((item) => {
        const li = document.createElement("li");
        const kind = document.createElement("div");
        kind.dataset.feedKind = "";
        kind.textContent = item.kind;
        const text = document.createElement("div");
        text.dataset.feedText = "";
        text.textContent = item.text;
        text.title = item.text;
        li.append(kind, text);
        return li;
      }),
    );
  }
  if (finalText) {
    finalText.textContent = e2eRailState.finalText || "Waiting for completion.";
    finalText.setAttribute("title", e2eRailState.finalText || "");
  }
}

function setAgentBorderVisualState(state: AgentBorderVisualState) {
  const existing = document.getElementById(BORDER_ID);
  if (!existing) return;
  existing.setAttribute("data-state", state);
}

function ensureAgentBorderVisible(state: AgentBorderVisualState = "active") {
  const existing = document.getElementById(BORDER_ID);
  if (existing) {
    setAgentBorderVisualState(state);
    return;
  }

  ensureAgentBorderStyles();

  const overlay = document.createElement("div");
  overlay.id = BORDER_ID;
  overlay.setAttribute("data-state", state);
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483646",
    pointerEvents: "none",
    boxShadow:
      state === "active"
        ? AGENT_BORDER_ACTIVE_SHADOW
        : AGENT_BORDER_SETTLE_SHADOW,
    opacity: "0",
  });
  document.documentElement.appendChild(overlay);

  overlay.animate([{ opacity: "0" }, { opacity: "1" }], {
    duration: 600,
    easing: "ease-out",
    fill: "forwards",
  });
}

function hideFloatingCue() {
  const existingBtn = document.getElementById(FLOATING_WRAP_ID);
  if (!existingBtn) return;
  existingBtn.setAttribute("data-visible", "false");
  setTimeout(() => {
    if (existingBtn.isConnected) existingBtn.remove();
  }, 220);
}

function removeFloatingAgentCue() {
  document.getElementById(BORDER_ID)?.remove();
  document.getElementById(FLOATING_WRAP_ID)?.remove();
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
  const existing = document.getElementById(BORDER_ID);
  const existingBtn = document.getElementById(FLOATING_WRAP_ID);

  if (isE2EOverlayPanelMounted()) {
    removeFloatingAgentCue();
    return;
  }

  if (active) {
    // No animation — just a persistent "agent is active" indicator.
    ensureAgentBorderVisible(visualState);

    // --- Floating HUD bar: [ ● Step label…  ⏹ Stop ] ---
    if (!existingBtn) {
      ensureAgentHudStyles();

      // Single-row bar — fixed width so label changes don't shift layout
      const bar = document.createElement("div");
      bar.id = FLOATING_WRAP_ID;
      bar.setAttribute("data-visible", "false");

      // Left section: dot + label (takes remaining space)
      const labelSection = document.createElement("div");
      labelSection.id = STEP_LABEL_ID;

      const dot = document.createElement("span");
      dot.setAttribute("aria-hidden", "true");

      const labelText = document.createElement("span");
      labelText.setAttribute("data-label", "");
      labelText.textContent = "Starting\u2026";

      labelSection.appendChild(dot);
      labelSection.appendChild(labelText);
      bar.appendChild(labelSection);

      // Divider
      const divider = document.createElement("div");
      divider.id = DIVIDER_ID;
      divider.setAttribute("aria-hidden", "true");
      bar.appendChild(divider);

      // Right section: stop button
      const btn = document.createElement("button");
      btn.id = STOP_BTN_ID;
      btn.type = "button";
      btn.title = "Stop agent";
      btn.setAttribute("aria-label", "Stop agent");
      btn.innerHTML =
        '<svg width="9" height="9" viewBox="0 0 10 10" style="flex-shrink:0">' +
        '<rect width="10" height="10" rx="2"/></svg>' +
        '<span style="margin-left:6px;letter-spacing:0">Stop</span>';
      btn.addEventListener("click", () => {
        chrome.runtime
          .sendMessage({
            type: "STOP_AGENT",
            requestId: crypto.randomUUID(),
            source: "content",
            payload: {},
          })
          .catch(() => {});
      });
      bar.appendChild(btn);
      document.documentElement.appendChild(bar);

      // Slide up + fade in
      requestAnimationFrame(() => {
        bar.setAttribute("data-visible", "true");
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
    setTimeout(() => {
      if (existing) {
        existing.animate([{ opacity: "1" }, { opacity: "0" }], {
          duration: 600,
          easing: "ease-in",
          fill: "forwards",
        }).onfinish = () => existing.remove();
      }
      if (existingBtn) {
        hideFloatingCue();
      }
    }, fadeDelay);
  }
}
