/**
 * Agent loop helpers — element validation, action tracking, snapshot fingerprinting,
 * handoff briefing, filler/hallucination detection, and attempt summarization
 */

import { DomSnapshot, ToolName } from "../../types";
import { LLMMessage } from "../llm/types";
import { stripThinkTags } from "../llm";
import { ActionEffect } from "./stagnation";
import { ACTION_EFFECT } from "./constants";

/** Tools that require a valid element `id` param — validated before dispatch. */
export const ELEMENT_ID_TOOLS = new Set<string>([
  ToolName.CLICK_ELEMENT,
  ToolName.TYPE_TEXT,
  ToolName.HOVER_ELEMENT,
  ToolName.SELECT_OPTION,
  ToolName.HIDE_ELEMENT,
  ToolName.READ_ELEMENT,
  ToolName.UPLOAD_FILE,
  ToolName.RIGHT_CLICK,
  ToolName.SET_CHECKBOX,
]);

/** Tools with dual element ID params (sourceId + targetId). */
export const ELEMENT_DUAL_ID_TOOLS = new Set<string>([ToolName.DRAG_AND_DROP]);

/**
 * Validate element IDs before dispatching to content script.
 * Returns null if valid, or an error string with sample valid IDs if invalid.
 */
export function validateElementIds(
  toolName: string,
  args: Record<string, unknown>,
  snapshot: DomSnapshot | null,
): string | null {
  if (!snapshot || snapshot.elements.length === 0) return null;

  const validIds = new Set(snapshot.elements.map((e) => e.tag));

  const checkId = (id: unknown, paramName: string): string | null => {
    if (id == null) return null; // param not present — let executor handle
    const numId = typeof id === "number" ? id : Number(id);
    if (isNaN(numId)) return null; // non-numeric — let executor handle
    if (validIds.has(numId)) return null;

    const sampleElements = snapshot.elements
      .slice(0, 15)
      .map((e) => `[${e.tag}] ${e.tagName} "${e.text.slice(0, 30)}"`);
    return (
      `Error: Element ${paramName}=${numId} does not exist on the current page. ` +
      `Valid element IDs: ${[...validIds].slice(0, 20).join(", ")}. ` +
      `Sample elements:\n${sampleElements.join("\n")}\n` +
      `This target may be hidden, inside a closed drawer or accordion, off-screen, or the page state may be stale. ` +
      `Reveal or refresh the relevant UI first, then retry with a currently visible tag. ` +
      `Use read_page, scroll_page, or click a control that reveals the target before retrying.`
    );
  };

  if (ELEMENT_ID_TOOLS.has(toolName)) {
    return checkId(args.id, "id");
  }
  if (ELEMENT_DUAL_ID_TOOLS.has(toolName)) {
    return (
      checkId(args.sourceId, "sourceId") ?? checkId(args.targetId, "targetId")
    );
  }
  return null;
}

/**
 * Format an ActionEffect into a human-readable injection message.
 * Returns null if no message should be injected (e.g., first snapshot).
 */
export function formatActionEffect(effect: ActionEffect): string | null {
  if (
    effect.deltaPercent < ACTION_EFFECT.ZERO_THRESHOLD &&
    !effect.urlChanged
  ) {
    return "[Action effect: No observable DOM change — page state appears unchanged.]";
  }
  const parts: string[] = [];
  const pct = Math.round(effect.deltaPercent * 100);
  parts.push(`${pct}% elements changed`);
  if (effect.urlChanged) parts.push("URL changed");
  if (effect.elementsAdded > 0) parts.push(`+${effect.elementsAdded} new`);
  if (effect.elementsRemoved > 0)
    parts.push(`-${effect.elementsRemoved} removed`);
  return `[Action effect: ${parts.join(", ")}]`;
}

/** Tools that require a pre-action feasibility check on the target element. */
export const PREFLIGHT_CHECK_TOOLS = new Set<string>([
  ToolName.CLICK_ELEMENT,
  ToolName.TYPE_TEXT,
  ToolName.HOVER_ELEMENT,
  ToolName.SELECT_OPTION,
  ToolName.DRAG_AND_DROP,
  ToolName.UPLOAD_FILE,
  ToolName.RIGHT_CLICK,
  ToolName.SET_CHECKBOX,
]);

