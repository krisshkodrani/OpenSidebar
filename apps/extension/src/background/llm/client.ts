import { ToolCall, ToolName } from "../../types";
import { logger } from "../../utils";
import {
  isVLCapable as isExecutorVLCapable,
  normalizeExecutorFallbackModel,
  normalizeExecutorModel,
  type ProviderMode,
} from "../../utils/executor-model-policy";
import { parseSSEStream } from "../streaming";
import {
  CompletionRequest,
  CompletionResponse,
  LLMMessage,
  LLMToolCall,
  PromptCacheTelemetry,
  ProviderConfig,
  TokenUsage,
} from "./types";
import { LLM_MODEL_CONFIG } from "../../config/model-config";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";

const HEADER_PASTE_ARTIFACTS = /[\u200B-\u200D\uFEFF]/g;
const WRAPPING_QUOTES = /^[`"'\u201C\u201D\u2018\u2019]+|[`"'\u201C\u201D\u2018\u2019]+$/g;

/** Delay that can be cancelled via an AbortSignal. */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((r) => setTimeout(r, ms));
  if (signal.aborted)
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Executor model tier — used for initial turns (Fireworks Kimi K2.5 Turbo) */
export const MODEL_EXECUTOR =
  LLM_MODEL_CONFIG.executor;
/** Fallback: same model (no :nitro variant on Fireworks) */
export const MODEL_EXECUTOR_EMPTY_RESPONSE_FALLBACK =
  LLM_MODEL_CONFIG.executorEmptyResponseFallback;
/** Planner model tier — used after escalation (Fireworks Kimi K2.5 Turbo) */
export const MODEL_PLANNER = LLM_MODEL_CONFIG.planner;

/** OpenAI direct API — redirected to Fireworks */
const OPENAI_BASE_URL =
  "https://api.fireworks.ai/inference/v1/chat/completions";
export const OPENAI_MODEL_EXECUTOR =
  LLM_MODEL_CONFIG.openai.executor;
export const OPENAI_MODEL_PLANNER = LLM_MODEL_CONFIG.openai.planner;
export const OPENAI_MODEL_PERCEPTION = LLM_MODEL_CONFIG.openai.perception;

/** Groq direct API */
const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
export const GROQ_MODEL_PLANNER = LLM_MODEL_CONFIG.groq.planner;
export const GROQ_MODEL_PERCEPTION = LLM_MODEL_CONFIG.groq.perception;

function normalizeHeaderCredential(value: string): string {
  return value
    .replace(HEADER_PASTE_ARTIFACTS, "")
    .trim()
    .replace(WRAPPING_QUOTES, "");
}

function assertIso88591HeaderValue(
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

function sanitizeApiKeyForHeader(
  apiKey: string,
  providerId: ProviderConfig["providerId"],
): string {
  return assertIso88591HeaderValue(
    "Authorization",
    normalizeHeaderCredential(apiKey),
    providerId,
  );
}

function buildJsonHeaders(
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

function parsePositiveIntHeader(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function readProviderCacheTelemetry(
  providerId: ProviderConfig["providerId"],
  headers: Headers,
): PromptCacheTelemetry | undefined {
  if (providerId !== "fireworks") return undefined;
  const promptTokens = parsePositiveIntHeader(headers, "fireworks-prompt-tokens");
  const cachedPromptTokens = parsePositiveIntHeader(
    headers,
    "fireworks-cached-prompt-tokens",
  );
  if (promptTokens == null && cachedPromptTokens == null) {
    logger.debug("agent", "Fireworks cache telemetry headers absent");
    return undefined;
  }
  const cacheHitPct =
    promptTokens && cachedPromptTokens != null
      ? Math.round((cachedPromptTokens / promptTokens) * 10000) / 100
      : undefined;
  return {
    provider: providerId,
    promptTokens,
    cachedPromptTokens,
    cacheHitPct,
    source: "response_headers",
  };
}

function mergeCacheTelemetry(
  usage: TokenUsage | undefined,
  telemetry: PromptCacheTelemetry | undefined,
): TokenUsage | undefined {
  if (!usage) return usage;
  if (!telemetry) return usage;
  const promptTokens = telemetry.promptTokens ?? usage.prompt_tokens;
  const cachedTokens = telemetry.cachedPromptTokens ?? usage.cached_tokens;
  return {
    ...usage,
    prompt_tokens: promptTokens,
    cached_tokens: cachedTokens,
    cacheTelemetry: {
      ...telemetry,
      promptTokens,
      cachedPromptTokens: cachedTokens,
      cacheHitPct:
        promptTokens > 0 && cachedTokens != null
          ? Math.round((cachedTokens / promptTokens) * 10000) / 100
          : telemetry.cacheHitPct,
    },
  };
}

function withUsageCacheTelemetry(
  usage: TokenUsage | undefined,
  providerId: ProviderConfig["providerId"],
): TokenUsage | undefined {
  if (!usage || usage.cached_tokens == null) return usage;
  const cacheHitPct =
    usage.prompt_tokens > 0
      ? Math.round((usage.cached_tokens / usage.prompt_tokens) * 10000) / 100
      : undefined;
  return {
    ...usage,
    cacheTelemetry: {
      provider: providerId,
      promptTokens: usage.prompt_tokens,
      cachedPromptTokens: usage.cached_tokens,
      cacheHitPct,
      source: "usage",
    },
  };
}

/** Moonshot direct API */
const MOONSHOT_BASE_URL = "https://api.moonshot.ai/v1/chat/completions";
export const MOONSHOT_MODEL_EXECUTOR =
  LLM_MODEL_CONFIG.moonshot.executor;
export const MOONSHOT_MODEL_PLANNER = LLM_MODEL_CONFIG.moonshot.planner;
export const MOONSHOT_MODEL_PERCEPTION = LLM_MODEL_CONFIG.moonshot.perception;

/** Xiaomi MiMo direct API */
const XIAOMI_BASE_URL = "https://api.xiaomimimo.com/v1/chat/completions";
export const XIAOMI_MODEL_EXECUTOR =
  LLM_MODEL_CONFIG.xiaomi.executor;
export const XIAOMI_MODEL_PLANNER = LLM_MODEL_CONFIG.xiaomi.planner;
export const XIAOMI_MODEL_PERCEPTION = LLM_MODEL_CONFIG.xiaomi.perception;

/** DeepSeek direct API (planner/verifier only; executor remains Fireworks). */
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/chat/completions";
export const DEEPSEEK_MODEL_PLANNER = LLM_MODEL_CONFIG.deepseek.planner;
export const DEEPSEEK_MODEL_PLANNER_PRO = LLM_MODEL_CONFIG.deepseek.plannerPro;

function openAIProvider(apiKey: string): ProviderConfig {
  return {
    baseUrl: OPENAI_BASE_URL,
    apiKey: sanitizeApiKeyForHeader(apiKey, "fireworks"),
    headers: {},
    providerId: "fireworks",
  };
}

function groqProvider(apiKey: string): ProviderConfig {
  return {
    baseUrl: GROQ_BASE_URL,
    apiKey: sanitizeApiKeyForHeader(apiKey, "groq"),
    headers: {},
    providerId: "groq",
  };
}

/** Fireworks AI direct API */
const FIREWORKS_BASE_URL =
  "https://api.fireworks.ai/inference/v1/chat/completions";
export const FIREWORKS_MODEL_EXECUTOR =
  LLM_MODEL_CONFIG.fireworks.executor;
export const FIREWORKS_MODEL_PLANNER = LLM_MODEL_CONFIG.fireworks.planner;

/** Check if a model supports unified VL executor mode (vision + tool calling). */
export const isVLCapable = isExecutorVLCapable;

function fireworksProvider(apiKey: string): ProviderConfig {
  return {
    baseUrl: FIREWORKS_BASE_URL,
    apiKey: sanitizeApiKeyForHeader(apiKey, "fireworks"),
    headers: {},
    providerId: "fireworks",
  };
}

function moonshotProvider(apiKey: string): ProviderConfig {
  return {
    baseUrl: MOONSHOT_BASE_URL,
    apiKey: sanitizeApiKeyForHeader(apiKey, "moonshot"),
    headers: {},
    providerId: "moonshot",
  };
}

function xiaomiProvider(apiKey: string): ProviderConfig {
  return {
    baseUrl: XIAOMI_BASE_URL,
    apiKey: sanitizeApiKeyForHeader(apiKey, "xiaomi"),
    headers: {},
    providerId: "xiaomi",
  };
}

function deepseekProvider(apiKey: string): ProviderConfig {
  return {
    baseUrl: DEEPSEEK_BASE_URL,
    apiKey: sanitizeApiKeyForHeader(apiKey, "deepseek"),
    headers: {},
    providerId: "deepseek",
  };
}

/** Options for overriding default models in LLMClient */
export interface LLMClientOptions {
  executorModel?: string;
  executorFallbackModel?: string;
  plannerModel?: string;
  /** Append :nitro routing suffix to all model IDs (OpenRouter only) */
  useNitro?: boolean;
  /** Provider mode: how executor and planner providers are combined */
  providerMode?:
    | "openrouter"
    | "openrouter-groq"
    | "openai-groq"
    | "fireworks"
    | "fireworks-deepseek"
    | "moonshot"
    | "xiaomi";
  /** @deprecated Use providerMode instead */
  provider?: "openrouter" | "openai" | "groq";
  /** OpenAI API key (required for openai-groq mode) */
  openaiApiKey?: string;
  /** Groq API key (required for hybrid modes) */
  groqApiKey?: string;
  /** Fireworks AI API key (required for fireworks mode) */
  fireworksApiKey?: string;
  /** DeepSeek API key (required for fireworks-deepseek planner/verifier mode) */
  deepseekApiKey?: string;
  /** Moonshot AI API key (required for moonshot mode) */
  kimiApiKey?: string;
  /** Xiaomi MiMo API key (required for xiaomi mode) */
  xiaomiApiKey?: string;
  /** Override default temperature (default: 0.0) */
  temperature?: number;
}

/** Append `:nitro` suffix if enabled and not already present */
export function applyNitro(model: string, useNitro?: boolean): string {
  if (!useNitro || model.endsWith(":nitro")) return model;
  return `${model}:nitro`;
}

function openRouterProvider(apiKey: string): ProviderConfig {
  return {
    baseUrl: OPENROUTER_BASE_URL,
    apiKey: sanitizeApiKeyForHeader(apiKey, "openrouter"),
    headers: {
      "HTTP-Referer": "https://github.com/OpenSidebar/OpenSidebar",
      "X-Title": "OpenSidebar",
    },
    providerId: "openrouter",
  };
}

function getProviderDisplayName(
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
    case "groq":
      return "Groq";
    case "openai":
      return "OpenAI";
    default:
      return "OpenRouter";
  }
}

function getProviderCreditsUrl(
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
    case "groq":
      return "https://console.groq.com";
    case "openai":
      return "https://platform.openai.com";
    default:
      return null;
  }
}

function shapePayloadForProvider(
  providerId: ProviderConfig["providerId"],
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (providerId !== "moonshot") return payload;

  const shaped = { ...payload };
  if (shaped.max_tokens !== undefined) {
    shaped.max_completion_tokens = shaped.max_tokens;
    delete shaped.max_tokens;
  }
  delete shaped.temperature;
  shaped.thinking = { type: "disabled" };
  return shaped;
}

/** Extract reasoning content from model output: XML think tags and markdown Think/Observe/Verify sections */
export function extractThinkContent(text: string): string | null {
  const blocks: string[] = [];
  // XML <think>...</think> blocks
  const xmlRe = /<think>([\s\S]*?)<\/think>/g;
  let m: RegExpExecArray | null;
  while ((m = xmlRe.exec(text)) !== null) {
    const inner = m[1].trim();
    if (inner) blocks.push(inner);
  }
  // Markdown **Think**/**Observe**/**Verify** sections (up to **Act** or end)
  const mdRe = /\*\*(Think|Observe|Verify)\*\*\s*([\s\S]*?)(?=\*\*Act\*\*|$)/gi;
  while ((m = mdRe.exec(text)) !== null) {
    const inner = m[2].trim();
    if (inner) blocks.push(inner);
  }
  return blocks.length > 0 ? blocks.join("\n\n") : null;
}

/** Strip reasoning blocks from model output: XML think tags and markdown Think/Verify sections */
export function stripThinkTags(text: string): string {
  // XML think blocks
  let result = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  // Markdown Think/Observe/Verify sections
  result = result
    .replace(/\*\*(?:Think|Observe|Verify)\*\*[\s\S]*?(?=\*\*Act\*\*|$)/gi, "")
    .trim();
  // Strip **Act** header itself (keep content after it)
  result = result.replace(/\*\*Act\*\*:?\s*/gi, "").trim();
  return result;
}

/**
 * Returns how many trailing chars of `text` match a prefix of `tag`.
 * Used to avoid emitting/discarding a partial tag boundary during streaming.
 */
function partialTagLen(text: string, tag: string): number {
  const max = Math.min(tag.length - 1, text.length);
  for (let i = max; i >= 1; i--) {
    if (text.endsWith(tag.slice(0, i))) return i;
  }
  return 0;
}

/** Streaming filter that suppresses <think>...</think> blocks across chunk boundaries. */
function createThinkFilter(emit: (text: string) => void) {
  let buf = "";
  let inside = false;
  return {
    push(delta: string) {
      buf += delta;
      while (buf) {
        if (inside) {
          const idx = buf.indexOf("</think>");
          if (idx === -1) {
            const keep = partialTagLen(buf, "</think>");
            buf = keep > 0 ? buf.slice(-keep) : "";
            return;
          }
          buf = buf.slice(idx + "</think>".length);
          inside = false;
        } else {
          const idx = buf.indexOf("<think>");
          if (idx === -1) {
            const keep = partialTagLen(buf, "<think>");
            const safe = buf.length - keep;
            if (safe > 0) emit(buf.slice(0, safe));
            buf = keep > 0 ? buf.slice(-keep) : "";
            return;
          }
          if (idx > 0) emit(buf.slice(0, idx));
          buf = buf.slice(idx + "<think>".length);
          inside = true;
        }
      }
    },
    flush() {
      if (!inside && buf) {
        emit(buf);
        buf = "";
      }
    },
  };
}

function hasImageUrlContent(messages: LLMMessage[]): boolean {
  return messages.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === "image_url"),
  );
}

