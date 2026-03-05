/**
 * Router / Classifier — Lightweight pre-planner query routing.
 *
 * Classifies user queries into three routes:
 *   - direct: Q&A from page context, skip planner
 *   - agent:  Clear single objective, skip planner
 *   - plan:   Multi-step / ambiguous, use full planner pipeline
 *
 * Uses OpenRouter as the sole provider.
 * Follows the perception.ts pattern: standalone fetch, no LLMClient dependency.
 */

import { UserSettings } from "../../types";
import { renderPrompt } from "../../prompts";
import { logger } from "../../utils";
import { stripThinkTags } from "../llm";

export type Route = "direct" | "agent" | "plan";

export interface RouteDecision {
  route: Route;
  confidence: number;
  reason: string;
}

interface RouterProvider {
  baseUrl: string;
  apiKey: string;
  headers: Record<string, string>;
  model: string;
  providerId: string;
}

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

const MODEL_OPENROUTER = "openai/gpt-oss-120b";

const ROUTER_TIMEOUT_MS = 8_000;

const FALLBACK_DECISION: RouteDecision = {
  route: "agent",
  confidence: 0.5,
  reason: "Router fallback",
};

const VALID_ROUTES = new Set<Route>(["direct", "agent", "plan"]);

/** Build ordered list of router providers from available API keys. */
function buildProviders(settings: UserSettings): RouterProvider[] {
  const providers: RouterProvider[] = [];

  const openRouterKey = settings.openRouterApiKey;
  if (openRouterKey) {
    providers.push({
      baseUrl: OPENROUTER_API_URL,
      apiKey: openRouterKey,
      headers: {
        "HTTP-Referer": "chrome-extension://opensidebar",
        "X-Title": "OpenSidebar",
      },
      model: MODEL_OPENROUTER,
      providerId: "openrouter",
    });
  }

  return providers;
}

/** Parse and validate the LLM's JSON response into a RouteDecision. */
function parseRouteResponse(raw: string): RouteDecision | null {
  try {
    const cleaned = stripThinkTags(raw).trim();
    // Extract JSON from potential markdown code fences
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.route || !VALID_ROUTES.has(parsed.route)) return null;

    return {
      route: parsed.route,
      confidence:
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.7,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
    };
  } catch {
    return null;
  }
}

/**
 * Classify a user query into a routing tier.
 *
 * Returns quickly (~100-200ms). On any failure,
 * defaults to "agent" (safe middle ground).
 */
export async function classifyRoute(
  query: string,
  pageTitle: string,
  pageUrl: string,
  settings: UserSettings,
): Promise<RouteDecision> {
  const providers = buildProviders(settings);
  if (providers.length === 0) {
    logger.debug("router", "No API keys available, using fallback");
    return FALLBACK_DECISION;
  }

  const systemPrompt = renderPrompt("orchestrator.router.system", {
    pageTitle,
    pageUrl,
  });

  for (let pi = 0; pi < providers.length; pi++) {
    const provider = providers[pi];

    try {
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
            { role: "system", content: systemPrompt },
            { role: "user", content: query },
          ],
          max_tokens: 512,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(ROUTER_TIMEOUT_MS),
      });

      if (!response.ok) {
        logger.warn(
          "router",
          `${provider.providerId} returned ${response.status}`,
        );
        // 429 or 4xx: try next provider
        if (response.status >= 400 && response.status < 500) continue;
        // 5xx: also try next provider (no retries — speed is paramount)
        continue;
      }

      const json = await response.json();
      const text: string | undefined = json.choices?.[0]?.message?.content;
      if (!text) {
        logger.warn("router", `${provider.providerId} returned empty content`);
        continue;
      }

      const decision = parseRouteResponse(text);
      if (!decision) {
        logger.warn(
          "router",
          `${provider.providerId} returned unparseable response`,
          {
            raw: text.slice(0, 200),
          },
        );
        continue;
      }

      logger.info("router", `Classified as ${decision.route}`, {
        provider: provider.providerId,
        confidence: decision.confidence,
        reason: decision.reason,
      });
      return decision;
    } catch (error: any) {
      if (error.name === "AbortError" || error.name === "TimeoutError") {
        logger.warn("router", `${provider.providerId} timed out`);
      } else {
        logger.warn("router", `${provider.providerId} failed`, {
          error: error.message,
        });
      }
      // Try next provider
      if (pi < providers.length - 1) {
        logger.debug("router", "Falling back to next provider", {
          from: provider.providerId,
          to: providers[pi + 1].providerId,
        });
      }
    }
  }

  logger.warn("router", "All providers failed, using fallback");
  return FALLBACK_DECISION;
}
