import { ToolCall } from "../../types";
import { logger } from "../../utils";
import { parseSSEStream } from "../streaming";
import {
  CompletionRequest,
  CompletionResponse,
  LLMMessage,
  LLMToolCall,
  ProviderConfig,
} from "./types";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
const CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1/chat/completions";

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

/** Fast model tier — used for initial turns (OpenRouter fallback) */
export const MODEL_FAST = "openai/gpt-oss-120b";
/** Fast model tier — used for initial turns (Groq, when enabled) */
export const MODEL_FAST_GROQ = "openai/gpt-oss-120b";
/** Fast model tier — used for initial turns (Cerebras, highest priority) */
export const MODEL_FAST_CEREBRAS = "gpt-oss-120b";
/** Smart model tier — used after escalation (OpenRouter fallback) */
export const MODEL_SMART = "z-ai/glm-4.7";
/** Smart model tier — used after escalation (Cerebras, highest priority) */
export const MODEL_SMART_CEREBRAS = "zai-glm-4.7";

function openRouterProvider(apiKey: string): ProviderConfig {
  return {
    baseUrl: OPENROUTER_BASE_URL,
    apiKey,
    headers: {
      "HTTP-Referer": "https://github.com/OpenSidebar/OpenSidebar",
      "X-Title": "OpenSidebar",
    },
    providerId: "openrouter",
  };
}

function groqProvider(apiKey: string): ProviderConfig {
  return {
    baseUrl: GROQ_BASE_URL,
    apiKey,
    headers: {},
    providerId: "groq",
  };
}

function cerebrasProvider(apiKey: string): ProviderConfig {
  return {
    baseUrl: CEREBRAS_BASE_URL,
    apiKey,
    headers: {},
    providerId: "cerebras",
  };
}

