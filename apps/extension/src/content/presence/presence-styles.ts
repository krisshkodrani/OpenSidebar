/**
 * LP-24 presence layer — design tokens and shadow-root stylesheet.
 *
 * All visuals are inline SVG + compositor-only CSS (translate3d/scale/
 * opacity). The accent reuses the agent-border blue so the presence layer
 * and the existing HUD read as one system (RFC §5).
 */

export const PRESENCE_ACCENT = "rgba(37, 99, 235, 0.95)";
export const PRESENCE_ERROR = "rgba(220, 38, 38, 0.9)";

/** Cursor glyph SVG (arrow) — deliberately NOT an OS cursor clone: larger,
 *  brand-blue fill with a white outline so it reads as "the agent's hand"
 *  on both light and dark pages (owner direction, 2026-07-24). */
export const CURSOR_ARROW_SVG = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 2.5 L4 18.5 L8.2 14.8 L11 21 L13.8 19.8 L11 13.7 L16.8 13.2 Z" fill="#2563eb" stroke="white" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

// Owner direction 2026-07-24: the cursor keeps ONE form — no I-beam or
// per-control glyph morphing. The focus halo alone marks text-entry targets.

export const PRESENCE_STYLE_TEXT = `
:host {
  all: initial;
}
#layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483647;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
#cursor {
  position: absolute;
  left: 0;
  top: 0;
  will-change: transform;
  filter: drop-shadow(0 2px 4px rgba(15, 23, 42, 0.45))
    drop-shadow(0 0 6px rgba(37, 99, 235, 0.35));
  transition: opacity 300ms ease;
  opacity: 0;
}
#cursor.visible { opacity: 1; }
#cursor.soft-in { animation: presence-soft-in 150ms ease; }
#cursor.pressing { transform-origin: 4px 3px; }
#cursor .glyph { display: block; }
#cursor.shake { animation: presence-shake 240ms ease-in-out 2; }

.ripple {
  position: absolute;
  width: 14px;
  height: 14px;
  margin: -7px 0 0 -7px;
  border-radius: 50%;
  border: 2px solid ${PRESENCE_ACCENT};
  opacity: 0.9;
  animation: presence-ripple 250ms ease-out forwards;
}
.ripple.error { border-color: ${PRESENCE_ERROR}; }
.ripple.square { border-radius: 4px; }

.halo {
  position: absolute;
  border-radius: 8px;
  /* A soft aura, deliberately NOT a border: the page draws its own focus
   * ring on the real focus, and a second rectangle reads as a double
   * highlight (owner report, 2026-07-24). */
  box-shadow:
    0 0 0 3px rgba(37, 99, 235, 0.28),
    0 0 14px 5px rgba(37, 99, 235, 0.18);
  opacity: 0;
  transition: opacity 180ms ease;
}
.halo.visible { opacity: 1; }

.chip {
  position: absolute;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.88);
  color: #fff;
  font-size: 12px;
  line-height: 16px;
  white-space: nowrap;
  animation: presence-chip 800ms ease forwards;
}
.chip.key {
  font-family: ui-monospace, monospace;
  animation-duration: 500ms;
}

.scroll-glyph {
  position: absolute;
  color: ${PRESENCE_ACCENT};
  font-size: 14px;
  font-weight: 700;
  animation: presence-chip 600ms ease forwards;
}

.drag-ghost {
  position: absolute;
  border: 1.5px dashed ${PRESENCE_ACCENT};
  border-radius: 4px;
  background: rgba(37, 99, 235, 0.08);
  opacity: 0.6;
  will-change: transform;
}

@keyframes presence-ripple {
  from { transform: scale(0.5); opacity: 0.9; }
  to { transform: scale(2.6); opacity: 0; }
}
@keyframes presence-chip {
  0% { opacity: 0; transform: translateY(4px); }
  12% { opacity: 1; transform: translateY(0); }
  80% { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes presence-soft-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes presence-shake {
  0%, 100% { margin-left: 0; }
  25% { margin-left: -3px; }
  75% { margin-left: 3px; }
}
@media (prefers-reduced-motion: reduce) {
  .ripple { animation-duration: 150ms; }
  #cursor.shake { animation: none; }
}
`;
