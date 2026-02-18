/**
 * Actions - Tool execution in the page context
 *
 * Implements all DOM-manipulating tools:
 * - click_element, type_text, scroll_page
 * - hover_element, find_element, select_option
 * - press_key, drag_and_drop, draw_stroke
 * - hide_element
 *
 * Each function receives arguments from the tool call and performs
 * the corresponding DOM action on the tagged element.
 */

import {
  ToolName,
  ClickElementArgs,
  ClickCoordinatesArgs,
  TypeTextArgs,
  ScrollPageArgs,
  ScrollDirection,
  SelectOptionArgs,
  PressKeyArgs,
  DragAndDropArgs,
  DrawStrokeArgs,
  HideElementArgs,
  ReadElementArgs,
  RightClickArgs,
  SetCheckboxArgs,
} from "../types";
import {
  getTagMap,
  getVisibleText,
  addDynamicTag,
  truncateText,
} from "./tagging";
import { buildSnapshot } from "./snapshot";

/** Build a "No element with tag" error with nearby ID hints for LLM recovery */
function staleIdError(id: number): {
  success: false;
  result: string;
  navigated: false;
} {
  const tagMap = getTagMap();
  const available = Array.from(tagMap.keys())
    .sort((a, b) => Math.abs(a - id) - Math.abs(b - id))
    .slice(0, 5);
  const hint =
    available.length > 0
      ? ` Nearby IDs: ${available.map((n) => `[${n}]`).join(", ")}. Call read_page if none match.`
      : " No elements tagged — call read_page to refresh.";
  return {
    success: false,
    result: `No element with tag [${id}]${hint}`,
    navigated: false,
  };
}

/** Overlay detection selectors (matches semantic overlay CSS classes/roles) */
const OVERLAY_SELECTORS = [
  "[role='dialog']",
  "[role='alertdialog']",
  "[aria-modal='true']",
  "dialog[open]",
  ".modal",
  ".overlay",
  ".popup",
  ".banner",
  ".cookie",
  ".consent",
  "[class*='modal']",
  "[class*='overlay']",
  "[class*='popup']",
  "[class*='dialog']",
  "[class*='lightbox']",
  "[class*='backdrop']",
  "[id*='modal']",
  "[id*='overlay']",
  "[id*='dialog']",
  "[id*='lightbox']",
  "[data-modal]",
  "[data-overlay]",
  "[data-dialog]",
  ".lightbox",
  ".notification",
  ".toast",
  ".modal-overlay",
  ".modal-backdrop",
  ".backdrop",
];

/**
 * Check if an element is likely an overlay/modal/popup that can safely be hidden.
 * Returns true if the element matches overlay heuristics (fixed/absolute + high z-index,
 * semantic overlay selectors, backdrop-filter, semi-transparent background, or covers >15% viewport).
 */
export function isLikelyOverlay(el: HTMLElement): boolean {
  // Condition 0: Native HTML dialog element — always an overlay when open
  if (el.tagName === "DIALOG" && el.hasAttribute("open")) return true;

  const style = window.getComputedStyle(el);
  const position = style.position;
  const isPositioned = position === "fixed" || position === "absolute" || position === "sticky";
  const zIndex = parseInt(style.zIndex, 10) || 0;

  // Condition 1: fixed/absolute + high z-index
  if (isPositioned && zIndex > 100) return true;

  // Condition 2: matches semantic overlay selectors
  const selectorStr = OVERLAY_SELECTORS.join(",");
  if (el.matches(selectorStr)) return true;

  // Condition 3: has backdrop-filter
  if (style.backdropFilter && style.backdropFilter !== "none") return true;

  // Condition 4: semi-transparent background (alpha 0-0.9)
  const bg = style.backgroundColor;
  const rgbaMatch = bg.match(
    /rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*([\d.]+)\s*)?\)/,
  );
  if (rgbaMatch && rgbaMatch[1] !== undefined) {
    const alpha = parseFloat(rgbaMatch[1]);
    if (alpha > 0 && alpha <= 0.9) return true;
  }

  // Condition 5: covers >15% of viewport with fixed/absolute positioning
  if (isPositioned) {
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    const vpArea = vpW * vpH;
    if (vpArea > 0) {
      const rect = el.getBoundingClientRect();
      const left = Math.max(0, rect.left);
      const top = Math.max(0, rect.top);
      const right = Math.min(vpW, rect.right);
      const bottom = Math.min(vpH, rect.bottom);
      const visibleArea = Math.max(0, right - left) * Math.max(0, bottom - top);
      if (visibleArea / vpArea > 0.15) return true;
    }
  }

  return false;
}

