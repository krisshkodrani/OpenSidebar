/**
 * Interaction actions - click, type, hover, select, press key, drag & drop, etc.
 */

import {
  ClickElementArgs,
  ClickCoordinatesArgs,
  TypeTextArgs,
  SelectOptionArgs,
  PressKeyArgs,
  DragAndDropArgs,
  RightClickArgs,
  SetCheckboxArgs,
} from "../../types";
import {
  getTagMap,
  getVisibleText,
  addDynamicTag,
  getCheckboxOrRadioControl,
} from "../tagging";
import {
  staleIdError,
  describeElement,
  getTaggedElement,
  isLikelyOverlay,
  normalizeTagId,
} from "./helpers";
import {
  isAnchorElement,
  isButtonElement,
  isFormElement,
  isHtmlElement,
  isInputElement,
  isSelectElement,
  isTextAreaElement,
} from "../dom-guards";

/**
 * Use the native prototype value setter to bypass React/Vue controlled input interception.
 * Frameworks override the `value` property on instances; calling the prototype setter
 * triggers the internal [[Set]] without the framework's getter/setter interference.
 */
function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const view = el.ownerDocument?.defaultView ?? window;
  const proto = isTextAreaElement(el)
    ? view.HTMLTextAreaElement.prototype
    : view.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
}

let lastKeyboardTarget: Element | null = null;

function isLiveKeyboardTarget(el: Element | null): el is Element {
  if (!el?.isConnected) return false;
  try {
    const frameElement = el.ownerDocument?.defaultView?.frameElement;
    return !frameElement || frameElement.isConnected;
  } catch {
    return true;
  }
}

function rememberKeyboardTarget(el: Element | null): void {
  if (isLiveKeyboardTarget(el)) {
    lastKeyboardTarget = el;
  }
}

function getActiveElement(doc: Document | null | undefined): Element | null {
  try {
    return doc?.activeElement ?? null;
  } catch {
    return null;
  }
}

function isDocumentFallbackElement(el: Element | null): boolean {
  if (!el) return true;
  const doc = el.ownerDocument;
  return el === doc.body || el === doc.documentElement;
}

function findFocusableElement(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>(
    "[tabindex], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [contenteditable='true']",
  );
}

function resolveKeyboardTarget(): Element {
  if (lastKeyboardTarget && !isLiveKeyboardTarget(lastKeyboardTarget)) {
    lastKeyboardTarget = null;
  }

  if (lastKeyboardTarget) {
    const ownerDoc = lastKeyboardTarget.ownerDocument;
    const ownerActive = getActiveElement(ownerDoc);
    if (!isDocumentFallbackElement(ownerActive)) {
      return ownerActive!;
    }

    if (isHtmlElement(lastKeyboardTarget)) {
      lastKeyboardTarget.focus();
      const focused = getActiveElement(ownerDoc);
      if (!isDocumentFallbackElement(focused)) {
        return focused!;
      }
    }

    return lastKeyboardTarget;
  }

  const active = getActiveElement(document);
  if (!isDocumentFallbackElement(active)) {
    return active!;
  }

  const focusable = findFocusableElement(document);
  if (focusable) {
    focusable.focus();
    return focusable;
  }

  return document.body ?? document.documentElement;
}

function keyboardEventForTarget(
  target: Element,
  type: string,
  opts: KeyboardEventInit,
): KeyboardEvent {
  const view = target.ownerDocument?.defaultView ?? window;
  const EventCtor = view.KeyboardEvent ?? KeyboardEvent;
  return new EventCtor(type, opts);
}

function mouseEventForTarget(
  target: Element,
  type: string,
  opts: MouseEventInit = {},
): MouseEvent {
  const view = target.ownerDocument?.defaultView ?? window;
  const EventCtor = view.MouseEvent ?? MouseEvent;
  return new EventCtor(type, { view, ...opts });
}

function pointerEventForTarget(
  target: Element,
  type: string,
  opts: PointerEventInit = {},
): Event {
  const view = target.ownerDocument?.defaultView ?? window;
  const FallbackCtor =
    typeof PointerEvent !== "undefined" ? PointerEvent : MouseEvent;
  const EventCtor = view.PointerEvent ?? view.MouseEvent ?? FallbackCtor;
  return new EventCtor(type, { view, ...opts });
}

