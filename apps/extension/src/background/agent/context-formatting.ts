/**
 * Context formatting - element formatting, snapshot serialization, history summarization
 */

import { PageSkeletonNode, TaggedElement } from "../../types";
import { LLMMessage } from "../llm/types";
import { sanitizeForPrompt } from "../security";
import { LastActionOutcome, OpenTabInfo } from "./context-types";

/**
 * Format a single element in compact notation.
 * [N] tagName#id key=val key="multi word" "text" (role) [position hint]
 *
 * Position hints (when viewportHeight is provided):
 * - No annotation: element is in the current viewport
 * - `@y{N}`: absolute page Y position (from pageY) — use scroll_page({"y": N})
 * - `^above` / `v{N}px`: legacy relative hints when pageY is unavailable
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
    if (k === "bg-color" || k === "text-color") continue; // visual-only, kept for invisible-text detection
    if (k === "aria-label" && v === text) continue; // already shown as quoted text
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

  // Position hint: indicate if element is off-screen
  // Prefer absolute @y{N} when pageY is available; fall back to relative ^above / v{N}px
  let posHint = "";
  if (viewportHeight !== undefined && el.rect) {
    if (el.rect.y < 0 || el.rect.y >= viewportHeight) {
      if (el.rect.pageY != null) {
        posHint = ` @y${el.rect.pageY}`;
      } else if (el.rect.y < 0) {
        posHint = " ^above";
      } else {
        posHint = ` v${Math.round(el.rect.y - viewportHeight)}px`;
      }
    }
  }

  // LP-10: `*` marks elements that appeared since the previous snapshot.
  const newMark = el.isNew ? "*" : "";
  return `${newMark}[${el.tag}] ${head}${attrs} "${text}"${role}${disabled}${invisible}${posHint}`;
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
      let parsedArgs: Record<string, unknown> = {};
      try {
        const args = JSON.parse(tc.function.arguments);
        parsedArgs = args && typeof args === "object" ? args : {};
        const parts: string[] = [];
        if (args.id != null) parts.push(`[${args.id}]`);
        if (args.text) parts.push(`"${String(args.text).slice(0, 30)}"`);
        if (args.url) parts.push(String(args.url).slice(0, 40));
        if (args.y != null) parts.push(`y=${args.y}`);
        if (args.direction) parts.push(args.direction);
        if (args.summary) parts.push(`"${String(args.summary).slice(0, 30)}"`);
        if (args.reason) parts.push(`"${String(args.reason).slice(0, 30)}"`);
        argSnippet = parts.join(" ");
      } catch {
        /* */
      }

      const summarizeToolResult = (
        toolName: string,
        content: string,
        isFailure: boolean,
      ): string => {
        if (toolName === "inspect_chart" && !isFailure) {
          const lines = content
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
          const chartTitle = lines.find((line) =>
            /^- Highcharts \d+ title:/i.test(line),
          );
          const pointLines = lines.filter((line) =>
            /^- Point:/i.test(line),
          );
          const pattern =
            typeof parsedArgs.pattern === "string"
              ? parsedArgs.pattern.trim().toLowerCase()
              : "";
          const relevantPointLines = pattern
            ? pointLines.filter((line) => line.toLowerCase().includes(pattern))
            : pointLines;
          const evidencePointLines =
            relevantPointLines.length > 0 ? relevantPointLines : pointLines;
          const selected = [
            ...(chartTitle ? [chartTitle] : []),
            ...evidencePointLines.slice(0, 3),
          ];
          if (selected.length > 0) return selected.join("; ").slice(0, 240);
        }

        return content.split("\n")[0].slice(0, isFailure ? 160 : 80);
      };

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
          outcome = summarizeToolResult(toolName, content, isFailure);
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
      const uniqueTexts = [
        ...new Set(items.map((e) => e.text).filter(Boolean)),
      ];
      const sampleTexts =
        uniqueTexts.length > 0
          ? uniqueTexts
              .slice(0, 5)
              .map((t) => `"${t.slice(0, 30)}"`)
              .join(",")
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

/** Format skeleton nodes into indented hierarchy for the agent system prompt. */
export function formatPageSkeleton(skeleton: PageSkeletonNode[]): string {
  return skeleton
    .map((n) => {
      const indent = "  ".repeat(Math.min(n.depth, 4));
      return `${indent}${n.tagName}: "${n.text}"`;
    })
    .join("\n");
}

/**
 * If 3+ form controls are visible, return a hint telling the LLM
 * to batch independent field actions in a single response.
 */
export function buildFormBatchHint(elements: TaggedElement[]): string | null {
  const formControlCount = elements.filter((el) => {
    const tagName = el.tagName.toLowerCase();
    const role = el.role?.toLowerCase();
    return (
      ["input", "textarea", "select"].includes(tagName) ||
      role === "textbox" ||
      role === "combobox" ||
      role === "searchbox" ||
      role === "checkbox" ||
      role === "radio"
    );
  }).length;

  if (formControlCount < 3) return null;

  return (
    "\n\n> **Batch hint:** This page has " +
    formControlCount +
    " form controls. " +
    "When independent fields are already mapped, call multiple type_text, select_option, and set_checkbox actions in the same response; they will execute within one turn. " +
    "Fill all visible requested fields at once. Do not click Next or Submit unless the user or the current plan step explicitly asks for it."
  );
}

