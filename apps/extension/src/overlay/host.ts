export const OPENSIDEBAR_OVERLAY_HOST_ID = "opensidebar-harness-host";

const OVERLAY_ROOT_ID = "root";
const OVERLAY_PORTAL_ID = "opensidebar-overlay-portal";
const OVERLAY_ACTIVITY_HUD_ID = "opensidebar-overlay-activity-hud";
const TITLEBAR_HEIGHT = 34;
const MIN_VIEWPORT_GUTTER = 16;
const KEYBOARD_MOVE_STEP = 24;
const INITIAL_HEIGHT_VIEWPORT_RATIO = 0.95;
const PREFERRED_OVERLAY_WIDTH = 430;

const OVERLAY_FRAME_CSS = `
:host {
  all: initial;
  color-scheme: light dark;
}

* {
  box-sizing: border-box;
}

.osb-overlay-frame {
  width: 100%;
  height: 100%;
  overflow: hidden;
  border: 1px solid rgba(15, 23, 42, 0.22);
  border-radius: 8px;
  background: #f8fafc;
  box-shadow: 0 18px 60px rgba(15, 23, 42, 0.28);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

:host([data-glass="true"]) .osb-overlay-frame {
  border-color: rgba(15, 23, 42, 0.18);
  background: rgba(248, 250, 252, 0.82);
  box-shadow: 0 18px 56px rgba(15, 23, 42, 0.26);
  backdrop-filter: blur(16px) saturate(1.1);
}

.osb-overlay-titlebar {
  height: ${TITLEBAR_HEIGHT}px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 8px 0 10px;
  background: #0f172a;
  color: #f8fafc;
  cursor: grab;
  user-select: none;
}

.osb-overlay-titlebar:active {
  cursor: grabbing;
}

.osb-overlay-titlebar:focus-visible {
  outline: 2px solid #2dd4bf;
  outline-offset: -2px;
}

.osb-overlay-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0;
}

.osb-overlay-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #14b8a6;
  box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.18);
}

.osb-overlay-controls {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.osb-overlay-button {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #cbd5e1;
  font: 600 15px/1 ui-sans-serif, system-ui, sans-serif;
  cursor: pointer;
}

.osb-overlay-button:hover {
  background: rgba(248, 250, 252, 0.12);
  color: #ffffff;
}

.osb-overlay-body {
  height: calc(100% - ${TITLEBAR_HEIGHT}px);
  overflow: hidden;
}

:host([data-glass="true"]) .osb-overlay-body {
  background: rgba(255, 255, 255, 0.9);
}

#${OVERLAY_ROOT_ID} {
  height: 100%;
}

#${OVERLAY_PORTAL_ID} {
  position: relative;
  z-index: 1;
}

#${OVERLAY_ACTIVITY_HUD_ID} {
  position: fixed;
  left: 50vw;
  bottom: max(18px, env(safe-area-inset-bottom));
  transform: translateX(-50%);
  z-index: 2147483647;
  display: flex;
  justify-content: center;
  width: max-content;
  max-width: calc(100vw - 32px);
  pointer-events: none;
}

:host([data-minimized="true"]) .osb-overlay-body {
  display: none;
}
`;

export interface OpenSidebarOverlayHost {
  host: HTMLElement;
  shadowRoot: ShadowRoot;
  mountElement: HTMLElement;
  portalElement: HTMLElement;
  activityHudElement: HTMLElement;
  themeRoot: HTMLElement;
  dispose(): void;
}

export interface OpenSidebarOverlayHostOptions {
  document?: Document;
  sidepanelCss?: string;
  glass?: boolean;
  onClose?: () => void;
}