function centerMouseOptions(target: Element): MouseEventInit {
  const rect = target.getBoundingClientRect();
  return {
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  };
}

function dispatchMouseActivation(target: Element, opts: MouseEventInit): void {
  const hoverOpts = {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 0,
    ...opts,
  };
  const downOpts = { ...hoverOpts, buttons: 1 };
  const upOpts = { ...hoverOpts, buttons: 0 };

  target.dispatchEvent(pointerEventForTarget(target, "pointerover", hoverOpts));
  target.dispatchEvent(mouseEventForTarget(target, "mouseover", hoverOpts));
  target.dispatchEvent(mouseEventForTarget(target, "mousemove", hoverOpts));
  target.dispatchEvent(pointerEventForTarget(target, "pointerdown", downOpts));
  target.dispatchEvent(mouseEventForTarget(target, "mousedown", downOpts));
  target.dispatchEvent(pointerEventForTarget(target, "pointerup", upOpts));
  target.dispatchEvent(mouseEventForTarget(target, "mouseup", upOpts));
}

function dispatchClickActivation(
  target: Element,
  opts: MouseEventInit = centerMouseOptions(target),
): void {
  dispatchMouseActivation(target, opts);
  if (isHtmlElement(target)) {
    target.click();
  } else {
    target.dispatchEvent(
      mouseEventForTarget(target, "click", {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 0,
        ...opts,
      }),
    );
  }
}

function isAutocompleteLikeTextInput(el: HTMLInputElement): boolean {
  const role = el.getAttribute("role")?.toLowerCase() ?? "";
  const blob = [
    el.getAttribute("id"),
    el.getAttribute("name"),
    el.getAttribute("class"),
    el.getAttribute("autocomplete"),
    el.getAttribute("aria-label"),
    el.getAttribute("aria-controls"),
    el.getAttribute("aria-haspopup"),
    el.getAttribute("aria-autocomplete"),
    el.getAttribute("placeholder"),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    role === "combobox" ||
    el.hasAttribute("list") ||
    el.hasAttribute("aria-autocomplete") ||
    /\b(combo|autocomplete|typeahead|suggest|lookup|reference)\b/.test(blob) ||
    /\bsys_display\./.test(blob)
  );
}

