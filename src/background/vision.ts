import { UserSettings } from "../types";
import { logger } from "../utils";
import { stripThinkTags } from "./llm";
import { TokenUsage } from "./llm/types";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_VISION_MODEL = "qwen/qwen3-vl-235b-a22b-instruct";
const VISION_TIMEOUT_MS = 25_000;

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 800;

const VISION_PROMPT = `You are a vision module for a browser automation agent. Analyze this screenshot and report what the agent needs to act.

Report:
1. PAGE IDENTITY: Page type and title/heading visible.
2. KEY UI STATE: Which tab/section is active, open dropdowns/menus, selected items, focused inputs, toggle states. Note any modals, dialogs, or overlays blocking the page.
3. ACTIONABLE ELEMENTS: Buttons, links, inputs, and controls visible — describe their label and approximate screen position (top-left, center, bottom-right, etc.).
4. ERRORS & FEEDBACK: Toast messages, validation errors, alerts, loading spinners — quote exact text.
5. NON-DOM CONTENT: Text inside images, canvas elements, charts, SVGs, or iframes that DOM inspection would miss.
6. SCROLL POSITION: Whether more content exists above/below the visible area.

Be terse. Use sentence fragments. No aesthetic commentary.`;

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
        ? AbortSignal.any([signal, AbortSignal.timeout(VISION_TIMEOUT_MS)])
        : AbortSignal.timeout(VISION_TIMEOUT_MS);

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
          max_tokens: 800,
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

      const cleaned = stripThinkTags(text);

      const visionUsage: TokenUsage | undefined = json.usage ? {
        prompt_tokens: json.usage.prompt_tokens ?? 0,
        completion_tokens: json.usage.completion_tokens ?? 0,
        total_tokens: json.usage.total_tokens ?? 0,
        cost: json.usage.cost,
      } : undefined;

      logger.info("vision", "Screenshot described", { length: cleaned.length });
      return {
        description: `[Screenshot Description]\n${cleaned}`,
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