export async function executeAction(
  toolName: ToolName,
  args: Record<string, unknown>,
): Promise<{ success: boolean; result: string; navigated: boolean }> {
  switch (toolName) {
    case ToolName.CLICK_ELEMENT:
      return executeClick(args as unknown as ClickElementArgs);
    case ToolName.TYPE_TEXT:
      return executeType(args as unknown as TypeTextArgs);
    case ToolName.SCROLL_PAGE:
      return executeScroll(args as unknown as ScrollPageArgs);
    case ToolName.READ_PAGE:
      return executeRead();
    case ToolName.TAKE_SCREENSHOT:
      return {
        success: true,
        result: "Screenshot handled by service worker",
        navigated: false,
      };
    case ToolName.HOVER_ELEMENT:
      return executeHover(args as unknown as { id: number });
    case ToolName.FIND_ELEMENT:
      return executeFindElement(args as unknown as { text: string });
    case ToolName.SELECT_OPTION:
      return executeSelectOption(args as unknown as SelectOptionArgs);
    case ToolName.PRESS_KEY:
      return executePressKey(args as unknown as PressKeyArgs);
    case ToolName.DRAG_AND_DROP:
      return executeDragAndDrop(args as unknown as DragAndDropArgs);
    case ToolName.DRAW_STROKE:
      return executeDrawStroke(args as unknown as DrawStrokeArgs);
    case ToolName.HIDE_ELEMENT:
      return executeHideElement(args as unknown as HideElementArgs);
    case ToolName.READ_ELEMENT:
      return executeReadElement(args as unknown as ReadElementArgs);
    case ToolName.RIGHT_CLICK:
      return executeRightClick(args as unknown as RightClickArgs);
    case ToolName.SET_CHECKBOX:
      return executeSetCheckbox(args as unknown as SetCheckboxArgs);
    case ToolName.CLICK_COORDINATES:
      return executeClickCoordinates(args as unknown as ClickCoordinatesArgs);
    case ToolName.UPLOAD_FILE:
      return executeUploadFile(args as Record<string, unknown>);
    default:
      return {
        success: false,
        result: `Unknown tool: ${toolName}`,
        navigated: false,
      };
  }
}

function executeClick(args: ClickElementArgs): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  const tagMap = getTagMap();
  const el = tagMap.get(args.id);
  if (!el) {
    return staleIdError(args.id);
  }

  // Scroll into view if needed
  el.scrollIntoView({ behavior: "instant", block: "center" });

  // Z-Index Check: Auto-hide covering overlays (up to 3 layers) before clicking
  const MAX_OVERLAY_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_OVERLAY_RETRIES; attempt++) {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const topEl = document.elementFromPoint(x, y);

    if (!topEl || el.contains(topEl) || topEl.contains(el)) {
      break; // Clear to click
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
    if (!topEl || el.contains(topEl) || topEl.contains(el)) {
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
    const blockingTag = addDynamicTag(finalTop);
    const blockingTagName = finalTop.tagName.toLowerCase();
    const overlayLikely = isLikelyOverlay(finalTop);
    const result = overlayLikely
      ? `Click intercepted! Element [${args.id}] is covered by overlay [${blockingTag}] <${blockingTagName}>. Use hide_element(${blockingTag}) to remove it, or press_key("Escape").`
      : `Click intercepted! Element [${args.id}] is covered by [${blockingTag}] <${blockingTagName}>. This is page content, not an overlay. Try: scroll_page, find_element, or click a different element.`;
    return { success: false, result, navigated: false };
  }

  // Determine if this click will navigate
  const willNavigate =
    (el.tagName === "A" &&
      el.hasAttribute("href") &&
      !(el as HTMLAnchorElement).target) ||
    el.closest("form")?.querySelector("[type='submit']") === el;

  // Dispatch real click events
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

  return {
    success: true,
    result: `Clicked [${args.id}] ${el.tagName.toLowerCase()} "${getVisibleText(el).slice(0, 40)}"`,
    navigated: willNavigate,
  };
}

/**
 * Use the native prototype value setter to bypass React/Vue controlled input interception.
 * Frameworks override the `value` property on instances; calling the prototype setter
 * triggers the internal [[Set]] without the framework's getter/setter interference.
 */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
}

