import { ToolCall, ToolName } from "../../types";
import { applyOpenRouterRouting, providerPinsForOptions, type ProviderRoutingOptions } from "./provider-routing-policy";
import { logger } from "../../utils";
import {
  isVLCapable as isExecutorVLCapable,
  normalizeExecutorFallbackModel,
  normalizeExecutorModel,
} from "../../utils/executor-model-policy";
import { parseSSEStream } from "../streaming";
import {
  hasImageUrlContent,
  isImageUrlUnsupported,
  toTextOnlyMessages,
} from "./image-capability";
import {
  CompletionRequest,
  CompletionResponse,
  LLMMessage,
  LLMToolCall,
  ProviderConfig,
  TokenUsage,
} from "./types";
import { withUsageCacheTelemetry } from "./cache-telemetry";
import { MODEL_JUDGE, MODEL_PLANNER } from "./seat-models";
import { toJudgeUsage } from "./judge-usage";
import { cloudRelayFetch } from "./cloud-relay";
import {
  buildJsonHeaders,
  getProviderCreditsUrl,
  getProviderDisplayName,
  sanitizeApiKeyForHeader,
} from "./provider-headers";
import type { JudgeUsage } from "../agent/completion/judge";
import type { JudgeRubric, JudgeVerdict } from "../agent/completion/judge";
import { requestJevVerdict } from "../agent/completion/jev-judge";
import { withLlmRequestObservation } from "./transport-observation";

export * from "./seat-models";

/** Check if a model supports unified VL executor mode (vision + tool calling). */
export const isVLCapable = isExecutorVLCapable;

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";


/** Options for overriding default models in LLMClient */
export interface LLMClientOptions extends ProviderRoutingOptions {
  executorModel?: string;
  executorFallbackModel?: string;
  plannerModel?: string;
  /**
   * Optional specialist Writer model for one-shot prose composition. When unset,
   * the writer seat transparently reuses the executor seat.
   */
  writerModel?: string;
  /**
   * Optional verification judge model (RFC LP-15 Phase 10). When unset, the
   * judge seat uses the default judge model.
   */
  judgeModel?: string;
  /** Append :nitro routing suffix to all model IDs (OpenRouter only) */
  useNitro?: boolean;
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
    apiKey: sanitizeApiKeyForHeader(apiKey),
    headers: {
      "HTTP-Referer": "https://github.com/OpenSidebar/OpenSidebar",
      "X-Title": "OpenSidebar",
    },
    providerId: "openrouter",
  };
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

// --- Provider slots ---

/** One seat's route: the provider to call and the model to request. */
export interface ProviderSlot {
  provider: ProviderConfig;
  model: string;
}

export function openRouterSlot(
  openRouterKey: string,
  model: string,
): ProviderSlot {
  return { provider: openRouterProvider(openRouterKey), model };
}

/**
 * Annotate system message with cache_control for OpenRouter prefix caching.
 * The static prefix (rules, persona, demo catalog) is stable across turns,
 * so marking the system message as ephemeral enables provider-side caching.
 */
function annotateCacheControl(messages: LLMMessage[]): LLMMessage[] {
  if (messages.length === 0 || messages[0].role !== "system") return messages;
  const systemMsg: LLMMessage = {
    ...messages[0],
    cache_control: { type: "ephemeral" as const },
  };
  return [systemMsg, ...messages.slice(1)];
}

/** Build the typed error for an HTTP 402 (out of OpenRouter credits). */
function creditsExhaustedError(errorText: string): Error {
  const providerName = getProviderDisplayName();
  const creditsUrl = getProviderCreditsUrl();
  const affordMatch = errorText.match(/can only afford (\d+)/);
  const affordable = affordMatch ? parseInt(affordMatch[1]) : 0;
  const err = new Error(
    affordable > 0
      ? `Insufficient credits (can afford ~${affordable} tokens). Add credits at ${creditsUrl}.`
      : `Insufficient ${providerName} credits. Add credits at ${creditsUrl}.`,
  );
  (err as any).status = 402;
  (err as any).affordable = affordable;
  return err;
}

/**
 * LLM Client for OpenSidebar
 * Handles communication with LLM APIs via priority-based provider failover
 */