function viewportSize(doc: Document): { width: number; height: number } {
  return {
    width: doc.defaultView?.innerWidth ?? 1024,
    height: doc.defaultView?.innerHeight ?? 768,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function numberFromPixels(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function initialOverlayMetrics(doc: Document): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const viewport = viewportSize(doc);
  const availableWidth = viewport.width - MIN_VIEWPORT_GUTTER * 2;
  const availableHeight = viewport.height - MIN_VIEWPORT_GUTTER * 2;
  const width = clamp(
    PREFERRED_OVERLAY_WIDTH,
    Math.min(320, availableWidth),
    availableWidth,
  );
  const height = clamp(
    Math.round(viewport.height * INITIAL_HEIGHT_VIEWPORT_RATIO),
    Math.min(360, availableHeight),
    availableHeight,
  );
  return {
    left: Math.max(MIN_VIEWPORT_GUTTER, viewport.width - width - 16),
    top: clamp(
      Math.round((viewport.height - height) / 2),
      MIN_VIEWPORT_GUTTER,
      Math.max(
        MIN_VIEWPORT_GUTTER,
        viewport.height - height - MIN_VIEWPORT_GUTTER,
      ),
    ),
    width,
    height,
  };
}

function existingOverlayHost(host: HTMLElement): OpenSidebarOverlayHost | null {
  const shadowRoot = host.shadowRoot;
  const mountElement = shadowRoot?.getElementById(OVERLAY_ROOT_ID);
  const portalElement = shadowRoot?.getElementById(OVERLAY_PORTAL_ID);
  const activityHudElement = shadowRoot?.getElementById(
    OVERLAY_ACTIVITY_HUD_ID,
  );
  if (
    !shadowRoot ||
    !(mountElement instanceof HTMLElement) ||
    !(portalElement instanceof HTMLElement) ||
    !(activityHudElement instanceof HTMLElement)
  ) {
    return null;
  }
  return {
    host,
    shadowRoot,
    mountElement,
    portalElement,
    activityHudElement,
    themeRoot: mountElement,
    dispose() {
      host.remove();
    },
  };
}

export function createOpenSidebarOverlayHost(
  options: OpenSidebarOverlayHostOptions = {},
): OpenSidebarOverlayHost {
  const doc = options.document ?? document;
  const existing = doc.getElementById(OPENSIDEBAR_OVERLAY_HOST_ID);
  if (existing instanceof HTMLElement) {
    const overlay = existingOverlayHost(existing);
    if (overlay) return overlay;
    existing.remove();
  }

  const metrics = initialOverlayMetrics(doc);
  const host = doc.createElement("div");
  host.id = OPENSIDEBAR_OVERLAY_HOST_ID;
  host.setAttribute("data-opensidebar-overlay", "true");
  if (options.glass) {
    host.setAttribute("data-glass", "true");
  }
  host.style.cssText = [
    "position: fixed",
    `left: ${metrics.left}px`,
    `top: ${metrics.top}px`,
    `width: ${metrics.width}px`,
    `height: ${metrics.height}px`,
    "z-index: 2147483647",
  ].join("; ");

  const shadowRoot = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = `${OVERLAY_FRAME_CSS}\n${options.sidepanelCss ?? ""}`;

  const frame = doc.createElement("div");
  frame.className = "osb-overlay-frame";
  frame.setAttribute("role", "region");
  frame.setAttribute("aria-label", "OpenSidebar overlay");
  frame.innerHTML = `
    <div class="osb-overlay-titlebar" data-osb-drag-handle tabindex="0" aria-keyshortcuts="W A S D" title="Drag or use W A S D to move">
      <div class="osb-overlay-title">
        <span class="osb-overlay-dot" aria-hidden="true"></span>
        <span>OpenSidebar</span>
      </div>
      <div class="osb-overlay-controls">
        <button class="osb-overlay-button" type="button" data-osb-dock aria-label="Move OpenSidebar overlay to left side" title="Move overlay"> &lt; </button>
        <button class="osb-overlay-button" type="button" data-osb-minimize aria-label="Minimize OpenSidebar overlay">-</button>
        <button class="osb-overlay-button" type="button" data-osb-close aria-label="Close OpenSidebar overlay">x</button>
      </div>
    </div>
    <div class="osb-overlay-body">
      <div id="${OVERLAY_ROOT_ID}"></div>
      <div id="${OVERLAY_PORTAL_ID}" data-osb-overlay-portal></div>
    </div>
    <div id="${OVERLAY_ACTIVITY_HUD_ID}" data-osb-overlay-activity-hud></div>
  `;

  shadowRoot.append(style, frame);
  doc.documentElement.appendChild(host);

  const titlebar = shadowRoot.querySelector("[data-osb-drag-handle]");
  const dockButton = shadowRoot.querySelector("[data-osb-dock]");
  const minimizeButton = shadowRoot.querySelector("[data-osb-minimize]");
  const closeButton = shadowRoot.querySelector("[data-osb-close]");
  const mountElement = shadowRoot.getElementById(OVERLAY_ROOT_ID);
  const portalElement = shadowRoot.getElementById(OVERLAY_PORTAL_ID);
  const activityHudElement = shadowRoot.getElementById(OVERLAY_ACTIVITY_HUD_ID);
  if (
    !(mountElement instanceof HTMLElement) ||
    !(portalElement instanceof HTMLElement) ||
    !(activityHudElement instanceof HTMLElement)
  ) {
    host.remove();
    throw new Error("OpenSidebar overlay mount, portal, or HUD element was not created.");
  }

  host.dataset.dock = "right";

  let dragState: {
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
  } | null = null;

  const moveOverlay = (left: number, top: number) => {
    const width = numberFromPixels(host.style.width, metrics.width);
    const height = numberFromPixels(
      host.dataset.expandedHeight ?? host.style.height,
      metrics.height,
    );
    const viewport = viewportSize(doc);
    host.style.left = `${clamp(
      left,
      MIN_VIEWPORT_GUTTER,
      viewport.width - width - MIN_VIEWPORT_GUTTER,
    )}px`;
    host.style.top = `${clamp(
      top,
      MIN_VIEWPORT_GUTTER,
      viewport.height - height - MIN_VIEWPORT_GUTTER,
    )}px`;
    host.dataset.dock = "custom";
  };

  const onMouseMove = (event: MouseEvent) => {
    if (!dragState) return;
    const nextLeft = dragState.startLeft + event.clientX - dragState.startX;
    const nextTop = dragState.startTop + event.clientY - dragState.startY;
    moveOverlay(nextLeft, nextTop);
  };

  const onMouseUp = () => {
    dragState = null;
    doc.removeEventListener("mousemove", onMouseMove);
    doc.removeEventListener("mouseup", onMouseUp);
  };

  const onMouseDown = (event: Event) => {
    const mouseEvent = event as MouseEvent;
    if (
      mouseEvent.target instanceof Element &&
      mouseEvent.target.closest("button")
    ) {
      return;
    }
    dragState = {
      startX: mouseEvent.clientX,
      startY: mouseEvent.clientY,
      startLeft: numberFromPixels(host.style.left, metrics.left),
      startTop: numberFromPixels(host.style.top, metrics.top),
    };
    if (titlebar instanceof HTMLElement) titlebar.focus({ preventScroll: true });
    doc.addEventListener("mousemove", onMouseMove);
    doc.addEventListener("mouseup", onMouseUp);
    mouseEvent.preventDefault();
  };

  const onKeyDown = (event: Event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.altKey || keyboardEvent.ctrlKey || keyboardEvent.metaKey) return;
    if (
      keyboardEvent.target instanceof Element &&
      keyboardEvent.target.closest("button, input, textarea, select, [contenteditable='true']")
    ) {
      return;
    }
    const direction = keyboardEvent.key.toLowerCase();
    const delta = KEYBOARD_MOVE_STEP * (keyboardEvent.shiftKey ? 3 : 1);
    const offsets: Record<string, [number, number]> = {
      w: [0, -delta],
      a: [-delta, 0],
      s: [0, delta],
      d: [delta, 0],
    };
    const offset = offsets[direction];
    if (!offset) return;
    moveOverlay(
      numberFromPixels(host.style.left, metrics.left) + offset[0],
      numberFromPixels(host.style.top, metrics.top) + offset[1],
    );
    keyboardEvent.preventDefault();
    keyboardEvent.stopPropagation();
  };

  const onMinimize = () => {
    const minimized = host.getAttribute("data-minimized") === "true";
    if (minimized) {
      host.removeAttribute("data-minimized");
      host.style.height = host.dataset.expandedHeight ?? `${metrics.height}px`;
      return;
    }
    host.dataset.expandedHeight = host.style.height || `${metrics.height}px`;
    host.setAttribute("data-minimized", "true");
    host.style.height = `${TITLEBAR_HEIGHT}px`;
  };

  const dockOverlay = (side: "left" | "right") => {
    const viewport = viewportSize(doc);
    const width = numberFromPixels(host.style.width, metrics.width);
    const height = numberFromPixels(
      host.dataset.expandedHeight ?? host.style.height,
      metrics.height,
    );
    host.style.left =
      side === "left"
        ? `${MIN_VIEWPORT_GUTTER}px`
        : `${viewport.width - width - MIN_VIEWPORT_GUTTER}px`;
    host.style.top = `${clamp(
      numberFromPixels(host.style.top, metrics.top),
      MIN_VIEWPORT_GUTTER,
      viewport.height - height - MIN_VIEWPORT_GUTTER,
    )}px`;
    host.dataset.dock = side;
    if (dockButton instanceof HTMLButtonElement) {
      dockButton.textContent = side === "right" ? "<" : ">";
      dockButton.setAttribute(
        "aria-label",
        side === "right"
          ? "Move OpenSidebar overlay to left side"
          : "Move OpenSidebar overlay to right side",
      );
    }
  };

  const onDock = () => {
    const viewport = viewportSize(doc);
    const currentLeft = numberFromPixels(host.style.left, metrics.left);
    const currentSide =
      host.dataset.dock === "left" || host.dataset.dock === "right"
        ? host.dataset.dock
        : currentLeft < viewport.width / 2
          ? "left"
          : "right";
    dockOverlay(currentSide === "right" ? "left" : "right");
  };

  const dispose = () => {
    doc.removeEventListener("mousemove", onMouseMove);
    doc.removeEventListener("mouseup", onMouseUp);
    host.remove();
    options.onClose?.();
  };

  titlebar?.addEventListener("mousedown", onMouseDown);
  titlebar?.addEventListener("keydown", onKeyDown);
  dockButton?.addEventListener("click", onDock);
  minimizeButton?.addEventListener("click", onMinimize);
  closeButton?.addEventListener("click", dispose);

  return {
    host,
    shadowRoot,
    mountElement,
    portalElement,
    activityHudElement,
    themeRoot: mountElement,
    dispose,
  };
}