function executeType(args: TypeTextArgs): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  const tagMap = getTagMap();
  const el = tagMap.get(args.id);
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
      result: `Element [${args.id}] is not a text input`,
      navigated: false,
    };
  }

  // Focus the element
  if (el instanceof HTMLElement) el.focus();

  // Clear existing value using native setter
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    setNativeValue(el, "");
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
  }

  // Type character by character for SPA frameworks that listen to input events
  for (const char of args.text) {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: char, bubbles: true }),
    );
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      setNativeValue(el, el.value + char);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: char, inputType: "insertText" }));
    } else if ((el as HTMLElement).isContentEditable) {
      (el as HTMLElement).textContent = ((el as HTMLElement).textContent || "") + char;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: char, inputType: "insertText" }));
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
    result: `Typed "${args.text}" into [${args.id}]${args.pressEnter ? " and pressed Enter" : ""}`,
    navigated,
  };
}

function executeScroll(args: ScrollPageArgs): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  const amount = args.amount ?? 500;
  const isAbsolute =
    args.direction === ScrollDirection.TOP ||
    args.direction === ScrollDirection.BOTTOM;

  if (args.id !== undefined) {
    const tagMap = getTagMap();
    const el = tagMap.get(args.id);
    if (!el) {
      return staleIdError(args.id);
    }
    if (!(el instanceof HTMLElement)) {
      return {
        success: false,
        result: `Element [${args.id}] is not scrollable`,
        navigated: false,
      };
    }
    switch (args.direction) {
      case ScrollDirection.TOP:
        el.scrollTo({ top: 0, behavior: "instant" });
        break;
      case ScrollDirection.BOTTOM:
        el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
        break;
      case ScrollDirection.UP:
        el.scrollBy({ top: -amount, behavior: "instant" });
        break;
      case ScrollDirection.DOWN:
        el.scrollBy({ top: amount, behavior: "instant" });
        break;
    }
    return {
      success: true,
      result: isAbsolute
        ? `Scrolled [${args.id}] to ${args.direction}. Position: ${el.scrollTop}/${el.scrollHeight - el.clientHeight}`
        : `Scrolled [${args.id}] ${args.direction} by ${amount}px. Position: ${el.scrollTop}/${el.scrollHeight - el.clientHeight}`,
      navigated: false,
    };
  }

  switch (args.direction) {
    case ScrollDirection.TOP:
      window.scrollTo({ top: 0, behavior: "instant" });
      break;
    case ScrollDirection.BOTTOM:
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: "instant",
      });
      break;
    case ScrollDirection.UP:
      window.scrollBy({ top: -amount, behavior: "instant" });
      break;
    case ScrollDirection.DOWN:
      window.scrollBy({ top: amount, behavior: "instant" });
      break;
  }

  return {
    success: true,
    result: isAbsolute
      ? `Scrolled to ${args.direction}. New position: ${window.scrollY}/${document.documentElement.scrollHeight - window.innerHeight}`
      : `Scrolled ${args.direction} by ${amount}px. New position: ${window.scrollY}/${document.documentElement.scrollHeight - window.innerHeight}`,
    navigated: false,
  };
}

