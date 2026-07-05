/**
 * AgentTelemetryController (RFC LP-15, Phase 1).
 *
 * Owns the session-telemetry state that previously lived as loose fields on
 * AgentLoop — session metrics, session clock, context-spend tracker, and the
 * citation set — plus the pure telemetry functions that mutate them. AgentLoop
 * keeps thin delegators (the public getMetrics/getCitations/recordVisionUsage
 * are relied on by host deps) and forwards the scattered hot-path call sites
 * here.
 *
 * Lifecycle-mutated loop state (traceRecorder, log, provider/model, turnCount)
 * is read through getter closures so the controller always sees the current
 * value even though those fields are reassigned mid-session.
 */

import type { Citation, SessionMetrics, ToolName } from "../../types";
import type {
  CompletionResponse,
  LLMMessage,
  ProviderConfig,
  TokenUsage,
} from "../llm/types";
import type { logger, SessionScopedLogger } from "../../utils";
import {
  type BroadcastMessage,
  sessionMetricsMessage,
  sessionMetricsSnapshot,
  shouldBroadcastSessionMetrics,
} from "./agent-broadcast";
import { BROADCAST_INTERVALS } from "./constants";
import {
  ContextSpendTracker,
  type ContextProgressSignal,
} from "./context-economy";
import type { TraceRecorder } from "./trace";
import {
  canSpendImagePromptBudget,
  emptySessionMetrics,
  estimateImagePromptUsage,
  imagePromptUsageForCount,
  recordCachedVisionTelemetryUse,
  recordCompletionUsage,
  recordImagePromptUsage,
  recordPerceptionModeDecision,
  recordPerceptionTurnMode,
  recordStaleReinterpretOutcome,
  recordTelemetryCitation,
  recordVisionTelemetryUsage,
  resolveImagePromptTokenBudget,
} from "./agent-telemetry";

type LoopLogger = typeof logger | SessionScopedLogger;

export interface AgentTelemetryDeps {
  getTurnCount(): number;
  getTraceRecorder(): TraceRecorder | null;
  getLog(): LoopLogger;
  getProvider(): ProviderConfig["providerId"];
  getModel(): string;
  broadcast(msg: BroadcastMessage): void;
  showSessionMetrics: boolean;
  maxImagePromptTokenEstimate?: number;
}

export class AgentTelemetryController {
  private metrics: SessionMetrics = emptySessionMetrics();
  private sessionStart = 0;
  private readonly contextSpend = new ContextSpendTracker();
  private citations: Citation[] = [];
  private readonly citationUrls = new Set<string>();

  constructor(private readonly deps: AgentTelemetryDeps) {}

  /** Re-initialize per-run counters (metrics, context spend, session clock). */
  reset(): void {
    this.metrics = emptySessionMetrics();
    this.contextSpend.reset();
    this.sessionStart = Date.now();
  }

  /** Accumulate usage from an LLM response. */
  recordUsage(response: CompletionResponse, llmMs: number): void {
    recordCompletionUsage({
      metrics: this.metrics,
      response,
      llmMs,
      currentProvider: this.deps.getProvider(),
      currentModel: this.deps.getModel(),
      onCacheHit: (cacheHit) =>
        this.deps.getLog().debug("agent", "Cache hit", cacheHit),
    });
    const spend = this.contextSpend.recordUsage(
      this.deps.getTurnCount(),
      response.usage,
    );
    const trace = this.deps.getTraceRecorder();
    trace?.recordEvent("context_spend_sample", {
      ...spend,
      model: response.actualModel ?? this.deps.getModel(),
      provider: response.actualProviderId ?? this.deps.getProvider(),
    });
    if (spend.threshold !== "none") {
      trace?.recordEvent("context_spend_threshold", { ...spend });
    }
  }

  /** Record usage from a vision API call. */
  recordVisionUsage(
    usage: TokenUsage,
    llmMs: number,
    model: string,
    providerId: ProviderConfig["providerId"] = "openrouter",
    imageCount = 0,
  ): void {
    recordVisionTelemetryUsage({
      metrics: this.metrics,
      usage,
      llmMs,
      model,
      providerId,
      imagePrompt: imagePromptUsageForCount(imageCount),
    });
  }