function toTextOnlyMessages(messages: LLMMessage[]): LLMMessage[] {
  return messages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    const text = message.content
      .map((part) =>
        part.type === "text"
          ? part.text
          : "[image omitted: model does not support image_url]",
      )
      .join("\n");
    return {
      ...message,
      content: text,
    };
  });
}

function isImageUrlUnsupported(status: number, errorText: string): boolean {
  if (status !== 422) return false;
  const normalized = errorText.toLowerCase();
  return (
    normalized.includes("image_url") &&
    (normalized.includes("not supported") ||
      normalized.includes("only 'text' content type") ||
      normalized.includes("wrong_api_format"))
  );
}

// --- Provider Pool (configured-slot failover) ---

const COOLDOWN_MS = 60_000;

export interface ProviderSlot {
  provider: ProviderConfig;
  cooldownUntil: number;
  model: string;
}

export interface ProviderPoolSlotInput {
  provider: ProviderConfig;
  model: string;
  cooldownUntil?: number;
}

export interface ProviderPoolConfig {
  slots: ProviderPoolSlotInput[];
}

export function singleProviderPool(
  provider: ProviderConfig,
  model: string,
): ProviderPool {
  return new ProviderPool({ slots: [{ provider, model }] });
}

export function openRouterProviderPool(
  openRouterKey: string,
  model: string,
): ProviderPool {
  return singleProviderPool(openRouterProvider(openRouterKey), model);
}