export class LLMClient {
  private provider: ProviderConfig;
  private model: string;
  private openRouterApiKey: string;
  private executorSlot: ProviderSlot;
  private plannerSlot: ProviderSlot;
  /**
   * Slot for the optional Writer specialist. Defaults to the executor slot when
   * no writer model is configured (transparent fallback).
   */
  private writerSlot: ProviderSlot;
  /** Slot for the verification judge (RFC LP-15 Phase 10). */
  private judgeSlot: ProviderSlot;
  /** Which model role is currently active for completion routing */
  private _activeTier: "executor" | "planner" | "writer" | "judge" = "executor";
  private readonly providerPins: Partial<
    Record<"executor" | "planner" | "writer" | "judge", string>
  >;
  private executorModelOverride: string | null = null;
  private readonly strictModelRouting: boolean;
  private defaultTemperature: number = 0.0;
  private executorFallbackModel: string | null = null;

  /**
   * Creates a new LLM client.
   * @param openRouterApiKey - OpenRouter key (required as default provider)
   * @param options - Provider selection, model overrides, and feature flags
   */
  constructor(openRouterApiKey: string, options?: LLMClientOptions) {
    this.openRouterApiKey = openRouterApiKey;
    this.strictModelRouting = options?.strictModelRouting === true;
    this.defaultTemperature = options?.temperature ?? 0.0;
    this.providerPins = providerPinsForOptions(options);

    const nitro = options?.useNitro;

    // --- Build executor slot ---
    const executorModel = normalizeExecutorModel(options?.executorModel);
    const executorFallbackModel = normalizeExecutorFallbackModel({
      executorModel,
      executorFallbackModel: options?.executorFallbackModel,
    });
    this.executorSlot = openRouterSlot(
      openRouterApiKey,
      applyNitro(executorModel, nitro),
    );
    this.executorFallbackModel = applyNitro(executorFallbackModel, nitro);

    // --- Build planner slot ---
    this.plannerSlot = openRouterSlot(
      openRouterApiKey,
      applyNitro(options?.plannerModel || MODEL_PLANNER, nitro),
    );

    // --- Build writer slot ---
    // The optional Writer specialist runs with its own model. When
    // unconfigured it transparently reuses the executor slot so compose_text
    // still works (just without a dedicated prose model).
    this.writerSlot = options?.writerModel
      ? openRouterSlot(openRouterApiKey, applyNitro(options.writerModel, nitro))
      : this.executorSlot;

    // --- Build judge slot ---
    // The judge is a text-only rubric task. It has a dedicated model so it
    // does not queue behind planner traffic (sharing the seat made most judge
    // calls hit the hard timeout and fail open).
    this.judgeSlot = openRouterSlot(
      openRouterApiKey,
      applyNitro(options?.judgeModel ?? MODEL_JUDGE, nitro),
    );

    // Initialize from the executor slot
    const initialSlot = this.executorSlot;
    this.model = initialSlot.model;
    this.provider = initialSlot.provider;
  }

  /** Select the slot for the currently active model role. */
  private activeSlot(): ProviderSlot {
    switch (this._activeTier) {
      case "planner":
        return this.plannerSlot;
      case "writer":
        return this.writerSlot;
      case "judge":
        return this.judgeSlot;
      default:
        return this.executorSlot;
    }
  }

  /** Whether the client is currently using the planner model tier */
  public isPlannerTier(): boolean {
    return this._activeTier === "planner";
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
    const slot = this.activeSlot();
    return {
      providerId: slot.provider.providerId,
      model:
        this._activeTier === "executor" && this.executorModelOverride
          ? this.executorModelOverride
          : slot.model,
    };
  }

  public activateExecutorFallback(
    reason: "empty_response" = "empty_response",
  ): boolean {
    if (this.strictModelRouting || this._activeTier !== "executor") return false;
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
    const slot = this.executorSlot;
    logger.info("agent", "Resetting executor fallback to primary model", {
      fromModel: this.executorModelOverride,
      toModel: slot.model,
    });
    this.executorModelOverride = null;
    this.model = slot.model;
  }

  /**
   * Switch to planner model tier. Used during escalation.
   * Uses the planner slot.
   */
  public switchToPlanner(): void {
    const slot = this.plannerSlot;
    logger.info("agent", "Switching to planner model", {
      fromModel: this.model,
      fromProvider: this.provider.providerId,
      toModel: slot.model,
      toProvider: slot.provider.providerId,
    });
    this.model = slot.model;
    this.provider = slot.provider;
    this._activeTier = "planner";
  }

