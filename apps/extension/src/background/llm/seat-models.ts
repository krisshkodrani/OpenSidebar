import { LLM_MODEL_CONFIG } from "../../config/model-config";
export const MODEL_EXECUTOR = LLM_MODEL_CONFIG.executor;
export const MODEL_EXECUTOR_EMPTY_RESPONSE_FALLBACK =
  LLM_MODEL_CONFIG.executorEmptyResponseFallback;
export const MODEL_PLANNER = LLM_MODEL_CONFIG.openrouter.planner;
export const MODEL_WRITER = LLM_MODEL_CONFIG.writer;
export const MODEL_JUDGE = LLM_MODEL_CONFIG.openrouter.judge;
export const OPENROUTER_MODEL_PLANNER = MODEL_PLANNER;
export const OPENROUTER_MODEL_JUDGE = MODEL_JUDGE;
