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
import { getTagMap, getVisibleText, addDynamicTag } from "../tagging";
import {
  staleIdError,
  describeElement,
  getTaggedElement,
  isLikelyOverlay,
  normalizeTagId,
} from "./helpers";

/**
 * Use the native prototype value setter to bypass React/Vue controlled input interception.
 * Frameworks override the `value` property on instances; calling the prototype setter
 * triggers the internal [[Set]] without the framework's getter/setter interference.
 */
function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
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

  // Our own injected elements (agent border, stop button) must be excluded from
  // elementFromPoint checks — they cover the viewport at max z-index but have
  // pointer-events:none. elementFromPoint doesn't respect pointer-events.
  const isOwnOverlay = (node: Element | null): boolean =>
    !!node &&
    (node.id === "opensidebar-agent-border" ||
      node.id === "opensidebar-stop-btn" ||
      node.classList?.contains("opensidebar-tag"));

  // Z-Index Check: Auto-hide covering overlays (up to 3 layers) before clicking
  const MAX_OVERLAY_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_OVERLAY_RETRIES; attempt++) {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const topEl = document.elementFromPoint(x, y);

    if (!topEl || el.contains(topEl) || topEl.contains(el) || isOwnOverlay(topEl)) {
      break; // Clear to click (or our own overlay — transparent to interaction)
    }

    // Auto-hide the covering element only if it looks like an overlay
    if (topEl instanceof HTMLElement) {
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
    const topEl = document.elementFromPoint(point.x, point.y);
    if (!topEl || el.contains(topEl) || topEl.contains(el) || isOwnOverlay(topEl)) {
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
        el.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
        );
        el.dispatchEvent(
          new MouseEvent("mouseup", { bubbles: true, cancelable: true }),
        );
        el.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
        if (el instanceof HTMLElement) el.click();
        if (i < count - 1) {
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      return {
        success: true,
        result: `Clicked [${tagId}] ${el.tagName.toLowerCase()} "${getVisibleText(el).slice(0, 40)}" (overlay pass-through)`,
        navigated: false,
      };
    }

    const blockingTag = addDynamicTag(finalTop);
    const blockingTagName = finalTop.tagName.toLowerCase();
    const overlayLikely = isLikelyOverlay(finalTop);
    const result = overlayLikely
      ? `Click intercepted! Element [${tagId}] is covered by overlay [${blockingTag}] <${blockingTagName}>. Use hide_element(${blockingTag}) to remove it, or press_key("Escape").`
      : `Click intercepted! Element [${tagId}] is covered by [${blockingTag}] <${blockingTagName}>. This is page content, not an overlay. Try: hide_element(${blockingTag}) to remove it, scroll_page to reposition, or execute_js to click programmatically.`;
    return { success: false, result, navigated: false };
  }

  // Determine if this click will navigate
  const willNavigate =
    (el.tagName === "A" &&
      el.hasAttribute("href") &&
      !(el as HTMLAnchorElement).target) ||
    el.closest("form")?.querySelector("[type='submit']") === el;

  // Dispatch click events (possibly multiple times)
  for (let i = 0; i < count; i++) {
    el.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    el.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true }),
    );
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    // Also call .click() for elements that handle it natively
    if (el instanceof HTMLElement) {
      el.click();
    }

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
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      (el as HTMLElement).isContentEditable
    )
  ) {
    return {
      success: false,
      result: `Element [${tagId}] is not a text input`,
      navigated: false,
    };
  }

  // Scroll into view and focus the element
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ behavior: "instant", block: "center" });
    el.focus();
  }

  // Clear existing value using native setter
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    setNativeValue(el, "");
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "deleteContentBackward",
      }),
    );
  }

  // Type character by character for SPA frameworks that listen to input events
  for (const char of args.text) {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: char, bubbles: true }),
    );
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      setNativeValue(el, el.value + char);
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: char,
          inputType: "insertText",
        }),
      );
    } else if ((el as HTMLElement).isContentEditable) {
      (el as HTMLElement).textContent =
        ((el as HTMLElement).textContent || "") + char;
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: char,
          inputType: "insertText",
        }),
      );
    }
    el.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true }));
  }

  el.dispatchEvent(new Event("change", { bubbles: true }));

  // Press Enter if requested
  let navigated = false;
  if (args.pressEnter) {
    el.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        bubbles: true,
      }),
    );
    el.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        bubbles: true,
      }),
    );

    // Check if the input is inside a form — Enter may submit it
    const form = el.closest("form");
    if (form) {
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

export function executeHover(args: { id: number }): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  const tagId = normalizeTagId(args.id);
  const el = getTaggedElement(args.id);
  if (!el) return staleIdError(args.id);

  el.scrollIntoView({ behavior: "instant", block: "center" });
  el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));

  return {
    success: true,
    result: `Hovered over ${describeElement(el, tagId)}`,
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

  if (!(el instanceof HTMLSelectElement)) {
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

  // Scroll into view, set the value and dispatch change event
  el.scrollIntoView({ behavior: "instant", block: "center" });
  el.value = match.value;
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

  // Dispatch to the focused element (or document.body as fallback).
  // If nothing is focused, try to focus the most relevant interactive element.
  let target: EventTarget = document.activeElement ?? document.body;
  if (target === document.body) {
    // No element focused — try to focus a focusable element near the viewport center
    const focusable = document.querySelector<HTMLElement>(
      "[tabindex], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [contenteditable='true']",
    );
    if (focusable) {
      focusable.focus();
      target = focusable;
    }
  }

  target.dispatchEvent(new KeyboardEvent("keydown", opts));
  target.dispatchEvent(new KeyboardEvent("keyup", opts));

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
  el.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
  );

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

  if (
    !(el instanceof HTMLInputElement) ||
    (el.type !== "checkbox" && el.type !== "radio")
  ) {
    return {
      success: false,
      result: `Element [${tagId}] is not a checkbox or radio input`,
      navigated: false,
    };
  }

  el.scrollIntoView({ behavior: "instant", block: "center" });

  // Use click() for React/framework compatibility — direct property assignment
  // doesn't trigger synthetic event handlers. click() toggles the native state
  // AND fires the full event pipeline (mousedown, mouseup, click, change).
  if (el.type === "radio") {
    // Radio: click to select (only if not already in desired state)
    if (args.checked && !el.checked) el.click();
  } else {
    // Checkbox: click toggles, so only click if current state differs
    if (el.checked !== args.checked) el.click();
  }

  // Fallback: ensure the DOM property matches the requested state
  if (el.checked !== args.checked) {
    el.checked = args.checked;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
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
  const eventOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y };

  target.dispatchEvent(new MouseEvent("mousedown", eventOpts));
  target.dispatchEvent(new MouseEvent("mouseup", eventOpts));
  target.dispatchEvent(new MouseEvent("click", eventOpts));

  // Also call .click() for native handling on HTMLElements
  if (el instanceof HTMLElement) {
    el.click();
  }

  // Detect navigation
  const willNavigate =
    el instanceof HTMLAnchorElement && !!el.href && !el.target;

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
