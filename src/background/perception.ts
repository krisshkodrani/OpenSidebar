/**
 * Perception Layer — Vision-based page interpretation
 *
 * Dual-mode perception:
 * - **Orientation** (no subtask): Generic page understanding for situational awareness.
 * - **Focused** (subtask active): Goal-conditioned interpretation scoped to current subtask.
 *
 * Provider failover: Groq (Llama 4 Scout, fastest) → OpenRouter (GPT-4o-mini, fallback).
 * Fingerprint-based caching: only re-interprets when the page
 * has meaningfully changed (URL + element count + signature hash).
 */

import { TaggedElement, UserSettings } from "../types";
import { logger } from "../utils";
import { renderPrompt } from "../prompts";
import { stripThinkTags } from "./llm";
import { TokenUsage } from "./llm/types";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const GROQ_PERCEPTION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const OPENROUTER_PERCEPTION_MODEL = "openai/gpt-4o-mini";
const PERCEPTION_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 800;

/** Minimum subtask description length to trigger focused mode */
const MIN_SUBTASK_LENGTH = 10;

interface PerceptionProvider {
  baseUrl: string;
  apiKey: string;
  headers: Record<string, string>;
  model: string;
  providerId: string;
}

export type CompletionSignalStatus = "done" | "not_done" | "unclear";

export interface CompletionSignal {
  status: CompletionSignalStatus;
  evidence: string;
  /** Whether this is a subtask-level or objective-level signal */
  scope: "subtask" | "objective";
}

// Keep old types as aliases for backward compatibility during migration
export type ObjectiveCheckStatus = CompletionSignalStatus;
export type ObjectiveCheck = CompletionSignal;

export interface PerceptionResult {
  interpretation: string;
  usage?: TokenUsage;
  model: string;
  providerId?: string;
  durationMs: number;
  cached: boolean;
  /** Completion signal — scoped to subtask (focused mode) or objective (orientation mode) */
  completionSignal?: CompletionSignal;
  /** @deprecated Use completionSignal — kept for backward compat */
  objectiveCheck?: CompletionSignal;
  /** Which perception mode was used */
  mode: "orientation" | "focused";
}

export interface PerceptionInput {
  screenshotDataUrl: string;
  elements: TaggedElement[];
  url: string;
  title: string;
  scroll: { y: number; maxY: number };
  /** Top-level user objective (used in orientation mode fallback) */
  objective?: string;
  /** Current subtask description — triggers focused mode when present */
  subtask?: string;
  /** Tool profile hint for focused mode (read_only, form_fill, navigate, full) */
  toolProfile?: string;
}

/** Build a compact element summary for the perception prompt. */
export function buildElementSummary(elements: TaggedElement[]): string {
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

  // Include elements with IDs: inputs, buttons, and a sample of others (cap ~50 lines)
  const lines: string[] = [];
  const VAGUE_CTA =
    /^(click\s*(me|here)|press\s*(me|here)|go|submit|ok|yes|no)$/i;
  const textCounts: Record<string, number> = {};

  for (const el of elements) {
    if (lines.length >= 50) break;
    const text = el.text.slice(0, 40);
    const isInput = ["input", "textarea", "select"].includes(el.tagName);
    const isButton =
      el.tagName === "button" ||
      el.role === "button" ||
      el.attributes.type === "submit";

    if (isInput || isButton || lines.length < 30) {
      lines.push(`[${el.tag}] ${el.tagName} "${text}"`);
    }

    // Track duplicate vague text
    const normalized = text.trim().toLowerCase();
    if (normalized && VAGUE_CTA.test(normalized)) {
      textCounts[normalized] = (textCounts[normalized] || 0) + 1;
    }
  }

  // Flag suspicious duplicates
  const suspicious: string[] = [];
  for (const [text, count] of Object.entries(textCounts)) {
    if (count >= 3) suspicious.push(`${count}x "${text}"`);
  }

  let summary = `${elements.length} total (${parts.join(", ")})`;
  if (lines.length > 0) {
    summary += `\nElements:\n${lines.join("\n")}`;
  }
  if (suspicious.length > 0) {
    summary += `\n⚠ Suspicious duplicates: ${suspicious.join(", ")}`;
  }
  return summary;
}