export async function executeClick(args: ClickElementArgs): Promise<{
  success: boolean;
  result: string;
  navigated: boolean;
}> {
  const count = Math.min(Math.max((args.count as number) || 1, 1), 10);
  const tagId = normalizeTagId(args.id);
  const el = getTaggedElement(args.id);
  if (!el) {
    return staleIdError(args.id);
  }

  // Scroll into view if needed
  el.scrollIntoView({ behavior: "instant", block: "center" });
  const ownerDoc = el.ownerDocument ?? document;

  // Our own injected elements (agent border, stop button) must be excluded from
  // elementFromPoint checks — they cover the viewport at max z-index but have
  // pointer-events:none. elementFromPoint doesn't respect pointer-events.
  const isOwnOverlay = (node: Element | null): boolean =>
    !!node &&
    (node.id === "opensidebar-agent-border" ||
      node.id === "opensidebar-e2e-rail" ||
      node.id === "opensidebar-stop-btn" ||
      Boolean(node.closest?.("#opensidebar-e2e-rail")) ||
      node.classList?.contains("opensidebar-tag"));

  // Body/HTML returned by elementFromPoint is a false positive — these root
  // elements can't meaningfully block their children. Happens on complex SPAs
  // (e.g. LinkedIn messaging) where scrollIntoView shifts a fixed panel and
  // elementFromPoint lands on the document root behind it.
  const isDocumentRoot = (node: Element | null): boolean =>
    !!node &&
    (node === node.ownerDocument.body ||
      node === node.ownerDocument.documentElement);

  const isServiceNowShellPassThrough = (node: Element | null): boolean => {
    if (!node) return false;
    const tagName = node.tagName.toLowerCase();
    if (!tagName.startsWith("macroponent-")) return false;
    const host = window.location.hostname.toLowerCase();
    return host.endsWith(".service-now.com") || host.endsWith(".servicenow.com");
  };

  // Do not hide page overlays here: a real user click would be intercepted,
  // and clicking through modal/backdrop state can toggle the wrong control.
  const MAX_OVERLAY_RETRIES = 0;
  for (let attempt = 0; attempt < MAX_OVERLAY_RETRIES; attempt++) {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const topEl = ownerDoc.elementFromPoint(x, y);

    if (
      !topEl ||
      el.contains(topEl) ||
      topEl.contains(el) ||
      isOwnOverlay(topEl) ||
      isDocumentRoot(topEl) ||
      isServiceNowShellPassThrough(topEl)
    ) {
      break; // Clear to click (or our own overlay / document root — not a real blocker)
    }

    // Auto-hide the covering element only if it looks like an overlay
    if (isHtmlElement(topEl)) {
      if (!isLikelyOverlay(topEl)) break; // Not an overlay — stop retrying
      topEl.style.display = "none";
    }
  }

  // Final check after retries: Check multiple points (Center + 4 Corners)
  const finalRect = el.getBoundingClientRect();
  const points = [
    {
      x: finalRect.left + finalRect.width / 2,
      y: finalRect.top + finalRect.height / 2,
    }, // Center
    {
      x: finalRect.left + finalRect.width * 0.1,
      y: finalRect.top + finalRect.height * 0.1,
    }, // Top-Left
    {
      x: finalRect.right - finalRect.width * 0.1,
      y: finalRect.top + finalRect.height * 0.1,
    }, // Top-Right
    {
      x: finalRect.left + finalRect.width * 0.1,
      y: finalRect.bottom - finalRect.height * 0.1,
    }, // Bottom-Left
    {
      x: finalRect.right - finalRect.width * 0.1,
      y: finalRect.bottom - finalRect.height * 0.1,
    }, // Bottom-Right
  ];

  let cleanClick = false;
  let blockingDetails = null;

  for (const point of points) {
    const topEl = ownerDoc.elementFromPoint(point.x, point.y);
    if (
      !topEl ||
      el.contains(topEl) ||
      topEl.contains(el) ||
      isOwnOverlay(topEl) ||
      isDocumentRoot(topEl) ||
      isServiceNowShellPassThrough(topEl)
    ) {
      cleanClick = true;
      break;
    }
    // Capture details of the first blocker we find, just in case all points fail
    if (!blockingDetails && topEl) {
      blockingDetails = topEl;
    }
  }

  if (!cleanClick && blockingDetails) {
    const finalTop = blockingDetails as HTMLElement;

    // Fallback: if the blocking element is a child of the target (e.g., a span
    // inside a button) or the target is inside the blocker (e.g., a button
    // inside a modal overlay), the click is safe — proceed with native .click().
    const blockerIsChild = el.contains(finalTop);
    const targetInsideBlocker = finalTop.contains(el);
    // Shadow DOM: elementFromPoint returns the host, but our target is inside
    // its shadow tree. host.contains(shadowChild) is false across boundaries,
    // but host.shadowRoot.contains(shadowChild) is true for open roots.
    const targetInShadowOfBlocker =
      (finalTop as HTMLElement).shadowRoot?.contains(el) ?? false;
    if (blockerIsChild || targetInsideBlocker || targetInShadowOfBlocker) {
      for (let i = 0; i < count; i++) {
        rememberKeyboardTarget(el);
        dispatchClickActivation(el);
        if (i < count - 1) {
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      const mayNavigate =
        el.tagName === "A" ||
        el.closest("a") !== null ||
        isFormElement(el) ||
        (isButtonElement(el) && el.type === "submit");
      return {
        success: true,
        result: `Clicked [${tagId}] ${el.tagName.toLowerCase()} "${getVisibleText(el).slice(0, 40)}" (overlay pass-through)`,
        navigated: mayNavigate,
      };
    }

    const blockingTag = addDynamicTag(finalTop);
    const blockingTagName = finalTop.tagName.toLowerCase();
    const overlayLikely = isLikelyOverlay(finalTop);
    const result = overlayLikely
      ? `Click intercepted! Element [${tagId}] is covered by overlay [${blockingTag}] <${blockingTagName}>. Read the page to find the overlay's close/dismiss/accept button and click it directly. Alternatively try press_key("Escape").`
      : `Click intercepted! Element [${tagId}] is covered by [${blockingTag}] <${blockingTagName}>. This may be a popup, banner, or modal. Read the page to find its close/dismiss/accept button and click that button directly. If no button is visible, try press_key("Escape") or scroll_page to reposition.`;
    return { success: false, result, navigated: false };
  }

  // Determine if this click will navigate
  const willNavigate =
    (el.tagName === "A" &&
      el.hasAttribute("href") &&
      !(el as HTMLAnchorElement).target) ||
    el.closest("form")?.querySelector("[type='submit']") === el;

  // Dispatch click events (possibly multiple times).
  // Use el.click() as the single click source (native, trusted) — the Playwright
  // approach. Do NOT also dispatch synthetic MouseEvent("click") as that causes
  // double-processing on toggle elements (accordions, checkboxes, tabs).
  //
  for (let i = 0; i < count; i++) {
    rememberKeyboardTarget(el);
    dispatchClickActivation(el);

    // Delay between clicks for multi-click (let event handlers process)
    if (i < count - 1) {
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  const countSuffix = count > 1 ? ` (${count} times)` : "";
  return {
    success: true,
    result: `Clicked [${tagId}] ${el.tagName.toLowerCase()} "${getVisibleText(el).slice(0, 40)}"${countSuffix}`,
    navigated: willNavigate,
  };
}

export function executeType(args: TypeTextArgs): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  const tagId = normalizeTagId(args.id);
  const el = getTaggedElement(args.id);
  if (!el) {
    return staleIdError(args.id);
  }

  if (
    !(
      isInputElement(el) ||
      isTextAreaElement(el) ||
      (isHtmlElement(el) && el.isContentEditable)
    )
  ) {
    return {
      success: false,
      result: `Element [${tagId}] is not a text input`,
      navigated: false,
    };
  }

  // Scroll into view and focus the element
  if (isHtmlElement(el)) {
    el.scrollIntoView({ behavior: "instant", block: "center" });
    el.focus();
    rememberKeyboardTarget(el);
  }

  // ContentEditable: set text directly and fire input events
  const isInput = isInputElement(el);
  const isTextarea = isTextAreaElement(el);
  if (!isInput && !isTextarea) {
    const htmlEl = el as HTMLElement;
    htmlEl.focus();
    rememberKeyboardTarget(htmlEl);
    htmlEl.textContent = args.text;
    htmlEl.dispatchEvent(
      new InputEvent("input", { bubbles: true, data: args.text, inputType: "insertText" }),
    );
    htmlEl.dispatchEvent(new Event("change", { bubbles: true }));
    return {
      success: true,
      result: `Typed "${args.text.slice(0, 60)}" into [${tagId}] (contentEditable)`,
      navigated: false,
    };
  }

  // Input/textarea: clear using native setter, then type char-by-char for SPA frameworks
  {
    if (isInputElement(el) || isTextAreaElement(el)) {
      setNativeValue(el, "");
      el.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }),
      );
    }

    for (const char of args.text) {
      el.dispatchEvent(
        keyboardEventForTarget(el, "keydown", { key: char, bubbles: true }),
      );
      if (isInputElement(el) || isTextAreaElement(el)) {
        setNativeValue(el, el.value + char);
        el.dispatchEvent(
          new InputEvent("input", { bubbles: true, data: char, inputType: "insertText" }),
        );
      }
      el.dispatchEvent(
        keyboardEventForTarget(el, "keyup", { key: char, bubbles: true }),
      );
    }

    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Press Enter if requested
  let navigated = false;
  if (args.pressEnter) {
    el.dispatchEvent(
      keyboardEventForTarget(el, "keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        bubbles: true,
      }),
    );
    el.dispatchEvent(
      keyboardEventForTarget(el, "keyup", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        bubbles: true,
      }),
    );

    // Check if the input is inside a form — Enter may submit it
    const form = el.closest("form");
    if (
      isFormElement(form) &&
      !(isInputElement(el) && isAutocompleteLikeTextInput(el))
    ) {
      form.requestSubmit();
      navigated = true;
    }
  }

  return {
    success: true,
    result: `Typed "${args.text}" into ${describeElement(el, tagId)}${args.pressEnter ? " and pressed Enter" : ""}`,
    navigated,
  };
}