/**
 * Pre-action feasibility check: validates element interactability beyond just ID existence.
 * Returns { error, warning } — error is a hard block, warning is informational.
 */
export function preflightElementCheck(
  toolName: string,
  args: Record<string, unknown>,
  snapshot: DomSnapshot | null,
): { error: string | null; warning: string | null } {
  if (!snapshot || !PREFLIGHT_CHECK_TOOLS.has(toolName)) {
    return { error: null, warning: null };
  }

  // Resolve the element ID(s) to check
  const ids: Array<{ id: number; param: string }> = [];
  if (args.id != null) ids.push({ id: Number(args.id), param: "id" });
  if (args.sourceId != null)
    ids.push({ id: Number(args.sourceId), param: "sourceId" });
  if (args.targetId != null)
    ids.push({ id: Number(args.targetId), param: "targetId" });

  for (const { id, param } of ids) {
    if (isNaN(id)) continue;
    const el = snapshot.elements.find((e) => e.tag === id);
    if (!el) continue; // validateElementIds handles missing elements

    if (el.isDisabled) {
      return {
        error: `Error: Element [${id}] (${param}) is disabled and cannot be interacted with. Find an alternative or wait for it to become enabled.`,
        warning: null,
      };
    }
    if (el.rect.width === 0 && el.rect.height === 0) {
      return {
        error: `Error: Element [${id}] (${param}) has zero size (0×0) and cannot be clicked.`,
        warning: null,
      };
    }
    if (!el.isVisible) {
      return {
        error: null,
        warning: `Warning: Element [${id}] (${param}) is not visible in the viewport. Consider scrolling to it first, or it may be hidden.`,
      };
    }
  }
  return { error: null, warning: null };
}

/** Tracks a recent successful tool call for redundant action detection */
export interface RecentAction {
  tool: string;
  args: string; // First 100 chars of JSON args
  result: string; // Full result string (used as cached return on redundant action block)
  /** Snapshot fingerprint (url|elementCount) at time of action — for outcome-aware comparison */
  snapshotFingerprint: string;
}

/** Tracks a failed tool call to prevent exact repeats */
export interface BlockedAction {
  tool: string;
  argsKey: string; // First 100 chars of JSON args for matching
  error: string; // First 80 chars of error
  turn: number;
}

/** Check if the same tool+args already failed. Returns the prior failure or null. */
export function findPriorFailure(
  blockedActions: BlockedAction[],
  tool: string,
  argsKey: string,
): BlockedAction | null {
  return (
    blockedActions.find((f) => f.tool === tool && f.argsKey === argsKey) ?? null
  );
}

/** Build contextual recovery suggestions based on the error message. */
export function buildFailureRecovery(error: string): string {
  const coverMatch = error.match(/covered by (?:overlay )?\[(\d+)\]/);
  if (coverMatch) {
    return `Suggestions: hide_element(${coverMatch[1]}) to remove covering element, execute_js to click programmatically, or scroll_page.`;
  }
  if (
    error.includes("No element with tag") ||
    error.includes("does not exist")
  ) {
    return `Suggestions: read_page to refresh element IDs, or find_element to locate by text.`;
  }
  return `Choose a different approach — try a different element ID, different tool, or read_page to reassess.`;
}

/**
 * Normalize a tool result into a fingerprint for dead-end detection.
 * Strips variable parts (IDs, numbers) so different-but-equivalent errors match.
 */
export function normalizeOutcome(result: string): string {
  return result
    .replace(/\[(\d+)\]/g, "«$1»") // protect [N] element refs
    .replace(/\b\d+\b/g, "N") // normalize other numbers
    .replace(/«(\d+)»/g, "[$1]") // restore element refs
    .slice(0, 120)
    .trim();
}

/** Simple djb2 hash for short strings. */
export function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

