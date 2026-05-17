export const AGENT_BORDER_ID = "opensidebar-agent-border";
export const AGENT_BORDER_STYLE_ID = "opensidebar-agent-border-style";

export type AgentBorderVisualState = "active" | "settle";

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

function prefersReducedMotion(doc: Document): boolean {
  return (
    doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)")
      .matches === true
  );
}

export function ensureAgentBorderStyles(doc: Document = document): void {
  if (doc.getElementById(AGENT_BORDER_STYLE_ID)) return;

  const style = doc.createElement("style");
  style.id = AGENT_BORDER_STYLE_ID;
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

    #${AGENT_BORDER_ID}[data-state="active"] {
      box-shadow: ${AGENT_BORDER_ACTIVE_SHADOW};
      opacity: 0.96;
      animation: opensidebar-agent-border-breathe 2.6s ease-in-out infinite;
    }

    #${AGENT_BORDER_ID}[data-state="settle"] {
      box-shadow: ${AGENT_BORDER_SETTLE_SHADOW};
      opacity: 0.92;
      animation: none;
    }

    #${AGENT_BORDER_ID}::before {
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

    #${AGENT_BORDER_ID}[data-state="settle"]::before {
      opacity: 0.44;
    }

    @media (prefers-reduced-motion: reduce) {
      #${AGENT_BORDER_ID}[data-state="active"],
      #${AGENT_BORDER_ID}[data-state="settle"] {
        animation: none !important;
      }
    }
  `;
  doc.documentElement.appendChild(style);
}

export function setAgentBorderVisualState(
  state: AgentBorderVisualState,
  doc: Document = document,
): void {
  const existing = doc.getElementById(AGENT_BORDER_ID);
  if (!existing) return;
  existing.setAttribute("data-state", state);
}

export function ensureAgentBorderVisible(
  state: AgentBorderVisualState = "active",
  doc: Document = document,
): HTMLElement {
  const existing = doc.getElementById(AGENT_BORDER_ID);
  if (existing instanceof HTMLElement) {
    setAgentBorderVisualState(state, doc);
    return existing;
  }

  ensureAgentBorderStyles(doc);

  const overlay = doc.createElement("div");
  overlay.id = AGENT_BORDER_ID;
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
  doc.documentElement.appendChild(overlay);

  if (prefersReducedMotion(doc) || typeof overlay.animate !== "function") {
    overlay.style.opacity = "1";
  } else {
    overlay.animate([{ opacity: "0" }, { opacity: "1" }], {
      duration: 600,
      easing: "ease-out",
      fill: "forwards",
    });
  }
  return overlay;
}

export function removeAgentBorder(doc: Document = document): void {
  doc.getElementById(AGENT_BORDER_ID)?.remove();
}