/** Render the structured last-action outcome block (prompt v6 grounding). */
export function formatLastActionOutcome(
  outcome: LastActionOutcome | null,
): string {
  if (!outcome) return "No recent DOM-affecting action recorded.";

  const roundedDelta = Math.round(outcome.deltaPercent * 100);
  const effectSummary =
    roundedDelta === 0 && !outcome.urlChanged
      ? "No observable page change."
      : "Observable page change detected.";

  const signals = [
    `${roundedDelta}% DOM delta`,
    outcome.urlChanged ? "URL changed" : "same URL",
    `+${outcome.elementsAdded}`,
    `-${outcome.elementsRemoved}`,
  ].join(" | ");

  return `Tool: ${outcome.toolName}\nResult: ${effectSummary}\nSignals: ${signals}`;
}

/**
 * Render the open-tab inventory block. Empty unless the workspace is genuinely
 * multi-tab, so the model can tell which tab the snapshot belongs to and reach
 * work it already did in other tabs instead of redoing it.
 */
export function buildOpenTabsBlock(
  tabs: OpenTabInfo[],
  currentTabId: number | null,
): string {
  if (tabs.length < 2) return "";
  const tabLines = tabs.map((tab) => {
    const marker =
      tab.tabId === currentTabId
        ? " ← CURRENT TAB (the snapshot below shows this tab)"
        : "";
    return `Tab ${tab.tabId}: "${sanitizeForPrompt(tab.title || "(untitled)")}" — ${tab.url}${marker}`;
  });
  return (
    `## Open Tabs (workspace)\n${tabLines.join("\n")}\n` +
    `Only the current tab is visible in the snapshot. Form values and page state in other tabs persist there — use switch_tab({"tabId": N}) to return to them; do not re-open or re-fill a tab that already has your work.\n`
  );
}

/**
 * Repair the OpenAI tool-call protocol invariant before a prompt goes out.
 *
 * The API requires every assistant `tool_calls` message to be FOLLOWED by one
 * `role:"tool"` message per `tool_call_id` — contiguously. Two things break
 * that here: the dispatch loop appends `role:"user"` narration (preflight
 * warnings, retarget reasons, dry-run notes) between an assistant message and
 * its results, and the parallel dispatch path interleaves nondeterministically.
 *
 * The previous sanitizer validated by SET MEMBERSHIP — "does this id appear
 * anywhere?" — so `[assistant(tc1), user(..), tool(tc1)]` passed as valid.
 * Lenient backends (Fireworks, OpenRouter) accept it; Cerebras walks forward
 * from the assistant, stops at the first non-tool message, and rejects the
 * request with `wrong_api_format`. That produced 189 HTTP 400s in one medium
 * e2e run and is why this is positional, not set-based.
 *
 * Three guarantees, in order:
 *  1. A tool result with no matching assistant `tool_calls` is dropped.
 *  2. An assistant whose results are not ALL present loses its `tool_calls`
 *     (and any partial results are dropped with it, so none are orphaned).
 *  3. Surviving results are hoisted to sit immediately after their assistant
 *     message; anything that landed in between is moved to after the run.
 *
 * Narration displaced by (3) is preserved, not dropped — it just follows the
 * results it describes rather than preceding them.
 */
export function repairToolCallPairing(messages: LLMMessage[]): LLMMessage[] {
  const callIds = new Set<string>();
  const resultIds = new Set<string>();
  for (const msg of messages) {
    if (msg.tool_calls) for (const tc of msg.tool_calls) callIds.add(tc.id);
    if (msg.role === "tool" && msg.tool_call_id) resultIds.add(msg.tool_call_id);
  }

  // Stripping is all-or-nothing per assistant message, so the results that DID
  // arrive for a stripped message must be dropped with it — otherwise they
  // survive as orphans and trip the mirror-image protocol error.
  const strippedIds = new Set<string>();
  for (const msg of messages) {
    if (
      msg.tool_calls?.length &&
      !msg.tool_calls.every((tc) => resultIds.has(tc.id))
    ) {
      for (const tc of msg.tool_calls) strippedIds.add(tc.id);
    }
  }

  const kept = messages
    .filter((msg) =>
      msg.role === "tool" && msg.tool_call_id
        ? callIds.has(msg.tool_call_id) && !strippedIds.has(msg.tool_call_id)
        : true,
    )
    .map((msg) =>
      msg.tool_calls?.length &&
      !msg.tool_calls.every((tc) => resultIds.has(tc.id))
        ? { ...msg, tool_calls: undefined }
        : msg,
    );

  const out: LLMMessage[] = [];
  const consumed = new Set<number>();

  for (let i = 0; i < kept.length; i++) {
    if (consumed.has(i)) continue;
    const msg = kept[i];
    if (!msg.tool_calls?.length) {
      out.push(msg);
      continue;
    }

    const wanted = new Set(msg.tool_calls.map((tc) => tc.id));
    const results: LLMMessage[] = [];
    const displaced: LLMMessage[] = [];

    for (let j = i + 1; j < kept.length && wanted.size > 0; j++) {
      if (consumed.has(j)) continue;
      const candidate = kept[j];
      if (
        candidate.role === "tool" &&
        candidate.tool_call_id &&
        wanted.has(candidate.tool_call_id)
      ) {
        results.push(candidate);
        consumed.add(j);
        wanted.delete(candidate.tool_call_id);
      } else if (candidate.tool_calls?.length) {
        // The next tool-calling turn starts here; results cannot legally live
        // past it, so stop scanning rather than hoist across turns.
        break;
      } else {
        displaced.push(candidate);
        consumed.add(j);
      }
    }

    if (wanted.size > 0) {
      // Unreachable results: emit the assistant without tool_calls and drop the
      // partial results, which would otherwise be orphaned.
      out.push({ ...msg, tool_calls: undefined }, ...displaced);
    } else {
      out.push(msg, ...results, ...displaced);
    }
  }

  return out;
}