/**
 * Compute a fingerprint from the current snapshot for outcome-aware redundancy checks.
 * Includes a text hash so that text-only changes (e.g. counter "3 more" → "2 more")
 * register as a different page state even when URL and element count stay the same.
 */
export function getSnapshotFingerprint(
  snapshot: {
    url: string;
    elements: { length: number };
    visibleContent?: string;
    pageContent?: string;
  } | null,
): string {
  if (!snapshot) return "none|0|0";
  const textSample = (
    snapshot.pageContent ??
    snapshot.visibleContent ??
    ""
  ).slice(0, 300);
  return `${snapshot.url}|${snapshot.elements.length}|${djb2(textSample)}`;
}

/**
 * Build a clear, selector-based briefing for the executor model at plan-then-act handoff.
 * Extracts element references from the planner model's tool calls and resolves them
 * to human-readable selectors so the executor model knows exactly which elements matter.
 */
export function buildHandoffBriefing(
  history: LLMMessage[],
  snapshot: DomSnapshot | null,
): string {
  const parts: string[] = [];

  // 1. Extract the planner model's reasoning text (last assistant text content)
  let reasoning = "";
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (
      msg.role === "assistant" &&
      typeof msg.content === "string" &&
      msg.content.trim()
    ) {
      reasoning = stripThinkTags(msg.content).trim().slice(0, 500);
      break;
    }
  }
  if (reasoning) {
    parts.push(`Planner model observations:\n${reasoning}`);
  }

  // 2. Extract all element IDs referenced in the last few assistant tool calls
  if (snapshot && snapshot.elements.length > 0) {
    const elementMap = new Map(snapshot.elements.map((el) => [el.tag, el]));
    const referencedIds = new Map<number, string>(); // id → action taken

    // Walk the last several messages to find tool calls from the planner model
    const recentAssistants = history
      .filter(
        (m) =>
          m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0,
      )
      .slice(-4); // last 4 assistant turns with tool calls

    for (const msg of recentAssistants) {
      for (const tc of msg.tool_calls!) {
        try {
          const args = JSON.parse(tc.function.arguments);
          const ids: number[] = [];
          if (args.id != null) ids.push(Number(args.id));
          if (args.sourceId != null) ids.push(Number(args.sourceId));
          if (args.targetId != null) ids.push(Number(args.targetId));

          for (const id of ids) {
            if (!isNaN(id) && !referencedIds.has(id)) {
              referencedIds.set(id, tc.function.name);
            }
          }
        } catch {
          /* skip unparseable args */
        }
      }
    }

    // Build element descriptions
    if (referencedIds.size > 0) {
      const lines: string[] = [];
      for (const [id, action] of referencedIds) {
        const el = elementMap.get(id);
        if (!el) continue;
        // CSS-like selector: tagName#id.class "text"
        const idAttr = el.attributes.id ? `#${el.attributes.id}` : "";
        const classes = el.attributes.class
          ? "." + el.attributes.class.split(/\s+/).slice(0, 3).join(".")
          : "";
        const text = el.text.slice(0, 50);
        lines.push(
          `- [${id}] ${el.tagName}${idAttr}${classes} "${text}" — ${action}`,
        );
      }
      if (lines.length > 0) {
        parts.push(`Elements identified:\n${lines.join("\n")}`);
      }
    }
  }

  return parts.join("\n\n");
}

/** Filler prefix patterns — text-only responses that start with these are low-information */
const FILLER_PREFIXES = [
  "i'm ready",
  "we need to",
  "the task",
  "i will now",
  "i'll",
  "we have",
  "i'm now",
  "the next step",
];

/**
 * Classify a text-only LLM response as filler (low-information narration)
 * vs. genuine reasoning that may contain useful analysis.
 */
