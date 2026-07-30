import { LLM_MODEL_CONFIG } from "../../config/model-config";

/**
 * Per-seat model ids, resolved from the checked-in model config.
 *
 * Extracted from `client.ts` (2026-07-26) when adding the OpenRouter seat pair
 * pushed that file past its decomposition budget. These are pure config
 * lookups with no behaviour, so they read better collected in one place than
 * scattered between the provider base-URL constants they used to sit beside.
 * `client.ts` re-exports the whole module, so every existing import path
 * (`from "./client"`) still resolves.
 *
 * ID FORMS ARE NOT INTERCHANGEABLE. Fireworks addresses models as
 * `accounts/fireworks/models/...` and 404s on a catalog id; OpenRouter uses the
 * catalog form (`z-ai/glm-5.2`) and 404s on the Fireworks form. Both directions
 * of that mistake have shipped — the 2026-07-10 judge-seat incident and the
 * 2026-07-26 OpenRouter-stack fix. Keep each provider's seats in its own form.
 */

/** Executor model tier — used for initial turns. Tracks the recommended mode. */
export const MODEL_EXECUTOR = LLM_MODEL_CONFIG.executor;
/** Fallback executor when a turn comes back empty. */
export const MODEL_EXECUTOR_EMPTY_RESPONSE_FALLBACK =
  LLM_MODEL_CONFIG.executorEmptyResponseFallback;
/** Planner model tier — used after escalation (Fireworks id form). */
export const MODEL_PLANNER = LLM_MODEL_CONFIG.planner;
/** Writer specialist model — used for one-shot prose composition (compose_text) */
export const MODEL_WRITER = LLM_MODEL_CONFIG.writer;
/** Verification judge model — used for the rubric judge (RFC LP-15 Phase 10) */
export const MODEL_JUDGE = LLM_MODEL_CONFIG.judge;

/**
 * OpenRouter planner/judge seats. MODEL_PLANNER and MODEL_JUDGE above are
 * Fireworks ids and 404 on OpenRouter, so the OpenRouter stack needs its own
 * pair rather than borrowing them.
 */
export const OPENROUTER_MODEL_PLANNER = LLM_MODEL_CONFIG.openrouter.planner;
export const OPENROUTER_MODEL_JUDGE = LLM_MODEL_CONFIG.openrouter.judge;

export const OPENAI_MODEL_EXECUTOR = LLM_MODEL_CONFIG.openai.executor;
export const OPENAI_MODEL_PLANNER = LLM_MODEL_CONFIG.openai.planner;

export const GROQ_MODEL_PLANNER = LLM_MODEL_CONFIG.groq.planner;

export const MOONSHOT_MODEL_EXECUTOR = LLM_MODEL_CONFIG.moonshot.executor;
export const MOONSHOT_MODEL_PLANNER = LLM_MODEL_CONFIG.moonshot.planner;

export const XIAOMI_MODEL_EXECUTOR = LLM_MODEL_CONFIG.xiaomi.executor;
export const XIAOMI_MODEL_PLANNER = LLM_MODEL_CONFIG.xiaomi.planner;

export const DEEPSEEK_MODEL_PLANNER = LLM_MODEL_CONFIG.deepseek.planner;
export const DEEPSEEK_MODEL_PLANNER_PRO = LLM_MODEL_CONFIG.deepseek.plannerPro;

export const FIREWORKS_MODEL_EXECUTOR = LLM_MODEL_CONFIG.fireworks.executor;
export const FIREWORKS_MODEL_PLANNER = LLM_MODEL_CONFIG.fireworks.planner;

export const CEREBRAS_MODEL_EXECUTOR = LLM_MODEL_CONFIG.cerebras.executor;