/** Strip reasoning blocks from model output: XML think tags and markdown Think/Verify sections */
export function stripThinkTags(text: string): string {
  // XML think blocks
  let result = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  // Markdown Think/Observe/Verify sections (Cerebras/Groq pattern)
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

// --- Provider Pool (priority-based failover) ---

const COOLDOWN_MS = 60_000;

export interface ProviderSlot {
  provider: ProviderConfig;
  cooldownUntil: number;
  model: string;
}

/** Model identifiers per provider for a given tier. */
export interface PoolConfig {
  cerebrasModel?: string;
  groqModel?: string;
  openRouterModel: string;
}

/**
 * Priority-based provider pool. Cerebras → Groq → OpenRouter (fastest first).
 * On 429, the provider is placed on a 60s cooldown and the next provider is used.
 * Used for both fast and smart model tiers with different PoolConfig.
 */
export class ProviderPool {
  private slots: ProviderSlot[];

  constructor(
    openRouterKey: string,
    config: PoolConfig,
    groqKey?: string,
    cerebrasKey?: string,
  ) {
    this.slots = [];
    // Priority: fastest first
    if (cerebrasKey && config.cerebrasModel) {
      this.slots.push({
        provider: cerebrasProvider(cerebrasKey),
        cooldownUntil: 0,
        model: config.cerebrasModel,
      });
    }
    if (groqKey && config.groqModel) {
      this.slots.push({
        provider: groqProvider(groqKey),
        cooldownUntil: 0,
        model: config.groqModel,
      });
    }
    // OpenRouter always present as last resort
    this.slots.push({
      provider: openRouterProvider(openRouterKey),
      cooldownUntil: 0,
      model: config.openRouterModel,
    });
  }

  /** Returns highest-priority provider not on cooldown */
  getActive(): ProviderSlot {
    const now = Date.now();
    return (
      this.slots.find((s) => now >= s.cooldownUntil) ??
      this.slots[this.slots.length - 1] // OpenRouter as absolute fallback
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
    // All downstream are on cooldown — return OpenRouter as absolute fallback
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
 * LLM Client for OpenSidebar
 * Handles communication with LLM APIs via priority-based provider failover
 */

export class LLMClient {
  private provider: ProviderConfig;
  private model: string;
  private openRouterApiKey: string;
  /** Priority-based provider pool for fast model failover */
  private fastPool: ProviderPool;
  /** Priority-based provider pool for smart model failover */
  private smartPool: ProviderPool;
  /** Whether the client is currently in smart model tier */
  private _isSmartTier = false;

  /**
   * Creates a new LLM client with priority-based provider failover.
   * @param openRouterApiKey - OpenRouter key (always needed for smart model + fallback)
   * @param groqApiKey - Groq key (optional; auto-joins fast pool when present)
   * @param cerebrasApiKey - Cerebras key (optional; joins both pools at highest priority)
   * @param model - Model ID override (defaults to fast pool's top-priority model)
   */
  constructor(
    openRouterApiKey: string,
    groqApiKey?: string,
    cerebrasApiKey?: string,
    model?: string,
  ) {
    this.openRouterApiKey = openRouterApiKey;

    // Build fast pool: Cerebras → Groq → OpenRouter
    this.fastPool = new ProviderPool(
      openRouterApiKey,
      {
        cerebrasModel: MODEL_FAST_CEREBRAS,
        groqModel: MODEL_FAST_GROQ,
        openRouterModel: MODEL_FAST,
      },
      groqApiKey,
      cerebrasApiKey,
    );

    // Build smart pool: Cerebras → OpenRouter (no Groq for smart tier)
    this.smartPool = new ProviderPool(
      openRouterApiKey,
      {
        cerebrasModel: MODEL_SMART_CEREBRAS,
        openRouterModel: MODEL_SMART,
      },
      undefined,
      cerebrasApiKey,
    );

    // Initialize from fast pool's top priority
    const initialSlot = this.fastPool.getActive();
    this.model = model ?? initialSlot.model;
    this.provider = initialSlot.provider;
  }

  /** Whether the client is currently using the smart model tier */
  public isSmartTier(): boolean {
    return this._isSmartTier;
  }

  /** Get the currently active model ID */
  public getCurrentModel(): string {
    return this.model;
  }

  /** Get the current provider identifier */
  public getCurrentProvider(): string {
    return this.provider.providerId;
  }

  /** Get provider info for the currently active fast/smart slot */
  public getActiveProviderInfo(): { providerId: string; model: string } {
    const pool = this._isSmartTier ? this.smartPool : this.fastPool;
    const slot = pool.getActive();
    return {
      providerId: slot.provider.providerId,
      model: slot.model,
    };
  }

  private onProviderFailover?: (from: string, to: string) => void;

  public setFailoverCallback(cb: (from: string, to: string) => void): void {
    this.onProviderFailover = cb;
  }

  /**
   * Switch to smart model tier. Used during escalation.
   * Reads from smart pool (Cerebras → OpenRouter) for best available provider.
   */
  public switchToSmart(): void {
    const slot = this.smartPool.getActive();
    logger.info("agent", "Switching to smart model", {
      fromModel: this.model,
      fromProvider: this.provider.providerId,
      toModel: slot.model,
      toProvider: slot.provider.providerId,
    });
    this.model = slot.model;
    this.provider = slot.provider;
    this._isSmartTier = true;
  }

  /**
   * Switch back to fast model. Used during de-escalation when progress resumes.
   * Reads from fast pool to get the fastest available provider (respects cooldowns).
   */
  public switchToFast(): void {
    const slot = this.fastPool.getActive();
    logger.info("agent", "Switching back to fast model", {
      fromModel: this.model,
      fromProvider: this.provider.providerId,
      toModel: slot.model,
      toProvider: slot.provider.providerId,
    });
    this.model = slot.model;
    this.provider = slot.provider;
    this._isSmartTier = false;
  }

  /** Rebuild request for a different provider (swaps URL, headers, AND model in body) */
  private rebuildForProvider(
    init: RequestInit,
    slot: ProviderSlot,
  ): { url: string; init: RequestInit } {
    const body = JSON.parse(init.body as string);
    body.model = slot.model;
    delete body.provider;
    return {
      url: slot.provider.baseUrl,
      init: {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${slot.provider.apiKey}`,
          ...slot.provider.headers,
        },
        body: JSON.stringify(body),
      },
    };
  }

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    maxRetries: number,
    signal: AbortSignal | undefined,
    providerId: string,
    model: string,
  ): Promise<{
    response: Response;
    actualProviderId: string;
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
          const pool = this._isSmartTier ? this.smartPool : this.fastPool;
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
          const pool = this._isSmartTier ? this.smartPool : this.fastPool;
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
    const pool = this._isSmartTier ? this.smartPool : this.fastPool;
    const activeSlot = pool.getActive();
    let provider = activeSlot.provider;
    let activeModel = activeSlot.model;

    if (!provider.apiKey) {
      const name =
        provider.providerId === "groq"
          ? "Groq"
          : provider.providerId === "cerebras"
            ? "Cerebras"
            : "OpenRouter";
      throw new Error(
        `${name} API Key is missing. Please configure it in settings.`,
      );
    }

    const payload: Record<string, unknown> = {
      model: request.model || activeModel,
      messages: request.messages,
      tools: request.tools,
      tool_choice: request.tools?.length ? ("auto" as const) : undefined,
      temperature: request.temperature ?? 0.0, // Agentic needs low temp
      max_tokens: request.max_tokens,
      stop: request.stop,
    };

    logger.debug("agent", "LLM Request", {
      model: payload.model,
      provider: provider.providerId,
      msgCount: (payload.messages as LLMMessage[]).length,
      tools: (payload.tools as unknown[] | undefined)?.length,
    });

    try {
      let requestInitBase: RequestInit = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`,
          ...provider.headers,
        },
      };

      let response: Response;
      let actualProviderId: "openrouter" | "groq" | "cerebras";
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
        actualProviderId = fetchResult.actualProviderId as
          | "openrouter"
          | "groq"
          | "cerebras";
        actualModel = fetchResult.actualModel;

        if (response.ok) break;
        const errorText = await response.text();
        if (
          !imageFallbackRetried &&
          hasImageUrlContent(request.messages) &&
          isImageUrlUnsupported(response.status, errorText)
        ) {
          imageFallbackRetried = true;
          activePayload = {
            ...activePayload,
            messages: toTextOnlyMessages(request.messages),
          };
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
            activePayload = { ...activePayload, model: activeModel };
            requestInitBase = {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${provider.apiKey}`,
                ...provider.headers,
              },
            };
            continue; // Re-enter the while(true) loop with new provider
          }

          // No viable fallback — throw the credit error
          const providerName =
            provider.providerId === "groq"
              ? "Groq"
              : provider.providerId === "cerebras"
                ? "Cerebras"
                : "OpenRouter";
          const creditsUrl =
            provider.providerId === "groq"
              ? "console.groq.com/settings/billing"
              : provider.providerId === "cerebras"
                ? "cloud.cerebras.ai"
                : "openrouter.ai/credits";
          const affordMatch = errorText.match(/can only afford (\d+)/);
          const affordable = affordMatch ? parseInt(affordMatch[1]) : 0;
          const err = new Error(
            pool.allDisabled()
              ? `All providers exhausted (credit limits). Add credits to continue.`
              : affordable > 0
                ? `Insufficient credits (can afford ~${affordable} tokens). Add credits at ${creditsUrl}.`
                : `Insufficient ${providerName} credits. Add credits at ${creditsUrl}.`,
          );
          (err as any).status = 402;
          (err as any).affordable = affordable;
          throw err;
        }
        throw new Error(`LLM API Error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const choice = data.choices[0];

      // Parse tool calls from provider format to internal ToolCall format
      const rawToolCalls = choice.message.tool_calls as
        | LLMToolCall[]
        | undefined;
      let parsedToolCalls: ToolCall[] = [];

      if (rawToolCalls) {
        parsedToolCalls = rawToolCalls.map((tc) => {
          // Return exactly what matches parameters of ToolCall interface
          // We validate that the name is a valid ToolName? Or just cast it.
          return {
            id: tc.id,
            type: "function",
            function: {
              name: tc.function.name as any, // Cast to ToolName
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

      return {
        role: "assistant",
        content: cleanContent,
        tool_calls: parsedToolCalls.length > 0 ? parsedToolCalls : undefined,
        finish_reason: choice.finish_reason as any,
        usage,
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
    const pool = this._isSmartTier ? this.smartPool : this.fastPool;
    const activeSlot = pool.getActive();
    let provider = activeSlot.provider;
    let activeModel = activeSlot.model;

    if (!provider.apiKey) {
      const name =
        provider.providerId === "groq"
          ? "Groq"
          : provider.providerId === "cerebras"
            ? "Cerebras"
            : "OpenRouter";
      throw new Error(
        `${name} API Key is missing. Please configure it in settings.`,
      );
    }

    const payload: Record<string, unknown> = {
      model: request.model || activeModel,
      messages: request.messages,
      tools: request.tools,
      tool_choice: request.tools?.length ? ("auto" as const) : undefined,
      temperature: request.temperature ?? 0.0,
      max_tokens: request.max_tokens,
      stop: request.stop,
      stream: true,
      stream_options: { include_usage: true },
    };

    logger.debug("agent", "LLM Stream Request", {
      model: payload.model,
      provider: provider.providerId,
      msgCount: (payload.messages as LLMMessage[]).length,
      tools: (payload.tools as unknown[] | undefined)?.length,
    });

    try {
      let requestInitBase: RequestInit = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`,
          ...provider.headers,
        },
      };

      let response: Response;
      let actualProviderId: "openrouter" | "groq" | "cerebras";
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
        actualProviderId = fetchResult.actualProviderId as
          | "openrouter"
          | "groq"
          | "cerebras";
        actualModel = fetchResult.actualModel;

        if (response.ok) break;
        const errorText = await response.text();
        if (
          !imageFallbackRetried &&
          hasImageUrlContent(request.messages) &&
          isImageUrlUnsupported(response.status, errorText)
        ) {
          imageFallbackRetried = true;
          activePayload = {
            ...activePayload,
            messages: toTextOnlyMessages(request.messages),
          };
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
            activePayload = { ...activePayload, model: activeModel };
            requestInitBase = {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${provider.apiKey}`,
                ...provider.headers,
              },
            };
            continue; // Re-enter the while(true) loop with new provider
          }

          // No viable fallback — throw the credit error
          const providerName =
            provider.providerId === "groq"
              ? "Groq"
              : provider.providerId === "cerebras"
                ? "Cerebras"
                : "OpenRouter";
          const creditsUrl =
            provider.providerId === "groq"
              ? "console.groq.com/settings/billing"
              : provider.providerId === "cerebras"
                ? "cloud.cerebras.ai"
                : "openrouter.ai/credits";
          const affordMatch = errorText.match(/can only afford (\d+)/);
          const affordable = affordMatch ? parseInt(affordMatch[1]) : 0;
          const err = new Error(
            pool.allDisabled()
              ? `All providers exhausted (credit limits). Add credits to continue.`
              : affordable > 0
                ? `Insufficient credits (can afford ~${affordable} tokens). Add credits at ${creditsUrl}.`
                : `Insufficient ${providerName} credits. Add credits at ${creditsUrl}.`,
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
        usage: result.usage,
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