  /** Record estimated image prompt tokens for screenshot-backed LLM calls. */
  recordPromptImageUsage(messages: LLMMessage[]): void {
    recordImagePromptUsage(this.metrics, estimateImagePromptUsage(messages));
  }

  imagePromptBudgetAllows(imageCount: number): boolean {
    return canSpendImagePromptBudget(
      this.metrics,
      imagePromptUsageForCount(imageCount),
      this.deps.maxImagePromptTokenEstimate,
    );
  }

  recordImagePromptBudgetExhausted(
    imageCount: number,
    source: string,
  ): {
    source: string;
    requestedImages: number;
    requestedTokenEstimate: number;
    usedTokenEstimate: number;
    maxTokenEstimate: number;
    remainingTokenEstimate: number;
  } {
    const requested = imagePromptUsageForCount(imageCount);
    const used = this.metrics.totalImagePromptTokenEstimate ?? 0;
    const max = resolveImagePromptTokenBudget(
      this.deps.maxImagePromptTokenEstimate,
    );
    const detail = {
      source,
      requestedImages: imageCount,
      requestedTokenEstimate: requested.estimatedTokens,
      usedTokenEstimate: used,
      maxTokenEstimate: max,
      remainingTokenEstimate: Math.max(0, max - used),
    };
    this.deps
      .getTraceRecorder()
      ?.recordEvent("image_prompt_budget_exhausted", detail);
    this.deps.getLog().info("agent", "Image prompt budget exhausted", detail);
    return detail;
  }

  /** Current accumulated metrics snapshot. */
  getMetrics(): SessionMetrics {
    return sessionMetricsSnapshot({
      metrics: this.metrics,
      now: Date.now(),
      sessionStartTime: this.sessionStart,
    });
  }

  /** Record a citation for a URL the agent visited or read. */
  recordCitation(url: string, title: string, tool: ToolName): void {
    recordTelemetryCitation({
      citations: this.citations,
      citationUrls: this.citationUrls,
      url,
      title,
      tool,
      turn: this.deps.getTurnCount(),
    });
  }

  getCitations(): Citation[] {
    return this.citations;
  }

  /** Broadcast metrics to the side panel (throttled). */
  broadcastMetrics(): void {
    if (
      !shouldBroadcastSessionMetrics({
        showSessionMetrics: this.deps.showSessionMetrics,
        turnCount: this.deps.getTurnCount(),
        interval: BROADCAST_INTERVALS.METRICS,
      })
    )
      return;
    this.metrics.totalSessionTimeMs = Date.now() - this.sessionStart;
    this.deps.broadcast(sessionMetricsMessage(this.metrics));
  }

  broadcastFinalMetrics(): void {
    if (!this.deps.showSessionMetrics) return;
    this.metrics.totalSessionTimeMs = Date.now() - this.sessionStart;
    this.deps.broadcast(sessionMetricsMessage(this.metrics));
  }

  // --- Perception / vision telemetry (called from the loop body) ---

  recordCachedVisionUse(): void {
    recordCachedVisionTelemetryUse(this.metrics);
  }

  recordPerceptionMode(
    decision: Parameters<typeof recordPerceptionModeDecision>[1],
    autoDefault?: Parameters<typeof recordPerceptionModeDecision>[2],
  ): void {
    recordPerceptionModeDecision(this.metrics, decision, autoDefault);
  }

  recordPerceptionTurn(mode: "structured" | "unified_vl"): void {
    recordPerceptionTurnMode(this.metrics, mode);
  }

  recordStaleReinterpret(revealedChange: boolean): void {
    recordStaleReinterpretOutcome(this.metrics, revealedChange);
  }

  // --- Context spend + accessors for scattered loop-body sites ---

  recordContextProgress(turn: number, signals: ContextProgressSignal[]): boolean {
    return this.contextSpend.recordProgress(turn, signals);
  }

  get sessionStartTime(): number {
    return this.sessionStart;
  }

  get imagePromptTokensUsed(): number {
    return this.metrics.totalImagePromptTokenEstimate ?? 0;
  }

  get imagePromptTokenBudget(): number {
    return resolveImagePromptTokenBudget(this.deps.maxImagePromptTokenEstimate);
  }
}