/**
 * Parse a completion signal line from perception output.
 * Matches both focused mode (COMPLETION_SIGNAL) and orientation mode (OBJECTIVE_CHECK).
 *
 * Expected formats:
 *   "5. COMPLETION_SIGNAL: DONE — Evidence sentence."
 *   "6. OBJECTIVE_CHECK: NOT_DONE — Still on login page."
 */
export function parseCompletionSignal(
  text: string,
  scope: "subtask" | "objective",
): CompletionSignal | null {
  const match = text.match(
    /(?:COMPLETION_SIGNAL|OBJECTIVE_CHECK):\s*(DONE|NOT_DONE|UNCLEAR)\b[.:\s\u2014-]*(.*)/i,
  );
  if (!match) return null;
  const raw = match[1].toUpperCase();
  const status: CompletionSignalStatus =
    raw === "DONE" ? "done" : raw === "NOT_DONE" ? "not_done" : "unclear";
  const evidence = (match[2] || "").trim().slice(0, 200);
  return { status, evidence, scope };
}

/** @deprecated Use parseCompletionSignal — kept for backward compat */
export const parseObjectiveCheck = (text: string) =>
  parseCompletionSignal(text, "objective");

/**
 * Build the perception prompt text and detect mode from input.
 * Pure function — reusable by the eval runner to reconstruct prompts offline.
 */
export function buildPerceptionPrompt(input: PerceptionInput): {
  promptText: string;
  mode: "orientation" | "focused";
} {
  const scrollPct =
    input.scroll.maxY > 0
      ? Math.round((input.scroll.y / input.scroll.maxY) * 100)
      : 0;
  const moreBelow = input.scroll.y < input.scroll.maxY - 10;

  const useFocusedMode =
    !!input.subtask && input.subtask.length >= MIN_SUBTASK_LENGTH;
  const mode: "orientation" | "focused" = useFocusedMode
    ? "focused"
    : "orientation";

  let focusSection = "";
  let orientationSection = "";

  if (useFocusedMode) {
    const toolHint = input.toolProfile
      ? `\nTOOL PROFILE: ${input.toolProfile} (the agent can only use ${input.toolProfile} tools this step)`
      : "";
    focusSection = [
      `\nCURRENT SUBTASK: ${input.subtask}${toolHint}`,
      "",
      "Report (use exact numbered format — no bold, no markdown):",
      `1. SUBTASK_STATE: Current progress toward "${input.subtask}". Only what you observe relevant to this subtask. Cite element [N] IDs.`,
      '2. ACTIONABLE: Elements to interact with next. List as: [tagId] brief reason. If done: "None — subtask complete."',
      "3. BLOCKERS: Anything preventing subtask progress. Classify each on its own line:",
      '   NUISANCE [tagId] "element text" → click [dismissId]',
      '   RELEVANT [tagId] "element text" → reason to keep',
      '   PREREQ "what must happen first" → e.g. "solve puzzle to reveal code", "fill [tagId] input before submit"',
      "   NUISANCE = cookie/consent/promo/ad popup — safe to auto-dismiss. Dismiss target must be a valid [tagId] button.",
      "   RELEVANT = login/checkout/consent dialog with Accept/Decline — requires user decision.",
      "   PREREQ = action/challenge that must complete before objective can proceed. Always list when an unfilled input gates progress.",
      '   If none: "None."',
      "4. VISUAL-ONLY: Task-relevant text in images/canvas/charts/SVGs the DOM misses. Not page text already in elements.",
      "5. COMPLETION_SIGNAL: Is this subtask visually complete? Answer exactly one:",
      "   DONE — evidence from element metadata (not inferred from screenshot)",
      "   NOT_DONE — what remains",
      "   UNCLEAR — why you cannot determine",
    ].join("\n");
  } else {
    const objectiveCheck = input.objective
      ? `\n6. OBJECTIVE_CHECK: The agent's objective is: "${input.objective}". Does the visible page state suggest this objective has been accomplished? Answer exactly: DONE / NOT_DONE / UNCLEAR, followed by one evidence fragment grounded in element metadata.`
      : "";
    orientationSection = [
      "\nThe agent needs situational awareness of this page.",
      "",
      "Report (use exact numbered format — no bold, no markdown):",
      "1. LAYOUT: Page type and visible structure (1 fragment).",
      "2. STATE: Active controls, open menus, focused inputs, loading indicators, toggle states. Cite [tagId] for key elements.",
      "3. BLOCKERS: Overlays/modals/dialogs/banners blocking interaction OR logical prerequisites gating progress. For each on its own line:",
      '   NUISANCE [tagId] "element text" → click [dismissTagId]',
      '   RELEVANT [tagId] "element text" → reason to keep',
      '   PREREQ "what must happen first" → e.g. "complete challenge to reveal code", "fill [tagId] input before submit"',
      "   NUISANCE = cookie/consent/promo/newsletter/ad/notification/survey popup — safe to auto-dismiss. Dismiss target must be a valid [tagId] button from the element list.",
      "   RELEVANT = login/checkout/consent dialog with Accept/Decline — user must choose. NOT auto-dismissible.",
      "   PREREQ = content gated behind a step, timer, puzzle, or unfilled input. Always list when a required input field is empty or a challenge must be completed before proceeding.",
      '   Vague-CTA divs ("Click Me", "Try This!", "Nope!") = NUISANCE with their actual [tagId] as dismiss target.',
      '   If no blockers: "None."',
      "4. VISUAL-ONLY: Text in images, canvas, charts, SVGs — content DOM inspection misses. Not page text already in elements.",
      '5. HAZARDS: Genuinely dangerous or deceptive elements only — invisible text (text-color = bg-color), decoy buttons that navigate away, fake close buttons. For each: [tagId] "specific risk". Do not list elements already classified as BLOCKERS. If none: "None."',
      objectiveCheck,
    ].join("\n");
  }

  const promptText = renderPrompt("perception.interpret_page", {
    title: input.title || "Unknown",
    url: input.url || "Unknown",
    scrollPosition: `${input.scroll.y}/${input.scroll.maxY}px (${scrollPct}%)${moreBelow ? " — more content below" : ""}`,
    elementSummary: buildElementSummary(input.elements),
    focusSection,
    orientationSection,
  });

  return { promptText, mode };
}

