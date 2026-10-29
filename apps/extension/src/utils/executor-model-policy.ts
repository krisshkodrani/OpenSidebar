/** Executor model of a fresh install. Addressed by OpenRouter catalog id. */
export const DEFAULT_EXECUTOR_MODEL = "openai/gpt-6-luna";

/**
 * OpenRouter-served executor candidates, in OpenRouter's catalog id form.
 *
 * Every id below was verified against the live OpenRouter catalog or added
 * from current model cards, and every one is image-capable. The executor sees
 * the screenshot on unified_vl turns.
 */
const EXECUTOR_MODELS = new Set([
  "openai/gpt-6-luna",
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
 * the executor seat only if it is (1) VL-capable, because the executor sees
 * the screenshot on unified_vl turns, and (2) above the reliability floor for
 * reactive action-taking (about Kimi K2.7 Code tier; GPT-OSS-class models are
 * not eligible). Text-only and cheaper models stay available for the
 * planner/writer/perception seats.
 */
export const EXECUTOR_ELIGIBLE_MODELS: ReadonlySet<string> = EXECUTOR_MODELS;

/** Catalog ids used by catalog checks and the executor picker. */
export function getExecutorEligibleModelIds(): readonly string[] {
  return [...EXECUTOR_MODELS];
}

function stripRoutingSuffix(model: string): string {
  return model.replace(/:(?:nitro|floor)$/, "");
}

/**
 * Check if a model supports unified VL executor mode (vision + tool calling).
 * Today identical to executor eligibility; a VL model below the reliability
 * floor would be added here without being granted the executor seat.
 */
export function isVLCapable(model?: string | null): boolean {
  if (!model) return false;
  return EXECUTOR_MODELS.has(stripRoutingSuffix(model.trim()));
}

/** VL-capable AND above the reliability floor. */
export function isExecutorEligible(model: string | undefined | null): boolean {
  return isVLCapable(model);
}

export function normalizeExecutorModel(executorModel?: string | null): string {
  const model = executorModel?.trim();
  return model && isExecutorEligible(model) ? model : DEFAULT_EXECUTOR_MODEL;
}

export function normalizeExecutorFallbackModel(args: {
  executorModel: string;
  executorFallbackModel?: string | null;
}): string {
  const fallback = args.executorFallbackModel?.trim();
  return fallback && isExecutorEligible(fallback)
    ? fallback
    : args.executorModel;
}
