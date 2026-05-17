export const RECORDING_HUD_ID = "opensidebar-recording-hud";
export const RECORDING_BORDER_ID = "opensidebar-recording-border";
export const RECORDING_STYLE_ID = "opensidebar-recording-style";
export const RECORDING_FEEDBACK_CLASS = "opensidebar-recording-feedback";

const RECORDING_BORDER_EDGE_GLOW = [
  "linear-gradient(to bottom, rgba(220,38,38,0.16), rgba(245,158,11,0.10) 42px, transparent 92px)",
  "linear-gradient(to right, rgba(220,38,38,0.14), rgba(245,158,11,0.08) 42px, transparent 86px)",
  "linear-gradient(to left, rgba(220,38,38,0.14), rgba(245,158,11,0.08) 42px, transparent 86px)",
].join(", ");

export function isRecordingOverlayElement(el: Element): boolean {
  return Boolean(el.closest(`#${RECORDING_HUD_ID}, #${RECORDING_BORDER_ID}`));
}

export function removeSkillRecordingOverlay(doc: Document = document): void {
  doc.getElementById(RECORDING_HUD_ID)?.remove();
  doc.getElementById(RECORDING_BORDER_ID)?.remove();
  doc
    .querySelectorAll(`.${RECORDING_FEEDBACK_CLASS}`)
    .forEach((node) => node.remove());
}

export function pulseSkillRecordingElement(
  el: HTMLElement,
  mode: "click" | "field",
  doc: Document = document,
): void {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const pulse = doc.createElement("div");
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
  doc.documentElement.appendChild(pulse);
  setTimeout(() => pulse.remove(), 760);
}

export function renderSkillRecordingOverlay(
  handlers: {
    onStop: () => void;
    onCancel: () => void;
  },
  doc: Document = document,
): void {
  if (!doc.getElementById(RECORDING_BORDER_ID)) {
    const border = doc.createElement("div");
    border.id = RECORDING_BORDER_ID;
    doc.documentElement.appendChild(border);
  }

  if (doc.getElementById(RECORDING_HUD_ID)) return;
  const hud = doc.createElement("div");
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
  hud.querySelector("[data-stop]")?.addEventListener("click", handlers.onStop);
  hud
    .querySelector("[data-cancel]")
    ?.addEventListener("click", handlers.onCancel);
  doc.documentElement.appendChild(hud);
}

export function ensureSkillRecordingStyles(doc: Document = document): void {
  if (doc.getElementById(RECORDING_STYLE_ID)) return;
  const style = doc.createElement("style");
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

    @media (prefers-reduced-motion: reduce) {
      #${RECORDING_HUD_ID} [data-dot],
      .${RECORDING_FEEDBACK_CLASS} {
        animation: none !important;
        transition: none !important;
      }
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
  doc.documentElement.appendChild(style);
}
