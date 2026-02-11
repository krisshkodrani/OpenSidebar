import { logger } from "../utils";
import { RuntimeMessage, MessageSource } from "../types";
import { buildSnapshot } from "./snapshot";
import { executeAction } from "./actions";
import { isElementVisible } from "./tagging";

logger.info("system", "Content Script Loaded");

function runJanitor() {
    const COMMON_selectors = [
        "button[aria-label='Accept all']",
        "button[aria-label='Reject all']",
        ".cookie-banner button.primary",
        "#onetrust-accept-btn-handler", // OneTrust
        ".fc-cta-consent" // Google Funding Choices
    ];

    for (const sel of COMMON_selectors) {
        const el = document.querySelector(sel);
        if (el && isElementVisible(el)) {
            (el as HTMLElement).click();
            logger.info("tools", "Auto-clicked cookie banner", { selector: sel });
        }
    }
}

// Prepare Janitor
if (document.readyState === "complete") {
    runJanitor();
} else {
    window.addEventListener("load", runJanitor);
}

/**
 * Auto-dismiss modals, overlays, banners, and popups by hiding them.
 * Uses display:none instead of clicking dismiss buttons (adversarial sites trap clicks).
 * Returns the number of elements dismissed.
 */
function autoDismissModals(): number {
    let dismissed = 0;
    const containers = document.querySelectorAll(
        "[role='dialog'], [role='alertdialog'], .modal, .overlay, .popup, .banner, .cookie, .consent"
    );

    for (const el of containers) {
        if (!(el instanceof HTMLElement) || !isElementVisible(el)) continue;

        const style = window.getComputedStyle(el);
        const isOverlay =
            style.position === "fixed" ||
            style.position === "sticky" ||
            parseInt(style.zIndex, 10) > 100;

        if (isOverlay) {
            el.style.display = "none";
            dismissed++;
            logger.info("tools", "Auto-hid overlay", { tag: el.tagName, classes: el.className.toString().slice(0, 50) });
        }
    }

    return dismissed;
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    if (message.type === "AGENT_ACTIVITY") {
        setAgentBorder(message.payload.active);
        return;
    }

    if (message.type === "DISMISS_MODALS") {
        const dismissed = autoDismissModals();
        sendResponse({
            type: "DISMISS_MODALS_RESPONSE",
            requestId: message.requestId,
            source: MessageSource.CONTENT,
            payload: { dismissed },
        });
        return true;
    }

    if (message.type === "DOM_SNAPSHOT_REQUEST") {
        const start = performance.now();
        const snapshot = buildSnapshot(
            message.payload.includeText,
            message.payload.refresh,
            message.payload.showTags ?? false
        );
        sendResponse({
            type: "DOM_SNAPSHOT_RESPONSE",
            requestId: message.requestId,
            source: MessageSource.CONTENT,
            payload: {
                snapshot,
                durationMs: Math.round(performance.now() - start),
            },
        });
        return true; // async response
    }

    if (message.type === "TOOL_EXECUTE") {
        const { toolName, args, toolCallId } = message.payload;
        const result = executeAction(toolName, args);
        Promise.resolve(result).then(res => {
            sendResponse({
                type: "TOOL_RESULT",
                requestId: message.requestId,
                source: MessageSource.CONTENT,
                payload: { toolCallId, ...res },
            });
        });
        return true; // async response
    }
});

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
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