function executeRead(): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  const snapshot = buildSnapshot(true, true);

  // Format for the LLM
  const lines: string[] = [
    `Page: ${snapshot.title}`,
    `URL: ${snapshot.url}`,
    `Scroll: ${snapshot.scroll.y}/${snapshot.scroll.maxY}`,
    "",
    "Interactive elements:",
  ];

  for (const el of snapshot.elements) {
    const attrs = Object.entries(el.attributes)
      .map(([k, v]) => `${k}="${v}"`)
      .join(" ");
    lines.push(
      `  [${el.tag}] <${el.tagName}${attrs ? " " + attrs : ""}> "${el.text}"`,
    );
  }

  if (snapshot.viewportText) {
    lines.push("", "Page text:", snapshot.viewportText);
  }

  return {
    success: true,
    result: lines.join("\n"),
    navigated: false,
  };
}

function executeHover(args: { id: number }): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  const tagMap = getTagMap();
  const el = tagMap.get(args.id);
  if (!el) return staleIdError(args.id);

  el.scrollIntoView({ behavior: "instant", block: "center" });
  el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));

  return {
    success: true,
    result: `Hovered over element [${args.id}]`,
    navigated: false,
  };
}

function executeFindElement(args: { text: string }): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  const found = (window as any).find(args.text);
  if (!found) {
    return {
      success: false,
      result: `Text "${args.text}" not found on this page`,
      navigated: false,
    };
  }

  // Locate the DOM node via the selection created by window.find()
  const sel = window.getSelection();
  const anchorNode = sel?.anchorNode;

  // Clear selection to avoid visual artifacts
  sel?.removeAllRanges();

  if (!anchorNode) {
    return {
      success: true,
      result: `Found "${args.text}" but could not locate its DOM node`,
      navigated: false,
    };
  }

  // Walk up from the text node to find the nearest interactive or semantic container
  const INTERACTIVE =
    "a[href],button,input,textarea,select,[role='button'],[role='link'],[role='tab'],[contenteditable='true']";
  const SEMANTIC_TAGS = new Set([
    "p",
    "li",
    "td",
    "th",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "form",
    "label",
    "figcaption",
    "blockquote",
    "summary",
    "dt",
    "dd",
  ]);

  let target: Element | null =
    anchorNode.nodeType === Node.ELEMENT_NODE
      ? (anchorNode as Element)
      : anchorNode.parentElement;

  let matched: Element | null = null;
  while (target && target !== document.body) {
    if (target.matches(INTERACTIVE)) {
      matched = target;
      break;
    }
    if (SEMANTIC_TAGS.has(target.tagName.toLowerCase())) {
      matched = target;
      break;
    }
    target = target.parentElement;
  }

  // Fallback: use the direct parent element
  if (!matched) {
    matched =
      anchorNode.nodeType === Node.ELEMENT_NODE
        ? (anchorNode as Element)
        : anchorNode.parentElement;
  }

  if (!matched) {
    return {
      success: true,
      result: `Found "${args.text}" but could not locate a container element`,
      navigated: false,
    };
  }

  // Drill down: if matched is a non-interactive container (p, form, div, etc.),
  // check for a more specific interactive or cursor:pointer child containing the text
  if (!matched.matches(INTERACTIVE)) {
    const searchText = args.text.toLowerCase();
    // For form containers, prefer the input element directly
    if (matched.tagName === "FORM") {
      const formInput = matched.querySelector("input,textarea,select");
      if (formInput) {
        matched = formInput;
      }
    } else {
      // Check all interactive children for one containing the text
      const interactiveChildren = matched.querySelectorAll(INTERACTIVE);
      let found = false;
      for (const child of interactiveChildren) {
        if (child.textContent?.toLowerCase().includes(searchText)) {
          matched = child;
          found = true;
          break;
        }
      }
      if (!found) {
        // Fallback: cursor:pointer children containing the text
        const children = matched.querySelectorAll("*");
        for (const child of children) {
          if (!child.textContent?.toLowerCase().includes(searchText)) continue;
          try {
            const style = window.getComputedStyle(child);
            if (style.cursor === "pointer") {
              matched = child;
              found = true;
              break;
            }
          } catch {
            // getComputedStyle can fail
          }
        }
        // Last resort: if only one interactive child, use it
        if (!found && interactiveChildren.length === 1) {
          matched = interactiveChildren[0];
        }
      }
    }
  }

  // Scroll the found element into view
  matched.scrollIntoView({ behavior: "instant", block: "center" });

  // Assign a tag ID for interaction
  const tagId = addDynamicTag(matched);
  const tagName = matched.tagName.toLowerCase();
  const context = truncateText(getVisibleText(matched), 50);

  return {
    success: true,
    result: `Found "${args.text}" near [${tagId}] <${tagName}> "${context}". Use tag [${tagId}] to interact with it.`,
    navigated: false,
  };
}

