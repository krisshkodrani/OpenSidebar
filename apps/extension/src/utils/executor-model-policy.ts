import type { UserSettings } from "../types";

export type ProviderMode = NonNullable<UserSettings["providerMode"]>;

/**
 * The recommended stack, and what a fresh install gets (owner decision
 * 2026-07-26). OpenRouter reaches the same models Fireworks serves, but spreads
 * each across competing hosts — so a seat can be pointed at whichever host is
 * cheapest or fastest that week instead of one vendor's single rate.
 *
 * Sizing note, so nobody quotes a saving this does not deliver: on the EXECUTOR
 * seat — ~98% of measured spend — OpenRouter's list rate for minimax-m3 is
 * identical to Fireworks' (0.30/1.20/0.06), and OpenRouter adds a 5.5% Stripe
 * credit fee. The wins are on the planner (glm-5.2, ~39% under Fireworks) and
 * judge (gpt-oss-120b, ~63% under) seats, which carry a small share of traffic,
 * plus the kimi-k2.7-code fallback where OpenRouter is cheaper AND ~2.9x faster
 * against a Fireworks route sitting at 93.4% uptime. Treat the headline as
 * "more routing choice and better tail reliability", not a large bill cut.
 */
export const DEFAULT_PROVIDER_MODE: ProviderMode = "openrouter";

// Fireworks' live model metadata is the source of truth for executor
// compatibility. Kimi K2.7 Code is the stable default because it currently
// advertises serverless image input and tool support. MiniMax M3 remains useful
// for text seats, but Fireworks reports supportsImageInput=false, so it must not
// occupy the unified-VL executor seat.
export const DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER: Record<
  ProviderMode,
  string
> = {
  // OpenRouter addresses models by CATALOG id (`minimax/minimax-m3`). The
  // Fireworks `accounts/...` form 404s there, exactly as the catalog form 404s
  // on Fireworks — the same id-form trap as the 2026-07-10 judge-seat incident,
  // but in the opposite direction. Both OpenRouter modes carried the Fireworks
  // form until 2026-07-26, which made the whole OpenRouter stack unusable on
  // its own default; fixed here as a precondition of recommending it.
  openrouter: "minimax/minimax-m3",
  "openrouter-groq": "minimax/minimax-m3",
  // openai-groq stays on the Fireworks form on purpose: that mode's "OpenAI
  // compatible" executor endpoint is Fireworks-backed (see the settings
  // one-liner), so it wants the accounts/... id, not a catalog one.
  "openai-groq": "accounts/fireworks/models/kimi-k2p7-code",
  fireworks: "accounts/fireworks/models/kimi-k2p7-code",
  "fireworks-deepseek": "accounts/fireworks/models/kimi-k2p7-code",
  "cerebras-fireworks": "gemma-4-31b",
  moonshot: "kimi-k2.6",
  xiaomi: "mimo-v2-omni",
};

const FIREWORKS_EXECUTOR_MODELS = new Set([
  "accounts/fireworks/models/kimi-k2p7-code",
  "accounts/fireworks/models/kimi-k2p6",
  "accounts/fireworks/models/qwen3p7-plus",
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

/**
 * OpenRouter-served executor candidates, in OpenRouter's catalog id form.
 *
 * This set deliberately does NOT spread the Fireworks/Moonshot sets: those hold
 * provider-native ids (`accounts/fireworks/...`, bare `kimi-k2.6`) that 404 on
 * OpenRouter. Every id below was verified against the live OpenRouter catalog
 * on 2026-07-26, and every one is image-capable — the executor sees the
 * screenshot on unified_vl turns.
 *
 * Removed in the same pass: `x-ai/grok-4.1-fast`, which OpenRouter has retired
 * (the catalog now carries grok-4.3/4.5/4.20), and the bare `gpt-5.4-mini`
 * alias, which is not a routable id.
 */
const OPENROUTER_EXECUTOR_MODELS = new Set([
  "stealth/ox-alpha",
  "minimax/minimax-m3",
  "moonshotai/kimi-k2.7-code",
  "moonshotai/kimi-k2.6",
  "moonshotai/kimi-k2.5",
  "qwen/qwen3.7-plus",
  "qwen/qwen3-vl-30b-a3b-instruct",
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
export const EXECUTOR_ELIGIBLE_MODELS: ReadonlySet<string> = new Set([
  // Each provider set is spread explicitly. Until 2026-07-26 the Fireworks and
  // Moonshot ids reached this union only by being spread INTO the OpenRouter
  // set; once that set was narrowed to OpenRouter's own id form they would have
  // silently dropped out of the union, taking isVLCapable() with them.
  ...OPENROUTER_EXECUTOR_MODELS,
  ...FIREWORKS_EXECUTOR_MODELS,
  ...MOONSHOT_EXECUTOR_MODELS,
  ...XIAOMI_EXECUTOR_MODELS,
  ...CEREBRAS_EXECUTOR_MODELS,
]);

function executorModelSet(providerMode: ProviderMode): ReadonlySet<string> {
  if (providerMode === "moonshot") return MOONSHOT_EXECUTOR_MODELS;
  if (providerMode === "xiaomi") return XIAOMI_EXECUTOR_MODELS;
  if (providerMode === "cerebras-fireworks") return CEREBRAS_EXECUTOR_MODELS;
  if (
    providerMode === "fireworks" ||
    providerMode === "fireworks-deepseek" ||
    providerMode === "openai-groq"
  ) {
    return FIREWORKS_EXECUTOR_MODELS;
  }
  return OPENROUTER_EXECUTOR_MODELS;
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
