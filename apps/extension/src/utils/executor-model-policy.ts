import type { UserSettings } from "../types";

export type ProviderMode = NonNullable<UserSettings["providerMode"]>;

/** OpenRouter is the only supported inference gateway. */
export const DEFAULT_PROVIDER_MODE: ProviderMode = "openrouter";
export const DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER: Record<ProviderMode,string> = {openrouter:"minimax/minimax-m3"};

const OPENROUTER_EXECUTOR_MODELS = new Set([
  "stealth/ox-alpha",
  "minimax/minimax-m3",
  "moonshotai/kimi-k2.7-code",
  "moonshotai/kimi-k2.6",
  "moonshotai/kimi-k2.5",
  "qwen/qwen3.7-plus",
  "qwen/qwen3-vl-30b-a3b-instruct",
  // LP-39: image input + tools verified against the catalog on 2026-10-05.
  "openai/gpt-6-luna",
  "openai/gpt-5.6-luna",
  "openai/gpt-5.4-mini",
  "x-ai/grok-4.5",
]);

/**
 * Executor eligibility policy (owner decision 2026-07-05): a model may hold
 * the executor seat only if it is (1) VL-capable — the executor sees the
 * screenshot on unified_vl turns — and (2) above the reliability floor for
 * reactive action-taking (≈ Kimi K2.7 Code tier; GPT-OSS-class models are
 * not eligible). Text-only and cheaper models stay available for the
 * planner/writer/perception seats. The per-provider sets above are the
 * provider-scoped views of this policy.
 */
export const EXECUTOR_ELIGIBLE_MODELS: ReadonlySet<string> = OPENROUTER_EXECUTOR_MODELS;
function executorModelSet(providerMode: ProviderMode): ReadonlySet<string> {
 return providerMode === "openrouter" ? OPENROUTER_EXECUTOR_MODELS : new Set();
}

/** Provider-scoped ids used by catalog checks and the executor picker. */
export function getExecutorEligibleModelIds(
  providerMode: ProviderMode,
): readonly string[] {
  return [...executorModelSet(providerMode)];
}

/**
 * Models that can accept image input. Today identical to the eligible set;
 * a VL model below the reliability floor would be added here without being
 * granted the executor seat.
 */
const VL_CAPABLE_MODELS: ReadonlySet<string> = EXECUTOR_ELIGIBLE_MODELS;

function stripRoutingSuffix(model: string): string {
  return model.replace(/:(?:nitro|floor)$/, "");
}

export function getDefaultExecutorModel(
  providerMode: ProviderMode = DEFAULT_PROVIDER_MODE,
): string {
  return DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER[providerMode];
}

/** Check if a model supports unified VL executor mode (vision + tool calling). */
export function isVLCapable(model?: string | null): boolean {
  if (!model) return false;
  return VL_CAPABLE_MODELS.has(stripRoutingSuffix(model.trim()));
}

/**
 * Provider-scoped executor eligibility: VL-capable AND above the reliability
 * floor, restricted to the provider's curated executor set.
 */
export function isExecutorEligible(
  model: string | undefined | null,
  providerMode: ProviderMode = DEFAULT_PROVIDER_MODE,
): boolean {
  if (!model) return false;
  const normalized = stripRoutingSuffix(model.trim());
  return executorModelSet(providerMode).has(normalized);
}

export function normalizeExecutorModel(args: {
  providerMode?: ProviderMode;
  executorModel?: string | null;
}): string {
  const providerMode = args.providerMode ?? DEFAULT_PROVIDER_MODE;
  const model = args.executorModel?.trim();
  if (model && isExecutorEligible(model, providerMode)) return model;
  return getDefaultExecutorModel(providerMode);
}

export function normalizeExecutorFallbackModel(args: {
  providerMode?: ProviderMode;
  executorModel: string;
  executorFallbackModel?: string | null;
}): string {
  const providerMode = args.providerMode ?? DEFAULT_PROVIDER_MODE;
  const fallback = args.executorFallbackModel?.trim();
  if (fallback && isExecutorEligible(fallback, providerMode)) {
    return fallback;
  }
  return args.executorModel;
}
