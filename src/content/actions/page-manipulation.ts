/**
 * Page manipulation actions - hide element, upload file
 */

import { HideElementArgs } from "../../types";
import { getVisibleText, addDynamicTag } from "../tagging";
import {
  staleIdError,
  describeElement,
  getTaggedElement,
  isLikelyOverlay,
  normalizeTagId,
} from "./helpers";

/**
 * Walk up from an element to find the nearest overlay ancestor.
 * Used by executeHideElement to support hiding modals via their child elements.
 */
function findOverlayAncestor(
  el: HTMLElement,
  maxDepth = 8,
): HTMLElement | null {
  let current = el.parentElement;
  let depth = 0;
  while (
    current &&
    current !== document.body &&
    current !== document.documentElement &&
    depth < maxDepth
  ) {
    if (isLikelyOverlay(current)) return current;
    current = current.parentElement;
    depth++;
  }
  return null;
}

export function executeHideElement(args: HideElementArgs): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  const tagId = normalizeTagId(args.id);
  const el = getTaggedElement(args.id);
  if (!el) {
    return staleIdError(args.id);
  }
  if (!(el instanceof HTMLElement)) {
    return {
      success: false,
      result: `Element [${tagId}] is not an HTMLElement`,
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
        result: `Element [${tagId}] <${el.tagName.toLowerCase()}> is not an overlay and has no overlay ancestor. Try press_key("Escape") or click a close button.`,
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

  const targetTag = ancestorUsed ? addDynamicTag(target) : tagId;
  const targetText = getVisibleText(target).slice(0, 40);
  const textSnippet = targetText ? ` "${targetText}"` : "";
  const msg = ancestorUsed
    ? `Hidden overlay ancestor [${targetTag}] <${target.tagName.toLowerCase()}>${textSnippet} (parent of [${tagId}])`
    : `Hidden element [${tagId}] <${target.tagName.toLowerCase()}>${textSnippet}`;

  return { success: true, result: msg, navigated: false };
}

export function executeUploadFile(args: Record<string, unknown>): {
  success: boolean;
  result: string;
  navigated: boolean;
} {
  const tagId = normalizeTagId(args.id);
  const el = getTaggedElement(args.id);
  if (!el) {
    return staleIdError(args.id);
  }

  if (!(el instanceof HTMLInputElement) || el.type !== "file") {
    return {
      success: false,
      result: `Element [${tagId}] is not a file input`,
      navigated: false,
    };
  }

  el.scrollIntoView({ behavior: "instant", block: "center" });

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
      result: `Uploaded "${filename}" (${byteArray.length} bytes) to ${describeElement(el, tagId)}`,
      navigated: false,
    };
  } catch (e: any) {
    return {
      success: false,
      result: `Failed to set file on [${tagId}]: ${e.message}`,
      navigated: false,
    };
  }
}