export class ProviderPool {
  private slots: ProviderSlot[];

  constructor(config: ProviderPoolConfig) {
    if (config.slots.length === 0) {
      throw new Error("ProviderPool requires at least one provider slot");
    }
    this.slots = config.slots.map((slot) => ({
      provider: slot.provider,
      cooldownUntil: slot.cooldownUntil ?? 0,
      model: slot.model,
    }));
  }

  /** Returns highest-priority provider not on cooldown */
  getActive(): ProviderSlot {
    const now = Date.now();
    return (
      this.slots.find((s) => now >= s.cooldownUntil) ??
      this.slots[this.slots.length - 1]
    );
  }

  /** Mark a provider as rate-limited */
  cooldown(providerId: string): void {
    const slot = this.slots.find((s) => s.provider.providerId === providerId);
    if (slot) slot.cooldownUntil = Date.now() + COOLDOWN_MS;
  }

  /** Get next provider in chain for immediate failover */
  getNextFallback(afterProviderId: string): ProviderSlot | null {
    const idx = this.slots.findIndex(
      (s) => s.provider.providerId === afterProviderId,
    );
    if (idx === -1 || idx >= this.slots.length - 1) return null;
    const now = Date.now();
    for (let i = idx + 1; i < this.slots.length; i++) {
      if (now >= this.slots[i].cooldownUntil) return this.slots[i];
    }
    return this.slots[this.slots.length - 1];
  }

  /** Permanently disable a provider for the rest of this session (e.g. 402 credit exhaustion) */
  disableForSession(providerId: string): void {
    const slot = this.slots.find((s) => s.provider.providerId === providerId);
    if (slot) slot.cooldownUntil = Number.MAX_SAFE_INTEGER;
  }

  /** Check if a provider has been permanently disabled this session */
  isDisabled(providerId: string): boolean {
    const slot = this.slots.find((s) => s.provider.providerId === providerId);
    return slot ? slot.cooldownUntil === Number.MAX_SAFE_INTEGER : false;
  }

  /** True when every provider slot is on cooldown or permanently disabled */
  allDisabled(): boolean {
    return this.slots.every((s) => Date.now() < s.cooldownUntil);
  }