  /**
   * Switch back to executor model. Used during de-escalation when progress resumes.
   * Uses the executor slot.
   */
  public switchToExecutor(): void {
    const slot = this.executorSlot;
    this.executorModelOverride = null;
    logger.info("agent", "Switching back to executor model", {
      fromModel: this.model,
      fromProvider: this.provider.providerId,
      toModel: slot.model,
      toProvider: slot.provider.providerId,
    });
    this.model = slot.model;
    this.provider = slot.provider;
    this._activeTier = "executor";
  }

  /**
   * One-shot prose composition against the Writer slot. Temporarily routes
   * completion through the writer model (falling back to the executor model when
   * none is configured), then restores the prior tier. Does not mutate the
   * active model/provider — `complete()` selects the slot per call via the tier
   * flag — so this is safe to call mid-loop without disturbing escalation state.
   */
  public async composeText(args: {
    systemPrompt: string;
    userPrompt: string;
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
  }): Promise<{ text: string; model: string; providerId: string }> {
    const prevTier = this._activeTier;
    this._activeTier = "writer";
    try {
      const { providerId, model } = this.getActiveProviderInfo();
      const resp = await this.complete({
        messages: [
          { role: "system", content: args.systemPrompt },
          { role: "user", content: args.userPrompt },
        ],
        max_tokens: args.maxTokens ?? 1024,
        temperature: args.temperature ?? 0.5,
        signal: args.signal,
      });
      return {
        text: stripThinkTags(resp.content ?? "").trim(),
        model: resp.actualModel ?? model,
        providerId: resp.actualProviderId ?? providerId,
      };
    } finally {
      this._activeTier = prevTier;
    }
  }

  /**
   * One-shot verification judging against the Judge slot (RFC LP-15 Phase 10).
   * Temporarily routes completion through the judge model (falling back to the
   * planner model when none is configured), then restores the prior tier.
   * Mirrors `composeText`: it does not mutate the active model/provider, so it
   * is safe to call mid-loop without disturbing escalation state. Temperature
   * defaults to 0 (deterministic adjudication); the caller parses the raw text.
   */
  public async runJudge(args: {
    systemPrompt: string;
    userPrompt: string;
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
  }): Promise<{
    text: string;
    model: string;
    providerId: string;
    usage?: JudgeUsage;
  }> {
    const prevTier = this._activeTier;
    this._activeTier = "judge";
    try {
      const { providerId, model } = this.getActiveProviderInfo();
      const resp = await this.complete({
        messages: [
          { role: "system", content: args.systemPrompt },
          { role: "user", content: args.userPrompt },
        ],
        max_tokens: args.maxTokens ?? 2048,
        temperature: args.temperature ?? 0,
        signal: args.signal,
      });
      const actualModel = resp.actualModel ?? model;
      const actualProviderId = resp.actualProviderId ?? providerId;
      return {
        text: stripThinkTags(resp.content ?? "").trim(),
        model: actualModel,
        providerId: actualProviderId,
        usage: toJudgeUsage(resp.usage, actualProviderId, actualModel),
      };
    } finally {
      this._activeTier = prevTier;
    }
  }

  public async runRubricDecision(rubric: JudgeRubric, signal?: AbortSignal): Promise<JudgeVerdict> {
    const slot = this.judgeSlot;
    if (!this.supportsRubricDecision()) throw new Error(`Typed decisions unavailable for ${slot.model}`);
    return requestJevVerdict(rubric, slot.provider.apiKey, slot.model.replace(/:nitro$/, ""), signal);
  }

  public supportsRubricDecision(): boolean {
    const slot = this.judgeSlot;
    return slot.provider.providerId === "openrouter" && slot.model.replace(/:nitro$/, "") === "typesafe/jev-1.13";
  }

  /** Whether a dedicated Writer model is configured (distinct from the executor slot). */
  public hasWriterModel(): boolean {
    return this.writerSlot !== this.executorSlot;
  }

