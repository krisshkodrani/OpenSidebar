import type { UserSettings } from "../types";

export type ProviderMode = NonNullable<UserSettings["providerMode"]>;

export const DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER: Record<
  ProviderMode,
  string
> = {
  openrouter: "accounts/fireworks/routers/kimi-k2p5-turbo",
  "openrouter-groq": "accounts/fireworks/routers/kimi-k2p5-turbo",
  "openai-groq": "accounts/fireworks/routers/kimi-k2p5-turbo",
  fireworks: "accounts/fireworks/routers/kimi-k2p5-turbo",
  "fireworks-deepseek": "accounts/fireworks/routers/kimi-k2p5-turbo",
  moonshot: "kimi-k2.6",
  xiaomi: "mimo-v2-omni",
};

const FIREWORKS_EXECUTOR_MODELS = new Set([
  "accounts/fireworks/routers/kimi-k2p5-turbo",
  "qwen/qwen3-vl-30b-a3b-instruct",
  "qwen/qwen3-vl-30b-a3b-thinking",
]);

const MOONSHOT_EXECUTOR_MODELS = new Set(["kimi-k2.6", "kimi-k2.5"]);

const XIAOMI_EXECUTOR_MODELS = new Set(["mimo-v2-omni"]);

const OPENROUTER_EXECUTOR_MODELS = new Set([
  ...FIREWORKS_EXECUTOR_MODELS,
  ...MOONSHOT_EXECUTOR_MODELS,
  "openai/gpt-5.4-mini",
  "gpt-5.4-mini",
  "x-ai/grok-4.1-fast",
]);

const VL_CAPABLE_MODELS = new Set([
  ...OPENROUTER_EXECUTOR_MODELS,
  ...XIAOMI_EXECUTOR_MODELS,
]);

function stripRoutingSuffix(model: string): string {
  return model.replace(/:nitro$/, "");
}

export function getDefaultExecutorModel(
  providerMode: ProviderMode = "fireworks",
): string {
  return DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER[providerMode];
}

/** Check if a model supports unified VL executor mode (vision + tool calling). */
export function isVLCapable(model?: string | null): boolean {
  if (!model) return false;
  return VL_CAPABLE_MODELS.has(stripRoutingSuffix(model.trim()));
}

export function isExecutorModelAllowed(
  model: string | undefined | null,
  providerMode: ProviderMode = "fireworks",
): boolean {
  if (!model) return false;
  const normalized = stripRoutingSuffix(model.trim());
  if (providerMode === "moonshot") {
    return MOONSHOT_EXECUTOR_MODELS.has(normalized);
  }
  if (providerMode === "xiaomi") {
    return XIAOMI_EXECUTOR_MODELS.has(normalized);
  }
  if (
    providerMode === "fireworks" ||
    providerMode === "fireworks-deepseek" ||
    providerMode === "openai-groq"
  ) {
    return FIREWORKS_EXECUTOR_MODELS.has(normalized);
  }
  return OPENROUTER_EXECUTOR_MODELS.has(normalized);
}

export function normalizeExecutorModel(args: {
  providerMode?: ProviderMode;
  executorModel?: string | null;
}): string {
  const providerMode = args.providerMode ?? "fireworks";
  const model = args.executorModel?.trim();
  if (model && isExecutorModelAllowed(model, providerMode)) return model;
  return getDefaultExecutorModel(providerMode);
}

export function normalizeExecutorFallbackModel(args: {
  providerMode?: ProviderMode;
  executorModel: string;
  executorFallbackModel?: string | null;
}): string {
  const providerMode = args.providerMode ?? "fireworks";
  const fallback = args.executorFallbackModel?.trim();
  if (fallback && isExecutorModelAllowed(fallback, providerMode)) {
    return fallback;
  }
  return args.executorModel;
}