export function isFillerText(text: string): boolean {
  const trimmed = text.trim();
  // Short text with no tool call is definitionally filler in an agent context
  if (trimmed.length < 60) return true;
  // Filler prefix pattern
  const lower = trimmed.toLowerCase();
  if (FILLER_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
  // High non-alphanumeric ratio (catches "We have..............." patterns)
  const alphanumCount = trimmed.replace(/[^a-zA-Z0-9]/g, "").length;
  if (alphanumCount / trimmed.length < 0.6) return true;
  return false;
}

/** Patterns that indicate the LLM is simulating tool calls in text instead of using the API. */
const HALLUCINATION_PATTERNS = [
  /functions\.\w+/,
  /\bto\s*=\s*functions\./,
  /\bjson\s*\{/i,
  /"function"\s*:\s*"/,
  /"tool"\s*:\s*"/,
  /\btool_call\b/i,
];

/**
 * Detect when the LLM is hallucinating tool calls as plain text.
 * Requires text > 150 chars AND >= 2 distinct pattern matches to reduce false positives.
 */
export function isHallucinatedToolCall(text: string): boolean {
  if (text.length <= 150) return false;
  let matchCount = 0;
  for (const pattern of HALLUCINATION_PATTERNS) {
    if (pattern.test(text)) {
      matchCount++;
      if (matchCount >= 2) return true;
    }
  }
  return false;
}

// ── Turn-level error classification for retry decisions ──

export type TurnErrorClass =
  | "hallucination"
  | "network"
  | "empty_response"
  | "credits_exhausted"
  | "user_abort"
  | "bad_request"
  | "unknown";

/** Retryable error classes (up to MAX_TURN_RETRIES). */
export const RETRYABLE_ERRORS = new Set<TurnErrorClass>([
  "hallucination",
  "network",
  "empty_response",
]);

/** Max retries per turn before falling through to escalation path. */
export const MAX_TURN_RETRIES = 2;

/** Backoff delays in ms for each retry attempt (index = retryCount - 1). */
export const TURN_RETRY_BACKOFF_MS = [0, 500];

/**
 * Classify a turn-level error for retry decisions.
 * Called inside the LLM call catch block and after empty-response detection.
 */
export function classifyTurnError(
  error: unknown,
  hallucinationDetected: boolean,
): TurnErrorClass {
  if (hallucinationDetected) return "hallucination";

  if (error instanceof Error) {
    if (error.name === "AbortError") return "user_abort";
  }

  // HTTP status-based classification
  const status = (error as any)?.status;
  if (status === 402) return "credits_exhausted";
  if (status === 400 || status === 422) return "bad_request";
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return "network";

  // Fetch/network failures
  if (error instanceof TypeError && error.message.includes("fetch")) return "network";

  return "unknown";
}

/**
 * Build a compact summary of what the agent tried before a strategy pivot.
 * Includes both successes and failures so the next model knows what was
 * already accomplished vs what went wrong.
 */
export function extractAttemptSummary(messages: LLMMessage[]): string {
  const successes: string[] = [];
  const failures: string[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "tool") continue;

    const content = typeof msg.content === "string" ? msg.content : "";
    const isFail =
      content.startsWith("Error:") ||
      content.includes("does not appear to be") ||
      content.includes("No element with tag") ||
      content.includes("Click intercepted") ||
      content.includes("REJECTED");

    // Find the corresponding assistant tool_call
    const toolCallId = msg.tool_call_id;
    if (!toolCallId) continue;

    let toolName = "unknown";
    let argSnippet = "";
    for (let j = i - 1; j >= 0; j--) {
      const aMsg = messages[j];
      if (aMsg.role === "assistant" && aMsg.tool_calls) {
        const tc = aMsg.tool_calls.find((c) => c.id === toolCallId);
        if (tc) {
          toolName = tc.function.name;
          try {
            const args = JSON.parse(tc.function.arguments);
            const parts: string[] = [];
            if (args.id != null) parts.push(`[${args.id}]`);
            if (args.text) parts.push(`"${String(args.text).slice(0, 30)}"`);
            if (args.url) parts.push(String(args.url).slice(0, 40));
            if (args.direction) parts.push(args.direction);
            if (args.summary)
              parts.push(`"${String(args.summary).slice(0, 30)}"`);
            argSnippet = parts.join(" ");
          } catch {
            /* */
          }
          break;
        }
      }
    }

    const key = `${toolName} ${argSnippet}`.trim();

    if (isFail) {
      const errorSnippet = content.split("\n")[0].slice(0, 60);
      // Deduplicate repeated failures
      const existing = failures.find((f) => f.startsWith(`- ${key}`));
      if (!existing) failures.push(`- ${key} — ${errorSnippet}`);
    } else {
      // Skip internal/noise tools for success tracking
      if (["read_page", "wait", "escalate"].includes(toolName)) continue;
      const resultSnippet = content.split("\n")[0].slice(0, 60);
      successes.push(`- ${key} → ${resultSnippet}`);
    }

    // Cap total entries
    if (successes.length + failures.length >= 15) break;
  }

  const sections: string[] = [];
  if (successes.length > 0) {
    sections.push(`Completed actions (DO NOT redo):\n${successes.join("\n")}`);
  }
  if (failures.length > 0) {
    sections.push(`Failed actions (DO NOT retry):\n${failures.join("\n")}`);
  }
  if (sections.length === 0) {
    return "No specific actions recorded.";
  }
  return sections.join("\n\n").slice(0, 800);
}

export function userExplicitlyRequestedTabManagement(query: string): boolean {
  const normalized = query.toLowerCase();
  return (
    /\b(new tab|another tab|open tab|create tab)\b/.test(normalized) ||
    /\b(switch tab|switch to tab|go to tab)\b/.test(normalized) ||
    /\bswitch to \d+\b/.test(normalized) ||
    /\b(close tab|close this tab|close current tab)\b/.test(normalized) ||
    /\b(multiple tabs|multi-tab|compare tabs)\b/.test(normalized)
  );
}

// ─── Grounding helpers ───────────────────────────────────────────────

/** Tools that count as "observing the page" — used by the blind-action gate. */
export const GROUNDING_OBSERVATION_TOOLS = new Set<string>([
  ToolName.READ_PAGE,
  ToolName.FIND_ELEMENT,
  ToolName.READ_ELEMENT,
  ToolName.XRAY_PAGE,
  ToolName.SCROLL_PAGE,
]);

const STEP_PATTERNS = [
  /\/step(\d+)/i, // URL path: /step3
  /step\s+(\d+)/i, // prose: "step 3", "Step 5"
  /on step\s+(\d+)/i, // "You are on step 5"
];

/**
 * Extract a step number from a string (URL, title, or page content).
 * Returns the first match or null.
 */
export function extractStepIndicator(source: string): { step: number } | null {
  for (const re of STEP_PATTERNS) {
    const m = source.match(re);
    if (m) return { step: parseInt(m[1], 10) };
  }
  return null;
}

/** Keyword groups for page-type mismatch detection. */
const PAGE_TYPE_RULES: Array<{
  instructionKeywords: RegExp;
  pageKeywords: RegExp;
  pageExclude?: RegExp;
}> = [
  {
    // instruction says checkout/form, but page is a cart
    instructionKeywords: /\b(checkout|check out|fill out|complete the form|payment)\b/i,
    pageKeywords: /\b(cart|shopping cart|your cart|bag)\b/i,
    pageExclude: /\bcheckout\b/i,
  },
  {
    // instruction says search, but page is a product/article
    instructionKeywords: /\b(search for|search the|find results|search results)\b/i,
    pageKeywords: /\b(product|article|item detail|order confirmation)\b/i,
  },
];

export interface ContradictionResult {
  mismatch: boolean;
  details: string;
}

/**
 * Deterministic contradiction detector.
 * Compares instruction claims against actual page state from the snapshot.
 * Returns null when no contradiction is found (conservative — avoids false positives).
 */
export function detectInstructionContradiction(
  instruction: string,
  snapshot: DomSnapshot,
): ContradictionResult | null {
  const pageText = [snapshot.url, snapshot.title, snapshot.pageContent ?? ""].join(" ");

  // 1. Step mismatch: instruction says step N, page says step M
  const instrStep = extractStepIndicator(instruction);
  const pageStep = extractStepIndicator(pageText);
  if (instrStep && pageStep && instrStep.step !== pageStep.step) {
    return {
      mismatch: true,
      details: `Instruction references step ${instrStep.step}, but the page is on step ${pageStep.step} (URL: ${snapshot.url}, title: "${snapshot.title}").`,
    };
  }

  // 2. Page-type mismatch: instruction expects one page type, snapshot shows another
  for (const rule of PAGE_TYPE_RULES) {
    if (rule.instructionKeywords.test(instruction)) {
      const combinedPage = `${snapshot.title} ${snapshot.url}`;
      if (
        rule.pageKeywords.test(combinedPage) &&
        (!rule.pageExclude || !rule.pageExclude.test(combinedPage))
      ) {
        return {
          mismatch: true,
          details: `Instruction expects "${instruction.slice(0, 80)}", but the current page appears to be a different type (title: "${snapshot.title}", URL: ${snapshot.url}).`,
        };
      }
    }
  }

  return null;
}

// ─── Cumulative Failure Brief (§3.4) ────────────────────────────────

/** A single tool attempt tracked for the cumulative failure brief. */
export interface SubgoalAttempt {
  turn: number;
  tool: string;
  args: string; // truncated JSON args (first 100 chars)
  outcome: string; // first line of tool result
  wasFailure: boolean; // error, intercepted, no effect
  snapshotFp: string; // page state fingerprint at time of action
}

/** Failure-pattern keywords → human-readable insights. */
const FAILURE_SYNTHESIS_RULES: Array<{
  test: (a: SubgoalAttempt) => boolean;
  note: string;
}> = [
  {
    test: (a) => a.outcome.includes("covered by"),
    note: "Element is covered by another element",
  },
  {
    test: (a) =>
      a.tool === "dismiss_overlays" && /no overlays/i.test(a.outcome),
    note: "Covering element is NOT an overlay",
  },
  {
    test: (a) => a.tool === "hide_element" && a.wasFailure,
    note: "Covering element cannot be hidden",
  },
  {
    test: (a) => a.tool === "execute_js" && /undefined/i.test(a.outcome),
    note: "JS approach returned undefined",
  },
];

/** Alternative tools to suggest when the agent is stuck. */
const ALTERNATIVE_TOOLS = [
  "click_coordinates",
  "scroll_page",
  "press_key",
  "navigate",
  "execute_js",
  "find_element",
];

/**
 * Build a cumulative failure brief from tracked subgoal attempts.
 * Synthesizes what was tried, what failed, and suggests untried alternatives.
 * Returns empty string if fewer than 3 attempts (not enough data to synthesize).
 * Max output: 600 chars.
 */
export function buildFailureBrief(attempts: SubgoalAttempt[]): string {
  if (attempts.length < 3) return "";

  const lines: string[] = [];

  // 1. Format each attempt
  for (const a of attempts.slice(-10)) {
    const outcome = a.wasFailure ? `FAIL: ${a.outcome}` : a.outcome;
    lines.push(`T${a.turn}: ${a.tool} ${a.args} → ${outcome}`);
  }

  // 2. Deterministic synthesis: extract insights from failure patterns
  const insights = new Set<string>();
  for (const rule of FAILURE_SYNTHESIS_RULES) {
    if (attempts.some(rule.test)) {
      insights.add(rule.note);
    }
  }

  // 3. List untried alternative tools
  const triedTools = new Set(attempts.map((a) => a.tool));
  const untried = ALTERNATIVE_TOOLS.filter((t) => !triedTools.has(t));

  // 4. Assemble the brief
  const sections: string[] = [];
  sections.push(`Attempts (${attempts.length}):\n${lines.join("\n")}`);
  if (insights.size > 0) {
    sections.push(`Insights: ${[...insights].join("; ")}`);
  }
  if (untried.length > 0) {
    sections.push(`Untried tools: ${untried.join(", ")}`);
  }

  return sections.join("\n").slice(0, 600);
}
