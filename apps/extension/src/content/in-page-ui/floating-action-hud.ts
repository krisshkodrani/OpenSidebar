import { AGENT_BORDER_ID } from "./agent-border";

export const HUD_STYLE_ID = "opensidebar-agent-hud-style";
export const STOP_BTN_ID = "opensidebar-stop-btn";
export const STEP_LABEL_ID = "opensidebar-step-label";
export const FLOATING_WRAP_ID = "opensidebar-floating-wrap";
export const DIVIDER_ID = "opensidebar-divider";

export function resetFloatingActionHudForActiveRun(
  doc: Document = document,
): void {
  const existingBtn = doc.getElementById(FLOATING_WRAP_ID);
  if (!existingBtn) return;
  existingBtn.setAttribute("data-visible", "true");

  const stopBtn = doc.getElementById(STOP_BTN_ID);
  const divider = doc.getElementById(DIVIDER_ID);
  const labelEl = doc.getElementById(STEP_LABEL_ID);
  const labelText = labelEl?.querySelector(
    "[data-label]",
  ) as HTMLSpanElement | null;
  const dot = labelEl?.querySelector("span") as HTMLSpanElement | null;
  if (stopBtn) {
    stopBtn.style.opacity = "";
    stopBtn.style.pointerEvents = "";
  }
  if (divider) divider.style.opacity = "";
  if (labelEl) {
    labelEl.removeAttribute("data-status");
    if (labelText) labelText.textContent = "Starting\u2026";
    if (dot) {
      dot.style.background = "rgba(37,99,235,0.95)";
      dot.style.animation = "opensidebar-pulse 1.5s ease-in-out infinite";
    }
  }
}

export function createFloatingActionHud(
  onStop: () => void,
  doc: Document = document,
): HTMLElement {
  ensureAgentHudStyles(doc);

  const bar = doc.createElement("div");
  bar.id = FLOATING_WRAP_ID;
  bar.setAttribute("data-visible", "false");

  const labelSection = doc.createElement("div");
  labelSection.id = STEP_LABEL_ID;

  const dot = doc.createElement("span");
  dot.setAttribute("aria-hidden", "true");

  const labelText = doc.createElement("span");
  labelText.setAttribute("data-label", "");
  labelText.textContent = "Starting\u2026";

  labelSection.appendChild(dot);
  labelSection.appendChild(labelText);
  bar.appendChild(labelSection);

  const divider = doc.createElement("div");
  divider.id = DIVIDER_ID;
  divider.setAttribute("aria-hidden", "true");
  bar.appendChild(divider);

  const btn = doc.createElement("button");
  btn.id = STOP_BTN_ID;
  btn.type = "button";
  btn.title = "Stop agent";
  btn.setAttribute("aria-label", "Stop agent");
  btn.innerHTML =
    '<svg width="9" height="9" viewBox="0 0 10 10" style="flex-shrink:0">' +
    '<rect width="10" height="10" rx="2"/></svg>' +
    '<span style="margin-left:6px;letter-spacing:0">Stop</span>';
  btn.addEventListener("click", onStop);
  bar.appendChild(btn);
  doc.documentElement.appendChild(bar);

  requestAnimationFrame(() => {
    bar.setAttribute("data-visible", "true");
  });
  return bar;
}

export function ensureAgentHudStyles(doc: Document = document): void {
  if (doc.getElementById(HUD_STYLE_ID)) return;

  const style = doc.createElement("style");
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
      #${AGENT_BORDER_ID},
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
  doc.documentElement.appendChild(style);
}
