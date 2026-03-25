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

import { logger } from "../utils";
import {
  RuntimeMessage,
  MessageSource,
  OverlayDescriptor,
  ElementRect,
} from "../types";
import { buildSnapshot } from "./snapshot";
import { executeAction } from "./actions";
import { isElementVisible, addDynamicTag, resetStableIds } from "./tagging";
import {
  startRecording,
  stopRecording,
  startGoldenRecording,
  stopGoldenRecording,
} from "./recorder";

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
    // Generic aria-labels
    "button[aria-label='Accept all']",
    "button[aria-label='Reject all']",
    "button[aria-label='Accept cookies']",
    "button[aria-label='Accept All Cookies']",
    "button[aria-label='Close']",
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
      el.style.display = "none";
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

    // Archive text BEFORE dismissing (skip pure backdrops — no useful text)
    if (!isBackdropElement(el)) {
      archiveOverlay(el);
    }

    if (isBackdropElement(el)) {
      // Backdrop/scrim: just hide it
      el.style.display = "none";
      dismissed++;
      logger.info("tools", "Hid backdrop overlay", {
        coverage: Math.round(coverage),
        tag: el.tagName,
      });
      continue;
    }

    const closeBtn = findCloseButton(el);
    if (closeBtn) {
      closeBtn.click();
      dismissed++;
      logger.info("tools", "Clicked close on covering overlay", {
        coverage: Math.round(coverage),
        tag: el.tagName,
      });
    } else {
      el.style.display = "none";
      dismissed++;
      logger.info("tools", "Hid covering overlay (no close button)", {
        coverage: Math.round(coverage),
        tag: el.tagName,
      });
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
      // Only accept messages from our own background service worker
      if (message.source !== MessageSource.BACKGROUND) return;

      if (message.type === "AGENT_ACTIVITY") {
        setAgentBorder(message.payload.active);
        return;
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
        window.scrollTo({ top: message.payload.y, behavior: "instant" as ScrollBehavior });
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

        // Track in-flight network requests (fetch + XHR)
        let inFlightRequests = 0;
        const origFetch = window.fetch;
        const patchedFetch: typeof fetch = function (...args) {
          inFlightRequests++;
          return origFetch.apply(window, args).finally(() => { inFlightRequests--; });
        };
        window.fetch = patchedFetch;

        const origXhrOpen = XMLHttpRequest.prototype.open;
        const origXhrSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (...args: any) {
          return origXhrOpen.apply(this, args);
        };
        XMLHttpRequest.prototype.send = function (...args: any) {
          inFlightRequests++;
          this.addEventListener("loadend", () => { inFlightRequests--; }, { once: true });
          return origXhrSend.apply(this, args);
        };

        const restoreNetwork = () => {
          window.fetch = origFetch;
          XMLHttpRequest.prototype.open = origXhrOpen;
          XMLHttpRequest.prototype.send = origXhrSend;
        };

        // Watch for DOM mutations + network idle, respond after 2 idle frames with 0 in-flight
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

        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            observer.disconnect();
            restoreNetwork();
            respond();
          }
        }, cap);

        const checkIdle = () => {
          if (settled) return;
          // Reset idle count if network requests are still in flight
          if (inFlightRequests > 0) {
            idleFrames = 0;
            requestAnimationFrame(checkIdle);
            return;
          }
          idleFrames++;
          if (idleFrames >= 2) {
            // 2 consecutive animation frames with no mutations AND no in-flight requests
            const elCount = document.querySelectorAll(
              "a, button, input, select, textarea, [role='button'], [role='link'], [role='textbox'], [tabindex]",
            ).length;
            if (!waitForElements || elCount > 0) {
              settled = true;
              observer.disconnect();
              restoreNetwork();
              clearTimeout(timer);
              respond();
              return;
            }
          }
          requestAnimationFrame(checkIdle);
        };
        requestAnimationFrame(checkIdle);
        return true; // async response
      }

      // DEMO messages are forwarded from sidepanel via background, arriving with
      // source=BACKGROUND at runtime but typed as SIDEPANEL in the union.
      if ((message as any).type === "DEMO_RECORD_START") {
        if ((message as any).payload?.golden) {
          startGoldenRecording();
        } else {
          startRecording();
        }
        sendResponse({ ok: true });
        return true;
      }

      if ((message as any).type === "DEMO_RECORD_STOP") {
        // Check if we were in golden mode (payload.golden forwarded from background)
        const actions = (message as any).payload?.golden
          ? stopGoldenRecording()
          : stopRecording();
        sendResponse({ ok: true, actions });
        return true;
      }

      if (message.type === "DOM_SNAPSHOT_REQUEST") {
        (async () => {
          const start = performance.now();

          // Auto-dismiss overlays that block the viewport (synchronous — no sleep needed)
          let dismissedTexts: string[] = [];
          const overlays = detectViewportCoveringOverlays();
          if (overlays.length > 0) {
            const result = autoDismissModals();
            dismissedTexts = result.capturedTexts;
          }

          const snapshot = buildSnapshot(
            message.payload.refresh,
          );

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
        const result = executeAction(toolName, args);
        Promise.resolve(result).then((res) => {
          sendResponse({
            type: "TOOL_RESULT",
            requestId: message.requestId,
            source: MessageSource.CONTENT,
            payload: { toolCallId, ...res },
          });
        });
        return true; // async response
      }
    },
  );
}

// --- Agent Activity Border Overlay ---

const BORDER_ID = "opensidebar-agent-border";
let borderAnimation: Animation | null = null;

function setAgentBorder(active: boolean) {
  const existing = document.getElementById(BORDER_ID);

  if (active) {
    if (existing) return; // Already showing

    const overlay = document.createElement("div");
    overlay.id = BORDER_ID;
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483646",
      pointerEvents: "none",
      border: "3px dashed #f59e0b",
      borderRadius: "4px",
      opacity: "1",
    });
    document.documentElement.appendChild(overlay);

    // Subtle pulsing glow unless user prefers reduced motion
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (!reducedMotion) {
      borderAnimation = overlay.animate(
        [
          { boxShadow: "inset 0 0 8px rgba(245,158,11,0.3)" },
          { boxShadow: "inset 0 0 16px rgba(245,158,11,0.15)" },
          { boxShadow: "inset 0 0 8px rgba(245,158,11,0.3)" },
        ],
        { duration: 2000, iterations: Infinity },
      );
    }
  } else {
    if (!existing) return;

    if (borderAnimation) {
      borderAnimation.cancel();
      borderAnimation = null;
    }

    // Fade out then remove
    existing.animate([{ opacity: "1" }, { opacity: "0" }], {
      duration: 300,
      fill: "forwards",
    }).onfinish = () => existing.remove();
  }
}
