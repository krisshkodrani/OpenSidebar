/**
 * Overlay detection and dismissal (extracted from content.ts — decomposition
 * ratchet, 2026-07-23 tools audit).
 *
 * Owns the nuisance-overlay pipeline: viewport-cover detection, the
 * app-content guard, close-button search, and `autoDismissModals` — which
 * clicks real close buttons where it finds them (framework state updates,
 * overlay stays closed) and falls back to CSS-hiding only when no close
 * control exists, reporting which path each dismissal took.
 */

import { logger } from "../utils";
import { OverlayDescriptor, ElementRect } from "../types";
import {
  isElementVisible,
  dismissElement,
  addDynamicTag,
  isOwnElement,
} from "./tagging";
import { AGENT_BORDER_ID } from "./in-page-ui/agent-border";

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

export interface DismissResult {
  dismissed: number;
  /** Dismissals that clicked a real close button (framework state updates). */
  clickedClose: number;
  /** Dismissals that only CSS-hid the element (may reappear on re-render). */
  cssHidden: number;
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
export function autoDismissModals(): DismissResult {
  let dismissed = 0;
  let clickedClose = 0;
  let cssHidden = 0;
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
      clickedClose++;
      logger.info("tools", "Clicked close button on overlay", {
        tag: el.tagName,
        classes: el.className.toString().slice(0, 50),
      });
    } else {
      dismissElement(el);
      dismissed++;
      cssHidden++;
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
      clickedClose++;
      logger.info("tools", "Clicked close on covering overlay", {
        coverage: Math.round(coverage),
        tag: el.tagName,
        backdrop: isBackdropElement(el),
      });
    } else {
      dismissElement(el);
      dismissed++;
      cssHidden++;
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

  // Phase D: Re-scan for remaining overlays. Apply the same app-content guard
  // as Phases A/B: without it, a fixed nav/header covering >15% of the
  // viewport gets reported as a "surviving overlay" and the warning actively
  // misdirects the agent into hiding page chrome (seen live 2026-07-23: the
  // agent hid a <nav> and kept overlay-hunting instead of doing the task).
  const remaining = detectViewportCoveringOverlays().filter(
    ({ el }) => isBackdropElement(el) || !isLikelyAppContent(el),
  );
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
      clickedClose,
      cssHidden,
      remainingOverlay: {
        html: top.el.outerHTML.slice(0, 3000),
        tagId,
        rect,
        coveragePercent: Math.round(top.coverage),
      },
      capturedTexts,
    };
  }

  return { dismissed, clickedClose, cssHidden, remainingOverlay: null, capturedTexts };
}