  /** Get all slots (for testing) */
  getSlots(): ProviderSlot[] {
    return this.slots;
  }
}

/**
 * Annotate system message with cache_control for OpenRouter prefix caching.
 * The static prefix (rules, persona, demo catalog) is stable across turns,
 * so marking the system message as ephemeral enables provider-side caching.
 * Skipped for non-OpenRouter providers (Groq/OpenAI reject unknown fields).
 */
function annotateCacheControl(
  messages: LLMMessage[],
  providerId: string,
): LLMMessage[] {
  if (providerId !== "openrouter") return messages;
  if (messages.length === 0 || messages[0].role !== "system") return messages;
  const systemMsg: LLMMessage = {
    ...messages[0],
    cache_control: { type: "ephemeral" as const },
  };
  return [systemMsg, ...messages.slice(1)];
}

/**
 * Sanitize messages for strict providers (Groq requires type:"function" on tool_calls).
 * OpenRouter and OpenAI are lenient about missing `type` fields, but Groq rejects them.
 */
function sanitizeToolCallMessages(
  messages: LLMMessage[],
  providerId: string,
): LLMMessage[] {
  if (providerId !== "groq") return messages;
  return messages.map((msg) => {
    if (msg.role !== "assistant" || !msg.tool_calls) return msg;
    return {
      ...msg,
      tool_calls: msg.tool_calls.map((tc) => ({
        ...tc,
        type: "function" as const,
      })),
    };
  });
}

/**
 * LLM Client for OpenSidebar
 * Handles communication with LLM APIs via priority-based provider failover
 */

export class LLMClient {
  private provider: ProviderConfig;
  private model: string;
  private openRouterApiKey: string;
  /** Configured provider pool for executor model failover */
  private executorPool: ProviderPool;
  /** Configured provider pool for planner model failover */
  private plannerPool: ProviderPool;
  /** Whether the client is currently in planner model tier */
  private _isPlannerTier = false;
  private executorModelOverride: string | null = null;
  private defaultTemperature: number = 0.0;
  private executorFallbackModel: string | null = null;

  /**
   * Creates a new LLM client.
   * @param openRouterApiKey - OpenRouter key (required as default provider)
   * @param options - Provider selection, model overrides, and feature flags
   */
  constructor(openRouterApiKey: string, options?: LLMClientOptions) {
    this.openRouterApiKey = openRouterApiKey;
    this.defaultTemperature = options?.temperature ?? 0.0;

    // Resolve providerMode (supports legacy `provider` field for backward compat)
    let mode: ProviderMode = options?.providerMode ?? "openrouter";
    if (!options?.providerMode && options?.provider) {
      // Migrate legacy provider field
      if (options.provider === "groq" && options.groqApiKey)
        mode = "openrouter-groq";
      else if (options.provider === "openai" && options.openaiApiKey)
        mode = "openai-groq";
    }

    const nitro = options?.useNitro;
    const hasGroq = !!options?.groqApiKey;
    const hasOpenAI = !!options?.openaiApiKey;
    const hasFireworks = !!options?.fireworksApiKey;
    const hasMoonshot = !!options?.kimiApiKey;
    const hasXiaomi = !!options?.xiaomiApiKey;

    // --- Build executor pool ---
    if (mode === "fireworks-deepseek") {
      const fwKey = options?.fireworksApiKey ?? "";
      const fwProv = fireworksProvider(fwKey);
      const executorModel = normalizeExecutorModel({
        providerMode: "fireworks-deepseek",
        executorModel: options?.executorModel,
      });
      this.executorPool = singleProviderPool(fwProv, executorModel);
      this.executorFallbackModel = normalizeExecutorFallbackModel({
        providerMode: "fireworks-deepseek",
        executorModel,
        executorFallbackModel: options?.executorFallbackModel,
      });
    } else if (mode === "moonshot" && hasMoonshot) {
      const kimiKey = options!.kimiApiKey!;
      const kimiProv = moonshotProvider(kimiKey);
      const executorModel = normalizeExecutorModel({
        providerMode: "moonshot",
        executorModel: options?.executorModel,
      });
      this.executorPool = singleProviderPool(kimiProv, executorModel);
      this.executorFallbackModel = normalizeExecutorFallbackModel({
        providerMode: "moonshot",
        executorModel,
        executorFallbackModel: options?.executorFallbackModel,
      });
    } else if (mode === "xiaomi" && hasXiaomi) {
      const xiaomiKey = options!.xiaomiApiKey!;
      const xiaomiProv = xiaomiProvider(xiaomiKey);
      const executorModel = normalizeExecutorModel({
        providerMode: "xiaomi",
        executorModel: options?.executorModel,
      });
      this.executorPool = singleProviderPool(xiaomiProv, executorModel);
      this.executorFallbackModel = normalizeExecutorFallbackModel({
        providerMode: "xiaomi",
        executorModel,
        executorFallbackModel: options?.executorFallbackModel,
      });
    } else if (mode === "fireworks" && hasFireworks) {
      const fwKey = options!.fireworksApiKey!;
      const fwProv = fireworksProvider(fwKey);
      const executorModel = normalizeExecutorModel({
        providerMode: "fireworks",
        executorModel: options?.executorModel,
      });
      this.executorPool = singleProviderPool(fwProv, executorModel);
      this.executorFallbackModel = normalizeExecutorFallbackModel({
        providerMode: "fireworks",
        executorModel,
        executorFallbackModel: options?.executorFallbackModel,
      });
    } else if (mode === "openai-groq" && hasOpenAI) {
      const oaiKey = options!.openaiApiKey!;
      const oaiProv = openAIProvider(oaiKey);
      const executorModel = normalizeExecutorModel({
        providerMode: "openai-groq",
        executorModel: options?.executorModel,
      });
      this.executorPool = singleProviderPool(oaiProv, executorModel);
      this.executorFallbackModel = normalizeExecutorFallbackModel({
        providerMode: "openai-groq",
        executorModel,
        executorFallbackModel: options?.executorFallbackModel,
      });
    } else {
      // OpenRouter for executor (both "openrouter" and "openrouter-groq" modes)
      const executorProviderMode: ProviderMode =
        mode === "openrouter-groq" ? "openrouter-groq" : "openrouter";
      const executorModel = normalizeExecutorModel({
        providerMode: executorProviderMode,
        executorModel: options?.executorModel,
      });
      const executorFallbackModel = normalizeExecutorFallbackModel({
        providerMode: executorProviderMode,
        executorModel,
        executorFallbackModel: options?.executorFallbackModel,
      });
      this.executorPool = openRouterProviderPool(
        openRouterApiKey,
        applyNitro(executorModel, nitro),
      );
      this.executorFallbackModel = applyNitro(executorFallbackModel, nitro);
    }

    // --- Build planner pool ---
    if (mode === "fireworks-deepseek") {
      const deepseekKey = options?.deepseekApiKey ?? "";
      const deepseekProv = deepseekProvider(deepseekKey);
      const plannerModel = options?.plannerModel || DEEPSEEK_MODEL_PLANNER;
      this.plannerPool = singleProviderPool(deepseekProv, plannerModel);
    } else if (mode === "moonshot" && hasMoonshot) {
      const kimiKey = options!.kimiApiKey!;
      const kimiProv = moonshotProvider(kimiKey);
      const plannerModel = options?.plannerModel || MOONSHOT_MODEL_PLANNER;
      this.plannerPool = singleProviderPool(kimiProv, plannerModel);
    } else if (mode === "xiaomi" && hasXiaomi) {
      const xiaomiKey = options!.xiaomiApiKey!;
      const xiaomiProv = xiaomiProvider(xiaomiKey);
      const plannerModel = options?.plannerModel || XIAOMI_MODEL_PLANNER;
      this.plannerPool = singleProviderPool(xiaomiProv, plannerModel);
    } else if (mode === "fireworks" && hasFireworks) {
      const fwKey = options!.fireworksApiKey!;
      const fwProv = fireworksProvider(fwKey);
      const plannerModel = options?.plannerModel || FIREWORKS_MODEL_PLANNER;
      this.plannerPool = singleProviderPool(fwProv, plannerModel);
    } else if (
      (mode === "openrouter-groq" || mode === "openai-groq") &&
      hasGroq
    ) {
      const groqKey = options!.groqApiKey!;
      const groqProv = groqProvider(groqKey);
      const plannerModel = options?.plannerModel || GROQ_MODEL_PLANNER;
      this.plannerPool = singleProviderPool(groqProv, plannerModel);
    } else if (mode === "openai-groq" && hasOpenAI) {
      // No Groq key but OpenAI mode — planner uses OpenAI too
      const oaiKey = options!.openaiApiKey!;
      const oaiProv = openAIProvider(oaiKey);
      const plannerModel = options?.plannerModel || OPENAI_MODEL_PLANNER;
      this.plannerPool = singleProviderPool(oaiProv, plannerModel);
    } else {
      // OpenRouter for planner
      this.plannerPool = openRouterProviderPool(
        openRouterApiKey,
        applyNitro(
          options?.plannerModel || MODEL_PLANNER,
          nitro,
        ),
      );
    }

    // Initialize from executor pool's top priority
    const initialSlot = this.executorPool.getActive();
    this.model = initialSlot.model;
    this.provider = initialSlot.provider;
  }