/**
 * Activate CSS :hover rules on an element by injecting matching styles as a class.
 * This works around the limitation that synthetic MouseEvent doesn't trigger the
 * CSS :hover pseudo-class — only real mouse input does (or CDP Input.dispatchMouseEvent).
 */
function forceHoverStyles(el: HTMLElement): boolean {
  try {
    const hoverRules: string[] = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (
            rule instanceof CSSStyleRule &&
            rule.selectorText.includes(":hover")
          ) {
            // Check if this rule would match our element when hovered
            const baseSelector = rule.selectorText.replace(/:hover/g, "");
            try {
              if (el.matches(baseSelector) || el.closest(baseSelector)) {
                // Extract the CSS text and add it to our override
                hoverRules.push(rule.cssText.replace(/:hover/g, ".--os-hover-active"));
              }
            } catch {
              // Invalid selector — skip
            }
          }
        }
      } catch {
        // Cross-origin stylesheet — skip
      }
    }
    if (hoverRules.length === 0) return false;

    // Inject a <style> element with the hover rules rewritten to use a class
    let styleEl = document.getElementById("__os-hover-override") as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "__os-hover-override";
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = hoverRules.join("\n");

    // Add the class to the element and its ancestors (some rules target parent:hover > child)
    el.classList.add("--os-hover-active");
    let parent = el.parentElement;
    let depth = 0;
    while (parent && depth < 5) {
      parent.classList.add("--os-hover-active");
      parent = parent.parentElement;
      depth++;
    }
    return true;
  } catch {
    return false;
  }
}

