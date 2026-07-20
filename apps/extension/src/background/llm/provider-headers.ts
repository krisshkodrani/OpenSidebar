/**
 * Provider HTTP identity — header hygiene and provider display metadata.
 *
 * API keys arrive from Settings as user-pasted text, so they can carry
 * zero-width paste artifacts, wrapping quotes, or non-ISO-8859-1 characters
 * that make fetch() reject the whole request. Everything that turns a stored
 * credential into a safe header lives here, together with the display
 * name/credits-URL lookups used to phrase provider-facing errors.
 */

import { CompletionRequest, ProviderConfig } from "./types";

const HEADER_PASTE_ARTIFACTS = /[\u200B-\u200D\uFEFF]/g;
const WRAPPING_QUOTES = /^[`"'\u201C\u201D\u2018\u2019]+|[`"'\u201C\u201D\u2018\u2019]+$/g;

function normalizeHeaderCredential(value: string): string {
  return value
    .replace(HEADER_PASTE_ARTIFACTS, "")
    .trim()
    .replace(WRAPPING_QUOTES, "");
}

export function assertIso88591HeaderValue(
  name: string,
  value: string,
  providerId: ProviderConfig["providerId"],
): string {
  for (const ch of value) {
    if (ch.charCodeAt(0) > 0xff) {
      const providerName = getProviderDisplayName(providerId);
      throw new Error(
        `${providerName} request header "${name}" contains a non-ISO-8859-1 character. Re-paste the API key/header as plain text in Settings.`,
      );
    }
  }
  return value;
}

export function sanitizeApiKeyForHeader(
  apiKey: string,
  providerId: ProviderConfig["providerId"],
): string {
  return assertIso88591HeaderValue(
    "Authorization",
    normalizeHeaderCredential(apiKey),
    providerId,
  );
}

export function buildJsonHeaders(
  provider: ProviderConfig,
  request?: Pick<CompletionRequest, "sessionAffinityId" | "multiTurnSessionId">,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey}`,
    ...provider.headers,
  };

  if (provider.providerId === "fireworks") {
    if (request?.sessionAffinityId) {
      headers["x-session-affinity"] = request.sessionAffinityId;
    }
    if (request?.multiTurnSessionId) {
      headers["x-multi-turn-session-id"] = request.multiTurnSessionId;
    }
  }

  for (const [name, value] of Object.entries(headers)) {
    assertIso88591HeaderValue(name, value, provider.providerId);
  }
  return headers;
}

export function getProviderDisplayName(
  providerId: ProviderConfig["providerId"],
): string {
  switch (providerId) {
    case "fireworks":
      return "Fireworks AI";
    case "moonshot":
      return "Moonshot AI";
    case "xiaomi":
      return "Xiaomi MiMo";
    case "deepseek":
      return "DeepSeek";
    case "cerebras":
      return "Cerebras";
    case "groq":
      return "Groq";
    case "openai":
      return "OpenAI";
    default:
      return "OpenRouter";
  }
}

export function getProviderCreditsUrl(
  providerId: ProviderConfig["providerId"],
): string | null {
  switch (providerId) {
    case "openrouter":
      return "https://openrouter.ai/credits";
    case "fireworks":
      return "https://fireworks.ai";
    case "moonshot":
      return "https://platform.kimi.ai";
    case "xiaomi":
      return "https://platform.xiaomimimo.com";
    case "deepseek":
      return "https://platform.deepseek.com";
    case "cerebras":
      return "https://cloud.cerebras.ai";
    case "groq":
      return "https://console.groq.com";
    case "openai":
      return "https://platform.openai.com";
    default:
      return null;
  }
}