  /** Whether the client is currently using the planner model tier */
  public isPlannerTier(): boolean {
    return this._isPlannerTier;
  }

  /** Get the currently active model ID */
  public getCurrentModel(): string {
    return this.model;
  }

  /** Get the current provider identifier */
  public getCurrentProvider(): ProviderConfig["providerId"] {
    return this.provider.providerId;
  }

  /** Get provider info for the currently active executor/planner slot */
  public getActiveProviderInfo(): {
    providerId: ProviderConfig["providerId"];
    model: string;
  } {
    const pool = this._isPlannerTier ? this.plannerPool : this.executorPool;
    const slot = pool.getActive();
    return {
      providerId: slot.provider.providerId,
      model:
        !this._isPlannerTier && this.executorModelOverride
          ? this.executorModelOverride
          : slot.model,
    };
  }

  public activateExecutorFallback(
    reason: "empty_response" = "empty_response",
  ): boolean {
    if (this._isPlannerTier) return false;
    if (!this.executorFallbackModel) return false;
    if (this.executorModelOverride === this.executorFallbackModel) return false;

    const previousModel = this.model;
    this.executorModelOverride = this.executorFallbackModel;
    this.model = this.executorFallbackModel;
    logger.warn("agent", "Switching executor model to runtime fallback", {
      reason,
      fromModel: previousModel,
      toModel: this.executorFallbackModel,
      provider: this.provider.providerId,
    });
    return true;
  }

  /**
   * Reset executor fallback after a successful response, restoring the
   * primary model. Keeps the fallback non-sticky so a transient empty
   * response doesn't permanently downgrade the session.
   */
  public resetExecutorFallback(): void {
    if (!this.executorModelOverride) return;
    const slot = this.executorPool.getActive();
    logger.info("agent", "Resetting executor fallback to primary model", {
      fromModel: this.executorModelOverride,
      toModel: slot.model,
    });
    this.executorModelOverride = null;
    this.model = slot.model;
  }

  private onProviderFailover?: (from: string, to: string) => void;

  public setFailoverCallback(cb: (from: string, to: string) => void): void {
    this.onProviderFailover = cb;
  }

  /**
   * Switch to planner model tier. Used during escalation.
   * Reads from planner pool for best available provider.
   */
  public switchToPlanner(): void {
    const slot = this.plannerPool.getActive();
    logger.info("agent", "Switching to planner model", {
      fromModel: this.model,
      fromProvider: this.provider.providerId,
      toModel: slot.model,
      toProvider: slot.provider.providerId,
    });
    this.model = slot.model;
    this.provider = slot.provider;
    this._isPlannerTier = true;
  }

