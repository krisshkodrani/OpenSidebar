/**
 * Inspection actions - scroll, read page, find element, read element
 */

import {
  ScrollPageArgs,
  ScrollDirection,
  ReadElementArgs,
  ExtractFormStateArgs,
  FormStateCapture,
  FormStateField,
} from "../../types";
import {
  getVisibleText,
  getControlLabel,
  addDynamicTag,
  truncateText,
  querySelectorAllDeep,
  INTERACTIVE_SELECTORS,
  isElementVisible,
  isComboboxLikeElement,
  readComboboxCommittedValue,
} from "../tagging";
import { buildSnapshot } from "../snapshot";
import {
  staleIdError,
  describeElement,
  getTaggedElement,
  normalizeTagId,
} from "./helpers";
import {
  isHtmlElement,
  isInputElement,
  isSelectElement,
  isTextAreaElement,
} from "../dom-guards";

function readFormControlValue(el: Element): string | null {
  if (isInputElement(el) || isTextAreaElement(el) || isSelectElement(el)) {
    // Custom-select comboboxes (react-select-style) clear their inner input on
    // commit; the committed value lives in a sibling display node. Without this
    // fallback, read_element / extract_form_state report a successfully
    // selected combobox as empty — which sent the agent into retry loops.
    if (!el.value && isInputElement(el) && isComboboxLikeElement(el)) {
      const committed = readComboboxCommittedValue(el);
      if (committed) return committed;
    }
    return el.value;
  }
  if (isComboboxLikeElement(el)) {
    return readComboboxCommittedValue(el);
  }
  return null;
}

function getWindowMaxScroll(): number {
  return Math.max(
    0,
    document.documentElement.scrollHeight - window.innerHeight,
  );
}