export function executeHover(args: { id: number }): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  const tagId = normalizeTagId(args.id);
  const el = getTaggedElement(args.id);
  if (!el) return staleIdError(args.id);

  el.scrollIntoView({ behavior: "instant", block: "center" });
  // Dispatch synthetic mouse events (triggers JS handlers)
  el.dispatchEvent(mouseEventForTarget(el, "mouseover", { bubbles: true }));
  el.dispatchEvent(mouseEventForTarget(el, "mouseenter", { bubbles: true }));
  el.dispatchEvent(mouseEventForTarget(el, "mousemove", { bubbles: true }));

  // Force CSS :hover styles (synthetic events don't activate the pseudo-class)
  const forcedCss = forceHoverStyles(el as HTMLElement);

  return {
    success: true,
    result: `Hovered over ${describeElement(el, tagId)}${forcedCss ? " (CSS :hover activated)" : ""}`,
    navigated: false,
  };
}

export function executeSelectOption(args: SelectOptionArgs): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  const tagId = normalizeTagId(args.id);
  const el = getTaggedElement(args.id);
  if (!el) {
    return staleIdError(args.id);
  }

  if (!isSelectElement(el)) {
    return {
      success: false,
      result: `Element [${tagId}] is not a <select> element`,
      navigated: false,
    };
  }

  // Find matching option by text content or value attribute
  const options = Array.from(el.options);
  const match = options.find(
    (opt) =>
      opt.textContent?.trim().toLowerCase() === args.value.toLowerCase() ||
      opt.value.toLowerCase() === args.value.toLowerCase(),
  );

  if (!match) {
    const available = options
      .map((opt) => `"${opt.textContent?.trim()}" (value="${opt.value}")`)
      .join(", ");
    return {
      success: false,
      result: `No option matching "${args.value}" in [${tagId}]. Available options: ${available}`,
      navigated: false,
    };
  }

  // Scroll into view and set the value using native setter for React compatibility
  el.scrollIntoView({ behavior: "instant", block: "center" });
  rememberKeyboardTarget(el);

  // Use native prototype setter to bypass React/Vue controlled select interception
  const view = el.ownerDocument?.defaultView ?? window;
  const selectProto = view.HTMLSelectElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(selectProto, "value")?.set;
  if (setter) {
    setter.call(el, match.value);
  } else {
    el.value = match.value;
  }
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("input", { bubbles: true }));

  return {
    success: true,
    result: `Selected "${match.textContent?.trim()}" in ${describeElement(el, tagId)}`,
    navigated: false,
  };
}