function executeSelectOption(args: SelectOptionArgs): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  const tagMap = getTagMap();
  const el = tagMap.get(args.id);
  if (!el) {
    return staleIdError(args.id);
  }

  if (!(el instanceof HTMLSelectElement)) {
    return {
      success: false,
      result: `Element [${args.id}] is not a <select> element`,
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
      result: `No option matching "${args.value}" in [${args.id}]. Available options: ${available}`,
      navigated: false,
    };
  }

  // Set the value and dispatch change event
  el.value = match.value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("input", { bubbles: true }));

  return {
    success: true,
    result: `Selected "${match.textContent?.trim()}" in [${args.id}]`,
    navigated: false,
  };
}

function executePressKey(args: PressKeyArgs): {
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

  window.dispatchEvent(new KeyboardEvent("keydown", opts));
  window.dispatchEvent(new KeyboardEvent("keyup", opts));

  const modStr = modifiers.length > 0 ? ` (${modifiers.join("+")})` : "";
  return {
    success: true,
    result: `Pressed key "${args.key}"${modStr}`,
    navigated: false,
  };
}

function executeDragAndDrop(args: DragAndDropArgs): {
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

function executeDrawStroke(args: DrawStrokeArgs): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  const tagMap = getTagMap();
  const el = tagMap.get(args.id);
  if (!el) {
    return staleIdError(args.id);
  }

  el.scrollIntoView({ behavior: "instant", block: "center" });
  const rect = el.getBoundingClientRect();

  const toClient = (offX: number, offY: number) => ({
    clientX: rect.left + offX,
    clientY: rect.top + offY,
  });

  const STEPS = 10;
  const start = toClient(args.startX, args.startY);

  el.dispatchEvent(
    new MouseEvent("mousedown", { ...start, bubbles: true, cancelable: true }),
  );

  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    const pt = toClient(
      args.startX + (args.endX - args.startX) * t,
      args.startY + (args.endY - args.startY) * t,
    );
    el.dispatchEvent(
      new MouseEvent("mousemove", { ...pt, bubbles: true, cancelable: true }),
    );
  }

  const end = toClient(args.endX, args.endY);
  el.dispatchEvent(
    new MouseEvent("mouseup", { ...end, bubbles: true, cancelable: true }),
  );

  return {
    success: true,
    result: `Drew stroke on [${args.id}] from (${args.startX},${args.startY}) to (${args.endX},${args.endY})`,
    navigated: false,
  };
}

/**
 * Walk up from an element to find the nearest overlay ancestor.
 * Used by executeHideElement to support hiding modals via their child elements.
 */
function findOverlayAncestor(el: HTMLElement, maxDepth = 8): HTMLElement | null {
  let current = el.parentElement;
  let depth = 0;
  while (current && current !== document.body && current !== document.documentElement && depth < maxDepth) {
    if (isLikelyOverlay(current)) return current;
    current = current.parentElement;
    depth++;
  }
  return null;
}

