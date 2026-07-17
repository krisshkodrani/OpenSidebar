import type { UserSettings } from "../types";

export type ProviderMode = NonNullable<UserSettings["providerMode"]>;

// Default executor per provider (owner decision 2026-07-17): minimax-m3 for the
// Fireworks-family modes. It is unified-VL and ~3x cheaper than kimi-k2p7-code
// end-to-end; smoke e2e matched Kimi's 9/9 pass rate ~9% faster and ~1/3 the
// cost, and medium e2e (interaction-regression) passed 14/15. The cost cut
// matters most for the compulsory e2e gates run during development.
// KNOWN LIMIT (medium eval, 2026-07-17): minimax-m3 sits JUST BELOW Kimi on
// fine-grained vision — it misread 8px canvas-only fine print
// (perception-region-zoom: read 4.2% vs the correct 4.7%, consistently), a case
// Kimi reads correctly from the first high-detail screenshot. Real forms use DOM
// text (read fine); the gap is pixels-only OCR of tiny text. Accepted for the
// dev-cost win. kimi-k2p7-code stays ELIGIBLE — select it via
// settings.executorModel / E2E_MODEL for precision-critical vision runs.
export const DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER: Record<
  ProviderMode,
  string
> = {
  openrouter: "accounts/fireworks/models/minimax-m3",
  "openrouter-groq": "accounts/fireworks/models/minimax-m3",
  "openai-groq": "accounts/fireworks/models/minimax-m3",
  fireworks: "accounts/fireworks/models/minimax-m3",
  "fireworks-deepseek": "accounts/fireworks/models/minimax-m3",
  "cerebras-fireworks": "gemma-4-31b",
  moonshot: "kimi-k2.6",
  xiaomi: "mimo-v2-omni",
};

const FIREWORKS_EXECUTOR_MODELS = new Set([
  "accounts/fireworks/models/kimi-k2p7-code",
  "accounts/fireworks/routers/kimi-k2p6-turbo",
  "accounts/fireworks/routers/kimi-k2p5-turbo",
  "qwen/qwen3-vl-30b-a3b-instruct",
  "qwen/qwen3-vl-30b-a3b-thinking",
  // minimax-m3: the DEFAULT Fireworks-family executor since 2026-07-17 (unified
  // VL, ~3x cheaper; smoke-tier A/B matched K2.7-Code). Kept listed so the
  // eligibility policy admits it explicitly.
  "accounts/fireworks/models/minimax-m3",
]);

const MOONSHOT_EXECUTOR_MODELS = new Set(["kimi-k2.6", "kimi-k2.5"]);

const XIAOMI_EXECUTOR_MODELS = new Set(["mimo-v2-omni"]);

/**
 * Cerebras executor candidates (eval, 2026-07-09): gemma-4-31b is multimodal
 * and under evaluation against the K2.7-Code reliability floor — listed here
 * so the cerebras-fireworks mode can seat it; not part of any other
 * provider's curated set.
 */
const CEREBRAS_EXECUTOR_MODELS = new Set(["gemma-4-31b"]);

const OPENROUTER_EXECUTOR_MODELS = new Set([
  ...FIREWORKS_EXECUTOR_MODELS,
  ...MOONSHOT_EXECUTOR_MODELS,
  "openai/gpt-5.4-mini",
  "gpt-5.4-mini",
  "x-ai/grok-4.1-fast",
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
export const EXECUTOR_ELIGIBLE_MODELS: ReadonlySet<string> = new Set([
  ...OPENROUTER_EXECUTOR_MODELS,
  ...XIAOMI_EXECUTOR_MODELS,
  ...CEREBRAS_EXECUTOR_MODELS,
]);

/**
 * Models that can accept image input. Today identical to the eligible set;
 * a VL model below the reliability floor would be added here without being
 * granted the executor seat.
 */
const VL_CAPABLE_MODELS: ReadonlySet<string> = EXECUTOR_ELIGIBLE_MODELS;

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

/**
 * Provider-scoped executor eligibility: VL-capable AND above the reliability
 * floor, restricted to the provider's curated executor set.
 */
export function isExecutorEligible(
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
  if (providerMode === "cerebras-fireworks") {
    return CEREBRAS_EXECUTOR_MODELS.has(normalized);
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
  if (model && isExecutorEligible(model, providerMode)) return model;
  return getDefaultExecutorModel(providerMode);
}

export function normalizeExecutorFallbackModel(args: {
  providerMode?: ProviderMode;
  executorModel: string;
  executorFallbackModel?: string | null;
}): string {
  const providerMode = args.providerMode ?? "fireworks";
  const fallback = args.executorFallbackModel?.trim();
  if (fallback && isExecutorEligible(fallback, providerMode)) {
    return fallback;
  }
  return args.executorModel;
}