export function executePressKey(args: PressKeyArgs): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  const modifiers = args.modifiers ?? [];
  const opts: KeyboardEventInit = {
    key: args.key,
    code: args.key.length === 1 ? `Key${args.key.toUpperCase()}` : args.key,
    bubbles: true,
    cancelable: true,
    ctrlKey: modifiers.includes("ctrl"),
    shiftKey: modifiers.includes("shift"),
    altKey: modifiers.includes("alt"),
    metaKey: modifiers.includes("meta"),
  };

  // Dispatch to the focused element in the last interacted document. Same-origin
  // iframes keep their own activeElement, so top-level document.activeElement is
  // often only the iframe shell or body.
  const target = resolveKeyboardTarget();
  rememberKeyboardTarget(target);

  target.dispatchEvent(keyboardEventForTarget(target, "keydown", opts));
  target.dispatchEvent(keyboardEventForTarget(target, "keypress", opts));
  target.dispatchEvent(keyboardEventForTarget(target, "keyup", opts));

  // Only auto-submit forms on Enter when the focused element is a single-line
  // text input — not for textareas, contenteditable, or select/autocomplete.
  if (args.key === "Enter") {
    const focusedEl = target;
    const focusedInput = isInputElement(focusedEl as Element | null)
      ? (focusedEl as HTMLInputElement)
      : null;
    if (
      focusedInput &&
      !["checkbox", "radio", "file", "range", "hidden"].includes(focusedInput.type) &&
      !isAutocompleteLikeTextInput(focusedInput)
    ) {
      const form = focusedInput.closest("form");
      if (isFormElement(form)) {
        form.requestSubmit();
      }
    }
  }

  const modStr = modifiers.length > 0 ? ` (${modifiers.join("+")})` : "";
  return {
    success: true,
    result: `Pressed key "${args.key}"${modStr}`,
    navigated: false,
  };
}

export function executeDragAndDrop(args: DragAndDropArgs): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  const tagMap = getTagMap();
  const sourceEl = tagMap.get(args.sourceId);
  if (!sourceEl) {
    return {
      success: false,
      result: staleIdError(args.sourceId).result,
      navigated: false,
    };
  }
  const targetEl = tagMap.get(args.targetId);
  if (!targetEl) {
    return {
      success: false,
      result: staleIdError(args.targetId).result,
      navigated: false,
    };
  }

  sourceEl.scrollIntoView({ behavior: "instant", block: "center" });
  rememberKeyboardTarget(sourceEl);

  const srcRect = sourceEl.getBoundingClientRect();
  const tgtRect = targetEl.getBoundingClientRect();

  const srcX = srcRect.left + srcRect.width / 2;
  const srcY = srcRect.top + srcRect.height / 2;
  const tgtX = tgtRect.left + tgtRect.width / 2;
  const tgtY = tgtRect.top + tgtRect.height / 2;

  const commonOpts = { bubbles: true, cancelable: true };

  // --- Strategy 1: Pointer/Mouse events (React DnD, dnd-kit, SortableJS, etc.) ---
  // Most modern DnD libraries listen for pointer or mouse events, not native HTML5 drag.

  // pointerdown + mousedown on source
  sourceEl.dispatchEvent(
    new PointerEvent("pointerdown", {
      ...commonOpts,
      clientX: srcX,
      clientY: srcY,
      pointerId: 1,
    }),
  );
  sourceEl.dispatchEvent(
    new MouseEvent("mousedown", {
      ...commonOpts,
      clientX: srcX,
      clientY: srcY,
    }),
  );

  // Interpolated pointermove + mousemove from source → target
  const DRAG_STEPS = 10;
  for (let i = 1; i <= DRAG_STEPS; i++) {
    const t = i / DRAG_STEPS;
    const cx = srcX + (tgtX - srcX) * t;
    const cy = srcY + (tgtY - srcY) * t;
    const moveTarget = i < DRAG_STEPS ? sourceEl : targetEl;
    moveTarget.dispatchEvent(
      new PointerEvent("pointermove", {
        ...commonOpts,
        clientX: cx,
        clientY: cy,
        pointerId: 1,
      }),
    );
    moveTarget.dispatchEvent(
      new MouseEvent("mousemove", {
        ...commonOpts,
        clientX: cx,
        clientY: cy,
      }),
    );
  }

  // pointerup + mouseup on target
  targetEl.dispatchEvent(
    new PointerEvent("pointerup", {
      ...commonOpts,
      clientX: tgtX,
      clientY: tgtY,
      pointerId: 1,
    }),
  );
  targetEl.dispatchEvent(
    new MouseEvent("mouseup", {
      ...commonOpts,
      clientX: tgtX,
      clientY: tgtY,
    }),
  );

  // --- Strategy 2: Native HTML5 Drag & Drop API (fallback) ---
  const dataTransfer = new DataTransfer();

  sourceEl.dispatchEvent(
    new DragEvent("dragstart", { ...commonOpts, dataTransfer }),
  );
  targetEl.dispatchEvent(
    new DragEvent("dragover", { ...commonOpts, dataTransfer }),
  );
  targetEl.dispatchEvent(
    new DragEvent("drop", { ...commonOpts, dataTransfer }),
  );
  sourceEl.dispatchEvent(
    new DragEvent("dragend", { ...commonOpts, dataTransfer }),
  );

  return {
    success: true,
    result: `Dragged [${args.sourceId}] onto [${args.targetId}]`,
    navigated: false,
  };
}