  private shapePayloadForActiveTier(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const shaped = { ...payload };
    if (!shaped.stream) shaped.usage = { include: true };
    if (String(shaped.model).replace(/:nitro$/, "") === "openai/gpt-6-luna") {
      // Chat Completions function calling requires reasoning_effort=none.
      shaped.reasoning_effort = Array.isArray(shaped.tools) && shaped.tools.length ? "none" : "medium";
      if (shaped.reasoning_effort !== "none") delete shaped.temperature;
    }
    if (this.strictModelRouting && shaped.model !== this.getActiveProviderInfo().model) {
      throw new Error("Strict model routing forbids a request model override.");
    }
    const pin = this.providerPins[this._activeTier]?.trim();
    return applyOpenRouterRouting(shaped, pin, this.strictModelRouting);
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
    if (this.openRouterApiKey === "__opensidebar_cloud__")
      return {
        response: await cloudRelayFetch(
          JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>,
          this._activeTier,
          signal,
        ),
        actualProviderId: providerId,
        actualModel: model,
      };
    // OpenRouter classifies 408 as a request timeout and 500 as a transient
    // router/upstream error. Retrying either is materially safer than failing
    // an agent turn immediately; permanent 4xx failures still return directly.
    const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
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
    // Use the appropriate slot based on current tier
    const activeSlot = this.activeSlot();
    const provider = activeSlot.provider;
    const activeModel =
      this._activeTier === "executor" && this.executorModelOverride
        ? this.executorModelOverride
        : activeSlot.model;

    if (!provider.apiKey) {
      throw new Error(
        `API key is missing for ${provider.providerId}. Please configure it in settings.`,
      );
    }

    const payload = this.shapePayloadForActiveTier({
      model: request.model || activeModel,
      messages: annotateCacheControl(request.messages),
      tools: request.tools,
      tool_choice: request.tools?.length
        ? (request.tool_choice ?? "auto")
        : undefined,
      temperature: request.temperature ?? this.defaultTemperature, // Agentic needs low temp
      max_tokens: request.max_tokens,
      stop: request.stop,
      response_format: request.response_format,
    });

    logger.debug("agent", "LLM Request", {
      model: payload.model,
      provider: provider.providerId,
      msgCount: (payload.messages as LLMMessage[]).length,
      tools: (payload.tools as unknown[] | undefined)?.length,
    });

    try {
      const requestInitBase: RequestInit = withLlmRequestObservation({
        method: "POST",
        headers: buildJsonHeaders(provider),
      }, this._activeTier);

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
          !this.strictModelRouting && !imageFallbackRetried &&
          hasImageUrlContent(request.messages) &&
          isImageUrlUnsupported(response.status, errorText)
        ) {
          imageFallbackRetried = true;
          activePayload = this.shapePayloadForActiveTier({
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
          logger.warn("agent", "Provider out of credits", {
            providerId: provider.providerId,
          });
          throw creditsExhaustedError(errorText);
        }
        throw new Error(`LLM API Error (${response.status}): ${errorText}`);
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
      return {
        role: "assistant",
        content: cleanContent,
        tool_calls: parsedToolCalls.length > 0 ? parsedToolCalls : undefined,
        finish_reason: choice.finish_reason as any,
        usage: withUsageCacheTelemetry(usage, actualProviderId),
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
    // Use the appropriate slot based on current tier
    const activeSlot = this.activeSlot();
    const provider = activeSlot.provider;
    const activeModel =
      this._activeTier === "executor" && this.executorModelOverride
        ? this.executorModelOverride
        : activeSlot.model;

    if (!provider.apiKey) {
      throw new Error(
        `API key is missing for ${provider.providerId}. Please configure it in settings.`,
      );
    }

    const payload = this.shapePayloadForActiveTier({
      model: request.model || activeModel,
      messages: annotateCacheControl(request.messages),
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
      const requestInitBase: RequestInit = withLlmRequestObservation({
        method: "POST",
        headers: buildJsonHeaders(provider),
      }, this._activeTier);

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
          !this.strictModelRouting && !imageFallbackRetried &&
          hasImageUrlContent(request.messages) &&
          isImageUrlUnsupported(response.status, errorText)
        ) {
          imageFallbackRetried = true;
          activePayload = this.shapePayloadForActiveTier({
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
          logger.warn("agent", "Provider out of credits", {
            providerId: provider.providerId,
          });
          throw creditsExhaustedError(errorText);
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
        usage: withUsageCacheTelemetry(result.usage, actualProviderId),
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
