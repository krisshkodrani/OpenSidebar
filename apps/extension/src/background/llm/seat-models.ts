import { LLM_MODEL_CONFIG } from "../../config/model-config";

/**
 * Per-seat model ids, resolved from the checked-in model config. All ids use
 * the OpenRouter catalog form (`openai/gpt-6-luna`).
 */

/** Executor model tier, used for initial turns. */
export const MODEL_EXECUTOR = LLM_MODEL_CONFIG.executor;
/** Fallback executor when a turn comes back empty. */
export const MODEL_EXECUTOR_EMPTY_RESPONSE_FALLBACK =
  LLM_MODEL_CONFIG.executorEmptyResponseFallback;
/** Planner model tier, used after escalation. */
export const MODEL_PLANNER = LLM_MODEL_CONFIG.planner;
/** Writer specialist model, used for one-shot prose composition (compose_text) */
export const MODEL_WRITER = LLM_MODEL_CONFIG.writer;
/** Verification judge model, used for the rubric judge (RFC LP-15 Phase 10) */
export const MODEL_JUDGE = LLM_MODEL_CONFIG.judge;
