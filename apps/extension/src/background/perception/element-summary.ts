/**
 * Compact text summary of a page's tagged elements (model-free).
 *
 * Formerly part of the perception layer's prompt building; after the perception
 * seat was removed this is the only survivor — a pure DOM→text grounding
 * summary the executor reads on text-only turns. No model is involved.
 */

import type { TaggedElement, PageSkeletonNode } from "../../types";

/** Format skeleton nodes into a compact "Page structure:" block. */
function formatSkeletonForPerception(skeleton: PageSkeletonNode[]): string {
  const lines = skeleton.map((n) => {
    const indent = "  ".repeat(Math.min(n.depth, 4));
    return `${indent}${n.tagName} "${n.text}"`;
  });
  return "Page structure:\n" + lines.join("\n");
}

/** Build a compact element summary (grounding hints) from tagged elements. */
export function buildElementSummary(
  elements: TaggedElement[],
  skeleton?: PageSkeletonNode[],
  viewport?: { height: number; scrollY: number },
): string {
  const counts: Record<string, number> = {};
  for (const el of elements) {
    const category = ["input", "textarea", "select"].includes(el.tagName)
      ? "input"
      : el.tagName === "button" || el.role === "button"
        ? "button"
        : el.tagName === "a" || el.role === "link"
          ? "link"
          : "other";
    counts[category] = (counts[category] || 0) + 1;
  }

  const parts: string[] = [];
  if (counts.input) parts.push(`${counts.input} inputs`);
  if (counts.button) parts.push(`${counts.button} buttons`);
  if (counts.link) parts.push(`${counts.link} links`);
  if (counts.other) parts.push(`${counts.other} other`);

  const lines: string[] = [];
  const VAGUE_CTA =
    /^(click\s*(me|here)|press\s*(me|here)|go|submit|ok|yes|no)$/i;
  const textCounts: Record<string, number> = {};

  const candidateElements = [...elements]
    .sort((a, b) => scoreElementForGrounding(b) - scoreElementForGrounding(a))
    .slice(0, 36);

  for (const el of candidateElements) {
    const text = el.text;
    lines.push(formatElementForGrounding(el, viewport));

    const normalized = text.trim().toLowerCase();
    if (normalized && VAGUE_CTA.test(normalized)) {
      textCounts[normalized] = (textCounts[normalized] || 0) + 1;
    }
  }

  const suspicious: string[] = [];
  for (const [text, count] of Object.entries(textCounts)) {
    if (count >= 3) suspicious.push(`${count}x "${text}"`);
  }

  let summary = "";
  if (skeleton && skeleton.length > 0) {
    summary += formatSkeletonForPerception(skeleton) + "\n\n";
  }
  summary += `${elements.length} interactive (${parts.join(", ")})`;
  if (lines.length > 0) {
    summary += `\nAction candidates (prioritized):\n${lines.join("\n")}`;
  }
  if (suspicious.length > 0) {
    summary += `\n⚠ Suspicious duplicates: ${suspicious.join(", ")}`;
  }
  return summary;
}

function scoreElementForGrounding(el: TaggedElement): number {
  let score = 0;
  const tag = el.tagName.toLowerCase();
  const type = (el.attributes.type || "").toLowerCase();

  if (["input", "textarea", "select"].includes(tag)) score += 120;
  if (tag === "button" || el.role === "button") score += 140;
  if (tag === "a" || el.role === "link") score += 70;
  if (["submit", "button", "radio", "checkbox"].includes(type)) score += 50;
  if (el.isVisible) score += 40;
  if (!el.isDisabled) score += 15;

  const text = el.text.trim();
  if (text.length > 0) score += Math.min(text.length, 40) / 4;

  const area = Math.max(0, (el.rect?.width || 0) * (el.rect?.height || 0));
  score += Math.min(area, 20_000) / 2_000;

  return score;
}

function formatElementForGrounding(
  el: TaggedElement,
  viewport?: { height: number; scrollY: number },
): string {
  const tag = el.tagName.toLowerCase();
  const role = el.role ? ` role=${el.role}` : "";
  const type = el.attributes.type ? ` type=${el.attributes.type}` : "";
  const text = el.text ? ` "${el.text}"` : "";
  const disabled = el.isDisabled ? " disabled" : "";

  let position = "";
  if (el.rect) {
    const x = Math.round(el.rect.x);
    const y = Math.round(el.rect.y);
    const width = Math.round(el.rect.width);
    const height = Math.round(el.rect.height);

    if (viewport && (y < 0 || y >= viewport.height)) {
      const offscreen =
        el.rect.pageY != null
          ? `pageY=${Math.round(el.rect.pageY)}`
          : y < 0
            ? "above-fold"
            : "below-fold";
      position = ` @offscreen(${offscreen})`;
    } else {
      position = ` @box(${x},${y} ${width}x${height})`;
    }
  }

  // LP-10: `*` marks elements that appeared since the previous snapshot.
  return `${el.isNew ? "*" : ""}[${el.tag}] ${tag}${role}${type}${text}${position}${disabled}`;
}