/** Build ordered list of perception providers from available API keys. */
function buildProviders(settings: UserSettings): PerceptionProvider[] {
  const providers: PerceptionProvider[] = [];

  const groqKey = settings.groqApiKey || __GROQ_API_KEY__;
  if (groqKey) {
    providers.push({
      baseUrl: GROQ_API_URL,
      apiKey: groqKey,
      headers: {},
      model: GROQ_PERCEPTION_MODEL,
      providerId: "groq",
    });
  }

  const openRouterKey = settings.openRouterApiKey || __OPENROUTER_API_KEY__;
  if (openRouterKey) {
    providers.push({
      baseUrl: OPENROUTER_API_URL,
      apiKey: openRouterKey,
      headers: {
        "HTTP-Referer": "chrome-extension://opensidebar",
        "X-Title": "OpenSidebar",
      },
      model: OPENROUTER_PERCEPTION_MODEL,
      providerId: "openrouter",
    });
  }

  return providers;
}

/**
 * Perceive the current page state by sending a screenshot + element metadata
 * to a vision model for structured interpretation.
 *
 * Provider priority: Groq (Llama 4 Scout) → OpenRouter (GPT-4o-mini).
 */
export async function perceive(
  input: PerceptionInput,
  signal?: AbortSignal,
): Promise<PerceptionResult> {
  const stored = await chrome.storage.sync.get("userSettings");
  const settings = (stored.userSettings ?? {}) as UserSettings;
  const providers = buildProviders(settings);

  if (providers.length === 0) {
    return {
      interpretation:
        "[No API key — visual perception unavailable. Agent relies on element list only.]",
      model: OPENROUTER_PERCEPTION_MODEL,
      durationMs: 0,
      cached: false,
      mode: "orientation",
    };
  }

  // Build the perception prompt via shared helper
  const { promptText, mode } = buildPerceptionPrompt(input);
  const useFocusedMode = mode === "focused";

  const callStart = Date.now();

  // Try each provider in priority order
  for (let pi = 0; pi < providers.length; pi++) {
    const provider = providers[pi];
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
      if (attempt > 1) {
        const delay =
          BASE_DELAY_MS * Math.pow(2, attempt - 2) +
          Math.floor(Math.random() * 200);
        logger.info(
          "perception",
          `Retrying ${provider.providerId} (${attempt}/${MAX_RETRIES + 1})`,
          { delay },
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      try {
        const fetchSignal = signal
          ? AbortSignal.any([
              signal,
              AbortSignal.timeout(PERCEPTION_TIMEOUT_MS),
            ])
          : AbortSignal.timeout(PERCEPTION_TIMEOUT_MS);

        const response = await fetch(provider.baseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${provider.apiKey}`,
            ...provider.headers,
          },
          body: JSON.stringify({
            model: provider.model,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: promptText },
                  {
                    type: "image_url",
                    image_url: { url: input.screenshotDataUrl },
                  },
                ],
              },
            ],
            max_tokens: 600,
            temperature: 0.1,
          }),
          signal: fetchSignal,
        });

        if (!response.ok) {
          const body = await response.text();

          // 429 or non-retryable 4xx: skip to next provider
          if (response.status === 429) {
            logger.warn("perception", "Rate limited, trying next provider", {
              provider: provider.providerId,
            });
            break; // break inner retry loop → try next provider
          }
          if (
            response.status >= 400 &&
            response.status < 500 &&
            response.status !== 429
          ) {
            logger.error("perception", "Non-retryable error", {
              provider: provider.providerId,
              status: response.status,
              body,
            });
            break; // break inner retry loop → try next provider
          }

          // 5xx: retry same provider
          throw new Error(`Perception API error ${response.status}: ${body}`);
        }

        const json = await response.json();
        const text = json.choices?.[0]?.message?.content;

        if (!text) {
          logger.warn("perception", "Model returned empty content", {
            provider: provider.providerId,
          });
          return {
            interpretation: "[Visual perception returned no content]",
            model: provider.model,
            providerId: provider.providerId,
            durationMs: Date.now() - callStart,
            cached: false,
            mode,
          };
        }

        const cleaned = stripThinkTags(text);

        const usage: TokenUsage | undefined = json.usage
          ? {
              prompt_tokens: json.usage.prompt_tokens ?? 0,
              completion_tokens: json.usage.completion_tokens ?? 0,
              total_tokens: json.usage.total_tokens ?? 0,
              cost: json.usage.cost,
            }
          : undefined;

        logger.info("perception", "Page interpreted", {
          provider: provider.providerId,
          model: provider.model,
          mode,
          length: cleaned.length,
          durationMs: Date.now() - callStart,
        });

        // Parse completion signal — scoped to subtask in focused mode,
        // objective in orientation mode
        const signalScope = useFocusedMode ? "subtask" : "objective";
        const hasSignalTarget = useFocusedMode
          ? !!input.subtask
          : !!input.objective;
        const completionSignal = hasSignalTarget
          ? (parseCompletionSignal(cleaned, signalScope) ?? undefined)
          : undefined;

        return {
          interpretation: cleaned,
          usage,
          model: provider.model,
          providerId: provider.providerId,
          durationMs: Date.now() - callStart,
          cached: false,
          mode,
          completionSignal,
          // Backward compat: mirror to objectiveCheck
          objectiveCheck: completionSignal,
        };
      } catch (error: any) {
        if (error.name === "AbortError" || error.name === "TimeoutError") {
          logger.warn("perception", "Aborted or timed out", {
            provider: provider.providerId,
            error: error.message,
          });
          return {
            interpretation: "[Visual perception timed out]",
            model: provider.model,
            providerId: provider.providerId,
            durationMs: Date.now() - callStart,
            cached: false,
            mode,
          };
        }
        lastError = error;
        logger.warn(
          "perception",
          `${provider.providerId} attempt ${attempt} failed`,
          { error: error.message },
        );
        if (attempt >= MAX_RETRIES + 1) break;
      }
    }

    // Log provider exhaustion, continue to next
    if (pi < providers.length - 1) {
      logger.info("perception", "Falling back to next provider", {
        from: provider.providerId,
        to: providers[pi + 1].providerId,
      });
    }
  }

  logger.error("perception", "All providers failed");
  return {
    interpretation: "[Visual perception failed: all providers exhausted]",
    model: providers[providers.length - 1].model,
    providerId: providers[providers.length - 1].providerId,
    durationMs: Date.now() - callStart,
    cached: false,
    mode,
  };
}
