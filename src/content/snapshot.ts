/**
 * Snapshot - DOM distillation for LLM context
 *
 * Responsibilities:
 * - Build DOM snapshot with tagged elements
 * - Capture scroll position and viewport dimensions
 * - Detect surviving overlays that block interaction
 *
 * The snapshot provides a condensed view of the page for the agent,
 * including interactive elements with numeric tags.
 */

import { DomSnapshot } from "../types";
import { tagElements, getCachedElements, getOverflowMetadata } from "./tagging";

export function buildSnapshot(
  refresh: boolean,
  showTags: boolean = false,
): DomSnapshot {
  const elements = refresh ? tagElements(showTags) : getCachedElements();

  const overflow = getOverflowMetadata();

  const snapshot: DomSnapshot = {
    title: document.title,
    url: window.location.href,
    elements,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    scroll: {
      x: window.scrollX,
      y: window.scrollY,
      maxY: document.documentElement.scrollHeight - window.innerHeight,
    },
  };

  if (overflow) {
    snapshot.overflow = overflow;
  }

  return snapshot;
}
