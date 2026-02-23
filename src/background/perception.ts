/**
 * Perception Layer — Vision-based page interpretation
 *
 * Replaces raw DOM text dumps with structured page interpretations
 * produced by a multimodal model that sees both the screenshot and
 * element metadata.
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

interface PerceptionProvider {
  baseUrl: string;
  apiKey: string;
  headers: Record<string, string>;
  model: string;
  providerId: string;
}

export interface PerceptionResult {
  interpretation: string;
  usage?: TokenUsage;
  model: string;
  providerId?: string;
  durationMs: number;
  cached: boolean;
}

export interface PerceptionInput {
  screenshotDataUrl: string;
  elements: TaggedElement[];
  url: string;
  title: string;
  scroll: { y: number; maxY: number };
}

/** Build a compact element summary for the perception prompt. */
function buildElementSummary(elements: TaggedElement[]): string {
  const counts: Record<string, number> = {};
  for (const el of elements) {
    const category =
      ["input", "textarea", "select"].includes(el.tagName)
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

  // Include key elements (inputs and primary buttons) with IDs
  const keyElements: string[] = [];
  for (const el of elements) {
    if (keyElements.length >= 10) break;
    if (
      ["input", "textarea", "select"].includes(el.tagName) ||
      el.attributes.type === "submit"
    ) {
      const text = el.text.slice(0, 30);
      keyElements.push(`[${el.tag}] ${el.tagName} "${text}"`);
    }
  }

  let summary = `${elements.length} total (${parts.join(", ")})`;
  if (keyElements.length > 0) {
    summary += `\nKey: ${keyElements.join(", ")}`;
  }
  return summary;
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
    };
  }

  // Build the perception prompt with element summary
  const scrollPct =
    input.scroll.maxY > 0
      ? Math.round((input.scroll.y / input.scroll.maxY) * 100)
      : 0;
  const moreBelow = input.scroll.y < input.scroll.maxY - 10;

  const promptText = renderPrompt("perception.interpret_page", {
    title: input.title || "Unknown",
    url: input.url || "Unknown",
    scrollPosition: `${input.scroll.y}/${input.scroll.maxY}px (${scrollPct}%)${moreBelow ? " — more content below" : ""}`,
    elementSummary: buildElementSummary(input.elements),
  });

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
          throw new Error(
            `Perception API error ${response.status}: ${body}`,
          );
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
          length: cleaned.length,
          durationMs: Date.now() - callStart,
        });

        return {
          interpretation: cleaned,
          usage,
          model: provider.model,
          providerId: provider.providerId,
          durationMs: Date.now() - callStart,
          cached: false,
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
  };
}
