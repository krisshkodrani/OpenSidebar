/**
 * Recorder — captures user interactions as structured DemoAction sequences.
 *
 * Activated via DEMO_RECORD_START, deactivated via DEMO_RECORD_STOP.
 * Each captured action is sent to the background as DEMO_ACTION_CAPTURED.
 *
 * Golden mode: When activated via startGoldenRecording(), each action also
 * captures a DOM snapshot and resolves the interacted element's tag ID,
 * emitting GOLDEN_ACTION messages for eval pipeline integration.
 */

import { DemoAction, ElementDescriptor, MessageSource } from "../types";
import { tagElements, addDynamicTag } from "./tagging";
import { buildSnapshot } from "./snapshot";

/** Attributes worth capturing for element identification */
const DESCRIPTOR_ATTRS = [
  "id",
  "name",
  "type",
  "placeholder",
  "aria-label",
  "href",
  "role",
  "value",
];

/** Sensitive autocomplete tokens — strip these attributes entirely */
const SENSITIVE_AUTOCOMPLETE = /cc-|card|cvv|cvc|expir/i;

let recording = false;
let goldenMode = false;
let capturedActions: DemoAction[] = [];
let typeBuffer: {
  el: Element;
  value: string;
  timer: ReturnType<typeof setTimeout> | null;
} | null = null;

// --- Element Descriptor ---

function buildDomPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.documentElement) {
    let segment = current.tagName.toLowerCase();
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (c) => c.tagName === current!.tagName,
      );
      if (siblings.length > 1) {
        const idx = siblings.indexOf(current) + 1;
        segment += `:nth-of-type(${idx})`;
      }
    }
    parts.unshift(segment);
    current = parent;
  }
  return parts.join(">");
}

function buildSelector(el: Element): string {
  // Priority: #id > [name] > [aria-label] > domPath
  const id = el.getAttribute("id");
  if (id && !id.match(/^[a-f0-9-]{20,}$/i)) {
    return `#${CSS.escape(id)}`;
  }
  const name = el.getAttribute("name");
  if (name) {
    return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
  }
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) {
    return `[aria-label="${CSS.escape(ariaLabel)}"]`;
  }
  return buildDomPath(el);
}

function getVisibleText(el: Element): string {
  const text = (el as HTMLElement).innerText || el.textContent || "";
  return text.trim().slice(0, 80);
}

function buildElementDescriptor(el: Element): ElementDescriptor {
  const attrs: Record<string, string> = {};
  for (const name of DESCRIPTOR_ATTRS) {
    const val = el.getAttribute(name);
    if (!val) continue;
    // Strip sensitive autocomplete values
    if (name === "autocomplete" && SENSITIVE_AUTOCOMPLETE.test(val)) continue;
    attrs[name] = val.slice(0, 100);
  }

  return {
    tagName: el.tagName.toLowerCase(),
    text: getVisibleText(el),
    role: el.getAttribute("role") || undefined,
    attributes: attrs,
    domPath: buildDomPath(el),
    selector: buildSelector(el),
  };
}

// --- Golden Mode: Tag ID Resolution ---

/**
 * Walk up from event target checking data-os-tag attribute.
 * If nothing found, dynamically tag the element.
 */
function resolveTagId(target: Element): number | null {
  let current: Element | null = target;
  while (current) {
    const tagAttr = current.getAttribute("data-os-tag");
    if (tagAttr) return parseInt(tagAttr, 10);
    current = current.parentElement;
  }
  // Element has no tag — assign one dynamically
  return addDynamicTag(target);
}

// --- Action Emitters ---