function executeHideElement(args: HideElementArgs): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  const tagMap = getTagMap();
  const el = tagMap.get(args.id);
  if (!el) {
    return staleIdError(args.id);
  }
  if (!(el instanceof HTMLElement)) {
    return {
      success: false,
      result: `Element [${args.id}] is not an HTMLElement`,
      navigated: false,
    };
  }

  let target = el;
  let ancestorUsed = false;

  if (!isLikelyOverlay(el)) {
    // Walk up to find overlay ancestor
    const ancestor = findOverlayAncestor(el);
    if (!ancestor) {
      return {
        success: false,
        result: `Element [${args.id}] <${el.tagName.toLowerCase()}> is not an overlay and has no overlay ancestor. Try press_key("Escape") or click a close button.`,
        navigated: false,
      };
    }
    target = ancestor;
    ancestorUsed = true;
  }

  target.style.display = "none";

  // Restore body overflow if modal set it
  const bodyStyle = window.getComputedStyle(document.body);
  if (bodyStyle.overflow === "hidden") {
    document.body.style.overflow = "";
  }

  const targetTag = ancestorUsed ? addDynamicTag(target) : args.id;
  const msg = ancestorUsed
    ? `Hidden overlay ancestor [${targetTag}] <${target.tagName.toLowerCase()}> (parent of [${args.id}])`
    : `Hidden element [${args.id}] <${target.tagName.toLowerCase()}>`;

  return { success: true, result: msg, navigated: false };
}

function executeReadElement(args: ReadElementArgs): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  const tagMap = getTagMap();
  const el = tagMap.get(args.id);
  if (!el) {
    return staleIdError(args.id);
  }

  if (args.attribute) {
    const value = el.getAttribute(args.attribute);
    if (value === null) {
      const available = Array.from(el.attributes)
        .map((a) => a.name)
        .join(", ");
      return {
        success: false,
        result: `Element [${args.id}] has no attribute "${args.attribute}". Available: ${available || "(none)"}`,
        navigated: false,
      };
    }
    return {
      success: true,
      result: truncateText(value, 2000),
      navigated: false,
    };
  }

  const text = el.textContent || "";
  return {
    success: true,
    result: truncateText(text, 2000),
    navigated: false,
  };
}

function executeRightClick(args: RightClickArgs): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  const tagMap = getTagMap();
  const el = tagMap.get(args.id);
  if (!el) {
    return staleIdError(args.id);
  }

  el.scrollIntoView({ behavior: "instant", block: "center" });
  el.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
  );

  return {
    success: true,
    result: `Right-clicked element [${args.id}]`,
    navigated: false,
  };
}

function executeSetCheckbox(args: SetCheckboxArgs): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  const tagMap = getTagMap();
  const el = tagMap.get(args.id);
  if (!el) {
    return staleIdError(args.id);
  }

  if (
    !(el instanceof HTMLInputElement) ||
    (el.type !== "checkbox" && el.type !== "radio")
  ) {
    return {
      success: false,
      result: `Element [${args.id}] is not a checkbox or radio input`,
      navigated: false,
    };
  }

  el.checked = args.checked;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));

  return {
    success: true,
    result: `Set [${args.id}] checked=${args.checked}`,
    navigated: false,
  };
}

function executeClickCoordinates(args: ClickCoordinatesArgs): {
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

function executeUploadFile(args: Record<string, unknown>): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  const tagMap = getTagMap();
  const el = tagMap.get(args.id as number);
  if (!el) {
    return staleIdError(args.id);
  }

  if (!(el instanceof HTMLInputElement) || el.type !== "file") {
    return {
      success: false,
      result: `Element [${args.id}] is not a file input`,
      navigated: false,
    };
  }

  // Args contain pre-processed file data from the service worker
  const data = args.data as string; // base64-encoded
  const filename = args.filename as string;
  const mimeType = args.mimeType as string;

  try {
    const byteChars = atob(data);
    const byteArray = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteArray[i] = byteChars.charCodeAt(i);
    }

    const file = new File([byteArray], filename, { type: mimeType });
    const dt = new DataTransfer();
    dt.items.add(file);
    el.files = dt.files;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("input", { bubbles: true }));

    return {
      success: true,
      result: `Uploaded "${filename}" (${byteArray.length} bytes) to [${args.id}]`,
      navigated: false,
    };
  } catch (e: any) {
    return {
      success: false,
      result: `Failed to set file on [${args.id}]: ${e.message}`,
      navigated: false,
    };
  }
}
