/**
 * Context formatting - element formatting, snapshot serialization, history summarization
 */

import { TaggedElement } from "../../types";
import { LLMMessage } from "../llm/types";

/**
 * Format a single element in compact notation.
 * [N] tagName#id key=val key="multi word" "text" (role) [position hint]
 *
 * Position hints (when viewportHeight is provided):
 * - No annotation: element is in the current viewport
 * - `^above`: element is above the viewport
 * - `v{N}px`: element is below the viewport by N pixels
 */
export function formatElementCompact(
  el: TaggedElement,
  text: string,
  attrFilter: ((k: string) => boolean) | null,
  viewportHeight?: number,
): string {
  const idVal = el.attributes.id;
  const head = idVal ? `${el.tagName}#${idVal}` : el.tagName;

  const attrParts: string[] = [];
  for (const [k, v] of Object.entries(el.attributes)) {
    if (k === "id") continue;
    if (attrFilter && !attrFilter(k)) continue;
    attrParts.push(v.includes(" ") ? `${k}="${v}"` : `${k}=${v}`);
  }

  const role = el.role && el.role !== el.tagName ? ` (${el.role})` : "";
  const disabled = el.isDisabled ? " [disabled]" : "";
  const attrs = attrParts.length > 0 ? " " + attrParts.join(" ") : "";

  // Flag elements where text color matches background color (invisible text)
  const textColor = el.attributes["text-color"];
  const bgColor = el.attributes["bg-color"];
  const invisible =
    textColor && bgColor && textColor === bgColor ? " [invisible-text]" : "";

  // Position hint: indicate if element is above or below the viewport
  let posHint = "";
  if (viewportHeight !== undefined && el.rect) {
    if (el.rect.y < 0) {
      posHint = " ^above";
    } else if (el.rect.y >= viewportHeight) {
      posHint = ` v${Math.round(el.rect.y - viewportHeight)}px`;
    }
  }

  return `[${el.tag}] ${head}${attrs} "${text}"${role}${disabled}${invisible}${posHint}`;
}

/**
 * Format all tagged elements from a snapshot into the compact text the agent sees.
 * Includes position hints when viewport height is available.
 */
export function formatSnapshotElements(
  elements: TaggedElement[],
  viewportHeight?: number,
): string {
  return elements
    .map((el) => formatElementCompact(el, el.text, null, viewportHeight))
    .join("\n");
}

/**
 * Shared utility: walk message history and extract a compact action→outcome timeline.
 * Used by both `summarizeTrajectory()` and `extractAttemptSummary()`.
 */
export function summarizeHistory(
  messages: LLMMessage[],
  maxEntries = 20,
): string[] {
  const entries: string[] = [];
  let turnNum = 0;

  // Walk forward to produce a chronological timeline
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "assistant" || !msg.tool_calls) continue;

    for (const tc of msg.tool_calls) {
      const toolName = tc.function.name;
      // Skip noise tools
      if (["wait"].includes(toolName)) continue;

      let argSnippet = "";
      try {
        const args = JSON.parse(tc.function.arguments);
        const parts: string[] = [];
        if (args.id != null) parts.push(`[${args.id}]`);
        if (args.text) parts.push(`"${String(args.text).slice(0, 30)}"`);
        if (args.url) parts.push(String(args.url).slice(0, 40));
        if (args.direction) parts.push(args.direction);
        if (args.summary) parts.push(`"${String(args.summary).slice(0, 30)}"`);
        if (args.reason) parts.push(`"${String(args.reason).slice(0, 30)}"`);
        argSnippet = parts.join(" ");
      } catch {
        /* */
      }

      // Find the corresponding tool result
      let outcome = "no result";
      let isFailure = false;
      for (let j = i + 1; j < messages.length; j++) {
        if (messages[j].role === "tool" && messages[j].tool_call_id === tc.id) {
          const raw = messages[j].content;
          const content = typeof raw === "string" ? raw : "";
          isFailure =
            content.startsWith("Error:") ||
            content.includes("Click intercepted") ||
            content.includes("No element with tag") ||
            content.includes("does not appear to be");
          outcome = content.split("\n")[0].slice(0, isFailure ? 160 : 80);
          break;
        }
      }

      turnNum++;
      entries.push(
        `${isFailure ? "\u26A0 " : ""}T${turnNum}: ${toolName} ${argSnippet} → ${outcome}`,
      );
      if (entries.length >= maxEntries) return entries;
    }
  }

  return entries;
}

/**
 * Deduplicate invisible-text elements by grouping 3+ same-tagName elements
 * whose text-color matches bg-color into summary lines.
 */
export function deduplicateInvisibleElements(elements: TaggedElement[]): {
  visible: TaggedElement[];
  groups: string[];
} {
  const visible: TaggedElement[] = [];
  const invisibleByTag = new Map<string, TaggedElement[]>();

  for (const el of elements) {
    const textColor = el.attributes["text-color"];
    const bgColor = el.attributes["bg-color"];
    if (textColor && bgColor && textColor === bgColor) {
      const bucket = invisibleByTag.get(el.tagName) || [];
      bucket.push(el);
      invisibleByTag.set(el.tagName, bucket);
    } else {
      visible.push(el);
    }
  }

  const groups: string[] = [];
  for (const [tagName, items] of invisibleByTag) {
    if (items.length < 3) {
      // Too few to group — return as individual visible elements
      visible.push(...items);
    } else {
      const ids = items.map((e) => e.tag).join(",");
      const uniqueTexts = [...new Set(items.map((e) => e.text).filter(Boolean))];
      const sampleTexts =
        uniqueTexts.length > 0
          ? uniqueTexts.slice(0, 5).map((t) => `"${t.slice(0, 30)}"`).join(",")
          : "(no text)";
      groups.push(
        `[invisible-text group] ${items.length}× ${tagName} (IDs: ${ids}): ${sampleTexts}`,
      );
    }
  }

  return { visible, groups };
}

/**
 * Compress repetitive content lines by normalizing digit runs and
 * suppressing duplicates beyond a threshold.
 */
export function compressRepetitiveContent(
  content: string,
  maxRepetitions: number = 3,
): string {
  if (!content) return content;

  const lines = content.split("\n");
  const counts = new Map<string, number>();
  const suppressed = new Map<string, number>();
  const result: string[] = [];

  for (const line of lines) {
    const normalized = line.replace(/\d+/g, "N");
    const seen = counts.get(normalized) || 0;
    counts.set(normalized, seen + 1);

    if (seen < maxRepetitions) {
      result.push(line);
    } else {
      suppressed.set(normalized, (suppressed.get(normalized) || 0) + 1);
    }
  }

  for (const [pattern, count] of suppressed) {
    result.push(`[... "${pattern}" repeated — omitting ${count} instances]`);
  }

  return result.join("\n");
}

/** Alias for backward compatibility */
export const summarizeCausalChain = summarizeHistory;