function describeScrollContainer(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const className =
    typeof el.className === "string" && el.className.trim()
      ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}`
      : "";
  const label =
    el.getAttribute("aria-label") ||
    el.getAttribute("role") ||
    getVisibleText(el).slice(0, 40);
  return `${tag}${id}${className}${label ? ` "${label}"` : ""}`.slice(0, 120);
}

function canScrollContainer(
  el: HTMLElement,
  direction: ScrollDirection | undefined,
): boolean {
  const maxScroll = el.scrollHeight - el.clientHeight;
  if (maxScroll <= 1) return false;
  if (direction === ScrollDirection.UP || direction === ScrollDirection.TOP) {
    return el.scrollTop > 1;
  }
  return el.scrollTop < maxScroll - 1;
}

function findBestScrollableContainer(
  direction: ScrollDirection | undefined,
): HTMLElement | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>("body *"),
  );
  let best: { el: HTMLElement; score: number } | null = null;

  for (const el of candidates) {
    if (!isHtmlElement(el) || !canScrollContainer(el, direction)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (
      rect.bottom < 0 ||
      rect.top > window.innerHeight ||
      rect.right < 0 ||
      rect.left > window.innerWidth
    ) {
      continue;
    }

    const style = window.getComputedStyle(el);
    const overflow = `${style.overflowY} ${style.overflow}`.toLowerCase();
    const overflowScore = /\b(auto|scroll)\b/.test(overflow) ? 2 : 1;
    const visibleHeight =
      Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
    const score =
      (el.scrollHeight - el.clientHeight) * overflowScore +
      Math.max(0, visibleHeight);
    if (!best || score > best.score) {
      best = { el, score };
    }
  }

  return best?.el ?? null;
}

function scrollContainer(
  el: HTMLElement,
  direction: ScrollDirection | undefined,
  amount: number,
): string {
  const maxScroll = el.scrollHeight - el.clientHeight;
  switch (direction) {
    case ScrollDirection.TOP:
      el.scrollTop = 0;
      break;
    case ScrollDirection.BOTTOM:
      el.scrollTop = maxScroll;
      break;
    case ScrollDirection.UP:
      el.scrollTop = Math.max(0, el.scrollTop - amount);
      break;
    case ScrollDirection.DOWN:
    default:
      el.scrollTop = Math.min(maxScroll, el.scrollTop + amount);
      break;
  }
  return `Scrolled nested container ${describeScrollContainer(el)} ${direction ?? "down"}. Position: ${el.scrollTop}/${maxScroll}`;
}

export function executeScroll(args: ScrollPageArgs): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  // Validate: need either y or direction
  if (args.y == null && args.direction == null) {
    return {
      success: false,
      result:
        "Error: scroll_page requires either 'y' (absolute position) or 'direction'.",
      navigated: false,
    };
  }

  // Absolute Y scroll (from @y hints)
  if (args.y != null) {
    if (args.id !== undefined) {
      const tagId = normalizeTagId(args.id);
      const el = getTaggedElement(args.id);
      if (!el) return staleIdError(args.id);
      if (!isHtmlElement(el)) {
        return {
          success: false,
          result: `Element [${tagId}] is not scrollable`,
          navigated: false,
        };
      }
      el.scrollTo({ top: args.y, behavior: "instant" });
      return {
        success: true,
        result: `Scrolled [${tagId}] to y=${args.y}. Position: ${el.scrollTop}/${el.scrollHeight - el.clientHeight}`,
        navigated: false,
      };
    }
    const beforeY = window.scrollY;
    window.scrollTo({ top: args.y, behavior: "instant" });
    if (getWindowMaxScroll() <= 0 || window.scrollY === beforeY) {
      const nested = findBestScrollableContainer(
        args.y > 0 ? ScrollDirection.DOWN : ScrollDirection.TOP,
      );
      if (nested) {
        nested.scrollTop = Math.min(
          Math.max(0, args.y),
          nested.scrollHeight - nested.clientHeight,
        );
        return {
          success: true,
          result: `Scrolled nested container ${describeScrollContainer(nested)} to y=${args.y}. Position: ${nested.scrollTop}/${nested.scrollHeight - nested.clientHeight}`,
          navigated: false,
        };
      }
    }
    return {
      success: true,
      result: `Scrolled to y=${args.y}. New position: ${window.scrollY}/${getWindowMaxScroll()}`,
      navigated: false,
    };
  }

  // Direction-based scroll (original behavior)
  const amount = args.amount ?? 500;
  const isAbsolute =
    args.direction === ScrollDirection.TOP ||
    args.direction === ScrollDirection.BOTTOM;

  if (args.id !== undefined) {
    const tagId = normalizeTagId(args.id);
    const el = getTaggedElement(args.id);
    if (!el) {
      return staleIdError(args.id);
    }
    if (!isHtmlElement(el)) {
      return {
        success: false,
        result: `Element [${tagId}] is not scrollable`,
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
    const maxScroll = el.scrollHeight - el.clientHeight;
    const notScrollable = maxScroll <= 0;
    const posInfo = `Position: ${el.scrollTop}/${maxScroll}`;
    const scrollHint = notScrollable
      ? ` (Element [${tagId}] has no overflow — try scroll_page(direction="${args.direction}") without an id to scroll the page instead.)`
      : "";
    return {
      success: true,
      result: isAbsolute
        ? `Scrolled [${tagId}] to ${args.direction}. ${posInfo}${scrollHint}`
        : `Scrolled [${tagId}] ${args.direction} by ${amount}px. ${posInfo}${scrollHint}`,
      navigated: false,
    };
  }

  const beforeY = window.scrollY;
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

  const windowMaxScroll = getWindowMaxScroll();
  const windowDidNotMove = window.scrollY === beforeY;
  if (
    (windowMaxScroll <= 0 || windowDidNotMove) &&
    args.direction !== ScrollDirection.TOP
  ) {
    const nested = findBestScrollableContainer(args.direction);
    if (nested) {
      return {
        success: true,
        result: scrollContainer(nested, args.direction, amount),
        navigated: false,
      };
    }
  }

  return {
    success: true,
    result: isAbsolute
      ? `Scrolled to ${args.direction}. New position: ${window.scrollY}/${windowMaxScroll}`
      : `Scrolled ${args.direction} by ${amount}px. New position: ${window.scrollY}/${windowMaxScroll}`,
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

export function executeFindElement(args: {
  text: string;
  searchText?: string;
}): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  // LLMs sometimes hallucinate "searchText" instead of "text"
  const query = args.text || args.searchText;
  if (!query) {
    return {
      success: false,
      result: 'Missing "text" parameter — provide the text to search for.',
      navigated: false,
    };
  }
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

  const isBadFindTarget = (el: Element | null): boolean => {
    if (!el) return true;
    const tag = el.tagName.toLowerCase();
    return (
      tag === "body" || tag === "html" || tag === "script" || tag === "style"
    );
  };

  const candidateText = (el: Element): string => {
    const parts = [
      getVisibleText(el),
      el.getAttribute("aria-label"),
      el.getAttribute("placeholder"),
      el.getAttribute("title"),
      el.getAttribute("name"),
      el.getAttribute("value"),
      el.getAttribute("role"),
    ];

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      for (const refId of labelledBy.split(/\s+/)) {
        const ref = document.getElementById(refId);
        if (ref?.textContent) parts.push(ref.textContent);
      }
    }

    return parts.filter(Boolean).join(" ").trim();
  };

  const promoteTextMatchTarget = (
    el: Element,
    normalizedQuery: string,
  ): Element => {
    const actionableAncestor = el.closest(
      [
        INTERACTIVE_SELECTORS,
        "[role='option']",
        "[role='row']",
        "[role='gridcell']",
        "[role='menuitem']",
        "[role='listitem']",
        "li",
        "tr",
        "td",
      ].join(","),
    );
    if (
      actionableAncestor &&
      candidateText(actionableAncestor).toLowerCase().includes(normalizedQuery)
    ) {
      return actionableAncestor;
    }
    return el;
  };

  const findDeepTextMatch = (): Element | null => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return null;

    const candidates = querySelectorAllDeep(document, "*").filter((el) => {
      if (isBadFindTarget(el)) return false;
      if (!isElementVisible(el) || el.closest('[aria-hidden="true"]')) {
        return false;
      }
      const haystack = candidateText(el).toLowerCase();
      return haystack.includes(normalizedQuery);
    });

    if (candidates.length === 0) return null;

    return candidates
      .map((candidate) => promoteTextMatchTarget(candidate, normalizedQuery))
      .filter((candidate, index, all) => all.indexOf(candidate) === index)
      .sort((a, b) => {
        const aText = candidateText(a).toLowerCase();
        const bText = candidateText(b).toLowerCase();
        const aExact = aText === normalizedQuery ? 1 : 0;
        const bExact = bText === normalizedQuery ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;

        const aInteractive = a.matches(INTERACTIVE) ? 1 : 0;
        const bInteractive = b.matches(INTERACTIVE) ? 1 : 0;
        if (aInteractive !== bInteractive) return bInteractive - aInteractive;

        const aRole = a.getAttribute("role") ?? "";
        const bRole = b.getAttribute("role") ?? "";
        const aOptionLike = /^(option|row|gridcell|menuitem|listitem)$/.test(
          aRole,
        )
          ? 1
          : 0;
        const bOptionLike = /^(option|row|gridcell|menuitem|listitem)$/.test(
          bRole,
        )
          ? 1
          : 0;
        if (aOptionLike !== bOptionLike) return bOptionLike - aOptionLike;

        return aText.length - bText.length;
      })[0];
  };

  const findDeepInteractiveMatch = (): Element | null => {
    const normalizedQuery = query.trim().toLowerCase();
    const candidates = querySelectorAllDeep(
      document,
      INTERACTIVE_SELECTORS,
    ).filter(
      (el) => isElementVisible(el) && !el.closest('[aria-hidden="true"]'),
    );

    const exactMatches: Element[] = [];
    const partialMatches: Element[] = [];

    for (const candidate of candidates) {
      const haystack = candidateText(candidate);
      if (!haystack) continue;
      const normalized = haystack.toLowerCase();
      if (normalized === normalizedQuery) {
        exactMatches.push(candidate);
      } else if (normalized.includes(normalizedQuery)) {
        partialMatches.push(candidate);
      }
    }

    const matches = exactMatches.length > 0 ? exactMatches : partialMatches;
    if (matches.length === 0) return null;

    return matches.sort((a, b) => {
      const aTag = a.tagName.toLowerCase();
      const bTag = b.tagName.toLowerCase();
      const aInput = aTag === "input" || aTag === "textarea" ? 1 : 0;
      const bInput = bTag === "input" || bTag === "textarea" ? 1 : 0;
      if (aInput !== bInput) return bInput - aInput;
      return candidateText(a).length - candidateText(b).length;
    })[0];
  };

  const returnDeepInteractiveMatch = (): {
    success: boolean;
    result: string;
    navigated: boolean;
  } | null => {
    const matched = findDeepInteractiveMatch() ?? findDeepTextMatch();
    if (!matched) return null;
    if (isHtmlElement(matched)) {
      matched.scrollIntoView({ behavior: "instant", block: "center" });
    }
    const tagId = addDynamicTag(matched);
    const tagName = matched.tagName.toLowerCase();
    const context = truncateText(
      candidateText(matched) || getVisibleText(matched),
      50,
    );
    return {
      success: true,
      result: `Found "${query}" near [${tagId}] <${tagName}> "${context}". Use tag [${tagId}] to interact with it.`,
      navigated: false,
    };
  };

  const found = (window as any).find(query);
  if (!found) {
    const deepMatch = returnDeepInteractiveMatch();
    if (deepMatch) return deepMatch;

    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollHeight = document.documentElement.scrollHeight;
    const clientHeight = window.innerHeight;
    const hasMoreContent = scrollHeight > clientHeight + scrollTop + 50;
    return {
      success: false,
      result: hasMoreContent
        ? `Text "${query}" not found in current viewport. Page is scrollable (${Math.round((scrollTop / (scrollHeight - clientHeight)) * 100)}% scrolled, ${Math.round(scrollTop)}/${scrollHeight - clientHeight}px). Scroll down further, wait 1-2 seconds for lazy content to load, then search again. Repeat until found.`
        : `Text "${query}" not found on this page.`,
      navigated: false,
    };
  }

  // Locate the DOM node via the selection created by window.find()
  const sel = window.getSelection();
  const anchorNode = sel?.anchorNode;

  // Clear selection to avoid visual artifacts
  sel?.removeAllRanges();

  if (!anchorNode) {
    const deepMatch = returnDeepInteractiveMatch();
    return (
      deepMatch ?? {
        success: true,
        result: `Found "${query}" but could not locate its DOM node`,
        navigated: false,
      }
    );
  }

  // Walk up from the text node to find the nearest interactive or semantic container
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

  if (!matched || isBadFindTarget(matched)) {
    const deepMatch = returnDeepInteractiveMatch();
    return (
      deepMatch ?? {
        success: true,
        result: `Found "${query}" but could not locate a container element`,
        navigated: false,
      }
    );
  }

  // Drill down: if matched is a non-interactive container (p, form, div, etc.),
  // check for a more specific interactive or cursor:pointer child containing the text
  if (!matched.matches(INTERACTIVE)) {
    const searchText = query.toLowerCase();
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
    result: `Found "${query}" near [${tagId}] <${tagName}> "${context}". Use tag [${tagId}] to interact with it.`,
    navigated: false,
  };
}

export function executeReadElement(args: ReadElementArgs): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  const tagId = normalizeTagId(args.id);
  const el = getTaggedElement(args.id);
  if (!el) {
    return staleIdError(args.id);
  }

  if (isHtmlElement(el)) {
    el.scrollIntoView({ behavior: "instant", block: "center" });
  }

  if (args.attribute) {
    if (args.attribute.toLowerCase() === "value") {
      const propertyValue = readFormControlValue(el);
      if (propertyValue !== null) {
        const desc = describeElement(el, tagId);
        return {
          success: true,
          result: `${desc} value="${truncateText(propertyValue, 2000)}"`,
          navigated: false,
        };
      }
    }
    const value = el.getAttribute(args.attribute);
    if (value === null) {
      const available = Array.from(el.attributes)
        .map((a) => a.name)
        .join(", ");
      return {
        success: false,
        result: `Element [${tagId}] has no attribute "${args.attribute}". Available: ${available || "(none)"}`,
        navigated: false,
      };
    }
    const desc = describeElement(el, tagId);
    return {
      success: true,
      result: `${desc} ${args.attribute}="${truncateText(value, 2000)}"`,
      navigated: false,
    };
  }

  const desc = describeElement(el, tagId);
  const text = readFormControlValue(el) ?? el.textContent ?? "";
  return {
    success: true,
    result: `${desc}: ${truncateText(text, 2000)}`,
    navigated: false,
  };
}

/** A CSS selector that locates a control: id > [name] > bare tag. */
function buildControlSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const name = el.getAttribute("name");
  if (name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
  return el.tagName.toLowerCase();
}

function captureFormField(el: Element): FormStateField {
  const name =
    el.getAttribute("name") ||
    el.id ||
    el.getAttribute("aria-label") ||
    "";
  // The visible label is what a draft's field expectation is keyed on; a
  // checkbox/radio's `name` is an internal token, so without this the dry-run
  // can't match it and reports a spurious "missing".
  const label = getControlLabel(el);
  const kind =
    isInputElement(el) ? el.type : el.tagName.toLowerCase();
  const disabled =
    isInputElement(el) || isSelectElement(el) || isTextAreaElement(el)
      ? el.disabled
      : false;
  let value: string;
  if (isInputElement(el) && (el.type === "checkbox" || el.type === "radio")) {
    value = el.checked ? "checked" : "unchecked";
  } else {
    value = readFormControlValue(el) ?? "";
  }
  return {
    name,
    ...(label ? { label } : {}),
    selector: buildControlSelector(el),
    kind,
    value,
    disabled,
  };
}

/**
 * extract_form_state (LP-15 Phase 8): capture the current field values +
 * submit targets of a form as structured data, so the dry-run protocol can diff
 * it against the approved draft before a submit. Read-only.
 */
export function executeExtractFormState(args: ExtractFormStateArgs): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  let form: HTMLFormElement | null = null;
  if (args.id != null) {
    const anchor = getTaggedElement(args.id);
    if (anchor && isHtmlElement(anchor)) {
      form = anchor.closest("form");
    }
  }
  if (!form) {
    form = document.querySelector("form");
  }
  const scope: Document | Element = form ?? document;

  const formKey =
    (form?.getAttribute("action") ||
      form?.id ||
      form?.getAttribute("name") ||
      location.pathname) ??
    location.pathname;

  const fields = querySelectorAllDeep(
    scope,
    "input:not([type='hidden']), textarea, select",
  ).map((el) => captureFormField(el));

  const submitTargets = querySelectorAllDeep(
    scope,
    "button[type='submit'], input[type='submit'], input[type='image'], button:not([type])",
  ).map((el) => ({
    label: truncateText(
      (el.textContent || el.getAttribute("value") || "submit").trim(),
      80,
    ),
    selector: buildControlSelector(el),
  }));

  const capture: FormStateCapture = { formKey, fields, submitTargets };
  return { success: true, result: JSON.stringify(capture), navigated: false };
}
