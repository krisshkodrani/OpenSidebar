import { UserSettings } from "../types";
import { logger } from "../utils";
import { TokenUsage } from "./llm/types";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_VISION_MODEL = "google/gemini-2.5-flash-lite";

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 800;

const VISION_PROMPT = `Describe this screenshot of a web page concisely. Focus on:
- Overall layout and visible UI components
- Text content not easily captured by DOM inspection (images, canvas, charts, rendered visuals)
- Interactive elements and their apparent state (disabled, selected, expanded)
- Any error messages, toasts, modals, or overlays visible
- Scroll position indicators if visible
Keep the description under 300 words. Be factual, not interpretive.`;

/**
 * Send a screenshot to a vision model on OpenRouter and return a text description.
 * Standalone module: reads API key from settings, own retry logic, returns a plain string.
 */
export interface VisionResult {
  description: string;
  usage?: TokenUsage;
  model?: string;
  durationMs?: number;
}

export async function describeScreenshot(dataUrl: string, signal?: AbortSignal): Promise<VisionResult> {
  const stored = await chrome.storage.sync.get("userSettings");
  const settings = (stored.userSettings ?? {}) as UserSettings;
  const apiKey = settings.openRouterApiKey || __OPENROUTER_API_KEY__;
  const visionModel = settings.visionModel || DEFAULT_VISION_MODEL;

  if (!apiKey) {
    return { description: "[Screenshot captured but no OpenRouter API key configured for vision description. Add an OpenRouter key in Settings to enable visual analysis.]" };
  }

  let lastError: Error | null = null;
  const callStart = Date.now();

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    if (attempt > 1) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 2) + Math.floor(Math.random() * 200);
      logger.info("vision", `Retrying vision call (${attempt}/${MAX_RETRIES + 1})`, { delay });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      const fetchSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000);

      const response = await fetch(OPENROUTER_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "chrome-extension://opensidebar",
          "X-Title": "OpenSidebar",
        },
        body: JSON.stringify({
          model: visionModel,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: VISION_PROMPT },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
          max_tokens: 500,
          temperature: 0.2,
        }),
        signal: fetchSignal,
      });

      if (!response.ok) {
        const body = await response.text();
        const err = new Error(`Vision API error ${response.status}: ${body}`);

        // Don't retry on client errors (4xx except 429)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          logger.error("vision", "Non-retryable vision error", { status: response.status, body });
          return { description: `[Screenshot captured but vision analysis failed: ${response.status} error]` };
        }

        throw err;
      }

      const json = await response.json();
      const text = json.choices?.[0]?.message?.content;

      if (!text) {
        logger.warn("vision", "Vision model returned empty content");
        return { description: "[Screenshot captured but vision model returned no description]" };
      }

      const visionUsage: TokenUsage | undefined = json.usage ? {
        prompt_tokens: json.usage.prompt_tokens ?? 0,
        completion_tokens: json.usage.completion_tokens ?? 0,
        total_tokens: json.usage.total_tokens ?? 0,
        cost: json.usage.cost,
      } : undefined;

      logger.info("vision", "Screenshot described", { length: text.length });
      return {
        description: `[Screenshot Description]\n${text}`,
        usage: visionUsage,
        model: visionModel,
        durationMs: Date.now() - callStart,
      };
    } catch (error: any) {
      // Abort errors are non-retryable — return gracefully
      if (error.name === "AbortError" || error.name === "TimeoutError") {
        logger.warn("vision", "Vision aborted or timed out", { error: error.message });
        return { description: `[Screenshot captured but vision analysis was aborted]` };
      }
      lastError = error;
      logger.warn("vision", `Vision attempt ${attempt} failed`, { error: error.message });

      // If this was our last attempt, break
      if (attempt >= MAX_RETRIES + 1) break;
    }
  }

  const errorMsg = lastError?.message || "Unknown error";
  logger.error("vision", "Vision failed after all retries", { error: errorMsg });
  return { description: `[Screenshot captured but vision analysis failed: ${errorMsg}]` };
}
