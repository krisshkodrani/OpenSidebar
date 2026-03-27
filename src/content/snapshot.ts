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
import { detectFramework } from "./framework-detect";

export function buildSnapshot(
  refresh: boolean,
): DomSnapshot {
  const elements = refresh ? tagElements() : getCachedElements();

  const overflow = getOverflowMetadata();

  // Detect page language and text direction from <html> attributes
  const htmlLang = document.documentElement.lang?.split("-")[0]?.toLowerCase();
  const htmlDir = document.documentElement.dir?.toLowerCase();

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

  // Add language info when present and non-English
  if (htmlLang && htmlLang !== "en") {
    snapshot.lang = htmlLang;
  }
  if (htmlDir === "rtl") {
    snapshot.dir = "rtl";
  }

  if (overflow) {
    snapshot.overflow = overflow;
  }

  // Include detected SPA framework for diagnostics and heuristics
  const framework = detectFramework();
  if (framework !== "unknown") {
    snapshot.framework = framework;
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
