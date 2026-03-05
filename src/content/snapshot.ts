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
import { tagElements, getCachedElements, getOverflowMetadata, extractPageSkeleton } from "./tagging";
import { extractPageContent, extractVisibleText } from "./readability";

export function buildSnapshot(
  refresh: boolean,
): DomSnapshot {
  const elements = refresh ? tagElements() : getCachedElements();

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
      viewportHeight: window.innerHeight,
    },
  };

  if (overflow) {
    snapshot.overflow = overflow;
  }

  // Extract page skeleton (headings, landmarks, status, text) on refresh
  if (refresh) {
    const interactiveTexts = new Set<string>(
      elements.map((el) => el.text.trim()).filter(Boolean),
    );
    const skeleton = extractPageSkeleton(interactiveTexts);
    if (skeleton.length > 0) {
      snapshot.skeleton = skeleton;
    }
  }

  // DOM distillation: Readability + Turndown → Markdown, fallback to visible text
  if (refresh) {
    const markdown = extractPageContent();
    if (markdown && markdown.length > 50) {
      snapshot.pageContent = markdown;
    } else {
      const plainText = extractVisibleText();
      if (plainText.length > 50) {
        snapshot.pageContent = plainText;
      }
    }
  }

  return snapshot;
}