export function executeRightClick(args: RightClickArgs): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  const tagId = normalizeTagId(args.id);
  const el = getTaggedElement(args.id);
  if (!el) {
    return staleIdError(args.id);
  }

  el.scrollIntoView({ behavior: "instant", block: "center" });
  rememberKeyboardTarget(el);
  const rect = el.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  const eventOpts = {
    bubbles: true,
    cancelable: true,
    button: 2,
    buttons: 2,
    clientX,
    clientY,
  };
  el.dispatchEvent(pointerEventForTarget(el, "pointerdown", eventOpts));
  el.dispatchEvent(mouseEventForTarget(el, "mousedown", eventOpts));
  el.dispatchEvent(pointerEventForTarget(el, "pointerup", eventOpts));
  el.dispatchEvent(mouseEventForTarget(el, "mouseup", eventOpts));
  el.dispatchEvent(mouseEventForTarget(el, "contextmenu", eventOpts));

  return {
    success: true,
    result: `Right-clicked ${describeElement(el, tagId)}`,
    navigated: false,
  };
}

export function executeSetCheckbox(args: SetCheckboxArgs): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  const tagId = normalizeTagId(args.id);
  const el = getTaggedElement(args.id);
  if (!el) {
    return staleIdError(args.id);
  }

  const control = getCheckboxOrRadioControl(el);
  if (!control) {
    return {
      success: false,
      result: `Element [${tagId}] is not a checkbox or radio input`,
      navigated: false,
    };
  }

  el.scrollIntoView({ behavior: "instant", block: "center" });
  rememberKeyboardTarget(control);

  // Use click() for React/framework compatibility — direct property assignment
  // doesn't trigger synthetic event handlers. click() toggles the native state
  // AND fires the full event pipeline (mousedown, mouseup, click, change).
  if (control.type === "radio") {
    // Radio: click to select (only if not already in desired state)
    if (args.checked && !control.checked) control.click();
  } else {
    // Checkbox: click toggles, so only click if current state differs
    if (control.checked !== args.checked) control.click();
  }

  // Fallback: ensure the DOM property matches the requested state
  if (control.checked !== args.checked) {
    control.checked = args.checked;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }

  return {
    success: true,
    result: `Set ${describeElement(el, tagId)} checked=${args.checked}`,
    navigated: false,
  };
}

export function executeClickCoordinates(args: ClickCoordinatesArgs): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  const { x, y, description } = args;

  // Validate coordinates are within viewport
  if (x < 0 || x > window.innerWidth || y < 0 || y > window.innerHeight) {
    return {
      success: false,
      result: `Coordinates (${x}, ${y}) are outside viewport (${window.innerWidth}x${window.innerHeight}).`,
      navigated: false,
    };
  }

  const el = document.elementFromPoint(x, y);

  // Dispatch events on the resolved element, or documentElement as fallback
  const target = el || document.documentElement;
  rememberKeyboardTarget(el);
  const eventOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y };

  dispatchClickActivation(target, eventOpts);

  // Detect navigation
  const willNavigate =
    isAnchorElement(el) && !!el.href && !el.target;

  const label = description ? ` (${description})` : "";
  const tagInfo = el
    ? `<${el.tagName.toLowerCase()}> "${getVisibleText(el).slice(0, 40)}"`
    : "no element at point";

  return {
    success: true,
    result: `Clicked at (${x}, ${y})${label} → ${tagInfo}`,
    navigated: willNavigate,
  };
}
