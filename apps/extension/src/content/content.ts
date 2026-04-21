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
import { isElementVisible, dismissElement, addDynamicTag, resetStableIds } from "./tagging";

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
        interactive: el.querySelectorAll("a[href],button,input,textarea,select").length,
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
        interactive: el.querySelectorAll("a[href],button,input,textarea,select").length,
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
      logger.info("tools", isBackdropElement(el)
        ? "Hid backdrop overlay"
        : "Hid covering overlay (no close button)", {
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
        agentSessionActive = message.payload.active;
        clearAgentCueTimer();
        if (message.payload.active) {
          ensureAgentBorderVisible("active");
        } else {
          setAgentBorder(false, message.payload.outcome);
        }
        return;
      }

      if (message.type === "AGENT_STEP_LABEL") {
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
          Promise.resolve(res).then(respond).catch((err: any) => {
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

// --- Agent Activity Border Overlay ---

const BORDER_ID = "opensidebar-agent-border";
const BORDER_STYLE_ID = "opensidebar-agent-border-style";
const STOP_BTN_ID = "opensidebar-stop-btn";
const STEP_LABEL_ID = "opensidebar-step-label";
const FLOATING_WRAP_ID = "opensidebar-floating-wrap";
const DIVIDER_ID = "opensidebar-divider";
let agentSessionActive = false;
let agentCueTimer: ReturnType<typeof setTimeout> | null = null;

type AgentBorderVisualState = "active" | "settle";

const AGENT_BORDER_ACTIVE_SHADOW = [
  "inset 0 0 0 2px rgba(90,102,214,0.84)",
  "inset 0 0 0 6px rgba(90,102,214,0.40)",
  "inset 0 0 0 12px rgba(90,102,214,0.22)",
  "inset 0 0 0 20px rgba(90,102,214,0.12)",
  "inset 0 0 40px rgba(90,102,214,0.16)",
  "inset 0 0 84px rgba(90,102,214,0.08)",
].join(", ");
const AGENT_BORDER_PULSE_SHADOW = [
  "inset 0 0 0 2px rgba(90,102,214,0.98)",
  "inset 0 0 0 7px rgba(90,102,214,0.54)",
  "inset 0 0 0 15px rgba(90,102,214,0.30)",
  "inset 0 0 0 24px rgba(90,102,214,0.16)",
  "inset 0 0 56px rgba(90,102,214,0.24)",
  "inset 0 0 120px rgba(90,102,214,0.12)",
].join(", ");
const AGENT_BORDER_SETTLE_SHADOW = [
  "inset 0 0 0 2px rgba(90,102,214,0.64)",
  "inset 0 0 0 5px rgba(90,102,214,0.24)",
  "inset 0 0 0 10px rgba(90,102,214,0.13)",
  "inset 0 0 28px rgba(90,102,214,0.10)",
  "inset 0 0 72px rgba(90,102,214,0.05)",
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
  `;
  document.documentElement.appendChild(style);
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
  existingBtn.style.opacity = "0";
  existingBtn.style.transform = "translateX(-50%) translateY(8px)";
  setTimeout(() => {
    if (existingBtn.isConnected) existingBtn.remove();
  }, 400);
}

/** Update the step label text above the floating stop button */
function updateFloatingStepLabel(label: string, status: "running" | "done" | "error") {
  const el = document.getElementById(STEP_LABEL_ID);
  if (!el) return;
  const dot = el.querySelector("span") as HTMLSpanElement | null;
  const text = el.querySelector("[data-label]") as HTMLSpanElement | null;
  if (text) text.textContent = label;
  if (dot) {
    if (status === "error") {
      dot.style.background = "#ef4444";
      dot.style.animation = "none";
    } else if (status === "done") {
      dot.style.background = "#22c55e";
      dot.style.animation = "none";
    } else {
      dot.style.background = "rgba(90,102,214,0.9)";
      dot.style.animation = "opensidebar-pulse 1.5s ease-in-out infinite";
    }
  }
}

function setAgentBorder(
  active: boolean,
  outcome?: { status: "completed" | "failed" | "stopped"; label?: string },
  visualState: AgentBorderVisualState = "active",
) {
  const existing = document.getElementById(BORDER_ID);
  const existingBtn = document.getElementById(FLOATING_WRAP_ID);

  if (active) {
    // --- Static vignette overlay ---
    // Cool indigo glow at the viewport edge, fading smoothly inward.
    // Layered inset box-shadows with decreasing opacity simulate the gradient.
    // No animation — just a persistent "agent is active" indicator.
    ensureAgentBorderVisible(visualState);

    // --- Floating HUD bar: [ ● Step label…  ⏹ Stop ] ---
    if (!existingBtn) {
      // Inject keyframe for pulsing dot
      if (!document.getElementById("opensidebar-pulse-style")) {
        const style = document.createElement("style");
        style.id = "opensidebar-pulse-style";
        style.textContent =
          "@keyframes opensidebar-pulse{0%,100%{opacity:1}50%{opacity:0.4}}";
        document.documentElement.appendChild(style);
      }

      const FONT =
        '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';

      // Single-row bar — fixed width so label changes don't shift layout
      const bar = document.createElement("div");
      bar.id = FLOATING_WRAP_ID;
      Object.assign(bar.style, {
        position: "fixed",
        bottom: "24px",
        left: "50%",
        transform: "translateX(-50%) translateY(8px)",
        zIndex: "2147483647",
        width: "320px",
        display: "flex",
        alignItems: "center",
        background: "rgba(20,19,40,0.42)",
        backdropFilter: "blur(12px) saturate(1.2)",
        WebkitBackdropFilter: "blur(12px) saturate(1.2)",
        border: "1px solid rgba(90,102,214,0.14)",
        borderRadius: "20px",
        boxShadow: [
          "0 8px 18px rgba(0,0,0,0.14)",
          "0 0 0 1px rgba(90,102,214,0.04)",
        ].join(", "),
        opacity: "0",
        transition: "opacity 0.4s ease-out, transform 0.4s ease-out",
      });

      // Left section: dot + label (takes remaining space)
      const labelSection = document.createElement("div");
      labelSection.id = STEP_LABEL_ID;
      Object.assign(labelSection.style, {
        flex: "1",
        minWidth: "0",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "9px 0 9px 14px",
      });

      const dot = document.createElement("span");
      Object.assign(dot.style, {
        width: "6px",
        height: "6px",
        borderRadius: "50%",
        background: "rgba(90,102,214,0.9)",
        flexShrink: "0",
        animation: "opensidebar-pulse 1.5s ease-in-out infinite",
        transition: "background 0.3s",
      });

      const labelText = document.createElement("span");
      labelText.setAttribute("data-label", "");
      labelText.textContent = "Starting\u2026";
      Object.assign(labelText.style, {
        color: "rgba(210,214,251,0.75)",
        fontSize: "11px",
        fontWeight: "400",
        fontFamily: FONT,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        letterSpacing: "0.02em",
        transition: "color 0.3s",
      });

      labelSection.appendChild(dot);
      labelSection.appendChild(labelText);
      bar.appendChild(labelSection);

      // Divider
      const divider = document.createElement("div");
      divider.id = DIVIDER_ID;
      Object.assign(divider.style, {
        width: "1px",
        height: "16px",
        background: "rgba(90,102,214,0.14)",
        flexShrink: "0",
        transition: "opacity 0.3s",
      });
      bar.appendChild(divider);

      // Right section: stop button
      const btn = document.createElement("button");
      btn.id = STOP_BTN_ID;
      btn.innerHTML =
        '<svg width="9" height="9" viewBox="0 0 10 10" style="flex-shrink:0">' +
        '<rect width="10" height="10" rx="2" fill="rgba(210,214,251,0.6)"/></svg>' +
        '<span style="margin-left:6px;letter-spacing:0.04em">Stop</span>';
      Object.assign(btn.style, {
        pointerEvents: "auto",
        display: "flex",
        alignItems: "center",
        padding: "9px 16px 9px 12px",
        background: "transparent",
        color: "rgba(210,214,251,0.75)",
        fontSize: "11px",
        fontWeight: "500",
        fontFamily: FONT,
        border: "none",
        borderRadius: "0 20px 20px 0",
        cursor: "pointer",
        flexShrink: "0",
        transition: "background 0.2s, color 0.2s, opacity 0.3s",
      });
      btn.addEventListener("mouseenter", () => {
        btn.style.background = "rgba(90,102,214,0.10)";
        btn.style.color = "rgba(210,214,251,0.95)";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.background = "transparent";
        btn.style.color = "rgba(210,214,251,0.75)";
      });
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
        bar.style.opacity = "1";
        bar.style.transform = "translateX(-50%) translateY(0)";
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
        const text = labelEl.querySelector("[data-label]") as HTMLSpanElement | null;
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
          text.style.color =
            outcome.status === "completed"
              ? "rgba(134,239,172,0.9)"
              : outcome.status === "failed"
                ? "rgba(252,165,165,0.9)"
                : "rgba(253,224,71,0.9)";
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
