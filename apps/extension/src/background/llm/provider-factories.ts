/**
 * Direct-provider endpoint configuration.
 *
 * Each factory builds the ProviderConfig for one OpenAI-compatible upstream.
 * Extracted from client.ts so adding a provider does not grow the client.
 */

import type { ProviderConfig } from "./types";
import { sanitizeApiKeyForHeader } from "./provider-headers";

export function openAIProvider(apiKey: string): ProviderConfig {
  return {
    baseUrl: OPENAI_BASE_URL,
    apiKey: sanitizeApiKeyForHeader(apiKey, "fireworks"),
    headers: {},
    providerId: "fireworks",
  };
}

export function groqProvider(apiKey: string): ProviderConfig {
  return {
    baseUrl: GROQ_BASE_URL,
    apiKey: sanitizeApiKeyForHeader(apiKey, "groq"),
    headers: {},
    providerId: "groq",
  };
}

export function fireworksProvider(apiKey: string): ProviderConfig {
  return {
    baseUrl: FIREWORKS_BASE_URL,
    apiKey: sanitizeApiKeyForHeader(apiKey, "fireworks"),
    headers: {},
    providerId: "fireworks",
  };
}

export function moonshotProvider(apiKey: string): ProviderConfig {
  return {
    baseUrl: MOONSHOT_BASE_URL,
    apiKey: sanitizeApiKeyForHeader(apiKey, "moonshot"),
    headers: {},
    providerId: "moonshot",
  };
}

export function xiaomiProvider(apiKey: string): ProviderConfig {
  return {
    baseUrl: XIAOMI_BASE_URL,
    apiKey: sanitizeApiKeyForHeader(apiKey, "xiaomi"),
    headers: {},
    providerId: "xiaomi",
  };
}

export function deepseekProvider(apiKey: string): ProviderConfig {
  return {
    baseUrl: DEEPSEEK_BASE_URL,
    apiKey: sanitizeApiKeyForHeader(apiKey, "deepseek"),
    headers: {},
    providerId: "deepseek",
  };
}

export function cerebrasProvider(apiKey: string): ProviderConfig {
  return {
    baseUrl: CEREBRAS_BASE_URL,
    apiKey: sanitizeApiKeyForHeader(apiKey, "cerebras"),
    headers: {},
    providerId: "cerebras",
  };
}

/** OpenAI direct API — redirected to Fireworks */
export const OPENAI_BASE_URL =
  "https://api.fireworks.ai/inference/v1/chat/completions";

/** Groq direct API */
export const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";

/** Moonshot direct API */
export const MOONSHOT_BASE_URL = "https://api.moonshot.ai/v1/chat/completions";

/** Xiaomi MiMo direct API */
export const XIAOMI_BASE_URL = "https://api.xiaomimimo.com/v1/chat/completions";

/** DeepSeek direct API (planner/verifier only; executor remains Fireworks). */
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com/chat/completions";

/** Fireworks AI direct API */
export const FIREWORKS_BASE_URL =
  "https://api.fireworks.ai/inference/v1/chat/completions";

/** Cerebras direct API (executor only; planner remains Fireworks). */
export const CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1/chat/completions";