  /**
   * Switch back to executor model. Used during de-escalation when progress resumes.
   * Reads from executor pool to get the fastest available provider (respects cooldowns).
   */
  public switchToExecutor(): void {
    const slot = this.executorPool.getActive();
    this.executorModelOverride = null;
    logger.info("agent", "Switching back to executor model", {
      fromModel: this.model,
      fromProvider: this.provider.providerId,
      toModel: slot.model,
      toProvider: slot.provider.providerId,
    });
    this.model = slot.model;
    this.provider = slot.provider;
    this._isPlannerTier = false;
  }

  /** Rebuild request for a different provider (swaps URL, headers, AND model in body) */
  private rebuildForProvider(
    init: RequestInit,
    slot: ProviderSlot,
  ): { url: string; init: RequestInit } {
    const body = JSON.parse(init.body as string);
    body.model = slot.model;
    delete body.provider;
    const shapedBody = shapePayloadForProvider(slot.provider.providerId, body);
    return {
      url: slot.provider.baseUrl,
      init: {
        ...init,
        headers: buildJsonHeaders(slot.provider),
        body: JSON.stringify(shapedBody),
      },
    };
  }

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    maxRetries: number,
    signal: AbortSignal | undefined,
    providerId: ProviderConfig["providerId"],
    model: string,
  ): Promise<{
    response: Response;
    actualProviderId: ProviderConfig["providerId"];
    actualModel: string;
  }> {
    const RETRYABLE = new Set([429, 502, 503, 504]);
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        const response = await fetch(url, { ...init, signal });
        if (response.ok || !RETRYABLE.has(response.status))
          return { response, actualProviderId: providerId, actualModel: model };
        // Retryable error
        const body = await response.text();
        lastError = new Error(`LLM API Error (${response.status}): ${body}`);

        // Immediate provider failover on 429 (rate limit)
        if (response.status === 429 && providerId) {
          const pool = this._isPlannerTier
            ? this.plannerPool
            : this.executorPool;
          pool.cooldown(providerId);
          const fallback = pool.getNextFallback(providerId);
          if (fallback) {
            logger.warn("agent", "Provider rate-limited, failing over", {
              from: providerId,
              to: fallback.provider.providerId,
              model: fallback.model,
            });
            this.onProviderFailover?.(providerId, fallback.provider.providerId);
            const fb = this.rebuildForProvider(init, fallback);
            try {
              const fbResp = await fetch(fb.url, { ...fb.init, signal });
              if (fbResp.ok || !RETRYABLE.has(fbResp.status))
                return {
                  response: fbResp,
                  actualProviderId: fallback.provider.providerId,
                  actualModel: fallback.model,
                };
              const fbBody = await fbResp.text();
              lastError = new Error(
                `LLM API Error (${fbResp.status}): ${fbBody}`,
              );
            } catch (e: any) {
              if (e.name === "AbortError") throw e;
              lastError = e;
            }
            // Fallback also failed — continue normal retry loop
          }
        }

        // Permanent provider disable on 402 (credit exhaustion)
        if (response.status === 402 && providerId) {
          const pool = this._isPlannerTier
            ? this.plannerPool
            : this.executorPool;
          pool.disableForSession(providerId);
          logger.warn(
            "agent",
            "Provider permanently disabled for session (credit exhaustion)",
            { providerId },
          );
          const fallback = pool.getNextFallback(providerId);
          if (fallback && !pool.isDisabled(fallback.provider.providerId)) {
            this.onProviderFailover?.(providerId, fallback.provider.providerId);
            const fb = this.rebuildForProvider(init, fallback);
            try {
              const fbResp = await fetch(fb.url, { ...fb.init, signal });
              if (fbResp.ok || !RETRYABLE.has(fbResp.status))
                return {
                  response: fbResp,
                  actualProviderId: fallback.provider.providerId,
                  actualModel: fallback.model,
                };
            } catch (e: any) {
              if (e.name === "AbortError") throw e;
              // Fallback failed — fall through to throw
            }
          }
          // No viable fallback — throw immediately (don't retry)
          throw lastError!;
        }
      } catch (e: any) {
        if (e.name === "AbortError") throw e; // Never retry aborts
        lastError = e; // Network error — retryable
      }
      if (attempt < maxRetries) {
        const delay =
          1000 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 300);
        logger.warn(
          "agent",
          `LLM request failed (${providerId ?? "unknown"}), retrying ${attempt}/${maxRetries}`,
          { delay, error: lastError?.message, model: this.model },
        );
        await abortableDelay(delay, signal);
      }
    }
    throw lastError!;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    // Use the appropriate pool based on current tier
    const pool = this._isPlannerTier ? this.plannerPool : this.executorPool;
    const activeSlot = pool.getActive();
    let provider = activeSlot.provider;
    let activeModel =
      !this._isPlannerTier && this.executorModelOverride
        ? this.executorModelOverride
        : activeSlot.model;

    if (!provider.apiKey) {
      throw new Error(
        `API key is missing for ${provider.providerId}. Please configure it in settings.`,
      );
    }

    // Fireworks routers require streaming — force it and collect the response
    const forceStream = provider.providerId === "fireworks";

    const payload = shapePayloadForProvider(provider.providerId, {
      model: request.model || activeModel,
      messages: sanitizeToolCallMessages(
        annotateCacheControl(request.messages, provider.providerId),
        provider.providerId,
      ),
      tools: request.tools,
      tool_choice: request.tools?.length
        ? (request.tool_choice ?? "auto")
        : undefined,
      temperature: request.temperature ?? this.defaultTemperature, // Agentic needs low temp
      max_tokens: request.max_tokens,
      stop: request.stop,
      response_format: request.response_format,
      ...(forceStream
        ? { stream: true, stream_options: { include_usage: true } }
        : {}),
    });

    logger.debug("agent", "LLM Request", {
      model: payload.model,
      provider: provider.providerId,
      msgCount: (payload.messages as LLMMessage[]).length,
      tools: (payload.tools as unknown[] | undefined)?.length,
    });

    try {
      let requestInitBase: RequestInit = {
        method: "POST",
        headers: buildJsonHeaders(provider, request),
      };

      let response: Response;
      let actualProviderId: ProviderConfig["providerId"];
      let actualModel: string;
      let activePayload = payload;
      let imageFallbackRetried = false;

      for (;;) {
        const fetchResult = await this.fetchWithRetry(
          provider.baseUrl,
          {
            ...requestInitBase,
            body: JSON.stringify(activePayload),
          },
          3,
          request.signal,
          provider.providerId,
          activeModel,
        );
        response = fetchResult.response;
        actualProviderId = fetchResult.actualProviderId;
        actualModel = fetchResult.actualModel;

        if (response.ok) break;
        const errorText = await response.text();
        if (
          !imageFallbackRetried &&
          hasImageUrlContent(request.messages) &&
          isImageUrlUnsupported(response.status, errorText)
        ) {
          imageFallbackRetried = true;
          activePayload = shapePayloadForProvider(provider.providerId, {
            ...activePayload,
            messages: toTextOnlyMessages(request.messages),
          });
          logger.warn(
            "agent",
            "Provider rejected image_url content; retrying with text-only messages",
            {
              provider: provider.providerId,
              model: activePayload.model,
            },
          );
          continue;
        }

        if (response.status === 402) {
          // Disable this provider permanently for the session
          pool.disableForSession(provider.providerId);
          logger.warn(
            "agent",
            "Provider permanently disabled for session (credit exhaustion)",
            { providerId: provider.providerId },
          );

          // Try failover to next provider
          const fallback = pool.getNextFallback(provider.providerId);
          if (fallback && !pool.isDisabled(fallback.provider.providerId)) {
            this.onProviderFailover?.(
              provider.providerId,
              fallback.provider.providerId,
            );
            provider = fallback.provider;
            activeModel = fallback.model;
            activePayload = shapePayloadForProvider(provider.providerId, {
              ...activePayload,
              model: activeModel,
            });
            requestInitBase = {
              method: "POST",
              headers: buildJsonHeaders(provider, request),
            };
            continue; // Re-enter the while(true) loop with new provider
          }

          // No viable fallback — throw the credit error
          const providerName = getProviderDisplayName(provider.providerId);
          const creditsUrl = getProviderCreditsUrl(provider.providerId);
          const affordMatch = errorText.match(/can only afford (\d+)/);
          const affordable = affordMatch ? parseInt(affordMatch[1]) : 0;
          const err = new Error(
            pool.allDisabled()
              ? `All providers exhausted (credit limits). Add credits to continue.`
              : affordable > 0
                ? `Insufficient credits (can afford ~${affordable} tokens).${creditsUrl ? ` Add credits at ${creditsUrl}.` : ""}`
                : `Insufficient ${providerName} credits.${creditsUrl ? ` Add credits at ${creditsUrl}.` : ""}`,
          );
          (err as any).status = 402;
          (err as any).affordable = affordable;
          throw err;
        }
        throw new Error(`LLM API Error (${response.status}): ${errorText}`);
      }

      // Fireworks streaming: collect SSE stream and return as CompletionResponse
      if (forceStream) {
        if (!response.body) {
          throw new Error("Fireworks streaming response has no body");
        }
        const result = await parseSSEStream(
          response.body,
          () => {}, // no-op: complete() doesn't stream to UI
          request.signal,
        );
        const cacheTelemetry = readProviderCacheTelemetry(
          actualProviderId,
          response.headers,
        );
        const rawContent = result.content;
        const cleanContent = rawContent
          ? stripThinkTags(rawContent) || null
          : null;
        return {
          role: "assistant",
          content: cleanContent,
          tool_calls: result.tool_calls,
          finish_reason: result.tool_calls ? "tool_calls" : "stop",
          usage: mergeCacheTelemetry(
            withUsageCacheTelemetry(result.usage, actualProviderId),
            cacheTelemetry,
          ),
          actualProviderId,
          actualModel,
        };
      }

      const data = await response.json();
      if (!data.choices?.length) {
        throw new Error(
          `LLM returned empty choices array (model: ${actualModel ?? "unknown"})`,
        );
      }
      const choice = data.choices[0];

      // Parse tool calls from provider format to internal ToolCall format
      const rawToolCalls = choice.message.tool_calls as
        | LLMToolCall[]
        | undefined;
      let parsedToolCalls: ToolCall[] = [];

      const VALID_TOOL_NAMES = new Set<string>(Object.values(ToolName));

      if (rawToolCalls) {
        parsedToolCalls = rawToolCalls.map((tc) => {
          if (!VALID_TOOL_NAMES.has(tc.function.name)) {
            logger.warn("agent", "LLM emitted unknown tool name", {
              name: tc.function.name,
            });
          }
          return {
            id: tc.id,
            type: "function",
            function: {
              // Cast is safe: unknown names are caught by validateToolCalls()
              name: tc.function.name as ToolName,
              arguments: tc.function.arguments,
            },
          };
        });
      }

      logger.debug("agent", "LLM Response", {
        finishReason: choice.finish_reason,
        contentLen: choice.message.content?.length,
        toolCalls: parsedToolCalls.length,
      });

      // Strip reasoning tokens (<think>...</think>) that some models emit inline
      const rawContent = choice.message.content;
      const cleanContent = rawContent
        ? stripThinkTags(rawContent) || null
        : null;

      // Extract cached_tokens from prompt_tokens_details if present
      const usage = data.usage
        ? {
            ...data.usage,
            cached_tokens:
              data.usage.prompt_tokens_details?.cached_tokens ?? undefined,
          }
        : undefined;
      const cacheTelemetry = readProviderCacheTelemetry(
        actualProviderId,
        response.headers,
      );

      return {
        role: "assistant",
        content: cleanContent,
        tool_calls: parsedToolCalls.length > 0 ? parsedToolCalls : undefined,
        finish_reason: choice.finish_reason as any,
        usage: mergeCacheTelemetry(
          withUsageCacheTelemetry(usage, actualProviderId),
          cacheTelemetry,
        ),
        actualProviderId,
        actualModel,
      };
    } catch (error: any) {
      logger.error("agent", "LLM Request Failed", { error: error.message });
      throw error;
    }
  }

  /**
   * Executes a streaming LLM completion request.
   * Handles SSE parsing, think tag filtering, and automatic retries.
   *
   * @param request - Completion request with messages, tools, and options
   * @param onTextDelta - Callback for each text chunk received
   * @returns Complete response with parsed tool calls and usage data
   */
  async completeStream(
    request: CompletionRequest,
    onTextDelta: (delta: string) => void,
  ): Promise<CompletionResponse> {
    // Use the appropriate pool based on current tier
    const pool = this._isPlannerTier ? this.plannerPool : this.executorPool;
    const activeSlot = pool.getActive();
    let provider = activeSlot.provider;
    let activeModel =
      !this._isPlannerTier && this.executorModelOverride
        ? this.executorModelOverride
        : activeSlot.model;

    if (!provider.apiKey) {
      throw new Error(
        `API key is missing for ${provider.providerId}. Please configure it in settings.`,
      );
    }

    const payload = shapePayloadForProvider(provider.providerId, {
      model: request.model || activeModel,
      messages: sanitizeToolCallMessages(
        annotateCacheControl(request.messages, provider.providerId),
        provider.providerId,
      ),
      tools: request.tools,
      tool_choice: request.tools?.length
        ? (request.tool_choice ?? "auto")
        : undefined,
      temperature: request.temperature ?? this.defaultTemperature,
      max_tokens: request.max_tokens,
      stop: request.stop,
      stream: true,
      stream_options: { include_usage: true },
      response_format: request.response_format,
    });

    logger.debug("agent", "LLM Stream Request", {
      model: payload.model,
      provider: provider.providerId,
      msgCount: (payload.messages as LLMMessage[]).length,
      tools: (payload.tools as unknown[] | undefined)?.length,
    });

    try {
      let requestInitBase: RequestInit = {
        method: "POST",
        headers: buildJsonHeaders(provider, request),
      };

      let response: Response;
      let actualProviderId: ProviderConfig["providerId"];
      let actualModel: string;
      let activePayload = payload;
      let imageFallbackRetried = false;

      for (;;) {
        const fetchResult = await this.fetchWithRetry(
          provider.baseUrl,
          {
            ...requestInitBase,
            body: JSON.stringify(activePayload),
          },
          3,
          request.signal,
          provider.providerId,
          activeModel,
        );
        response = fetchResult.response;
        actualProviderId = fetchResult.actualProviderId;
        actualModel = fetchResult.actualModel;

        if (response.ok) break;
        const errorText = await response.text();
        if (
          !imageFallbackRetried &&
          hasImageUrlContent(request.messages) &&
          isImageUrlUnsupported(response.status, errorText)
        ) {
          imageFallbackRetried = true;
          activePayload = shapePayloadForProvider(provider.providerId, {
            ...activePayload,
            messages: toTextOnlyMessages(request.messages),
          });
          logger.warn(
            "agent",
            "Provider rejected image_url content on stream; retrying with text-only messages",
            {
              provider: provider.providerId,
              model: activePayload.model,
            },
          );
          continue;
        }

        if (response.status === 402) {
          // Disable this provider permanently for the session
          pool.disableForSession(provider.providerId);
          logger.warn(
            "agent",
            "Provider permanently disabled for session (credit exhaustion)",
            { providerId: provider.providerId },
          );

          // Try failover to next provider
          const fallback = pool.getNextFallback(provider.providerId);
          if (fallback && !pool.isDisabled(fallback.provider.providerId)) {
            this.onProviderFailover?.(
              provider.providerId,
              fallback.provider.providerId,
            );
            provider = fallback.provider;
            activeModel = fallback.model;
            activePayload = shapePayloadForProvider(provider.providerId, {
              ...activePayload,
              model: activeModel,
            });
            requestInitBase = {
              method: "POST",
              headers: buildJsonHeaders(provider, request),
            };
            continue; // Re-enter the while(true) loop with new provider
          }

          // No viable fallback — throw the credit error
          const providerName = getProviderDisplayName(provider.providerId);
          const creditsUrl = getProviderCreditsUrl(provider.providerId);
          const affordMatch = errorText.match(/can only afford (\d+)/);
          const affordable = affordMatch ? parseInt(affordMatch[1]) : 0;
          const err = new Error(
            pool.allDisabled()
              ? `All providers exhausted (credit limits). Add credits to continue.`
              : affordable > 0
                ? `Insufficient credits (can afford ~${affordable} tokens).${creditsUrl ? ` Add credits at ${creditsUrl}.` : ""}`
                : `Insufficient ${providerName} credits.${creditsUrl ? ` Add credits at ${creditsUrl}.` : ""}`,
          );
          (err as any).status = 402;
          (err as any).affordable = affordable;
          throw err;
        }
        throw new Error(`LLM API Error (${response.status}): ${errorText}`);
      }

      if (!response.body) {
        throw new Error("LLM response body is null — streaming not supported?");
      }

      // Wrap callback to suppress <think>...</think> reasoning blocks during streaming
      const thinkFilter = createThinkFilter(onTextDelta);
      const result = await parseSSEStream(
        response.body,
        thinkFilter.push,
        request.signal,
      );
      thinkFilter.flush();
      const cacheTelemetry = readProviderCacheTelemetry(
        actualProviderId,
        response.headers,
      );

      // Preserve raw content (with <think> blocks) for conversation history —
      // M2.5 reasoning chain continuity improves performance significantly.
      // The streaming thinkFilter already suppressed <think> from the UI deltas.

      logger.debug("agent", "LLM Stream Response", {
        contentLen: result.content?.length,
        toolCalls: result.tool_calls?.length ?? 0,
      });

      return {
        role: "assistant",
        content: result.content || null,
        tool_calls: result.tool_calls,
        finish_reason: result.tool_calls ? "tool_calls" : "stop",
        usage: mergeCacheTelemetry(
          withUsageCacheTelemetry(result.usage, actualProviderId),
          cacheTelemetry,
        ),
        actualProviderId,
        actualModel,
      };
    } catch (error: any) {
      logger.error("agent", "LLM Stream Request Failed", {
        error: error.message,
      });
      throw error;
    }
  }
}
