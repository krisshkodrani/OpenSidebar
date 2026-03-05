/**
 * Inspection actions - scroll, read page, find element, read element
 */

import {
  ScrollPageArgs,
  ScrollDirection,
  ReadElementArgs,
} from "../../types";
import {
  getTagMap,
  getVisibleText,
  addDynamicTag,
  truncateText,
} from "../tagging";
import { buildSnapshot } from "../snapshot";
import { staleIdError, describeElement } from "./helpers";

export function executeScroll(args: ScrollPageArgs): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  // Validate: need either y or direction
  if (args.y == null && args.direction == null) {
    return {
      success: false,
      result: "Error: scroll_page requires either 'y' (absolute position) or 'direction'.",
      navigated: false,
    };
  }

  // Absolute Y scroll (from @y hints)
  if (args.y != null) {
    if (args.id !== undefined) {
      const tagMap = getTagMap();
      const el = tagMap.get(args.id);
      if (!el) return staleIdError(args.id);
      if (!(el instanceof HTMLElement)) {
        return { success: false, result: `Element [${args.id}] is not scrollable`, navigated: false };
      }
      el.scrollTo({ top: args.y, behavior: "instant" });
      return {
        success: true,
        result: `Scrolled [${args.id}] to y=${args.y}. Position: ${el.scrollTop}/${el.scrollHeight - el.clientHeight}`,
        navigated: false,
      };
    }
    window.scrollTo({ top: args.y, behavior: "instant" });
    return {
      success: true,
      result: `Scrolled to y=${args.y}. New position: ${window.scrollY}/${document.documentElement.scrollHeight - window.innerHeight}`,
      navigated: false,
    };
  }

  // Direction-based scroll (original behavior)
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

export function executeRead(): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  const snapshot = buildSnapshot(true);

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

  if (snapshot.pageContent) {
    lines.push("", "Page content:", snapshot.pageContent);
  }

  return {
    success: true,
    result: lines.join("\n"),
    navigated: false,
  };
}

export function executeFindElement(args: { text: string }): {
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

export function executeReadElement(args: ReadElementArgs): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  const tagMap = getTagMap();
  const el = tagMap.get(args.id);
  if (!el) {
    return staleIdError(args.id);
  }

  if (el instanceof HTMLElement) {
    el.scrollIntoView({ behavior: "instant", block: "center" });
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
    const desc = describeElement(el, args.id);
    return {
      success: true,
      result: `${desc} ${args.attribute}="${truncateText(value, 2000)}"`,
      navigated: false,
    };
  }

  const desc = describeElement(el, args.id);
  const text = el.textContent || "";
  return {
    success: true,
    result: `${desc}: ${truncateText(text, 2000)}`,
    navigated: false,
  };
}