function emitAction(action: DemoAction, targetEl?: Element): void {
  capturedActions.push(action);

  if (goldenMode) {
    // Golden mode: emit enriched GOLDEN_ACTION with snapshot + tag ID
    const tagId = targetEl ? resolveTagId(targetEl) : null;
    const snapshot = buildSnapshot(true, true, false);

    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime
        .sendMessage({
          type: "GOLDEN_ACTION",
          requestId: crypto.randomUUID(),
          source: MessageSource.CONTENT,
          payload: {
            goldenAction: { action, tagId, snapshot },
          },
        })
        .catch(() => {});
    }

    // Re-tag after DOM changes from the action
    requestAnimationFrame(() => tagElements(false));
  } else {
    // Normal mode: emit simple DEMO_ACTION_CAPTURED
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime
        .sendMessage({
          type: "DEMO_ACTION_CAPTURED",
          requestId: crypto.randomUUID(),
          source: MessageSource.CONTENT,
          payload: { action },
        })
        .catch(() => {});
    }
  }
}

function flushTypeBuffer(): void {
  if (!typeBuffer) return;
  if (typeBuffer.timer) clearTimeout(typeBuffer.timer);
  if (typeBuffer.value) {
    const isPassword =
      typeBuffer.el instanceof HTMLInputElement &&
      typeBuffer.el.type === "password";
    emitAction(
      {
        type: "type",
        timestamp: Date.now(),
        url: window.location.href,
        element: buildElementDescriptor(typeBuffer.el),
        value: isPassword ? "[password]" : typeBuffer.value,
      },
      typeBuffer.el,
    );
  }
  typeBuffer = null;
}

// --- Event Handlers ---

function handleClick(e: MouseEvent): void {
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }

  const target = e.target as Element;
  if (!target) return;
  // Don't capture clicks on our own extension UI
  if (target.closest("[data-opensidebar]")) return;

  flushTypeBuffer();

  emitAction(
    {
      type: "click",
      timestamp: Date.now(),
      url: window.location.href,
      element: buildElementDescriptor(target),
    },
    target,
  );
}

function handleInput(e: Event): void {
  const target = e.target as HTMLInputElement | HTMLTextAreaElement;
  if (!target) return;
  if (target.closest("[data-opensidebar]")) return;

  const value = target.value ?? "";

  if (typeBuffer && typeBuffer.el === target) {
    // Same element — update buffer
    typeBuffer.value = value;
    if (typeBuffer.timer) clearTimeout(typeBuffer.timer);
    typeBuffer.timer = setTimeout(flushTypeBuffer, 500);
  } else {
    // New element — flush old, start new buffer
    flushTypeBuffer();
    typeBuffer = {
      el: target,
      value,
      timer: setTimeout(flushTypeBuffer, 500),
    };
  }
}

function handleChange(e: Event): void {
  const target = e.target as HTMLSelectElement;
  if (!target || target.tagName !== "SELECT") return;
  if (target.closest("[data-opensidebar]")) return;

  flushTypeBuffer();

  const selectedOption = target.options[target.selectedIndex];
  emitAction(
    {
      type: "select",
      timestamp: Date.now(),
      url: window.location.href,
      element: buildElementDescriptor(target),
      value: selectedOption?.textContent?.trim() || target.value,
    },
    target,
  );
}

let lastScrollTs = 0;
let scrollAccumulator = 0;
let scrollTimer: ReturnType<typeof setTimeout> | null = null;

function handleScroll(): void {
  if (!recording) return;

  const now = Date.now();
  const deltaY = window.scrollY - (lastScrollY ?? window.scrollY);
  lastScrollY = window.scrollY;
  scrollAccumulator += deltaY;

  if (now - lastScrollTs < 300) {
    // Throttle: merge consecutive scrolls
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(flushScroll, 300);
    return;
  }

  flushScroll();
}

let lastScrollY: number | null = null;

function flushScroll(): void {
  if (scrollAccumulator === 0) return;
  lastScrollTs = Date.now();
  emitAction({
    type: "scroll",
    timestamp: Date.now(),
    url: window.location.href,
    scrollDelta: scrollAccumulator,
  });
  scrollAccumulator = 0;
}

function handleKeydown(e: KeyboardEvent): void {
  // Only capture special keys and modifier combos
  const special = [
    "Enter",
    "Escape",
    "Tab",
    "Backspace",
    "Delete",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
  ];
  const hasModifier = e.ctrlKey || e.metaKey || e.altKey;

  if (!special.includes(e.key) && !hasModifier) return;
  // Don't capture Ctrl+C/V etc that are just text editing
  if (hasModifier && ["c", "v", "x", "z"].includes(e.key.toLowerCase())) return;

  const target = e.target as Element | null;
  // Only build element descriptor if the target is an Element (not Document/Window)
  const descriptor =
    target && typeof target.getAttribute === "function"
      ? buildElementDescriptor(target)
      : undefined;

  emitAction(
    {
      type: "press_key",
      timestamp: Date.now(),
      url: window.location.href,
      element: descriptor,
      key: e.key,
      value:
        [
          e.ctrlKey ? "ctrl" : "",
          e.shiftKey ? "shift" : "",
          e.altKey ? "alt" : "",
          e.metaKey ? "meta" : "",
        ]
          .filter(Boolean)
          .join("+") || undefined,
    },
    target && typeof target.getAttribute === "function" ? target : undefined,
  );
}

// --- Drag Tracking ---

/** Minimum pixel distance to distinguish a drag from a click */
const DRAG_THRESHOLD = 20;

let dragState: {
  sourceEl: Element;
  startX: number;
  startY: number;
} | null = null;

function handlePointerDown(e: PointerEvent): void {
  const target = e.target as Element;
  if (!target || target.closest("[data-opensidebar]")) return;

  dragState = {
    sourceEl: target,
    startX: e.clientX,
    startY: e.clientY,
  };
}

function handlePointerUp(e: PointerEvent): void {
  if (!dragState) return;

  const dx = e.clientX - dragState.startX;
  const dy = e.clientY - dragState.startY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance >= DRAG_THRESHOLD) {
    const dropTarget = e.target as Element;
    if (dropTarget && typeof dropTarget.getAttribute === "function") {
      flushTypeBuffer();

      emitAction(
        {
          type: "drag",
          timestamp: Date.now(),
          url: window.location.href,
          sourceElement: buildElementDescriptor(dragState.sourceEl),
          element: buildElementDescriptor(dropTarget),
        },
        dropTarget,
      );

      // Suppress the click that normally fires after pointerup
      suppressNextClick = true;
    }
  }

  dragState = null;
}

/** When true, the next click event is swallowed (it's the tail end of a drag). */
let suppressNextClick = false;

// --- Public API ---

export function startRecording(): void {
  if (recording) return;
  recording = true;
  capturedActions = [];
  lastScrollY = window.scrollY;
  scrollAccumulator = 0;

  document.addEventListener("click", handleClick, true);
  document.addEventListener("input", handleInput, true);
  document.addEventListener("change", handleChange, true);
  window.addEventListener("scroll", handleScroll, { passive: true });
  document.addEventListener("keydown", handleKeydown, true);
  document.addEventListener("pointerdown", handlePointerDown, true);
  document.addEventListener("pointerup", handlePointerUp, true);
  window.addEventListener("beforeunload", flushTypeBuffer);
}

export function stopRecording(): DemoAction[] {
  if (!recording) return [];
  recording = false;

  flushTypeBuffer();
  flushScroll();

  document.removeEventListener("click", handleClick, true);
  document.removeEventListener("input", handleInput, true);
  document.removeEventListener("change", handleChange, true);
  window.removeEventListener("scroll", handleScroll);
  document.removeEventListener("keydown", handleKeydown, true);
  document.removeEventListener("pointerdown", handlePointerDown, true);
  document.removeEventListener("pointerup", handlePointerUp, true);
  window.removeEventListener("beforeunload", flushTypeBuffer);
  dragState = null;
  suppressNextClick = false;

  const result = [...capturedActions];
  capturedActions = [];
  return result;
}

export function startGoldenRecording(): void {
  goldenMode = true;
  // Tag the page so elements have data-os-tag attributes
  tagElements(false);
  startRecording();
}

export function stopGoldenRecording(): DemoAction[] {
  goldenMode = false;
  return stopRecording();
}

export function isRecording(): boolean {
  return recording;
}

export function isGoldenMode(): boolean {
  return goldenMode;
}
